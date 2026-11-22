import { fork } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseOptions, type ICruiseResult } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import { exportTree } from "../git.js";
import type { GraphEdge, ImportGraph } from "../types.js";

const EXCLUDE =
  "(^|/)(node_modules|dist|build|out|coverage|vendor|\\.git|\\.next|\\.nuxt|\\.astro|\\.plumbline|\\.turbo|\\.cache)/|\\.d\\.ts$";

const toPosix = (p: string) => p.replaceAll("\\", "/").replace(/^\.\//, "");

function isLocal(resolved: string, coreModule: boolean, couldNotResolve: boolean): boolean {
  return !coreModule && !couldNotResolve && !toPosix(resolved).includes("node_modules/");
}

let cruising: Promise<unknown> = Promise.resolve();

/**
 * dependency-cruiser resolves tsconfig `paths` without a `baseUrl` from the process working directory.
 * Run one pass at a time from the graph's own folder, so aliases cannot resolve into another checkout.
 */
function fromDirectory<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const next = cruising.then(async () => {
    const previous = process.cwd();
    process.chdir(dir);
    try {
      return await work();
    } finally {
      process.chdir(previous);
    }
  });
  cruising = next.catch(() => undefined);
  return next;
}

/** Build the file-level import graph of a directory with dependency-cruiser. */
export async function buildGraph(dir: string): Promise<ImportGraph> {
  const options: ICruiseOptions = {
    baseDir: dir,
    exclude: { path: EXCLUDE },
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    // Plumbline does its own cycle and rule analysis, so skip dependency-cruiser's.
    skipAnalysisNotInRules: true,
    moduleSystems: ["es6", "cjs"],
    metrics: false,
    validate: false,
  };

  let transpile: { tsConfig: ReturnType<typeof extractTSConfig> } | undefined;
  const tsconfig = join(dir, "tsconfig.json");
  if (existsSync(tsconfig)) {
    try {
      transpile = { tsConfig: extractTSConfig(tsconfig) };
      options.tsConfig = { fileName: tsconfig };
    } catch {
      // An `extends` into an uninstalled package is common on an exported tree.
      // Relative imports still resolve, so carry on without path aliases.
      transpile = undefined;
    }
  }

  const { output } = await fromDirectory(dir, () => cruise(["."], options, {}, transpile));
  const result = output as ICruiseResult;
  const files = new Set<string>();
  const edges = new Map<string, GraphEdge>();

  for (const mod of result.modules) {
    const from = toPosix(mod.source);
    if (mod.coreModule || from.includes("node_modules/") || mod.couldNotResolve) continue;
    files.add(from);
    for (const dep of mod.dependencies) {
      if (!isLocal(dep.resolved, dep.coreModule, dep.couldNotResolve)) continue;
      const to = toPosix(dep.resolved);
      const typeOnly = dep.dependencyTypes.includes("type-only") || dep.dependencyTypes.includes("pre-compilation-only");
      const key = `${from}\0${to}`;
      const prior = edges.get(key);
      // A pair imported both ways counts as a runtime edge.
      edges.set(key, { from, to, typeOnly: prior ? prior.typeOnly && typeOnly : typeOnly });
    }
  }

  return {
    files: [...files].sort(),
    edges: [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}

/** Build a graph in a child process when the built worker is available, otherwise in this process. */
export function buildGraphIsolated(dir: string): Promise<ImportGraph> {
  const worker = fileURLToPath(new URL("./graph/worker.js", import.meta.url));
  if (!existsSync(worker)) return buildGraph(dir);

  return new Promise((resolvePromise, reject) => {
    const child = fork(worker, [], { stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "advanced" });
    let settled = false;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("message", (reply: { ok: true; graph: ImportGraph } | { ok: false; error: string }) => {
      settled = true;
      if (reply.ok) resolvePromise(reply.graph);
      else reject(new Error(reply.error));
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!settled) reject(new Error(`graph worker exited with ${code}: ${stderr.trim()}`));
    });
    child.send({ dir });
  });
}

/** Build the graph of a git ref without touching the working tree. */
export async function buildGraphAtRef(repo: string, ref: string): Promise<ImportGraph> {
  const dest = mkdtempSync(join(tmpdir(), "plumbline-graph-"));
  try {
    const written = await exportTree(repo, ref, dest);
    if (written === 0) return { files: [], edges: [] };
    return await buildGraphIsolated(dest);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}
