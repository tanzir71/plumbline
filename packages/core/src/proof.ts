import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Contract } from "./contract/schema.js";
import { showFile } from "./git.js";
import { formatCycle } from "./graph/diff.js";
import type { CheckResult, DroppedFinding, Finding, GraphDiff, Proof, ProofKind, Severity } from "./types.js";

export interface ProofContext {
  contract: Contract;
  diff: GraphDiff;
  check: CheckResult;
  root: string;
  /** ADR identifiers found in the repo, normalised like `ADR-012`. */
  adrIds?: Set<string>;
  /** Test runs recorded by `plumbline prove`. When set, failing_test proofs must match one. */
  recordedProofs?: RecordedProof[];
  headSha?: string;
}

/** A proof test run captured by the tool itself, written to `proofs.json` in the run directory. */
export interface RecordedProof {
  ref: string;
  sha256: string;
  headSha: string;
  command: string;
  exitCode: number;
  output: string;
  passedOnBase?: boolean;
  recordedAt: string;
}

export function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Added to the recorded output when a proof command times out, is killed or cannot start. */
export const TEST_DID_NOT_FINISH = "plumbline: the test command did not finish";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const DID_NOT_RUN =
  /Startup Error|failed to load config|\bEPERM\b|\bEACCES\b|Cannot find (?:module|package)|Failed to resolve (?:import|entry)|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|SyntaxError|ERROR collecting|errors? during collection|Test suite failed to run|No test files found|No tests found|no tests ran|Tests\s+no tests|not recognized as an internal or external command|command not found|Loading PostCSS Plugin failed|\[build failed\]|could not compile/i;
const REACHED_ASSERTION = /AssertionError|expect\(received\)|^\s*E\s+assert\b|--- FAIL:|^\s*(?:Expected|Received):/im;

/**
 * A non-zero exit is not proof by itself. Returns why a run never reached a test assertion,
 * such as a startup, import, permission or timeout failure, or null when it may count.
 */
