import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { showFile } from "./git.js";
import { SEVERITIES, type Finding, type Severity } from "./types.js";

/** A reviewer's candidate before verification. Ids are unique within a run, such as `A3` or `C12`. */
export interface Candidate {
  id: string;
  severity: Severity;
  lens: string;
  title: string;
  body: string;
  file?: string;
  line?: number;
  endLine?: number;
  security?: boolean;
}

export interface ReviewerReport {
  id: string;
  candidates: Candidate[];
  /** null when the report has no COVERAGE line. */
  coverage: { all: boolean; notRead: string } | null;
}

/** Reasons a candidate may be dismissed. The first four must cite the code that rules it out. */
export const CODE_REASONS = ["guarded", "pre_existing", "not_reachable", "misread"] as const;
export const TEXT_REASONS = ["stated_decision", "style"] as const;

export interface Dismissal {
  candidate: string;
  reason: string;
  evidence: string;
  file?: string;
  line?: number;
}

export interface TriageSummary {
  candidates: number;
  /** Merged into a reported finding. */
  merged: number;
  /** Dismissed with evidence. */
  dismissed: number;
  /** Not accounted for, or dismissed without evidence, so kept as an unresolved finding. */
  restored: number;
}

const FIELD = /^(lens|priority|security|location|title|trigger|impact|fix):\s*(.*)$/i;

export function parseLocation(text: string | undefined): { file: string; line?: number; endLine?: number } | null {
  const m = /^`?([^`\s:]+?)(?::(\d+)(?:-(\d+))?)?`?$/.exec((text ?? "").trim());
  if (!m?.[1]) return null;
  const line = m[2] ? Number(m[2]) : undefined;
  const end = m[3] ? Number(m[3]) : undefined;
  return { file: m[1].replaceAll("\\", "/").replace(/^\.\//, ""), ...(line ? { line } : {}), ...(line && end && end >= line ? { endLine: end } : {}) };
}

/** Read the CANDIDATE blocks and the COVERAGE line from a reviewer report in the brief's format. */
export function parseReviewerReport(id: string, text: string): ReviewerReport {
  const blocks: { id: string; fields: Record<string, string> }[] = [];
  let current: { id: string; fields: Record<string, string> } | null = null;
  let coverage: ReviewerReport["coverage"] = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^CANDIDATE\s+([A-Za-z]+\d+)\b/.exec(line);
    if (head?.[1]) {
      current = { id: head[1].toUpperCase(), fields: {} };
      blocks.push(current);
      continue;
    }
    const cov = /^COVERAGE:\s*(.*)$/i.exec(line);
    if (cov) {
      const value = (cov[1] ?? "").trim();
      coverage = /^all\b/i.test(value) ? { all: true, notRead: "" } : { all: false, notRead: value.replace(/^not read:\s*/i, "") };
      current = null;
      continue;
    }
    if (/^(CHECKED|PREVIOUS FINDINGS|MODEL):/i.test(line)) {
      current = null;
      continue;
    }
    const field = current ? FIELD.exec(line) : null;
    if (current && field?.[1]) current.fields[field[1].toLowerCase()] = (field[2] ?? "").trim();
  }

  const candidates = blocks.map(({ id: cid, fields }): Candidate => {
    const priority = (fields.priority ?? "").toUpperCase();
    const where = parseLocation(fields.location);
    const body = [fields.impact, fields.trigger && `Trigger: ${fields.trigger}`].filter(Boolean).join(" ");
    return {
      id: cid,
      severity: (SEVERITIES as readonly string[]).includes(priority) ? (priority as Severity) : "P2",
      lens: fields.lens || "L01",
      title: fields.title || `Candidate ${cid}`,
      body,
      ...(where ?? {}),
      ...(/^yes/i.test(fields.security ?? "") ? { security: true } : {}),
    };
  });
  return { id, candidates, coverage };
}

/**
 * Candidates saved in a run directory: reviewer reports in `reviewers/*.md` and a model panel's
 * `panel/candidates.json`. Returns null when the run has neither, so nothing can be accounted for.
 */
export function loadCandidates(runDir: string): { candidates: Candidate[]; reports: ReviewerReport[] } | null {
  const reports: ReviewerReport[] = [];
  const dir = join(runDir, "reviewers");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      reports.push(parseReviewerReport(name.replace(/\.md$/, ""), readFileSync(join(dir, name), "utf8")));
    }
  }
  const candidates = reports.flatMap((r) => r.candidates);
  const panelFile = join(runDir, "panel", "candidates.json");
  if (existsSync(panelFile)) {
    const data = JSON.parse(readFileSync(panelFile, "utf8")) as { candidates?: (Partial<Candidate> & { id?: string })[] };
    for (const c of data.candidates ?? []) {
      if (!c.id || !c.title || !c.severity || !c.lens) continue;
      candidates.push({
        id: c.id,
        severity: c.severity,
        lens: c.lens,
        title: c.title,
        body: c.body ?? "",
        ...(c.file ? { file: c.file } : {}),
        ...(c.line ? { line: c.line } : {}),
        ...(c.endLine ? { endLine: c.endLine } : {}),
        ...(c.security ? { security: true } : {}),
      });
    }
  }
  if (reports.length === 0 && !existsSync(panelFile)) return null;
  return { candidates, reports };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Changed files that no reviewer read, from the COVERAGE lines of the saved reports.
 * A file counts as read when any report with a COVERAGE line read all files or did not list it.
 * Returns null when no report has a COVERAGE line.
 */
