// CI budget: Performance and Accessibility must both score at least 95 on the built site.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET = 95;
const PORT = 4330;
const LIGHTHOUSE = "lighthouse@12.8.2";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shell = process.platform === "win32";
const pages = ["", "docs/"];
const presets = [["mobile", []], ["desktop", ["--preset=desktop"]]];

const server = spawn("pnpm", ["--filter", "site", "exec", "astro", "preview", "--port", String(PORT)], {
  cwd: root,
  stdio: "ignore",
  shell,
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/plumbline/`)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("preview server did not start");
}

function stopServer() {
  if (shell) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}

let failed = false;
try {
  await waitForServer();
  const dir = mkdtempSync(join(tmpdir(), "plumbline-lh-"));
  for (const page of pages) {
    for (const [name, flags] of presets) {
      const out = join(dir, `${name}-${page.replace(/\W/g, "") || "home"}.json`);
      const run = spawnSync(
        "pnpm",
        ["dlx", LIGHTHOUSE, `http://localhost:${PORT}/plumbline/${page}`, "--quiet", "--output=json", `--output-path=${out}`, "--only-categories=performance,accessibility", '--chrome-flags="--headless=new --no-sandbox"', ...flags],
        { cwd: dir, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", shell },
      );
      let report;
      try {
        report = JSON.parse(readFileSync(out, "utf8"));
      } catch {
        console.error(`Lighthouse did not produce a report: ${(run.stderr ?? "").slice(-300)}`);
        failed = true;
        continue;
      }
      const perf = Math.round(report.categories.performance.score * 100);
      const a11y = Math.round(report.categories.accessibility.score * 100);
      const cls = report.audits["cumulative-layout-shift"].numericValue;
      console.log(`/${page} ${name}: performance ${perf}, accessibility ${a11y}, CLS ${cls.toFixed(3)}`);
      if (perf < BUDGET || a11y < BUDGET) failed = true;
      if (a11y < 100) {
        for (const audit of Object.values(report.audits)) {
          if (audit.score === 0 && report.categories.accessibility.auditRefs.some((r) => r.id === audit.id)) {
            console.log(`  a11y: ${audit.id}: ${(audit.details?.items ?? []).slice(0, 3).map((i) => i.node?.snippet ?? "").join(" ")}`);
          }
        }
      }
    }
  }
} finally {
  stopServer();
}

if (failed) {
  console.error(`Lighthouse budget failed (minimum ${BUDGET}).`);
  process.exit(1);
}
console.log("Lighthouse budget passed.");
process.exit(0);
