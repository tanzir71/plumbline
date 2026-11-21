---
id: L02
name: "Boundaries & cycles"
default: "on"
proof: [graph_diff, broken_rule]
catches: "New edges in the import graph that cross a layer or close a loop."
example: "billing -> users/session -> billing"
---

# L02 Boundaries & cycles

New edges in the import graph that cross a layer or close a loop.

## What to look for

- New cycles and layer crossings in `graph.json`. These are already findings, so do not re-derive them.
- Coupling the graph cannot see: dynamic imports, string-keyed registries, shared globals, or reaching into another module's internals.
- Non-JS/TS code, where the graph checks do not run in v1.0. Read the imports by hand.

## How to prove it

Cite the exact edge or cycle from the graph diff as `graph_diff`, or the contract rule id as `broken_rule` with the file and line.

## False-positive traps

- Type-only imports do not create runtime cycles.
- An edge that already existed at base is not this PR's finding.
- A layer may skip downward: `api -> db` is allowed unless a rule forbids it.

## Examples

`billing/invoice.ts` imports `users/session`, which already depends on billing for plan limits.
