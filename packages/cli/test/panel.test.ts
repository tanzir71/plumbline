import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveScope } from "@tanziro/plumbline-core";
import { afterEach, describe, expect, it } from "vitest";
import { materialize } from "../../../fixtures/materialize.mjs";
import {
  PANEL_TEMPLATE,
  assertWithinBudget,
  buildPanelContext,
  cleanCandidates,
  loadPanel,
  mergeCandidates,
  parsePanel,
  planPanel,
  redact,
  type PanelCandidate,
  type PanelContext,
} from "../src/panel.js";
import { agentArgs, buildReviewPrompt } from "../src/review.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "../dist/index.js");
const T = 120000;
const KEY_ENV = "PLUMBLINE_TEST_PANEL_KEY";
const KEY = "test-panel-key";

function cli(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", fail);
    child.once("close", (code) => done({ code, out, err }));
  });
}

type Reply = { status?: number; findings?: unknown[]; cost?: number };
const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A local OpenAI-compatible endpoint, so the real HTTP path runs without a paid model. */
async function mockModel(reply: (model: string) => Reply) {
  const requests: { auth?: string; body: { model: string; messages: { content: string }[]; max_tokens?: number } }[] = [];
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (d) => (text += d));
    req.on("end", () => {
      const body = JSON.parse(text) as (typeof requests)[number]["body"];
      requests.push({ auth: req.headers.authorization, body });
      const r = reply(body.model);
      res.writeHead(r.status ?? 200, { "Content-Type": "application/json" });
      res.end(
        r.status && r.status >= 400
          ? JSON.stringify({ error: { code: r.status, message: "mock failure" } })
          : JSON.stringify({
              choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ findings: r.findings ?? [] }) } }],
              usage: { prompt_tokens: 100, completion_tokens: 20, ...(r.cost === undefined ? {} : { cost: r.cost }) },
            }),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
}

function panelConfig(url: string, models: string[], extra = "lead: none\nbudget_usd: 5") {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-panel-"));
  const file = join(dir, "panel.yml");
  writeFileSync(
    file,
    `version: 1
${extra}
providers:
  mock:
    base_url: ${url}
    key_env: ${KEY_ENV}
experts:
${models
  .map(
    (m, i) => `  - id: expert-${i + 1}
    provider: mock
    model: ${m}
    lenses: [L01, L03]
    price: { input_per_million: 1, output_per_million: 2 }`,
  )
  .join("\n")}
`,
  );
  return file;
}

const changedFile = (repo: string) => (resolveScope({ cwd: repo, base: "main" }).files[0] as { path: string }).path;
const finding = (file: string, severity = "P1") => ({
  severity,
  lens: "L01",
  title: "Invoice total ignores tenant",
  body: "The query misses the tenant filter, so one tenant can read another tenant's invoices.",
  file,
  line: 1,
  endLine: null,
  security: false,
  fix: null,
});

function fakeLeadEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-fake-lead-"));
  writeFileSync(
    join(dir, "fake-codex.mjs"),
    `import { readFileSync, writeFileSync } from "node:fs";
if (process.argv[2] === "login") process.exit(0);
const prompt = readFileSync(0, "utf8");
const file = /Finish by writing (\\S+findings\\.json)/.exec(prompt)[1];
const source = /panel's candidates are in (\\S+candidates\\.json)/.exec(prompt)[1];
const { candidates } = JSON.parse(readFileSync(source, "utf8"));
writeFileSync(file, JSON.stringify({ model: "fake", reviewers: [], lenses: { ran: [], skipped: [] }, unreadFiles: [],
  findings: candidates.map((c) => ({ severity: "P2", lens: c.lens, title: process.env.${KEY_ENV} ? "KEY LEAKED" : "Verified by lead", body: c.body, file: c.file, line: c.line })) }));
`,
  );
  if (process.platform === "win32") {
    writeFileSync(join(dir, "codex.cmd"), '@node "%~dp0fake-codex.mjs" %*\r\n');
  } else {
    writeFileSync(join(dir, "codex"), '#!/bin/sh\nexec node "$(dirname "$0")/fake-codex.mjs" "$@"\n');
    chmodSync(join(dir, "codex"), 0o755);
  }
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  return { ...process.env, [KEY_ENV]: KEY, [pathKey]: `${dir}${delimiter}${process.env[pathKey] ?? ""}` };
}

