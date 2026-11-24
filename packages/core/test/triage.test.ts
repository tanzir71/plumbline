import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capUnresolved,
  loadCandidates,
  parseReviewerReport,
  reviewOrder,
  triageCandidates,
  unreadFromReports,
  type Candidate,
  type Finding,
} from "../src/index.js";

const REPORT = `MODEL: test

CANDIDATE A1
lens: L04
priority: P1
security: no
confidence: medium
location: src/save.ts:10-14
title: Saves can land out of order
trigger: Reopen the drawer and save twice quickly
impact: The older save overwrites the newer one
evidence: no request sequencing
rule: none
proof: none
fix: Ignore stale responses

CANDIDATE A2
lens: L01
priority: P2
security: yes
location: src/parse.ts:3
title: Partial year read as annual
trigger: A label like 9M 2024
impact: Coverage is overstated

CHECKED:
- traced callers
COVERAGE: not read: src/big.ts (budget), docs/notes.md
`;

let shared: { root: string; head: string; base: string } | undefined;
const repo = () => (shared ??= makeRepo());

function makeRepo(): { root: string; head: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), "plumbline-triage-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Plumbline Fixture");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "old.ts"), "export const a = 1;\nexport const b = 2;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "src", "save.ts"), `${"// line\n".repeat(20)}`);
  git("add", "-A");
  git("commit", "-q", "-m", "head");
  return { root, head: git("rev-parse", "HEAD"), base };
}

const finding = (over: Partial<Finding>): Finding => ({ id: "f", severity: "P2", lens: "L01", title: "t", body: "", source: "model", ...over });

describe("reviewer reports", () => {
  it("parses candidates and coverage", () => {
    const r = parseReviewerReport("A", REPORT);
    expect(r.candidates.map((c) => [c.id, c.severity, c.file, c.line, c.endLine])).toEqual([
      ["A1", "P1", "src/save.ts", 10, 14],
      ["A2", "P2", "src/parse.ts", 3, undefined],
    ]);
    expect(r.candidates[1]?.security).toBe(true);
    expect(r.candidates[0]?.body).toContain("Trigger: Reopen the drawer");
    expect(r.coverage).toEqual({ all: false, notRead: "src/big.ts (budget), docs/notes.md" });
  });

  it("counts a file as unread only when every report skipped it", () => {
    const a = parseReviewerReport("A", REPORT);
    const b = parseReviewerReport("B", "COVERAGE: not read: src/big.ts\n");
    const c = parseReviewerReport("C", "no coverage line\n");
    expect(unreadFromReports([a, b, c], ["src/big.ts", "docs/notes.md", "src/save.ts", "big.ts"])).toEqual(["src/big.ts"]);
    expect(unreadFromReports([a, parseReviewerReport("G1", "COVERAGE: all 3 files read\n")], ["src/big.ts"])).toEqual([]);
    expect(unreadFromReports([c], ["src/big.ts"])).toBeNull();
  });

  it("loads reports and panel candidates from a run directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "plumbline-run-"));
    expect(loadCandidates(dir)).toBeNull();
    mkdirSync(join(dir, "reviewers"));
    writeFileSync(join(dir, "reviewers", "A.md"), REPORT);
    mkdirSync(join(dir, "panel"));
    writeFileSync(join(dir, "panel", "candidates.json"), JSON.stringify({ candidates: [{ id: "C1", severity: "P1", lens: "L01", title: "x", body: "y", file: "src/a.ts", line: 2 }] }));
    expect(loadCandidates(dir)?.candidates.map((c) => c.id)).toEqual(["A1", "A2", "C1"]);
  });
});

