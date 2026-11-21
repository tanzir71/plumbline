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
      ]
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

List any reviewer that failed as `inconclusive`, and any file nobody read in `unreadFiles`. Both cap the score at 4/5.
