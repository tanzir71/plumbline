# ADR 0005: Publish under the @tanziro scope

Status: accepted (2026-11-22). Supersedes ADR 0001.

## Context

ADR 0001 chose the `@plumbline` npm scope. That org already exists on npm and doesn't belong to this project.

## Decision

| Package | npm name |
|---|---|
| Core library | `@tanziro/plumbline-core` |
| CLI and MCP server | `@tanziro/plumbline` |
| CI runtime | `@tanziro/plumbline-action` |

- The CLI's command is still `plumbline`.
- Install snippets use `npx -y @tanziro/plumbline <command>`.
- Nothing in this repo may tell a user to run `npx plumbline`, because that unscoped package is an unrelated project.

## Consequences

`HANDOVER.md` and `docs/landing-page.md` keep the original draft names. Where they differ, this ADR and the code are correct.
