import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { checkContract, deterministicFindings, type CheckOptions } from "./checks.js";
import { emptyContract, loadContract, parseContract, CONTRACT_FILE } from "./contract/parse.js";
import type { Contract } from "./contract/schema.js";
import { evaluateGate, evaluateLane, type LaneDecision } from "./gate.js";
import { git, showFile } from "./git.js";
import { buildGraphAtRef, buildGraphIsolated } from "./graph/build.js";
import { applyRenames, diffGraphs } from "./graph/diff.js";
import { adrKey, applyProofGate, mergeFindings, type RecordedProof } from "./proof.js";
import { REPORT_SCHEMA_VERSION, sortFindings, type ReportV1 } from "./report/build.js";
import { renderMarkdown } from "./report/markdown.js";
import { renderCodeQuality, renderSarif, type LensInfo } from "./report/sarif.js";
import { computeScore } from "./score.js";
import type { ScopeResult } from "./scope.js";
import { PROOF_KINDS, SEVERITIES, type CheckResult, type Finding, type GraphDiff, type ImportGraph } from "./types.js";
import type { RunDir } from "./run.js";
import { capUnresolved, triageCandidates, unreadFromReports, type Candidate, type ReviewerReport, type TriageSummary } from "./triage.js";

export interface GraphRun {
  base: ImportGraph;
  head: ImportGraph;
  diff: GraphDiff;
  check: CheckResult;
}

/**
 * The contract that governs a review. In CI this is read from the base commit,
 * so a PR cannot relax the rules, gate or lanes that judge it.
 */
