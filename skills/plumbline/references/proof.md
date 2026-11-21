# Proving a finding

Every P0 and P1 needs proof of a kind the contract accepts. By default:

| Severity | Accepted proof |
|---|---|
| P0 | `failing_test`, `graph_diff` |
| P1 | `failing_test`, `graph_diff`, `broken_rule` |

The CLI checks each proof against the repository. A finding whose proof does not hold is shown at P2, or dropped if it is also unreachable or style-only.

## failing_test

1. Write the smallest test that shows the failure, under `.plumbline/proofs/`. Use the repo's own test framework, fixtures and helpers.
2. Run it through the CLI, using the repo's test command:

   ```bash
   plumbline prove .plumbline/proofs/invoice.tenant.test.js -- node --test .plumbline/proofs/invoice.tenant.test.js
   ```

   This records the command, exit code, output, commit and a hash of the test. **Only a recorded run counts.** The test must fail on HEAD for the reason in the finding. Read the output: a syntax error or a missing import is not proof, so fix the test and run it again.
3. When it's practical, check that it passes on base, using a temporary worktree outside the repo:

   ```bash
   git worktree add <temp-dir> <merge-base>
   ```

   Run the test there, remove the worktree, then re-run `plumbline prove` on HEAD with `--passed-on-base`. If it also fails on base, pass `--failed-on-base`: this change did not cause it, so it is not this PR's finding.
   If the code under test doesn't exist on base, because this change adds it, skip this step and pass neither flag.
4. Never commit proof tests outside review-and-fix mode. `.plumbline/proofs/` is ignored locally.

If the tests can't run here (no dependencies, needs a service), say so and leave the finding without this proof. Do not guess the result.

## graph_diff

Copy the exact edge or cycle from `graph.json`, in the form `from -> to` or `a -> b -> a`. Module-level edges such as `billing -> users/session` are accepted too.

## broken_rule

Use the contract rule id (`no-billing-to-users`) or an ADR number (`ADR-012`), and set the finding's `file` and `line` to the code that breaks it. Quote the rule in `detail`.
