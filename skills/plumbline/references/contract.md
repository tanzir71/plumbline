# plumbline.yml format

```yaml
version: 1                   # required, always 1
extends: ./vendor/base.yml   # optional: local path(s) inside the repo to a shared contract
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
  - id: no-billing-to-users  # unique
    forbid: billing -> users/*
    because: "ADR-012: billing ships on its own"
  - id: tenant-scope
    require: "repository methods scope queries by org_id"
    check: llm               # llm (default) | semgrep (needs config) | custom (needs command)
    paths: ["src/**/repo/**"]
proof:                       # which proof kinds count
  P0: [failing_test, graph_diff]
  P1: [failing_test, graph_diff, broken_rule]
cycles:                      # new cycles inside one module: P2 (default) or P1
  within_module: P2
gate:                        # fail CI below a minimum score
  - branches: ["main", "release/*"]
    min_merge_score: 3
lanes:                       # a label only, never approval
  light:
    label: "plumbline:light-review"
    when: { merge_score: 5, max_severity: P3, max_changed_lines: 200 }
    never: ["**/migrations/**", ".github/**"]
```

- Only `version` is required. Unknown keys are errors.
- Patterns in `layers` and `forbid` match **module names**, and each must match at least one module.
- A module can be in only one layer. Modules in the same layer may import each other, so use a `forbid` rule to keep two of them apart.
- A layer may import any layer below it, not only the next one.
- When a file matches several modules, the most specific glob wins.
- A new cycle that crosses modules or breaks a rule is always P1. Connected cycles inside one module are one finding at `cycles.within_module`.

To validate a draft without replacing the real contract:

```bash
plumbline check --contract .plumbline/draft.yml
```

Exit 1 with `file:line:column` output means the draft is invalid or a rule is already violated. The output says which.
