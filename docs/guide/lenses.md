---
title: Lenses
description: The reviewer briefs, and how to edit or add your own.
order: 8
---

A lens is a plain markdown file that tells a reviewer what to look for, how to prove it and which false positives to avoid. The built-in lenses are in `skills/plumbline/lenses/`.

| ID | Lens | Typical proof |
|---|---|---|
| L01 | Regressions | failing_test |
| L02 | Boundaries & cycles | graph_diff, broken_rule |
| L03 | Pattern deviations | failing_test, broken_rule |
| L04 | Distributed systems | failing_test |
| L05 | Migrations | broken_rule, failing_test |
| L06 | API contracts | graph_diff, broken_rule |
| L07 | Agent-PR hygiene | broken_rule |
| L08 | Operability & cost | broken_rule |

## Add, change or disable a lens

Put a file in `.plumbline/lenses/` in your repo.

- A **new id** adds a lens.
- The **same id** as a built-in replaces it.
- `default: "off"` disables it.

```markdown
---
id: T01
name: "Money handling"
default: "on"
proof: [failing_test, broken_rule]
catches: "Floats used for currency, rounding at the wrong step."
example: "price * 1.2  // float"
---

# T01 Money handling

## What to look for

## How to prove it

## False-positive traps

## Examples
```

Quote `default`, so that YAML keeps it as text.
