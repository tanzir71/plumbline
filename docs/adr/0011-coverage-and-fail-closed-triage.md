# ADR 0011: Close coverage gaps and keep candidates unless code rules them out

Status: accepted (2026-11-24).

## Context

In the field test, the five issues another reviewer found and Plumbline missed were never proposed by its reviewers, and two of them were in files left unread. Separately, three of the five candidates triage removed were dropped because their impact or intent was unclear, not because the code ruled them out. Published work on false-positive filtering found that letting a model's judgement dismiss findings loses real bugs, while dismissing only on a deterministic check kept them (arXiv 2606.15122). That evidence comes from static-analyzer alarms, not PR review.

## Decision

- `scope` gives a review order: source, then config, tests and docs, largest change first. Reviewers read in that order.
- The skill saves every reviewer report in the run and runs up to two follow-up reviewers on files nobody read. The report names files still unread, and counts a file as unread when every saved report says it skipped it.
- Every candidate must be merged into a finding (`from`), dismissed with a reason that rules it out, or kept. Code reasons must cite a file and line that exist. `plumbline report` turns any other candidate into an unresolved finding at P2 at most.
- The model panel splits a large change into parts, riskiest first, and covers as many parts as the budget allows instead of skipping files that don't fit one request.

## Consequences

Reports may show more P2 findings, and a review whose orchestrator does not save reviewer reports gets no candidate check. Findings written without `from` fall back to matching by file and line, so old-style output doesn't flood the report with duplicates. Replayed on the 12 saved field-test reviews, that fallback put back 10 of 64 candidates, including all 5 that triage had dropped. Splitting a change raises panel cost on large PRs, within the configured budget. None of this has been measured on Plumbline yet, so the site and docs make no accuracy claim about it.
