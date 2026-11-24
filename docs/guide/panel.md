---
title: Model panel
description: Choose which models review your code, set a budget, and test the mix on your own PRs.
order: 15.5
---

A model panel gives each review [lens](./lenses.md) to a model you choose. Those experts suggest issues, then one lead agent checks them against the code.

**This is a hypothesis.** We think a mix of lower-cost experts with one verifying lead could give better results per dollar than one expensive model. We haven't measured it, so [test it on your PRs](#test-the-hypothesis) before relying on it.

## Set it up

You need a project that uses Git and an [OpenRouter](https://openrouter.ai/) API key.

**1. Create your panel**

```bash
plumbline panel init
```

This writes `~/.plumbline/panel.yml`, in your home folder. Open it and choose your models from [OpenRouter's model list](https://openrouter.ai/models).

**2. Add your key for this terminal**

On Windows PowerShell:

```powershell
$env:OPENROUTER_API_KEY = "your-key"
```

On Mac or Linux:

```bash
export OPENROUTER_API_KEY="your-key"
```

Don't put keys in `panel.yml` or commit them.

**3. Check the cost of your current change**

```bash
plumbline panel check
```

This shows each expert's worst-case cost and spends nothing.

**4. Run the review**

```bash
plumbline review --panel
```

## Example

This panel has Codex verify a mix of OpenRouter models and your signed-in Claude Code:

```yaml
version: 1
budget_usd: 2
lead: codex
data_policy: no_retention

experts:
  - id: regressions
    provider: openrouter
    model: google/gemini-4-carbon
    lenses: [L01]
  - id: architecture
    provider: claude
    lenses: [L02, L03, L05, L06]
  - id: hygiene
    provider: openrouter
    model: moonshotai/kimi-k3.1-pro
    lenses: [L04, L07, L08]
```

Set `provider: codex` or `provider: claude` to use a plan you already have. Those experts add no API charge through Plumbline, but they do use your plan's limits.

## Settings

| Field | Default | Meaning |
|---|---|---|
| `budget_usd` | Required | The most one review may cost in API calls, checked before it starts |
| `lead` | `auto` | Who verifies candidates: `auto`, `codex`, `claude` or `none` |
| `data_policy` | `no_retention` | `no_retention` uses zero-data-retention endpoints. `no_training` uses providers that don't collect your data |
| `max_input_tokens` | `120000` | The most each API request may carry. A larger change is split into parts, riskiest files first, and each API expert reads every part the budget covers |
| `max_output_tokens` | `12000` | The longest answer an API expert may write |
| `experts[].id` | Required | A short name shown in the report |
| `experts[].provider` | Required | `openrouter`, `codex`, `claude`, or a name under `providers` |
| `experts[].model` | Required for APIs | The model id at that provider |
| `experts[].lenses` | All enabled | The lenses this expert covers |
| `experts[].price` | Custom only | `input_per_million` and `output_per_million` in USD. Use `0` for a local model |

## Other providers

Any OpenAI-compatible API works. Custom endpoints must use HTTPS, or HTTP on localhost:

```yaml
providers:
  gemini:
    base_url: https://generativelanguage.googleapis.com/v1beta/openai
    key_env: GEMINI_API_KEY

experts:
  - id: gemini-direct
    provider: gemini
    model: your-model-id
    lenses: [L01]
    price: { input_per_million: 2, output_per_million: 10 }
```

Check the provider's current price, because Plumbline uses your number for the budget.

## How it stays honest

- **Agreement is not proof.** A P0 or P1 still needs a failing test, a graph diff or a broken rule, however many models agree.
- **With no lead, serious candidates show at P2.** API experts can't run proof tests.
- **Every candidate is accounted for.** The lead must merge, dismiss with code evidence, or keep each candidate. Anything else comes back as an unresolved P2.
- **Failures count.** If an expert fails, or the budget doesn't cover every part of the change, the merge score is capped at 4/5 and the unread files are named. If every expert fails, there is no score.
- **Nothing approves or merges.** A person still decides.

## Cost and privacy

- **Budget:** Plumbline prices the most expensive allowed endpoint and stops before any paid call if the worst case is over budget.
- **Data path:** API experts receive the diff, changed files and project rules directly from your machine. Plumbline runs no server, but your chosen provider receives that code.
- **Secrets:** files such as `.env` and private keys aren't sent, and common token formats are redacted. This can't catch every secret, so review your provider's data terms.
- **Keys:** they stay in environment variables and are hidden from review agents that read your code.
- **Repository safety:** keep the config outside your repositories. A panel file inside the reviewed repository can't define custom endpoints.

## Test the hypothesis

Label some real PRs with the [benchmark](./benchmark.md), then run your usual review and the panel on the same suite:

```bash
plumbline benchmark run --yes
plumbline benchmark run --panel --yes
plumbline benchmark compare
```

`budget_usd` applies to each case. The comparison shows what was newly caught or missed, unlabelled comments and panel API cost. Signed-in agent plans have no per-review price, so their cost shows as not measured.

## Current limits

- The OpenRouter and custom endpoint flows are tested against simulated APIs. They have not yet been verified with a live paid run.
- The panel runs from the CLI. The GitHub Action, GitLab template, MCP server and Agent Skill don't use it yet.
