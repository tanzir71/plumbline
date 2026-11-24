# plumbline.yml contract spec (v1)

The parser is `packages/core/src/contract/`. It validates with zod and reports errors as `file:line:column path: message`. Unknown keys are errors.

## Top level

| Key | Type | Default | Notes |
|---|---|---|---|
| `version` | `1` | required | |
| `extends` | string or string[] | none | Local paths inside the repo. URLs and paths outside the repo are rejected |
| `modules` | map of name to glob[] | `{}` | At least one glob per module |
| `layers` | (module pattern[])[] | `[]` | Top to bottom |
| `rules` | rule[] | `[]` | |
| `proof` | object | see below | |
| `cycles` | object | see below | |
| `gate` | entry[] | `[]` | |
| `lanes` | object | see below | |

## Module resolution

A file belongs to the module with the most specific matching glob (the longest literal prefix). Ties go to the first declared module. Files in no module are ignored by `forbid` and `layers`.

Patterns in `layers` and `forbid` match **module names** and may use wildcards, as in `users/*`. Each must match at least one module, and a module may appear in only one layer.

## Rules

Every rule needs a unique `id`.

**Forbid rule**

| Key | Type | Notes |
|---|---|---|
| `id` | string | |
| `forbid` | `from -> to` | Module patterns |
| `because` | string | Shown in findings |

**Require rule**

| Key | Type | Notes |
|---|---|---|
| `id` | string | |
| `require` | string | The rule, in words |
| `check` | `llm`, `semgrep`, `custom` | Default `llm` |
| `paths` | glob[] | Where it applies |
| `because` | string | |
| `config` | string | Required for `semgrep`. A local path inside the repo |
| `command` | string | Required for `custom`. Runs only with `--allow-custom-checks` |

## Proof

```yaml
proof:
  P0: [failing_test, graph_diff]
  P1: [failing_test, graph_diff, broken_rule]
```

## Cycles

| Key | Type | Default | Notes |
|---|---|---|---|
| `cycles.within_module` | `P1`, `P2` | `P2` | Severity of a new cycle that stays inside one module, or any file cycle in a repo with no modules |

A new cycle that crosses declared modules or breaks a rule is always P1. Connected cycles inside one module are one finding.

## Gate

| Key | Type | Notes |
|---|---|---|
| `branches` | glob[] | Matched against the PR's base branch |
| `min_merge_score` | integer 0-5 | The strictest matching entry applies |

## Lanes

| Key | Type | Default |
|---|---|---|
| `lanes.light.label` | string | `plumbline:light-review` |
| `lanes.light.when.merge_score` | integer 0-5 | `5` |
| `lanes.light.when.max_severity` | `P0`-`P3` | `P3` |
| `lanes.light.when.max_changed_lines` | integer | `200` |
| `lanes.light.never` | glob[] | `[]` |

## Graph semantics

- Type-only imports count for `forbid` and `layers`, because they still couple modules. They don't count for cycles, because they're erased at compile time.
- Only edges added since the base commit become findings. Existing violations are visible in `plumbline check`.
- Renamed files keep their identity in the diff.
