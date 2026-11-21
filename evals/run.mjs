#!/usr/bin/env node
// Runs the skill headless on each fixture and checks the findings. Manual, because it costs tokens.
//   node evals/run.mjs [--agent claude|codex] [--model <id>] [fixture ...]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { FIXTURE_NAMES, expected, materialize } from "../fixtures/materialize.mjs";
import { checkInit, checkReport } from "./check.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages", "cli", "dist", "index.js");
if (!existsSync(cli)) {
  console.error("Build first: pnpm build");
  process.exit(1);
}
const core = await import(pathToFileURL(join(root, "packages", "core", "dist", "index.js")).href);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { agent: { type: "string", default: "claude" }, model: { type: "string" } },
});
const names = positionals.length > 0 ? positionals : FIXTURE_NAMES;

const skillRoot = mkdtempSync(join(tmpdir(), "plumbline-eval-skill-"));
mkdirSync(join(skillRoot, ".claude", "skills"), { recursive: true });
cpSync(join(root, "skills", "plumbline"), join(skillRoot, ".claude", "skills", "plumbline"), { recursive: true });
const skillDir = join(skillRoot, ".claude", "skills", "plumbline").replaceAll("\\", "/");

const reviewPrompt = `Read ${skillDir}/SKILL.md and follow it to review this repository's current branch against main. Nobody is available to answer questions. Finish by running the report step.`;
const initPrompt = `Read ${skillDir}/references/init.md and follow it to draft a contract for this repository. Nobody is available to accept it, so do not write plumbline.yml. Write your final draft to .plumbline/draft.yml instead.`;

function runAgent(repo, prompt) {
  const env = { ...process.env, PLUMBLINE_CLI: cli };
  const shell = process.platform === "win32";
  const model = values.model ? ["--model", values.model] : [];
  const text = shell ? JSON.stringify(prompt) : prompt;
  if (values.agent === "codex") {
    return spawnSync("codex", ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", ...model, text], { cwd: repo, env, stdio: "inherit", shell });
  }
  const tools = "Read,Grep,Glob,Agent,Edit(.plumbline/**),Write(.plumbline/**),Bash(node *),Bash(git *)";
  return spawnSync(
    "claude",
    ["-p", text, "--add-dir", skillRoot, "--permission-mode", "dontAsk", "--allowedTools", shell ? JSON.stringify(tools) : tools, ...model],
    { cwd: repo, env, stdio: "inherit", shell },
  );
}

function evalReview(name, repo) {
  const res = runAgent(repo, reviewPrompt);
  const pointer = join(repo, ".plumbline", "run", "latest");
  const reportFile = existsSync(pointer) ? join(repo, ".plumbline", "run", readFileSync(pointer, "utf8").trim(), "report.json") : "";
  if (res.status !== 0 || !reportFile || !existsSync(reportFile)) return ["the agent produced no report"];
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  console.log(`score ${report.score.value}/5: ${report.findings.map((f) => `${f.severity} ${f.lens} ${f.title}`).join(" | ") || "no findings"}`);
  return checkReport(report, expected(name));
}

function evalInit(name, repo) {
  const res = runAgent(repo, initPrompt);
  const draft = join(repo, ".plumbline", "draft.yml");
  if (res.status !== 0 || !existsSync(draft)) return ["the agent produced no draft"];
  try {
    const contract = core.parseContract(readFileSync(draft, "utf8"), "draft.yml");
    console.log(`draft modules: ${Object.keys(contract.modules).join(", ")}`);
    return checkInit(contract, expected(name).init);
  } catch (error) {
    return [`the draft is not a valid contract: ${error.message}`];
  }
}

let failed = 0;
for (const name of names) {
  const repo = materialize(name);
  console.log(`\n=== ${name} (${repo})`);
  const failures = expected(name).init ? [...evalInit(name, repo)] : evalReview(name, repo);
  if (failures.length > 0) {
    failed++;
    for (const f of failures) console.log(`FAIL ${name}: ${f}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

console.log(`\n${names.length - failed}/${names.length} fixtures passed`);
process.exit(failed > 0 ? 1 : 0);
