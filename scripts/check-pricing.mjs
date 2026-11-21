// CI check: every price needs a source and must have been verified in the last 90 days.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_AGE_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { vendors } = JSON.parse(readFileSync(join(root, "site/src/data/pricing.json"), "utf8"));

const now = process.env.PLUMBLINE_TODAY ? new Date(process.env.PLUMBLINE_TODAY) : new Date();
const errors = [];

for (const v of vendors) {
  if (!/^https:\/\//.test(v.sourceUrl ?? "")) errors.push(`${v.id}: missing https sourceUrl`);
  if (v.model !== "free" && !/^https:\/\/web\.archive\.org\/web\/\d{14}\//.test(v.archiveUrl ?? "")) {
    errors.push(`${v.id}: missing Wayback Machine archiveUrl`);
  }
  const checked = new Date(`${v.checkedAt}T00:00:00Z`);
  if (Number.isNaN(checked.getTime())) {
    errors.push(`${v.id}: invalid checkedAt "${v.checkedAt}"`);
    continue;
  }
  const age = Math.floor((now.getTime() - checked.getTime()) / DAY);
  if (age > MAX_AGE_DAYS) errors.push(`${v.id}: checked ${age} days ago (limit ${MAX_AGE_DAYS}). Re-verify the price.`);
  if (age < -1) errors.push(`${v.id}: checkedAt is in the future`);
}

if (errors.length > 0) {
  console.error(`Pricing check failed:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`Pricing check passed: ${vendors.length} entries within ${MAX_AGE_DAYS} days.`);
