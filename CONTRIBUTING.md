# Contributing

Needs Node 20.12+ and pnpm.

```bash
pnpm i
pnpm build
pnpm test
pnpm lint
```

Build before testing: the CLI and CI runtime tests use the built packages.

| Path | What it is |
|---|---|
| `packages/core` | Contract, graph, checks, score, gate, lanes, reports |
| `packages/cli` | The `plumbline` command and MCP server |
| `packages/action` | CI runtime for the GitHub Action and GitLab template |
| `skills/plumbline` | The Agent Skill and lenses |
| `fixtures` | Tiny repos with seeded issues |
| `evals` | Headless skill runs on the fixtures. Manual, because they cost tokens |
| `site` | The landing page and docs |

## Rules for changes

- Anything a graph or rule can prove must not be left to a model.
- No accuracy, catch-rate or speed claims anywhere.
- Nothing may approve or merge a PR.
- Prices live in `site/src/data/pricing.json`, each with a source and a check date.
- Scripts must work on Windows, macOS and Linux.
- Record decisions that aren't obvious in `docs/adr/`.
- Add a line to `CHANGELOG.md`.
