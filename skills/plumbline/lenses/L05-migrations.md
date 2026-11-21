---
id: L05
name: "Migrations"
default: "on"
proof: [broken_rule, failing_test]
catches: "Schema changes that break rolling deploys or drop data without a backfill."
example: "DROP COLUMN while old pods read it"
---

# L05 Migrations

Schema changes that break rolling deploys or drop data without a backfill.

## What to look for

- Dropped or renamed columns and tables that the previous release still reads.
- `NOT NULL` added without a default or a backfill.
- Long locks on large tables.
- Code and schema changed in one deploy where order matters.

## How to prove it

Grep for readers of the column at HEAD and at base, and cite them. Cite the contract rule if one covers migrations. If you can run the migration locally, write a failing test.

## False-positive traps

- A table that was created in this same PR has no old readers.
- The project may deploy with downtime by design. Check the docs and ADRs.
- A column nothing reads is safe to drop.

## Examples

`ALTER TABLE invoices DROP COLUMN legacy_total` ships while running pods still select it. Ship it as expand, migrate, contract.
