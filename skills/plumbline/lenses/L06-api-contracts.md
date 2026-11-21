---
id: L06
name: "API contracts"
default: "on"
proof: [graph_diff, broken_rule]
catches: "Breaking changes to OpenAPI, proto or event schemas, with consumers in other repos."
example: "removed field · 3 consumers"
---

# L06 API contracts

Breaking changes to OpenAPI, proto or event schemas, with consumers in other repos.

## What to look for

- Removed or renamed fields, changed types, and new required fields in OpenAPI, proto, GraphQL or event schemas.
- Exports of a shared package changing shape while importers still use the old one.
- Stored payloads and queued messages written by the previous version that must still load.

## How to prove it

Cite each consumer edge from the graph diff, or the rule or ADR that promises compatibility, with the file and line.

## False-positive traps

- An internal type with no external consumers can change freely.
- A versioned endpoint may keep the old shape elsewhere.
- Adding an optional field is not a breaking change.

## Examples

An event drops `customer_id` while a consumer in another package still reads it.