export function proofRunProblem(output: string): string | null {
  const text = output.replace(ANSI, "");
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const unfinished = lines.find((line) => line.includes(TEST_DID_NOT_FINISH));
  if (unfinished) return unfinished.slice(0, 160);
  const problems = lines.filter((line) => DID_NOT_RUN.test(line));
  if (problems.length === 0 || REACHED_ASSERTION.test(text)) return null;
  // Prefer the error message over a source line or path that happens to match.
  const reason = problems.find((line) => /^\w*Error\b/.test(line)) ?? (problems[0] as string);
  return reason.slice(0, 160);
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

/** Normalise `ADR-12`, `adr 012` and `ADR-0012` to one comparable form. */
export function adrKey(id: string): string | null {
  const m = /^adr[-_ ]?0*(\d+)$/i.exec(id.trim());
  return m ? `ADR-${m[1]}` : null;
}

/** A cited file's text: the working copy if it has one, otherwise the reviewed commit. Never outside the repo. */
function readAtHead(root: string, headSha: string, file: string): string | null {
  const target = resolve(root, file);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (existsSync(target)) {
    try {
      return readFileSync(target, "utf8");
    } catch {
      return null;
    }
  }
  return showFile(root, headSha, rel.replaceAll("\\", "/"));
}

function verifyProof(proof: Proof, finding: Finding, ctx: ProofContext): string | null {
  switch (proof.kind) {
    case "graph_diff": {
      const ref = normalise(proof.ref);
      const edges = ctx.diff.added.map((e) => `${e.from} -> ${e.to}`);
      const modules = ctx.diff.moduleEdgesAdded.map((e) => `${e.from} -> ${e.to}`);
      const cycles = ctx.diff.newCycles.map(formatCycle);
      if ([...edges, ...modules, ...cycles].includes(ref)) return null;
      return `graph_diff "${proof.ref}" is not an edge or cycle added in this change`;
    }
    case "broken_rule": {
      const key = adrKey(proof.ref);
      const known =
        ctx.contract.rules.some((r) => r.id === proof.ref) ||
        ctx.check.violations.some((v) => v.ruleId === proof.ref) ||
        (key !== null && (ctx.adrIds?.has(key) ?? false));
      if (!known) return `broken_rule "${proof.ref}" is not a contract rule or a known ADR`;
      if (!finding.file || !finding.line) {
        const deterministic = ctx.check.violations.some((v) => v.ruleId === proof.ref && v.from === finding.file);
        if (!deterministic) return "broken_rule must cite the file and line that break the rule";
      }
      if (finding.file && finding.line && ctx.headSha) {
        const text = readAtHead(ctx.root, ctx.headSha, finding.file);
        if (text === null) return `broken_rule cites ${finding.file}, which is not in this change's tree`;
        const lines = text.replace(/\r?\n$/, "").split("\n").length;
        if (finding.line > lines) return `broken_rule cites line ${finding.line} of ${finding.file}, which has ${lines} lines`;
      }
      return null;
    }
    case "failing_test": {
      const test = resolve(ctx.root, proof.ref);
      const rel = relative(resolve(ctx.root, ".plumbline/proofs"), test);
      if (rel.startsWith("..") || isAbsolute(rel)) return "failing_test must live under .plumbline/proofs/";
      if (!existsSync(test)) return `failing_test ${proof.ref} does not exist`;
      if (ctx.recordedProofs) {
        // The model's claim is not evidence. Only a run recorded by `plumbline prove` counts.
        const key = relative(ctx.root, test).replaceAll("\\", "/");
        const record = ctx.recordedProofs.find((p) => p.ref === key && p.headSha === ctx.headSha);
        if (!record) return `failing_test ${proof.ref} was not recorded by "plumbline prove" on this commit`;
        if (record.sha256 !== hashFile(test)) return `failing_test ${proof.ref} changed after it was recorded`;
        if (record.exitCode === 0) return "failing_test must have failed on HEAD";
        const problem = proofRunProblem(record.output);
        if (problem) return `failing_test ${proof.ref} never reached a test assertion: ${problem}`;
        if (record.passedOnBase === false) return "failing_test also fails on base, so this change did not cause it";
        return null;
      }
      if (!proof.command) return "failing_test must record the command that ran it";
      if (proof.exitCode === undefined || proof.exitCode === 0) return "failing_test must have failed on HEAD";
      if (!proof.output?.trim()) return "failing_test must record its failure output";
      const problem = proofRunProblem(proof.output);
      if (problem) return `failing_test ${proof.ref} never reached a test assertion: ${problem}`;
      if (proof.passedOnBase === false) return "failing_test also fails on base, so this change did not cause it";
      return null;
    }
  }
}

function validKinds(finding: Finding, ctx: ProofContext): { kinds: Set<ProofKind>; errors: string[] } {
  const kinds = new Set<ProofKind>();
  const errors: string[] = [];
  for (const proof of finding.proof ?? []) {
    const error = verifyProof(proof, finding, ctx);
    if (error) errors.push(error);
    else kinds.add(proof.kind);
  }
  return { kinds, errors };
}

export interface ProofGateResult {
  kept: Finding[];
  dropped: DroppedFinding[];
}

/**
 * Every P0 and P1 needs proof the contract accepts, checked here rather than taken from the model.
 * Without it a finding drops to P2, or is removed when it is also unreachable or style-only.
 */
export function applyProofGate(findings: Finding[], ctx: ProofContext): ProofGateResult {
  const kept: Finding[] = [];
  const dropped: DroppedFinding[] = [];

  for (const finding of findings) {
    if (finding.severity !== "P0" && finding.severity !== "P1") {
      if (finding.unreachable || finding.styleOnly) {
        dropped.push({ finding, reason: finding.unreachable ? "unreachable" : "style-only" });
      } else {
        kept.push(finding);
      }
      continue;
    }

    const { kinds, errors } = validKinds(finding, ctx);
    const meets = (s: "P0" | "P1") => ctx.contract.proof[s].some((k) => kinds.has(k));
    if (meets(finding.severity)) {
      kept.push(finding);
      continue;
    }
    if (finding.unreachable || finding.styleOnly) {
      dropped.push({ finding, reason: `no proof and ${finding.unreachable ? "unreachable" : "style-only"}` });
      continue;
    }

    const target: Severity = finding.severity === "P0" && meets("P1") ? "P1" : "P2";
    const accepted = ctx.contract.proof[finding.severity].join(", ");
    kept.push({
      ...finding,
      severity: target,
      downgradedFrom: finding.severity,
      downgradeReason: errors[0] ?? `no accepted proof (${accepted})`,
    });
  }
  return { kept, dropped };
}

/** Remove model findings that restate a deterministic one, keeping the deterministic version. */
export function mergeFindings(deterministic: Finding[], model: Finding[]): Finding[] {
  const refs = new Set(deterministic.flatMap((f) => (f.proof ?? []).filter((p) => p.kind === "graph_diff").map((p) => normalise(p.ref))));
  const ids = new Set(deterministic.map((f) => f.id));
  const unique = model.filter(
    (f) => !ids.has(f.id) && !(f.proof ?? []).some((p) => p.kind === "graph_diff" && refs.has(normalise(p.ref))),
  );
  return [...deterministic, ...unique];
}
