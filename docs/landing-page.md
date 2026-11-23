# Landing page spec — Plumbline

Source of truth for visuals: Figma file `wZV2Kfz169GoDmzzlarbAy`, page "Plumbline".
This document has every token, component and line of copy, so the page can be built without Figma.
If the Figma MCP is available, call `get_design_context` on each section node before building it.

Base URL for node links: `https://www.figma.com/design/wZV2Kfz169GoDmzzlarbAy/Greptile?node-id=`
(replace `:` with `-` in the node id, e.g. `24:241` → `24-241`).

## Design direction

**Enterprise, dense, minimal.** The page reads like an engineer's drawing set and a spec sheet, not a marketing template.
- **Dense:** small headings, 88px section padding, two-up section heads (title left, lead right), tables and ledgers over cards.
- **Drafting motifs:**
  - rails with hanging leaders (How it works)
  - real output artifacts instead of descriptions
  - before/after evidence panels (The gap)
  - a data-path rail (Enterprise)
- **Flat colours only.** Every surface is a single token colour. No gradient fills on components.
- **Glow lives in backgrounds, never inside elements.**
  - Soft radial glows go on a *section background*, positioned at the edges of an opaque element, so only a halo shows around it.
  - Used only behind the hero product shot and the final-CTA teams box. Recipes are below.
- **Strokes:**
  - None on cards, panels, buttons or the nav.
  - The only lines allowed are 1px table rules (line-edge at 60%), the "At a glance" heading rule and the footer's bottom rule.
- No warm or amber colours. No drop shadows.

## Nodes

| Section | Node | Height @1440 | Background |
|---|---|---|---|
| Page wrapper "Plumbline — Landing" | `3:49` | ≈7750 | — |
| Announcement bar | `17:240` | 36 | bg/surface |
| Nav | `3:50` | 72 | bg/canvas |
| Hero (+ product shot) | `3:67` | 1263 | bg/canvas + edge glows |
| 01 Cost | `24:241` | 641 | bg/surface |
| 02 The gap | `10:238` | 827 | bg/canvas |
| 03 How it works | `10:169` | 627 | bg/surface |
| 04 Lenses | `11:204` | 915 | bg/canvas |
| 05 Architecture contract | `5:111` | 592 | bg/surface |
| 06 Proof | `5:133` | 473 | bg/canvas |
| 07 Enterprise | `26:252` | 841 | bg/surface |
| 08 Install | `11:385` | 694 | bg/canvas |
| Final CTA | `26:367` | 446 | bg/canvas + edge glows |
| Footer | `26:395` | 323 | bg/canvas |
| Components frame | `3:18` | — | — |

Hidden layers in the file are parked and not part of the site. Build only what's visible.
| Logo options board (E chosen) | `22:241` | — | reference only |

## Stack

- **Hosting:** GitHub Pages from the public repo `tanzir71/plumbline`, deployed by `.github/workflows/pages.yml` (see HANDOVER §4.1).
  - Live URL: https://tanzir71.github.io/plumbline/
  - Astro config: `site: 'https://tanzir71.github.io'`, `base: '/plumbline'`.
  - Every internal link and asset goes through `import.meta.env.BASE_URL`.
  - Link map:
    - Docs → `/plumbline/docs/` (from `docs/guide/*.md`)
    - Changelog → `/plumbline/changelog/` (from `CHANGELOG.md`)
    - GitHub → https://github.com/tanzir71/plumbline
    - Cost, Product, Lenses, Install → in-page anchors (`#cost`, `#product`, `#lenses`, `#install`)
    - Security → `SECURITY.md` on GitHub
    - License → `LICENSE` on GitHub
- Astro, static output. Landing page: `site/src/pages/index.astro`, with one component per section in `site/src/components/`.
- Plain CSS: `site/src/styles/tokens.css` plus one stylesheet per component. No CSS framework needed.
- Fonts: self-host **Geist** (400/500/600) and **Geist Mono** (400/500). Use Fontsource or the `geist` package;
  verify package names. Use `font-display: swap` with metric-compatible fallbacks.
- JavaScript only for the copy buttons, the Install tabs, the cost calculator and the mobile nav.
- Keep Geist's contextual alternates on (the default) so `->` renders as an arrow, as in Figma.

## Tokens (`site/src/styles/tokens.css`)

These mirror the Figma variable collection "Plumbline" (mode "Dark").