describe("panel config", () => {
  it("accepts the starter template and the site's example", () => {
    expect(parsePanel(PANEL_TEMPLATE).experts).toHaveLength(3);
    const snippets = JSON.parse(readFileSync(join(here, "../../../site/src/data/snippets.json"), "utf8")) as { panel: string };
    expect(parsePanel(snippets.panel).experts.map((e) => e.provider)).toContain("claude");
  });

  it("rejects endpoints that could expose code or keys", () => {
    const config = (url: string) => `version: 1
budget_usd: 1
providers: { custom: { base_url: "${url}" } }
experts: [{ id: a, provider: custom, model: m, price: { input_per_million: 0, output_per_million: 0 } }]`;
    expect(() => parsePanel(config("http://example.com/v1"))).toThrow("must use https");
    expect(() => parsePanel(config("https://user:pass@example.com/v1"))).toThrow("username or password");
    expect(parsePanel(config("http://localhost:11434/v1")).experts).toHaveLength(1);
  });

  it("needs a model, a known provider and a price for custom endpoints", () => {
    expect(() => parsePanel("version: 1\nbudget_usd: 1\nexperts: [{ id: a, provider: nope, model: m }]")).toThrow("is not openrouter");
    expect(() => parsePanel("version: 1\nbudget_usd: 1\nexperts: [{ id: a, provider: openrouter }]")).toThrow("model");
    expect(() => parsePanel("version: 1\nbudget_usd: 1\nproviders: { c: { base_url: 'https://example.com' } }\nexperts: [{ id: a, provider: c, model: m }]")).toThrow("price");
  });

  it("does not let a file in the reviewed repository choose an endpoint", () => {
    const repo = materialize("clean");
    const file = join(repo, "panel.yml");
    writeFileSync(file, "version: 1\nbudget_usd: 1\nproviders: { c: { base_url: 'https://example.com', key_env: SECRET_NAME } }\nexperts: [{ id: a, provider: c, model: m, price: { input_per_million: 0, output_per_million: 0 } }]\n");
    expect(() => loadPanel(repo, file)).toThrow("cannot define custom endpoints");
  }, T);
});

describe("what leaves the machine", () => {
  it("redacts common credentials and keeps line numbers", () => {
    const token = ["gh", "p_", "a".repeat(36)].join("");
    const pem = ["-----BEGIN PRIVATE", " KEY-----\nabc\ndef\n-----END PRIVATE", " KEY-----"].join("");
    const out = redact(`one\n${token}\n${pem}\nlast`);
    expect(out).not.toContain(token);
    expect(out).not.toContain("abc");
    expect(out.split("\n").indexOf("last")).toBe(`one\n${token}\n${pem}\nlast`.split("\n").indexOf("last"));
  });

  it("withholds secret files and does not follow symlinks", () => {
    const repo = materialize("clean");
    const outside = join(mkdtempSync(join(tmpdir(), "plumbline-outside-")), "private.txt");
    writeFileSync(outside, "OUTSIDE_THE_REPO");
    writeFileSync(join(repo, ".env"), "ENV_SECRET_VALUE=1\n");
    spawnSync("git", ["rm", "-q", "--cached", "--ignore-unmatch", ".env"], { cwd: repo });
    let linked = true;
    try {
      symlinkSync(outside, join(repo, "linked.txt"));
    } catch {
      linked = false; // Windows needs a privilege to create symlinks.
    }
    const context = buildPanelContext(resolveScope({ cwd: repo, base: "main" }), null, 120000);
    expect(context.withheld).toContain(".env");
    expect(context.text).not.toContain("ENV_SECRET_VALUE");
    if (linked) expect(context.text).not.toContain("OUTSIDE_THE_REPO");
  }, T);

  it("records files that do not fit as unread", () => {
    const repo = materialize("clean");
    writeFileSync(join(repo, "large.txt"), "x".repeat(20000));
    const context = buildPanelContext(resolveScope({ cwd: repo, base: "main" }), null, 1000);
    expect(context.unread).toContain("large.txt");
    expect(context.text).not.toContain("x".repeat(100));
  }, T);
});

