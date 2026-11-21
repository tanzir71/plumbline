// Builds a real git repo from a fixture: base/ on main, head/ on a feature branch.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_NAMES = [
  "ts-cycle",
  "ts-layer-violation",
  "tenancy-missing-scope",
  "unsafe-migration",
  "adr-contract",
  "clean",
];

export function materialize(name, dest = mkdtempSync(join(tmpdir(), `plumbline-${name}-`))) {
  const git = (...args) => execFileSync("git", args, { cwd: dest, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Plumbline Fixture");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  cpSync(join(FIXTURES, name, "base"), dest, { recursive: true });
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feat/change");
  const head = join(FIXTURES, name, "head");
  if (existsSync(head)) cpSync(head, dest, { recursive: true });
  const deleted = join(FIXTURES, name, "deleted.txt");
  if (existsSync(deleted)) {
    for (const file of readFileSync(deleted, "utf8").split(/\r?\n/).filter(Boolean)) rmSync(join(dest, file));
  }
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "change");
  return dest;
}

export function expected(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name, "expected.json"), "utf8"));
}
