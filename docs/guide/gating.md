---
title: Merge gating
description: Fail a required check below a minimum merge score.
order: 10
---

```yaml
gate:
  - branches: ["main", "release/*"]
    min_merge_score: 3
```

When a PR's base branch matches and its score is below the minimum, the review job fails with a one-line reason. If several entries match, the strictest applies. A branch with no match isn't gated.

The gate only fails a check. **It never approves or merges anything.**

## Make it required

**GitHub:** Settings → Branches → add a branch protection rule (or a ruleset) → require status checks → select the Plumbline job.

**GitLab:** Settings → Merge requests → turn on **Pipelines must succeed**.

## Output

The score is written as the `merge-score` step output on GitHub, and as `PLUMBLINE_MERGE_SCORE` in a dotenv report on GitLab.

## Locally

```bash
npx -y @tanziro/plumbline report --base main --gate
```

This exits non-zero under the same rule, so it works as a pre-push hook.

## When the review can't finish

If there's no model key, or the agent fails, the graph and rule checks still run and the score is capped at 4/5. A gate of `min_merge_score: 5` will then fail, on purpose: a change nobody reviewed shouldn't pass the strictest gate.
