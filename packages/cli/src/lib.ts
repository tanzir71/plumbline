import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_FILE,
  buildGraph,
  checkContract,
  contractAt,
  createRun,
  currentRun,
  emptyContract,
  finalizeReport,
  findRun,
  hashFile,
  loadContract,
  loadLenses,
  parseContract,
  readRunJson,
  repoRoot,
  resolveScope,
  runDeterministic,
  writeReport,
  writeRunJson,
  type CheckResult,
  type Contract,
  type GraphRun,
  type Lens,
  type RecordedProof,
  type ReportV1,
  type RunDir,
  type ScopeResult,
} from "@plumbline/core";
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

const OUTPUT_LIMIT = 8000;

/**
 * git reports a repo's real path, but the working directory can reach it another way: a symlink,
 * a junction, or a Windows 8.3 short name. Compare real paths so those don't look like different folders.
 */
const canonical = (path: string) => (existsSync(path) ? realpathSync.native(path) : path);

export function lensDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const shipped = join(here, "..", "lenses");
  return existsSync(shipped) ? shipped : join(here, "..", "..", "..", "skills", "plumbline", "lenses");
}

export function listLenses(root?: string): Lens[] {
  return loadLenses(lensDir(), root);
}

interface RunMeta {
  startedAt: string;
  target?: string;
  base?: string;
}

export interface ScopeArgs {
  cwd: string;
  target?: string;
  base?: string;
}

/** Pin the scope and start a new run directory. */
export function startScope(args: ScopeArgs): { scope: ScopeResult; run: RunDir } {
  const scope = resolveScope(args);
  const run = createRun(scope.repo);
  const meta: RunMeta = { startedAt: new Date().toISOString(), target: args.target, base: args.base };
  writeRunJson(run, "run.json", meta);
  writeRunJson(run, "scope.json", scope);
  return { scope, run };
}

/** Which contract judges this run. CI passes "base" so a PR cannot relax its own rules. */
export function contractFor(scope: ScopeResult, source: "head" | "base"): Contract {
  return contractAt(scope.repo, source === "base" ? scope.mergeBase : null);
}

export interface GraphArgs extends ScopeArgs {
  contractFrom?: "head" | "base";
}

/** Reuse the latest run when it covers the same commits and has no report yet, so one review stays in one directory. */
function continueOrStart(args: ScopeArgs): { scope: ScopeResult; run: RunDir } {
  const scope = resolveScope(args);
  const latest = findRun(scope.repo);
  if (latest && !existsSync(join(latest.dir, "report.json"))) {
    const prior = readRunJson<ScopeResult>(latest, "scope.json");
    if (prior?.headSha === scope.headSha && prior.mergeBase === scope.mergeBase && prior.mode === scope.mode) {
      writeRunJson(latest, "scope.json", scope);
      return { scope, run: latest };
    }
  }
  return startScope(args);
}

export async function runGraph(args: GraphArgs): Promise<{ scope: ScopeResult; run: RunDir; graph: GraphRun }> {
  const { scope, run } = continueOrStart(args);
  const graph = await runDeterministic(scope, contractFor(scope, args.contractFrom ?? "head"));
  writeRunJson(run, "graph.json", graph.diff);
  writeRunJson(run, "check.json", graph.check);
  return { scope, run, graph };
}

export interface CheckArgs {
  cwd: string;
  semgrep?: boolean;
  allowCustomChecks?: boolean;
  /** Check a draft contract at this path instead of `plumbline.yml`. */
  contract?: string;
}

/** Evaluate the contract against the current tree. Needs no base branch. */
export async function runCheck(args: CheckArgs): Promise<{ result: CheckResult; run: RunDir; hasContract: boolean }> {
  const root = canonical(repoRoot(args.cwd));
  const contract = args.contract ? loadContract(root, canonical(resolve(args.cwd, args.contract))) : loadContract(root);
  if (args.contract && !contract) throw new Error(`contract not found: ${args.contract}`);
  const graph = await buildGraph(root);
  const result = checkContract(graph, contract ?? emptyContract(), {
    root,
    runSemgrep: args.semgrep,
    allowCustomChecks: args.allowCustomChecks,
  });
  const run = currentRun(root);
  writeRunJson(run, "check.json", result);
  return { result, run, hasContract: contract !== null };
}

export interface ProveArgs {
  cwd: string;
  test: string;
  command: string[];
  run?: string;
  /** Set after running the same test on the base commit. */
  passedOnBase?: boolean;
}

/** Run a proof test and record what actually happened. Only these records satisfy the proof gate. */
export function runProve(args: ProveArgs): RecordedProof {
  const root = canonical(repoRoot(args.cwd));
  const test = canonical(resolve(args.cwd, args.test));
  const ref = relative(root, test).replaceAll("\\", "/");
  if (!ref.startsWith(".plumbline/proofs/")) throw new Error("proof tests must live under .plumbline/proofs/");
  if (!existsSync(test)) throw new Error(`test not found: ${args.test}`);
  if (args.command.length === 0) throw new Error("pass the test command after --");

  const options = { cwd: root, encoding: "utf8", timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true } as const;
  // Windows needs a shell to run .cmd shims such as npm and pnpm, so quote the arguments for it.
  const quote = (a: string) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
  const [cmd, ...rest] = args.command as [string, ...string[]];
  const result =
    process.platform === "win32"
      ? spawnSync(args.command.map(quote).join(" "), { ...options, shell: true })
      : spawnSync(cmd, rest, options);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const record: RecordedProof = {
    ref,
    sha256: hashFile(test),
    headSha: resolveHead(root),
    command: args.command.join(" "),
    exitCode: result.status ?? 1,
    output: output.length > OUTPUT_LIMIT ? output.slice(-OUTPUT_LIMIT) : output,
    ...(args.passedOnBase === undefined ? {} : { passedOnBase: args.passedOnBase }),
    recordedAt: new Date().toISOString(),
  };

  const run = findRun(root, args.run) ?? createRun(root);
  const prior = readRunJson<RecordedProof[]>(run, "proofs.json") ?? [];
  writeRunJson(run, "proofs.json", [...prior.filter((p) => p.ref !== ref), record]);
  return record;
}

