import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The graph performance test has a time budget, so it must not compete with other test files for CPU.
    fileParallelism: false,
  },
});
