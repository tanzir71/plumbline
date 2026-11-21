---
id: L08
name: "Operability & cost"
default: "on"
proof: [broken_rule]
catches: "Risky paths with no flag or metrics, model calls inside loops."
example: "llm.call() inside forEach"
---

# L08 Operability & cost

Risky paths with no flag or metrics, model calls inside loops.

## What to look for

- Paid API or model calls inside loops or per-request paths.
- Unbounded fetches, N+1 queries and missing pagination at realistic sizes.
- A risky rollout with no flag or kill switch where the repo's rules ask for one.
- Failures that nothing logs or measures.

## How to prove it

Cite the rule that requires the flag, limit or metric, with the file and line. Without one this stays at P2 or below.

## False-positive traps

- A loop over a small fixed list is fine.
- Do not ask for observability the rest of the codebase does not have.
- Admin scripts have different cost limits.

## Examples

`llm.call()` inside `forEach` over every open ticket runs on each page load.
