---
title: Audit trail
description: Every run saved as Markdown, JSON and SARIF.
order: 12
---

Each run is written to `.plumbline/run/<timestamp>/`.

| File | Use |
|---|---|
| `report.md` | Terminal output and the PR or MR comment |
| `report.json` | Machines. Schema: `packages/core/schema/report.v1.json` |
| `report.sarif` | SARIF 2.1.0, for GitHub code scanning and SIEMs |
| `gl-code-quality-report.json` | GitLab's Code Quality widget |
| `scope.json`, `graph.json`, `check.json` | The inputs to the review |
| `findings.json` | What the model reviewers returned, before the proof gate |
| `proofs.json` | Test runs recorded by `plumbline prove` |

The report records the score and verdict, each finding with its proof, findings that were downgraded or dropped and why, the model, the lenses that ran or were skipped, the gate result and the lane decision.

## In CI

All of it is uploaded as job artifacts.

On GitHub, the SARIF goes to code scanning when `upload-sarif` allows it. The default, `auto`, uploads on public repos only, because code scanning on private repos needs GitHub Code Security.