describe("candidate triage", () => {
  const candidates = parseReviewerReport("A", REPORT).candidates;

  it("keeps a candidate dismissed only because its impact is unclear, at P2", () => {
    const { root, head, base } = repo();
    const { restored, summary } = triageCandidates(candidates, [], [{ candidate: "A1", reason: "impact unclear", evidence: "no timing data" }], { root, headSha: head, mergeBase: base });
    expect(summary).toEqual({ candidates: 2, merged: 0, dismissed: 0, restored: 2 });
    const a1 = restored.find((f) => f.from?.[0] === "A1");
    expect(a1?.severity).toBe("P2");
    expect(a1?.downgradedFrom).toBe("P1");
    expect(a1?.unresolved).toBe(true);
    expect(a1?.downgradeReason).toContain("not a reason that rules a defect out");
  }, 60000);

  it("accepts a dismissal that cites real code, and refuses one that cites a missing line", () => {
    const { root, head, base } = repo();
    const ctx = { root, headSha: head, mergeBase: base };
    const ok = triageCandidates([candidates[0] as Candidate], [], [{ candidate: "A1", reason: "guarded", evidence: "requests are sequenced", file: "src/save.ts", line: 12 }], ctx);
    expect(ok.summary.dismissed).toBe(1);
    expect(ok.restored).toEqual([]);
    const far = triageCandidates([candidates[0] as Candidate], [], [{ candidate: "A1", reason: "guarded", evidence: "x", file: "src/save.ts", line: 99 }], ctx);
    expect(far.restored[0]?.downgradeReason).toContain("which has 20 lines");
    const noCite = triageCandidates([candidates[0] as Candidate], [], [{ candidate: "A1", reason: "not_reachable", evidence: "no caller" }], ctx);
    expect(noCite.restored).toHaveLength(1);
    const before = triageCandidates([candidates[0] as Candidate], [], [{ candidate: "A1", reason: "pre_existing", evidence: "same at base", file: "src/old.ts", line: 2 }], ctx);
    expect(before.summary.dismissed).toBe(1);
    const style = triageCandidates([candidates[1] as Candidate], [], [{ candidate: "A2", reason: "style", evidence: "naming only" }], ctx);
    expect(style.summary.dismissed).toBe(1);
  }, 60000);

  it("counts a candidate as handled when a finding lists it or clearly covers it", () => {
    const { root, head, base } = repo();
    const ctx = { root, headSha: head, mergeBase: base };
    const listed = triageCandidates(candidates, [finding({ from: ["a1", "A2"] })], [], ctx);
    expect(listed.summary).toEqual({ candidates: 2, merged: 2, dismissed: 0, restored: 0 });
    const covered = triageCandidates(candidates, [finding({ file: "src/save.ts", line: 11, title: "Saves land out of order", body: "older save overwrites the newer one" })], [], ctx);
    expect(covered.summary.merged).toBe(1);
    expect(covered.restored.map((f) => f.from?.[0])).toEqual(["A2"]);
    // Once the review lists candidates in `from`, a nearby finding no longer stands in for an unlisted one.
    const strict = triageCandidates(candidates, [finding({ file: "src/save.ts", line: 11, from: ["A2"] })], [], ctx);
    expect(strict.restored.map((f) => f.from?.[0])).toEqual(["A1"]);
  }, 60000);

  it("caps a finding the review marked unresolved at P2", () => {
    const capped = capUnresolved(finding({ severity: "P1", unresolved: true }));
    expect(capped.severity).toBe("P2");
    expect(capped.downgradedFrom).toBe("P1");
    expect(capUnresolved(finding({ severity: "P1" })).severity).toBe("P1");
  });
});

describe("review order", () => {
  it("puts source first, then config, tests and docs, then the largest change", () => {
    const f = (path: string, additions: number) => ({ status: "M", path, additions, deletions: 0 });
    const order = reviewOrder([f("README.md", 500), f("src/a.test.ts", 300), f("config.yml", 50), f("src/small.ts", 5), f("src/big.ts", 90)]);
    expect(order).toEqual(["src/big.ts", "src/small.ts", "config.yml", "src/a.test.ts", "README.md"]);
  });
});
