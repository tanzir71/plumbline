import { runCi } from "./ci.js";

runCi(process.env)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`plumbline: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
