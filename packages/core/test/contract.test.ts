import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContractError, loadContract, parseContract } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

const FULL = `version: 1
modules:                     # name -> globs
  api:            ["src/api/**"]
  billing:        ["src/billing/**"]
  orgs:           ["src/orgs/**"]
  users/session:  ["src/users/session/**"]
  db:             ["src/db/**"]
layers:                      # top -> bottom; a lower layer may not import a higher one
  - [api]
  - [billing, orgs, "users/*"]
  - [db]
rules:
  - id: no-billing-to-users
    forbid: billing -> users/*
    because: "ADR-012: billing ships on its own"
  - id: tenant-scope
    require: "repository methods scope queries by org_id"
    check: llm               # llm | semgrep | custom
    paths: ["src/**/repo/**"]
proof:
  P0: [failing_test, graph_diff]
  P1: [failing_test, graph_diff, broken_rule]
gate:                        # merge gating
  - branches: ["main", "release/*"]
    min_merge_score: 3
lanes:                       # risk lanes: a label only, never approval
  light:
    label: "plumbline:light-review"
    when: { merge_score: 5, max_severity: P3, max_changed_lines: 200 }
    never: ["**/migrations/**", ".github/**", "src/billing/**"]
`;

function issuesOf(text: string) {
  try {
    parseContract(text);
  } catch (e) {
    if (e instanceof ContractError) return e.issues;
    throw e;
  }
  throw new Error("expected a ContractError");
}

describe("parseContract", () => {
  it("accepts the full v1 example from the spec", () => {
    const c = parseContract(FULL);
    expect(Object.keys(c.modules)).toHaveLength(5);
    expect(c.rules).toHaveLength(2);
    expect(c.gate[0]?.min_merge_score).toBe(3);
    expect(c.lanes.light.never).toContain("src/billing/**");
  });

  it("fills defaults for a minimal contract", () => {
    const c = parseContract("version: 1\n");
    expect(c.proof.P0).toEqual(["failing_test", "graph_diff"]);
    expect(c.proof.P1).toEqual(["failing_test", "graph_diff", "broken_rule"]);
    expect(c.lanes.light).toEqual({
      label: "plumbline:light-review",
      when: { merge_score: 5, max_severity: "P3", max_changed_lines: 200 },
      never: [],
    });
  });

  it("reports the exact line of a schema error", () => {
    const [issue] = issuesOf("version: 1\ngate:\n  - branches: [main]\n    min_merge_score: 9\n");
    expect(issue?.line).toBe(4);
    expect(issue?.path).toBe("gate.0.min_merge_score");
  });

  it("reports the line of an unknown forbid target", () => {
    const issues = issuesOf('version: 1\nmodules:\n  a: ["a/**"]\nrules:\n  - id: r\n    forbid: a -> nope\n');
    expect(issues[0]?.line).toBe(6);
    expect(issues[0]?.message).toContain('"nope" matches no module');
  });

  it("reports YAML syntax errors with a line", () => {
    const [issue] = issuesOf("version: 1\nmodules: [\n");
    expect(issue?.line).toBeGreaterThanOrEqual(2);
  });

  it("rejects duplicate rule ids", () => {
    const issues = issuesOf('version: 1\nmodules:\n  a: ["a/**"]\n  b: ["b/**"]\nrules:\n  - id: r\n    forbid: a -> b\n  - id: r\n    forbid: b -> a\n');
    expect(issues[0]?.message).toContain("duplicate rule id");
    expect(issues[0]?.line).toBe(8);
  });

  it("rejects a module placed in two layers", () => {
    const issues = issuesOf('version: 1\nmodules:\n  a: ["a/**"]\nlayers:\n  - [a]\n  - [a]\n');
    expect(issues[0]?.message).toContain("already in layer 1");
  });

  it("rejects unknown keys", () => {
    expect(issuesOf("version: 1\nnope: true\n")[0]?.message).toMatch(/nope/);
  });

  it("rejects other versions", () => {
    expect(issuesOf("version: 2\n")[0]?.path).toBe("version");
  });

  it("keeps the landing page snippet valid", () => {
    const snippets = JSON.parse(readFileSync(join(here, "../../../site/src/data/snippets.json"), "utf8"));
    expect(() => parseContract(snippets.contract)).not.toThrow();
  });
});

describe("loadContract extends", () => {
  function repo(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), "plumbline-extends-"));
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), body);
    }
    return root;
  }

  it("merges a shared contract, with the child winning", () => {
    const root = repo({
      "shared/base.yml": 'version: 1\nmodules:\n  a: ["a/**"]\n  b: ["b/**"]\nrules:\n  - id: r1\n    forbid: a -> b\ngate:\n  - branches: [main]\n    min_merge_score: 3\n',
      "plumbline.yml": 'version: 1\nextends: ./shared/base.yml\nmodules:\n  c: ["c/**"]\nrules:\n  - id: r2\n    forbid: c -> a\n',
    });
    const c = loadContract(root);
    expect(Object.keys(c?.modules ?? {}).sort()).toEqual(["a", "b", "c"]);
    expect(c?.rules.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(c?.gate[0]?.min_merge_score).toBe(3);
  });

  it("refuses remote contracts", () => {
    const root = repo({ "plumbline.yml": "version: 1\nextends: https://example.com/x.yml\n" });
    expect(() => loadContract(root)).toThrow(/local path/);
  });

  it("refuses paths outside the repo", () => {
    const root = repo({ "plumbline.yml": "version: 1\nextends: ../outside.yml\n" });
    expect(() => loadContract(root)).toThrow(/inside the repository/);
  });

  it("detects a loop", () => {
    const root = repo({
      "plumbline.yml": "version: 1\nextends: ./b.yml\n",
      "b.yml": "version: 1\nextends: ./plumbline.yml\n",
    });
    expect(() => loadContract(root)).toThrow(/loop/);
  });
});
