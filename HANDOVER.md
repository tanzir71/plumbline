# Plumbline — build and launch handover

Prepared 2026-11-21 for Claude Code, working in this folder (`C:\Users\tanzir\Desktop\greptile`).
Owner: Tanzir (tanziro.com). This folder is the monorepo root.

**Goal:** build the full product and launch it as **v1.0**: skill, core, CLI, MCP server, GitHub Action, GitLab CI template,
audit trail, merge gating, risk lanes, plus the landing site and docs on GitHub Pages. There are no staged public v0.x releases.

---

## 1. What we're building

**Plumbline** is an open-source code reviewer that users run with their own model keys.

| Surface | Where it runs | Who pays for the model |
|---|---|---|
| Agent Skill | Inside Claude Code, Codex, OpenCode (any harness that loads Agent Skills) | The user's agent plan or key |
| CLI | Any terminal or CI (`plumbline scope / graph / check / report / init / mcp`) | No model for the deterministic commands |
| MCP server | Any MCP client (`plumbline mcp`) | The calling agent |
| GitHub Action | The user's CI, on hosted or self-hosted runners | The user's API key (repo secret) |
| GitLab CI template | The user's GitLab pipelines | The user's API key (CI/CD variable) |

It does two jobs:
1. **Regressions.** It hunts logic bugs in the diff, as hosted PR bots do.
2. **Architecture.** It checks the PR against the structure the team agreed on: boundaries, layers, majority patterns,
   migration safety, API contracts. Rules come from ADRs, AGENTS.md / CLAUDE.md and a `plumbline.yml` contract.

A P0 or P1 finding needs **proof**: a failing test Plumbline wrote and ran in the user's own environment, a dependency-graph diff,
or the exact rule that broke. Without proof the finding is downgraded to P2 or dropped.

**Positioning, in the order the landing page tells it:**
1. **Cost.** No second bill: free software on the agent plan or key you already pay for. Hosted reviewers charge per seat or per review.
2. **The gap.** Bug bots read diffs; architecture lives between files.
3. **Proof you run yourself.** Failing tests run in your own environment, with your fixtures.
4. **Enterprise fit.** No account and no backend, so the only egress is to the customer's own model endpoint.

### 1.1 Landscape (checked 21 Nov 2026)
"Review skills inside the coding agent" and architecture-aware review both exist elsewhere now. These four points set Plumbline apart,
and the build must protect all of them:
- **$0, no account.**
  - Qodo's Agentic Toolbox brings its review engine into Claude Code, Codex and Kiro as skills, but its skills need a Qodo account.
  - Ito runs the app and posts runtime evidence, but it's hosted and costs $40/mo after the free reviews.
- **OSI open source, no server.** LiveReview is source-available (Sustainable Use License) and needs a server to run. Plumbline is MIT and has no backend.
- **The contract lives in the repo.** `plumbline.yml` is reviewed and versioned like code.
- **A person always approves.**
  - Several tools now auto-approve low-risk PRs.
  - Plumbline's risk lanes only add a label. They never approve or merge.

The site never claims a competitor's weakness. Competitors appear only in the Cost section's sourced price comparison.

**Not in scope:**
- a hosted SaaS, accounts, billing, or any server that receives user code
- benchmarks, accuracy figures or performance claims anywhere on the site or in the README, except the labelled aggregate field test in ADR 0008

Revenue later comes from architecture audits and rollouts (the final-CTA "teams" offer).

**Everything lives in one public GitHub repo: `github.com/tanzir71/plumbline`.**
- It holds the skill, CLI, core library, GitHub Action, GitLab template, landing page, docs and these handover files.
- The landing page and docs are static and served from GitHub Pages: https://tanzir71.github.io/plumbline/
- No other hosting, servers or databases. The only infrastructure is GitHub. See §4.1.

