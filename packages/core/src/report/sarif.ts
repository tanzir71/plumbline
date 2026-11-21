import { createHash } from "node:crypto";
import type { Finding, Severity } from "../types.js";
import type { ReportV1 } from "./build.js";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = { P0: "error", P1: "error", P2: "warning", P3: "note" };
/** GitHub maps security-severity to critical/high/medium/low in code scanning. */
const SECURITY_SEVERITY: Record<Severity, string> = { P0: "9.5", P1: "7.5", P2: "5.0", P3: "2.0" };

export interface LensInfo {
  id: string;
  name: string;
  catches?: string;
  /** "off" disables the lens: it does not run and its findings are not reported. */
  default?: "on" | "off";
}

function fingerprint(f: Finding): string {
  return createHash("sha256").update(`${f.lens}\0${f.file ?? ""}\0${f.title}`).digest("hex").slice(0, 32);
}

const encodeUri = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** SARIF 2.1.0, one rule per lens. */
export function renderSarif(r: ReportV1, lenses: LensInfo[] = []): object {
  const known = new Map(lenses.map((l) => [l.id, l]));
  const used = [...new Set([...lenses.map((l) => l.id), ...r.findings.map((f) => f.lens)])].sort();
  const ruleIndex = new Map(used.map((id, i) => [id, i]));

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "plumbline",
            semanticVersion: r.tool.version,
            informationUri: "https://tanzir71.github.io/plumbline/",
            rules: used.map((id) => {
              const lens = known.get(id);
              return {
                id,
                name: (lens?.name ?? id).replace(/[^A-Za-z0-9]/g, ""),
                shortDescription: { text: lens?.name ?? id },
                ...(lens?.catches ? { fullDescription: { text: lens.catches } } : {}),
              };
            }),
          },
        },
        invocations: [
          {
            executionSuccessful: true,
            startTimeUtc: r.run.startedAt,
            endTimeUtc: r.run.finishedAt,
          },
        ],
        properties: {
          mergeScore: r.score.value,
          verdict: r.score.verdict,
          base: r.scope.mergeBase,
          head: r.scope.head,
          runId: r.run.id,
        },
        results: r.findings.map((f) => ({
          ruleId: f.lens,
          ruleIndex: ruleIndex.get(f.lens),
          level: LEVEL[f.severity],
          message: { text: `${f.severity}: ${f.title}\n\n${f.body}` },
          ...(f.file
            ? {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: encodeUri(f.file), uriBaseId: "%SRCROOT%" },
                      region: {
                        startLine: f.line ?? 1,
                        ...(f.endLine ? { endLine: f.endLine } : {}),
                      },
                    },
                  },
                ],
              }
            : {}),
          partialFingerprints: { "plumbline/v1": fingerprint(f) },
          properties: {
            severity: f.severity,
            source: f.source,
            proof: f.proof ?? [],
            ...(f.downgradedFrom ? { downgradedFrom: f.downgradedFrom } : {}),
            ...(f.security ? { "security-severity": SECURITY_SEVERITY[f.severity], tags: ["security"] } : {}),
          },
        })),
      },
    ],
  };
}

const CODE_QUALITY: Record<Severity, string> = { P0: "blocker", P1: "critical", P2: "major", P3: "minor" };

/** GitLab Code Quality report for the MR widget. */
export function renderCodeQuality(r: ReportV1): object[] {
  return r.findings.map((f) => ({
    description: `${f.severity} ${f.lens}: ${f.title}`,
    check_name: f.lens,
    fingerprint: fingerprint(f),
    severity: CODE_QUALITY[f.severity],
    location: { path: f.file ?? "plumbline.yml", lines: { begin: f.line ?? 1 } },
  }));
}
