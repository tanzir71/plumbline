import { buildGraph } from "./build.js";

// Disconnect only after the reply is flushed. Otherwise a large graph can be lost when the process exits.
const reply = (message: unknown) => {
  process.send?.(message, undefined, undefined, () => process.disconnect?.());
};

// Runs one dependency-cruiser pass in its own process, so base and HEAD can use separate cores.
process.once("message", (message: { dir: string }) => {
  buildGraph(message.dir)
    .then((graph) => reply({ ok: true, graph }))
    .catch((error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }));
});
