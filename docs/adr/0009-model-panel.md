# ADR 0009: A configurable model panel

Status: accepted (2026-11-23). The result quality is an open hypothesis.

## Context

Teams already get second opinions by hand, such as Claude reviewing Codex's work. Users also want to pick models by price, including through OpenRouter. We expect that models miss different bugs, and that a mix of lower-cost experts with one verifying lead could give better results per dollar than one expensive model. We have not measured this.

## Decision

- **`plumbline review --panel`** sends each lens to the expert the user chose: an OpenRouter model, any OpenAI-compatible endpoint, or a signed-in Codex or Claude Code.
- **Agreement is not proof.** Experts only produce candidates. A lead agent verifies them and runs proof tests. With no lead, P0 and P1 candidates fall to P2 at the proof gate.
- **The config is user-level.** It lives at `~/.plumbline/panel.yml`, so a PR cannot change models, budgets or endpoints. A panel file inside the reviewed repository may not define custom endpoints.
- **Keys stay in environment variables** and are hidden from agents that read the code under review.
- **Budget first.** Plumbline prices the worst case for the actual change and stops before any paid call if it exceeds `budget_usd`. OpenRouter requests also carry a matching `max_price`.
- **Private by default.** OpenRouter requests use zero-data-retention endpoints unless the user chooses `no_training`. Likely secret files are withheld, common token formats are redacted, and symlinks are not followed.
- **The hypothesis stays labelled.** The site may describe it, but may not present it as a result until a published evaluation supports it. `plumbline benchmark run --panel` lets each team test it on its own PRs.

## Consequences

Code now goes directly from the user's machine to the provider they configure. We still run no servers. Files that do not fit `max_input_tokens` are passed to the lead, or recorded as unread, which caps the score at 4/5. CI and MCP do not use the panel yet.
