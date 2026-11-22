---
title: Benchmark
description: Compare reviewers on your own labelled PRs and tune Plumbline for your codebase.
order: 15
---

`plumbline benchmark` measures reviewers against issues you labelled in your own repository. Use it to compare Plumbline with another reviewer, and to fine-tune Plumbline for your codebase so its reviews improve over time.

Reviews run with your own agent and model account. Plumbline doesn't upload your suites or results. It publishes no accuracy figures, and a result only describes the cases and labels in your suite.

## Compare one PR

If another reviewer already runs on your PRs, install the [Agent Skill](./skill.md) and ask your agent:

```text
/plumbline compare
```

In Codex, use `$plumbline compare`. Add a PR number to choose a PR, or name a reviewer to compare only with that one. There's nothing to configure. Plumbline reviews the PR first, reads the other reviews, checks each disagreement against the code and writes `comparison.md` to the run folder.

## Benchmark many PRs

```bash
plumbline benchmark init
plumbline benchmark run --yes
plumbline benchmark compare
```

`init` writes `.plumbline/benchmark.yml`. `run` reviews each case in a throwaway checkout, so your working tree doesn't change. Without `--yes`, it lists the cases and stops, because each case uses your model account.

## The suite

```yaml
version: 1
match_window: 5

cases:
  - id: invoice-tenant-filter
    pr: 123
    expect:
      - id: missing-tenant-filter
        file: src/repo/invoices.ts
        lines: [10, 14]
        keywords: [tenant, org]

  - id: clean-refactor
    base: "1a2b3c4"
    head: "5d6e7f8"
    expect: []

reviewers:
  review-bot:
    github: review-bot[bot]
  other-tool:
    file: .plumbline/benchmark-input/other-tool/{case}.sarif
```

| Field | Meaning |
|---|---|
| `cases[].pr` | A GitHub PR, read with `gh` |
| `cases[].base`, `head` | Two commits, for any host |
| `expect[].file` | The file a review should flag |
| `expect[].lines` | Optional. A comment matches within `match_window` lines |
| `expect[].keywords` | Optional. A comment must contain at least one |
| `reviewers.<name>.github` | Reads that account's inline PR comments |
| `reviewers.<name>.file` | Reads SARIF, a findings object or a JSON list. `{case}` becomes the case id |

Include clean changes as well as buggy ones, so noisy reviewers show up in the counts.

## Reading the result

| Column | Meaning |
|---|---|
| Caught | Labelled issues a comment matched |
| Missed | Labelled issues nothing matched |
| Unlabelled | Comments that matched no label. Read them, because some may be real issues you can add to the suite |
| Cases | Cases where that reviewer had output |

A case that could not run is listed as blocked and isn't counted.

## Improve Plumbline over time

Plumbline reviews with plain markdown [lenses](./lenses.md) and the rules in your `plumbline.yml`. The benchmark shows what they miss on your code and whether an edit helped, so each round can make Plumbline fit your codebase better.

1. Run the suite to get a baseline.
2. Read the missed issues and unlabelled comments to find what to change.
3. Edit a lens in `.plumbline/lenses/` or a rule in `plumbline.yml`. A lens with the same id as a built-in replaces it.
4. Run the suite again. It uses your current lenses and contract on each case's commit.
5. Run `plumbline benchmark compare` to see what was newly caught or newly missed. Keep the edit if it helped, and undo it if it didn't.

When a review misses a real bug or raises a false alarm, add that PR to your suite. Each new case tests your next edit against a problem your team actually hit. Commit your lenses, contract and suite so everyone on the team reviews with the same tuning.

Plumbline doesn't change its lenses by itself or send your results anywhere. You decide which edits to keep.

After editing labels or adding another reviewer's output, run `plumbline benchmark score`. It rescores the saved run and uses no model tokens.
