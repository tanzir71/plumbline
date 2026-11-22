import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { git, refExists, repoRoot, tryGit } from "@tanziro/plumbline-core";
import { VERSION } from "./lib.js";
import { runReview } from "./review.js";

export const SUITE_FILE = ".plumbline/benchmark.yml";
const RESULTS_DIR = ".plumbline/run/benchmark";
const PLUMBLINE = "plumbline";

const commitRef = z.string().regex(/^[\w./][\w./-]*$/, "must be a commit or ref");

const issueSchema = z.strictObject({
  id: z.string().min(1),
  file: z.string().min(1),
  lines: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  keywords: z.array(z.string().min(1)).default([]),
  note: z.string().optional(),
});

const caseSchema = z
  .strictObject({
    id: z.string().regex(/^[\w.-]+$/, "use letters, numbers, dots, dashes or underscores"),
    pr: z.number().int().positive().optional(),
    base: commitRef.optional(),
    head: commitRef.optional(),
    expect: z.array(issueSchema).default([]),
  })
  .refine((c) => (c.pr !== undefined) !== (c.base !== undefined && c.head !== undefined) && (c.base === undefined) === (c.head === undefined), {
    message: "a case needs either pr, or both base and head",
  });

const reviewerSchema = z
  .strictObject({ github: z.string().min(1).optional(), file: z.string().min(1).optional() })
  .refine((r) => (r.github === undefined) !== (r.file === undefined), { message: "a reviewer needs either github or file" });

const suiteSchema = z
  .strictObject({
    version: z.literal(1),
    match_window: z.number().int().nonnegative().default(5),
    cases: z.array(caseSchema).min(1),
    reviewers: z.record(z.string().regex(/^[\w.-]+$/), reviewerSchema).default({}),
  })
  .refine((s) => !(PLUMBLINE in s.reviewers), { message: `"${PLUMBLINE}" is reserved for this tool's own results` })
  .refine((s) => new Set(s.cases.map((c) => c.id)).size === s.cases.length, { message: "case ids must be unique" });

export type Suite = z.output<typeof suiteSchema>;
export type SuiteCase = Suite["cases"][number];
export type LabelledIssue = SuiteCase["expect"][number];

export interface ReviewComment {
  file?: string;
  line?: number;
  endLine?: number;
  severity?: string;
  title: string;
  body: string;
}

interface ReviewerResult {
  available: boolean;
  note?: string;
  comments: ReviewComment[];
}

interface CaseResult {
  id: string;
  status: "ok" | "blocked";
  error?: string;
  mergeScore?: number;
  reviewers: Record<string, ReviewerResult>;
}

export interface BenchmarkRun {
  id: string;
  startedAt: string;
  version: string;
  agent: string | null;
  model: string | null;
  /** Hash of the contract and custom lenses, so two runs show whether the tuning changed. */
  tuning: string;
  cases: CaseResult[];
}

export interface ReviewerTotals {
  reviewer: string;
  caught: number;
  labelled: number;
  missed: number;
  unlabelled: number;
  cases: number;
}

export interface BenchmarkSummary {
  run: string;
  reviewers: ReviewerTotals[];
  blocked: { id: string; error: string }[];
  perCase: Record<string, Record<string, { caught: string[]; missed: string[]; unlabelled: number }>>;
}

const SKELETON = `# Plumbline benchmark suite. Reviews and results stay on your machine.
# Docs: https://tanzir71.github.io/plumbline/docs/benchmark/
version: 1

# A comment counts as a match within this many lines of a labelled issue.
match_window: 5

cases:
  # A change with a known issue. Label what a good review should find.
  - id: example-pr
    pr: 123
    expect:
      - id: missing-tenant-filter
        file: src/repo/invoices.ts
        lines: [10, 14]
        keywords: [tenant, org]

  # A change that should get no findings.
  # - id: clean-change
  #   base: "1a2b3c4"
  #   head: "5d6e7f8"
  #   expect: []

# Other reviewers to compare. Use any name.
# reviewers:
#   review-bot:
#     github: review-bot[bot]    # reads its inline PR comments with gh
#   other-tool:
#     file: .plumbline/benchmark-input/other-tool/{case}.sarif    # SARIF or JSON
`;

export function benchmarkInit(cwd: string, force = false): string {
  const file = join(repoRoot(cwd), SUITE_FILE);
  if (existsSync(file) && !force) throw new Error(`${SUITE_FILE} already exists (use --force to replace it)`);
  mkdirSync(join(repoRoot(cwd), ".plumbline"), { recursive: true });
  writeFileSync(file, SKELETON);
  return file;
}

