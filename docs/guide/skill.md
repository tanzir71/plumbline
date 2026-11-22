---
title: Agent Skill
description: Run Plumbline inside Claude Code, Codex or OpenCode.
order: 2
---

The skill runs the full review inside your coding agent, on the plan or key you already use.

## Install

```bash
npx skills add tanzir71/plumbline -g
```

Needs git and Node 20 or later. If your skills tool can't discover it by name, use the direct path:

```bash
npx skills add https://github.com/tanzir71/plumbline/tree/main/skills/plumbline
```

## Use

| Command | What it does |
|---|---|
| `/plumbline review` | Reviews the current branch against `dev`, then `main`, plus uncommitted work |
| `/plumbline review 482` | Reviews a GitHub PR (needs `gh`) |
| `/plumbline review and fix` | Reviews, fixes the confirmed findings, then re-reviews |
| `/plumbline review until 4/5` | Loops review and fix until the score reaches the target, for at most 5 rounds |
| `/plumbline compare` | Reviews the PR, then compares the result with other reviewers already on it |
| `/plumbline init` | Drafts a `plumbline.yml` from your ADRs and agent rule files, and shows you a diff to accept |

In Codex, use `$plumbline` instead of `/plumbline`.

## What it writes

A review only writes under `.plumbline/run/` and `.plumbline/proofs/`. Both are added to your local git exclude file, so they never show up in `git status`. Your code changes only in review-and-fix mode.

## Harnesses without sub-agents

The skill runs its reviewers in parallel where the agent supports it. Otherwise the main agent runs the passes one after another.
