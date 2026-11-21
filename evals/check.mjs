// Compares a report with a fixture's expected findings. Pure, so it can be tested without a model.
const RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Checks a contract drafted by `/plumbline init`. */
export function checkInit(contract, expected) {
  const failures = [];
  for (const name of expected.modules) {
    if (!contract.modules[name]) failures.push(`missing module: ${name}`);
  }
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  if (!contract.rules.some((r) => r.forbid && clean(r.forbid) === expected.forbid)) {
    failures.push(`missing rule: forbid ${expected.forbid}`);
  }
  return failures;
}

export function checkReport(report, expected) {
  const failures = [];
  const findings = report.findings ?? [];

  for (const want of expected.findings ?? []) {
    const hit = findings.find((f) => {
      if (f.lens !== want.lens) return false;
      if (want.severity && f.severity !== want.severity) return false;
      if (want.minSeverity && RANK[f.severity] > RANK[want.minSeverity]) return false;
      if (want.file && f.file !== want.file) return false;
      if (want.proof && !(f.proof ?? []).some((p) => p.kind === want.proof)) return false;
      return true;
    });
    if (!hit) failures.push(`missing finding: ${JSON.stringify(want)}`);
  }

  if ((expected.findings ?? []).length === 0) {
    const serious = findings.filter((f) => f.severity === "P0" || f.severity === "P1");
    if (serious.length > 0) failures.push(`expected no P0/P1, got: ${serious.map((f) => f.title).join("; ")}`);
  }
  return failures;
}