**Name:** a plumb line shows whether a wall is still vertical, and Plumbline shows whether the architecture is still true.
**Logo:** option E, "Drift". The name hasn't been checked for trademarks yet (see §10).

---

## 2. Starting point

- **Existing skill to evolve:** https://github.com/tanzir71/greptile-style-review. It's an MIT-licensed fork of `Ashref-dev/greptile-style-review` and contains:
  - `scripts/scope.sh`: pins the diff range and collects rule files.
  - Two parallel reviewers that share `references/reviewer-brief.md`. They split the bug checklist and read files in opposite orders.
  - A verification step that dedupes findings, re-checks findings only one reviewer raised, and drops ones that are unreachable, already guarded or style-only.
  - A 0–5 score with P0–P3 severities, plus review, review-and-fix and target-score modes.
  - Its README claims "96% of 722 reviews" match Greptile's score. Drop the claim.
- **Design:** Figma file `wZV2Kfz169GoDmzzlarbAy`.
  - Landing page: https://www.figma.com/design/wZV2Kfz169GoDmzzlarbAy/Greptile?node-id=3-49
  - Components: https://www.figma.com/design/wZV2Kfz169GoDmzzlarbAy/Greptile?node-id=3-18
  - Logo options board (E chosen): https://www.figma.com/design/wZV2Kfz169GoDmzzlarbAy/Greptile?node-id=22-241
  - Full written spec: `docs/landing-page.md`. Build only the visible layers. Hidden frames in the file are parked and not part of the site.

---

## 3. Non-negotiables

1. **Naming:** no "Greptile" in product names, package names, CLI, UI or marketing copy, except in the Cost section's sourced price
   comparison. Upstream copyright and attribution go in `LICENSE` and `NOTICE`.
2. **No invented numbers.**
   - No accuracy, catch-rate or speed claims anywhere.
   - The only numbers on the site are sourced prices and the cost calculator's arithmetic.
3. **Prices are data, not copy.**
   - Store them in `site/src/data/pricing.json` with `sourceUrl` and `checkedAt`.
   - CI fails if any entry is more than 90 days old.
   - Re-verify every price before launch.
4. **Enterprise statuses are true on launch day.**
   - Store them in `site/src/data/enterprise.json`.
   - Flip a row to `available` only when its milestone passes acceptance.
5. **Data path:** Plumbline never proxies user code through infrastructure we run.
6. **Deterministic first:** anything provable by graph analysis or a rule check must not be left to the model.
7. **Proof gate** on P0/P1 (§5.4).
8. **A person always approves.** Risk lanes and merge gating may label, comment or fail a check. Nothing in Plumbline ever approves or merges a PR.
9. **Lenses** are plain markdown files users can read, edit, disable or add to.
10. **UI rules** (the owner is strict):
    - Flat token colours only.
    - Glow only in backgrounds at element edges.
    - No strokes on cards, panels, buttons or the nav.
    - Minimal highlighting.
    - Dense layout with small headings.
    - No card grids.
    - Geist + Geist Mono.
    - Full rules are in `docs/landing-page.md` → "Design direction".
11. **Footer credit:** "Built by tanziro.com", linked.

---

## 4. Repo layout and stack

