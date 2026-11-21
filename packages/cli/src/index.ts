import { parseArgs } from "node:util";
import { ContractError, NothingToReviewError, formatCounts, formatCycle, formatScope, renderMarkdown } from "@plumbline/core";
import { VERSION, runCheck, runGraph, runInit, runProve, runReport, startScope } from "./lib.js";

const HELP = `plumbline ${VERSION}: review the structure, not just the diff.

Usage: plumbline <command> [options]

Commands
  init                     Write a plumbline.yml skeleton, guessing modules from folders
  scope [target]           Pin the diff range and collect rule files. Target: branch, commit or PR
  graph                    Diff the JS/TS import graph between base and HEAD
  check                    Check the contract's forbid and layer rules against the current tree
  prove <test> -- <cmd>    Run a proof test under .plumbline/proofs/ and record the result
  report                   Apply the proof gate, score the run and write the audit trail
  mcp                      Start the MCP server on stdio

Options
  --base <ref>             Base branch or ref (default: dev, then main, then master)
  --json                   Machine-readable output
  --help, --version

check     --contract <file>  --semgrep  --allow-custom-checks
report    --gate  --run <id>  --findings <file>  --base-branch <name>  --contract-from <head|base>
prove     --run <id>  --passed-on-base  --failed-on-base
init      --force

Exit codes: 0 ok · 1 error, gate failed or rule violated · 2 nothing to review
`;

function print(json: boolean, value: unknown, human: () => string): void {
  process.stdout.write(`${json ? JSON.stringify(value, null, 2) : human()}\n`);
}

const contractFrom = (v: string | undefined): "head" | "base" | undefined => {
  if (v === undefined || v === "head" || v === "base") return v;
  throw new Error(`--contract-from must be head or base, not "${v}"`);
};

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Everything after `--` belongs to the proof test command.
  const split = rest.indexOf("--");
  const args = split === -1 ? rest : rest.slice(0, split);
  const passthrough = split === -1 ? [] : rest.slice(split + 1);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }

  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      json: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      gate: { type: "boolean", default: false },
      run: { type: "string" },
      findings: { type: "string" },
      "base-branch": { type: "string" },
      "contract-from": { type: "string" },
      contract: { type: "string" },
      semgrep: { type: "boolean", default: false },
      "allow-custom-checks": { type: "boolean", default: false },
      "passed-on-base": { type: "boolean", default: false },
      "failed-on-base": { type: "boolean", default: false },
    },
  });
  const cwd = process.cwd();
  const json = values.json as boolean;

  switch (command) {
    case "init": {
      const out = runInit(cwd, values.force as boolean);
      print(json, { file: out.file, modules: out.modules }, () =>
        [`Wrote ${out.file}`, out.modules.length ? `Guessed modules: ${out.modules.join(", ")}` : "No modules guessed. Add them by hand."].join("\n"),
      );
      return 0;
    }

    case "scope": {
      const { scope, run } = startScope({ cwd, target: positionals[0], base: values.base });
      print(json, { runId: run.id, ...scope }, () => `${formatScope(scope)}\nRUN: ${run.id}`);
      return 0;
    }

    case "graph": {
      const { run, graph } = await runGraph({ cwd, base: values.base, contractFrom: contractFrom(values["contract-from"]) });
      const d = graph.diff;
      print(json, { runId: run.id, diff: d, violations: graph.check.violations }, () =>
        [
          `Import graph: ${d.stats.baseFiles} -> ${d.stats.headFiles} files, ${d.stats.baseEdges} -> ${d.stats.headEdges} edges`,
          `Added edges (${d.added.length})`,
          ...d.added.map((e) => `  + ${e.from} -> ${e.to}${e.typeOnly ? " (type-only)" : ""}`),
          `Removed edges (${d.removed.length})`,
          ...d.removed.map((e) => `  - ${e.from} -> ${e.to}`),
          `New cycles (${d.newCycles.length})`,
          ...d.newCycles.map((c) => `  ${c.level}: ${formatCycle(c)}`),
          `Layer crossings (${d.layerCrossings.length})`,
          ...d.layerCrossings.map((c) => `  ${c.violation ? "VIOLATION " : ""}${c.fromModule} -> ${c.toModule}  (${c.from} -> ${c.to})`),
          `Run: ${run.id}`,
        ].join("\n"),
      );
      return 0;
    }

    case "check": {
      const { result, run, hasContract } = await runCheck({
        cwd,
        contract: values.contract,
        semgrep: values.semgrep as boolean,
        allowCustomChecks: values["allow-custom-checks"] as boolean,
      });
      print(json, { runId: run.id, hasContract, ...result }, () =>
        [
          hasContract ? `Contract: ${result.violations.length} violations` : "No plumbline.yml found. Run: plumbline init",
          ...result.violations.map((v) => `  ${v.ruleId}: ${v.from} -> ${v.to}\n    ${v.message}${v.because ? ` (${v.because})` : ""}`),
          ...(result.cycles.length ? [`Cycles (${result.cycles.length})`, ...result.cycles.map((c) => `  ${c.level}: ${formatCycle(c)}`)] : []),
          ...(result.llmRules.length ? [`Judgement rules for the model: ${result.llmRules.map((r) => r.id).join(", ")}`] : []),
          ...result.skippedRules.map((r) => `Skipped ${r.id}: ${r.reason}`),
        ].join("\n"),
      );
      return result.violations.length > 0 ? 1 : 0;
    }

    case "prove": {
      const test = positionals[0];
      if (!test) throw new Error("usage: plumbline prove <test> -- <command>");
      const passedOnBase = values["passed-on-base"] ? true : values["failed-on-base"] ? false : undefined;
      const record = runProve({ cwd, test, command: passthrough, run: values.run, passedOnBase });
      print(json, record, () =>
        record.exitCode === 0
          ? `Test passed on HEAD, so it proves nothing: ${record.ref}`
          : `Recorded failing test: ${record.ref} (exit ${record.exitCode})`,
      );
      return 0;
    }

    case "report": {
      const out = await runReport({
        cwd,
        run: values.run,
        findings: values.findings,
        base: values.base,
        baseBranch: values["base-branch"],
        contractFrom: contractFrom(values["contract-from"]),
      });
      const { report } = out;
      print(json, report, () =>
        [
          renderMarkdown(report).trimEnd(),
          "",
          `Merge score ${report.score.value}/5 (${formatCounts(report.score.counts)})`,
          `Audit trail: ${out.run.dir}`,
        ].join("\n"),
      );
      if (values.gate && report.gate && !report.gate.pass) {
        process.stderr.write(`plumbline: ${report.gate.reason}\n`);
        return 1;
      }
      return 0;
    }

    case "mcp": {
      const { serveStdio } = await import("./mcp.js");
      await serveStdio();
      return -1;
    }

    default:
      process.stderr.write(`plumbline: unknown command "${command}"\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    if (code >= 0) process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof NothingToReviewError) {
      process.stdout.write(`NOTHING TO REVIEW: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof ContractError) {
      process.stderr.write(`plumbline: invalid contract\n${error.message}\n`);
    } else {
      process.stderr.write(`plumbline: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  });
