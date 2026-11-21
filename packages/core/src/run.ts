import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tryGit } from "./git.js";

const RUN_ROOT = ".plumbline/run";
const LATEST = "latest";

/** Keep run output out of `git status` without editing any tracked file. */
function excludeRunOutput(root: string): void {
  const rel = tryGit(root, ["rev-parse", "--git-path", "info/exclude"]);
  if (!rel) return;
  const file = isAbsolute(rel) ? rel : resolve(root, rel);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing = [".plumbline/run/", ".plumbline/proofs/"].filter((l) => !existing.split(/\r?\n/).includes(l));
  if (missing.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${existing && !existing.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
}

export interface RunDir {
  id: string;
  dir: string;
}

/** Start a new audit-trail directory at `.plumbline/run/<timestamp>/`. */
export function createRun(root: string, now: Date = new Date()): RunDir {
  excludeRunOutput(root);
  const base = now.toISOString().replace(/[:.]/g, "-");
  let id = base;
  for (let n = 1; existsSync(join(root, RUN_ROOT, id)); n++) id = `${base}-${n}`;
  const dir = join(root, RUN_ROOT, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, RUN_ROOT, LATEST), `${id}\n`);
  return { id, dir };
}

/** Find a run by id, or the latest. */
export function findRun(root: string, id?: string): RunDir | null {
  let runId = id;
  if (!runId) {
    const pointer = join(root, RUN_ROOT, LATEST);
    if (!existsSync(pointer)) return null;
    runId = readFileSync(pointer, "utf8").trim();
  }
  if (!/^[\w.-]+$/.test(runId)) throw new Error(`invalid run id: ${runId}`);
  const dir = join(root, RUN_ROOT, runId);
  return existsSync(dir) ? { id: runId, dir } : null;
}

export function currentRun(root: string): RunDir {
  return findRun(root) ?? createRun(root);
}

export function writeRunJson(run: RunDir, name: string, value: unknown): string {
  const file = join(run.dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

export function readRunJson<T>(run: RunDir, name: string): T | null {
  const file = join(run.dir, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}
