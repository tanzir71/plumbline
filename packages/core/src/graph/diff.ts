import type { Contract } from "../contract/schema.js";
import type { Cycle, GraphDiff, GraphEdge, ImportGraph, LayerCrossing } from "../types.js";
import { canonicalCycle, findCycles, shortestPath, toAdjacency } from "./cycles.js";
import { ModuleMap, layerIndex } from "./modules.js";

const edgeKey = (e: { from: string; to: string }) => `${e.from}\0${e.to}`;

/** Rewrite base paths through a rename map so a moved file does not look like new edges. */
export function applyRenames(graph: ImportGraph, renames: Map<string, string>): ImportGraph {
  if (renames.size === 0) return graph;
  const map = (p: string) => renames.get(p) ?? p;
  return {
    files: graph.files.map(map),
    edges: graph.edges.map((e) => ({ ...e, from: map(e.from), to: map(e.to) })),
  };
}

/** Project file edges onto modules. A module edge is type-only when all its file edges are. */
export function moduleEdges(graph: ImportGraph, map: ModuleMap): GraphEdge[] {
  const out = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    const from = map.moduleOf(e.from);
    const to = map.moduleOf(e.to);
    if (!from || !to || from === to) continue;
    const key = edgeKey({ from, to });
    const prior = out.get(key);
    out.set(key, { from, to, typeOnly: prior ? prior.typeOnly && e.typeOnly : e.typeOnly });
  }
  return [...out.values()];
}

/** Cycles that exist at HEAD and were closed by an edge added since base. */
function newCyclesFor(level: Cycle["level"], base: GraphEdge[], head: GraphEdge[]): Cycle[] {
  const runtimeBase = base.filter((e) => !e.typeOnly);
  const runtimeHead = head.filter((e) => !e.typeOnly);
  const baseKeys = new Set(runtimeBase.map(edgeKey));
  const baseCycles = new Set(findCycles(toAdjacency(runtimeBase)).map((c) => c.join("\0")));
  const adj = toAdjacency(runtimeHead);
  const baseAdj = toAdjacency(runtimeBase);
  const seen = new Set<string>();
  const out: Cycle[] = [];

  for (const edge of runtimeHead) {
    if (baseKeys.has(edgeKey(edge))) continue;
    const back = shortestPath(adj, edge.to, edge.from);
    if (!back) continue;
    const path = canonicalCycle([edge.from, ...back]);
    const key = path.join("\0");
    if (seen.has(key) || baseCycles.has(key)) continue;
    // The two nodes were already on one cycle at base, so this edge adds a route, not a new loop.
    if (shortestPath(baseAdj, edge.to, edge.from) && shortestPath(baseAdj, edge.from, edge.to)) continue;
    seen.add(key);
    out.push({ level, path, closedBy: { from: edge.from, to: edge.to } });
  }
  return out;
}

export function diffGraphs(base: ImportGraph, head: ImportGraph, contract: Contract): GraphDiff {
  const baseKeys = new Set(base.edges.map(edgeKey));
  const headKeys = new Set(head.edges.map(edgeKey));
  const added = head.edges.filter((e) => !baseKeys.has(edgeKey(e)));
  const removed = base.edges.filter((e) => !headKeys.has(edgeKey(e)));

  const map = new ModuleMap(contract.modules);
  const layers = layerIndex(contract, map);
  const layerCrossings: LayerCrossing[] = [];
  for (const e of added) {
    const fromModule = map.moduleOf(e.from);
    const toModule = map.moduleOf(e.to);
    if (!fromModule || !toModule || fromModule === toModule) continue;
    const fromLayer = layers.get(fromModule);
    const toLayer = layers.get(toModule);
    if (fromLayer === undefined || toLayer === undefined || fromLayer === toLayer) continue;
    layerCrossings.push({ from: e.from, to: e.to, fromModule, toModule, fromLayer, toLayer, violation: fromLayer > toLayer });
  }

  const baseModuleEdges = moduleEdges(base, map);
  const headModuleEdges = moduleEdges(head, map);
  const baseModuleKeys = new Set(baseModuleEdges.map(edgeKey));
  const moduleEdgesAdded = headModuleEdges
    .filter((e) => !baseModuleKeys.has(edgeKey(e)))
    .map(({ from, to }) => ({ from, to }));

  return {
    added,
    removed,
    newCycles: [...newCyclesFor("file", base.edges, head.edges), ...newCyclesFor("module", baseModuleEdges, headModuleEdges)],
    layerCrossings,
    moduleEdgesAdded,
    stats: {
      baseFiles: base.files.length,
      headFiles: head.files.length,
      baseEdges: base.edges.length,
      headEdges: head.edges.length,
    },
  };
}

export function formatCycle(cycle: Cycle): string {
  return cycle.path.join(" -> ");
}
