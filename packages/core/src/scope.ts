import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, posix } from "node:path";
import { git, refExists, repoRoot, shortSha, tryGit } from "./git.js";

export type ScopeMode = "worktree" | "branch-clean" | "branch" | "commit" | "pr";

export interface ScopeFile {
  status: string;
  path: string;
  additions: number;
  deletions: number;
  oldPath?: string;
  untracked?: boolean;
}

export interface ScopeResult {
  mode: ScopeMode;
  scope: string;
  note?: string;
  repo: string;
  baseRef: string | null;
  mergeBase: string;
  headSha: string;
  headLabel: string;
  diffCommand: string;
  fileAccess: string;
  size: "small" | "medium" | "large";
  files: ScopeFile[];
  /** The same files riskiest first, which is the order reviewers read them in. */
  reviewOrder: string[];
  skipped: ScopeFile[];
  additions: number;
  deletions: number;
  changedLines: number;
  renames: Record<string, string>;
  commits: { sha: string; subject: string; body: string }[];
  pr?: { number: string; title: string; url: string; body: string; baseBranch: string };
  contract: string | null;
  adrs: string[];
  ruleFiles: string[];
  lessonFiles: string[];
  lensFiles: string[];
  codeGraph: string | null;
}

export class NothingToReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NothingToReviewError";
  }
}

export interface ScopeOptions {
  cwd?: string;
  target?: string;
  base?: string;
  /** Refresh the remote base branch first, so a stale ref cannot pull other people's commits into the diff. */
  fetchBase?: boolean;
}

const GENERATED =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|Podfile\.lock|pubspec\.lock|mix\.lock|flake\.lock)$|\.min\.(js|css)$|\.map$|\.snap$|__snapshots__\/|_pb2(_grpc)?\.py$|\.pb\.go$|\.generated\.|(^|\/)(node_modules|vendor|dist)\//;

const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$|(^|\/)(LICENSE|NOTICE|CHANGELOG)[^/]*$/i;
const TEST_FILE = /(^|\/)(__tests__|__mocks__|tests?|spec|specs|e2e|fixtures)\/|[._-](test|spec)\.[^/]+$|(^|\/)test_[^/]+$/i;
const CONFIG_FILE = /\.(json|ya?ml|toml|ini|cfg|conf|properties)$|(^|\/)\.[^/]+rc(\.[^/]+)?$|(^|\/)(Dockerfile|Makefile|Procfile)$/i;

/** 0 for source code, 1 for config, 2 for tests, 3 for docs. Lower is read first. */
export function riskRank(path: string): number {
  if (DOC_FILE.test(path)) return 3;
  if (TEST_FILE.test(path)) return 2;
  if (CONFIG_FILE.test(path)) return 1;
  return 0;
}

/** Changed files riskiest first: source before config, tests and docs, then the most changed lines. */
export function reviewOrder(files: ScopeFile[]): string[] {
  return [...files]
    .sort((a, b) => riskRank(a.path) - riskRank(b.path) || b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path))
    .map((f) => f.path);
}

const PLUMBLINE_OUTPUT = /^\.plumbline\/(run|proofs)\//;
const RULE_NAMES = new Set(["AGENTS.md", "agents.md", "AGENTS.override.md", "CLAUDE.md", "GEMINI.md"]);
const REPO_RULES = ["REVIEW.md", "CODE_REVIEW.md", ".github/copilot-instructions.md", ".cursorrules"];
const LESSON = /^lessons([-_]learned[^/]*)?\.md$/i;

function bestRef(cwd: string, name: string): string | null {
  const upstream = tryGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${name}@{upstream}`]);
  if (upstream && refExists(cwd, upstream)) return upstream;
  if (refExists(cwd, `refs/remotes/origin/${name}`)) return `origin/${name}`;
  if (refExists(cwd, `refs/heads/${name}`)) return name;
  return null;
}

function isBranch(cwd: string, name: string): boolean {
  if (name === "HEAD" || tryGit(cwd, ["check-ref-format", "--branch", name]) === null) return false;
  return (
    tryGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]) !== null ||
    tryGit(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${name}`]) !== null
  );
}

function parsePrTarget(cwd: string, target: string): string | null {
  const url = /^https?:\/\/.*\/pull\/(\d+)/.exec(target);
  if (url) return url[1] ?? null;
  const hash = /^#(\d+)$/.exec(target);
  if (hash) return hash[1] ?? null;
  if (/^\d{1,6}$/.test(target) && !isBranch(cwd, target)) return target;
  return null;
}

function ghJson(cwd: string, pr: string): Record<string, string> {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", pr, "--json", "baseRefName,headRefOid,baseRefOid,state,title,url,body"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    return JSON.parse(out) as Record<string, string>;
  } catch {
    throw new Error(`PR mode needs the GitHub CLI (gh), and "gh pr view ${pr}" failed`);
  }
}

