# findings.json

Write the verified findings to `findings.json` in the run directory (`.plumbline/run/<id>/`). `plumbline report` reads it.
Do not include the cycles and rule violations from step 2: the CLI adds those itself, as one finding per root cause. If the reviewers found nothing else, write an empty `findings` array. The file is still needed, because it records that the reviewers ran.

```json
{
  "model": "the model that ran the review, or null",
  "reviewers": [
    { "id": "A", "status": "complete", "model": "optional" },
    { "id": "B", "status": "complete" },
    { "id": "C", "status": "complete" },
    { "id": "D", "status": "inconclusive" }
  ],
  "lenses": {
    "ran": ["L01", "L02", "L03", "L04", "L05", "L06", "L07"],
    "skipped": [{ "id": "L08", "reason": "disabled in .plumbline/lenses" }]
  },
  "unreadFiles": [],
  "findings": [
    {
      "severity": "P1",
      "lens": "L03",
      "title": "listAll() reads across tenants",
      "body": "One short paragraph: the function, the mechanism, a concrete trigger and the consequence.",
      "file": "src/repo/invoices.js",
      "line": 11,
      "endLine": 13,
      "security": true,
      "fix": "Filter by ctx.orgId, as every sibling method does.",
      "proof": [
        { "kind": "failing_test", "ref": ".plumbline/proofs/invoice.tenant.test.js" }
      ],
      "from": ["A2", "C1"]
    }
  ],
  "dismissed": [
    {
      "candidate": "B4",
      "reason": "guarded",
      "evidence": "parseLimit() clamps the value to 1-100 before the query runs.",
      "file": "src/api/limits.js",
      "line": 18
    }
  ]
}
```

| Field | Notes |
|---|---|
| `severity` | `P0`, `P1`, `P2` or `P3` |
| `lens` | A lens id such as `L01`, or a custom lens id |
| `title` | The observable failure in 3-7 plain words |
| `file`, `line`, `endLine` | Repo-relative, from code you actually read |
| `security` | Auth, permissions, tenant boundaries, secrets or injection |
| `proof[].kind` | `failing_test`, `graph_diff` or `broken_rule` |
| `proof[].ref` | Test path, edge or cycle, or rule/ADR id |
| `proof[].detail` | Optional evidence, such as the quoted rule |
| `unreachable`, `styleOnly` | Set if verification showed this. An unproven finding with either flag is dropped |
| `from` | The candidate ids this finding covers, such as `A2` or `C1` |
| `unresolved` | You could neither confirm nor rule it out. It is shown at P2 at most |

## Dismissed candidates

Every candidate id from the reviewer reports or the panel must appear in a finding's `from` or in `dismissed`. `plumbline report` puts back anything else as an unresolved P2. Only when no finding uses `from` does a finding within 10 lines in the same file count as covering a candidate.

| `reason` | Use it when | Needs |
|---|---|---|
| `guarded` | Code already prevents the failure | `evidence`, `file`, `line` |
| `pre_existing` | The base commit behaves the same way | `evidence`, `file`, `line` at the base commit |
| `not_reachable` | No caller or input reaches the path | `evidence`, `file`, `line` |
| `misread` | The candidate misdescribes what the code does | `evidence`, `file`, `line` |
| `stated_decision` | The PR, an ADR or a rule file says this is intended | `evidence` quoting it |
| `style` | Naming, formatting or linter-level only | `evidence` |

Any other reason, such as "impact unclear", does not dismiss the candidate.

List any reviewer that failed as `inconclusive`, and any file nobody read in `unreadFiles`. Both cap the score at 4/5. The report also counts a file as unread when every saved reviewer report says it skipped it.
