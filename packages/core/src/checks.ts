import { execFileSync, spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { isForbidRule, parseForbid, type Contract, type RequireRule } from "./contract/schema.js";
import { findCycles, toAdjacency } from "./graph/cycles.js";
import { formatCycle, moduleEdges } from "./graph/diff.js";
import { ModuleMap, layerIndex } from "./graph/modules.js";
import type { CheckResult, Cycle, Finding, GraphDiff, ImportGraph, Proof, Severity, Violation } from "./types.js";

export interface CheckOptions {
  /** Repo root. Needed to run semgrep and custom rules. */
  root?: string;
  /** Run `check: semgrep` rules when Semgrep is installed. */
  runSemgrep?: boolean;
  /** Run `check: custom` commands. Off by default because they execute code from the contract. */
  allowCustomChecks?: boolean;
}

function runExternal(rule: RequireRule, opts: CheckOptions): { violation?: Violation; skipped?: string } {
  const root = opts.root;
  if (!root) return { skipped: "no repo root available" };

  if (rule.check === "custom") {
    if (!opts.allowCustomChecks) return { skipped: "custom checks only run with --allow-custom-checks" };
    const run = spawnSync(rule.command as string, { cwd: root, shell: true, encoding: "utf8", windowsHide: true });
    if (run.status === 0) return {};
    return {
      violation: {
        ruleId: rule.id,
        kind: "forbid",
        from: rule.paths?.join(", ") ?? ".",
        to: rule.require,
        fromModule: "",
        toModule: "",
        because: rule.because,
        message: `custom check failed: ${(run.stderr || run.stdout || "").trim().split("\n")[0] ?? ""}`,
        typeOnly: false,
      },
    };
  }

  if (!opts.runSemgrep) return { skipped: "semgrep rules only run with --semgrep" };
  const config = resolve(root, rule.config as string);
  const rel = relative(root, config);
  if (rel.startsWith("..") || isAbsolute(rel)) return { skipped: "semgrep config must be a path inside the repo" };
  try {
    execFileSync("semgrep", ["--version"], { stdio: "ignore", windowsHide: true });
  } catch {
    return { skipped: "semgrep is not installed" };
  }
  const run = spawnSync("semgrep", ["--config", config, "--metrics=off", "--error", "--quiet", ...(rule.paths ?? ["."])], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (run.status === 0) return {};
  if (run.status !== 1) return { skipped: `semgrep exited with ${run.status}` };
  return {
    violation: {
      ruleId: rule.id,
      kind: "forbid",
      from: rule.paths?.join(", ") ?? ".",
      to: rule.require,
      fromModule: "",
      toModule: "",
      because: rule.because,
      message: "semgrep reported matches",
      typeOnly: false,
    },
  };
}

/** Evaluate the contract's deterministic rules against one graph. No model involved. */
export function checkContract(graph: ImportGraph, contract: Contract, opts: CheckOptions = {}): CheckResult {
  const map = new ModuleMap(contract.modules);
  const layers = layerIndex(contract, map);
  const forbids = contract.rules.filter(isForbidRule).map((rule) => {
    const { from, to } = parseForbid(rule.forbid);
    return { rule, from: new Set(map.matchNames(from)), to: new Set(map.matchNames(to)) };
  });

  const violations: Violation[] = [];
  for (const edge of graph.edges) {
    const fromModule = map.moduleOf(edge.from);
    const toModule = map.moduleOf(edge.to);
    if (!fromModule || !toModule || fromModule === toModule) continue;

    for (const { rule, from, to } of forbids) {
      if (!from.has(fromModule) || !to.has(toModule)) continue;
      violations.push({
        ruleId: rule.id,
        kind: "forbid",
        from: edge.from,
        to: edge.to,
        fromModule,
        toModule,
        because: rule.because,
        message: `${fromModule} -> ${toModule} is forbidden by rule ${rule.id}`,
        typeOnly: edge.typeOnly,
      });
    }

    const fromLayer = layers.get(fromModule);
    const toLayer = layers.get(toModule);
    if (fromLayer !== undefined && toLayer !== undefined && fromLayer > toLayer) {
      violations.push({
        ruleId: `layers:${fromModule}->${toModule}`,
        kind: "layer",
        from: edge.from,
        to: edge.to,
        fromModule,
        toModule,
        message: `${fromModule} (layer ${fromLayer + 1}) may not import ${toModule} (layer ${toLayer + 1})`,
        typeOnly: edge.typeOnly,
      });
    }
  }

  const llmRules: CheckResult["llmRules"] = [];
  const skippedRules: CheckResult["skippedRules"] = [];
  for (const rule of contract.rules) {
    if (isForbidRule(rule)) continue;
    if (rule.check === "llm") {
      llmRules.push({ id: rule.id, require: rule.require, paths: rule.paths, because: rule.because });
      continue;
    }
    const outcome = runExternal(rule, opts);
    if (outcome.violation) violations.push(outcome.violation);
    if (outcome.skipped) skippedRules.push({ id: rule.id, reason: outcome.skipped });
  }

  const runtime = graph.edges.filter((e) => !e.typeOnly);
  const cycles: Cycle[] = [
    ...findCycles(toAdjacency(runtime)).map((path) => ({ level: "file" as const, path })),
    ...findCycles(toAdjacency(moduleEdges({ files: graph.files, edges: runtime }, map))).map((path) => ({
      level: "module" as const,
      path,
    })),
  ];

  return { violations, llmRules, skippedRules, cycles };
}

interface RootCause {
  key: string;
  cycles: Cycle[];
  violations: Violation[];
}

/**
 * The one module a rule-free file cycle stays inside, or "" when its files have no declared module.
 * Returns null when the cause breaks a rule or crosses a module boundary.
 */
function localScope(cause: RootCause, map: ModuleMap | null): string | null {
  if (cause.violations.length > 0 || cause.cycles.length === 0) return null;
  if (cause.cycles.some((c) => c.level !== "file")) return null;
  const modules = new Set(cause.cycles.flatMap((c) => c.path.flatMap((file) => map?.moduleOf(file) ?? [])));
  return modules.size > 1 ? null : ([...modules][0] ?? "");
}

/** Local cycles that share a file in the same scope are one tangle, so they become one root cause. */
function groupLocalCycles(causes: RootCause[], map: ModuleMap | null): RootCause[] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    for (let next = parent.get(root); next !== undefined && next !== root; next = parent.get(root)) root = next;
    parent.set(node, root);
    return root;
  };

  const nodeOf = new Map<RootCause, string>();
  for (const cause of causes) {
    const scope = localScope(cause, map);
    if (scope === null) continue;
    const nodes = cause.cycles.flatMap((c) => c.path).map((file) => `${scope}\0${file}`);
    const first = nodes[0] as string;
    for (const node of nodes) parent.set(find(node), find(first));
    nodeOf.set(cause, first);
  }

  const groups = new Map<string, RootCause>();
  const grouped: RootCause[] = [];
  for (const cause of causes) {
    const node = nodeOf.get(cause);
    if (node === undefined) {
      grouped.push(cause);
      continue;
    }
    const root = find(node);
    const group = groups.get(root);
    if (group) {
      group.cycles.push(...cause.cycles);
      if (cause.key < group.key) group.key = cause.key;
    } else {
      const created = { ...cause, cycles: [...cause.cycles] };
      groups.set(root, created);
      grouped.push(created);
    }
  }
  return grouped;
}