describe("cost control", () => {
  const context: PanelContext = { text: "a".repeat(2000), lines: new Map(), unread: [], withheld: [] };
  const config = (budget: number, model = "vendor/model") =>
    parsePanel(`version: 1\nbudget_usd: ${budget}\nexperts: [{ id: a, provider: openrouter, model: ${model}, lenses: [L01] }]`);
  const lenses = new Map([["a", [{ id: "L01", name: "L", body: "b", file: "", custom: false, default: "on", proof: [], catches: "", example: "" } as never]]]);
  const fakeFetch = (data: unknown[]) => (async () => new Response(JSON.stringify({ data }))) as unknown as typeof fetch;
  const endpoint = (prompt: string, completion: string, params: string[], model = "vendor/model") => ({ model_id: model, pricing: { prompt, completion }, supported_parameters: params });

  it("prices the dearest usable endpoint and its token parameter", async () => {
    const plan = await planPanel(
      config(5),
      context,
      lenses,
      fakeFetch([
        endpoint("0.000001", "0.000002", ["structured_outputs", "max_completion_tokens"]),
        endpoint("0.000003", "0.000004", ["structured_outputs", "max_completion_tokens"]),
        endpoint("0.1", "0.1", ["max_completion_tokens"]),
        endpoint("0.1", "0.1", ["structured_outputs", "max_tokens"], "other/model"),
      ]),
    );
    expect(plan.experts[0]!.tokenParam).toBe("max_completion_tokens");
    expect(plan.experts[0]!.inputPerToken).toBe(0.000003);
    expect(plan.experts[0]!.outputPerToken).toBe(0.000004);
  });

  it("stops before spending when the worst case is over budget", async () => {
    const plan = await planPanel(config(0.01), context, lenses, fakeFetch([endpoint("0.00001", "0.00001", ["structured_outputs", "max_tokens"])]));
    expect(() => assertWithinBudget(plan)).toThrow("Nothing was spent");
  });

  it("refuses a model with no eligible endpoint or a dynamic price", async () => {
    await expect(planPanel(config(5), context, lenses, fakeFetch([endpoint("0.1", "0.1", ["max_tokens"])]))).rejects.toThrow("zero-data-retention");
    await expect(planPanel(config(5), context, lenses, fakeFetch([endpoint("-1", "-1", ["structured_outputs", "max_tokens"])]))).rejects.toThrow("no fixed price");
  });
});

describe("panel candidates", () => {
  const candidate = (by: string, severity: PanelCandidate["severity"], line = 10): PanelCandidate => ({
    severity,
    lens: "L01",
    title: "Invoice total ignores tenant",
    body: "Missing tenant filter on invoices.",
    file: "src/a.ts",
    line,
    foundBy: [by],
  });

  it("merges agreement without raising the severity", () => {
    const [merged] = mergeCandidates([[candidate("a", "P2")], [candidate("b", "P2", 11)]]);
    expect(merged!.foundBy).toEqual(["a", "b"]);
    expect(merged!.severity).toBe("P2");
  });

  it("keeps separate issues apart", () => {
    const other = { ...candidate("b", "P2", 40), title: "Retry loop never exits", body: "The retry counter is not incremented." };
    expect(mergeCandidates([[candidate("a", "P2")], [other]])).toHaveLength(2);
  });

  it("drops candidates for files outside the change or lines that do not exist", () => {
    const base = { severity: "P2", lens: "L99", title: "T", body: "B" };
    const { kept, invalid } = cleanCandidates(
      { findings: [{ ...base, file: "src/a.ts", line: 2 }, { ...base, file: "src/other.ts", line: 1 }, { ...base, file: "src/a.ts", line: 99 }, { nope: true }] },
      "a",
      ["L01"],
      new Set(["src/a.ts"]),
      new Map([["src/a.ts", 5]]),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.lens).toBe("L01");
    expect(invalid).toBe(3);
  });

  it("ignores any proof a model tries to supply", () => {
    const { kept } = cleanCandidates(
      { findings: [{ severity: "P1", lens: "L01", title: "T", body: "B", file: "src/a.ts", proof: [{ kind: "failing_test", ref: "x" }] }] },
      "a",
      ["L01"],
      new Set(["src/a.ts"]),
      new Map(),
    );
    expect(kept[0]).not.toHaveProperty("proof");
  });
});

