---
title: Security and data
description: What leaves your network, and how CI runs are isolated.
order: 13
---

## Data path

Plumbline has no backend, no account and no telemetry. Its only network calls are:

- to **your model provider**, made by your agent with your key, or by the CLI when you use a [model panel](./panel.md)
- to **OpenRouter's public model list**, to price a panel, when your panel uses OpenRouter
- to **your GitHub or GitLab API**, to post the comment and set the label
- to **your npm registry**, when `npx` or the CI runtime installs packages

## CI safeguards

Review agents read untrusted code, so the runtime assumes a PR may try to attack it.

- **The base branch's contract applies.** A PR can't weaken its own rules, gate or lanes.
- **`pull_request_target` is refused.**
- **The runtime starts outside the checkout**, so a PR's `node_modules` or `.npmrc` can't replace it.
- **The agent version is pinned** and installed outside the checkout.
- **The agent ignores the checkout's agent config.** Claude Code runs with `--bare`, so a PR's hooks, settings and MCP servers don't load.
- **The agent is read-only by default.** It gets no forge or CI tokens, and credentials are scrubbed from its subprocesses.
- **Proof tests are off by default.** See [GitHub Action](./github-action.md).
- **Comments are sanitized.** Finding text can't inject HTML, spoof the bot's comment marker or mention people.
- **Nothing can approve or merge.** The code has no path to those APIs.

## Prompt injection

No model is immune. These controls limit what a manipulated reviewer can do: at worst it reports a wrong finding or misses one. That's one more reason a person always approves.

To report a vulnerability, see `SECURITY.md` in the repository.