```css
:root {
  --bg-canvas:   #0A0C0F;
  --bg-surface:  #11151A;
  --bg-raised:   #181D24;
  --bg-inset:    #0D1014;
  --text-primary:   #EDF0F3;
  --text-secondary: #A2AAB5;
  --text-muted:     #7E8793;   /* AA on canvas, surface and raised */
  --accent-plumb:    #6EE7C8;
  --accent-on-plumb: #04221B;
  --sev-p0: #FF6B81;
  --sev-p1: #B79BFF;
  --sev-p2: #7AA7FF;
  --sev-p3: #8A939E;
  --line-subtle: #1C2129;
  --line-edge:   #353C46;      /* rules at 60% opacity, rails, graph edges, leaders */

  /* tints: color-mix(in srgb, <color> N%, transparent) */
  --tint-sev: 16%;             /* severity badges */
  --tint-alert: 10%;           /* sev-p0 verdict / FAIL / broken-rule boxes */
  --tint-accent: 14%;          /* AVAILABLE status pills, version tag */

  --r-xs: 4px; --r-sm: 6px; --r-md: 8px; --r-lg: 10px; --r-xl: 14px; --r-2xl: 16px; --r-pill: 999px;
  --content: 1200px; --gutter: 120px; --section-y: 88px;
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

### Edge-glow recipes (background only)

Each glow is a `radial-gradient` layer on the **section's background**, centred on an edge of the opaque element in front of it.
Percentages and pixel sizes match Figma at 1440px. Position the glows relative to the element: absolutely positioned `::before`
on the element's wrapper, `inset: -200px`, `z-index: -1`, `pointer-events: none`.

**Hero, behind the product shot:**
```css
background:
  radial-gradient(190px 380px at 0% 55%,   rgb(110 231 200 / .15), transparent 100%),  /* mint, shot's left edge */
  radial-gradient(520px 140px at 50% 100%, rgb(143 162 255 / .19), transparent 100%),  /* blue, shot's bottom edge */
  radial-gradient(160px 280px at 100% 25%, rgb(183 155 255 / .08), transparent 100%),  /* violet, shot's right edge */
  var(--bg-canvas);
```
(The percentages refer to the product shot's box.)

**Final CTA, behind the teams box:**
- Blue `rgb(143 162 255 / .10)`, about 400×200px, centred on the box's bottom edge.
- Mint `rgb(110 231 200 / .06)`, about 115×220px, at the box's left edge.

**Elsewhere:** nothing else on the page uses glows or gradients.

## Typography

| Role | Font | Size / line height | Weight | Tracking | Color |
|---|---|---|---|---|---|
| H1 (hero) | Geist | 52 / 56 | 600 | -3% | line 1 primary, line 2 secondary |
| H2 (sections) | Geist | 32 / 38 | 600 | -2% | primary |
| H2 (final CTA) | Geist | 40 / 46 | 600 | -2.5% | primary |
| Lead | Geist | 15 / 24 (hero 17 / 27) | 400 | 0 | secondary |
| Item title | Geist | 14–18 | 500 | -1% | primary |
| Body | Geist | 13 / 20 or 14 / 21 | 400 | 0 | secondary |
| Section eyebrow | Geist Mono | 12 | 500 | `NN` accent + label +8% uppercase muted | — |
| Micro label / table head | Geist Mono | 10–12 | 500 | +6–8% uppercase | muted |
| Code / output | Geist Mono | 12 / 20 (artifacts, diff), 13 / 21 (contract, test), 14 / 24 (install) | 400 | 0 | per section |

**Section head pattern:** a row with the title block on the left and the lead on the right (max 460, bottom-aligned).
- Title block: eyebrow (`02` in accent + `THE GAP` in muted), 12px gap, then H2 (max 620, two lines by design).

## Components (Figma → Astro)

| Figma component | Node | Astro component | Spec |
|---|---|---|---|
| Logo (option E, "Drift") | `3:20` | `Logo.astro` | 22×22 mark (SVG below) + "plumbline" Geist 600 19px, -2%, gap 9, vertically centred |
| Button/Primary | `3:25` | `Button.astro variant="primary"` | flat accent-plumb, label accent-on-plumb 15/500, padding 12×20, radius 8 |
| Button/Secondary | `3:27` | `Button.astro variant="secondary"` | flat bg-raised, label primary, no stroke |
| Badge (Severity=P0…P3) | `3:37` | `Badge.astro` | padding 3×8, radius 4, sev color at 16%, mono 12/500 in sev color |
| Tag | `3:38` | `Tag.astro` | padding 3×8, radius 4, bg inset, mono 12 secondary |
| FindingRow | `3:40` | `FindingRow.astro` | bg raised, radius 10, padding 18×20, gap 10: [Badge, Tag] → title 16/22 500 → body 14/21 → proof mono 12 accent |
| PassColumn | `10:147` | `PassColumn.astro` | 300 wide, no fill. **Top** (fixed 138 tall, padding-right 32, padding-bottom 28 so text never touches the rail): label row (`PASS 0n` mono 12/500 +8% accent + kind mono 12 muted), title 18/24 500, desc 13/20 (2 lines max). **Rail**: 9×9 accent square (radius 2) + 1px line-edge filling the width, centred on the square. **String**: 1×28 line-edge under the square's centre, from its bottom edge to the artifact's top edge. **Artifact**: bg inset (the section is surface), padding 16, mono 12/20, radius 8 with a square (0) top-left corner where the string lands |
| GapNote | `10:162` | `GapNote.astro` | 384 wide, no fill: 1px line-edge rule, then [num mono 12 accent + title 17/500] on a baseline, body 14/21, `caught by` mono 12 muted |
| LensRow | `11:190` | `LensRow.astro` | rule (line-edge 60%) + row padding 13×0, columns 72 / 220 / 380 / 300 / 228: ID mono 13/500 accent · lens 15/500 · catches 13/20 secondary · example chip (bg surface, since the section is canvas; radius 6, padding 4×8, mono 12 muted) · proof mono 12 secondary |
| Tab (Active/Inactive) | `11:384` | `Tabs.astro` | label 14/500. Active: primary + 2px accent underline. Inactive: secondary, no underline |
| SpecRow | `26:242` | `SpecRow.astro` | rule + row padding 13×0, columns 176 / 452 / rest: capability 14/500 · how 13/20 secondary · status pill (padding 2×7, radius 4, mono 10/500 +6%). `AVAILABLE` = accent at 14% with an accent label. `ROADMAP · V1.x` and `PARTIAL` = flat bg-raised with a muted label (Figma shows the launch state, where every row is AVAILABLE) |

Logo mark SVG (option E). Colours via tokens: blocks `--text-secondary`, line and weight `--accent-plumb`. Use `overflow: visible`.
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1.5" y="3"    width="12" height="4.5" rx="1" fill="var(--text-secondary)"/>
  <rect x="4.5" y="9.75" width="12" height="4.5" rx="1" fill="var(--text-secondary)"/>
  <rect x="1.5" y="16.5" width="12" height="4.5" rx="1" fill="var(--text-secondary)"/>
  <path d="M20.5 3V16.75" stroke="var(--accent-plumb)" stroke-width="1.5"/>
  <circle cx="20.5" cy="18.75" r="2.25" fill="var(--accent-plumb)"/>
</svg>
```
The middle block is shifted right (drift). The line and weight span exactly the height of the block stack.
Render it at 22px in the nav and footer. Favicon: the same mark at 70% of a 32px bg-raised tile, radius 7.

