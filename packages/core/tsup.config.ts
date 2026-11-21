import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "graph/worker": "src/graph/worker.ts" },
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
});
