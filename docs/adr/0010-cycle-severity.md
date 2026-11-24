# ADR 0010: Score cycles by boundary and group connected ones

Status: accepted (2026-11-23).

## Context

Every new import that closed a cycle was its own P1. In the field test, one PR scored 0/5 mostly from automatic cycle findings. Several shared the same files, and their merge impact stayed unclear.

## Decision

- A new cycle that crosses declared modules or breaks a contract rule stays P1.
- A new cycle inside one module, or in a repo with no declared modules, is P2 by default.
- Connected cycles inside one module are one finding, so one tangle costs the score once.
- `cycles.within_module: P1` in `plumbline.yml` keeps those cycles at P1.

## Consequences

A new cycle inside a module no longer fails a P1-based merge gate by default. Teams that want that can set `cycles.within_module: P1`. The score formula and proof gate don't change.
