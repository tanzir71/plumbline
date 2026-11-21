# ADR 0003: CI treats the pull request as untrusted

Status: accepted (2026-11-21)

## Context

The CI runtime holds a model key and a forge token while an agent reads code from a pull request. A PR can contain prompt injection, a fake `node_modules`, an `.npmrc`, agent hooks, or a weakened `plumbline.yml`.

## Decision

- Read the contract from the base commit.
- Refuse `pull_request_target`.
- Start `npx` outside the checkout, and install a pinned agent outside it.
- Run Claude Code with `--bare`, `dontAsk` permissions and a read-only tool list. Run Codex in a read-only sandbox.
- Remove forge and CI tokens from the agent's environment, and scrub credentials from its subprocesses.
- Get findings as structured output, so the agent needs no write access.
- Keep proof tests off by default (`proof-tests: false`), since they execute PR code.
- Have the core re-check every proof. A failing test counts only if `plumbline prove` recorded it.

## Consequences

By default, CI can't prove a finding with a test, so a test-only finding shows at P2. Teams that trust their contributors can opt in.
