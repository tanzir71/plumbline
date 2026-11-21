import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseContract } from "@tanziro/plumbline-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { materialize } from "../../../fixtures/materialize.mjs";

const bin = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", windowsHide: true });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const T = 60000;

describe("plumbline CLI", () => {
  it("prints help and version", () => {
    expect(cli(process.cwd(), "--help").out).toContain("plumbline <command>");
    expect(cli(process.cwd(), "--version").out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("rejects an unknown command", () => {
    expect(cli(process.cwd(), "nope").code).toBe(1);
  });

  it.each(["init", "scope", "graph", "check", "prove", "report", "mcp"])("%s --help prints usage and changes nothing", (command) => {
    const repo = materialize("adr-contract");
    const r = cli(repo, command, "--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("plumbline <command>");
    expect(existsSync(join(repo, "plumbline.yml"))).toBe(false);
  }, T);

  it("check --contract validates a draft without writing plumbline.yml", () => {
    const repo = materialize("adr-contract");
    mkdirSync(join(repo, ".plumbline"), { recursive: true });
    const draft = join(repo, ".plumbline", "draft.yml");
    writeFileSync(draft, 'version: 1\nmodules:\n  billing: ["src/billing/**"]\n  db: ["src/db/**"]\nrules:\n  - id: r\n    forbid: billing -> db\n');
    const ok = cli(repo, "check", "--contract", ".plumbline/draft.yml", "--json");
    expect(ok.code).toBe(1);
    expect(JSON.parse(ok.out).violations[0].ruleId).toBe("r");
    expect(existsSync(join(repo, "plumbline.yml"))).toBe(false);

    writeFileSync(draft, "version: 1\nnope: true\n");
    const bad = cli(repo, "check", "--contract", ".plumbline/draft.yml");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("draft.yml");
    expect(cli(repo, "check", "--contract", "missing.yml").err).toContain("contract not found");
  }, T);

  it("scope reports files and starts a run", () => {
    const repo = materialize("ts-cycle");
    const r = cli(repo, "scope", "--base", "main", "--json");
    expect(r.code).toBe(0);
    const scope = JSON.parse(r.out);
    expect(scope.files.map((f: { path: string }) => f.path)).toEqual(["src/billing/plans.ts"]);
    expect(scope.contract).toBe("plumbline.yml");
    expect(existsSync(join(repo, ".plumbline/run", scope.runId, "scope.json"))).toBe(true);
  }, T);

  it("scope includes uncommitted and untracked work", () => {
    const repo = materialize("clean");
    writeFileSync(join(repo, "src/api/new.ts"), "export const x = 1;\n");
    const scope = JSON.parse(cli(repo, "scope", "--base", "main", "--json").out);
    expect(scope.mode).toBe("worktree");
    expect(scope.files.some((f: { path: string }) => f.path === "src/api/new.ts")).toBe(true);
  }, T);

  it("scope exits 2 when there is nothing to review", () => {
    const repo = materialize("clean");
    spawnSync("git", ["checkout", "-q", "main"], { cwd: repo });
    const r = cli(repo, "scope", "--base", "main");
    expect(r.code).toBe(2);
    expect(r.out).toContain("NOTHING TO REVIEW");
  }, T);

  it("run output never dirties git status", () => {
    const repo = materialize("clean");
    cli(repo, "scope", "--base", "main");
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout).toBe("");
  }, T);

  it("graph reports the cycle in JSON and in text", () => {
    const repo = materialize("ts-cycle");
    const json = JSON.parse(cli(repo, "graph", "--base", "main", "--json").out);
    expect(json.diff.newCycles[0].path).toEqual(["src/billing/plans.ts", "src/users/session/index.ts", "src/billing/plans.ts"]);
    expect(cli(repo, "graph", "--base", "main").out).toContain("New cycles (2)");
  }, T);

  it("check exits 1 on a violation and 0 when clean", () => {
    const bad = materialize("ts-layer-violation");
    const r = cli(bad, "check", "--json");
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).violations.map((v: { ruleId: string }) => v.ruleId)).toContain("no-db-to-api");
    expect(cli(materialize("clean"), "check").code).toBe(0);
  }, T);

  it("reports a line-accurate contract error", () => {
    const repo = materialize("clean");
    writeFileSync(join(repo, "plumbline.yml"), "version: 1\ngate:\n  - branches: [main]\n    min_merge_score: 9\n");
    const r = cli(repo, "check");
    expect(r.code).toBe(1);
    expect(r.err).toContain("plumbline.yml:4");
  }, T);

  it("report --gate fails below the minimum", () => {
    const repo = materialize("ts-layer-violation");
    writeFileSync(
      join(repo, "plumbline.yml"),
      `${readFileSync(join(repo, "plumbline.yml"), "utf8")}gate:\n  - branches: ["main"]\n    min_merge_score: 5\n`,
    );
    spawnSync("git", ["commit", "-qam", "gate"], { cwd: repo });
    const r = cli(repo, "report", "--base", "main", "--gate");
    expect(r.code).toBe(1);
    expect(r.err).toContain("is below the minimum 5/5 for main");
  }, T);

  it("report --gate passes on a clean change and writes the audit trail", () => {
    const repo = materialize("clean");
    const r = cli(repo, "report", "--base", "main", "--gate", "--json");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.score.value).toBe(5);
    const dir = join(repo, ".plumbline/run", report.run.id);
    for (const f of ["report.md", "report.json", "report.sarif", "gl-code-quality-report.json"]) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
  }, T);

  it("init writes a valid contract from the folders and refuses to overwrite", () => {
    const repo = materialize("adr-contract");
    const r = cli(repo, "init", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).modules.sort()).toEqual(["api", "billing", "db", "orgs"]);
    expect(() => parseContract(readFileSync(join(repo, "plumbline.yml"), "utf8"))).not.toThrow();
    expect(cli(repo, "init").code).toBe(1);
    expect(cli(repo, "init", "--force").code).toBe(0);
  }, T);

  it("a seeded tenancy finding survives only with a recorded failing test", () => {
    const repo = materialize("tenancy-missing-scope");
    cli(repo, "scope", "--base", "main");
    const runId = readFileSync(join(repo, ".plumbline/run/latest"), "utf8").trim();
    const proofDir = join(repo, ".plumbline/proofs");
    mkdirSync(proofDir, { recursive: true });
    const test = join(proofDir, "tenant.test.js");
    writeFileSync(
      test,
      `import assert from "node:assert/strict";
import { test } from "node:test";
import { listAll } from "../../src/repo/invoices.js";
test("listAll stays inside the org", () => assert.equal(listAll({ orgId: "a" }).length, 1));
`,
    );
    const findings = {
      model: "test",
      reviewers: [{ id: "C", status: "complete" }],
      findings: [
        {
          severity: "P1",
          lens: "L03",
          title: "listAll reads across tenants",
          body: "listAll skips the org_id filter.",
          file: "src/repo/invoices.js",
          line: 11,
          security: true,
          proof: [{ kind: "failing_test", ref: ".plumbline/proofs/tenant.test.js", command: "fake", exitCode: 1, output: "fake" }],
        },
      ],
    };
    writeFileSync(join(repo, ".plumbline/run", runId, "findings.json"), JSON.stringify(findings));

    // The model claims the test failed, but nothing recorded it.
    let report = JSON.parse(cli(repo, "report", "--json").out);
    expect(report.findings[0].severity).toBe("P2");
    expect(report.findings[0].downgradeReason).toContain("not recorded");

    const proved = cli(repo, "prove", ".plumbline/proofs/tenant.test.js", "--json", "--", process.execPath, "--test", ".plumbline/proofs/tenant.test.js");
    expect(proved.code).toBe(0);
    expect(JSON.parse(proved.out).exitCode).not.toBe(0);

    report = JSON.parse(cli(repo, "report", "--json").out);
    expect(report.findings[0].severity).toBe("P1");
    expect(report.score.value).toBe(3);
  }, T);

  it("prove and check --contract work when the repo is reached through a link", () => {
    const repo = materialize("clean");
    const link = join(mkdtempSync(join(tmpdir(), "plumbline-link-")), "linked");
    symlinkSync(repo, link, "junction");

    mkdirSync(join(repo, ".plumbline/proofs"), { recursive: true });
    writeFileSync(join(repo, ".plumbline/proofs/x.test.js"), 'import { test } from "node:test";\ntest("fails", () => { throw new Error("boom"); });\n');
    const proved = cli(link, "prove", ".plumbline/proofs/x.test.js", "--json", "--", process.execPath, "--test", ".plumbline/proofs/x.test.js");
    expect(proved.err).toBe("");
    expect(proved.code).toBe(0);
    expect(JSON.parse(proved.out).ref).toBe(".plumbline/proofs/x.test.js");
    expect(JSON.parse(proved.out).exitCode).not.toBe(0);

    writeFileSync(join(repo, ".plumbline/shared.yml"), 'version: 1\nmodules:\n  api: ["src/api/**"]\n');
    writeFileSync(join(repo, ".plumbline/draft.yml"), "version: 1\nextends: ./shared.yml\n");
    expect(cli(link, "check", "--contract", ".plumbline/draft.yml").code).toBe(0);
  }, T);

  it("prove refuses a test outside the proofs folder", () => {
    const repo = materialize("clean");
    expect(cli(repo, "prove", "src/api/index.ts", "--", "node", "-v").code).toBe(1);
  }, T);
});