function parseNumstat(raw: string): { additions: number; deletions: number; path: string; oldPath?: string; binary: boolean }[] {
  const tokens = raw.split("\0");
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const [a, d, p] = token.split("\t");
    let path = p ?? "";
    let oldPath: string | undefined;
    if (path === "") {
      oldPath = tokens[++i];
      path = tokens[++i] ?? "";
    }
    out.push({ additions: a === "-" ? 0 : Number(a), deletions: d === "-" ? 0 : Number(d), path, oldPath, binary: a === "-" });
  }
  return out;
}

function parseNameStatus(raw: string): Map<string, string> {
  const tokens = raw.split("\0");
  const out = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    if (!status) continue;
    const letter = status.charAt(0);
    if (letter === "R" || letter === "C") {
      i++;
      out.set(tokens[++i] ?? "", letter);
    } else {
      out.set(tokens[++i] ?? "", letter);
    }
  }
  return out;
}

function countLines(file: string): number | null {
  try {
    const buf = readFileSync(file);
    if (buf.subarray(0, 8000).includes(0)) return null;
    if (buf.length === 0) return 0;
    let n = 0;
    for (const byte of buf) if (byte === 0x0a) n++;
    return buf[buf.length - 1] === 0x0a ? n : n + 1;
  } catch {
    return null;
  }
}

function ancestors(dir: string): string[] {
  const out: string[] = [];
  let at = dir;
  for (;;) {
    out.push(at);
    if (at === ".") return out;
    at = posix.dirname(at);
  }
}

