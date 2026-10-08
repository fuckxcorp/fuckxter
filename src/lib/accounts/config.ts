import { API_URL as configuredApiUrl } from "astro:env/client";

const apiUrl = new URL(configuredApiUrl);
if (
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname) &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
) {
  apiUrl.hostname = window.location.hostname;
}

export const API_URL = apiUrl.href.replace(/\/+$/, "");