export function parseSuite(text: string, name = SUITE_FILE): Suite {
  const parsed = suiteSchema.safeParse(parseYaml(text));
  if (parsed.success) return parsed.data;
  throw new Error(`invalid ${name}\n${parsed.error.issues.map((i) => `  ${i.path.join(".") || "suite"}: ${i.message}`).join("\n")}`);
}

export function loadSuite(root: string): Suite {
  const file = join(root, SUITE_FILE);
  if (!existsSync(file)) throw new Error(`no benchmark suite found. Run: plumbline benchmark init`);
  return parseSuite(readFileSync(file, "utf8"));
}

const normalizePath = (p: string) => p.replaceAll("\\", "/").replace(/^file:\/\/\/?/, "").replace(/^\.\//, "");

function matches(issue: LabelledIssue, comment: ReviewComment, window: number): boolean {
  if (!comment.file || normalizePath(comment.file) !== normalizePath(issue.file)) return false;
  if (issue.lines) {
    if (comment.line === undefined) {
      if (issue.keywords.length === 0) return false;
    } else {
      const [start, end] = issue.lines;
      if ((comment.endLine ?? comment.line) < start - window || comment.line > end + window) return false;
    }
  }
  if (issue.keywords.length === 0) return true;
  const text = `${comment.title} ${comment.body}`.toLowerCase();
  return issue.keywords.some((k) => text.includes(k.toLowerCase()));
}

/** Pair each labelled issue with at most one comment. Comments left over are unlabelled, not necessarily wrong. */
export function scoreCase(expect: LabelledIssue[], comments: ReviewComment[], window: number) {
  const used = new Set<number>();
  const caught: string[] = [];
  const missed: string[] = [];
  for (const issue of expect) {
    const index = comments.findIndex((c, i) => !used.has(i) && matches(issue, c, window));
    if (index === -1) {
      missed.push(issue.id);
    } else {
      used.add(index);
      caught.push(issue.id);
    }
  }
  return { caught, missed, unlabelled: comments.length - used.size };
}

const firstLine = (text: string) => (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 120);

function fromObject(item: Record<string, unknown>): ReviewComment {
  const body = String(item.body ?? item.message ?? item.title ?? "");
  const line = Number(item.line ?? item.startLine);
  const endLine = Number(item.endLine);
  return {
    ...(item.file || item.path ? { file: String(item.file ?? item.path) } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(Number.isInteger(endLine) && endLine > 0 ? { endLine } : {}),
    ...(item.severity ? { severity: String(item.severity) } : {}),
    title: String(item.title ?? firstLine(body)),
    body,
  };
}

/** Read another reviewer's output: SARIF, a Plumbline report, or a JSON list of comments. */
export function parseReviewFile(text: string): ReviewComment[] {
  const data = JSON.parse(text) as { runs?: unknown[]; findings?: unknown[] } | unknown[];
  if (Array.isArray(data)) return data.map((d) => fromObject(d as Record<string, unknown>));
  if (Array.isArray(data.findings)) return data.findings.map((d) => fromObject(d as Record<string, unknown>));
  if (!Array.isArray(data.runs)) throw new Error("expected SARIF, a findings object or a JSON list");
  type SarifResult = {
    ruleId?: string;
    level?: string;
    message?: { text?: string };
    locations?: { physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number; endLine?: number } } }[];
  };
  return (data.runs as { results?: SarifResult[] }[]).flatMap((run) =>
    (run.results ?? []).map((result) => {
      const location = result.locations?.[0]?.physicalLocation;
      const body = result.message?.text ?? "";
      return {
        ...(location?.artifactLocation?.uri ? { file: decodeURIComponent(location.artifactLocation.uri) } : {}),
        ...(location?.region?.startLine ? { line: location.region.startLine } : {}),
        ...(location?.region?.endLine ? { endLine: location.region.endLine } : {}),
        ...(result.level ? { severity: result.level } : {}),
        title: firstLine(body) || (result.ruleId ?? ""),
        body,
      };
    }),
  );
}

const loginKey = (login: string) => login.toLowerCase().replace(/\[bot\]$/, "");