describe("plumbline mcp", () => {
  let client: Client;
  let repo: string;

  beforeAll(async () => {
    repo = materialize("ts-cycle");
    client = new Client({ name: "plumbline-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin, "mcp"], cwd: repo }));
  }, T);

  afterAll(async () => {
    await client.close();
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBeFalsy();
    return r.content;
  };

  it("exposes exactly the specified tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_contract", "graph_diff", "list_lenses", "render_report", "scope"]);
  });

  it("scope", async () => {
    const [c] = await call("scope", { base: "main" });
    expect(JSON.parse(c?.text ?? "").files).toHaveLength(1);
  }, T);

  it("graph_diff", async () => {
    const [c] = await call("graph_diff", { base: "main" });
    expect(JSON.parse(c?.text ?? "").diff.newCycles.length).toBeGreaterThan(0);
  }, T);

  it("check_contract", async () => {
    const [c] = await call("check_contract");
    expect(JSON.parse(c?.text ?? "").hasContract).toBe(true);
  }, T);

  it("list_lenses returns all eight", async () => {
    const [c] = await call("list_lenses");
    expect(JSON.parse(c?.text ?? "").map((l: { id: string }) => l.id)).toEqual(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08"]);
  }, T);

  it("render_report", async () => {
    const content = await call("render_report", { base: "main" });
    expect(content[0]?.text).toContain("## Merge score: 4/5");
  }, T);
});
