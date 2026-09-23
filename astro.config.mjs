import { defineConfig, envField } from "astro/config";

export default defineConfig({
  env: {
    schema: {
      API_URL: envField.string({
        context: "client",
        access: "public",
        default: "https://api.fuckxter.site",
        url: true,
      }),
    },
  },
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
