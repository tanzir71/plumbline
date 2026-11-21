import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, expected, materialize } from "../../../fixtures/materialize.mjs";
import {
  applyRenames,
  canonicalCycle,
  checkContract,
  contractAt,
  deterministicFindings,
  diffGraphs,
  emptyContract,
  findCycles,
  loadContract,
  parseContract,
  resolveScope,
  runDeterministic,
  toAdjacency,
} from "../src/index.js";

async function analyse(name: string) {
  const repo = materialize(name);
  const scope = resolveScope({ cwd: repo, base: "main" });
  const contract = contractAt(repo, scope.mergeBase);
  const run = await runDeterministic(scope, contract);
  return { repo, scope, contract, run, findings: deterministicFindings(run.diff, run.check, contract) };
}

describe("cycle helpers", () => {
  it("canonicalises rotations", () => {
    expect(canonicalCycle(["b", "c", "a", "b"])).toEqual(["a", "b", "c", "a"]);
  });

  it("finds one shortest cycle per component", () => {
    const adj = toAdjacency([
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
      { from: "x", to: "x" },
      { from: "p", to: "q" },
    ]);
    expect(findCycles(adj)).toEqual([
      ["a", "b", "a"],
      ["x", "x"],
    ]);
  });

  it("survives a very deep chain", () => {
    const edges = Array.from({ length: 20000 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    expect(findCycles(toAdjacency(edges))).toEqual([]);
  });
});

describe("diffGraphs", () => {
  const contract = parseContract('version: 1\nmodules:\n  a: ["a/**"]\n  b: ["b/**"]\nlayers:\n  - [a]\n  - [b]\n');
  const edge = (from: string, to: string, typeOnly = false) => ({ from, to, typeOnly });

  it("reports added and removed edges", () => {
    const d = diffGraphs(
      { files: [], edges: [edge("a/1.ts", "b/1.ts")] },
      { files: [], edges: [edge("a/2.ts", "b/1.ts")] },
      contract,
    );
    expect(d.added.map((e) => e.from)).toEqual(["a/2.ts"]);
    expect(d.removed.map((e) => e.from)).toEqual(["a/1.ts"]);
  });

  it("marks only upward crossings as violations", () => {
    const d = diffGraphs(
      { files: [], edges: [] },
      { files: [], edges: [edge("a/1.ts", "b/1.ts"), edge("b/2.ts", "a/2.ts")] },
      contract,
    );
    expect(d.layerCrossings.map((c) => [c.fromModule, c.violation])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("does not count a type-only import as a runtime cycle", () => {
    const d = diffGraphs(
      { files: [], edges: [edge("a/1.ts", "a/2.ts")] },
      { files: [], edges: [edge("a/1.ts", "a/2.ts"), edge("a/2.ts", "a/1.ts", true)] },
      contract,
    );
    expect(d.newCycles).toEqual([]);
  });

  it("does not report a cycle that already existed", () => {
    const loop = [edge("a/1.ts", "a/2.ts"), edge("a/2.ts", "a/1.ts")];
    expect(diffGraphs({ files: [], edges: loop }, { files: [], edges: loop }, contract).newCycles).toEqual([]);
  });

  it("treats a renamed file as the same node", () => {
    const base = applyRenames({ files: [], edges: [edge("a/old.ts", "b/1.ts")] }, new Map([["a/old.ts", "a/new.ts"]]));
    const d = diffGraphs(base, { files: [], edges: [edge("a/new.ts", "b/1.ts")] }, contract);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe("fixtures", () => {
  it("ts-cycle reports the exact cycle path", async () => {
    const { run, findings } = await analyse("ts-cycle");
    const want = expected("ts-cycle");
    expect(run.diff.newCycles.find((c) => c.level === "file")?.path).toEqual(want.cycle);
    expect(run.diff.newCycles.find((c) => c.level === "module")?.path).toEqual(want.moduleCycle);
    // One new import is one root cause, even though it shows up as a file cycle and a module cycle.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("P1");
    expect(findings[0]?.lens).toBe("L02");
    expect(findings[0]?.title).toBe("New import creates a cycle: billing -> users/session -> billing");
    expect(findings[0]?.file).toBe("src/billing/plans.ts");
    const refs = findings[0]?.proof?.filter((p) => p.kind === "graph_diff").map((p) => p.ref);
    expect(refs).toEqual(expect.arrayContaining([want.cycle.join(" -> "), want.moduleCycle.join(" -> ")]));
  }, 60000);

  it("ts-layer-violation reports the rule ids", async () => {
    const { run, findings } = await analyse("ts-layer-violation");
    const ids = [...new Set(run.check.violations.map((v) => v.ruleId))].sort();
    expect(ids).toEqual(expected("ts-layer-violation").ruleIds);
    // The forbid rule and the layer rule break on the same import, so they are one finding citing both.
    expect(findings).toHaveLength(1);
    const cited = findings[0]?.proof?.filter((p) => p.kind === "broken_rule").map((p) => p.ref);
    expect(cited?.sort()).toEqual(["layers:db->api", "no-db-to-api"]);
    // This import also closes a loop through api and orgs, and the title names that loop.
    expect(findings[0]?.title).toBe("New import creates a cycle: api -> orgs -> db -> api");
    expect(run.diff.layerCrossings.some((c) => c.violation)).toBe(true);
  }, 60000);

  it("keeps separate root causes as separate findings", () => {
    const contract = parseContract('version: 1\nmodules:\n  a: ["a/**"]\n  b: ["b/**"]\n  c: ["c/**"]\nrules:\n  - id: r1\n    forbid: a -> b\n  - id: r2\n    forbid: a -> c\n');
    const head = {
      files: [],
      edges: [
        { from: "a/1.ts", to: "b/1.ts", typeOnly: false },
        { from: "a/2.ts", to: "b/2.ts", typeOnly: false },
        { from: "a/1.ts", to: "c/1.ts", typeOnly: false },
      ],
    };
    const diff = diffGraphs({ files: [], edges: [] }, head, contract);
    const found = deterministicFindings(diff, checkContract(head, contract), contract);
    expect(found.map((f) => f.id).sort()).toEqual(["dependency:a -> b", "dependency:a -> c"]);
    expect(found.find((f) => f.id === "dependency:a -> b")?.body).toContain("a/2.ts -> b/2.ts");
  });

  it("clean fixture reports nothing", async () => {
    const { run, findings } = await analyse("clean");
    expect(run.diff.added).toEqual([]);
    expect(run.diff.newCycles).toEqual([]);
    expect(run.check.violations).toEqual([]);
    expect(findings).toEqual([]);
  }, 60000);

  it("does not flag a violation that already existed at base", async () => {
    const repo = materialize("ts-layer-violation");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
    git("checkout", "-q", "main");
    git("merge", "-q", "--ff-only", "feat/change");
    git("checkout", "-q", "-b", "feat/other");
    writeFileSync(join(repo, "src/orgs/extra.ts"), "export const extra = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "unrelated");
    const scope = resolveScope({ cwd: repo, base: "main" });
    const run = await runDeterministic(scope, contractAt(repo, scope.mergeBase));
    expect(run.check.violations.length).toBeGreaterThan(0);
    expect(deterministicFindings(run.diff, run.check)).toEqual([]);
  }, 60000);

  it("reads the contract from the base commit, so a PR cannot relax it", async () => {
    const repo = materialize("ts-layer-violation");
    writeFileSync(join(repo, "plumbline.yml"), "version: 1\n");
    execFileSync("git", ["commit", "-qam", "remove the rules"], { cwd: repo });
    const scope = resolveScope({ cwd: repo, base: "main" });
    const contract = contractAt(repo, scope.mergeBase);
    expect(contract.rules.map((r) => r.id)).toEqual(["no-db-to-api"]);
    expect(loadContract(repo)?.rules).toEqual([]);
  }, 60000);

  it("leaves the working tree and index untouched", async () => {
    const { repo } = await analyse("ts-cycle");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    expect(execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).trim().split("\n")).toHaveLength(1);
  }, 60000);

  it("materializes every fixture", () => {
    for (const name of FIXTURE_NAMES) expect(() => materialize(name)).not.toThrow();
  }, 60000);
});

describe("checkContract", () => {
  it("does not run custom commands unless allowed", () => {
    const contract = parseContract('version: 1\nrules:\n  - id: c\n    require: "x"\n    check: custom\n    command: "exit 1"\n');
    const out = checkContract({ files: [], edges: [] }, contract, { root: process.cwd() });
    expect(out.violations).toEqual([]);
    expect(out.skippedRules[0]?.id).toBe("c");
  });

  it("runs custom commands when allowed", () => {
    const contract = parseContract('version: 1\nrules:\n  - id: c\n    require: "x"\n    check: custom\n    command: "exit 1"\n');
    const out = checkContract({ files: [], edges: [] }, contract, { root: process.cwd(), allowCustomChecks: true });
    expect(out.violations[0]?.ruleId).toBe("c");
  });

  it("returns llm rules for the reviewers", () => {
    const contract = parseContract('version: 1\nrules:\n  - id: t\n    require: "scope by org"\n');
    expect(checkContract({ files: [], edges: [] }, contract).llmRules[0]?.id).toBe("t");
  });

  it("handles an empty contract", () => {
    expect(checkContract({ files: ["a.ts"], edges: [] }, emptyContract()).violations).toEqual([]);
  });
});

describe("performance", () => {
  it("diffs a 2k-file repo in under 10s", async () => {
    const repo = mkdtempSync(join(tmpdir(), "plumbline-perf-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "fixture@example.com");
    git("config", "user.name", "Plumbline Fixture");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "plumbline.yml"), 'version: 1\nmodules:\n  a: ["src/a/**"]\n  b: ["src/b/**"]\nlayers:\n  - [a]\n  - [b]\n');
    for (let i = 0; i < 2000; i++) {
      const dir = i % 2 === 0 ? "a" : "b";
      const file = join(repo, `src/${dir}/d${i % 40}/f${i}.ts`);
      mkdirSync(dirname(file), { recursive: true });
      const next = i + 2 < 2000 ? `import { v${i + 2} } from "../d${(i + 2) % 40}/f${i + 2}.js";\n` : "";
      writeFileSync(file, `${next}export const v${i} = ${next ? `v${i + 2} + 1` : "1"};\n`);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feat/perf");
    writeFileSync(join(repo, "src/b/d1/f1.ts"), 'import { v0 } from "../../a/d0/f0.js";\nexport const v1 = v0;\n');
    git("add", "-A");
    git("commit", "-q", "-m", "change");

    // Measure the built package, because only it can use the worker processes.
    const built = await import("../dist/index.js");
    const scope = built.resolveScope({ cwd: repo, base: "main" });
    const contract = built.contractAt(repo, scope.mergeBase);

    // Wall-clock time on a shared machine is noisy, so the budget applies to the best of three runs.
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3 && best >= 10000; attempt++) {
      const started = performance.now();
      const run = await built.runDeterministic(scope, contract);
      best = Math.min(best, performance.now() - started);
      expect(run.head.files.length).toBe(2000);
      expect(run.diff.layerCrossings.some((c: { violation: boolean }) => c.violation)).toBe(true);
    }
    console.log(`graph diff on 2000 files: ${Math.round(best)}ms`);
    // Enforced in CI, on a dedicated runner, and with PLUMBLINE_PERF=1. A busy dev machine only logs the time.
    if (process.env.CI || process.env.PLUMBLINE_PERF) expect(best).toBeLessThan(10000);
  }, 180000);
});
