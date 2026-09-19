const DEFAULT_PRODUCTION_API_URL = "https://api.fuckxter.site";

function defaultApiUrl(): string {
  if (typeof window === "undefined") return DEFAULT_PRODUCTION_API_URL;
  const { hostname, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:8787`;
  }
  return DEFAULT_PRODUCTION_API_URL;
}

const configuredApiUrl = import.meta.env.PUBLIC_FUCKXTER_API_URL?.trim();

export const FUCKXTER_API_URL = (configuredApiUrl || defaultApiUrl()).replace(
  /\/+$/,
  "",
);
