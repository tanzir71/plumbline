---
title: Risk lanes
description: Label low-risk PRs for light review. A person still approves.
order: 11
---

A lane marks a PR as low-risk so your team can review it lightly. **It only adds a label.** It never approves, merges, requests reviewers or dismisses reviews.

```yaml
lanes:
  light:
    label: "plumbline:light-review"
    when: { merge_score: 5, max_severity: P3, max_changed_lines: 200 }
    never: ["**/migrations/**", ".github/**", "src/billing/**"]
```

A PR qualifies when all of these hold:

- The merge score is at least `merge_score`
- No finding is more severe than `max_severity`
- It changes at most `max_changed_lines` lines
- It touches no file matching `never`
- A model reviewer actually ran. Graph checks alone never qualify a PR

The PR comment says why it qualified, or why it didn't. When a later push stops qualifying, the label is removed.

To turn lanes off, set the Action input `lanes: false`, or the GitLab variable `PLUMBLINE_LANES=false`.
