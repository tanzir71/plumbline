import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NothingToReviewError, renderMarkdown } from "@tanziro/plumbline-core";
import { z } from "zod";
import { VERSION, listLenses, runCheck, runGraph, runReport, startScope } from "./lib.js";

const repo = z.string().optional().describe("Path inside the git repository. Defaults to the server's working directory.");
const base = z.string().optional().describe("Base branch or ref. Defaults to dev, then main, then master.");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function guarded(fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NothingToReviewError) return json({ nothingToReview: true, message: error.message });
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export function createServer(defaultCwd: string = process.cwd()): McpServer {
  const server = new McpServer({ name: "plumbline", version: VERSION });
  const cwd = (path?: string) => path ?? defaultCwd;

  server.registerTool(
    "scope",
    {
      description: "Pin the review scope: diff range, changed files, contract, ADRs and rule files. Starts a run.",
      inputSchema: { repo, base, target: z.string().optional().describe("Branch, commit or PR number to review.") },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ repo: path, base: ref, target }) => guarded(() => json({ ...startScope({ cwd: cwd(path), base: ref, target }).scope })),
  );

  server.registerTool(
    "graph_diff",
    {
      description: "Diff the JS/TS import graph between base and HEAD: added and removed edges, new cycles, layer crossings.",
      inputSchema: { repo, base },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ repo: path, base: ref }) =>
      guarded(async () => {
        const { run, graph } = await runGraph({ cwd: cwd(path), base: ref });
        return json({ runId: run.id, diff: graph.diff, violations: graph.check.violations });
      }),
  );

  server.registerTool(
    "check_contract",
    {
      description: "Evaluate plumbline.yml forbid and layer rules against the current tree. Never runs custom commands.",
      inputSchema: { repo },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ repo: path }) =>
      guarded(async () => {
        const { result, run, hasContract } = await runCheck({ cwd: cwd(path) });
        return json({ runId: run.id, hasContract, ...result });
      }),
  );

  server.registerTool(
    "list_lenses",
    {
      description: "List the review lenses, including any in the repo's .plumbline/lenses folder.",
      inputSchema: { repo, includeBody: z.boolean().optional().describe("Include each lens's full brief.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ repo: path, includeBody }) =>
      guarded(() =>
        json(
          listLenses(cwd(path)).map(({ body, file: _file, ...meta }) => (includeBody ? { ...meta, body } : meta)),
        ),
      ),
  );

  server.registerTool(
    "render_report",
    {
      description:
        "Apply the proof gate to findings, compute the merge score and write report.md, report.json and report.sarif.",
      inputSchema: {
        repo,
        base,
        run: z.string().optional().describe("Run id. Defaults to the latest."),
        findings: z.record(z.string(), z.unknown()).optional().describe("Findings file content. See references/findings.md."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ repo: path, base: ref, run, findings }) =>
      guarded(async () => {
        const out = await runReport({ cwd: cwd(path), base: ref, run, findingsValue: findings });
        return {
          content: [
            { type: "text", text: renderMarkdown(out.report) },
            { type: "text", text: JSON.stringify({ runId: out.run.id, score: out.report.score, gate: out.report.gate, lane: out.report.lane, paths: out.paths }, null, 2) },
          ],
        };
      }),
  );

  return server;
}

export async function serveStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
