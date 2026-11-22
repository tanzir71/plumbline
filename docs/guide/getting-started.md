---
title: Get started
description: Install Plumbline and run your first code review, one step at a time.
order: 1.5
---

This guide is for your first time. You don't need to know Plumbline, and you only need to copy a few commands.

Plumbline reads the changes in your project, checks how the code fits together, and tells you what to fix before you merge. It doesn't change your code.

## What you need

- A Windows, Mac or Linux computer
- A project that uses Git
- A Codex or Claude account, because Plumbline uses your AI account to review the code

## 1. Open a terminal

A terminal is an app where you type commands.

- **Windows:** open the Start menu, type `PowerShell`, and open it.
- **Mac:** press Command + Space, type `Terminal`, and open it.
- **Linux:** open your Terminal app.

Type or paste one command, press **Enter**, and wait for it to finish before running the next one.

## 2. Check Node.js and Git

```bash
node --version
git --version
```

Each command should print a version number. Node.js must be **20.12 or later**.

If you see "not recognized" or "command not found", install the missing tool, then close and reopen your terminal:

- [Download Node.js](https://nodejs.org/) and choose the LTS version
- [Download Git](https://git-scm.com/downloads)

## 3. Install Plumbline

```bash
npm install -g @tanziro/plumbline
plumbline --version
```

The second command should print a version number. The `-g` means you can use Plumbline in any project on your computer.

## 4. Connect an AI agent

Choose **one** option.

**Codex**

```bash
npm install -g @openai/codex
codex login
```

**Claude Code**

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

Follow the sign-in steps. Reviews use your account's plan or credits. Plumbline has no account or server of its own.

## 5. Open your project

Move the terminal into your project folder. Replace the example path with your own:

```bash
cd path/to/your-project
```

**Tip:** type `cd `, with a space, then drag your project folder into the terminal and press Enter.

Now check that you're in the right place:

```bash
git status
```

If it says `On branch`, you're ready. To review a different branch, switch to it first:

```bash
git switch your-branch
```

## 6. Run your first review

```bash
plumbline review
```

Plumbline compares your branch with `dev`, `main` or `master`, and includes changes you haven't committed yet. A review can take several minutes. You'll see `Still reviewing` while it works.

To review a GitHub pull request by number, [install the GitHub CLI](https://cli.github.com/), run `gh auth login`, then:

```bash
plumbline review 123
```

## 7. Read the result

The first line is your merge score:

```text
## Merge score: 3/5 — 2 P1 · 1 P2
```

A higher score means fewer serious problems. **5/5** means nothing above a minor issue was found.

| Label | What it means | What to do |
|---|---|---|
| P0 | Severe problem | Fix it now |
| P1 | Real bug or broken rule | Fix it before merging |
| P2 | Smaller or less likely problem | Fix it if you can |
| P3 | Minor cleanup | Optional |

Each finding names the file, explains the problem and suggests a fix. The full report is saved in `.plumbline/run/` inside your project, and Git ignores that folder.

Plumbline can be wrong. You decide what to change, and Plumbline never approves or merges anything.

## Try it without AI

This runs only the import and rule checks. It needs no AI account and uses no credits:

```bash
plumbline review --no-agent
```

## If something goes wrong

| What you see | What to do |
|---|---|
| `node` or `npm` is not recognized | Install Node.js, then close and reopen the terminal |
| `plumbline` is not recognized | Run step 3 again, then close and reopen the terminal |
| `EACCES` while installing on Mac or Linux | Install Node.js with [nvm](https://github.com/nvm-sh/nvm), then run step 3 again |
| `not inside a git repository` | Use `cd` to move into your project folder |
| `NOTHING TO REVIEW` | Switch to a branch with changes, or edit a file and run it again |
| `no review agent is ready` | Finish step 4 and make sure you're signed in |
| `this terminal blocks network access` | Run it in a normal terminal, not inside an AI agent's chat |
| `PR mode needs the GitHub CLI` | Install the GitHub CLI and run `gh auth login` |
| `review did not finish` | Open the `agent.log` file named in the message, then check your agent's sign-in and plan |

## Next steps

- Teach Plumbline your architecture with a [contract](./contract.md)
- Use it inside your coding agent with the [Agent Skill](./skill.md)
- Run it on every pull request with [GitHub Actions](./github-action.md) or [GitLab CI](./gitlab.md)
- Compare reviewers on your own PRs with the [benchmark](./benchmark.md)
