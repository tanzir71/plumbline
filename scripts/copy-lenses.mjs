// Ships the skill's lens files inside the CLI package, so `plumbline mcp` and reports can list them.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "packages", "cli", "lenses");
rmSync(dest, { recursive: true, force: true });
cpSync(join(root, "skills", "plumbline", "lenses"), dest, { recursive: true });
