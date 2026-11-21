export type Adjacency = Map<string, Set<string>>;

export function toAdjacency(edges: Iterable<{ from: string; to: string }>): Adjacency {
  const adj: Adjacency = new Map();
  for (const { from, to } of edges) {
    if (!adj.has(from)) adj.set(from, new Set());
    if (!adj.has(to)) adj.set(to, new Set());
    adj.get(from)?.add(to);
  }
  return adj;
}

/** Shortest path from `start` to `goal`, inclusive, or null. Neighbours are visited in sorted order. */
export function shortestPath(adj: Adjacency, start: string, goal: string): string[] | null {
  if (start === goal) return [start];
  const prev = new Map<string, string>();
  const seen = new Set([start]);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const n of [...(adj.get(node) ?? [])].sort()) {
        if (seen.has(n)) continue;
        seen.add(n);
        prev.set(n, node);
        if (n === goal) {
          const path = [goal];
          let at = goal;
          while (at !== start) {
            at = prev.get(at) as string;
            path.unshift(at);
          }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** Rotate a closed cycle so its smallest node comes first. Two rotations of one cycle compare equal. */
export function canonicalCycle(path: string[]): string[] {
  const open = path.slice(0, -1);
  if (open.length === 0) return path;
  let best = 0;
  open.forEach((node, i) => {
    if (node < (open[best] as string)) best = i;
  });
  const rotated = [...open.slice(best), ...open.slice(0, best)];
  return [...rotated, rotated[0] as string];
}

/** Strongly connected components, using an iterative Tarjan so deep graphs cannot overflow the stack. */
export function stronglyConnected(adj: Adjacency): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;

  for (const root of adj.keys()) {
    if (index.has(root)) continue;
    const work: { node: string; it: Iterator<string> }[] = [];
    const enter = (node: string) => {
      index.set(node, counter);
      low.set(node, counter);
      counter++;
      stack.push(node);
      onStack.add(node);
      work.push({ node, it: (adj.get(node) ?? new Set<string>()).values() });
    };
    enter(root);

    while (work.length > 0) {
      const top = work[work.length - 1] as { node: string; it: Iterator<string> };
      const step = top.it.next();
      if (!step.done) {
        const n = step.value;
        if (!index.has(n)) enter(n);
        else if (onStack.has(n)) low.set(top.node, Math.min(low.get(top.node) as number, index.get(n) as number));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(top.node) as number));
      if (low.get(top.node) === index.get(top.node)) {
        const component: string[] = [];
        let n: string;
        do {
          n = stack.pop() as string;
          onStack.delete(n);
          component.push(n);
        } while (n !== top.node);
        out.push(component);
      }
    }
  }
  return out;
}

/** One representative shortest cycle per strongly connected component. */
export function findCycles(adj: Adjacency): string[][] {
  const cycles: string[][] = [];
  for (const component of stronglyConnected(adj)) {
    const first = [...component].sort()[0] as string;
    if (component.length === 1) {
      if (adj.get(first)?.has(first)) cycles.push([first, first]);
      continue;
    }
    const inside: Adjacency = new Map(
      component.map((n) => [n, new Set([...(adj.get(n) ?? [])].filter((m) => component.includes(m)))]),
    );
    let best: string[] | null = null;
    for (const next of [...(inside.get(first) ?? [])].sort()) {
      const back = shortestPath(inside, next, first);
      if (back && (!best || back.length + 1 < best.length)) best = [first, ...back];
    }
    if (best) cycles.push(canonicalCycle(best));
  }
  return cycles.sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
}
