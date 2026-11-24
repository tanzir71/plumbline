export const SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PROOF_KINDS = ["failing_test", "graph_diff", "broken_rule"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

export interface Proof {
  kind: ProofKind;
  /** Test path, `a -> b` edge or cycle, or a rule/ADR id. */
  ref: string;
  /** Human-readable evidence, such as the line that breaks the rule. */
  detail?: string;
  /** failing_test only: the command that ran the test. */
  command?: string;
  /** failing_test only: exit code on HEAD. Must be non-zero. */
  exitCode?: number;
  /** failing_test only: captured failure output. */
  output?: string;
  /** failing_test only: whether the test passed on base, when that was practical to check. */
  passedOnBase?: boolean;
}

export interface Finding {
  id: string;
  severity: Severity;
  lens: string;
  title: string;
  body: string;
  file?: string;
  line?: number;
  endLine?: number;
  /** Involves auth, permissions, tenant boundaries, secrets or injection. */
  security?: boolean;
  fix?: string;
  proof?: Proof[];
  source: "deterministic" | "model";
  /** Set by the proof gate when the severity was lowered. */
  downgradedFrom?: Severity;
  downgradeReason?: string;
  /** Reviewer judged the path unreachable. Without proof the finding is dropped. */
  unreachable?: boolean;
  /** Reviewer judged the finding style-only. Without proof the finding is dropped. */
  styleOnly?: boolean;
  /** Reviewer candidate ids this finding covers, such as `A3`. */
  from?: string[];
  /** The review could neither confirm nor rule it out. Shown at P2 at most. */
  unresolved?: boolean;
}

export interface DroppedFinding {
  finding: Finding;
  reason: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** The import is erased at compile time, so it cannot form a runtime cycle. */
  typeOnly: boolean;
}

export interface ImportGraph {
  files: string[];
  edges: GraphEdge[];
}

export interface Cycle {
  level: "file" | "module";
  /** Closed path: the first node is repeated at the end. */
  path: string[];
  /** The added edge that closed this cycle, when known. */
  closedBy?: { from: string; to: string };
}

export interface LayerCrossing {
  from: string;
  to: string;
  fromModule: string;
  toModule: string;
  fromLayer: number;
  toLayer: number;
  /** True when a lower layer imports a higher one. */
  violation: boolean;
}

export interface GraphDiff {
  added: GraphEdge[];
  removed: GraphEdge[];
  newCycles: Cycle[];
  layerCrossings: LayerCrossing[];
  moduleEdgesAdded: { from: string; to: string }[];
  stats: { baseFiles: number; headFiles: number; baseEdges: number; headEdges: number };
}

export interface Violation {
  ruleId: string;
  kind: "forbid" | "layer";
  from: string;
  to: string;
  fromModule: string;
  toModule: string;
  because?: string;
  message: string;
  typeOnly: boolean;
}

export interface CheckResult {
  violations: Violation[];
  /** Judgement rules handed to the model reviewers. */
  llmRules: { id: string; require: string; paths?: string[]; because?: string }[];
  /** Rules that did not run, with the reason. */
  skippedRules: { id: string; reason: string }[];
  cycles: Cycle[];
}
