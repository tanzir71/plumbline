import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { PROOF_KINDS } from "./types.js";

const frontmatter = z.object({
  id: z.string().regex(/^[A-Za-z][\w-]*$/),
  name: z.string().min(1),
  default: z.enum(["on", "off"]).default("on"),
  proof: z.array(z.enum(PROOF_KINDS)).default([]),
  catches: z.string().default(""),
  example: z.string().default(""),
});

export type LensMeta = z.output<typeof frontmatter>;

export interface Lens extends LensMeta {
  file: string;
  body: string;
  custom: boolean;
}

export function parseLens(text: string, file: string, custom = false): Lens {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: a lens needs YAML frontmatter`);
  // YAML reads a bare `on`/`off` as text in the 1.2 core schema, which is what we want here.
  const result = frontmatter.safeParse(parse(m[1] as string));
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`${file}: ${first?.path.join(".") ?? ""} ${first?.message ?? "invalid frontmatter"}`);
  }
  return { ...result.data, file, body: (m[2] as string).trim(), custom };
}

function readDir(dir: string, custom: boolean): Lens[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const file = join(dir, f);
      return parseLens(readFileSync(file, "utf8"), file, custom);
    });
}

/** Load built-in lenses, then let a repo's `.plumbline/lenses/*.md` override or add to them. */
export function loadLenses(builtinDir: string, repoRoot?: string): Lens[] {
  const byId = new Map<string, Lens>();
  for (const lens of readDir(builtinDir, false)) byId.set(lens.id, lens);
  if (repoRoot) for (const lens of readDir(join(repoRoot, ".plumbline", "lenses"), true)) byId.set(lens.id, lens);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
