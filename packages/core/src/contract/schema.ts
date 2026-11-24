import { z } from "zod";
import { PROOF_KINDS, SEVERITIES } from "../types.js";

const nonEmpty = z.string().trim().min(1, "must not be empty");
const globs = z.array(nonEmpty).min(1, "needs at least one glob");

const proofKinds = z.array(z.enum(PROOF_KINDS)).min(1, "needs at least one proof kind");

const forbidRule = z.strictObject({
  id: nonEmpty,
  forbid: z
    .string()
    .regex(/^\s*\S+\s*->\s*\S+\s*$/, 'must look like "from -> to", for example "billing -> users/*"'),
  because: z.string().optional(),
});

const requireRule = z.strictObject({
  id: nonEmpty,
  require: nonEmpty,
  check: z.enum(["llm", "semgrep", "custom"]).default("llm"),
  paths: globs.optional(),
  because: z.string().optional(),
  /** check: semgrep. Path to a local Semgrep config inside the repo. */
  config: nonEmpty.optional(),
  /** check: custom. Command to run. It only runs with --allow-custom-checks. */
  command: nonEmpty.optional(),
});

const rule = z.union([forbidRule, requireRule]);

const gateEntry = z.strictObject({
  branches: globs,
  min_merge_score: z.number().int().min(0).max(5),
});

const lane = z.strictObject({
  label: nonEmpty.default("plumbline:light-review"),
  when: z
    .strictObject({
      merge_score: z.number().int().min(0).max(5).default(5),
      max_severity: z.enum(SEVERITIES).default("P3"),
      max_changed_lines: z.number().int().min(0).default(200),
    })
    .prefault({}),
  never: z.array(nonEmpty).default([]),
});

export const DEFAULT_PROOF = {
  P0: ["failing_test", "graph_diff"],
  P1: ["failing_test", "graph_diff", "broken_rule"],
} as const;

export const contractSchema = z.strictObject({
  version: z.literal(1, { error: "only version: 1 is supported" }),
  extends: z.union([nonEmpty, z.array(nonEmpty)]).optional(),
  modules: z.record(nonEmpty, globs).default({}),
  layers: z.array(z.array(nonEmpty).min(1, "a layer needs at least one module")).default([]),
  rules: z.array(rule).default([]),
  proof: z
    .strictObject({
      P0: proofKinds.default([...DEFAULT_PROOF.P0]),
      P1: proofKinds.default([...DEFAULT_PROOF.P1]),
    })
    .prefault({}),
  cycles: z.strictObject({ within_module: z.enum(["P1", "P2"]).default("P2") }).prefault({}),
  gate: z.array(gateEntry).default([]),
  lanes: z.strictObject({ light: lane.prefault({}) }).prefault({}),
});

export type Contract = z.output<typeof contractSchema>;
export type ContractRule = Contract["rules"][number];
export type ForbidRule = z.output<typeof forbidRule>;
export type RequireRule = z.output<typeof requireRule>;
export type GateEntry = Contract["gate"][number];
export type LightLane = Contract["lanes"]["light"];

export function isForbidRule(r: ContractRule): r is ForbidRule {
  return "forbid" in r;
}

export function parseForbid(expr: string): { from: string; to: string } {
  const [from, to] = expr.split("->").map((s) => s.trim());
  return { from: from ?? "", to: to ?? "" };
}
