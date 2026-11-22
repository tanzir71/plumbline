// Ships the skill inside a package, so its agent reviews with the same version. Usage: copy-skill.mjs [action|cli]
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] ?? "action";
if (!["action", "cli"].includes(target)) throw new Error(`unknown package: ${target}`);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "packages", target, "skill");
rmSync(dest, { recursive: true, force: true });
cpSync(join(root, "skills", "plumbline"), dest, { recursive: true });