```
tanzir71/plumbline  (public)
├─ CLAUDE.md · HANDOVER.md · README.md · CHANGELOG.md · SECURITY.md · CONTRIBUTING.md
├─ LICENSE            MIT, upstream copyright line preserved
├─ NOTICE             "Based on greptile-style-review by Ashref-dev (MIT)"
├─ action.yml         the GitHub Action (composite) → runs packages/action; usage: tanzir71/plumbline@v1
├─ pnpm-workspace.yaml · package.json · tsconfig.base.json
├─ .github/workflows/
│  ├─ ci.yml          lint, test, build, pricing freshness check, site build, link check
│  ├─ pages.yml       build site/ and deploy to GitHub Pages
│  └─ release.yml     tag vX.Y.Z, move the major tag (v1), publish npm packages with provenance
├─ ci/gitlab/
│  └─ plumbline.yml   GitLab CI template, included by URL (§5.8)
├─ skills/
│  └─ plumbline/      the Agent Skill: SKILL.md, references/, lenses/, scripts/
│                     (this path is what `npx skills add tanzir71/plumbline` discovers)
├─ docs/
│  ├─ guide/          user docs, rendered on the site at /plumbline/docs/
│  ├─ landing-page.md · contract-spec.md
│  └─ adr/
├─ packages/
│  ├─ core/           @plumbline/core: contract, graph, checks, score, gate, lanes, reports
│  ├─ cli/            @plumbline/cli, bin "plumbline" (includes the MCP server)
│  └─ action/         runtime for the root action.yml and the GitLab template
├─ site/              Astro site; src/data/{pricing,enterprise}.json
├─ evals/             headless skill runs on the fixtures (manual, costs tokens)
└─ fixtures/          tiny repos with seeded issues
```
The skill lives at `skills/plumbline/`, not under `packages/`, so the skills CLI can discover it.

**Stack:**
- Node 20+ LTS, pnpm workspaces, TypeScript (strict), tsup, vitest, zod, yaml.
- dependency-cruiser builds the JS/TS import graph. The model-based lenses work in any language.
  The deterministic graph checks are JS/TS only in v1.0, and the docs must say so.
- Before adding a package, check it's maintained and licensed MIT, Apache-2.0 or BSD.
- The owner develops on Windows, so every script must be cross-platform.

### 4.1 Hosting and publishing (GitHub only)

**Actions minutes:**
- Standard GitHub-hosted runners are free for public repos and for GitHub Pages, so this repo's CI and Pages cost nothing.
- The owner's private-repo quota resets on the 14th of each month. Do all Action and GitLab testing in **public** test repos (`tanzir71/plumbline-test-*`).
- Keep workflows lean:
  - `concurrency` with cancel-in-progress
  - `paths` filters, so site changes don't run package tests and vice versa
  - one Node version
  - no OS matrix except a single Windows job for the CLI
- In the Action docs, explain that a private repo spends the user's minutes, and that self-hosted runners are an option.

**Site (GitHub Pages):**
- `.github/workflows/pages.yml` uses Astro's official `withastro/action` (with `path: site`), then `actions/deploy-pages`.
  Take the current major versions and the workflow shape from Astro's "Deploy to GitHub Pages" guide when you build it.
- Repo Settings → Pages → Source: **GitHub Actions**.
- `site/astro.config.mjs`: `site: 'https://tanzir71.github.io'`, `base: '/plumbline'`.
  - Every internal link and asset must go through `import.meta.env.BASE_URL`. No hard-coded `/` paths.
  - Add a `404.astro`.
- Custom domain later: add `site/public/CNAME` with the domain, set `site` to it and remove `base`. The links keep working because they're base-aware.
- The site is built in M6, after the product works. `pages.yml` is added then, so nothing goes live before the install commands work.

**Content built from the repo at build time:**
- the Lenses table, from `skills/plumbline/lenses/*.md` frontmatter
- `/docs/`, from `docs/guide/*.md`
- `/changelog/`, from `CHANGELOG.md`
- Prices and Enterprise rows, from `site/src/data/*.json`
- Install snippets, from one source file shared with the docs, so the site and the docs can't drift apart

**GitHub Action:**
- Root `action.yml` (composite). Users write `uses: tanzir71/plumbline@v1`.
- `release.yml` keeps the moving major tag (`v1`) on the latest `v1.x.y`.
- **Marketplace:** GitHub only lists actions from repos with a single root `action.yml` and no workflow files.
  This repo needs workflows for CI and Pages, so it won't be listed. The action still works by reference.

