import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", lib: "src/lib.ts" },
  format: ["esm"],
  target: "node20",
  dts: { entry: { lib: "src/lib.ts" } },
  sourcemap: true,
  clean: true,
});
