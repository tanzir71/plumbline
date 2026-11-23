# ADR 0008: Publish field-test counts without a competitor comparison

Status: accepted (2026-11-23).

## Context

The owner ran Plumbline on 12 of their merged PRs and wants the landing page to show the results. The hidden Bench frame in Figma describes a different study: a public dataset, an independent oracle and scored competitors.

## Decision

- The Benchmark section reuses that frame's layout for a labelled field test.
- It shows aggregate Plumbline counts only: PRs reviewed, candidates, findings, how Plumbline's own findings were judged, the proof behind them and the problems the test exposed.
- It shows no repository names, PR titles, code, raw reviews, precision, catch rate, cost per bug or competitor results.
- The comparison stays private because the workflow that produced the findings also judged them.

## Consequences

The counts live in `site/src/data/field-test.json`. A public competitor comparison needs a public dataset or blind, independent judging first.
