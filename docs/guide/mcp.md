---
title: MCP server
description: Use Plumbline's checks from any MCP client.
order: 4
---

`plumbline mcp` is a local stdio server. It has no model of its own: the calling agent does the judging.

## Configure

```json
{ "mcpServers": { "plumbline": { "command": "npx", "args": ["-y", "@tanziro/plumbline", "mcp"] } } }
```

In Claude Code:

```bash
claude mcp add plumbline -- npx -y @tanziro/plumbline mcp
```

## Tools

| Tool | What it does |
|---|---|
| `scope` | Pins the review scope and starts a run |
| `graph_diff` | Diffs the JS/TS import graph between base and HEAD |
| `check_contract` | Evaluates `forbid` and `layers` rules. It never runs custom commands |
| `list_lenses` | Lists the lenses, including any in `.plumbline/lenses/` |
| `render_report` | Applies the proof gate, computes the merge score and writes the reports |

Each tool takes an optional `repo` path, which defaults to the server's working directory.
