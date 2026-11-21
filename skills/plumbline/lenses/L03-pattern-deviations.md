---
id: L03
name: "Pattern deviations"
default: "on"
proof: [failing_test, broken_rule]
catches: "Code that breaks the codebase's own majority pattern."
example: "23/23 repo methods scope org_id"
---

# L03 Pattern deviations

Code that breaks the codebase's own majority pattern.

## What to look for

- For each new function, find its siblings and note what they all do: filters, validation, locking, registration, logging.
- A new method that skips what every sibling does, above all tenant scoping and authorization.
- `require` rules in the contract with `check: llm` that cover the changed paths.

## How to prove it

Count the siblings and state the ratio. If the deviation causes wrong behaviour, write a failing test. If a contract rule covers it, cite the rule id with the file and line.

## False-positive traps

- Being different is not a defect. The deviation must cause a problem.
- A small sample is not a pattern.
- The method may be deliberately global, such as an admin job, and say so in a stated decision.

## Examples

`InvoiceRepo.listAll()` reads across tenants while every other repository method filters by `org_id`.