## Sections and copy (use verbatim)

### Announcement `17:240`
Full-width bar, bg surface, padding 9×120, centred, gap 12.
- Version tag (accent at 14%, radius 4, padding 2×6): `v1.0` (mono 11/500 accent)
- `Plumbline 1.0: architecture lenses, proof-gated findings, CI gating and risk lanes. Open source under MIT.` (13 secondary)
- `Read the release notes` (13/500 primary) + 12px accent arrow → `/plumbline/changelog/`

### Nav `3:50`
Padding 14×120, no border. Logo, then centre links (14 secondary, gap 32): Cost · Product · Lenses · Docs · Changelog.
Right: Secondary "GitHub", Primary "Install" (gap 10).

### Hero `3:67`
Padding 64 / 120 / 88, left-aligned, gap 48. The background has the edge glows above.
- **HeroTop** row (gap 64, vertically centred):
  - **Left** (640):
    - Eyebrow pill: flat bg raised, radius pill, padding 5×10, a 6px accent dot, then `Open source · MIT · bring your own keys` (mono 12 secondary).
    - H1 `Review the structure,` / `not just the diff.` (line 2 secondary).
    - Lead (max 580): `Plumbline is an open-source code reviewer that runs inside Claude Code, Codex and OpenCode. It hunts regressions like the hosted bots, then checks every PR against the architecture your team agreed on, and proves every serious finding.`
    - CTA row (gap 10):
      - Install command: flat bg raised, radius 8, padding 5/5/5/16. Shows `$` (muted) + `npm install -g @tanziro/plumbline` (mono 13) + a 32px accent copy button.
      - Secondary "Star on GitHub" and Secondary "Docs".
  - **At a glance** (rest of the row). **No box**: no fill, stroke or radius.
    - Head row: `AT A GLANCE` (mono 11/500 +8% muted) on the left, `v1.0` (mono 11 muted) on the right, with a 1px line-edge rule (60%) underneath.
    - Then 6 single-line rows, gap 12: key (92 wide, mono 11 +6% uppercase muted) + value (13/18 primary).
    - Rows:
      - Runs in — `Claude Code, Codex, OpenCode, CI, MCP`
      - Models — `Your key, any provider your agent supports`
      - Data — `Leaves only for your model endpoint`
      - Severity — `P0–P3, proof required on P0 and P1`
      - Output — `PR comment, terminal, JSON, SARIF`
      - License — `MIT. No account, no Plumbline servers`
