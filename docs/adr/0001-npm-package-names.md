# ADR 0001: Publish under the @plumbline scope

Status: accepted (2026-11-21)

## Context

The unscoped npm package `plumbline` already exists and belongs to an unrelated project.
`npx plumbline` would therefore download and run someone else's code.

## Decision

- Publish `@plumbline/core`, `@plumbline/cli` and `@plumbline/action`.
- The CLI's bin is still called `plumbline`.
- Every install snippet uses `npx -y @plumbline/cli <command>`. Nothing in this repo may tell a user to run `npx plumbline`.
- Skip the thin unscoped `plumbline` package from HANDOVER §4.1, because the name is not free.

## Consequences

The MCP snippet on the landing page differs from the first draft of the spec.
The `@plumbline` npm organisation must be created by the owner before the first publish.
