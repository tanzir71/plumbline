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
4. If a reviewer was inconclusive or files were left unread, the score is capped at **4/5** and the footer says why, naming the unread files.

## Coverage

Reviewers read the changed files riskiest first: source code, then config, tests and docs, with the largest changes first. When a pass runs out of budget, a follow-up reviewer reads the files nobody reached. Files still unread after that are named in the report. A file counts as unread when every saved reviewer report says it skipped it, whatever the summary claims.

## Candidates are kept unless the code rules them out

Every candidate a reviewer raises is either merged into a finding, dismissed with evidence, or kept. A dismissal needs a reason that rules the defect out: code that guards it, the same behavior at the base commit, no path that reaches it, a misread of the code, a stated decision, or style. The first four must cite a file and line that exist. A candidate dismissed only because its impact or intent is unclear, or not accounted for at all, comes back as an **unresolved** finding at P2 at most. The report's footer counts how candidates were handled.

## The proof gate

Every P0 and P1 needs proof of a kind the contract accepts.

| Proof | What Plumbline checks |
|---|---|
| `failing_test` | The test is under `.plumbline/proofs/`, and `plumbline prove` recorded it failing on this commit. It reached a test assertion rather than crashing at startup, and it hasn't changed since. A model's claim that a test failed doesn't count |
| `graph_diff` | The cited edge or cycle really was added in this change |
| `broken_rule` | The rule id is in the contract, or the ADR exists, and the finding cites a real file and line |

A finding without valid proof is shown at P2 with the reason. If it's also unreachable or style-only, it's dropped. New cycles and contract violations are found by the graph, so they arrive already proved. One new dependency between two modules counts as one finding, even when it closes a cycle and breaks several rules.

A P0 with proof that only P1 accepts steps down to P1.

## Import cycles

| New cycle | Severity |
|---|---|
| Crosses declared modules or breaks a contract rule | **P1** |
| Stays inside one module, or the repo declares no modules | **P2** |

Connected cycles inside one module count as one finding, so one tangle costs the score once. To keep those cycles at P1, set this in `plumbline.yml`:

```yaml
cycles:
  within_module: P1
```
