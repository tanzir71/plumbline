---
title: GitHub Action
description: Review every pull request in your own CI.
order: 5
---

## Workflow

```yaml
# .github/workflows/plumbline.yml
name: Plumbline
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write
  issues: write            # creates the lane label
  security-events: write   # uploads SARIF

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

**Use `pull_request`, never `pull_request_target`.** The Action refuses to run on `pull_request_target`, because that event would run a PR's code with your secrets.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `model` | agent default | Model id |
| `key` | | Your provider key. Without one, only the graph and rule checks run |
| `provider` | `anthropic` | `anthropic`, `bedrock`, `vertex` or `openai-compatible` |
| `base-url` | | Required for `openai-compatible`. Optional gateway for the others |
| `comment` | `true` | Post or update one PR comment |
| `upload-sarif` | `auto` | `auto` uploads on public repos only. Also `true` or `false` |
| `gate` | `true` | Fail the job below the contract's minimum score |
| `lanes` | `true` | Add or remove the light-review label |
| `fail-on-error` | `false` | Fail the job if the review itself errors |
| `proof-tests` | `false` | Let the agent run tests as proof |
| `token` | `github.token` | Token for comments and labels |

## Outputs

`merge-score`, `gate` (`pass`, `fail` or `none`), `lane` and `report-dir`.

## Providers

| Provider | Agent | Credentials |
|---|---|---|
| `anthropic` | Claude Code | `key` |
| `bedrock` | Claude Code | `key` as a Bedrock API key, or AWS credentials on the runner |
| `vertex` | Claude Code | Google credentials on the runner |
| `openai-compatible` | Codex | `key` and `base-url` |

## Proof tests in CI

`proof-tests` is off by default. Turning it on runs the PR's code in a job that holds your model key. Plumbline strips credentials from the agent's subprocesses, but treat that as one layer of defence and only enable it where you trust the contributors.

With it off, findings can still be proved with a graph diff or a broken rule. A finding that could only be proved by a test is shown at P2.

## Minutes and runners

Standard runners are free on public repos. On a private repo the job spends your Actions minutes. To avoid that, or to keep everything inside your network, set `runs-on` to a self-hosted runner.

The Action is used by reference, as `tanzir71/plumbline@v1`. It isn't listed on the GitHub Marketplace.

Next: make the job a [required check](./gating.md).