function collectContext(root: string, changedDirs: Set<string>) {
  const tracked = git(root, ["ls-files", "-co", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  const all = new Set(tracked);
  const rules = new Set<string>();

  for (const dir of changedDirs) {
    for (const at of ancestors(dir)) {
      for (const name of RULE_NAMES) {
        const candidate = at === "." ? name : `${at}/${name}`;
        if (all.has(candidate)) rules.add(candidate);
      }
    }
  }
  for (const name of RULE_NAMES) if (all.has(name)) rules.add(name);
  for (const f of REPO_RULES) if (all.has(f)) rules.add(f);
  for (const f of tracked) {
    if (/^\.github\/instructions\/[^/]+\.instructions\.md$/.test(f) || /^\.cursor\/rules\/[^/]+\.mdc$/.test(f)) rules.add(f);
  }

  // Workspace rule files above the repo, as agents load them too.
  const home = homedir();
  for (let p = dirname(root); p !== dirname(p) && p !== home; p = dirname(p)) {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const candidate = join(p, name);
      if (existsSync(candidate)) rules.add(`${candidate.replaceAll("\\", "/")} (workspace)`);
    }
  }

  const adrs = tracked.filter((f) => f.startsWith("docs/adr/") || /(^|\/)ADR-[^/]*\.md$/.test(f)).sort();
  const lessonFiles = tracked.filter((f) => f.split("/").length <= 3 && LESSON.test(basename(f))).sort();
  const lensFiles = tracked.filter((f) => /^\.plumbline\/lenses\/[^/]+\.md$/.test(f)).sort();
  return { rules: [...rules].sort(), adrs, lessonFiles, lensFiles };
}

/** Resolve and pin the review scope. Read-only, except that PR mode may fetch the PR head. */
export function resolveScope(options: ScopeOptions = {}): ScopeResult {
  const root = repoRoot(options.cwd ?? process.cwd());
  const target = options.target;
  let baseArg = options.base ?? "";
  const currentBranch = tryGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? "detached HEAD";

  let mode: ScopeMode | "" = "";
  let prNumber: string | null = null;
  let headRef = "HEAD";
  let note: string | undefined;
  let pr: ScopeResult["pr"];

  if (target) {
    prNumber = parsePrTarget(root, target);
    if (prNumber) {
      mode = "pr";
    } else if (isBranch(root, target)) {
      if (target !== currentBranch) {
        const best = bestRef(root, target);
        const contained = best !== null && tryGit(root, ["merge-base", "--is-ancestor", best, "HEAD"]) !== null;
        if (contained || ["dev", "main", "master"].includes(target)) {
          baseArg ||= target;
          note = `Interpreting '${target}' as the base branch (HEAD already contains it).`;
        } else {
          mode = "branch";
          headRef = best as string;
        }
      }
    } else if (refExists(root, target)) {
      mode = "commit";
    } else {
      throw new Error(`cannot resolve '${target}' as a PR, branch or commit`);
    }
  }

  if (mode === "pr" && prNumber) {
    const info = ghJson(root, prNumber);
    const oid = info.headRefOid as string;
    const baseBranch = info.baseRefName as string;
    if (!refExists(root, oid)) {
      if (tryGit(root, ["fetch", "--quiet", "origin", `pull/${prNumber}/head`]) === null && tryGit(root, ["fetch", "--quiet", "origin", oid]) === null) {
        throw new Error(`PR head ${oid} is not available locally and could not be fetched`);
      }
    }
    headRef = oid;
    pr = {
      number: prNumber,
      title: info.title ?? "",
      url: info.url ?? "",
      body: (info.body ?? "").split("\n").slice(0, 60).join("\n"),
      baseBranch,
    };
    if (!baseArg) {
      baseArg = baseBranch;
      if (info.state !== "OPEN") {
        const baseOid = info.baseRefOid as string;
        if (!refExists(root, baseOid)) tryGit(root, ["fetch", "--quiet", "origin", baseOid]);
        if (refExists(root, baseOid)) baseArg = baseOid;
        note = `PR is ${info.state}; diffing against its recorded base commit ${shortSha(root, baseOid)}.`;
      }
    }
  }

  let baseRef: string | null = null;
  let mergeBase: string;
  let headSha: string;

  if (mode === "commit") {
    headSha = git(root, ["rev-parse", `${target}^{commit}`]);
    mergeBase = refExists(root, `${headSha}^`)
      ? git(root, ["rev-parse", `${headSha}^`])
      : execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], { cwd: root, input: "", encoding: "utf8", windowsHide: true }).trim();
    baseRef = `parent of ${shortSha(root, headSha)}`;
  } else {
    if (baseArg) {
      baseRef = bestRef(root, baseArg) ?? (refExists(root, baseArg) ? baseArg : null);
      if (!baseRef) throw new Error(`base '${baseArg}' not found`);
    } else {
      for (const name of ["dev", "main", "master"]) {
        baseRef = bestRef(root, name);
        if (baseRef) break;
      }
    }
    headSha = git(root, ["rev-parse", `${headRef}^{commit}`]);
    if (baseRef) {
      if (options.fetchBase && baseRef.startsWith("origin/")) tryGit(root, ["fetch", "--quiet", "origin", baseRef.slice("origin/".length)]);
      const mb = tryGit(root, ["merge-base", baseRef, headSha]);
      if (!mb) throw new Error(`no merge base between ${baseRef} and ${shortSha(root, headSha)} (shallow clone? try: git fetch --unshallow)`);
      mergeBase = mb;
    } else {
      mergeBase = headSha;
      note = "No dev, main or master branch found; reviewing uncommitted work only (pass --base <branch> to change).";
    }
  }

  const dirty =
    mode === "" &&
    git(root, ["status", "--porcelain", "--untracked-files=normal"])
      .split("\n")
      .some((line) => line && !PLUMBLINE_OUTPUT.test(line.slice(3).replace(/^"/, "")));

  const finalMode: ScopeMode = mode || (dirty ? "worktree" : "branch-clean");
  const range = finalMode === "worktree" ? [mergeBase] : [mergeBase, headSha];

  if (finalMode !== "worktree" && mergeBase === headSha) {
    throw new NothingToReviewError(
      `${shortSha(root, headSha)} has no changes against ${baseRef ?? "its base"} and the working tree is clean.`,
    );
  }

  const numstat = parseNumstat(git(root, ["diff", "--numstat", "-M", "-z", ...range]));
  const statuses = parseNameStatus(git(root, ["diff", "--name-status", "-M", "-z", ...range]));

  const files: ScopeFile[] = [];
  const skipped: ScopeFile[] = [];
  const renames: Record<string, string> = {};
  let additions = 0;
  let deletions = 0;

  for (const row of numstat) {
    const file: ScopeFile = {
      status: statuses.get(row.path) ?? "M",
      path: row.path,
      additions: row.additions,
      deletions: row.deletions,
      ...(row.oldPath ? { oldPath: row.oldPath } : {}),
    };
    if (row.oldPath) renames[row.oldPath] = row.path;
    if (row.binary || GENERATED.test(row.path)) {
      skipped.push(file);
      continue;
    }
    files.push(file);
    additions += row.additions;
    deletions += row.deletions;
  }

  if (finalMode === "worktree") {
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter((p) => p && !PLUMBLINE_OUTPUT.test(p))
      .slice(0, 300);
    for (const path of untracked) {
      const lines = countLines(join(root, path));
      const file: ScopeFile = { status: "??", path, additions: lines ?? 0, deletions: 0, untracked: true };
      if (lines === null || GENERATED.test(path)) {
        skipped.push(file);
        continue;
      }
      files.push(file);
      additions += lines;
    }
  }

  const changedLines = additions + deletions;
  const size = changedLines >= 1500 || files.length > 40 ? "large" : changedLines >= 200 ? "medium" : "small";
  const changedDirs = new Set(files.map((f) => posix.dirname(f.path)));
  const context = collectContext(root, changedDirs);

  const commitLog = tryGit(root, ["log", "--reverse", "--no-merges", "-n", "40", "--format=%h%x00%s%x00%b%x01", `${mergeBase}..${headSha}`]);
  const commits =
    finalMode === "commit"
      ? [{ sha: shortSha(root, headSha), subject: git(root, ["log", "-1", "--format=%s", headSha]), body: "" }]
      : (commitLog ?? "")
          .split("\x01")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => {
            const [sha = "", subject = "", body = ""] = entry.split("\0");
            return { sha, subject, body: body.split("\n").filter(Boolean).slice(0, 6).join("\n") };
          });

  const scopeLabel: Record<ScopeMode, string> = {
    worktree: `${currentBranch} vs ${baseRef ?? "HEAD"}: committed and uncommitted changes`,
    "branch-clean": `${currentBranch} vs ${baseRef}`,
    branch: `branch ${target} vs ${baseRef}`,
    commit: `commit ${shortSha(root, headSha)} (${(commits[0]?.subject ?? "").slice(0, 72)})`,
    pr: `PR #${prNumber} (${pr?.title ?? ""}) vs ${pr?.baseBranch ?? ""} @ ${shortSha(root, mergeBase)}`,
  };

  const checkedOut = git(root, ["rev-parse", "HEAD"]) === headSha;
  const fileAccess =
    (finalMode === "commit" || finalMode === "pr" || finalMode === "branch") && !checkedOut
      ? `not checked out: read files with git show ${shortSha(root, headSha)}:<path>`
      : "working tree";

  let codeGraph: string | null = null;
  for (let p = root; p !== dirname(p); p = dirname(p)) {
    if (existsSync(join(p, ".codegraph"))) {
      codeGraph = `${p.replaceAll("\\", "/")}/.codegraph`;
      break;
    }
  }

  return {
    mode: finalMode,
    scope: scopeLabel[finalMode],
    ...(note ? { note } : {}),
    repo: root,
    baseRef,
    mergeBase,
    headSha,
    headLabel: checkedOut ? currentBranch : (target ?? "?"),
    diffCommand: `git diff ${range.join(" ")}`,
    fileAccess,
    size,
    files,
    reviewOrder: reviewOrder(files),
    skipped,
    additions,
    deletions,
    changedLines,
    renames,
    commits,
    ...(pr ? { pr } : {}),
    contract: existsSync(join(root, "plumbline.yml")) ? "plumbline.yml" : null,
    adrs: context.adrs,
    ruleFiles: context.rules,
    lessonFiles: context.lessonFiles,
    lensFiles: context.lensFiles,
    codeGraph,
  };
}

/** Human-readable scope, in the same order the reviewers read it. */
export function formatScope(s: ScopeResult): string {
  const list = (items: string[]) => (items.length > 0 ? items.map((i) => `  ${i}`) : ["  (none)"]);
  const fileLine = (f: ScopeFile) => `${f.status.padEnd(2)}  ${f.path}  +${f.additions}/-${f.deletions}`;
  const lines = [
    `SCOPE: ${s.scope}`,
    ...(s.note ? [`NOTE: ${s.note}`] : []),
    `REPO: ${s.repo}`,
    `BASE: ${s.baseRef ?? "none"} -> merge base ${s.mergeBase.slice(0, 7)}`,
    `HEAD: ${s.headSha.slice(0, 7)} (${s.headLabel})`,
    `DIFF: ${s.diffCommand}${s.mode === "worktree" ? "    # working tree vs merge base; read untracked files in full" : ""}`,
    `FILE ACCESS: ${s.fileAccess}`,
    `SIZE: ${s.size} - ${s.files.length} files, +${s.additions}/-${s.deletions} (${s.changedLines} changed lines, skipped files excluded)`,
    "FILES (diff order):",
    ...list(s.files.map(fileLine)),
    "REVIEW ORDER (riskiest first):",
    ...list(s.reviewOrder ?? []),
  ];
  if (s.skipped.length > 0) lines.push("SKIPPED (lockfile, generated or binary):", ...list(s.skipped.map(fileLine)));
  if (s.pr) lines.push(`PR: ${s.pr.url}`, "PR BODY (first 60 lines):", ...s.pr.body.split("\n").map((l) => `  ${l}`));
  if (s.commits.length > 0) lines.push("COMMITS (oldest first):", ...s.commits.map((c) => `  ${c.sha} ${c.subject}`));
  lines.push(
    `CONTRACT: ${s.contract ?? "(none)"}`,
    "ADRS:",
    ...list(s.adrs),
    "RULE FILES:",
    ...list(s.ruleFiles),
    "LESSON FILES:",
    ...list(s.lessonFiles),
    "CUSTOM LENSES:",
    ...list(s.lensFiles),
    `CODE GRAPH: ${s.codeGraph ?? "not found"}`,
  );
  return lines.join("\n");
}