- **Product shot** (1200 wide, **flat** bg surface, radius 16, overflow hidden, no stroke):
  - Bar (flat bg raised, padding 14×24): `plumbline review` (mono 13/500) + `PR #482  ·  feat: org-level invoices` (13 secondary). Right: `6 lenses  ·  3 findings  ·  3m 12s` (mono 12 muted).
  - **Left column** (680 wide, padding 24, gap 12):
    - Score row: `3/5` (48/600, -3%) + `Merge after fixes` (17/500) over `2 × P1  ·  1 × P2  ·  14 checks passed` (mono 12 muted)
    - FindingRow P1 · `architecture` · `New import creates a cycle: billing -> users/session -> billing` · `billing/invoice.ts now imports users/session to read the org. users/session already depends on billing for plan limits.` · `proof: dependency graph diff + rule ADR-012`
    - FindingRow P1 · `pattern` · `listAll() skips the org_id scope used by 23 of 23 sibling methods` · `InvoiceRepo.listAll() reads across tenants. Every other repository method filters by org_id first.` · `proof: failing test invoice.tenant.spec.ts`
    - FindingRow P2 · `migration` · `Dropping invoices.legacy_total breaks the rolling deploy` · `Old pods keep reading the column until the rollout finishes. Ship it as expand, migrate, contract.` · `proof: deploy-order check`
  - **Right column** (flat bg inset, padding 24, gap 18):
    - `DEPENDENCY DIFF` (mono 11/500 +8% muted)
    - The graph SVG below
    - Legend: 16×2 swatches, line-edge `existing edge` and sev-p0 `added in this PR`
    - Broken-rule box (sev-p0 at 10%, radius 8, padding 12×14): `forbid: billing -> users/*` (mono 12/500 sev-p0) over `ADR-012 · billing must stay deployable on its own`

Hero graph SVG (440×290). Labels are mono 12 primary, centred at the points listed after the SVG. All nodes share one neutral fill; only the edge is red.
```svg
<svg width="440" height="290" viewBox="0 0 440 290" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M200 44L110 122" stroke="#353C46" stroke-width="1.5"/>
  <path d="M250 44L330 122" stroke="#353C46" stroke-width="1.5"/>
  <path d="M260 131H161" stroke="#353C46" stroke-width="1.5"/>
  <path d="M161 131L168 126.5M161 131L168 135.5" stroke="#353C46" stroke-width="1.5"/>
  <path d="M160 148H258" stroke="#FF6B81" stroke-width="2"/>
  <path d="M259 148L251.5 143.5M259 148L251.5 152.5" stroke="#FF6B81" stroke-width="2"/>
  <path d="M100 156V236" stroke="#353C46" stroke-width="1.5"/>
  <path d="M150 156L300 236" stroke="#353C46" stroke-width="1.5"/>
  <rect x="150" y="10"  width="140" height="34" rx="6" fill="#1E242C"/>
  <rect x="40"  y="122" width="120" height="34" rx="6" fill="#1E242C"/>
  <rect x="260" y="122" width="150" height="34" rx="6" fill="#1E242C"/>
  <rect x="40"  y="236" width="120" height="34" rx="6" fill="#1E242C"/>
  <rect x="260" y="236" width="150" height="34" rx="6" fill="#1E242C"/>
</svg>
```
Label centers: api/invoices (220,27) · billing (100,139) · users/session (335,139) · orgs (100,253) · db/invoices (335,253).

### 01 Cost `24:241` (id `#cost`, bg surface)
- Section head:
  - Eyebrow: `01` `COST`
  - H2: `Stop paying a second bill` / `for code review.`
  - Lead: `Hosted reviewers charge per seat or per review, on top of the models they resell. Plumbline is free software that runs on the agent plan or API key you already pay for.`
- **Body** (gap 56): Table (fills the rest) + Summary (300).
  - **Scenario row**: `SCENARIO` (mono 11 muted), then three chips (bg raised, radius 4, padding 3×8, mono 12):
    `25 developers` · `500 PRs a month` · `1 review per PR`, then `list prices, 21 Nov 2026` (mono 12 muted).
  - **Table**:
    - Head row (mono 11/500 +8% uppercase muted): Product (176) · Pricing (256) · Per month (132) · Per year (112) · Vendor bill, to scale (rest).
    - Rows separated by line-edge 60% rules, padding 14×0:

    | Product | Pricing | Per month | Per year | Bar |
    |---|---|---|---|---|
    | Claude Code Review | $15–25 per review, billed on tokens | $7,500–12,500 | $90k–150k | low end solid, range lighter |
    | Greptile Pro | $1 per credit, 1–3 credits per review | $500–1,500 | $6k–18k | same |
    | CodeRabbit Essentials | $24 per developer, billed annually | $600 | $7.2k | solid |
    | **Plumbline** | MIT. Your agent plan or API key | **$0** | **$0** | 8px accent dot |

    - Styling:
      - Product 14/500 primary (Plumbline in accent) · Pricing 13 secondary · Per month mono 13/500 primary · Per year mono 13 secondary.
      - Plumbline's figures are in accent.
      - Bars: 8px tall, radius 1, scaled to a 220px track where $12,500 is the full width. The low end is text-muted at 55%, the rest of the range text-muted at 22%.
  - **Footnote** (mono 11/18 muted): `Vendor fees only. Hosted prices include each vendor's own model costs. With Plumbline, your model usage is billed by your provider: nothing extra on an agent plan you already pay for (within its limits), or token rates on an API key. Claude Code Review uses Anthropic's published $15–25 average; reviewing on every push costs more. Sources: each vendor's pricing page.`
  - **Summary** column (gap 22):
    - `$0` (64/68 600 accent) over `Plumbline license, any team size` (14 secondary)
    - Rule
    - `$6k–150k` (36/42 600) over `in vendor fees this team skips each year, depending on the tool it would have bought` (14/21 secondary)
    - Secondary button `Run the numbers for your team` (opens the calculator)
