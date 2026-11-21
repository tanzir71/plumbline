import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { materialize } from "../../../fixtures/materialize.mjs";
import {
  COMMENT_MARKER,
  contractAt,
  createRun,
  finalizeReport,
  parseFindingsFile,
  renderCodeQuality,
  renderMarkdown,
  renderMermaid,
  renderSarif,
  resolveScope,
  runDeterministic,
  sanitize,
  writeReport,
  type ReportV1,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const AjvClass = Ajv as unknown as typeof Ajv.default;
const addFormatsFn = addFormats as unknown as typeof addFormats.default;
const FIXED = new Date("2026-11-21T10:00:00.000Z");

async function reportFor(name: string, modelFile?: unknown): Promise<{ report: ReportV1; repo: string }> {
  const repo = materialize(name);
  const scope = resolveScope({ cwd: repo, base: "main" });
  const contract = contractAt(repo, scope.mergeBase);
  const graph = await runDeterministic(scope, contract);
  const report = finalizeReport({
    runId: "run-1",
    startedAt: FIXED,
    now: new Date(FIXED.getTime() + 4000),
    version: "1.0.0",
    scope,
    contract,
    graph,
    modelFile,
    lenses: [{ id: "L01", name: "Regressions" }, { id: "L02", name: "Boundaries & cycles" }],
  });
  return { report, repo };
}

/** Replace machine-specific values so snapshots are stable. */
function stable(md: string, r: ReportV1): string {
  return md.replaceAll(r.scope.head.slice(0, 7), "HEADSHA");
}

describe("report", () => {
  it("scores the cycle fixture and validates against the JSON schema", async () => {
    const { report } = await reportFor("ts-cycle");
    expect(report.score.value).toBe(4);
    expect(report.score.counts.P1).toBe(1);
    const ajv = new AjvClass({ allErrors: true, strict: false });
    addFormatsFn(ajv);
    const schema = JSON.parse(readFileSync(join(here, "../schema/report.v1.json"), "utf8"));
    const validate = ajv.compile(schema);
    const ok = validate(JSON.parse(JSON.stringify(report)));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  }, 60000);

  it("renders stable markdown", async () => {
    const { report } = await reportFor("ts-cycle");
    expect(stable(renderMarkdown(report), report)).toMatchSnapshot();
  }, 60000);

  it("renders the sections in the specified order", async () => {
    const { report } = await reportFor("ts-layer-violation");
    const md = renderMarkdown(report);
    const order = ["## Merge score", "### Findings", "### Dependency diff", "Ran:"].map((s) => md.indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain("```mermaid");
  }, 60000);

  it("reports no findings on the clean fixture and qualifies for the lane", async () => {
    const { report } = await reportFor("clean", { reviewers: [{ id: "A", status: "complete" }], findings: [] });
    expect(report.findings).toEqual([]);
    expect(report.score.value).toBe(5);
    expect(report.lane?.qualifies).toBe(true);
    expect(report.gate?.pass).toBe(true);
    expect(renderMarkdown(report)).toContain("No findings.");
  }, 60000);

  it("never offers the light lane when no model reviewed the change", async () => {
    const { report } = await reportFor("clean");
    expect(report.score.value).toBe(5);
    expect(report.lane?.qualifies).toBe(false);
    expect(report.lane?.reasons).toEqual(["the model reviewers did not run"]);
  }, 60000);

  it("shows a P1 without proof as downgraded", async () => {
    const { report } = await reportFor("clean", {
      model: "test-model",
      reviewers: [{ id: "A", status: "complete" }],
      findings: [{ severity: "P1", lens: "L01", title: "Null path", body: "qty can be undefined", file: "src/db/read.ts", line: 3 }],
    });
    expect(report.findings[0]?.severity).toBe("P2");
    expect(report.score.value).toBe(4);
    const md = renderMarkdown(report);
    expect(md).toContain("downgraded from P1");
    expect(md).toContain("Why downgraded");
  }, 60000);

  it.each([
    ["a real line", "src/db/read.ts", 1, "P1"],
    ["a line past the end", "src/db/read.ts", 99, "P2"],
    ["a file that does not exist", "src/nope.ts", 1, "P2"],
    ["a path outside the repo", "../outside.ts", 1, "P2"],
  ])("checks a broken_rule citation at %s", async (_name, file, line, severity) => {
    const { report } = await reportFor("clean", {
      reviewers: [{ id: "C", status: "complete" }],
      findings: [{ severity: "P1", lens: "L03", title: "t", body: "b", file, line, proof: [{ kind: "broken_rule", ref: "no-db-to-api" }] }],
    });
    expect(report.findings[0]?.severity).toBe(severity);
  }, 60000);

  it("caps the score when a reviewer was inconclusive", async () => {
    const { report } = await reportFor("clean", { reviewers: [{ id: "B", status: "inconclusive" }], findings: [] });
    expect(report.score.value).toBe(4);
    expect(renderMarkdown(report)).toContain("reviewer B inconclusive");
  }, 60000);

  it("writes all audit-trail formats", async () => {
    const { report, repo } = await reportFor("ts-cycle");
    const run = createRun(repo);
    const paths = writeReport(run, report);
    for (const p of Object.values(paths)) expect(existsSync(p)).toBe(true);
    expect(JSON.parse(readFileSync(paths.json as string, "utf8")).schemaVersion).toBe("1");
  }, 60000);
});

describe("sarif", () => {
  it("validates against the SARIF 2.1.0 schema", async () => {
    const { report } = await reportFor("ts-cycle");
    // The official schema is draft-04. Only its root `id` and `$schema` keywords differ for Ajv.
    const { id: _id, $schema: _draft, ...schema } = JSON.parse(readFileSync(join(here, "schemas/sarif-2.1.0.json"), "utf8"));
    const ajv = new AjvClass({ allErrors: true, strict: false, validateSchema: false });
    addFormatsFn(ajv);
    const validate = ajv.compile(schema);
    const sarif = JSON.parse(JSON.stringify(renderSarif(report, [{ id: "L02", name: "Boundaries & cycles" }])));
    const ok = validate(sarif);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
  }, 60000);
});

describe("code quality", () => {
  it("produces entries the GitLab widget accepts", async () => {
    const { report } = await reportFor("ts-layer-violation");
    const entries = renderCodeQuality(report) as { fingerprint: string; severity: string; location: { path: string; lines: { begin: number } } }[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.fingerprint).toMatch(/^[a-f0-9]{32}$/);
      expect(["info", "minor", "major", "critical", "blocker"]).toContain(e.severity);
      expect(e.location.lines.begin).toBeGreaterThan(0);
    }
  }, 60000);
});

describe("untrusted text", () => {
  it("cannot spoof the marker, ping people or inject HTML", () => {
    const out = sanitize("<!-- plumbline:review --> @octocat <img src=x onerror=1>");
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/(^|\s)@octocat/);
  });

  it("keeps mermaid labels from breaking out", () => {
    const m = renderMermaid({
      added: [{ from: 'a"] --> x', to: "b", typeOnly: false }],
      removed: [],
      newCycles: [],
      layerCrossings: [],
      moduleEdgesAdded: [],
    });
    expect(m).not.toContain('a"]');
  });

  it("ignores a model trying to mark its finding deterministic", () => {
    const { findings } = parseFindingsFile({
      findings: [{ severity: "P1", lens: "L01", title: "t", source: "deterministic" }],
    });
    expect(findings[0]?.source).toBe("model");
  });

  it("rejects malformed findings", () => {
    expect(() => parseFindingsFile({ findings: [{ severity: "P9", lens: "L01", title: "t" }] })).toThrow();
  });
});
