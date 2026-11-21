import picomatch from "picomatch";
import type { Contract } from "../contract/schema.js";

interface CompiledGlob {
  module: string;
  specificity: number;
  order: number;
  test: (path: string) => boolean;
}

/** Length of the literal prefix before the first glob character. */
function literalPrefix(glob: string): number {
  const i = glob.search(/[*?[\]{}()!+@]/);
  return i === -1 ? glob.length : i;
}

/** Maps files to contract modules. The most specific glob wins; ties go to the first declared. */
export class ModuleMap {
  private readonly globs: CompiledGlob[];
  private readonly names: string[];
  private readonly cache = new Map<string, string | null>();

  constructor(modules: Contract["modules"]) {
    this.names = Object.keys(modules);
    this.globs = this.names
      .flatMap((module, order) =>
        (modules[module] ?? []).map((glob) => ({
          module,
          order,
          specificity: literalPrefix(glob),
          test: picomatch(glob, { dot: true }),
        })),
      )
      .sort((a, b) => b.specificity - a.specificity || a.order - b.order);
  }

  moduleOf(file: string): string | null {
    const cached = this.cache.get(file);
    if (cached !== undefined) return cached;
    const hit = this.globs.find((g) => g.test(file))?.module ?? null;
    this.cache.set(file, hit);
    return hit;
  }

  /** Module names matching a contract pattern such as `users/*`. */
  matchNames(pattern: string): string[] {
    return this.names.filter((n) => picomatch.isMatch(n, pattern));
  }
}

/** Returns a lookup from module name to its layer index (0 is the top layer). */
export function layerIndex(contract: Contract, map: ModuleMap): Map<string, number> {
  const index = new Map<string, number>();
  contract.layers.forEach((layer, i) => {
    for (const pattern of layer) for (const name of map.matchNames(pattern)) index.set(name, i);
  });
  return index;
}