- **Pricing data:** put it in `site/src/data/pricing.json`, one entry per vendor with `model`, `unit`, `low`, `high`, `sourceUrl` and `checkedAt`.
  - Re-verify every figure before launch.
  - Add a CI check that fails if any `checkedAt` is older than 90 days.
  - Sources used for the design (checked 21 Nov 2026):
    - claude.com/blog/code-review (average $15–25 per review, token-billed)
    - greptile.com/pricing ($1 per credit, no seat fees; base review 1 credit, Plus 3, Apex 10)
    - docs.coderabbit.ai/management/plans (Essentials $24 per developer per month annual, $30 monthly)
- **Calculator** (the button expands an inline panel, no modal):
  - Inputs: developers (default 25), PRs per month (500), reviews per PR (1), billing (annual/monthly).
  - Formulas:
    - Claude Code Review = PRs × reviews × [15, 25]
    - Greptile Pro = PRs × reviews × [1, 3]
    - CodeRabbit Essentials = devs × (24 annual | 30 monthly)
    - Plumbline = 0
  - Show monthly and yearly figures. Recompute the bars live.

### 02 The gap `10:238` (id `#product`, bg canvas)
- Section head:
  - Eyebrow: `02` `THE GAP`
  - H2: `Bug bots read the diff.` / `Architecture lives between files.`
  - Lead: `Hosted reviewers are good at regressions. What slips through is what no single line shows: an import that bends a boundary, a query that drops tenancy, a decision your team made that an agent just reversed.`
- **Comparison row**: DiffView (560) · Bridge (80) · ArchitectureView (rest). The panels are equal height, flat bg surface, radius 14, padding 24.
  Inside each panel the top block has 28px of space below it, so the verdict bar never touches the content above.
  - **DiffView**:
    - `WHAT THE DIFF SHOWS` (mono 11/500 +8% muted)
    - Diff (mono 12/20). The `@@` line is muted, `+` lines accent, others secondary.
    - Verdict bar (flat bg raised, radius 8, padding 12×14): check icon (secondary) + `diff review: 0 issues  ·  tests pass` (mono 12 secondary)
    ```
    @@ billing/invoice.ts @@
      import { planLimits } from "./plans";
    + import { currentOrg } from "../users/session";

      export async function createInvoice(input) {
    +   const org = await currentOrg();
        const limits = planLimits(org.plan);
        ...
    ```
  - **Bridge**: `same PR` (mono 11 muted) above a 40×12 arrow in line-edge.
  - **ArchitectureView**:
    - `WHAT ACTUALLY CHANGED`
    - Drawing (504×196, below)
    - Verdict bar (sev-p0 at 10%, radius 8, padding 12×14): `P1` (mono 12/500 sev-p0) + `new edge crosses a deploy boundary  ·  ADR-012` (mono 12 secondary)
  ```svg
  <svg width="504" height="196" viewBox="0 0 504 196" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="216" height="196" rx="10" fill="#181D24"/>
    <rect x="288" y="0" width="216" height="196" rx="10" fill="#181D24"/>
    <path d="M108 98V126" stroke="#353C46" stroke-width="1.5"/>
    <path d="M396 98V126" stroke="#353C46" stroke-width="1.5"/>
    <path d="M194 81H306" stroke="#FF6B81" stroke-width="2"/>
    <path d="M307 81L299.5 76.5M307 81L299.5 85.5" stroke="#FF6B81" stroke-width="2"/>
    <rect x="22" y="64" width="172" height="34" rx="6" fill="#232A33"/>
    <rect x="22" y="126" width="172" height="34" rx="6" fill="#232A33"/>
    <rect x="310" y="64" width="172" height="34" rx="6" fill="#232A33"/>
    <rect x="310" y="126" width="172" height="34" rx="6" fill="#232A33"/>
  </svg>
  ```
  Drawing labels:
  - Zone labels (mono 10 +6% muted), left-aligned with the vertical centre at y = 22: `DEPLOY UNIT · billing` at x = 16, `DEPLOY UNIT · users` at x = 304.
  - Node labels (mono 12), centred: invoice.ts (108,81), plans.ts (108,143), **session.ts (396,81) in sev-p0**, profile.ts (396,143).
  - `new` (mono 12 sev-p0), centred at (252,66).
  - All nodes share one neutral fill, with no outline. Only the edge and the target label are red.
- **Failure modes**: three GapNotes (gap 24):
  - `01` `Design intent` — `A PR reverses an ADR or a rule in AGENTS.md. Tests pass. Nobody remembers the decision was ever made.` — `caught by: contract + ADR check`
  - `02` `Pattern drift` — `Agents copy the nearest example, including the bad ones. Every PR looks fine on its own while the codebase bends.` — `caught by: convention mining`
  - `03` `Boundary erosion` — `A new import ties together two modules that were meant to stay apart. Now they can't ship separately.` — `caught by: dependency diff`

