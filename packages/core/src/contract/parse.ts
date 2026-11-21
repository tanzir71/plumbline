import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import picomatch from "picomatch";
import { LineCounter, isCollection, parseDocument, type Document } from "yaml";
import { contractSchema, isForbidRule, parseForbid, type Contract } from "./schema.js";

export const CONTRACT_FILE = "plumbline.yml";

export interface ContractIssue {
  file: string;
  line: number;
  column: number;
  path: string;
  message: string;
}

export class ContractError extends Error {
  readonly issues: ContractIssue[];

  constructor(issues: ContractIssue[]) {
    super(issues.map((i) => `${i.file}:${i.line}:${i.column} ${i.path ? `${i.path}: ` : ""}${i.message}`).join("\n"));
    this.name = "ContractError";
    this.issues = issues;
  }
}

type Path = (string | number)[];

interface Located {
  doc: Document.Parsed;
  counter: LineCounter;
  file: string;
}

function locate(src: Located, path: Path): { line: number; column: number } {
  // Walk up to the deepest node that exists, so a missing key points at its parent.
  for (let depth = path.length; depth >= 0; depth--) {
    const node = depth === 0 ? src.doc.contents : src.doc.getIn(path.slice(0, depth), true);
    const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
    if (range) {
      const { line, col } = src.counter.linePos(range[0]);
      return { line, column: col };
    }
  }
  return { line: 1, column: 1 };
}

function issue(src: Located, path: Path, message: string): ContractIssue {
  return { file: src.file, ...locate(src, path), path: path.join("."), message };
}

function parseYaml(text: string, file: string): Located {
  const counter = new LineCounter();
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    throw new ContractError(
      doc.errors.map((e) => {
        const { line, col } = counter.linePos(e.pos[0]);
        return { file, line, column: col, path: "", message: e.message.split("\n")[0] ?? e.message };
      }),
    );
  }
  return { doc, counter, file };
}

function validateShape(src: Located): Contract {
  if (!isCollection(src.doc.contents)) {
    throw new ContractError([{ file: src.file, line: 1, column: 1, path: "", message: "the contract must be a YAML mapping" }]);
  }
  const result = contractSchema.safeParse(src.doc.toJS());
  if (!result.success) {
    throw new ContractError(
      result.error.issues.map((i) => issue(src, i.path.filter((p): p is string | number => typeof p !== "symbol"), i.message)),
    );
  }
  return result.data;
}

/** Cross-field checks that a schema cannot express. */
function validateSemantics(contract: Contract, src: Located): void {
  const issues: ContractIssue[] = [];
  const names = Object.keys(contract.modules);
  const matches = (pattern: string) => names.filter((n) => picomatch.isMatch(n, pattern));

  const seenLayer = new Map<string, number>();
  contract.layers.forEach((layer, l) => {
    layer.forEach((pattern, p) => {
      const found = matches(pattern);
      if (found.length === 0) issues.push(issue(src, ["layers", l, p], `"${pattern}" matches no module`));
      for (const name of found) {
        const prior = seenLayer.get(name);
        if (prior !== undefined && prior !== l) {
          issues.push(issue(src, ["layers", l, p], `module "${name}" is already in layer ${prior + 1}`));
        }
        seenLayer.set(name, l);
      }
    });
  });

  const seenIds = new Set<string>();
  contract.rules.forEach((rule, r) => {
    if (seenIds.has(rule.id)) issues.push(issue(src, ["rules", r, "id"], `duplicate rule id "${rule.id}"`));
    seenIds.add(rule.id);
    if (isForbidRule(rule)) {
      const { from, to } = parseForbid(rule.forbid);
      for (const pattern of [from, to]) {
        if (matches(pattern).length === 0) issues.push(issue(src, ["rules", r, "forbid"], `"${pattern}" matches no module`));
      }
    } else if (rule.check === "semgrep" && !rule.config) {
      issues.push(issue(src, ["rules", r, "check"], "check: semgrep needs a local config path"));
    } else if (rule.check === "custom" && !rule.command) {
      issues.push(issue(src, ["rules", r, "check"], "check: custom needs a command"));
    }
  });

  if (issues.length > 0) throw new ContractError(issues);
}

/** Parse one contract document. Does not follow `extends`. */
export function parseContract(text: string, file: string = CONTRACT_FILE): Contract {
  const src = parseYaml(text, file);
  const contract = validateShape(src);
  if (!contract.extends) validateSemantics(contract, src);
  return contract;
}

/** `childKeys` are the keys the child set explicitly, so schema defaults never overwrite a parent's values. */
function mergeContracts(parent: Contract, child: Contract, childKeys: Set<string>): Contract {
  const childIds = new Set(child.rules.map((r) => r.id));
  return {
    ...parent,
    modules: { ...parent.modules, ...child.modules },
    layers: childKeys.has("layers") ? child.layers : parent.layers,
    rules: [...parent.rules.filter((r) => !childIds.has(r.id)), ...child.rules],
    proof: childKeys.has("proof") ? child.proof : parent.proof,
    gate: childKeys.has("gate") ? child.gate : parent.gate,
    lanes: childKeys.has("lanes") ? child.lanes : parent.lanes,
    version: 1,
    extends: undefined,
  };
}

function resolveExtends(file: string, root: string, chain: string[]): { contract: Contract; src: Located; keys: Set<string> } {
  const shown = relative(root, file).replaceAll("\\", "/") || file;
  if (chain.includes(file)) {
    throw new ContractError([{ file: shown, line: 1, column: 1, path: "extends", message: "extends forms a loop" }]);
  }
  const src = parseYaml(readFileSync(file, "utf8"), shown);
  const own = validateShape(src);
  const parents = own.extends ? (Array.isArray(own.extends) ? own.extends : [own.extends]) : [];
  const ownKeys = new Set(Object.keys(src.doc.toJS() as Record<string, unknown>));
  const keys = new Set(ownKeys);
  let merged: Contract | undefined;

  parents.forEach((entry, i) => {
    const at: Path = Array.isArray(own.extends) ? ["extends", i] : ["extends"];
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) {
      throw new ContractError([issue(src, at, "extends must be a local path. Plumbline makes no network calls for contracts")]);
    }
    const target = resolve(dirname(file), entry);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new ContractError([issue(src, at, "extends must stay inside the repository")]);
    }
    if (!existsSync(target)) throw new ContractError([issue(src, at, `file not found: ${entry}`)]);
    const parent = resolveExtends(target, root, [...chain, file]);
    merged = merged ? mergeContracts(merged, parent.contract, parent.keys) : parent.contract;
    for (const key of parent.keys) keys.add(key);
  });

  const contract = merged ? mergeContracts(merged, own, ownKeys) : own;
  return { contract, src, keys };
}

/**
 * Load a contract and resolve `extends`. Returns null when the file does not exist.
 * Defaults to `plumbline.yml` at the repo root. Pass a path to validate a draft without replacing it.
 */
export function loadContract(root: string, path: string = CONTRACT_FILE): Contract | null {
  const file = resolve(root, path);
  if (!existsSync(file)) return null;
  const { contract, src } = resolveExtends(file, resolve(root), []);
  validateSemantics(contract, src);
  return contract;
}

/** A valid contract with no modules or rules, used when a repo has no plumbline.yml. */
export function emptyContract(): Contract {
  return contractSchema.parse({ version: 1 });
}
