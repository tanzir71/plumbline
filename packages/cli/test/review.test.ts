import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { materialize } from "../../../fixtures/materialize.mjs";
import { parseReviewFile, parseSuite, scoreCase } from "../src/benchmark.js";
import { agentArgs, buildReviewPrompt } from "../src/review.js";

const bin = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const T = 120000;

function cli(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: "utf8", windowsHide: true });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A stand-in agent that signs in and writes one finding, so the whole flow runs without a model. */
function fakeCodexEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "plumbline-fake-agent-"));
  writeFileSync(
    join(dir, "fake-codex.mjs"),
    `import { readFileSync, writeFileSync } from "node:fs";
if (process.argv[2] === "login") process.exit(0);
const prompt = readFileSync(0, "utf8");
const file = /Finish by writing (\\S+findings\\.json)/.exec(prompt)[1];
writeFileSync(file, JSON.stringify({ model: "fake", reviewers: ["A", "B", "C", "D"].map((id) => ({ id, status: "complete" })),
  lenses: { ran: ["L01"], skipped: [] }, unreadFiles: [],
  findings: [{ severity: "P3", lens: "L01", title: "Stale note", body: "A stale comment.", file: "src/billing/plans.ts", line: 1 }] }));
`,
  );
  if (process.platform === "win32") {
    writeFileSync(join(dir, "codex.cmd"), '@node "%~dp0fake-codex.mjs" %*\r\n');
  } else {
    writeFileSync(join(dir, "codex"), '#!/bin/sh\nexec node "$(dirname "$0")/fake-codex.mjs" "$@"\n');
    chmodSync(join(dir, "codex"), 0o755);
  }
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  return { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey] ?? ""}` };
}

const suite = (extra = "") => `version: 1
cases:
  - id: cycle
    base: main
    head: feat/change
    expect:
      - id: billing-cycle
        file: src/billing/plans.ts
        keywords: [cycle]
