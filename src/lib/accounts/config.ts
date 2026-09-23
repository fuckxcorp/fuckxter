import { API_URL as configuredApiUrl } from "astro:env/client";

export const API_URL = configuredApiUrl.replace(/\/+$/, "");
