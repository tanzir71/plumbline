# ADR 0007: One-command review and a local benchmark

Status: accepted (2026-11-22).

## Context

Running a review by hand meant pointing an agent at the skill, and nested agents failed inside another agent's sandbox. Users also want to compare reviewers and tune lenses on their own code.

## Decision

- **`plumbline review`** runs the deterministic pass itself, starts the user's signed-in Codex or Claude Code for the judgement calls, and lets the CLI score the findings. It must start outside an agent sandbox.
- **Agent limits:** Codex runs in its workspace sandbox with no MCP servers. Claude Code gets read-only tools and one writable findings file, and does not run proof tests because it has no OS sandbox here. Neither gets source-control or registry tokens.
- **`plumbline benchmark`** scores reviewers against issues the user labelled. Other reviewers are generic, user-named inputs (GitHub comments, SARIF or JSON).
- **No shipped comparisons:** the product names no competitors and ships no results. Suites and results stay on the user's machine, in line with the no-invented-numbers rule.

## Consequences

The CLI package now ships the skill. The landing page adds a CLI install tab and a Benchmark section, which replace the matching copy in `docs/landing-page.md`. Benchmark counts describe only one suite's cases and labels, so they must not be presented as a general accuracy figure.
