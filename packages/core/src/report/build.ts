import type { GateDecision, LaneDecision } from "../gate.js";
import type { MergeScore } from "../score.js";
import type { DroppedFinding, Finding, GraphDiff } from "../types.js";

export const REPORT_SCHEMA_VERSION = "1";

export interface ReportV1 {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: { name: "plumbline"; version: string };
  run: {
    id: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    model: string | null;
    mode: "deterministic" | "review";
  };
  scope: {
    label: string;
    base: string | null;
    mergeBase: string;
    head: string;
    files: number;
    additions: number;
    deletions: number;
    changedLines: number;
  };
  score: MergeScore;
  findings: Finding[];
  dropped: DroppedFinding[];
  graph: {
    added: GraphDiff["added"];
    removed: GraphDiff["removed"];
    newCycles: GraphDiff["newCycles"];
    layerCrossings: GraphDiff["layerCrossings"];
    moduleEdgesAdded: GraphDiff["moduleEdgesAdded"];
  } | null;
  lenses: { ran: string[]; skipped: { id: string; reason: string }[] };
  reviewers: { id: string; status: "complete" | "inconclusive"; model?: string }[];
  skippedRules: { id: string; reason: string }[];
  gate: GateDecision | null;
  lane: LaneDecision | null;
}

const ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      (a.file ?? "").localeCompare(b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.id.localeCompare(b.id),
  );
}
