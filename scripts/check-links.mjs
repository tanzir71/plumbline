// CI check: every internal link and asset in the built site resolves under the /plumbline/ base.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "/plumbline/";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "dist");
if (!existsSync(root)) {
  console.error("site/dist not found. Run: pnpm --filter site build");
  process.exit(1);
}

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* htmlFiles(full);
    else if (name.endsWith(".html")) yield full;
  }
}

const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function resolve(pathname) {
  const rel = decodeURIComponent(pathname.slice(BASE.length));
  const direct = join(root, rel);
  if (rel && existsSync(direct) && statSync(direct).isFile()) return direct;
  const index = join(root, rel, "index.html");
  return existsSync(index) ? index : null;
}

const errors = [];
let checked = 0;

for (const file of htmlFiles(root)) {
  const page = `/${file.slice(root.length + 1).replaceAll("\\", "/")}`;
  const html = readFileSync(file, "utf8");
  const pageUrl = new URL(`https://site.test${BASE}${page.slice(1).replace(/index\.html$/, "")}`);

  for (const [, , href] of html.matchAll(/\s(href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:|tel:)/.test(href)) continue;
    checked++;
    if (href.startsWith("/") && !href.startsWith(BASE)) {
      errors.push(`${page}: "${href}" ignores the ${BASE} base`);
      continue;
    }
    const target = new URL(href.replaceAll("&amp;", "&"), pageUrl);
    const resolved = target.pathname === pageUrl.pathname && file.endsWith("404.html") ? file : resolve(target.pathname);
    if (!resolved) {
      errors.push(`${page}: broken link "${href}"`);
      continue;
    }
    if (target.hash && resolved.endsWith(".html")) {
      const id = decodeURIComponent(target.hash.slice(1));
      if (!ids(readFileSync(resolved, "utf8")).has(id)) errors.push(`${page}: missing anchor "${href}"`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Link check failed:\n  ${[...new Set(errors)].join("\n  ")}`);
  process.exit(1);
}
console.log(`Link check passed: ${checked} internal links.`);
