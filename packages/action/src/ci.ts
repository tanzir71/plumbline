import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NothingToReviewError, parseFindingsFile, renderMarkdown, tryGit } from "@plumbline/core";
import { runGraph, runReport } from "@plumbline/cli";
import { PROVIDERS, canRunAgent, defaultExec, runAgent, type AgentConfig, type Exec, type Provider } from "./agent.js";
import { github, gitlab, type FetchLike, type Platform } from "./platform.js";

type Env = NodeJS.ProcessEnv;

export interface CiDeps {
  exec?: Exec;
  fetcher?: FetchLike;
  log?: (line: string) => void;
  /** Replaces the agent in tests. */
  agent?: (input: { cfg: AgentConfig; runDir: string; workspace: string }) => Promise<unknown>;
}

interface Context {
  kind: "github" | "gitlab";
  workspace: string;
  baseSha: string;
  baseBranch: string;
  platform: Platform | null;
}

const flag = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
};

class SkipRun extends Error {}

function githubContext(env: Env, fetcher?: FetchLike): Context {
  const event = env.GITHUB_EVENT_NAME;
  if (event === "pull_request_target") {
    throw new Error(
      "refusing to run on pull_request_target: it would run a PR's code with your secrets. Use the pull_request event.",
    );
  }
  if (event !== "pull_request") throw new SkipRun(`nothing to do for the ${event} event. Plumbline reviews pull_request events.`);

  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH as string, "utf8")) as {
    pull_request: { number: number; base: { sha: string; ref: string } };
  };
  const pr = payload.pull_request;
  const token = env.PLUMBLINE_GITHUB_TOKEN || env.GITHUB_TOKEN || "";
  return {
    kind: "github",
    workspace: env.PLUMBLINE_WORKSPACE || (env.GITHUB_WORKSPACE as string),
    baseSha: pr.base.sha,
    baseBranch: pr.base.ref,
    platform: token
      ? github({
          apiUrl: env.GITHUB_API_URL || "https://api.github.com",
          repo: env.GITHUB_REPOSITORY as string,
          number: pr.number,
          token,
          fetcher,
        })
      : null,
  };
}

function gitlabContext(env: Env, fetcher?: FetchLike): Context {
  if (env.CI_PIPELINE_SOURCE !== "merge_request_event" || !env.CI_MERGE_REQUEST_IID) {
    throw new SkipRun("nothing to do outside a merge request pipeline.");
  }
  const token = env.PLUMBLINE_GITLAB_TOKEN ?? "";
  return {
    kind: "gitlab",
    workspace: env.PLUMBLINE_WORKSPACE || (env.CI_PROJECT_DIR as string),
    baseSha: (env.CI_MERGE_REQUEST_DIFF_BASE_SHA || env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA) as string,
    baseBranch: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME as string,
    platform: token
      ? gitlab({
          apiUrl: env.CI_API_V4_URL as string,
          projectId: env.CI_PROJECT_ID as string,
          iid: Number(env.CI_MERGE_REQUEST_IID),
          token,
          fetcher,
        })
      : null,
  };
}

/** A shallow checkout has no merge base, so fetch what the diff needs. */
function ensureHistory(workspace: string, baseSha: string): void {
  if (tryGit(workspace, ["merge-base", baseSha, "HEAD"])) return;
  if (tryGit(workspace, ["rev-parse", "--is-shallow-repository"]) === "true") {
    tryGit(workspace, ["fetch", "--quiet", "--no-tags", "--unshallow", "origin"]);
  }
  if (!tryGit(workspace, ["merge-base", baseSha, "HEAD"])) {
    tryGit(workspace, ["fetch", "--quiet", "--no-tags", "origin", baseSha]);
  }
}

function setOutputs(ctx: Context, env: Env, values: Record<string, string>): void {
  if (ctx.kind === "github") {
    if (!env.GITHUB_OUTPUT) return;
    const lines = Object.entries(values).map(([k, v]) => `${k}=${v.replace(/\r?\n/g, " ")}`);
    appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
    return;
  }
  const dotenv = [
    `PLUMBLINE_MERGE_SCORE=${values["merge-score"] ?? ""}`,
    `PLUMBLINE_GATE_RESULT=${values.gate ?? ""}`,
    `PLUMBLINE_LANE=${values.lane ?? ""}`,
  ];
  writeFileSync(join(ctx.workspace, "plumbline.env"), `${dotenv.join("\n")}\n`);
}

