// Ships the skill inside the CI runtime, so the agent reviews with the same version as the Action.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "packages", "action", "skill");
rmSync(dest, { recursive: true, force: true });
cpSync(join(root, "skills", "plumbline"), dest, { recursive: true });
