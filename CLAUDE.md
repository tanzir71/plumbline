# Plumbline — project memory for Claude Code

Plumbline is an open-source code reviewer that users run with their own model keys. It runs inside coding agents
(Claude Code, Codex, OpenCode), in CI and over MCP. It finds regressions like hosted PR bots, then checks each PR
against the team's intended architecture (ADRs, AGENTS.md / CLAUDE.md, a `plumbline.yml` contract).
Serious findings must come with proof. Plumbline is a tanziro.com project.

Tagline: **Review the structure, not just the diff.**

## Read these first
1. `HANDOVER.md`: product, positioning, review pipeline, contract schema, gating and lanes, milestones M0–M7 (full v1.0), launch checklist.
2. `docs/landing-page.md`: landing page spec (tokens, glow recipes, components, every section's copy, responsive rules).
3. Figma, the source of truth for visuals (build visible layers only; hidden frames are parked): https://www.figma.com/design/wZV2Kfz169GoDmzzlarbAy/Greptile?node-id=3-49
   - Components: https://www.figma.com/design/wZV2Kfz169GoDmzzlarbAy/Greptile?node-id=3-18
   - If the Figma MCP is available, call `get_design_context` on a section's node before building it.

## Non-negotiables
- **Naming:** never use "Greptile" in names, packages, CLI commands or UI. Upstream MIT attribution lives in `LICENSE` and `NOTICE`.
  Competitors may be named only in the Cost section's sourced price comparison.
- **No invented numbers:**
  - No accuracy, catch-rate or speed claims anywhere (site, README, docs, release notes).
  - Prices come from `site/src/data/pricing.json`, each with `sourceUrl` and `checkedAt`. CI fails if any is older than 90 days.
  - Do not carry over the upstream "96% of 722 reviews" claim.
- **Enterprise table:** every status must be true on the day it ships (`site/src/data/enterprise.json`).
- **Data path:** never route user code through servers we run. Users bring their own model keys or plans.
- **Deterministic first:** graph and rule checks before the model. The model only handles judgement calls.
- **Proof gate:** P0/P1 findings need `failing_test`, `graph_diff` or `broken_rule`. Without it, downgrade to P2 or drop.
- **Lenses** are plain markdown in `skills/plumbline/lenses/` that users can read, edit or disable.
- **A person always approves:** merge gating may fail a check and risk lanes may add a label. Nothing ever approves or merges a PR.
- **Never claim a competitor weakness** on the site.
- **Everything is in one public repo** (`tanzir71/plumbline`): skill, CLI, core, MCP, GitHub Action, GitLab template, site, docs.
  - The site and docs are static on GitHub Pages: https://tanzir71.github.io/plumbline/
  - No other hosting, servers or databases.
  - Treat every file as public: no secrets, no internal notes you wouldn't put in a README.

## UI rules (the owner is strict about these)
- **Colour and effects:**
  - Dark only, flat token colours.
  - No gradient fills on components.
  - No drop shadows.
  - No warm or amber colours.
- **Glow** only lives in section backgrounds, positioned at the edges of an opaque element so just a halo shows.
  It's used behind the hero product shot and the final-CTA teams box only. Never inside an element.
- **Strokes:**
  - None on cards, panels, buttons or the nav.
  - Allowed: 1px table rules (line-edge at 60%), the "At a glance" head rule and the footer bottom rule.
- **Layout:** dense and minimal.
  - Headings: H1 52, H2 32.
  - Section padding: 88.
  - Section heads have the title on the left and the lead on the right.
  - Use tables and ledgers instead of card grids.
- **Highlighting:** be minimal. Prefer coloured text over outlines, tints or extra boxes.
  Example: in a diagram, only the edge and the target label are red; nodes stay neutral.
- **Spacing:** text never touches a rule, marker or node. Leave real space above rails and below drawings.
- **Logo:** option E ("Drift"). Three stacked blocks with the middle one shifted, plus a plumb line ending in a dot.
  The SVG is in `docs/landing-page.md`.
- **Fonts:** Geist + Geist Mono, self-hosted.
- **Footer credit:** "Built by tanziro.com", linked to https://tanziro.com.

## Stack
- Node 20+ LTS, pnpm workspaces, TypeScript strict, vitest, zod, tsup.
- `packages/core`: dependency-cruiser for the JS/TS import graph (first language).
- `site/`: Astro, static output, plain CSS with the tokens in `docs/landing-page.md`.
  JavaScript only for copy buttons, tabs, the cost calculator and the mobile nav.

## Layout (target)
```
action.yml          the GitHub Action (composite); users write `uses: tanzir71/plumbline@v1`
.github/workflows/  ci.yml · pages.yml (site → GitHub Pages) · release.yml (tags, v1 major tag, npm)
skills/plumbline/   Agent Skill (SKILL.md, references/, lenses/, scripts/), where `npx skills add tanzir71/plumbline` finds it
packages/core       contract parser, graph build + diff, rule checks, score, report (md, json, sarif)
packages/cli        `plumbline` bin: init | scope | graph | check | report | mcp
packages/action     action runtime invoked by the root action.yml
ci/gitlab/          GitLab CI template (remote include at the v1 tag)
site/               Astro site for GitHub Pages (+ src/data/pricing.json, enterprise.json)
docs/guide/         user docs, rendered at /plumbline/docs/
evals/              headless skill runs on the fixtures (manual, costs tokens)
fixtures/           tiny repos with seeded issues (cycle, layer violation, tenancy, unsafe migration, clean)
```

## Hosting rules (GitHub Pages)
- Deploy with Astro's official `withastro/action` (`path: site`) + `actions/deploy-pages` in `.github/workflows/pages.yml`.
  Copy the current workflow from Astro's GitHub Pages guide.
- `astro.config.mjs`: `site: 'https://tanzir71.github.io'`, `base: '/plumbline'`.
  Every internal link and asset uses `import.meta.env.BASE_URL`; never hard-code `/`.
- Docs, changelog and the lenses table are generated from repo files at build time. There's no CMS.
- Standard runners are free for public repos and Pages. Test the Action and GitLab template in public test repos only
  (the owner's private-repo minutes reset on the 14th). Keep workflows lean: concurrency, paths filters, no big matrices.
- The action can't be listed on the Marketplace from this repo (workflow files present). That's accepted.

## Commands (create these in M0)
- `pnpm i` · `pnpm build` · `pnpm test` · `pnpm lint`
- `pnpm --filter site dev` · `pnpm --filter site build`
- `pnpm --filter @tanziro/plumbline exec plumbline graph --base main --json`

## Working rules
- Work milestone by milestone (HANDOVER.md §7) toward one full v1.0 launch. Finish each with tests green and a short entry in `CHANGELOG.md`.
- When a decision isn't covered here, pick the simplest option, record it as a short ADR in `docs/adr/NNNN-title.md`, and keep going.
- Keep site copy in sync with the real CLI, action inputs and contract schema.
- Check npm and GitHub name availability before publishing anything (`npm view plumbline`).
- The owner works on Windows (this folder is `C:\Users\tanzir\Desktop\greptile`). Make scripts cross-platform:
  port `scope.sh` to a Node `plumbline scope` command.
