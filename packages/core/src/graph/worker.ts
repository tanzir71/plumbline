import { buildGraph } from "./build.js";

// Runs one dependency-cruiser pass in its own process, so base and HEAD can use separate cores.
process.once("message", (message: { dir: string }) => {
  buildGraph(message.dir)
    .then((graph) => process.send?.({ ok: true, graph }))
    .catch((error: unknown) => process.send?.({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    .finally(() => process.disconnect?.());
});
