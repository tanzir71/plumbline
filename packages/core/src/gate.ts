import picomatch from "picomatch";
import type { Contract, LightLane } from "./contract/schema.js";
import { SEVERITIES, type Finding, type Severity } from "./types.js";

export interface GateDecision {
  applies: boolean;
  pass: boolean;
  score: number;
  minScore?: number;
  branch: string;
  matched?: string;
  /** One line, suitable for a CI failure. */
  reason: string;
}

/** Pure gate decision. When several entries match a branch, the strictest minimum applies. */
export function evaluateGate(gate: Contract["gate"], baseBranch: string, score: number): GateDecision {
  let min: number | undefined;
  let matched: string | undefined;
  for (const entry of gate) {
    const hit = entry.branches.find((b) => picomatch.isMatch(baseBranch, b, { dot: true }));
    if (hit !== undefined && (min === undefined || entry.min_merge_score > min)) {
      min = entry.min_merge_score;
      matched = hit;
    }
  }
  if (min === undefined) {
    return { applies: false, pass: true, score, branch: baseBranch, reason: `no merge gate for ${baseBranch}` };
  }
  const pass = score >= min;
  return {
    applies: true,
    pass,
    score,
    minScore: min,
    branch: baseBranch,
    matched,
    reason: pass
      ? `merge score ${score}/5 meets the minimum ${min}/5 for ${baseBranch}`
      : `merge score ${score}/5 is below the minimum ${min}/5 for ${baseBranch}`,
  };
}

export interface LaneInput {
  score: number;
  findings: Pick<Finding, "severity">[];
  changedLines: number;
  changedFiles: string[];
}

export interface LaneDecision {
  qualifies: boolean;
  label: string;
  /** Why it qualified, or each reason it did not. */
  reasons: string[];
}

const rank = (s: Severity) => SEVERITIES.indexOf(s);

/** Pure lane decision. A lane only ever adds a label: it never approves, merges or requests review. */
export function evaluateLane(lane: LightLane, input: LaneInput): LaneDecision {
  const reasons: string[] = [];
  const { merge_score, max_severity, max_changed_lines } = lane.when;

  if (input.score < merge_score) reasons.push(`merge score ${input.score}/5 is below ${merge_score}/5`);

  const worst = input.findings.reduce<Severity | null>(
    (w, f) => (w === null || rank(f.severity) < rank(w) ? f.severity : w),
    null,
  );
  if (worst && rank(worst) < rank(max_severity)) reasons.push(`has a ${worst} finding (allowed up to ${max_severity})`);

  if (input.changedLines > max_changed_lines) {
    reasons.push(`${input.changedLines} changed lines is over ${max_changed_lines}`);
  }

  const risky = input.changedFiles.filter((file) => lane.never.some((g) => picomatch.isMatch(file, g, { dot: true })));
  if (risky.length > 0) reasons.push(`touches a never-path: ${risky.slice(0, 3).join(", ")}`);

  if (reasons.length > 0) return { qualifies: false, label: lane.label, reasons };
  return {
    qualifies: true,
    label: lane.label,
    reasons: [
      `merge score ${input.score}/5, no finding above ${max_severity}, ${input.changedLines} changed lines, no never-path touched`,
    ],
  };
}
