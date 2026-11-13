import { cleanSecurityState } from "./shared/rate-limit";
import { purgeDeletedAccounts } from "./accounts/accounts";
import { pruneSearchIndex } from "./posts/posts";
import {
  assertTrustedOrigin,
  corsHeaders,
  errorResponse,
  HttpError,
  json,
} from "./shared/http";
import { handleQueue } from "./jobs";
import type { Job } from "./shared/jobs";
import type { Env } from "./shared/platform";
import { routeSegments } from "./shared/router";
import type { RouteHandler } from "./shared/router";
import { withPostPageHtml } from "./posts/post-page";
import { withConnectionsPageHtml } from "./accounts/connections-page";
import { withUserPageHtml } from "./accounts/user-page";
import { withMessagesPageHtml } from "./messages/messages-page";
import { DirectMessageHub } from "./messages/live";
import { authRoutes } from "./routes/auth";
import { feedRoutes } from "./routes/feed";
import { mediaRoutes } from "./routes/media";
import { meRoutes } from "./routes/me";
import { messageRoutes } from "./routes/messages";
import { noticeRoutes } from "./routes/notice";
import { postRoutes } from "./routes/posts";
import { userRoutes } from "./routes/users";

export { DirectMessageHub };

const POST_ASSET_PATH = /^\/post\/([^/]+)\/([^/]+)\/?$/i;
const USER_ASSET_PATH = /^\/user\/([^/]+)\/?$/i;
const MESSAGE_ASSET_PATH = /^\/messages\/([^/]+)\/?$/i;
const CONNECTIONS_ASSET_PATH = /^\/user\/([^/]+)\/(followers|following)\/?$/i;
const PRETTY_ASSET_PATHS = new Set([
  "/connections",
  "/login",
  "/notice",
  "/saved",
  "/history",
  "/edit",
  "/settings",
  "/settings/profile",
  "/settings/personalization",
  "/settings/security",
  "/settings/storage",
]);

function assetPagePath(pathname: string): string | null {
  if (POST_ASSET_PATH.test(pathname) || pathname === "/post") return "/post/";
  if (MESSAGE_ASSET_PATH.test(pathname) || pathname === "/messages")
    return "/messages/";
  if (CONNECTIONS_ASSET_PATH.test(pathname)) return "/connections/";
  if (USER_ASSET_PATH.test(pathname) || pathname === "/user") return "/user/";
  if (PRETTY_ASSET_PATHS.has(pathname)) return `${pathname}/`;
  return null;
}

/**
 * 只有 Astro 构建产物能长期缓存：文件名里带内容哈希，改了就是新 URL。
 * public/ 下的文件（logo、默认头像）名字固定，换图后必须能及时刷出来。
 */
function isHashedAsset(pathname: string): boolean {
  return pathname.startsWith("/_astro/");
}

/**
 * 页面里有内联脚本和内联样式，上传还会直连用户自己的 S3，
 * 所以这里不限制 script-src / connect-src，只收紧不会误伤功能的几项：
 * 不许被别的站点嵌进 iframe、不许改 base、不许插件、表单只能提交回本站。
 */
const HTML_CSP =
  "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

function setHtmlHeaders(headers: Headers, secure: boolean): void {
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  headers.set("Content-Security-Policy", HTML_CSP);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (secure) {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }
}

