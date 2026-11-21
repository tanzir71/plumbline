---
title: Architecture contract
description: The plumbline.yml file, reviewed and versioned like code.
order: 7
---

`plumbline.yml` lives at the root of your repo. It says how the code is meant to be structured.

```yaml
version: 1
modules:                     # name -> globs
  api:            ["src/api/**"]
  billing:        ["src/billing/**"]
  orgs:           ["src/orgs/**"]
  users/session:  ["src/users/session/**"]
  db:             ["src/db/**"]
layers:                      # top -> bottom; a lower layer may not import a higher one
  - [api]
  - [billing, orgs, "users/*"]
  - [db]
rules:
  - id: no-billing-to-users
    forbid: billing -> users/*
    because: "ADR-012: billing ships on its own"
  - id: tenant-scope
    require: "repository methods scope queries by org_id"
    check: llm               # llm | semgrep | custom
    paths: ["src/**/repo/**"]
proof:
  P0: [failing_test, graph_diff]
  P1: [failing_test, graph_diff, broken_rule]
gate:
  - branches: ["main", "release/*"]
    min_merge_score: 3
lanes:
  light:
    label: "plumbline:light-review"
    when: { merge_score: 5, max_severity: P3, max_changed_lines: 200 }
    never: ["**/migrations/**", ".github/**", "src/billing/**"]
```

Start with `plumbline init`, or let `/plumbline init` draft rules from your ADRs and agent rule files.

## Keys

| Key | Meaning |
|---|---|
| `version` | Always `1` |
| `extends` | A path, or list of paths, to shared contracts inside the repo |
| `modules` | Module name to globs. When a file matches several, the most specific glob wins |
| `layers` | Top to bottom. A lower layer may not import a higher one. Skipping down is allowed |
| `rules` | `forbid` rules are proved from the graph. `require` rules need a check |
| `proof` | Which proof kinds count for P0 and P1 |
| `gate` | Minimum merge score per base branch. See [gating](./gating.md) |
| `lanes` | When a PR qualifies for light review. See [risk lanes](./lanes.md) |

## Rule checks

| `check` | How it runs |
|---|---|
| `llm` (default) | A model reviewer judges the rule against the changed `paths` |
| `semgrep` | Runs a local Semgrep `config`, with `plumbline check --semgrep` |
| `custom` | Runs `command`, with `plumbline check --allow-custom-checks` |

Custom commands never run in the Action, the GitLab template or the MCP server, because they execute whatever the contract says.

## Sharing a contract across repos

`extends` takes local paths only, so Plumbline makes no network call to load a contract. To share one, vendor it or add it as a git submodule:

```yaml
version: 1
extends: ./vendor/architecture/plumbline.base.yml
rules:
  - id: local-rule
    forbid: api -> db
```

The child's `modules` and `rules` merge over the parent's. A rule with the same `id` replaces the parent's. `layers`, `proof`, `gate` and `lanes` replace the parent's when set.

## In CI, the base branch's contract applies

The Action and GitLab template read the contract from the **base commit**. A PR can propose a contract change, but it can't relax the rules, gate or lanes that judge that same PR.

## Pre-existing violations

Only edges a change adds become findings. You can adopt a contract in a codebase that already breaks it and tighten it over time.

Errors are reported with the file, line and column. The full schema is in `docs/contract-spec.md` in the repository.