### 03 How it works `10:169` (bg surface)
- Section head:
  - Eyebrow: `03` `HOW IT WORKS`
  - H2: `Four passes.` / `One report you can trust.`
  - Aside: lead `The same flow runs in your terminal, in CI and over MCP.` with a command chip under it (bg inset, radius 6, padding 7×12): `one command` (mono 12 muted) + `/plumbline review` (mono 13/500 accent).
- **Pipeline**: four PassColumns side by side with no gap, so the rails join.
  - The rail starts at the PASS 01 square and ends at the PASS 04 square (hide the line on the last column).
  - Build it so there are no sub-pixel gaps between square, line and string. Check at 1× and 2×.
  - `PASS 01` · `scope` · `Pin the change` · `Pins the diff range and loads AGENTS.md, CLAUDE.md, ADRs and plumbline.yml.`
    ```
    base    main @ 8f2c1a0
    head    feat/org-invoices
    diff    14 files  +412 -96
    rules   AGENTS.md  ADR-012
            plumbline.yml
    ```
  - `PASS 02` · `review` · `Review in parallel` · `Bug hunters trace real values while architecture lenses read the graph.`
    ```
    A  regressions     2
    B  regressions     1
    C  architecture    3
    D  hygiene, ops    1
       candidates      7
    ```
  - `PASS 03` · `prove` · `Prove it or drop it` · `Every P0 and P1 needs a failing test, a graph diff or a broken rule.`
    ```
    cycle     graph_diff  kept
    tenancy   test FAIL   kept
    null qty  no repro    -> P2
    naming    style       dropped
    ```
  - `PASS 04` · `report` · `Score and post` · `Merge score, ranked findings and a dependency diff, locally or on the PR.`
    ```
    merge score  3/5
    findings     P1 x2  P2 x1
    dropped      4
    posted       PR #482
    ```
  Colouring: `kept` accent · `FAIL` sev-p0 · `dropped` muted · `3/5` and the final `7` primary · everything else secondary.

### 04 Lenses `11:204` (id `#lenses`, bg canvas)
- Section head:
  - Eyebrow: `04` `LENSES`
  - H2: `Eight lenses.` / `Regressions are just the first.`
  - Lead: `Each lens is a reviewer brief you can read, edit or turn off. Bring your own by dropping a markdown file in .plumbline/lenses.`
- **Schedule**: head row (mono 11/500 uppercase muted, same columns as LensRow), 8 LensRows, a closing rule, then the add row.
  The add row: `+` (mono 15/500 accent) · `Add your own lens` (15/500) · `.plumbline/lenses/*.md` (mono 12 muted).

  | ID | Lens | Catches | Example | Proof |
  |---|---|---|---|---|
  | L01 | Regressions | Logic bugs, null paths and off-by-ones, traced with concrete values. | `total += item.qty  // qty can be undefined` | failing_test |
  | L02 | Boundaries & cycles | New edges in the import graph that cross a layer or close a loop. | `billing -> users/session -> billing` | graph_diff · broken_rule |
  | L03 | Pattern deviations | Code that breaks the codebase's own majority pattern. | `23/23 repo methods scope org_id` | failing_test · broken_rule |
  | L04 | Distributed systems | Retries without idempotency, dual writes without an outbox, calls without timeouts. | `webhook handler · no dedupe key` | failing_test |
  | L05 | Migrations | Schema changes that break rolling deploys or drop data without a backfill. | `DROP COLUMN while old pods read it` | broken_rule · failing_test |
  | L06 | API contracts | Breaking changes to OpenAPI, proto or event schemas, with consumers in other repos. | `removed field · 3 consumers` | graph_diff · broken_rule |
  | L07 | Agent-PR hygiene | Reinvented helpers, needless abstraction, tests that assert mocks instead of behavior. | `formatMoney() exists in lib/fmt` | broken_rule |
  | L08 | Operability & cost | Risky paths with no flag or metrics, model calls inside loops. | `llm.call() inside forEach` | broken_rule |
- Generate the rows from the lens files' frontmatter at build time.

### 05 Architecture contract `5:111` (bg surface)
Two columns, gap 64, vertically centred.
- Left (520 wide):
  - Eyebrow `05  ARCHITECTURE CONTRACT` (the number in accent)
  - H2 `Write the architecture down once.`
  - Lead: `Plumbline mines your ADRs and agent rule files into plumbline.yml, then checks every PR against it. Rules it can prove compile to dependency-cruiser, import-linter or ArchUnit. Only judgement calls go to the model.`
  - Three bullets (16 primary, 16px accent check):
    - `Mined from ADRs, AGENTS.md, CLAUDE.md and past PR threads`
    - `Deterministic checks first, the model only where it has to judge`
    - `One contract shared across every repo that imports it`
- Right: code card (flat bg inset, radius 14, padding 24), filename `plumbline.yml` (mono 12 muted), code at mono 13/21.
  YAML keys accent, `#` comments muted. **Update this snippet to the final schema (HANDOVER §6) when it lands.**
