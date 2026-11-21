import { formatCounts } from "../score.js";
import type { Finding, Severity } from "../types.js";
import type { ReportV1 } from "./build.js";

/** Marks the one comment Plumbline owns on a PR or MR, so a re-run edits it. */
export const COMMENT_MARKER = "<!-- plumbline:review -->";

const ICON: Record<Severity, string> = { P0: "🔴", P1: "🟠", P2: "🟡", P3: "🔵" };

/**
 * Finding text comes from a model reading untrusted code. Stop it from spoofing our marker,
 * pinging people or teams, or injecting raw HTML into a PR comment.
 */
export function sanitize(text: string): string {
  return text
    .replace(/<!--/g, "&lt;!--")
    .replace(/<(?=[a-zA-Z/!])/g, "&lt;")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@\u200b");
}

const inline = (text: string) => sanitize(text).replace(/\s*\n\s*/g, " ");
const code = (text: string) => `\`${text.replace(/`/g, "'").replace(/\s*\n\s*/g, " ")}\``;

function location(f: Finding): string {
  if (!f.file) return "";
  const line = f.line ? `:${f.line}${f.endLine && f.endLine !== f.line ? `-${f.endLine}` : ""}` : "";
  return ` — ${code(`${f.file}${line}`)}`;
}

function proofLine(f: Finding): string {
  if (!f.proof?.length) return "none";
  return f.proof
    .map((p) => {
      const detail = p.detail ? ` (${inline(p.detail)})` : "";
      return `${p.kind} ${code(p.ref)}${detail}`;
    })
    .join(" · ");
}

function mermaidId(name: string, ids: Map<string, string>): string {
  if (!ids.has(name)) ids.set(name, `n${ids.size}`);
  return ids.get(name) as string;
}

const mermaidLabel = (s: string) => s.replace(/["\\<>`]/g, "").replace(/\n/g, " ");

/** Dependency diff as Mermaid. Prefers module edges, and caps the size so comments stay readable. */
export function renderMermaid(graph: NonNullable<ReportV1["graph"]>, limit = 40): string | null {
  const useModules = graph.moduleEdgesAdded.length > 0;
  const added = useModules ? graph.moduleEdgesAdded : graph.added;
  if (added.length === 0 && graph.newCycles.length === 0) return null;

  const ids = new Map<string, string>();
  const lines = ["flowchart LR"];
  const shown = added.slice(0, limit);
  const cycleEdges: { from: string; to: string }[] = [];
  for (const cycle of graph.newCycles.filter((c) => c.level === (useModules ? "module" : "file"))) {
    for (let i = 0; i + 1 < cycle.path.length; i++) {
      cycleEdges.push({ from: cycle.path[i] as string, to: cycle.path[i + 1] as string });
    }
  }
  const addedKeys = new Set(shown.map((e) => `${e.from}\0${e.to}`));
  const existing = cycleEdges.filter((e) => !addedKeys.has(`${e.from}\0${e.to}`));
  const unique = [...new Map(existing.map((e) => [`${e.from}\0${e.to}`, e])).values()];

  const edgeLines: string[] = [];
  for (const e of unique) edgeLines.push(`  ${mermaidId(e.from, ids)} --> ${mermaidId(e.to, ids)}`);
  const firstAdded = edgeLines.length;
  for (const e of shown) edgeLines.push(`  ${mermaidId(e.from, ids)} ==>|new| ${mermaidId(e.to, ids)}`);

  for (const [name, id] of ids) lines.push(`  ${id}["${mermaidLabel(name)}"]`);
  lines.push(...edgeLines);
  if (shown.length > 0) {
    const indexes = shown.map((_, i) => firstAdded + i).join(",");
    lines.push(`  linkStyle ${indexes} stroke:#FF6B81,stroke-width:2px`);
  }
  if (added.length > shown.length) lines.push(`  %% ${added.length - shown.length} more added edges in report.json`);
  return lines.join("\n");
}

function footer(r: ReportV1): string[] {
  const seconds = Math.round(r.run.durationMs / 1000);
  const ran = r.run.mode === "deterministic" ? "graph and rule checks only (no model)" : `lenses ${r.lenses.ran.join(", ") || "none"}`;
  const rows = [
    `Ran: ${ran}`,
    `Scope: ${inline(r.scope.label)} · ${r.scope.head.slice(0, 7)} · ${r.scope.files} files +${r.scope.additions}/-${r.scope.deletions}`,
    `Model: ${r.run.model ? inline(r.run.model) : "none"} · Duration: ${seconds}s`,
  ];
  if (r.reviewers.length > 0) {
    rows.push(`Reviewers: ${r.reviewers.map((x) => `${inline(x.id)}${x.status === "inconclusive" ? " (inconclusive)" : ""}`).join(", ")}`);
  }
  if (r.lenses.skipped.length > 0) {
    rows.push(`Skipped lenses: ${r.lenses.skipped.map((l) => `${inline(l.id)} (${inline(l.reason)})`).join(", ")}`);
  }
  if (r.skippedRules.length > 0) {
    rows.push(`Skipped rules: ${r.skippedRules.map((x) => `${inline(x.id)} (${inline(x.reason)})`).join(", ")}`);
  }
  if (r.score.capReason) rows.push(`Coverage: ${inline(r.score.capReason)}`);
  if (r.gate?.applies) rows.push(`Gate: ${r.gate.pass ? "passed" : "failed"}. ${r.gate.reason}`);
  if (r.lane) {
    rows.push(
      r.lane.qualifies
        ? `Lane: qualifies for \`${r.lane.label}\`. ${r.lane.reasons.join("; ")}. A person still approves.`
        : `Lane: standard review. ${r.lane.reasons.join("; ")}.`,
    );
  }
  return rows;
}

export function renderMarkdown(r: ReportV1): string {
  const out: string[] = [
    COMMENT_MARKER,
    `## Merge score: ${r.score.value}/5 — ${formatCounts(r.score.counts)}`,
    "",
    r.score.verdict,
    "",
  ];

  if (r.findings.length > 0) {
    out.push("### Findings", "");
    r.findings.forEach((f, i) => {
      const lock = f.security ? "🔒 " : "";
      const downgraded = f.downgradedFrom ? ` (downgraded from ${f.downgradedFrom})` : "";
      out.push(`#### ${i + 1}. ${ICON[f.severity]} ${f.severity} · ${lock}${inline(f.lens)} · ${inline(f.title)}${location(f)}`, "");
      out.push(sanitize(f.body), "");
      if (f.fix) out.push(`**Fix:** ${sanitize(f.fix)}`, "");
      out.push(`**Proof:** ${proofLine(f)}${downgraded}`);
      if (f.downgradeReason) out.push(`**Why downgraded:** ${inline(f.downgradeReason)}`);
      out.push("");
    });
  } else {
    out.push("No findings.", "");
  }

  if (r.dropped.length > 0) {
    out.push(`<details><summary>Dropped by the proof gate (${r.dropped.length})</summary>`, "");
    for (const d of r.dropped) out.push(`- ${inline(d.finding.title)}: ${inline(d.reason)}`);
    out.push("", "</details>", "");
  }

  const mermaid = r.graph ? renderMermaid(r.graph) : null;
  if (mermaid) out.push("### Dependency diff", "", "```mermaid", mermaid, "```", "");

  out.push("---", "", ...footer(r).map((l) => `<sub>${l}</sub><br>`));
  return `${out.join("\n").trimEnd()}\n`;
}