function cacheableAssetResponse(
  response: Response,
  immutable: boolean,
  secure: boolean,
): Response {
  const headers = new Headers(response.headers);
  if ((headers.get("Content-Type") ?? "").includes("text/html")) {
    setHtmlHeaders(headers, secure);
  } else if (immutable) {
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, s-maxage=31536000, immutable",
    );
    headers.set("CDN-Cache-Control", "public, max-age=31536000, immutable");
  } else {
    // 名字固定的静态文件：短 TTL + 必须重新校验，换图后一分钟内生效
    headers.set("Cache-Control", "public, max-age=60, must-revalidate");
    headers.set("CDN-Cache-Control", "public, max-age=60, must-revalidate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAsset(
  request: Request,
  env: Env,
  assetUrl: URL,
  cacheUrl: URL,
  context: ExecutionContext,
  mode: "immutable" | "revalidate",
): Promise<Response> {
  const useWorkerCache = mode === "immutable";
  const secure = new URL(request.url).protocol === "https:";
  const cache = caches.default;
  const cacheKey = new Request(cacheUrl, { method: request.method });
  const cached = useWorkerCache ? await cache.match(cacheKey) : undefined;
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Fuckxter-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  const devOrigin = env.FUCKXTER_DEV_ASSET_ORIGIN;
  const target = devOrigin
    ? new URL(`${assetUrl.pathname}${assetUrl.search}`, devOrigin)
    : assetUrl;
  const fetchSource = () => {
    const assetRequest = new Request(target, request);
    return env.ASSETS ? env.ASSETS.fetch(assetRequest) : fetch(assetRequest);
  };
  let response = await fetchSource();
  if (response.status === 503) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    response = await fetchSource();
  }
  if (!response.ok || (request.method !== "GET" && request.method !== "HEAD")) {
    if ((response.headers.get("Content-Type") ?? "").includes("text/html")) {
      const headers = new Headers(response.headers);
      setHtmlHeaders(headers, secure);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }

  const stored = cacheableAssetResponse(response, useWorkerCache, secure);
  if (!useWorkerCache) return stored;

  const headers = new Headers(stored.headers);
  headers.set("X-Fuckxter-Cache", "MISS");
  const result = new Response(stored.body, {
    status: stored.status,
    statusText: stored.statusText,
    headers,
  });
  context.waitUntil(cache.put(cacheKey, result.clone()));
  return result;
}

function cachePage(response: Response): Response {
  if (!response.headers.has("X-Fuckxter-SSR")) return response;
  const headers = new Headers(response.headers);
  headers.set(
    "Cache-Control",
    "public, max-age=60, stale-while-revalidate=300",
  );
  headers.set(
    "CDN-Cache-Control",
    "public, max-age=60, stale-while-revalidate=300",
  );
  headers.set("X-Fuckxter-Page-Cache", "WORKERS");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 每组路由只认自己的前缀，顺序不影响结果。 */
const ROUTES: RouteHandler[] = [
  feedRoutes,
  authRoutes,
  noticeRoutes,
  messageRoutes,
  mediaRoutes,
  meRoutes,
  postRoutes,
  userRoutes,
];

async function route(
  request: Request,
  env: Env,
  url: URL,
  context: ExecutionContext,
): Promise<Response> {
  const input = {
    request,
    env,
    url,
    context,
    parts: routeSegments(url.pathname),
    method: request.method,
  };
  for (const handler of ROUTES) {
    const response = await handler(input);
    if (response) return response;
  }
  throw new HttpError(404, "NOT_FOUND", "接口不存在。");
}

export default {
  async fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    const isDedicatedApiPath =
      pathname === "/health" ||
      pathname === "/messages/live" ||
      pathname === "/timeline" ||
      pathname === "/search" ||
      pathname === "/me" ||
      pathname.startsWith("/me/") ||
      pathname.startsWith("/auth/") ||
      pathname.startsWith("/posts") ||
      pathname === "/media" ||
      pathname.startsWith("/media/") ||
      pathname.startsWith("/avatars/") ||
      pathname.startsWith("/headers/") ||
      pathname.startsWith("/users/");
    const accept = request.headers.get("Accept") ?? "";
    const wantsJson =
      accept.includes("application/json") && !accept.includes("text/html");
    const isOverlappingApiPath =
      (pathname === "/notice" ||
        pathname === "/messages" ||
        pathname.startsWith("/messages/")) &&
      (wantsJson || (request.method !== "GET" && request.method !== "HEAD"));
    const isApiHost =
      hostname === "api.fuckxter.site" ||
      isDedicatedApiPath ||
      isOverlappingApiPath;
    // API 根地址也必须是 JSON，不能回退到同一 Worker 承载的前端首页。
    if (hostname === "api.fuckxter.site" && pathname === "/") {
      return json(
        { ok: true, service: "fuckxter-api", version: "v1" },
        request,
        env,
      );
    }
    if (!isApiHost) {
      const assetPath = assetPagePath(url.pathname);
      const mode = isHashedAsset(url.pathname) ? "immutable" : "revalidate";
      if (
        assetPath &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const assetUrl = new URL(url);
        assetUrl.pathname = assetPath;
        const cacheUrl = new URL(assetUrl);
        cacheUrl.search = "";
        const response = await fetchAsset(
          request,
          env,
          assetUrl,
          cacheUrl,
          context,
          mode,
        );
        // 帖子页补上 og:*，Telegram 之类的爬虫才抓得到内容
        if (assetPath === "/post/") {
          const rendered = await withPostPageHtml(request, env, url, response);
          return request.method === "GET" ? cachePage(rendered) : rendered;
        }
        if (assetPath === "/user/") {
          const rendered = await withUserPageHtml(request, env, url, response);
          return request.method === "GET" ? cachePage(rendered) : rendered;
        }
        if (assetPath === "/connections/") {
          return await withConnectionsPageHtml(request, env, url, response);
        }
        if (assetPath === "/messages/" && url.pathname === "/messages") {
          return await withMessagesPageHtml(request, env, response);
        }
        return response;
      }
      return fetchAsset(request, env, url, url, context, mode);
    }

    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    try {
      assertTrustedOrigin(request, env);
      return await route(request, env, url, context);
    } catch (error) {
      return errorResponse(error, request, env);
    }
  },

  async queue(batch: MessageBatch<Job>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    await cleanSecurityState(env);
    await pruneSearchIndex(env);
    const purged = await purgeDeletedAccounts(env);
    if (purged > 0) console.log("Purged deleted accounts", purged);
  },
};