export function unreadFromReports(reports: ReviewerReport[], files: string[]): string[] | null {
  const known = reports.filter((r) => r.coverage !== null);
  if (known.length === 0) return null;
  const listed = (notRead: string, path: string) => new RegExp(`(^|[\\s,;(\`'"])${escapeRegExp(path)}($|[\\s,;):\`'"])`).test(notRead);
  return files.filter((path) => !known.some((r) => r.coverage?.all || !listed(r.coverage?.notRead ?? "", path)));
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);

/**
 * For findings files that predate `from`: the finding is in the same file and within 10 lines,
 * or, without line numbers, describes the candidate in similar words.
 */
function covers(f: Finding, c: Candidate): boolean {
  if (!f.file || f.file !== c.file) return false;
  if (f.line !== undefined && c.line !== undefined) return Math.abs(f.line - c.line) <= 10;
  const x = words(`${f.title} ${f.body}`);
  const y = words(`${c.title} ${c.body}`);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.min(x.size, y.size)) >= 0.4;
}

export interface TriageContext {
  root: string;
  headSha: string;
  mergeBase: string;
}

function lineCount(ctx: TriageContext, file: string, at: "head" | "base"): number | null {
  const target = resolve(ctx.root, file);
  const rel = relative(ctx.root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  let text: string | null = null;
  if (at === "head" && existsSync(target)) {
    try {
      text = readFileSync(target, "utf8");
    } catch {
      text = null;
    }
  }
  text ??= showFile(ctx.root, at === "head" ? ctx.headSha : ctx.mergeBase, rel.replaceAll("\\", "/"));
  return text === null ? null : text.replace(/\r?\n$/, "").split("\n").length;
}

/** Why a dismissal does not count, or null when it does. */
export function dismissalProblem(d: Dismissal, ctx: TriageContext): string | null {
  const evidence = d.evidence.trim();
  if ((TEXT_REASONS as readonly string[]).includes(d.reason)) return evidence ? null : `dismissed as ${d.reason} with no evidence`;
  if (!(CODE_REASONS as readonly string[]).includes(d.reason)) return `dismissed as "${d.reason.slice(0, 60)}", which is not a reason that rules a defect out`;
  if (!evidence) return `dismissed as ${d.reason} with no evidence`;
  if (!d.file || !d.line) return `dismissed as ${d.reason} without citing the code that rules it out`;
  const lines = lineCount(ctx, d.file, d.reason === "pre_existing" ? "base" : "head") ?? (d.reason === "pre_existing" ? null : lineCount(ctx, d.file, "base"));
  if (lines === null) return `dismissed as ${d.reason}, citing ${d.file}, which is not in the reviewed tree`;
  if (d.line > lines) return `dismissed as ${d.reason}, citing line ${d.line} of ${d.file}, which has ${lines} lines`;
  return null;
}

const capAtP2 = (s: Severity): Severity => (s === "P0" || s === "P1" ? "P2" : s);

/**
 * Account for every candidate. One counts as handled when a finding lists it in `from`, or when it was
 * dismissed with evidence. Everything else comes back as an unresolved finding, at most P2, so a model's
 * doubt can lower a candidate but never remove it. Only when no finding uses `from`, as in output written
 * before it existed, does a finding near the candidate in the same file count as covering it.
 */
export function triageCandidates(
  candidates: Candidate[],
  findings: Finding[],
  dismissed: Dismissal[],
  ctx: TriageContext,
): { restored: Finding[]; summary: TriageSummary } {
  const referenced = new Set(findings.flatMap((f) => f.from ?? []).map((id) => id.toUpperCase()));
  const legacy = referenced.size === 0;
  const byId = new Map(dismissed.map((d) => [d.candidate.toUpperCase(), d]));
  const restored: Finding[] = [];
  const summary: TriageSummary = { candidates: candidates.length, merged: 0, dismissed: 0, restored: 0 };

  for (const c of candidates) {
    if (referenced.has(c.id.toUpperCase())) {
      summary.merged++;
      continue;
    }
    const d = byId.get(c.id.toUpperCase());
    const problem = d ? dismissalProblem(d, ctx) : null;
    if (d && !problem) {
      summary.dismissed++;
      continue;
    }
    if (!d && legacy && findings.some((f) => covers(f, c))) {
      summary.merged++;
      continue;
    }
    summary.restored++;
    const why = problem ?? "the review neither confirmed nor ruled it out";
    restored.push({
      id: `unresolved-${c.id}`,
      severity: capAtP2(c.severity),
      lens: c.lens,
      title: c.title,
      body: c.body,
      ...(c.file ? { file: c.file } : {}),
      ...(c.line ? { line: c.line } : {}),
      ...(c.endLine ? { endLine: c.endLine } : {}),
      ...(c.security ? { security: true } : {}),
      source: "model",
      from: [c.id],
      unresolved: true,
      ...(capAtP2(c.severity) !== c.severity ? { downgradedFrom: c.severity } : {}),
      downgradeReason: `Unresolved: ${why}`,
    });
  }
  return { restored, summary };
}

/** A finding the review could not verify is shown, but never above P2. */
export function capUnresolved(f: Finding): Finding {
  if (!f.unresolved) return f;
  const severity = capAtP2(f.severity);
  if (severity === f.severity) return { ...f, downgradeReason: f.downgradeReason ?? "Unresolved: the review neither confirmed nor ruled it out" };
  return { ...f, severity, downgradedFrom: f.severity, downgradeReason: f.downgradeReason ?? "Unresolved: the review neither confirmed nor ruled it out" };
}