```yaml
version: 1
layers:
  - api        # HTTP handlers only
  - domain     # billing, orgs, users
  - infra      # db, queues, email
rules:
  - forbid: domain -> api
  - forbid: billing -> users/*
    because: ADR-012 billing ships on its own
  - require: "repo methods scope by org_id"
    check: llm
  - require: "webhook handlers are idempotent"
    check: llm
proof:
  P0: [failing_test, graph_diff]
  P1: [failing_test, graph_diff, broken_rule]
```

### 06 Proof `5:133` (bg canvas)
Two columns, gap 64.
- **Left:** test card (616 wide, flat bg surface, radius 14, padding 24), code at mono 13/21, `//` comments muted.
  Below it, a result bar (sev-p0 at 10%): `FAIL` (mono 12/500 sev-p0) + `expected 0 rows, received 1  ·  finding kept at P1` (mono 12 secondary).
```ts
// generated by plumbline · invoice.tenant.spec.ts
it("listAll() only returns the caller's org", async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  await seedInvoice({ org: b });

  const rows = await InvoiceRepo.listAll(ctx(a));
  expect(rows).toHaveLength(0);
});
```
- **Right:**
  - Eyebrow `06  PROOF, NOT OPINIONS`
  - H2 `No proof, no P1.`
  - Lead: `Noise is why teams mute review bots. Plumbline raises a P0 or P1 only when it can show it: a failing test it wrote and ran in your own environment, a dependency graph diff, or the exact rule that broke. Anything else gets downgraded or dropped.`

### 07 Enterprise `26:252` (id `#enterprise`, bg surface)
- Section head:
  - Eyebrow: `07` `ENTERPRISE`
  - H2: `Fits the controls` / `you already have.`
  - Lead: `Plumbline runs where your code already lives, under the policies you already enforce. Your security team reviews a dev dependency, not a new vendor.`
- **Body** (gap 56): Spec table (rest) + DataPath (320).
  - **Spec table**: head row (mono 11 uppercase muted): Capability · How it works · Status. Then 8 SpecRows and a closing rule.

    | Capability | How it works | Status |
    |---|---|---|
    | Deployment | Your local agent, self-hosted CI runners, or fully air-gapped with a local model. | AVAILABLE |
    | Data handling | No Plumbline servers and no telemetry by default. Code goes only to the model endpoint you configure. | AVAILABLE |
    | Model choice | Any provider your agent supports, including Anthropic, OpenAI, Bedrock, Vertex and OpenAI-compatible endpoints. | AVAILABLE |
    | Policy as code | plumbline.yml lives in the repo, reviewed and versioned like code. Share one contract across repos. | AVAILABLE |
    | Audit trail | Every run saved as JSON and SARIF, ready for code scanning and your SIEM. | AVAILABLE |
    | Merge gating | Required status check with a minimum merge score per branch. | AVAILABLE |
    | SCM coverage | GitHub Action and GitLab CI template. Any other CI through the CLI. | AVAILABLE |
    | Risk lanes | Marks low-risk PRs for a light-review lane. Never auto-merges: a person always approves. | AVAILABLE |

    **Every status must be true on launch day.** Drive this table from `site/src/data/enterprise.json`. Flip a row to AVAILABLE only when its milestone passes acceptance. If something misses v1.0, its row honestly says `ROADMAP · V1.x`.
  - **DataPath** (the rail motif, vertical):
    - `WHAT LEAVES YOUR NETWORK` (mono 11/500 +8% muted)
    - Three nodes (flat bg raised, radius 8, padding 12×14, an 8px marker square, title 14/500 + mono 11 muted subtitle):
      - `Your repo and CI` / `inside your network`, then a connector: 1×30 line-edge string + `local` (mono 11 muted).
      - `Your agent` / `Claude Code, Codex, OpenCode`, then a connector: 1×30 accent string + `the only egress` (mono 11 accent).
      - `Your model endpoint` / `your account, your region`. Its marker is accent.
    - Then `Plumbline has no backend. There is nothing of ours to approve, host or breach.` (13/20 secondary).

### 08 Install `11:385` (id `#install`, bg canvas)
- Section head:
  - Eyebrow: `08` `INSTALL`
  - H2: `Four ways in.` / `Same engine.`
  - Lead: `Start local, then put it in CI once you trust it. Every surface runs the same lenses and the same proof rules.`
