// Repo policy checks from CLAUDE.md: naming, invented claims, and no unsafe npx command.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".astro", ".plumbline", "test-results", "playwright-report", ".lighthouseci"]);
const TEXT = /\.(md|mdx|mjs|cjs|js|ts|tsx|astro|css|json|ya?ml|html|txt|svg)$|(^|\/)(LICENSE|NOTICE)$/;

/** The only files allowed to contain the upstream product name. */
const NAME_ALLOWED = new Set([
  "LICENSE",
  "NOTICE",
  "CLAUDE.md",
  "HANDOVER.md",
  "docs/landing-page.md",
  "site/src/data/pricing.json",
]);

// Assembled here so this script doesn't contain the name it bans.
const UPSTREAM_NAME = new RegExp(["grep", "tile"].join(""), "i");

/** Spec and policy files that quote banned phrases in order to ban them. */
const CLAIM_ALLOWED = new Set(["CLAUDE.md", "HANDOVER.md", "docs/landing-page.md", "scripts/check-repo.mjs"]);

const CLAIMS = [
  { re: /\b96\s*%\s*(of|match|accura)/i, why: "carries over the upstream accuracy claim" },
  { re: /\b722 reviews\b/i, why: "carries over the upstream accuracy claim" },
  { re: /\b\d+(\.\d+)?\s*%\s*(accura|precis|recall|catch|fewer|faster|of (bugs|issues|reviews))/i, why: "accuracy or speed claim" },
  { re: /\b\d+x\s+(faster|more|better)\b/i, why: "speed claim" },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const errors = [];
for (const file of walk(root)) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!TEXT.test(rel) || rel === "pnpm-lock.yaml" || rel.includes("/test/schemas/") || rel.startsWith("packages/action/skill/") || rel.startsWith("packages/cli/lenses/")) continue;
  const text = readFileSync(file, "utf8");

  if (!NAME_ALLOWED.has(rel) && UPSTREAM_NAME.test(text)) errors.push(`${rel}: uses the upstream product name`);

  if (!CLAIM_ALLOWED.has(rel)) {
    for (const { re, why } of CLAIMS) if (re.test(text)) errors.push(`${rel}: ${why} (${re})`);
    if (!rel.startsWith("docs/adr/") && /@plumbline\/(core|cli|action)/.test(text)) {
      errors.push(`${rel}: uses the old @plumbline scope. The packages are under @tanziro (ADR 0005).`);
    }
    // ADRs record why the bare command is banned, so they may quote it.
    if (!rel.startsWith("docs/adr/") && /npx\s+(-y\s+|--yes\s+)?plumbline(\s|$|["'`])/.test(text)) {
      errors.push(`${rel}: "npx plumbline" runs an unrelated npm package. Use @tanziro/plumbline.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Repo check failed:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("Repo check passed.");