export function contractAt(root: string, ref: string | null): Contract {
  if (ref) {
    const text = showFile(root, ref, CONTRACT_FILE);
    if (text === null) return emptyContract();
    const parsed = parseContract(text, `${CONTRACT_FILE}@${ref.slice(0, 7)}`);
    if (!parsed.extends) return parsed;
    // Resolve `extends` against the same commit by exporting only the contract files it names.
    const dir = mkdtempSync(join(tmpdir(), "plumbline-contract-"));
    try {
      const files = git(root, ["ls-tree", "-r", "--name-only", "--full-tree", ref])
        .split("\n")
        .filter((f) => /\.ya?ml$/.test(f));
      for (const file of files) {
        const body = showFile(root, ref, file);
        if (body === null) continue;
        const target = join(dir, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
      }
      return loadContract(dir) ?? emptyContract();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return loadContract(root) ?? emptyContract();
}

/** The deterministic pass: graphs at base and HEAD, their diff, and the contract's rules. No model. */
export async function runDeterministic(
  scope: Pick<ScopeResult, "repo" | "mergeBase" | "headSha" | "mode" | "renames">,
  contract: Contract,
  options: CheckOptions = {},
): Promise<GraphRun> {
  const root = scope.repo;
  const [baseRaw, head] = await Promise.all([
    buildGraphAtRef(root, scope.mergeBase),
    // Only uncommitted work needs the live tree. Committed scopes compare two exports built the same way.
    scope.mode === "worktree" ? buildGraphIsolated(root) : buildGraphAtRef(root, scope.headSha),
  ]);
  const base = applyRenames(baseRaw, new Map(Object.entries(scope.renames)));
  const diff = diffGraphs(base, head, contract);
  const check = checkContract(head, contract, { root, ...options });
  return { base, head, diff, check };
}

const proofInput = z.object({
  kind: z.enum(PROOF_KINDS),
  ref: z.string().min(1),
  detail: z.string().optional(),
  command: z.string().optional(),
  exitCode: z.number().int().optional(),
  output: z.string().optional(),
  passedOnBase: z.boolean().optional(),
});

const findingInput = z.object({
  id: z.string().min(1).optional(),
  severity: z.enum(SEVERITIES),
  lens: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default(""),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  security: z.boolean().optional(),
  fix: z.string().optional(),
  proof: z.array(proofInput).optional(),
  unreachable: z.boolean().optional(),
  styleOnly: z.boolean().optional(),
  from: z.array(z.string().min(1)).optional(),
  unresolved: z.boolean().optional(),
});

const dismissalInput = z.object({
  candidate: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.string().default(""),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});

export const findingsFileSchema = z.object({
  model: z.string().nullable().optional(),
  reviewers: z
    .array(z.object({ id: z.string(), status: z.enum(["complete", "inconclusive"]), model: z.string().optional() }))
    .default([]),
  lenses: z
    .object({
      ran: z.array(z.string()).default([]),
      skipped: z.array(z.object({ id: z.string(), reason: z.string() })).default([]),
    })
    .prefault({}),
  unreadFiles: z.array(z.string()).default([]),
  findings: z.array(findingInput).default([]),
  dismissed: z.array(dismissalInput).default([]),
});

export type FindingsFile = z.output<typeof findingsFileSchema>;

/** Validate the model's findings. Fields only the core may set, such as `source`, cannot be supplied. */
export function parseFindingsFile(value: unknown): { meta: Omit<FindingsFile, "findings">; findings: Finding[] } {
  const { findings, ...meta } = findingsFileSchema.parse(value);
  return {
    meta,
    findings: findings.map((f, i) => ({ ...f, id: f.id ?? `model-${i + 1}`, source: "model" as const })),
  };
}

export function collectAdrIds(scope: Pick<ScopeResult, "adrs">): Set<string> {
  const ids = new Set<string>();
  for (const path of scope.adrs) {
    const name = path.split("/").pop() ?? "";
    const m = /^(?:adr[-_ ]?)?(\d+)/i.exec(name);
    const key = m ? adrKey(`ADR-${m[1]}`) : null;
    if (key) ids.add(key);
  }
  return ids;
}

export interface FinalizeInput {
  runId: string;
  startedAt: Date;
  version: string;
  scope: ScopeResult;
  contract: Contract;
  graph: GraphRun | null;
  modelFile?: unknown;
  /** Test runs captured by `plumbline prove`. The only accepted evidence for failing_test. */
  recordedProofs?: RecordedProof[];
  baseBranch?: string;
  /** Set false to skip the merge gate decision. */
  useGate?: boolean;
  /** Set false to skip the risk lane decision. */
  useLane?: boolean;
  lenses?: LensInfo[];
  /** Reviewer reports and panel candidates saved in the run, from `loadCandidates`. */
  candidates?: { candidates: Candidate[]; reports: ReviewerReport[] } | null;
  now?: Date;
}

/** Merge findings, apply the proof gate, then score and decide gate and lane. */
export function finalizeReport(input: FinalizeInput): ReportV1 {
  const { scope, contract, graph } = input;
  const parsed = input.modelFile === undefined ? null : parseFindingsFile(input.modelFile);
  const deterministic = graph ? deterministicFindings(graph.diff, graph.check, contract) : [];
  const modelFindings = (parsed?.findings ?? []).map(capUnresolved);
  let triage: TriageSummary | null = null;
  if (parsed && input.candidates) {
    const ctx = { root: scope.repo, headSha: scope.headSha, mergeBase: scope.mergeBase };
    const result = triageCandidates(input.candidates.candidates, modelFindings, parsed.meta.dismissed, ctx);
    modelFindings.push(...result.restored);
    triage = result.summary;
  }
  const allFindings = mergeFindings(deterministic, modelFindings);

  // A lens the team turned off reports nothing, whether its findings came from the graph or a model.
  const disabled = new Set((input.lenses ?? []).filter((l) => l.default === "off").map((l) => l.id));
  const merged = allFindings.filter((f) => !disabled.has(f.lens));
  const disabledDrops = allFindings
    .filter((f) => disabled.has(f.lens))
    .map((finding) => ({ finding, reason: `lens ${finding.lens} is disabled` }));

  const emptyDiff: GraphDiff = {
    added: [],
    removed: [],
    newCycles: [],
    layerCrossings: [],
    moduleEdgesAdded: [],
    stats: { baseFiles: 0, headFiles: 0, baseEdges: 0, headEdges: 0 },
  };
  const { kept, dropped: proofDrops } = applyProofGate(merged, {
    contract,
    diff: graph?.diff ?? emptyDiff,
    check: graph?.check ?? { violations: [], llmRules: [], skippedRules: [], cycles: [] },
    root: scope.repo,
    adrIds: collectAdrIds(scope),
    recordedProofs: input.recordedProofs ?? [],
    headSha: scope.headSha,
  });
  const dropped = [...proofDrops, ...disabledDrops];
  const findings = sortFindings(kept);

  const reasons: string[] = [];
  const inconclusive = parsed?.meta.reviewers.filter((r) => r.status === "inconclusive").map((r) => r.id) ?? [];
  if (inconclusive.length > 0) reasons.push(`reviewer ${inconclusive.join(", ")} inconclusive`);
  // A file every reviewer said it skipped is unread, whatever the summary claims.
  const reportUnread = parsed && input.candidates ? unreadFromReports(input.candidates.reports, scope.files.map((f) => f.path)) : null;
  const unreadFiles = parsed ? [...new Set([...parsed.meta.unreadFiles, ...(reportUnread ?? [])])] : [];
  if (unreadFiles.length > 0) reasons.push(`${unreadFiles.length} files left unread`);
  const score = computeScore({ findings, incomplete: reasons.join("; ") || undefined });

  const baseBranch = input.baseBranch ?? scope.pr?.baseBranch ?? scope.baseRef?.replace(/^origin\//, "") ?? "";
  const gate = baseBranch && input.useGate !== false ? evaluateGate(contract.gate, baseBranch, score.value) : null;
  let lane: LaneDecision | null = null;
  if (input.useLane !== false) {
    lane = evaluateLane(contract.lanes.light, {
      score: score.value,
      findings,
      changedLines: scope.changedLines,
      changedFiles: [...scope.files, ...scope.skipped].map((f) => f.path),
    });
    // Graph checks alone cannot call a change low-risk: no reviewer has read it.
    if (!parsed) {
      const missing = "the model reviewers did not run";
      lane = { qualifies: false, label: lane.label, reasons: lane.qualifies ? [missing] : [...lane.reasons, missing] };
    }
  }

  const finishedAt = input.now ?? new Date();
  const enabled = (input.lenses ?? []).map((l) => l.id).filter((id) => !disabled.has(id));
  const ranLenses = (parsed?.meta.lenses.ran ?? []).filter((id) => !disabled.has(id));
  const disabledLenses = [...disabled].map((id) => ({ id, reason: "disabled" }));
  const skippedLenses = [
    ...(parsed
      ? parsed.meta.lenses.skipped.filter((l) => !disabled.has(l.id))
      : enabled.filter((id) => id !== "L02").map((id) => ({ id, reason: "model reviewers did not run" }))),
    ...disabledLenses,
  ];

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "plumbline", version: input.version },
    run: {
      id: input.runId,
      startedAt: input.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
      model: parsed?.meta.model ?? null,
      mode: parsed ? "review" : "deterministic",
    },
    scope: {
      label: scope.scope,
      base: scope.baseRef,
      mergeBase: scope.mergeBase,
      head: scope.headSha,
      files: scope.files.length,
      additions: scope.additions,
      deletions: scope.deletions,
      changedLines: scope.changedLines,
    },
    score,
    findings,
    dropped,
    graph: graph
      ? {
          added: graph.diff.added,
          removed: graph.diff.removed,
          newCycles: graph.diff.newCycles,
          layerCrossings: graph.diff.layerCrossings,
          moduleEdgesAdded: graph.diff.moduleEdgesAdded,
        }
      : null,
    lenses: { ran: parsed ? ranLenses : graph && !disabled.has("L02") ? ["L02"] : [], skipped: skippedLenses },
    reviewers: parsed?.meta.reviewers ?? [],
    unreadFiles,
    triage,
    skippedRules: graph?.check.skippedRules ?? [],
    gate,
    lane,
  };
}

/** Write the audit trail for a run: report.md, report.json and report.sarif, plus GitLab Code Quality. */
export function writeReport(run: RunDir, report: ReportV1, lenses: LensInfo[] = []): Record<string, string> {
  const paths = {
    markdown: join(run.dir, "report.md"),
    json: join(run.dir, "report.json"),
    sarif: join(run.dir, "report.sarif"),
    codeQuality: join(run.dir, "gl-code-quality-report.json"),
  };
  writeFileSync(paths.markdown, renderMarkdown(report));
  writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(paths.sarif, `${JSON.stringify(renderSarif(report, lenses), null, 2)}\n`);
  writeFileSync(paths.codeQuality, `${JSON.stringify(renderCodeQuality(report), null, 2)}\n`);
  return paths;
}

export function readJsonFile(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}