/**
 * Turn what this PR introduced into findings. Violations that already existed at base are not findings.
 * One new dependency between two modules is one root cause, so it is one finding and costs the score once,
 * however many views show it: a file cycle, a module cycle, a forbid rule and a layer rule.
 * Connected cycles inside one module are also one root cause, at the contract's `cycles.within_module` severity.
 */
export function deterministicFindings(diff: GraphDiff, check: CheckResult, contract?: Contract): Finding[] {
  const map = contract ? new ModuleMap(contract.modules) : null;
  const withinModule: Severity = contract?.cycles.within_module ?? "P2";
  const addedKeys = new Set(diff.added.map((e) => `${e.from}\0${e.to}`));
  const causes = new Map<string, RootCause>();

  const causeFor = (from: string, to: string): RootCause => {
    const a = map?.moduleOf(from);
    const b = map?.moduleOf(to);
    const key = a && b && a !== b ? `${a} -> ${b}` : `${from} -> ${to}`;
    let cause = causes.get(key);
    if (!cause) {
      cause = { key, cycles: [], violations: [] };
      causes.set(key, cause);
    }
    return cause;
  };

  for (const cycle of diff.newCycles) {
    const [first = "", second = ""] = cycle.path;
    const edge = cycle.closedBy ?? { from: first, to: second };
    if (cycle.level === "file") {
      causeFor(edge.from, edge.to).cycles.push(cycle);
      continue;
    }
    const key = `${edge.from} -> ${edge.to}`;
    const cause = causes.get(key) ?? { key, cycles: [], violations: [] };
    cause.cycles.push(cycle);
    causes.set(key, cause);
  }

  for (const v of check.violations) {
    if (addedKeys.has(`${v.from}\0${v.to}`)) causeFor(v.from, v.to).violations.push(v);
  }

  return groupLocalCycles([...causes.values()], map).map((cause) => {
    const { key, cycles, violations } = cause;
    const local = localScope(cause, map) !== null;
    // The module-level path is the one that names the architecture.
    const cycle = cycles.find((c) => c.level === "module") ?? cycles[0];
    const fileCycle = cycles.find((c) => c.level === "file");
    const closing = cycles.flatMap((c) => (c.level === "file" && c.closedBy ? [`${c.closedBy.from} -> ${c.closedBy.to}`] : []));
    const edges = [...new Set([...closing, ...violations.map((v) => `${v.from} -> ${v.to}`)])];

    const rules = [...new Map(violations.map((v) => [v.ruleId, v])).values()];
    const forbid = rules.find((v) => v.kind === "forbid");
    const named = forbid ?? rules[0];
    let title: string;
    if (cycle && local && cycles.length > 1) title = `New imports create ${cycles.length} connected cycles, including ${formatCycle(cycle)}`;
    else if (cycle) title = `New import creates a cycle: ${formatCycle(cycle)}`;
    else if (forbid) title = `Forbidden import: ${forbid.fromModule} -> ${forbid.toModule}`;
    else title = `Layer violation: ${named?.fromModule} imports ${named?.toModule}`;

    const body = [
      edges.length > 0 ? `New import${edges.length > 1 ? "s" : ""}: ${edges.join(", ")}.` : `New dependency: ${key}.`,
      ...cycles.map((c) => `Closes a ${c.level}-level loop: ${formatCycle(c)}.`),
      ...rules.map((v) => `${v.message}.${v.because ? ` ${v.because}.` : ""}`),
    ].join(" ");

    const proof: Proof[] = [
      ...cycles.map((c) => ({ kind: "graph_diff" as const, ref: formatCycle(c), detail: "cycle not present at base" })),
      ...rules.map((v) => ({ kind: "broken_rule" as const, ref: v.ruleId, detail: v.because ?? v.message })),
      ...edges.map((ref) => ({ kind: "graph_diff" as const, ref, detail: "edge added in this change" })),
    ];

    return {
      id: `dependency:${key}`,
      severity: local ? withinModule : ("P1" as const),
      lens: "L02",
      title,
      body,
      file: violations[0]?.from ?? fileCycle?.closedBy?.from,
      source: "deterministic" as const,
      proof,
    };
  });
}
