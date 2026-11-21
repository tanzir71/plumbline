import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import { url } from "./url";

/** Content is read from the repo at build time. There is no CMS. */
const ROOT = existsSync(join(process.cwd(), "skills")) ? process.cwd() : join(process.cwd(), "..");

function frontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  return m ? { data: parseYaml(m[1] as string) as Record<string, unknown>, body: m[2] as string } : { data: {}, body: text };
}

export interface LensRow {
  id: string;
  name: string;
  catches: string;
  example: string;
  proof: string[];
}

export function lenses(): LensRow[] {
  const dir = join(ROOT, "skills", "plumbline", "lenses");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const { data } = frontmatter(readFileSync(join(dir, f), "utf8"));
      return {
        id: String(data.id),
        name: String(data.name),
        catches: String(data.catches),
        example: String(data.example),
        proof: (data.proof as string[]) ?? [],
      };
    });
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

function renderer() {
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        return `<h${depth} id="${slugify(html)}">${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        // `./gating.md#x` in the repo becomes `/plumbline/docs/gating/#x` on the site.
        const local = /^(?:\.\/)?([\w-]+)\.md(#.*)?$/.exec(href);
        const target = local ? url(`docs/${local[1] === "index" ? "" : `${local[1]}/`}${local[2] ?? ""}`) : href;
        const external = /^https?:/.test(target) ? ' rel="noopener"' : "";
        return `<a href="${target}"${title ? ` title="${title}"` : ""}${external}>${text}</a>`;
      },
    },
  });
  return md;
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  html: string;
}

export function docs(): DocPage[] {
  const dir = join(ROOT, "docs", "guide");
  const md = renderer();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data, body } = frontmatter(readFileSync(join(dir, f), "utf8"));
      return {
        slug: f.replace(/\.md$/, ""),
        title: String(data.title ?? f),
        description: String(data.description ?? ""),
        order: Number(data.order ?? 99),
        html: md.parse(body, { async: false }) as string,
      };
    })
    .sort((a, b) => a.order - b.order);
}

export function changelogHtml(): string {
  const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").replace(/^# .*\r?\n/, "");
  return renderer().parse(text, { async: false }) as string;
}