- **Terminal panel** (flat bg surface, radius 16, overflow hidden):
  - Tabs bar (flat bg raised, padding 0×32, gap 32): `Skill` (active) · `GitHub Action` · `GitLab CI` · `MCP server`, as an accessible tablist.
  - Body (padding 24, gap 40):
    - Code block (660 wide, flat bg canvas, radius 10, padding 24): head row with `terminal` (mono 12 muted) and a copy icon on the right, then code at mono 14/24.
    - Facts column, gap 20:
      - `01` `Runs in your agent` — `Claude Code, Codex, OpenCode, or anything that loads Agent Skills.`
      - `02` `Uses your plan or key` — `Model calls go straight from your machine to your provider.`
      - `03` `Read-only by default` — `Writes nothing to your repo unless you choose review-and-fix.`
  - Tab contents. Colouring: prompts `$` and `>` muted, output secondary, `kept` and `/plumbline review` accent, `3/5` primary.
    - **Skill**
      ```
      $ npx skills add tanzir71/plumbline -g
      $ claude
      > /plumbline review

        scope    14 files  ·  base main
        review   4 reviewers  ·  6 lenses
        prove    3 kept  ·  4 dropped
        report   merge score 3/5
      ```
    - **GitHub Action**
      ```yaml
      # .github/workflows/plumbline.yml
      - uses: tanzir71/plumbline@v1
        with:
          model: claude-sonnet-5-5
          key: ${{ secrets.ANTHROPIC_KEY }}
      ```
    - **GitLab CI**
      ```yaml
      # .gitlab-ci.yml
      include:
        - remote: 'https://raw.githubusercontent.com/tanzir71/plumbline/v1/ci/gitlab/plumbline.yml'
      # CI/CD variables: PLUMBLINE_MODEL_KEY, PLUMBLINE_GITLAB_TOKEN
      ```
    - **MCP server**
      ```json
      { "mcpServers": { "plumbline": { "command": "npx", "args": ["plumbline", "mcp"] } } }
      ```
  Generate these from one shared snippet file (also used by the docs) and keep them in sync with the real package names, action inputs, GitLab variables and CLI (HANDOVER M3–M5).

### Final CTA `26:367` (bg canvas + edge glows behind the teams box)
Two columns, padding 96×120, gap 56, vertically centred.
- Left:
  - H2 40/46 `Keep your architecture true.`
  - Lead (520): `Open source, MIT licensed, and free to run with the model keys you already have.`
  - Primary `Install Plumbline` (→ `#install`) + Secondary `Read the docs`
- Right: **Teams box** (460, flat bg surface, radius 14, padding 28, gap 16):
  - `FOR TEAMS ROLLING OUT` (mono 11/500 +8% muted)
  - `Architecture audit` (20/500)
  - Three check rows (14 secondary): `Contract drafted from your ADRs and agent rules` · `Lenses tuned on your last 100 merged PRs` · `CI gating set up branch by branch`
  - `Book an architecture audit` (14/500) + accent arrow. Link target: HANDOVER §10.

### Footer `26:395`
Padding 56 / 120 / 36, gap 40.
- **Top row**, with the two groups spread across the width:
  - **Brand** (340): Logo + `Open-source code review that checks the structure, not just the diff.` (14/21 secondary)
  - **Columns** (gap 72). Each heading is mono 11/500 +8% uppercase muted; links are 14 secondary with a gap of 10:
    - Product: Lenses · Architecture contract · Changelog · Roadmap
    - Developers: Docs · GitHub · GitHub Action · MCP server · Contributing
    - Company: **tanziro.com** (https://tanziro.com) · Architecture audits · Security · License
- **Bottom row** (1px line-edge 60% rule on top, padding-top 20), with the two items spread apart:
  - Left: `© 2026 Plumbline · MIT License · Built by tanziro.com` (mono 12 muted; `tanziro.com` in secondary, linked)
  - Right: `v1.0` (mono 12 muted)

## Responsive rules (not drawn in Figma)

| Breakpoint | Gutter | Changes |
|---|---|---|
| ≥ 1280 | 120 | As designed |
| 1024–1279 | 64 | Section heads stack (lead under the title). Pipeline becomes 2×2, each pair with its own rail. Lenses hide the Example column. Cost hides the bar column. Enterprise DataPath moves under the table. |
| 768–1023 | 40 | Hero: At a glance moves under the CTAs. Product shot stacks (findings, then diff). The gap comparison stacks with a down arrow. Contract, Proof and Final CTA stack, copy first. H1 44/48, H2 28/34. |
| < 768 | 20 | One column. The pipeline turns vertical (the rail becomes a left line). Tables become stacked rows: label on one line, details below, status or proof as a mono line. Nav links go into a menu. The announcement bar shrinks to the version tag + link. H1 36/40, H2 26/32. Section padding 64. |

## Interactions and accessibility

- Copy buttons copy the command, announce `Copied` via `aria-live`, and swap to a check icon for 1.5s.
- The Install tabs and the cost calculator are keyboard-accessible. Calculator results update in an `aria-live="polite"` region.
- All text meets WCAG AA. Keep `--text-muted` at #7E8793.
- Focus rings: 2px solid accent-plumb with a 2px offset. This is the only outline on the page.
- One `<h1>`. Sections use `<section aria-labelledby>`. Each drawing SVG needs `role="img"` and an `aria-label`.
- Meta:
  - Title: `Plumbline — review the structure, not just the diff`. Description = hero lead.
  - Canonical: `https://tanzir71.github.io/plumbline/`.
  - OG image: export the hero from Figma at 1200×630 and save it as `site/public/og.png` (served at `/plumbline/og.png`).