function githubComments(root: string, pr: number, login: string): ReviewComment[] {
  const out = execFileSync(
    "gh",
    ["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/comments`, "--jq", ".[] | {login: .user.login, path, line: (.line // .original_line), body}"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => JSON.parse(row) as { login: string; path: string; line: number | null; body: string })
    .filter((row) => loginKey(row.login) === loginKey(login))
    .map((row) => fromObject({ path: row.path, line: row.line, body: row.body }));
}

function importReviewer(root: string, entry: Suite["reviewers"][string], c: SuiteCase): ReviewerResult {
  try {
    if (entry.github) {
      if (c.pr === undefined) return { available: false, note: "this case has no PR", comments: [] };
      return { available: true, comments: githubComments(root, c.pr, entry.github) };
    }
    const file = resolve(root, (entry.file as string).replaceAll("{case}", c.id));
    if (!existsSync(file)) return { available: false, note: `no file at ${file}`, comments: [] };
    return { available: true, comments: parseReviewFile(readFileSync(file, "utf8")) };
  } catch (error) {
    return { available: false, note: error instanceof Error ? error.message.split("\n")[0] : String(error), comments: [] };
  }
}

function tuningHash(root: string): string {
  const hash = createHash("sha256");
  const contract = join(root, "plumbline.yml");
  if (existsSync(contract)) hash.update(readFileSync(contract));
  const lenses = join(root, ".plumbline", "lenses");
  if (existsSync(lenses)) {
    for (const name of readdirSync(lenses).sort()) {
      if (!name.endsWith(".md")) continue;
      hash.update(name);
      hash.update(readFileSync(join(lenses, name)));
    }
  }
  return hash.digest("hex").slice(0, 12);
}

function resolveCommits(root: string, c: SuiteCase): { base: string; head: string } {
  if (c.pr === undefined) {
    const base = git(root, ["rev-parse", `${c.base as string}^{commit}`]);
    const head = git(root, ["rev-parse", `${c.head as string}^{commit}`]);
    return { base, head };
  }
  const info = JSON.parse(
    execFileSync("gh", ["pr", "view", String(c.pr), "--json", "baseRefOid,headRefOid"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }),
  ) as { baseRefOid: string; headRefOid: string };
  if (!refExists(root, info.headRefOid)) {
    if (tryGit(root, ["fetch", "--quiet", "origin", `pull/${c.pr}/head`]) === null) tryGit(root, ["fetch", "--quiet", "origin", info.headRefOid]);
  }
  if (!refExists(root, info.baseRefOid)) tryGit(root, ["fetch", "--quiet", "origin", info.baseRefOid]);
  if (!refExists(root, info.headRefOid) || !refExists(root, info.baseRefOid)) throw new Error(`could not fetch the commits of PR ${c.pr}`);
  return { base: info.baseRefOid, head: info.headRefOid };
}

/** A throwaway checkout, so a benchmark never touches the working tree it was started from. */
function checkoutCase(root: string, head: string): string {
  const parent = mkdtempSync(join(tmpdir(), "plumbline-benchmark-"));
  const dest = join(parent, "repo");
  git(parent, ["clone", "--quiet", "--shared", "--no-checkout", "--", root, dest]);
  git(dest, ["checkout", "--quiet", "--detach", head]);
  // Test the current contract without making the checkout look dirty.
  const contract = join(root, "plumbline.yml");
  if (existsSync(contract)) {
    copyFileSync(contract, join(dest, "plumbline.yml"));
    if (tryGit(dest, ["ls-files", "--error-unmatch", "plumbline.yml"]) !== null) {
      git(dest, ["update-index", "--skip-worktree", "plumbline.yml"]);
    } else {
      mkdirSync(join(dest, ".git", "info"), { recursive: true });
      appendFileSync(join(dest, ".git", "info", "exclude"), "\nplumbline.yml\n");
    }
  }
  return parent;
}

function saveRun(root: string, run: BenchmarkRun): void {
  const dir = join(root, RESULTS_DIR, run.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "result.json"), `${JSON.stringify(run, null, 2)}\n`);
}

function listRuns(root: string): string[] {
  const dir = join(root, RESULTS_DIR);
  return existsSync(dir) ? readdirSync(dir).filter((id) => existsSync(join(dir, id, "result.json"))).sort() : [];
}

function readRun(root: string, id?: string): BenchmarkRun {
  const runId = id ?? listRuns(root).at(-1);
  if (!runId) throw new Error("no benchmark runs yet. Run: plumbline benchmark run --yes");
  if (!/^[\w.-]+$/.test(runId)) throw new Error(`invalid benchmark run id: ${runId}`);
  const file = join(root, RESULTS_DIR, runId, "result.json");
  if (!existsSync(file)) throw new Error(`benchmark run not found: ${runId}`);
  return JSON.parse(readFileSync(file, "utf8")) as BenchmarkRun;
}

export function summarize(run: BenchmarkRun, suite: Suite): BenchmarkSummary {
  const totals = new Map<string, ReviewerTotals>();
  const perCase: BenchmarkSummary["perCase"] = {};
  const blocked: BenchmarkSummary["blocked"] = [];
  for (const result of run.cases) {
    if (result.status === "blocked") {
      blocked.push({ id: result.id, error: result.error ?? "unknown error" });
      continue;
    }
    const expect = suite.cases.find((c) => c.id === result.id)?.expect ?? [];
    perCase[result.id] = {};
    for (const [reviewer, output] of Object.entries(result.reviewers)) {
      if (!output.available) continue;
      const score = scoreCase(expect, output.comments, suite.match_window);
      perCase[result.id]![reviewer] = score;
      const row = totals.get(reviewer) ?? { reviewer, caught: 0, labelled: 0, missed: 0, unlabelled: 0, cases: 0 };
      row.caught += score.caught.length;
      row.missed += score.missed.length;
      row.labelled += expect.length;
      row.unlabelled += score.unlabelled;
      row.cases++;
      totals.set(reviewer, row);
    }
  }
  const reviewers = [...totals.values()].sort((a, b) => (a.reviewer === PLUMBLINE ? -1 : b.reviewer === PLUMBLINE ? 1 : a.reviewer.localeCompare(b.reviewer)));
  return { run: run.id, reviewers, blocked, perCase };
}

export function formatSummary(summary: BenchmarkSummary): string {
  const rows = [
    ["Reviewer", "Caught", "Missed", "Unlabelled", "Cases"],
    ...summary.reviewers.map((r) => [r.reviewer, `${r.caught}/${r.labelled}`, String(r.missed), String(r.unlabelled), String(r.cases)]),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  const table = rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i]! + 2)).join("").trimEnd());
  return [
    `Benchmark ${summary.run}`,
    ...table,
    ...summary.blocked.map((b) => `Blocked ${b.id}: ${b.error}`),
    "These counts cover only this suite's cases and labels. Unlabelled comments may still be valid.",
  ].join("\n");
}

