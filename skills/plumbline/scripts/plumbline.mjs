#!/usr/bin/env node
// Runs the Plumbline CLI on any OS: PLUMBLINE_CLI if set, then an installed `plumbline`, then npx.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

const args = process.argv.slice(2);
const isWindows = process.platform === "win32";

function onPath(name) {
  const exts = isWindows ? [".cmd", ".exe", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const ext of exts) {
      const file = join(dir, name + ext);
      if (dir && existsSync(file)) return file;
    }
  }
  return null;
}

function npxCli() {
  const bin = dirname(process.execPath);
  const candidates = [
    join(bin, "node_modules", "npm", "bin", "npx-cli.js"),
    join(bin, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

// cmd.exe needs quoting when a .cmd shim runs through a shell.
const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);

function run(command, commandArgs, shell = false) {
  const result = shell
    ? spawnSync([quote(command), ...commandArgs.map(quote)].join(" "), { stdio: "inherit", shell: true })
    : spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`plumbline: could not start ${command}: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.env.PLUMBLINE_CLI) run(process.execPath, [process.env.PLUMBLINE_CLI, ...args]);

const installed = onPath("plumbline");
if (installed) run(installed, args, isWindows && installed.endsWith(".cmd"));

const npx = npxCli();
if (npx) run(process.execPath, [npx, "-y", "@tanziro/plumbline@1", ...args]);
run("npx", ["-y", "@tanziro/plumbline@1", ...args], isWindows);
