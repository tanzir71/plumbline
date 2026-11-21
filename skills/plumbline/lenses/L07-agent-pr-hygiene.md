---
id: L07
name: "Agent-PR hygiene"
default: "on"
proof: [broken_rule]
catches: "Reinvented helpers, needless abstraction, tests that assert mocks instead of behavior."
example: "formatMoney() exists in lib/fmt"
---

# L07 Agent-PR hygiene

Reinvented helpers, needless abstraction, tests that assert mocks instead of behavior.

## What to look for

- New helpers that duplicate one already in the repo.
- Abstractions with a single caller and no stated reason.
- Tests that assert on mocks, or would still pass if the change were reverted.
- Changes that contradict AGENTS.md or CLAUDE.md.

## How to prove it

Cite the rule file line that the change breaks, or the existing helper by path. Without a broken rule this stays at P2 or below.

## False-positive traps

- Style and naming preferences are not findings.
- Two similar functions may differ for a good reason.
- Do not ask for tests in general. Name the unprotected behaviour.

## Examples

A PR adds `formatCurrency()` while `formatMoney()` in `lib/fmt` already handles the same cases.