export interface BenchmarkRunArgs {
  cwd: string;
  cases?: string[];
  agent?: string;
  model?: string;
  noAgent?: boolean;
  onStatus?: (line: string) => void;
}

export function plannedCases(cwd: string, only: string[] = []): SuiteCase[] {
  const suite = loadSuite(repoRoot(cwd));
  const unknown = only.filter((id) => !suite.cases.some((c) => c.id === id));
  if (unknown.length > 0) throw new Error(`unknown case: ${unknown.join(", ")}`);
  return only.length > 0 ? suite.cases.filter((c) => only.includes(c.id)) : suite.cases;
}

/** Review each case in a throwaway checkout, import the other reviewers, and save the results locally. */
export async function benchmarkRun(args: BenchmarkRunArgs): Promise<{ run: BenchmarkRun; summary: BenchmarkSummary }> {
  const root = repoRoot(args.cwd);
  const suite = loadSuite(root);
  const cases = plannedCases(args.cwd, args.cases);
  const status = args.onStatus ?? (() => undefined);
  const lenses = join(root, ".plumbline", "lenses");
  const run: BenchmarkRun = {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    startedAt: new Date().toISOString(),
    version: VERSION,
    agent: args.noAgent ? null : (args.agent ?? process.env.PLUMBLINE_AGENT ?? "auto"),
    model: args.model ?? null,
    tuning: tuningHash(root),
    cases: [],
  };

  for (const [index, c] of cases.entries()) {
    status(`[${index + 1}/${cases.length}] ${c.id}`);
    const result: CaseResult = { id: c.id, status: "ok", reviewers: {} };
    let parent: string | undefined;
    try {
      const { base, head } = resolveCommits(root, c);
      parent = checkoutCase(root, head);
      const review = await runReview({
        cwd: join(parent, "repo"),
        base,
        agent: args.agent,
        model: args.model,
        noAgent: args.noAgent,
        fetchBase: false,
        tunedLenses: existsSync(lenses) ? lenses : undefined,
        onStatus: (line) => status(`  ${line}`),
      });
      run.agent = review.agent ?? run.agent;
      result.mergeScore = review.report.score.value;
      result.reviewers[PLUMBLINE] = { available: true, comments: review.report.findings.map((f) => fromObject({ ...f })) };
      for (const [name, entry] of Object.entries(suite.reviewers)) result.reviewers[name] = importReviewer(root, entry, c);
    } catch (error) {
      result.status = "blocked";
      result.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
    } finally {
      if (parent) {
        try {
          rmSync(parent, { recursive: true, force: true, maxRetries: 3 });
        } catch {
          // A leftover temp checkout must not lose the case's result.
        }
      }
    }
    run.cases.push(result);
    saveRun(root, run);
  }
  return { run, summary: summarize(run, suite) };
}

