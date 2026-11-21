import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMENT_MARKER } from "@plumbline/core";
import { describe, expect, it } from "vitest";
import { materialize } from "../../../fixtures/materialize.mjs";
import { agentEnv, canRunAgent, claudeArgs, codexArgs, stripNulls, type AgentConfig } from "../src/agent.js";
import { runCi } from "../src/ci.js";
import { github, gitlab, truncateComment, type FetchLike } from "../src/platform.js";

const T = 90000;

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** A tiny in-memory forge: one PR, its comments and its labels. */
function fakeForge(me: string) {
  const calls: Call[] = [];
  const comments: { id: number; body: string; user: { login: string }; author: { username: string } }[] = [];
  const labels = new Set<string>();
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

  const fetcher: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: url.pathname, body });
    const p = url.pathname;

    if (p.endsWith("/user")) return me.includes("[bot]") ? json({}, 403) : json({ login: me, username: me });
    if (/\/(comments|notes)$/.test(p) && method === "GET") return json(comments);
    if (/\/(comments|notes)$/.test(p) && method === "POST") {
      comments.push({ id: comments.length + 1, body: body.body, user: { login: me }, author: { username: me } });
      return json({ id: comments.length }, 201);
    }
    const edit = /\/(?:comments|notes)\/(\d+)$/.exec(p);
    if (edit && (method === "PATCH" || method === "PUT")) {
      const c = comments.find((x) => x.id === Number(edit[1]));
      if (c) c.body = body.body;
      return json({});
    }
    if (p.endsWith("/labels") && method === "POST") {
      if (body.labels) for (const l of body.labels) labels.add(l);
      return json({}, 201);
    }
    const del = /\/labels\/([^/]+)$/.exec(p);
    if (del && method === "DELETE") {
      const name = decodeURIComponent(del[1] as string);
      if (!labels.delete(name)) return json({}, 404);
      return new Response(null, { status: 204 });
    }
    if (/merge_requests\/\d+$/.test(p) && method === "PUT") {
      if (body.add_labels) labels.add(body.add_labels);
      if (body.remove_labels) labels.delete(body.remove_labels);
      return json({});
    }
    return json({ message: "unexpected" }, 500);
  };
  return { fetcher, calls, comments, labels };
}

function githubEnv(repo: string, extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-gh-"));
  const baseSha = execFileSync("git", ["rev-parse", "main"], { cwd: repo, encoding: "utf8" }).trim();
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7, base: { sha: baseSha, ref: "main" } } }));
  const output = join(dir, "output");
  writeFileSync(output, "");
  return {
    output,
    env: {
      PATH: process.env.PATH,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_WORKSPACE: repo,
      GITHUB_REPOSITORY: "acme/app",
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_OUTPUT: output,
      PLUMBLINE_GITHUB_TOKEN: "test-token",
      PLUMBLINE_MODEL_KEY: "test-key",
      ...extra,
    } as NodeJS.ProcessEnv,
  };
}

const outputs = (file: string) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

const cleanAgent = async () => ({ reviewers: [{ id: "A", status: "complete" }], lenses: { ran: ["L01"], skipped: [] }, findings: [] });

function addGate(repo: string, min: number) {
  // The gate must be on the base branch, because that is the contract CI trusts.
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  git("checkout", "-q", "main");
  writeFileSync(join(repo, "plumbline.yml"), `${readFileSync(join(repo, "plumbline.yml"), "utf8")}gate:\n  - branches: ["main"]\n    min_merge_score: ${min}\n`);
  git("commit", "-qam", "add gate");
  git("checkout", "-q", "feat/change");
  git("rebase", "-q", "main");
}

const quiet = () => undefined;

