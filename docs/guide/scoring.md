---
title: Merge score and proof
description: How findings are ranked, proved and scored.
order: 9
---

## Severities

| Severity | Meaning |
|---|---|
| **P0** | Severe with no special input: breaks the build or most users, loses or corrupts data, opens a tenant boundary for everyone, leaks secrets |
| **P1** | A real bug on a plausible path, a broken caller contract, a security hole needing specific input, or a violated critical rule |
| **P2** | A less likely path or small blast radius |
| **P3** | Minor: stale docs, dead code. Never affects the score |

## Merge score

The scoring rules come from the upstream project Plumbline is based on (see `NOTICE`).

1. Any P0 scores **0/5**.
2. Otherwise **5 minus the number of P1s**, never below 0. No P1 but a P2 scores **4/5**. Nothing above P3 scores **5/5**.
3. Each P1 that involves security costs one extra point.
4. If a reviewer was inconclusive or files were left unread, the score is capped at **4/5** and the footer says why.

## The proof gate

Every P0 and P1 needs proof of a kind the contract accepts.

| Proof | What Plumbline checks |
|---|---|
| `failing_test` | The test is under `.plumbline/proofs/`, and `plumbline prove` recorded it failing on this commit. It hasn't changed since. A model's claim that a test failed doesn't count |
| `graph_diff` | The cited edge or cycle really was added in this change |
| `broken_rule` | The rule id is in the contract, or the ADR exists, and the finding cites a real file and line |

A finding without valid proof is shown at P2 with the reason. If it's also unreachable or style-only, it's dropped. New cycles and contract violations are found by the graph, so they arrive already proved. One new dependency between two modules counts as one finding, even when it closes a cycle and breaks several rules.

A P0 with proof that only P1 accepts steps down to P1.
