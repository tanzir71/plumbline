// CI check for the site's UI rules: gradients only as the two glows, no shadows, no warm colours.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "src");
/** Glow lives only in the mesh, which is used behind the hero shot and the final-CTA box. */
const GLOW_FILES = new Set(["components/GlowMesh.astro"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(astro|css)$/.test(name)) yield full;
  }
}

function isWarm(hex) {
  const v = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40 || max !== r) return false;
  const hue = (60 * (g - b)) / (max - min);
  return hue >= 15 && hue <= 70;
}

const errors = [];
for (const file of walk(root)) {
  const rel = relative(root, file).replaceAll("\\", "/");
  const text = readFileSync(file, "utf8");
  const css = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n") || (rel.endsWith(".css") ? text : "");

  if (/\b(?:box|text)-shadow\s*:|drop-shadow\(/.test(css)) errors.push(`${rel}: shadows are not allowed`);
  // The mesh may fade itself out with a mask. That is transparency, not a fill.
  // In motion.css, diagram lines may carry a travelling gradient on their ::after layer.
  const fills = GLOW_FILES.has(rel)
    ? css.replace(/mask-image:[^;]*;/g, "")
    : rel === "styles/motion.css"
      ? css.replace(/::after\s*\{[^}]*linear-gradient\([^}]*\}/g, "::after {}")
      : css;
  if (/\b(?:linear|conic)-gradient\(/.test(fills)) errors.push(`${rel}: gradient fills are not allowed`);
  if (/radial-gradient\(/.test(css)) {
    if (!GLOW_FILES.has(rel)) errors.push(`${rel}: glow is only allowed in the hero and final CTA`);
    else if (!/\.glow-mesh\s*\{[^}]*z-index:\s*-1/.test(css)) errors.push(`${rel}: glow must sit on a background layer`);
  }
  for (const [, hex] of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    if (isWarm(hex)) errors.push(`${rel}: warm colour #${hex}`);
  }
}

if (errors.length > 0) {
  console.error(`Site CSS check failed:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("Site CSS check passed.");
