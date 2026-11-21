import type { Finding, Severity } from "./types.js";

export interface ScoreInput {
  findings: Pick<Finding, "severity" | "security">[];
  /** Set when a reviewer was inconclusive or files were left unread. Caps the score at 4. */
  incomplete?: string;
}

export interface MergeScore {
  value: number;
  max: 5;
  verdict: string;
  counts: Record<Severity, number>;
  capped: boolean;
  capReason?: string;
}

function verdictFor(value: number, counts: Record<Severity, number>, capped: boolean): string {
  if (value === 5) return "The change appears safe to merge.";
  if (value === 4) {
    if (counts.P1 > 0) return "Fix the P1 before merging.";
    if (counts.P2 > 0) return "Safe to merge; the P2s are non-blocking.";
    return capped ? "The review was incomplete. Check what was skipped before merging." : "Safe to merge.";
  }
  if (value === 3) return "Fix the findings before merging.";
  if (value === 2) return "Needs rework before merging.";
  return "Do not merge.";
}

/**
 * Merge score. These rules are kept from the upstream skill:
 * any P0 is 0; otherwise 5 minus the P1 count, with each security P1 costing one more;
 * no P1 but a P2 is 4; nothing above P3 is 5; an incomplete review caps at 4.
 */
export function computeScore({ findings, incomplete }: ScoreInput): MergeScore {
  const counts: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) counts[f.severity]++;

  let value: number;
  if (counts.P0 > 0) {
    value = 0;
  } else if (counts.P1 > 0) {
    const securityP1 = findings.filter((f) => f.severity === "P1" && f.security).length;
    value = Math.max(0, 5 - counts.P1 - securityP1);
  } else if (counts.P2 > 0) {
    value = 4;
  } else {
    value = 5;
  }

  const capped = Boolean(incomplete) && value > 4;
  if (capped) value = 4;

  return {
    value,
    max: 5,
    verdict: verdictFor(value, counts, capped),
    counts,
    capped,
    ...(incomplete ? { capReason: incomplete } : {}),
  };
}

export function formatCounts(counts: Record<Severity, number>): string {
  const parts = [`${counts.P1} P1`, `${counts.P2} P2`];
  if (counts.P0 > 0) parts.unshift(`${counts.P0} P0`);
  if (counts.P3 > 0) parts.push(`${counts.P3} P3`);
  return parts.join(" · ");
}