**Skill:**
- It lives at `skills/plumbline/`, where the skills CLI discovers it from `npx skills add tanzir71/plumbline`.
- Verify this in M0. If discovery fails, document the direct path form instead:
  `npx skills add https://github.com/tanzir71/plumbline/tree/main/skills/plumbline`.

**npm:**
- `@plumbline/core` and `@plumbline/cli` are published from `release.yml` with npm provenance.
- If the `plumbline` package name is free, also publish a thin `plumbline` package that re-exports the CLI bin.

**Everything in the repo is public:**
- No secrets in files.
- The Pages workflow needs no secrets. npm publish uses an `NPM_TOKEN` repo secret or trusted publishing.
- Store pricing evidence as archived links (Wayback Machine URLs in `pricing.json` → `archiveUrl`), not screenshots of competitor pages.
- CLAUDE.md and HANDOVER.md are public too. Keep them factual and free of anything you wouldn't put in a README.

---

## 5. How a review runs

### 5.1 Scope
Port `scripts/scope.sh` to `plumbline scope` (Node, cross-platform). Keep the upstream default: the current branch vs `dev` → `main`, plus uncommitted work.

It collects:
- the diff
- `plumbline.yml`
- `docs/adr/**` and `**/ADR-*.md`
- `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`
- `.plumbline/lenses/*.md`

### 5.2 Deterministic pass (no model)
- `plumbline graph --base <ref> --json` builds the import graph at base and HEAD, then reports:
  - added and removed edges
  - new cycles, with the full path
  - edges that cross layers
- `plumbline check --json` evaluates the contract's `forbid` and `layers` rules against HEAD and returns violations with rule ids.
- Results are written to `.plumbline/run/<timestamp>/`.

### 5.3 Parallel reviewers
If the harness has no sub-agents, the main agent runs these passes one after another.

| Reviewer | Lenses | Inputs |
|---|---|---|
| A, B (upstream briefs) | L01 Regressions | diff, conventions, tests, git history |
| C Architecture | L02 Boundaries & cycles, L03 Pattern deviations, L05 Migrations, L06 API contracts | diff + graph/check JSON + contract + ADRs |
| D Hygiene & ops | L04 Distributed systems, L07 Agent-PR hygiene, L08 Operability & cost | diff + conventions |

### 5.4 Proof gate
Merge and dedupe findings (upstream rules), then require proof for every P0 and P1:
- `failing_test`: write the test under `.plumbline/proofs/` and run it with the repo's test command. It must fail on HEAD, and should
  pass on base when that's practical. Never commit proof tests outside review-and-fix mode.
- `graph_diff`: cite the edge or cycle from §5.2.
- `broken_rule`: cite the contract rule id or the ADR number and the line that breaks it.
- No proof means the finding drops to P2. If it's also unreachable or style-only, drop it.

### 5.5 Report (also the audit trail)
The same content in three formats, written to `.plumbline/run/<timestamp>/` on every run:
- **Markdown** (`report.md`), for the terminal and PR/MR comments:
  1. Merge score `N/5` with a verdict and counts.
  2. Findings: severity, lens, title, body, proof.
  3. Dependency diff as Mermaid.
  4. Footer: what ran, model, duration, skipped lenses, lane decision.
- **JSON** (`report.json`), for machines. Its schema is versioned in `packages/core/schema/report.v1.json`.
- **SARIF 2.1.0** (`report.sarif`), for GitHub code scanning and SIEMs.
- In CI, all three are uploaded as job artifacts. On GitHub, the SARIF goes to code scanning when `upload-sarif: true`. Code scanning on private repos needs GitHub Code Security, so the default is `auto`: upload on public repos only.
  On GitLab, a Code Quality report (`gl-code-quality-report.json`) is also produced for the MR widget.

Keep upstream's scoring rules exactly as they are in the fork's SKILL.md, rename the score to "Merge score", and document the rules in the README.

