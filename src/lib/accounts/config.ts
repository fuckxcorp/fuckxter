const DEFAULT_PRODUCTION_API_URL = "https://api.fuckxter.site";

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) {
    return true;
  }
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function defaultApiUrl(): string {
  if (typeof window === "undefined") return DEFAULT_PRODUCTION_API_URL;
  const { hostname, origin } = window.location;
  if (isLocalHostname(hostname)) {
    return origin;
  }
  return DEFAULT_PRODUCTION_API_URL;
}

const configuredApiUrl = import.meta.env.PUBLIC_FUCKXTER_API_URL?.trim();

export const FUCKXTER_API_URL = (configuredApiUrl || defaultApiUrl()).replace(
  /\/+$/,
  "",
);