export function readConfig(env: Env): AgentConfig {
  const provider = (env.PLUMBLINE_PROVIDER || "anthropic") as Provider;
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider "${provider}". Use ${PROVIDERS.join(", ")}.`);
  return {
    provider,
    model: env.PLUMBLINE_MODEL ?? "",
    key: env.PLUMBLINE_MODEL_KEY ?? "",
    baseUrl: env.PLUMBLINE_BASE_URL ?? "",
    proofTests: flag(env.PLUMBLINE_PROOF_TESTS, false),
  };
}

const inconclusive = (reason: string) => ({
  reviewers: [{ id: "agent", status: "inconclusive" as const }],
  lenses: { ran: ["L02"], skipped: [{ id: "model lenses", reason }] },
  findings: [],
});

/** Returns the process exit code. */
export async function runCi(env: Env, deps: CiDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const failOnError = flag(env.PLUMBLINE_FAIL_ON_ERROR, false);
  let hadError = false;
  const warn = (message: string) => {
    hadError = true;
    log(env.GITHUB_ACTIONS ? `::warning title=Plumbline::${message}` : `plumbline: warning: ${message}`);
  };

  let ctx: Context;
  try {
    ctx = env.GITLAB_CI ? gitlabContext(env, deps.fetcher) : githubContext(env, deps.fetcher);
  } catch (error) {
    if (error instanceof SkipRun) {
      log(`plumbline: ${error.message}`);
      return 0;
    }
    throw error;
  }

  const cfg = readConfig(env);
  ensureHistory(ctx.workspace, ctx.baseSha);

  // The rules that judge this PR come from the base commit, so it cannot relax them for itself.
  let started;
  try {
    started = await runGraph({ cwd: ctx.workspace, base: ctx.baseSha, contractFrom: "base" });
  } catch (error) {
    if (error instanceof NothingToReviewError) {
      log(`plumbline: nothing to review. ${error.message}`);
      return 0;
    }
    throw error;
  }
  const { run, graph } = started;
  log(`plumbline: graph pass found ${graph.diff.newCycles.length} new cycles and ${graph.check.violations.length} rule violations`);

  let modelFile: unknown;
  if (!canRunAgent(cfg, env)) {
    log("plumbline: no model credentials, so only the graph and rule checks ran");
    modelFile = inconclusive("no model credentials");
  } else {
    try {
      const raw = deps.agent
        ? await deps.agent({ cfg, runDir: run.dir, workspace: ctx.workspace })
        : await runAgent({
            cfg,
            workspace: ctx.workspace,
            runDir: run.dir,
            env,
            exec: deps.exec ?? defaultExec,
            cliEntry: fileURLToPath(import.meta.resolve("@plumbline/cli")).replace(/lib\.js$/, "index.js"),
          });
      parseFindingsFile(raw);
      modelFile = raw;
    } catch (error) {
      warn(`the model review did not complete: ${error instanceof Error ? error.message : String(error)}`);
      modelFile = inconclusive("the review agent failed");
    }
  }

  const useGate = flag(env.PLUMBLINE_GATE, true);
  const useLane = flag(env.PLUMBLINE_LANES, true);
  const { report, paths } = await runReport({
    cwd: ctx.workspace,
    run: run.id,
    base: ctx.baseSha,
    baseBranch: ctx.baseBranch,
    contractFrom: "base",
    findingsValue: modelFile,
    useGate,
    useLane,
  });

  const markdown = renderMarkdown(report);
  if (ctx.kind === "github" && env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  if (ctx.kind === "gitlab") copyFileSync(paths.codeQuality as string, join(ctx.workspace, "gl-code-quality-report.json"));

  if (ctx.platform) {
    if (flag(env.PLUMBLINE_COMMENT, true)) {
      try {
        log(`plumbline: comment ${await ctx.platform.upsertComment(markdown)}`);
      } catch (error) {
        warn(`could not post the comment: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (useLane && report.lane) {
      try {
        await ctx.platform.setLabel(report.lane.label, report.lane.qualifies);
      } catch (error) {
        warn(`could not update the lane label: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const gateResult = report.gate?.applies ? (report.gate.pass ? "pass" : "fail") : "none";
  setOutputs(ctx, env, {
    "merge-score": String(report.score.value),
    gate: gateResult,
    "gate-reason": report.gate?.reason ?? "",
    lane: report.lane?.qualifies ? report.lane.label : "",
    "report-dir": run.dir,
  });
  log(`plumbline: merge score ${report.score.value}/5. ${report.score.verdict}`);

  if (gateResult === "fail" && !flag(env.PLUMBLINE_DEFER_GATE, false)) {
    log(`plumbline: ${report.gate?.reason}`);
    return 1;
  }
  return hadError && failOnError ? 1 : 0;
}
