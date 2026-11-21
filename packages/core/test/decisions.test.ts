import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adrKey,
  applyProofGate,
  computeScore,
  evaluateGate,
  evaluateLane,
  mergeFindings,
  parseContract,
  type Finding,
  type GraphDiff,
  type Severity,
} from "../src/index.js";

const f = (severity: Severity, security = false) => ({ severity, security });

describe("computeScore", () => {
  it.each([
    ["no findings", [], 5],
    ["only P3", [f("P3"), f("P3")], 5],
    ["one P2", [f("P2")], 4],
    ["many P2", [f("P2"), f("P2"), f("P2")], 4],
    ["one P1", [f("P1")], 4],
    ["two P1", [f("P1"), f("P1")], 3],
    ["three P1", [f("P1"), f("P1"), f("P1")], 2],
    ["six P1 floors at 0", Array.from({ length: 6 }, () => f("P1")), 0],
    ["P1 and P2", [f("P1"), f("P2")], 4],
    ["security P1 costs one more", [f("P1", true)], 3],
    ["two security P1", [f("P1", true), f("P1", true)], 1],
    ["security P2 costs nothing extra", [f("P2", true)], 4],
    ["any P0", [f("P0")], 0],
    ["P0 beats everything", [f("P0"), f("P3")], 0],
  ])("%s", (_name, findings, value) => {
    expect(computeScore({ findings }).value).toBe(value);
  });

  it("caps an incomplete review at 4", () => {
    const s = computeScore({ findings: [], incomplete: "reviewer B inconclusive" });
    expect(s.value).toBe(4);
    expect(s.capped).toBe(true);
    expect(s.capReason).toContain("reviewer B");
  });

  it("does not raise a lower score when capping", () => {
    expect(computeScore({ findings: [f("P1"), f("P1")], incomplete: "x" }).value).toBe(3);
  });

  it.each([
    [[], "The change appears safe to merge."],
    [[f("P1")], "Fix the P1 before merging."],
    [[f("P2")], "Safe to merge; the P2s are non-blocking."],
    [[f("P1"), f("P1")], "Fix the findings before merging."],
    [[f("P1"), f("P1"), f("P1")], "Needs rework before merging."],
    [[f("P0")], "Do not merge."],
  ])("verdict %#", (findings, verdict) => {
    expect(computeScore({ findings }).verdict).toBe(verdict);
  });
});

describe("evaluateGate", () => {
  const gate = [
    { branches: ["main", "release/*"], min_merge_score: 3 },
    { branches: ["release/critical"], min_merge_score: 5 },
  ];

  it.each([
    ["main", 3, true, true],
    ["main", 2, true, false],
    ["main", 5, true, true],
    ["release/1.2", 2, true, false],
    ["release/1.2", 4, true, true],
    ["release/critical", 4, true, false],
    ["release/critical", 5, true, true],
    ["dev", 0, false, true],
    ["release/a/b", 0, false, true],
  ])("%s at %i", (branch, score, applies, pass) => {
    const d = evaluateGate(gate, branch, score);
    expect(d.applies).toBe(applies);
    expect(d.pass).toBe(pass);
  });

  it("gives a one-line reason", () => {
    expect(evaluateGate(gate, "main", 2).reason).toBe("merge score 2/5 is below the minimum 3/5 for main");
  });

  it("passes with no gate configured", () => {
    expect(evaluateGate([], "main", 0).pass).toBe(true);
  });
});

