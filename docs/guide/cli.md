---
title: CLI
description: The deterministic commands, for any terminal or CI.
order: 3
---

Install it once, then use it in any repository:

```bash
npm install -g @tanziro/plumbline
plumbline review
```

The package is `@tanziro/plumbline` and its command is `plumbline`. The unscoped npm package named `plumbline` is an unrelated project, so **don't run `npx` with the bare name**.

## Review a PR

```bash
plumbline review              # current branch and uncommitted work
plumbline review 123          # a GitHub PR, without checking it out
plumbline review feature/x    # a branch
plumbline review --agent claude --model <id>
plumbline review --panel      # your configured mix of models
```

`review` runs the graph and rule checks, starts your signed-in Codex or Claude Code, then scores the result and writes the report. It uses Codex first if both are ready. Set `PLUMBLINE_AGENT` to change the default. Run it from a normal terminal, because an agent's sandbox blocks the nested agent from reaching its model.

Plumbline never approves or merges, and the agent doesn't get your source-control or registry tokens from its environment. Codex runs in its workspace sandbox, where it can run proof tests and is told not to edit tracked files. Claude Code gets read-only tools and can write only the run's findings file, so it doesn't run proof tests. Use `--no-agent` to run the graph and rule checks without a model.

## Commands

| Command | What it does |
|---|---|
| `plumbline review [target]` | Runs the full review with your signed-in agent |
| `plumbline benchmark <action>` | Compares reviewers on your labelled PRs: `init`, `run`, `score`, `compare`. See [Benchmark](./benchmark.md) |
| `plumbline panel <action>` | Sets up a mix of review models and prices a change: `init`, `check`. See [Model panel](./panel.md) |
| `plumbline init` | Writes a `plumbline.yml` skeleton, guessing modules from your folders |
| `plumbline scope [target]` | Pins the diff range and collects rule files. Target: branch, commit or PR |
| `plumbline graph --base <ref>` | Diffs the JS/TS import graph between base and HEAD |
| `plumbline check` | Checks the contract's `forbid` and `layers` rules against the current tree |
| `plumbline prove <test> -- <cmd>` | Runs a proof test under `.plumbline/proofs/` and records the result |
| `plumbline report` | Applies the proof gate, scores the run and writes the audit trail |
| `plumbline mcp` | Starts the MCP server on stdio |

Every command takes `--json` for machine-readable output.

## Options

| Option | Commands | Meaning |
|---|---|---|
| `--base <ref>` | review, scope, graph, report | Base branch or ref. Default: `dev`, then `main`, then `master` |
| `--agent <codex\|claude>` | review, benchmark run | Which signed-in agent reviews |
| `--model <id>` | review, benchmark run | Model for that agent |
| `--no-agent` | review, benchmark run | Graph and rule checks only |
| `--panel` | review, benchmark run | Review with your configured model panel |
| `--panel-config <file>` | review, benchmark run, panel | Panel file. Default: `PLUMBLINE_PANEL`, then `~/.plumbline/panel.yml` |
| `--yes` | benchmark run | Confirm that the run uses your model account |
| `--gate` | report | Exit 1 when the score is below the contract's minimum |
| `--run <id>` | report, prove, benchmark score | Use a specific run. Default: the latest |
| `--findings <file>` | report | Read model findings from a file |
| `--base-branch <name>` | report | Branch name used to match `gate` entries |
| `--contract-from <head\|base>` | graph, report | Which commit's contract to apply. CI uses `base` |
| `--contract <file>` | check | Validate and apply a draft contract instead of `plumbline.yml` |
| `--semgrep` | check | Run `check: semgrep` rules, if Semgrep is installed |
| `--allow-custom-checks` | check | Run `check: custom` commands from the contract |
| `--passed-on-base`, `--failed-on-base` | prove | Record how the test behaved on the base commit |
| `--force` | init, benchmark init, panel init | Replace an existing `plumbline.yml`, benchmark suite or panel |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | An error, a failed gate, or (for `check`) a violated rule |
| 2 | Nothing to review |

## Pre-push hook

```bash
npx -y @tanziro/plumbline report --base main --gate
```

Without model findings, this runs the graph and rule checks only.
