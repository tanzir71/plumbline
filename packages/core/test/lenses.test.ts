import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { materialize } from "../../../fixtures/materialize.mjs";
import { contractAt, finalizeReport, loadLenses, parseLens, resolveScope, runDeterministic } from "../src/index.js";

const builtin = resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills/plumbline/lenses");

const lens = (id: string, def: string, name = "Custom") =>
  `---\nid: ${id}\nname: "${name}"\ndefault: ${def}\nproof: [broken_rule]\ncatches: "x"\nexample: "y"\n---\n\n# ${id}\n`;

function repoWith(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "plumbline-lens-"));
  mkdirSync(join(root, ".plumbline", "lenses"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, ".plumbline", "lenses", name), body);
  return root;
}

describe("lenses", () => {
  it("ships the eight specified lenses, on by default, with the required sections", () => {
    const all = loadLenses(builtin);
    expect(all.map((l) => l.id)).toEqual(["L01", "L02", "L03", "L04", "L05", "L06", "L07", "L08"]);
    for (const l of all) {
      expect(l.default).toBe("on");
      expect(l.proof.length).toBeGreaterThan(0);
      expect(l.catches).not.toBe("");
      expect(l.example).not.toBe("");
      for (const heading of ["## What to look for", "## How to prove it", "## False-positive traps", "## Examples"]) {
        expect(l.body).toContain(heading);
      }
    }
  });

  it("adds a repo lens and lets a repo replace a built-in", () => {
    const root = repoWith({ "T01.md": lens("T01", '"on"'), "L01.md": lens("L01", '"on"', "Our regressions") });
    const all = loadLenses(builtin, root);
    expect(all.find((l) => l.id === "T01")?.custom).toBe(true);
    expect(all.find((l) => l.id === "L01")?.name).toBe("Our regressions");
    expect(all).toHaveLength(9);
  });

  it("reads an unquoted off as disabled", () => {
    expect(parseLens(lens("X1", "off"), "x.md").default).toBe("off");
  });

  it("rejects a lens with no frontmatter", () => {
    expect(() => parseLens("# nope", "x.md")).toThrow(/frontmatter/);
  });

  it("a disabled lens reports nothing and is listed as disabled", async () => {
    const repo = materialize("ts-cycle");
    const scope = resolveScope({ cwd: repo, base: "main" });
    const contract = contractAt(repo, scope.mergeBase);
    const graph = await runDeterministic(scope, contract);
    const base = { runId: "r", startedAt: new Date(), version: "1.0.0", scope, contract, graph };

    expect(finalizeReport({ ...base, lenses: [{ id: "L02", name: "Boundaries", default: "on" }] }).score.value).toBe(4);

    const off = finalizeReport({
      ...base,
      lenses: [{ id: "L02", name: "Boundaries", default: "off" }],
      modelFile: { reviewers: [{ id: "A", status: "complete" }], lenses: { ran: ["L02"] }, findings: [{ severity: "P2", lens: "L02", title: "t", body: "b" }] },
    });
    expect(off.findings).toEqual([]);
    expect(off.score.value).toBe(5);
    expect(off.lenses.ran).toEqual([]);
    expect(off.lenses.skipped).toContainEqual({ id: "L02", reason: "disabled" });
    expect(off.dropped.every((d) => d.reason === "lens L02 is disabled")).toBe(true);
  }, 60000);
});
