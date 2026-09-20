const DEFAULT_PRODUCTION_API_URL = "https://api.fuckxter.site";

function defaultApiUrl(): string {
  if (typeof window === "undefined") return DEFAULT_PRODUCTION_API_URL;
  const { hostname, protocol, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:8787`;
  }
  // 默认和页面同源：Worker 本身同时提供页面和 API，
  // 广告拦截器/隐私工具不会把同源请求当成第三方接口拦掉。
  return origin;
}

const configuredApiUrl = import.meta.env.PUBLIC_FUCKXTER_API_URL?.trim();

export const FUCKXTER_API_URL = (configuredApiUrl || defaultApiUrl()).replace(
  /\/+$/,
  "",
);
