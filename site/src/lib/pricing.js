// The cost arithmetic. Runs at build time for the first paint and in the browser for the calculator.

const money = (n) => Math.round(n).toLocaleString("en-US");

/** $90k, $7.2k, or $600 below a thousand. */
function short(n) {
  if (n < 1000) return money(n);
  const k = n / 1000;
  return `${Number.isInteger(k) ? k : Number(k.toFixed(1))}k`;
}

function range(low, high, format) {
  return low === high ? `$${format(low)}` : `$${format(low)}–${format(high)}`;
}

/** Monthly [low, high] for one vendor under a scenario. */
export function monthly(vendor, s) {
  if (vendor.model === "per_review") {
    const reviews = s.prsPerMonth * s.reviewsPerPr;
    return [reviews * vendor.low, reviews * vendor.high];
  }
  if (vendor.model === "per_seat") {
    const seat = s.developers * (s.billing === "annual" ? vendor.annual : vendor.monthly);
    return [seat, seat];
  }
  return [0, 0];
}

export function pricingLabel(vendor, s) {
  if (vendor.model === "per_seat") {
    return s.billing === "annual"
      ? `$${vendor.annual} per developer, billed annually`
      : `$${vendor.monthly} per developer, billed monthly`;
  }
  return vendor.label;
}

/** Every figure the table and summary show for a scenario. */
export function computeRows(vendors, s) {
  const months = vendors.map((v) => monthly(v, s));
  const max = Math.max(1, ...months.map(([, high]) => high));
  const rows = vendors.map((vendor, i) => {
    const [low, high] = months[i];
    return {
      id: vendor.id,
      name: vendor.name,
      free: vendor.model === "free",
      pricing: pricingLabel(vendor, s),
      perMonth: range(low, high, money),
      perYear: range(low * 12, high * 12, short),
      // Percent of the column, with the largest bill at full width, so bars stay to scale at any size.
      lowPct: Math.round((low / max) * 1000) / 10,
      rangePct: Math.round(((high - low) / max) * 1000) / 10,
    };
  });
  const paid = months.filter((_, i) => vendors[i].model !== "free");
  const yearLow = Math.min(...paid.map(([low]) => low * 12));
  const yearHigh = Math.max(...paid.map(([, high]) => high * 12));
  return { rows, skipped: range(yearLow, yearHigh, short) };
}
