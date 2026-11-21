# Security

## Data path

Plumbline has no backend, no account and no telemetry. Its only network calls go to:

- your own model provider, made by your agent with your key
- your own GitHub or GitLab API, to post a comment and set a label
- your npm registry, when installing packages

Plumbline never routes your code through servers we run.

## How CI is isolated

See [docs/guide/security.md](./docs/guide/security.md) and [ADR 0003](./docs/adr/0003-ci-trust-model.md).

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on https://github.com/tanzir71/plumbline. Do not open a public issue.

Useful reports include a way to get a key or token out of a CI run, a way for a PR to change its own gate, or any path that approves or merges a PR.
