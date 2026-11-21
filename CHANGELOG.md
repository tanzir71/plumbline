# Changelog

## 1.0.0 (unreleased)

The first release of Plumbline: an open-source code reviewer that checks the structure, not just the diff.

### Review

- Agent Skill with four parallel reviewers and eight editable lenses
- Proof gate: a P0 or P1 needs a failing test, a graph diff or a broken rule, checked by the tool
- Merge score from 0 to 5, with reports in Markdown, JSON and SARIF 2.1.0

### Architecture

- `plumbline.yml` contract with modules, layers, rules, proof, gate and lanes, including shared contracts through `extends`
- JS/TS import graph diff with new cycles, layer crossings and contract violations

### Surfaces

- CLI: `init`, `scope`, `graph`, `check`, `prove`, `report`, `mcp`
- MCP server with `scope`, `graph_diff`, `check_contract`, `list_lenses` and `render_report`
- GitHub Action with one updated PR comment, artifacts, SARIF upload, merge gating and risk lanes
- GitLab CI template with one updated MR note, Code Quality report, merge gating and risk lanes

### Limits

- Deterministic graph checks cover JS and TS only
- Nothing in Plumbline approves or merges a PR. A person always does

### Build log

- **M0, repo:** pnpm workspace, MIT license and notice, the skill imported and renamed, `plumbline scope` ported to Node, CI workflow
- **M1, core:** contract parser with line-accurate errors, import graph diff, cycle detection, `forbid` and `layers` checks, gate and lane decisions, Markdown, JSON and SARIF reports
- **M2, skill:** eight lenses, four reviewers, a proof gate enforced by the tool, `/plumbline init`, headless evals
- **M3, CLI and MCP:** `init`, `scope`, `graph`, `check`, `prove`, `report` and `mcp`, with `--json` output
- **M4, GitHub Action:** one updated PR comment, artifacts, SARIF upload, merge gate and lane label, with the PR treated as untrusted
- **M5, GitLab CI:** one updated MR note, Code Quality report, merge gate and lane label, including self-managed GitLab
- **M6, site:** landing page, docs, changelog and 404 on GitHub Pages, with link, pricing, design-rule, browser and Lighthouse checks
