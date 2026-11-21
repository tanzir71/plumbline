import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://tanzir71.github.io",
  base: "/plumbline",
  trailingSlash: "always",
  output: "static",
  build: { format: "directory", inlineStylesheets: "auto" },
  devToolbar: { enabled: false },
});