describe("runCi on GitHub", () => {
  it("creates one comment, then edits it on a re-run", async () => {
    const repo = materialize("clean");
    const forge = fakeForge("github-actions[bot]");
    const { env } = githubEnv(repo);
    await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet });
    await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet });
    expect(forge.comments).toHaveLength(1);
    expect(forge.comments[0]?.body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(forge.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  }, T);

  it("will not overwrite someone else's comment that copies the marker", async () => {
    const repo = materialize("clean");
    const forge = fakeForge("github-actions[bot]");
    forge.comments.push({ id: 1, body: `${COMMENT_MARKER} spoof`, user: { login: "mallory" }, author: { username: "mallory" } });
    const { env } = githubEnv(repo);
    await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet });
    expect(forge.comments[0]?.body).toBe(`${COMMENT_MARKER} spoof`);
    expect(forge.comments).toHaveLength(2);
  }, T);

  it("labels a qualifying PR and removes the label after a risky push", async () => {
    const repo = materialize("clean");
    const forge = fakeForge("github-actions[bot]");
    const { env, output } = githubEnv(repo);
    await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet });
    expect(forge.labels.has("plumbline:light-review")).toBe(true);
    expect(outputs(output).lane).toBe("plumbline:light-review");

    await runCi(env, {
      fetcher: forge.fetcher,
      log: quiet,
      agent: async () => ({
        reviewers: [{ id: "A", status: "complete" }],
        findings: [{ severity: "P2", lens: "L01", title: "Risky", body: "b", file: "src/db/read.ts", line: 1 }],
      }),
    });
    expect(forge.labels.has("plumbline:light-review")).toBe(false);
  }, T);

  it("fails below the gate, and defers the failure when asked", async () => {
    const repo = materialize("ts-layer-violation");
    addGate(repo, 5);
    const forge = fakeForge("github-actions[bot]");
    const direct = githubEnv(repo);
    expect(await runCi(direct.env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet })).toBe(1);

    const deferred = githubEnv(repo, { PLUMBLINE_DEFER_GATE: "true" });
    expect(await runCi(deferred.env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet })).toBe(0);
    const out = outputs(deferred.output);
    expect(out.gate).toBe("fail");
    expect(out["gate-reason"]).toContain("below the minimum 5/5");
    expect(existsSync(join(out["report-dir"] as string, "report.sarif"))).toBe(true);
  }, T);

  it("a PR cannot lower its own gate", async () => {
    const repo = materialize("ts-layer-violation");
    addGate(repo, 5);
    writeFileSync(join(repo, "plumbline.yml"), "version: 1\n");
    execFileSync("git", ["commit", "-qam", "weaken the contract"], { cwd: repo });
    const forge = fakeForge("github-actions[bot]");
    const { env } = githubEnv(repo);
    expect(await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet })).toBe(1);
  }, T);

  it("refuses pull_request_target", async () => {
    const repo = materialize("clean");
    const { env } = githubEnv(repo, { GITHUB_EVENT_NAME: "pull_request_target" });
    await expect(runCi(env, { log: quiet })).rejects.toThrow(/pull_request_target/);
  }, T);

  it("skips other events without failing", async () => {
    const repo = materialize("clean");
    const { env } = githubEnv(repo, { GITHUB_EVENT_NAME: "push" });
    expect(await runCi(env, { log: quiet })).toBe(0);
  }, T);

  it("with no key, runs the graph checks, caps the score and gives no lane", async () => {
    const repo = materialize("clean");
    const forge = fakeForge("github-actions[bot]");
    const { env, output } = githubEnv(repo, { PLUMBLINE_MODEL_KEY: "" });
    expect(await runCi(env, { fetcher: forge.fetcher, log: quiet })).toBe(0);
    const out = outputs(output);
    expect(out["merge-score"]).toBe("4");
    expect(out.lane).toBe("");
    expect(forge.labels.size).toBe(0);
  }, T);

  it("a failed agent is inconclusive, and only fails the job with fail-on-error", async () => {
    const repo = materialize("clean");
    const forge = fakeForge("github-actions[bot]");
    const boom = async () => {
      throw new Error("boom");
    };
    const soft = githubEnv(repo);
    expect(await runCi(soft.env, { fetcher: forge.fetcher, agent: boom, log: quiet })).toBe(0);
    expect(outputs(soft.output)["merge-score"]).toBe("4");
    const hard = githubEnv(repo, { PLUMBLINE_FAIL_ON_ERROR: "true" });
    expect(await runCi(hard.env, { fetcher: forge.fetcher, agent: boom, log: quiet })).toBe(1);
  }, T);

  it("never calls an approve, merge, reviewer or dismiss endpoint", async () => {
    const repo = materialize("clean");
    const forge = fakeForge("github-actions[bot]");
    const { env } = githubEnv(repo);
    await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet });
    for (const c of forge.calls) expect(c.url).not.toMatch(/approve|merge$|reviews|requested_reviewers|dismiss/);
  }, T);
});

