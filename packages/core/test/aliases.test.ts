import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyContract, resolveScope, runDeterministic } from "../src/index.js";

function repoWithAliases(): string {
  const repo = mkdtempSync(join(tmpdir(), "plumbline-alias-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: repo, stdio: "ignore" });
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };
  git("init", "-q", "-b", "main");
  write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
  write("src/store.ts", 'import { cache } from "@/cache";\nexport const store = cache;\n');
  write("src/cache.ts", 'import type { store } from "@/store";\nexport type Store = typeof store;\nexport const cache = 1;\n');
  write("src/value.ts", "export const value = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feat/change");
  write("src/value.ts", "export const value = 2;\n");
  git("add", ".");
  git("commit", "-q", "-m", "change a value");
  return repo;
}

describe("tsconfig paths without a baseUrl", () => {
  it("keeps unchanged imports and existing cycles out of the diff", async () => {
    const repo = repoWithAliases();
    const cwd = process.cwd();
    const { base, head, diff } = await runDeterministic(resolveScope({ cwd: repo, base: "main" }), emptyContract());

    expect(process.cwd()).toBe(cwd);
    expect(base.edges.length).toBeGreaterThan(0);
    expect(base.edges).toEqual(head.edges);
    expect([...base.files, ...base.edges.flatMap((e) => [e.from, e.to])].every((p) => p.startsWith("src/") || p === "tsconfig.json")).toBe(true);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.newCycles).toEqual([]);
  }, 60000);
});
