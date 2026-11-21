---
title: GitLab CI
description: Review every merge request in your own pipelines.
order: 6
---

## Include the template

```yaml
# .gitlab-ci.yml
include:
  - remote: 'https://raw.githubusercontent.com/tanzir71/plumbline/v1/ci/gitlab/plumbline.yml'
```

The job runs in the `test` stage on `merge_request_event` pipelines.

## Variables

Set these under **Settings → CI/CD → Variables**, and mask them.

| Variable | Required | Meaning |
|---|---|---|
| `PLUMBLINE_MODEL_KEY` | for the model review | Your provider key |
| `PLUMBLINE_GITLAB_TOKEN` | for notes and labels | Project access token with the `api` scope |
| `PLUMBLINE_MODEL` | no | Model id |
| `PLUMBLINE_PROVIDER` | no | `anthropic`, `bedrock`, `vertex` or `openai-compatible` |
| `PLUMBLINE_BASE_URL` | no | Required for `openai-compatible` |
| `PLUMBLINE_COMMENT` | no | `false` turns off the MR note |
| `PLUMBLINE_GATE` | no | `false` turns off the merge gate |
| `PLUMBLINE_LANES` | no | `false` turns off the lane label |
| `PLUMBLINE_FAIL_ON_ERROR` | no | `true` fails the job if the review errors |
| `PLUMBLINE_PROOF_TESTS` | no | `true` lets the agent run tests as proof. See the warning in [GitHub Action](./github-action.md) |

## What it does

- Posts one MR note and updates it on each pipeline
- Adds or removes the lane label
- Publishes `gl-code-quality-report.json` to the MR's Code Quality widget
- Saves the [audit trail](./audit-trail.md) as job artifacts
- Writes `PLUMBLINE_MERGE_SCORE`, `PLUMBLINE_GATE_RESULT` and `PLUMBLINE_LANE` as a dotenv report
- Fails the job when the [gate](./gating.md) fails

Self-managed GitLab works. The API address comes from `CI_API_V4_URL`.

To block merges on the result, turn on **Settings → Merge requests → Pipelines must succeed**.
