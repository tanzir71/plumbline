---
id: L04
name: "Distributed systems"
default: "on"
proof: [failing_test]
catches: "Retries without idempotency, dual writes without an outbox, calls without timeouts."
example: "webhook handler · no dedupe key"
---

# L04 Distributed systems

Retries without idempotency, dual writes without an outbox, calls without timeouts.

## What to look for

- Handlers that can be delivered twice with no dedupe key.
- A database write and a queue publish with nothing tying them together.
- Network calls with no timeout, and retries of work that is not idempotent.
- Locks or transactions held across slow calls.

## How to prove it

Write a test that replays the delivery or fails the second write, and show the wrong final state.

## False-positive traps

- The framework may already dedupe or retry safely. Read its configuration.
- Single-process code has no delivery problem.
- A missing timeout on a local call is not a finding.

## Examples

A payment webhook extends a subscription each time it is delivered, so a retry grants a second period.