describe("plumbline review --panel", () => {
  it("shows unproven P1 candidates at P2, even when every expert agrees", async () => {
    const repo = materialize("clean");
    const file = changedFile(repo);
    const model = await mockModel(() => ({ findings: [finding(file)], cost: 0.25 }));
    const r = await cli(repo, ["review", "--base", "main", "--panel", "--panel-config", panelConfig(model.url, ["m-a", "m-b"]), "--json"], { ...process.env, [KEY_ENV]: KEY });
    expect(r.err).toContain("Expert expert-1");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as { findings: { severity: string; title: string; body: string }[]; reviewers: { id: string }[] };
    const merged = report.findings.filter((f) => f.title === "Invoice total ignores tenant");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.severity).toBe("P2");
    expect(merged[0]!.body).toContain("expert-1, expert-2");
    expect(report.reviewers.map((x) => x.id)).toEqual(["expert-1", "expert-2"]);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout).toBe("");
  }, T);

  it("caps the score when an expert fails", async () => {
    const repo = materialize("clean");
    const model = await mockModel((m) => (m === "bad" ? { status: 400 } : { findings: [] }));
    const r = await cli(repo, ["review", "--base", "main", "--panel", "--panel-config", panelConfig(model.url, ["good", "bad"]), "--json"], { ...process.env, [KEY_ENV]: KEY });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as { score: { value: number }; reviewers: { id: string; status: string }[] };
    expect(report.reviewers.find((x) => x.id === "expert-2")?.status).toBe("inconclusive");
    expect(report.score.value).toBeLessThanOrEqual(4);
  }, T);

  it("gives no score when every expert fails", async () => {
    const repo = materialize("clean");
    const model = await mockModel(() => ({ status: 401 }));
    const r = await cli(repo, ["review", "--base", "main", "--panel", "--panel-config", panelConfig(model.url, ["m"]), "--json"], { ...process.env, [KEY_ENV]: KEY });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no panel expert finished");
    expect(model.requests).toHaveLength(1);
  }, T);

  it("spends nothing when a key is missing or the worst case is over budget", async () => {
    const repo = materialize("clean");
    const model = await mockModel(() => ({ findings: [] }));
    const env = { ...process.env };
    delete env[KEY_ENV];
    const noKey = await cli(repo, ["review", "--base", "main", "--panel", "--panel-config", panelConfig(model.url, ["m"])], env);
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain(KEY_ENV);
    const over = await cli(repo, ["review", "--base", "main", "--panel", "--panel-config", panelConfig(model.url, ["m"], "lead: none\nbudget_usd: 0.000001")], { ...process.env, [KEY_ENV]: KEY });
    expect(over.code).toBe(1);
    expect(over.err).toContain("Nothing was spent");
    expect(model.requests).toHaveLength(0);
  }, T);

  it("lets the lead verify candidates without seeing the panel's key", async () => {
    const repo = materialize("clean");
    const file = changedFile(repo);
    const model = await mockModel(() => ({ findings: [finding(file)] }));
    const r = await cli(repo, ["review", "--base", "main", "--panel", "--panel-config", panelConfig(model.url, ["m"], "lead: codex\nbudget_usd: 5"), "--json"], fakeLeadEnv());
    expect(r.err).toContain("Verifying 1 candidates with codex");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as { findings: { title: string }[]; reviewers: { id: string }[]; run: { model: string } };
    expect(report.findings.map((f) => f.title)).toContain("Verified by lead");
    expect(report.findings.map((f) => f.title)).not.toContain("KEY LEAKED");
    expect(report.reviewers.map((x) => x.id)).toEqual(["expert-1", "lead"]);
    expect(report.run.model).toContain("lead: codex");
  }, T);

  it("cannot be combined with --no-agent", async () => {
    const repo = materialize("clean");
    const r = await cli(repo, ["review", "--base", "main", "--panel", "--no-agent"], process.env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("cannot be used together");
  }, T);
});

describe("plumbline panel", () => {
  it("writes a starter config once", async () => {
    const repo = materialize("clean");
    const file = join(mkdtempSync(join(tmpdir(), "plumbline-panel-init-")), "nested", "panel.yml");
    expect((await cli(repo, ["panel", "init", "--panel-config", file], process.env)).code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect((await cli(repo, ["panel", "init", "--panel-config", file], process.env)).code).toBe(1);
  }, T);

  it("prices a change and reports missing keys without calling a model", async () => {
    const repo = materialize("clean");
    const model = await mockModel(() => ({ findings: [] }));
    const config = panelConfig(model.url, ["m"]);
    const env = { ...process.env };
    delete env[KEY_ENV];
    const missing = await cli(repo, ["panel", "check", "--base", "main", "--panel-config", config], env);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain(`${KEY_ENV} missing`);
    const ready = await cli(repo, ["panel", "check", "--base", "main", "--panel-config", config], { ...process.env, [KEY_ENV]: KEY });
    expect(ready.code).toBe(0);
    expect(ready.out).toContain("Worst case for this change");
    expect(ready.out).not.toContain(KEY);
    expect(model.requests).toHaveLength(0);
  }, T);
});

describe("panel prompts", () => {
  it("tells the lead that panel output is untrusted and not proof", () => {
    const prompt = buildReviewPrompt({
      skillDir: "/skill",
      runDir: "/run",
      proofTests: true,
      proveCommand: "prove",
      panel: { candidatesFile: "/run/panel/candidates.json", unread: ["big.ts"], withheld: [".env"] },
    });
    expect(prompt).toContain("Do not start reviewers");
    expect(prompt).toContain("Agreement between models is not evidence");
    expect(prompt).toContain("big.ts");
    expect(prompt).toContain("Do not read these likely secret files");
  });

  it("limits a Claude expert to its own output file", () => {
    const args = agentArgs("claude", { skillRoot: "/skill", runId: "r1", proofTests: false, outputFile: ".plumbline/run/r1/panel/a.output.json" }).join(" ");
    expect(args).toContain("Write(.plumbline/run/r1/panel/a.output.json)");
    expect(args).not.toContain("findings.json");
  });
});
