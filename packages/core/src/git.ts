import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_BUFFER = 256 * 1024 * 1024;

/** Run git with an argument array. No shell is involved, so refs and paths cannot inject commands. */
export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trimEnd();
}

export function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

export function refExists(cwd: string, ref: string): boolean {
  return tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

export function repoRoot(cwd: string): string {
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("not inside a git repository");
  return root;
}

export function shortSha(cwd: string, ref: string): string {
  return tryGit(cwd, ["rev-parse", "--short", ref]) ?? ref;
}

/** Read one file at a ref, or null when it does not exist there. */
export function showFile(cwd: string, ref: string, path: string): string | null {
  return tryGit(cwd, ["show", `${ref}:${path}`]);
}

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.git|\.next|\.nuxt|\.astro|\.plumbline|\.turbo|\.cache)\//;
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/;
const CONFIG = /(^|\/)(?:tsconfig[^/]*\.json|jsconfig\.json|package\.json)$/;

export function isGraphPath(path: string): boolean {
  return !SKIP_DIR.test(path) && !path.endsWith(".d.ts") && SOURCE.test(path);
}

/**
 * Write a ref's source and config files into `dest` using `git cat-file --batch`.
 * This never touches the working tree, the index or the worktree list.
 */
export async function exportTree(cwd: string, ref: string, dest: string): Promise<number> {
  const entries = git(cwd, ["ls-tree", "-r", "-z", "--full-tree", ref])
    .split("\0")
    .filter(Boolean)
    .flatMap((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, sha] = line.slice(0, tab).split(" ");
      const path = line.slice(tab + 1);
      if (type !== "blob" || mode === "120000" || !sha) return [];
      if (SKIP_DIR.test(path) || !(isGraphPath(path) || CONFIG.test(path))) return [];
      return [{ sha, path }];
    });
  if (entries.length === 0) return 0;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`git cat-file exited with ${code}`))));
    child.stdin.end(entries.map((e) => e.sha).join("\n") + "\n");
  });

  const out = Buffer.concat(chunks);
  const writes: { file: string; body: Buffer }[] = [];
  const dirs = new Set<string>();
  let at = 0;
  for (const entry of entries) {
    const eol = out.indexOf(0x0a, at);
    const size = Number(out.subarray(at, eol).toString("utf8").split(" ")[2]);
    const start = eol + 1;
    const file = join(dest, entry.path);
    dirs.add(dirname(file));
    writes.push({ file, body: out.subarray(start, start + size) });
    at = start + size + 1;
  }
  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  // Per-file open and close dominates on Windows, so write with bounded concurrency.
  let next = 0;
  const worker = async () => {
    while (next < writes.length) {
      const item = writes[next++] as { file: string; body: Buffer };
      await writeFile(item.file, item.body);
    }
  };
  await Promise.all(Array.from({ length: 32 }, worker));
  return entries.length;
}
