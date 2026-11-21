# Evals

Runs the skill headless on each fixture in a throwaway repo and checks the expected lenses and severities. It's manual because it spends model tokens.

```bash
pnpm build
node evals/run.mjs
node evals/run.mjs --agent codex
node evals/run.mjs ts-cycle tenancy-missing-scope
```

Expected results are in each `fixtures/<name>/expected.json`. These runs check the skill's behaviour on seeded issues. They are not a benchmark, and their results must not be published as an accuracy figure.