describe("evaluateLane", () => {
  const lane = parseContract(
    'version: 1\nlanes:\n  light:\n    never: ["**/migrations/**", ".github/**", "src/billing/**"]\n',
  ).lanes.light;
  const base = { score: 5, findings: [], changedLines: 50, changedFiles: ["src/a.ts"] };

  it.each([
    ["qualifies", base, true],
    ["P3 still qualifies", { ...base, findings: [{ severity: "P3" as const }] }, true],
    ["exactly 200 lines", { ...base, changedLines: 200 }, true],
    ["score 4", { ...base, score: 4 }, false],
    ["P2 finding", { ...base, findings: [{ severity: "P2" as const }] }, false],
    ["P1 finding", { ...base, findings: [{ severity: "P1" as const }] }, false],
    ["201 lines", { ...base, changedLines: 201 }, false],
    ["migration", { ...base, changedFiles: ["db/migrations/1.sql"] }, false],
    ["workflow", { ...base, changedFiles: [".github/workflows/ci.yml"] }, false],
    ["billing", { ...base, changedFiles: ["src/billing/x.ts"] }, false],
  ])("%s", (_name, input, qualifies) => {
    const d = evaluateLane(lane, input);
    expect(d.qualifies).toBe(qualifies);
    expect(d.label).toBe("plumbline:light-review");
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it("lists every reason it failed", () => {
    expect(evaluateLane(lane, { ...base, score: 3, changedLines: 999 }).reasons).toHaveLength(2);
  });
});

describe("applyProofGate", () => {
  const contract = parseContract('version: 1\nmodules:\n  a: ["a/**"]\n  b: ["b/**"]\nrules:\n  - id: r1\n    forbid: a -> b\n');
  const diff: GraphDiff = {
    added: [{ from: "a/1.ts", to: "b/1.ts", typeOnly: false }],
    removed: [],
    newCycles: [{ level: "module", path: ["a", "b", "a"] }],
    layerCrossings: [],
    moduleEdgesAdded: [{ from: "a", to: "b" }],
    stats: { baseFiles: 0, headFiles: 0, baseEdges: 0, headEdges: 0 },
  };
  const check = { violations: [], llmRules: [], skippedRules: [], cycles: [] };
  const root = mkdtempSync(join(tmpdir(), "plumbline-proof-"));
  mkdirSync(join(root, ".plumbline/proofs"), { recursive: true });
  writeFileSync(join(root, ".plumbline/proofs/t.spec.js"), "// test");
  const ctx = { contract, diff, check, root, adrIds: new Set(["ADR-12"]) };

  const finding = (over: Partial<Finding>): Finding => ({
    id: "x",
    severity: "P1",
    lens: "L01",
    title: "t",
    body: "b",
    source: "model",
    ...over,
  });
  const gate = (over: Partial<Finding>) => applyProofGate([finding(over)], ctx);

  const goodTest = { kind: "failing_test" as const, ref: ".plumbline/proofs/t.spec.js", command: "node --test", exitCode: 1, output: "expected 0, got 1" };

  it("downgrades a P1 with no proof to P2", () => {
    const { kept } = gate({});
    expect(kept[0]?.severity).toBe("P2");
    expect(kept[0]?.downgradedFrom).toBe("P1");
  });

  it("drops an unproven finding that is also unreachable", () => {
    const { kept, dropped } = gate({ unreachable: true });
    expect(kept).toEqual([]);
    expect(dropped[0]?.reason).toContain("unreachable");
  });

  it("drops an unproven style-only finding", () => {
    expect(gate({ styleOnly: true }).dropped).toHaveLength(1);
  });

  it("keeps a P1 with a real graph edge", () => {
    expect(gate({ proof: [{ kind: "graph_diff", ref: "a/1.ts -> b/1.ts" }] }).kept[0]?.severity).toBe("P1");
  });

  it("keeps a P1 citing a real cycle", () => {
    expect(gate({ proof: [{ kind: "graph_diff", ref: "a -> b -> a" }] }).kept[0]?.severity).toBe("P1");
  });

  it("rejects an invented graph edge", () => {
    const { kept } = gate({ proof: [{ kind: "graph_diff", ref: "x -> y" }] });
    expect(kept[0]?.severity).toBe("P2");
    expect(kept[0]?.downgradeReason).toContain("not an edge");
  });

  it("keeps a P1 citing a real rule at a real line", () => {
    expect(gate({ file: "a/1.ts", line: 3, proof: [{ kind: "broken_rule", ref: "r1" }] }).kept[0]?.severity).toBe("P1");
  });

  it("requires a location for a broken rule", () => {
    expect(gate({ proof: [{ kind: "broken_rule", ref: "r1" }] }).kept[0]?.severity).toBe("P2");
  });

  it("accepts an ADR number in any spelling", () => {
    expect(adrKey("adr 012")).toBe("ADR-12");
    expect(gate({ file: "a/1.ts", line: 3, proof: [{ kind: "broken_rule", ref: "ADR-012" }] }).kept[0]?.severity).toBe("P1");
  });

  it("rejects an invented rule", () => {
    expect(gate({ file: "a/1.ts", line: 3, proof: [{ kind: "broken_rule", ref: "made-up" }] }).kept[0]?.severity).toBe("P2");
  });

  it("keeps a P1 with a failing test", () => {
    expect(gate({ proof: [goodTest] }).kept[0]?.severity).toBe("P1");
  });

  it.each([
    ["passing test", { exitCode: 0 }],
    ["no command", { command: undefined }],
    ["no output", { output: "" }],
    ["missing file", { ref: ".plumbline/proofs/nope.js" }],
    ["outside proofs", { ref: "src/x.spec.js" }],
    ["path traversal", { ref: ".plumbline/proofs/../../x.js" }],
    ["also fails on base", { passedOnBase: false }],
  ])("rejects a failing_test with %s", (_name, over) => {
    expect(gate({ proof: [{ ...goodTest, ...over }] }).kept[0]?.severity).toBe("P2");
  });

  it("holds P0 to the stricter proof list, stepping down to P1", () => {
    const { kept } = gate({ severity: "P0", file: "a/1.ts", line: 3, proof: [{ kind: "broken_rule", ref: "r1" }] });
    expect(kept[0]?.severity).toBe("P1");
    expect(kept[0]?.downgradedFrom).toBe("P0");
  });

  it("leaves P2 and P3 alone", () => {
    expect(gate({ severity: "P2" }).kept[0]?.downgradedFrom).toBeUndefined();
    expect(gate({ severity: "P3" }).kept[0]?.severity).toBe("P3");
  });

  it("merges a model finding that restates a deterministic one", () => {
    const det = finding({ id: "d", source: "deterministic", proof: [{ kind: "graph_diff", ref: "a -> b -> a" }] });
    const dup = finding({ id: "m", proof: [{ kind: "graph_diff", ref: "a  ->  b -> a" }] });
    const other = finding({ id: "o" });
    expect(mergeFindings([det], [dup, other]).map((x) => x.id)).toEqual(["d", "o"]);
  });
});