/** Rescore a saved run after editing labels or adding another reviewer's output. Spends no model tokens. */
export function benchmarkScore(cwd: string, id?: string): { run: BenchmarkRun; summary: BenchmarkSummary } {
  const root = repoRoot(cwd);
  const suite = loadSuite(root);
  const run = readRun(root, id);
  for (const result of run.cases) {
    const c = suite.cases.find((candidate) => candidate.id === result.id);
    if (!c || result.status !== "ok") continue;
    for (const [name, entry] of Object.entries(suite.reviewers)) result.reviewers[name] = importReviewer(root, entry, c);
  }
  saveRun(root, run);
  return { run, summary: summarize(run, suite) };
}

export interface BenchmarkComparison {
  before: string;
  after: string;
  tuningChanged: boolean;
  reviewers: { reviewer: string; caughtBefore: number; caughtAfter: number; unlabelledBefore: number; unlabelledAfter: number }[];
  newlyCaught: string[];
  newlyMissed: string[];
}

/** Compare two runs, by default the latest two, to see what a lens or contract edit changed. */
export function benchmarkCompare(cwd: string, a?: string, b?: string): BenchmarkComparison {
  const root = repoRoot(cwd);
  const suite = loadSuite(root);
  const ids = listRuns(root);
  const beforeId = a ?? ids.at(-2);
  const afterId = b ?? ids.at(-1);
  if (!beforeId || !afterId) throw new Error("comparing needs two benchmark runs");
  const before = readRun(root, beforeId);
  const after = readRun(root, afterId);
  const sumBefore = summarize(before, suite);
  const sumAfter = summarize(after, suite);
  const names = [...new Set([...sumBefore.reviewers, ...sumAfter.reviewers].map((r) => r.reviewer))];
  const newlyCaught: string[] = [];
  const newlyMissed: string[] = [];
  for (const [caseId, reviewers] of Object.entries(sumAfter.perCase)) {
    const prior = sumBefore.perCase[caseId]?.[PLUMBLINE];
    const current = reviewers[PLUMBLINE];
    if (!prior || !current) continue;
    newlyCaught.push(...current.caught.filter((id) => !prior.caught.includes(id)).map((id) => `${caseId}/${id}`));
    newlyMissed.push(...prior.caught.filter((id) => !current.caught.includes(id)).map((id) => `${caseId}/${id}`));
  }
  return {
    before: before.id,
    after: after.id,
    tuningChanged: before.tuning !== after.tuning,
    reviewers: names.map((reviewer) => {
      const x = sumBefore.reviewers.find((r) => r.reviewer === reviewer);
      const y = sumAfter.reviewers.find((r) => r.reviewer === reviewer);
      return { reviewer, caughtBefore: x?.caught ?? 0, caughtAfter: y?.caught ?? 0, unlabelledBefore: x?.unlabelled ?? 0, unlabelledAfter: y?.unlabelled ?? 0 };
    }),
    newlyCaught,
    newlyMissed,
  };
}

export function formatComparison(c: BenchmarkComparison): string {
  return [
    `Comparing ${c.before} -> ${c.after}`,
    `Contract or lenses changed: ${c.tuningChanged ? "yes" : "no"}`,
    ...c.reviewers.map((r) => `${r.reviewer}: caught ${r.caughtBefore} -> ${r.caughtAfter}, unlabelled ${r.unlabelledBefore} -> ${r.unlabelledAfter}`),
    ...(c.newlyCaught.length > 0 ? [`Newly caught: ${c.newlyCaught.join(", ")}`] : []),
    ...(c.newlyMissed.length > 0 ? [`Newly missed: ${c.newlyMissed.join(", ")}`] : []),
  ].join("\n");
}