function resolveHead(root: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  return result.stdout.trim();
}

export interface ReportArgs {
  cwd: string;
  run?: string;
  findings?: string;
  /** Inline findings, used by the MCP tool. */
  findingsValue?: unknown;
  base?: string;
  baseBranch?: string;
  contractFrom?: "head" | "base";
  useGate?: boolean;
  useLane?: boolean;
}

export interface ReportOutput {
  report: ReportV1;
  run: RunDir;
  paths: Record<string, string>;
}

/**
 * Finalize a run. The scope and graph are recomputed here instead of read from the run directory,
 * so the proof gate checks model findings against the repository, not against editable files.
 */
export async function runReport(args: ReportArgs): Promise<ReportOutput> {
  const root = repoRoot(args.cwd);
  const found = findRun(root, args.run);
  if (args.run && !found) throw new Error(`run not found: ${args.run}`);
  const run = found ?? createRun(root);

  const meta = readRunJson<RunMeta>(run, "run.json");
  const scope = resolveScope({ cwd: root, target: meta?.target, base: args.base ?? meta?.base });
  const contract = contractFor(scope, args.contractFrom ?? "head");
  const graph = await runDeterministic(scope, contract);
  writeRunJson(run, "scope.json", scope);
  writeRunJson(run, "graph.json", graph.diff);
  writeRunJson(run, "check.json", graph.check);

  let modelFile: unknown = args.findingsValue;
  if (modelFile === undefined && args.findings) modelFile = JSON.parse(readFileSync(resolve(args.cwd, args.findings), "utf8"));
  if (modelFile === undefined) modelFile = readRunJson<unknown>(run, "findings.json") ?? undefined;
  if (modelFile !== undefined) writeRunJson(run, "findings.json", modelFile);

  const lenses = listLenses(root);
  const report = finalizeReport({
    runId: run.id,
    startedAt: new Date(meta?.startedAt ?? Date.now()),
    version: VERSION,
    scope,
    contract,
    graph,
    modelFile,
    recordedProofs: readRunJson<RecordedProof[]>(run, "proofs.json") ?? [],
    baseBranch: args.baseBranch,
    useGate: args.useGate,
    useLane: args.useLane,
    lenses,
  });
  const paths = writeReport(run, report, lenses);
  return { report, run, paths };
}

const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor", "test", "tests", "__tests__", "__mocks__", "fixtures", "public", "assets", "static", "types"]);

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith(".") && !IGNORED_DIRS.has(n) && statSync(join(dir, n)).isDirectory())
    .sort();
}

/** Guess modules from the folder structure. */
export function guessModules(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const parent of ["src", "lib", "app"]) {
    for (const name of subdirs(join(root, parent))) out[name] ??= `${parent}/${name}/**`;
  }
  for (const parent of ["packages", "apps", "services"]) {
    for (const name of subdirs(join(root, parent))) out[name] ??= `${parent}/${name}/**`;
  }
  return out;
}

export function renderSkeleton(modules: Record<string, string>): string {
  const names = Object.keys(modules);
  const width = Math.max(0, ...names.map((n) => yamlKey(n).length));
  const moduleLines =
    names.length > 0
      ? names.map((n) => `  ${`${yamlKey(n)}:`.padEnd(width + 2)}["${modules[n]}"]`).join("\n")
      : '  # app: ["src/app/**"]';
  return `# Plumbline architecture contract. Docs: https://tanzir71.github.io/plumbline/docs/contract/
version: 1

# Module name -> globs. These were guessed from your folders, so check them.
modules:${names.length > 0 ? "" : " {}"}
${moduleLines}

# Top to bottom. A lower layer may not import a higher one.
# layers:
#   - [api]
#   - [billing, orgs]
#   - [db]

# Rules Plumbline can prove, plus judgement calls for the model.
# rules:
#   - id: no-billing-to-orgs
#     forbid: billing -> orgs
#     because: "ADR-012: billing ships on its own"
#   - id: tenant-scope
#     require: "repository methods scope queries by org_id"
#     check: llm
#     paths: ["src/**/repo/**"]

proof:
  P0: [failing_test, graph_diff]
  P1: [failing_test, graph_diff, broken_rule]

# Fail the CI job when the merge score is below the minimum.
# gate:
#   - branches: ["main", "release/*"]
#     min_merge_score: 3

# Label low-risk PRs. A lane never approves or merges.
lanes:
  light:
    label: "plumbline:light-review"
    when: { merge_score: 5, max_severity: P3, max_changed_lines: 200 }
    never: ["**/migrations/**", ".github/**"]
`;
}

const yamlKey = (name: string) => (/^[\w/-]+$/.test(name) ? name : JSON.stringify(name));

export function runInit(cwd: string, force = false): { file: string; modules: string[]; content: string } {
  const root = repoRoot(cwd);
  const file = join(root, CONTRACT_FILE);
  if (existsSync(file) && !force) throw new Error(`${CONTRACT_FILE} already exists (use --force to replace it)`);
  const modules = guessModules(root);
  const content = renderSkeleton(modules);
  parseContract(content);
  writeFileSync(file, content);
  return { file, modules: Object.keys(modules), content };
}
