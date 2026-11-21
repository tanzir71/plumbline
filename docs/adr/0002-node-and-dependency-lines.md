# ADR 0002: Pin dependency lines that support Node 20

Status: accepted (2026-11-21)

## Context

The project targets Node 20+. The newest majors of dependency-cruiser (18), Astro (7), vitest (5) and tsup (9) require Node 22 or later.

## Decision

Use the newest lines that still support Node 20.12:

| Package | Line |
|---|---|
| dependency-cruiser | 17 |
| astro | 5 |
| vitest | 4 |
| tsup | 8 |
| eslint | 9 |
| typescript | 5.9 |

## Consequences

When the project drops Node 20, these can all move up together in one change.
