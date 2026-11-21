# ADR 0004: Where the site differs from the first landing page spec

Status: accepted (2026-11-21)

The non-negotiables in CLAUDE.md outrank the draft copy. Three lines changed so the site stays true:

| Spec | Site | Why |
|---|---|---|
| "Rules it can prove compile to dependency-cruiser, import-linter or ArchUnit." | "Rules it can prove run on the dependency-cruiser import graph." | v1.0 has no import-linter or ArchUnit export |
| Product shot shows `3m 12s` | Duration removed | No speed claims anywhere |
| `npx plumbline mcp` | `npx -y @plumbline/cli mcp` | The unscoped package belongs to another project (ADR 0001) |

The contract snippet was also updated to the final schema, as the spec asks. A test keeps it valid.

If import-linter or ArchUnit export ships later, the original sentence can return.
