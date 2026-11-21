---
id: L01
name: "Regressions"
default: "on"
proof: [failing_test]
catches: "Logic bugs, null paths and off-by-ones, traced with concrete values."
example: "total += item.qty  // qty can be undefined"
---

# L01 Regressions

Logic bugs, null paths and off-by-ones, traced with concrete values.

## What to look for

- Inverted or widened conditions, off-by-one, wrong variable, unit, default or time zone.
- Null, empty and zero input reaching code that assumes a value.
- A missing `await`, swallowed errors, partial writes and fallbacks that hide a failure.
- One call site changed while its siblings were not.

## How to prove it

Pick concrete values and trace them through the real code. Then write a test under `.plumbline/proofs/` that fails on HEAD and record it with `plumbline prove`.

## False-positive traps

- A guard upstream, a type or a database constraint already rules the input out.
- The behaviour is unchanged by this diff.
- The caller never passes that value.

## Examples

`total += item.qty` where an API payload may omit `qty` turns the invoice total into `NaN`.