### 5.6 Merge gating
- `gate` in `plumbline.yml` sets `min_merge_score` per base-branch pattern.
- In CI, if the PR's base branch matches and the score is below the minimum, the review job fails with a one-line reason.
  It also writes the score as a step output (GitHub) or a dotenv report (GitLab).
- Users make the job a required status check (GitHub) or turn on "Pipelines must succeed" (GitLab). The docs show both.
- Locally, `plumbline report --gate` exits non-zero under the same rule, for pre-push hooks.

### 5.7 Risk lanes
- `lanes` in `plumbline.yml` defines when a PR qualifies for light review. The default:
  - merge score 5
  - no finding at P2 or above
  - at most 200 changed lines
  - no file matching `never`
- In CI, a qualifying PR gets the lane label (default `plumbline:light-review`) and a line in the comment saying why.
  When a later push stops qualifying, the label is removed.
- Lanes **never** approve, merge, request reviewers or dismiss reviews. Approving stays with a person (§3.8).

### 5.8 GitLab CI template
- Users include the template:
  `include: { remote: 'https://raw.githubusercontent.com/tanzir71/plumbline/v1/ci/gitlab/plumbline.yml' }`
  Then they set `PLUMBLINE_MODEL_KEY` and a project access token, `PLUMBLINE_GITLAB_TOKEN`, with the `api` scope.
- On `merge_request_event` pipelines it runs the same runtime as the Action. It:
  - posts or updates one MR note
  - applies or removes the lane label
  - produces the artifacts and the Code Quality report
  - fails the job under the gate rule
- Self-managed GitLab: the API URL comes from `CI_API_V4_URL`. Never hard-code gitlab.com.

### 5.9 Lenses (`skills/plumbline/lenses/Lnn-name.md`)
Each lens file has:
- frontmatter: `id`, `name`, `default: on|off`, `proof: [...]`, `catches`, `example`
- sections: *What to look for*, *How to prove it*, *False-positive traps*, *Examples*

The site's Lenses table is generated from this frontmatter at build time. Users can add their own lenses in `.plumbline/lenses/`.

| ID | Lens | Typical proof |
|---|---|---|
| L01 | Regressions | failing_test |
| L02 | Boundaries & cycles | graph_diff, broken_rule |
| L03 | Pattern deviations | failing_test, broken_rule |
| L04 | Distributed systems | failing_test |
| L05 | Migrations | broken_rule, failing_test |
| L06 | API contracts | graph_diff, broken_rule |
| L07 | Agent-PR hygiene | broken_rule |
| L08 | Operability & cost | broken_rule |

---

## 6. Contract: `plumbline.yml` (v1)

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
gate:                        # merge gating (§5.6)
  - branches: ["main", "release/*"]
    min_merge_score: 3
lanes:                       # risk lanes (§5.7): a label only, never approval
  light:
    label: "plumbline:light-review"
    when: { merge_score: 5, max_severity: P3, max_changed_lines: 200 }
    never: ["**/migrations/**", ".github/**", "src/billing/**"]
