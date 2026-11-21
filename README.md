# Plumbline

**Review the structure, not just the diff.**

Plumbline is an open-source code reviewer that you run with your own model keys. It works inside coding agents (Claude Code, Codex, OpenCode), in CI and over MCP. It looks for regressions in the diff, then checks each PR against your team's intended architecture: ADRs, `AGENTS.md` / `CLAUDE.md` and a `plumbline.yml` contract. A P0 or P1 finding needs proof, or it is downgraded.

- **No second bill.** MIT licensed, no account, no Plumbline servers.
- **Deterministic first.** Graph and rule checks run before any model.
- **Proof you can run.** A failing test, a dependency-graph diff or the exact rule that broke.
- **A person always approves.** Plumbline can fail a check or add a label. It never approves or merges.

Docs: https://tanzir71.github.io/plumbline/docs/

## Install

**Agent Skill**

```bash
npx skills add tanzir71/plumbline -g
```

Then run `/plumbline review` in your agent.

**GitHub Action**

```yaml
# .github/workflows/plumbline.yml
name: Plumbline
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
  issues: write
  security-events: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: tanzir71/plumbline@v1
        with:
          model: claude-sonnet-5-5
          key: ${{ secrets.ANTHROPIC_KEY }}
```

**GitLab CI**

```yaml
# .gitlab-ci.yml
include:
  - remote: 'https://raw.githubusercontent.com/tanzir71/plumbline/v1/ci/gitlab/plumbline.yml'
# CI/CD variables: PLUMBLINE_MODEL_KEY, PLUMBLINE_GITLAB_TOKEN
```

**MCP server**

```json
{ "mcpServers": { "plumbline": { "command": "npx", "args": ["-y", "@tanziro/plumbline", "mcp"] } } }
```

**CLI**

```bash
npx -y @tanziro/plumbline init
npx -y @tanziro/plumbline graph --base main
npx -y @tanziro/plumbline check
```

The CLI package is `@tanziro/plumbline`. The unscoped npm package `plumbline` is an unrelated project.

## The contract

```yaml
version: 1
modules:
  api:     ["src/api/**"]
  billing: ["src/billing/**"]
  users/session: ["src/users/session/**"]
  db:      ["src/db/**"]
layers:
  - [api]
  - [billing, "users/*"]
  - [db]
rules:
  - id: no-billing-to-users
    forbid: billing -> users/*
    because: "ADR-012: billing ships on its own"
  - id: tenant-scope
    require: "repository methods scope queries by org_id"
    check: llm
gate:
  - branches: ["main"]
    min_merge_score: 3
```

## Merge score

The scoring rules come from the MIT-licensed project Plumbline is based on, credited in [NOTICE](./NOTICE).

1. Any P0 scores 0/5.
2. Otherwise 5 minus the number of P1s, never below 0. No P1 but a P2 scores 4/5. Nothing above P3 scores 5/5.
3. Each security P1 costs one extra point.
4. An inconclusive reviewer or unread files cap the score at 4/5.

## Honest limits

- The deterministic graph checks cover **JS and TS only** in v1.0. The model lenses work in any language.
- The graph sees static imports. Dynamic imports and service calls are left to the model reviewers.
- Models can be wrong or miss things. Plumbline publishes no accuracy figures.

## Development

Needs Node 20.12+ and pnpm.

```bash
pnpm i
pnpm build
pnpm test
pnpm lint
pnpm --filter site dev
```

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE). Built by [tanziro.com](https://tanziro.com).