describe("runCi on GitLab", () => {
  function gitlabEnv(repo: string, extra: Record<string, string> = {}) {
    const baseSha = execFileSync("git", ["rev-parse", "main"], { cwd: repo, encoding: "utf8" }).trim();
    return {
      PATH: process.env.PATH,
      GITLAB_CI: "true",
      CI_PIPELINE_SOURCE: "merge_request_event",
      CI_PROJECT_DIR: repo,
      CI_PROJECT_ID: "42",
      CI_MERGE_REQUEST_IID: "9",
      CI_MERGE_REQUEST_DIFF_BASE_SHA: baseSha,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
      CI_API_V4_URL: "https://gitlab.internal.test/api/v4",
      PLUMBLINE_GITLAB_TOKEN: "test-token",
      PLUMBLINE_MODEL_KEY: "test-key",
      ...extra,
    } as NodeJS.ProcessEnv;
  }

  it("creates then updates one note, applies the label and writes the reports", async () => {
    const repo = materialize("clean");
    const forge = fakeForge("project_bot");
    const env = gitlabEnv(repo);
    await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet });
    await runCi(env, { fetcher: forge.fetcher, agent: cleanAgent, log: quiet });
    expect(forge.comments).toHaveLength(1);
    expect(forge.calls.some((c) => c.method === "PUT" && c.url.includes("/notes/1"))).toBe(true);
    expect(forge.labels.has("plumbline:light-review")).toBe(true);
    expect(existsSync(join(repo, "gl-code-quality-report.json"))).toBe(true);
    expect(readFileSync(join(repo, "plumbline.env"), "utf8")).toContain("PLUMBLINE_MERGE_SCORE=5");
  }, T);

  it("uses the self-managed API URL", async () => {
    const repo = materialize("clean");
    const urls: string[] = [];
    const forge = fakeForge("project_bot");
    const spy: FetchLike = (input, init) => {
      urls.push(String(input));
      return forge.fetcher(input, init);
    };
    await runCi(gitlabEnv(repo), { fetcher: spy, agent: cleanAgent, log: quiet });
    expect(urls.every((u) => u.startsWith("https://gitlab.internal.test/api/v4/"))).toBe(true);
  }, T);

  it("fails the pipeline below the gate", async () => {
    const repo = materialize("ts-layer-violation");
    addGate(repo, 5);
    const forge = fakeForge("project_bot");
    expect(await runCi(gitlabEnv(repo), { fetcher: forge.fetcher, agent: cleanAgent, log: quiet })).toBe(1);
  }, T);

  it("skips a non-MR pipeline", async () => {
    const repo = materialize("clean");
    expect(await runCi(gitlabEnv(repo, { CI_PIPELINE_SOURCE: "push" }), { log: quiet })).toBe(0);
  }, T);
});