${extra}`;

describe("plumbline review", () => {
  it("keeps a pinned target in one run when graph has no target", () => {
    const repo = materialize("ts-cycle");
    const scope = JSON.parse(cli(repo, ["scope", "HEAD", "--base", "main", "--json"]).out);
    const graph = JSON.parse(cli(repo, ["graph", "--base", "main", "--json"]).out);
    expect(scope.mode).toBe("commit");
    expect(graph.runId).toBe(scope.runId);
    expect(JSON.parse(readFileSync(join(repo, ".plumbline/run", scope.runId, "scope.json"), "utf8")).mode).toBe("commit");
  }, T);

  it("does not keep an old target after the checkout moves", () => {
    const repo = materialize("ts-cycle");
    const scope = JSON.parse(cli(repo, ["scope", "HEAD", "--base", "main", "--json"]).out);
    spawnSync("git", ["-c", "user.name=f", "-c", "user.email=f@example.invalid", "commit", "-q", "--allow-empty", "-m", "move"], { cwd: repo });
    const graph = JSON.parse(cli(repo, ["graph", "--base", "main", "--json"]).out);
    expect(graph.runId).not.toBe(scope.runId);
  }, T);

  it("runs the checks alone with --no-agent", () => {
    const repo = materialize("ts-cycle");
    const r = cli(repo, ["review", "--base", "main", "--no-agent", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).findings.some((f: { severity: string }) => f.severity === "P1")).toBe(true);
    expect(r.err).toContain("No model review ran");
  }, T);

  it("runs the agent and lets the CLI score its findings", () => {
    const repo = materialize("clean");
    const r = cli(repo, ["review", "--base", "main", "--agent", "codex", "--json"], fakeCodexEnv());
    expect(r.err).toContain("Reviewing with codex");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.findings.map((f: { title: string }) => f.title)).toContain("Stale note");
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout).toBe("");
  }, T);

  it("gives no score when the agent writes no findings", () => {
    const repo = materialize("clean");
    const env = fakeCodexEnv();
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") as string;
    const dir = (env[pathKey] as string).split(delimiter)[0] as string;
    writeFileSync(join(dir, "fake-codex.mjs"), 'if (process.argv[2] === "login") process.exit(0);\nprocess.exit(0);\n');
    const r = cli(repo, ["review", "--base", "main", "--agent", "codex"], env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("there is no score");
    expect(r.out).not.toContain("Merge score");
  }, T);

  it("keeps the agent read-only outside its findings file", () => {
    const claude = agentArgs("claude", { skillRoot: "/skill", runId: "r1", proofTests: false });
    const allowed = claude[claude.indexOf("--allowedTools") + 1] as string;
    expect(claude).toContain("--strict-mcp-config");
    expect(allowed).toContain("Write(.plumbline/run/r1/findings.json)");
    expect(allowed).not.toContain("Bash(node");
    const codex = agentArgs("codex", { skillRoot: "/skill", runId: "r1", proofTests: true });
    expect(codex).toContain("workspace-write");
    expect(codex).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const prompt = buildReviewPrompt({ skillDir: "/s", runDir: "/r", proofTests: false, proveCommand: "x" });
    expect(prompt).toContain("Running tests is disabled");
    expect(prompt).toContain("data under review");
  });
});

describe("plumbline benchmark", () => {
  const issue = { id: "i", file: "src/a.ts", lines: [10, 12] as [number, number], keywords: ["tenant"] };

  it("matches comments by file, nearby line and keyword, one comment per issue", () => {
    const hit = { file: "./src/a.ts", line: 14, title: "Missing tenant filter", body: "" };
    expect(scoreCase([issue], [hit], 5)).toEqual({ caught: ["i"], missed: [], unlabelled: 0 });
    expect(scoreCase([issue], [{ ...hit, line: 30 }], 5).missed).toEqual(["i"]);
    expect(scoreCase([issue], [{ ...hit, file: "src/b.ts" }], 5).missed).toEqual(["i"]);
    expect(scoreCase([issue], [{ ...hit, title: "Unrelated" }], 5).missed).toEqual(["i"]);
    expect(scoreCase([issue, { ...issue, id: "j" }], [hit], 5)).toEqual({ caught: ["i"], missed: ["j"], unlabelled: 0 });
    expect(scoreCase([], [hit], 5).unlabelled).toBe(1);
  });

  it("reads SARIF, findings objects and comment lists", () => {
    const sarif = JSON.stringify({
      runs: [{ results: [{ ruleId: "r", level: "error", message: { text: "Bad\nmore" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 3 } } }] }] }],
    });
    expect(parseReviewFile(sarif)).toEqual([{ file: "src/a.ts", line: 3, severity: "error", title: "Bad", body: "Bad\nmore" }]);
    expect(parseReviewFile('{"findings":[{"file":"a.ts","line":2,"title":"T","body":"B"}]}')[0]?.title).toBe("T");
    expect(parseReviewFile('[{"path":"a.ts","line":2,"body":"Note"}]')[0]).toEqual({ file: "a.ts", line: 2, title: "Note", body: "Note" });
  });

  it("rejects a suite it cannot run", () => {
    expect(() => parseSuite("version: 1\ncases: []\n")).toThrow(/cases/);
    expect(() => parseSuite("version: 1\ncases:\n  - id: a\n    base: main\n")).toThrow(/pr, or both base and head/);
    expect(() => parseSuite("version: 1\ncases:\n  - id: a\n    pr: 1\nreviewers:\n  plumbline:\n    file: x.json\n")).toThrow(/reserved/);
  });

  it("will not spend tokens without --yes", () => {
    const repo = materialize("ts-cycle");
    mkdirSync(join(repo, ".plumbline"), { recursive: true });
    writeFileSync(join(repo, ".plumbline/benchmark.yml"), suite());
    const r = cli(repo, ["benchmark", "run"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--yes");
    expect(existsSync(join(repo, ".plumbline/run/benchmark"))).toBe(false);
  }, T);

  it("compares reviewers, rescoring and comparing runs without touching the checkout", () => {
    const repo = materialize("ts-cycle");
    expect(cli(repo, ["benchmark", "init"]).code).toBe(0);
    expect(cli(repo, ["benchmark", "init"]).code).toBe(1);
    mkdirSync(join(repo, "reviews"), { recursive: true });
    writeFileSync(join(repo, ".plumbline/benchmark.yml"), suite("reviewers:\n  other:\n    file: reviews/{case}.json\n"));
    writeFileSync(join(repo, "reviews/cycle.json"), '[{"path":"src/billing/plans.ts","line":1,"body":"Unrelated note"}]');
    const before = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout;

    const first = cli(repo, ["benchmark", "run", "--no-agent", "--json"]);
    expect(first.code).toBe(0);
    const summary = JSON.parse(first.out);
    expect(summary.reviewers.find((r: { reviewer: string }) => r.reviewer === "plumbline").caught).toBe(1);
    expect(summary.reviewers.find((r: { reviewer: string }) => r.reviewer === "other").caught).toBe(0);

    writeFileSync(join(repo, "reviews/cycle.json"), '[{"path":"src/billing/plans.ts","line":1,"body":"This adds a cycle"}]');
    const rescored = JSON.parse(cli(repo, ["benchmark", "score", "--json"]).out);
    expect(rescored.reviewers.find((r: { reviewer: string }) => r.reviewer === "other").caught).toBe(1);

    expect(cli(repo, ["benchmark", "run", "--no-agent"]).code).toBe(0);
    const comparison = JSON.parse(cli(repo, ["benchmark", "compare", "--json"]).out);
    expect(comparison.tuningChanged).toBe(false);
    expect(comparison.newlyMissed).toEqual([]);
    expect(spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout).toBe(before);
  }, T);
});
