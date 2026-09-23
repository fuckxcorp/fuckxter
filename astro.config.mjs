import { defineConfig } from "astro/config";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
    },
  },
});