```

- Validate with zod and give line-accurate error messages.
- `plumbline init` (CLI) writes a skeleton and guesses modules from the folder structure.
- `/plumbline init` (skill) has the agent draft rules from ADRs and AGENTS.md, then show a diff for the user to accept.
- The landing page shows a simplified snippet. Keep it valid against the final schema.

---

## 7. Milestones (in order; each ends with tests green and a CHANGELOG entry)

**M0 — Repo, rename, import.**
- Set up the pnpm monorepo.
- Bring the fork's skill into `skills/plumbline/` without its git history and rename it (`/plumbline review`).
- Add LICENSE and NOTICE, and drop the 96% claim.
- Port `scope.sh` to `plumbline scope`.
- Add `ci.yml`.
- *Acceptance:*
  - `pnpm i && pnpm build && pnpm test` pass on Windows and Linux, locally and in CI.
  - Once pushed, `npx skills add tanzir71/plumbline --list` shows the `plumbline` skill. Before the first push, `npx skills add ./skills/plumbline` works.
  - "greptile" appears only in LICENSE, NOTICE, CLAUDE.md, HANDOVER.md, `docs/landing-page.md` and `pricing.json`.

**M1 — Core: contract, graph, checks, score, gate, lanes.**
- Build:
  - the zod contract parser for the full v1 schema (§6)
  - the dependency-cruiser graph builder
  - the base/HEAD graph diff and cycle detection
  - `forbid`/`layers` checks
  - gate and lane evaluation as pure functions
  - report renderers for md, json (+ schema) and sarif
- Write `docs/contract-spec.md`.
- *Acceptance:*
  - `ts-cycle` reports the exact cycle path.
  - `ts-layer-violation` reports the rule id.
  - Clean fixtures report nothing.
  - Gate and lane decisions are table-tested.
  - The SARIF validates against the 2.1.0 schema.
  - Graph diff on a 2k-file repo takes under 10s.

**M2 — Skill: lenses, reviewers A–D, proof gate, init.**
- *Acceptance:*
  - On the fixtures, `/plumbline review` finds:
    - the seeded cycle (P1, graph_diff)
    - the tenancy gap (P1, failing test)
    - the unsafe migration (P2 or higher)
  - A P1 without proof is shown downgraded.
  - `/plumbline init` drafts a valid contract from a fixture with ADRs.
  - It works in Claude Code and Codex. OpenCode is checked once by hand.
  - `evals/` runs headless on every fixture and checks the expected lens ids and severities.

**M3 — CLI + MCP server.**
- `plumbline init | scope | graph | check | report [--gate] | mcp`, with human-readable and `--json` output everywhere.
- `plumbline mcp` exposes `scope`, `graph_diff`, `check_contract`, `list_lenses`, `render_report`.
- *Acceptance:*
  - The MCP tools work from Claude Code and one other MCP client.
  - `npx plumbline …` works on a clean Windows machine.

**M4 — GitHub Action: review, audit trail, gating, lanes.**
- The Action is the root `action.yml`, so users write `uses: tanzir71/plumbline@v1`.
- It runs the skill with the user's key:
  - Wrap an official agent action where one fits (check current docs for its inputs). Otherwise install the agent CLI and run it headless.
  - Providers: Anthropic (default), Bedrock, Vertex, and an OpenAI-compatible endpoint on self-hosted runners.
- It posts or updates a single PR comment, uploads artifacts and the optional SARIF, applies the gate (§5.6) and the lane label (§5.7).
- Inputs:
  - `model`, `key`, `provider`, `base-url`
  - `comment` (true), `upload-sarif` (auto), `gate` (true), `lanes` (true), `fail-on-error` (false)
- *Acceptance, in public test repos:*
  - A re-run edits the existing comment instead of posting a new one.
  - A below-threshold PR fails the job.
  - A qualifying PR gets the label, and the label is removed after a risky push.
  - The SARIF shows up in code scanning.
  - Self-hosted runners work.
  - `release.yml` moves the `v1` tag.

**M5 — GitLab CI template.**
- `ci/gitlab/plumbline.yml` on the same runtime (§5.8).
- *Acceptance, in a public gitlab.com test project:*
  - MR note created and then updated.
  - Code Quality report shows in the MR.
  - Gate fails the pipeline.
  - Lane label applied and removed.

**M6 — Landing site + docs on GitHub Pages** (`site/`, spec in `docs/landing-page.md`, hosting in §4.1).
- *Acceptance:*
  - `pages.yml` deploys on every push to `main`, and the site is live at https://tanzir71.github.io/plumbline/
  - Every link and asset works under the `/plumbline/` base. CI runs a link check on the built output.
  - `/docs/` covers every surface in §1, the contract, gating, lanes and the audit trail.
  - `/changelog/` renders from repo markdown. The 404 page works.
  - Every visible block matches Figma at 1440px.
  - Layouts at 1024, 768 and 375px follow the responsive rules.
  - Lighthouse scores 95 or higher for Performance and Accessibility.
  - Fonts are self-hosted with no layout shift.
  - Copy buttons, Install tabs and the cost calculator work by keyboard.
  - Install snippets match the real package names, action inputs and CLI.
  - Prices come from `pricing.json`, and the freshness check runs in CI.
  - Enterprise statuses come from `enterprise.json`, and each one is true.
  - No gradients on components, glow only in backgrounds, no strokes beyond the allowed rules.

**M7 — Launch v1.0.**
- Work through the launch checklist (§9).
- Tag `v1.0.0`, move `v1`, publish to npm with provenance, and add a GitHub release with notes.
- Flip every Enterprise row that passed acceptance to `available` with `since: "v1.0"`.
- Set the site's version labels to `v1.0`.

---

## 8. Testing

- **core:** vitest unit tests plus fixtures (`ts-cycle`, `ts-layer-violation`, `tenancy-missing-scope`, `unsafe-migration`, `adr-contract`, `clean`).
  Gate and lane logic are table-tested. Report output uses snapshot tests, and the SARIF is checked against its schema.
- **skill:** `evals/` runs the agent headless on each fixture and checks the findings JSON. It's manual because it costs tokens.
- **action / GitLab:** public test repos (`tanzir71/plumbline-test-*` and a gitlab.com project) with one scripted PR or MR per scenario:
  clean, below gate, lane-qualifying, then a risky push.
- **site:**
  - Playwright smoke tests at 1440, 768 and 375px.
  - A Lighthouse CI budget.
  - A pricing freshness check.
  - A link check.
  - A visual check that no component uses gradient fills.

---

## 9. Launch checklist

- [ ] Name check: trademark search, `npm view plumbline`, GitHub, domain. Fallback is the `@plumbline/*` scope with a `plumbline` bin.
- [ ] Repo is public. Settings → Pages → Source is "GitHub Actions". Branch protection on `main` requires CI.
- [ ] Re-verify every price in `pricing.json` and save a Wayback Machine snapshot link in `archiveUrl`.
- [ ] `enterprise.json` matches what shipped. Every row is `available`, unless it honestly says otherwise.
- [ ] No accuracy, catch-rate or speed claims anywhere: site, README, docs, release notes.
- [ ] README: what it is, install for each surface, honest limits (graph checks are JS/TS only), where the scoring rules come from.
- [ ] `SECURITY.md`: the only network calls go to the user's own model provider and their own GitHub/GitLab API.
- [ ] Every install snippet on the site was run once, from a clean machine, against the published v1.0.

---

## 10. Decisions and open questions

| Item | Status / default |
|---|---|
| Scope | **Decided:** the full product ships together as v1.0 (§7) |
| Logo | **Decided:** option E, "Drift" (SVG in `docs/landing-page.md`) |
| Repo | **Decided:** one public repo, `github.com/tanzir71/plumbline`. Fresh history, attribution in NOTICE |
| Site hosting | **Decided:** GitHub Pages from that repo, deployed by Actions → https://tanzir71.github.io/plumbline/ |
| Domain | The github.io URL for now. A custom domain is optional later via `site/public/CNAME` (§4.1) |
| Marketplace listing | Not possible from a repo with workflows. Use `uses: tanzir71/plumbline@v1` |
| GitLab distribution | Remote include from the GitHub raw URL at the `v1` tag. A GitLab CI/CD Catalog listing is optional later |
| Graph languages | JS/TS in v1.0. Python (import-linter or grimp) and Go come after launch |
| "Book an architecture audit" link | Placeholder `#audit`. Suggested target: the elevatecoreai.com contact page |
| Analytics | None by default. Optional PostHog behind an env flag, cookieless |
| Trademark | Not cleared. Check before launch |