describe("agent isolation", () => {
  const cfg: AgentConfig = { provider: "anthropic", model: "m", key: "model-key", baseUrl: "", proofTests: false };

  it("gives the agent the model key and no forge or CI tokens", () => {
    const env = agentEnv(
      { PATH: "x", GITHUB_TOKEN: "a", GH_TOKEN: "b", PLUMBLINE_GITHUB_TOKEN: "c", PLUMBLINE_GITLAB_TOKEN: "d", CI_JOB_TOKEN: "e", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "f", NPM_TOKEN: "g", PLUMBLINE_MODEL_KEY: "h" },
      cfg,
    );
    expect(Object.keys(env).sort()).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB", "PATH"]);
    expect(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
  });

  it("maps each provider", () => {
    expect(agentEnv({}, { ...cfg, provider: "bedrock" }).CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(agentEnv({}, { ...cfg, provider: "vertex" }).CLAUDE_CODE_USE_VERTEX).toBe("1");
    expect(agentEnv({}, { ...cfg, baseUrl: "https://gw.test" }).ANTHROPIC_BASE_URL).toBe("https://gw.test");
    expect(agentEnv({}, { ...cfg, provider: "openai-compatible" }).PLUMBLINE_AGENT_KEY).toBe("model-key");
  });

  it("needs a base URL for openai-compatible", () => {
    expect(canRunAgent({ ...cfg, provider: "openai-compatible" }, {})).toBe(false);
    expect(canRunAgent({ ...cfg, provider: "openai-compatible", baseUrl: "https://x.test" }, {})).toBe(true);
  });

  it("runs Claude Code bare and read-only by default", () => {
    const args = claudeArgs(cfg, "prompt", "/skills", "node cli prove");
    expect(args).toContain("--bare");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    const allowed = args[args.indexOf("--allowedTools") + 1] as string;
    const denied = args[args.indexOf("--disallowedTools") + 1] as string;
    expect(allowed).not.toMatch(/Write|Edit|prove/);
    expect(allowed).not.toContain("git grep");
    expect(denied.split(",")).toEqual(expect.arrayContaining(["Write", "Edit", "WebFetch"]));
  });

  it("only allows proof writes when proof tests are on", () => {
    const args = claudeArgs({ ...cfg, proofTests: true }, "prompt", "/skills", "node cli prove");
    const allowed = args[args.indexOf("--allowedTools") + 1] as string;
    const denied = args[args.indexOf("--disallowedTools") + 1] as string;
    expect(allowed).toContain("Edit(.plumbline/proofs/**)");
    expect(allowed).toContain("Write(.plumbline/proofs/**)");
    expect(allowed).toContain("Bash(node cli prove *)");
    expect(allowed.split(",")).not.toContain("Edit");
    expect(allowed.split(",")).not.toContain("Write");
    expect(denied.split(",")).not.toContain("Edit");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  });

  it("runs Codex in a read-only sandbox by default", () => {
    const args = codexArgs({ ...cfg, provider: "openai-compatible", baseUrl: "https://x.test" }, "p", "s", "o", "/skills");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args).toContain("--ignore-rules");
    expect(args.join(" ")).not.toContain("model-key");
  });

  it("strips nulls from strict structured output", () => {
    expect(stripNulls({ a: null, b: [{ c: null, d: 1 }] })).toEqual({ b: [{ d: 1 }] });
  });
});

describe("platform clients", () => {
  it("has no approve or merge operation", () => {
    const forge = fakeForge("x");
    const gh = github({ apiUrl: "https://api.github.test", repo: "a/b", number: 1, token: "t", fetcher: forge.fetcher });
    const gl = gitlab({ apiUrl: "https://gl.test/api/v4", projectId: "1", iid: 1, token: "t", fetcher: forge.fetcher });
    for (const p of [gh, gl]) expect(Object.keys(p).sort()).toEqual(["name", "setLabel", "upsertComment"]);
  });

  it("removing an absent label is not an error", async () => {
    const forge = fakeForge("x");
    const gh = github({ apiUrl: "https://api.github.test", repo: "a/b", number: 1, token: "t", fetcher: forge.fetcher });
    await expect(gh.setLabel("plumbline:light-review", false)).resolves.toBeUndefined();
  });

  it("truncates an oversized comment", () => {
    const out = truncateComment("x".repeat(70000));
    expect(out.length).toBeLessThanOrEqual(60000);
    expect(out).toContain("truncated");
  });

  it("does not leak the token in an API error", async () => {
    const fetcher: FetchLike = async () => new Response("nope", { status: 500 });
    const gh = github({ apiUrl: "https://api.github.test", repo: "a/b", number: 1, token: "super-secret", fetcher });
    await expect(gh.setLabel("x", true)).rejects.not.toThrow(/super-secret/);
  });
});
