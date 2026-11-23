---
title: Overview
description: What Plumbline is, how a review runs, and where to start.
order: 1
---

Plumbline is an open-source code reviewer that runs with your own model keys. It looks for regressions in the diff, then checks the change against the architecture your team agreed on. A P0 or P1 finding needs proof, or it is downgraded.

**New here?** Follow the [step-by-step guide](./getting-started.md).

## Pick a surface

| Surface | Runs in | Who pays for the model |
|---|---|---|
| [Agent Skill](./skill.md) | Claude Code, Codex, OpenCode | Your agent plan or key |
| [CLI](./cli.md) | Any terminal or CI | Your agent plan or key for `review`. No model for the deterministic commands |
| [MCP server](./mcp.md) | Any MCP client | The calling agent |
| [GitHub Action](./github-action.md) | Your GitHub runners | Your key, as a repository secret |
| [GitLab CI](./gitlab.md) | Your GitLab pipelines | Your key, as a CI/CD variable |

## How a review runs

1. **Scope.** Pin the diff range and collect `plumbline.yml`, ADRs, `AGENTS.md`, `CLAUDE.md` and `REVIEW.md`.
2. **Deterministic pass.** Build the import graph at base and HEAD, then report new edges, new cycles, layer crossings and contract violations. No model is involved.
3. **Reviewers.** Independent reviewers apply the eight [lenses](./lenses.md).
4. **Proof gate.** Each P0 and P1 needs a failing test, a graph diff or a broken rule. Plumbline checks that proof against the repository.
5. **Report.** A [merge score](./scoring.md), ranked findings and a dependency diff, saved as an [audit trail](./audit-trail.md).

## Honest limits

- The deterministic graph checks cover **JS and TS only**. The model lenses work in any language.
- Static imports are what the graph sees. Dynamic imports, string-keyed registries and service calls are left to the model reviewers.
- A model can miss things or be wrong. A person always approves. Plumbline never approves or merges a PR.
- The GitHub Action and GitLab template have automated tests against simulated APIs, but have not yet run in live pipelines. Treat them as early.
- The review flow has run on Claude through Claude Code and on OpenAI models through Codex. OpenCode and the other model providers are supported but not yet verified end to end.

## Next

- Write your [contract](./contract.md)
- [Benchmark](./benchmark.md) reviewers on your own PRs
- Mix models by cost with a [model panel](./panel.md)
- Set up [merge gating](./gating.md) and [risk lanes](./lanes.md)
- Read how Plumbline handles [security and data](./security.md)
