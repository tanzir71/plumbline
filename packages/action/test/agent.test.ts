import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_VERSION, CODEX_VERSION, runAgent, type AgentConfig, type Exec } from "../src/agent.js";

const skillSource = resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills/plumbline");
const cfg: AgentConfig = { provider: "anthropic", model: "test-model", key: "model-key", baseUrl: "", proofTests: false };
const baseEnv = { PATH: "x", GITHUB_TOKEN: "forge-token", PLUMBLINE_MODEL_KEY: "model-key" };

interface Call {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function fakeExec(reply: (call: Call) => { status: number; stdout?: string; stderr?: string }) {
  const calls: Call[] = [];
  const exec: Exec = async (command, args, { cwd, env }) => {
    const call = { command, args, cwd, env };
    calls.push(call);
    const r = reply(call);
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { exec, calls };
}

const input = (exec: Exec, over: Partial<AgentConfig> = {}) => {
  const workspace = mkdtempSync(join(tmpdir(), "plumbline-ws-"));
  return { cfg: { ...cfg, ...over }, workspace, runDir: join(workspace, "run"), env: baseEnv, exec, cliEntry: "/cli/index.js", skillSource };
};

const structured = {
  model: "test-model",
  reviewers: [{ id: "A", status: "complete" }],
  lenses: { ran: ["L01"], skipped: [] },
  unreadFiles: [],
  findings: [{ severity: "P2", lens: "L01", title: "t", body: "b", file: null, line: null, endLine: null, security: false, fix: null, proof: [], unreachable: false, styleOnly: false }],
};

describe("runAgent", () => {
  it("installs the pinned agent outside the checkout, without the model key", async () => {
    const { exec, calls } = fakeExec((c) => (c.command === "npm" ? { status: 0 } : { status: 0, stdout: JSON.stringify({ structured_output: structured }) }));
    const args = input(exec);
    await runAgent(args);

    const install = calls[0] as Call;
    expect(install.command).toBe("npm");
    expect(install.args).toContain(`@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`);
    expect(install.cwd).not.toBe(args.workspace);
    expect(install.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(install.env.GITHUB_TOKEN).toBeUndefined();
  });

  it("runs the agent in the workspace with only the model credential", async () => {
    const { exec, calls } = fakeExec((c) => (c.command === "npm" ? { status: 0 } : { status: 0, stdout: JSON.stringify({ structured_output: structured }) }));
    const args = input(exec);
    const out = (await runAgent(args)) as { findings: Record<string, unknown>[] };

    const agent = calls[1] as Call;
    expect(agent.cwd).toBe(args.workspace);
    expect(agent.env.ANTHROPIC_API_KEY).toBe("model-key");
    expect(agent.env.GITHUB_TOKEN).toBeUndefined();
    expect(agent.env.PLUMBLINE_MODEL_KEY).toBeUndefined();
    expect(agent.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
    expect(agent.args).toContain("--bare");
    expect(agent.args.join(" ")).not.toContain("model-key");

    const skillRoot = agent.args[agent.args.indexOf("--add-dir") + 1] as string;
    expect(existsSync(join(skillRoot, ".claude", "skills", "plumbline", "SKILL.md"))).toBe(true);
    expect(out.findings[0]).not.toHaveProperty("file");
  });

  it("uses Codex for an OpenAI-compatible endpoint, keeping the key out of its arguments", async () => {
    const { exec, calls } = fakeExec((c) => {
      if (c.command === "npm") return { status: 0 };
      writeFileSync(c.args[c.args.indexOf("--output-last-message") + 1] as string, JSON.stringify(structured));
      return { status: 0 };
    });
    await runAgent(input(exec, { provider: "openai-compatible", baseUrl: "https://llm.internal.test/v1" }));

    expect((calls[0] as Call).args).toContain(`@openai/codex@${CODEX_VERSION}`);
    const agent = calls[1] as Call;
    expect(agent.env.PLUMBLINE_AGENT_KEY).toBe("model-key");
    expect(agent.args.join(" ")).toContain("https://llm.internal.test/v1");
    expect(agent.args.join(" ")).not.toContain("model-key");
  });

  it.each([
    ["install fails", (c: Call) => (c.command === "npm" ? { status: 1, stderr: "registry down" } : { status: 0 }), /could not install/],
    ["agent exits non-zero", (c: Call) => (c.command === "npm" ? { status: 0 } : { status: 1 }), /exited with 1/],
    ["agent reports an error", (c: Call) => (c.command === "npm" ? { status: 0 } : { status: 0, stdout: JSON.stringify({ is_error: true }) }), /no structured result/],
    ["no structured output", (c: Call) => (c.command === "npm" ? { status: 0 } : { status: 0, stdout: "{}" }), /no structured result/],
  ])("throws when %s", async (_name, reply, message) => {
    const { exec } = fakeExec(reply);
    await expect(runAgent(input(exec))).rejects.toThrow(message);
  });
});
