import type { Env } from "./platform";

function allowedOrigins(env: Env): string[] {
  return env.FUCKXTER_ORIGINS.split(",").map((item) => item.trim());
}

/**
 * 浏览器里的页面能不能来自这个地址？这里只认「本机 loopback」。
 * 别人的网站没法把自己的 Origin 伪造成 localhost，所以放开它不会给线上带来远程
 * 攻击面；而本机开发时 astro 端口被占用会自动换端口（4321 → 4322），本地直接开
 * wrangler 的 8787 也在其中，只认 wrangler.toml 里写死的那两个地址就会变成
 * 「本地登录不了：请求来源不被允许」。
 */
function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.")
  ) {
    return true;
  }
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}

/**
 * 这个请求是不是经过 wrangler dev 的本地代理转发进来的。
 * 本地代理会把请求 URL 和 Origin 一起改写成 wrangler.toml 里配的路由域名，
 * 所以「直接开 8787」时工作线程看到的 Origin 是 http://fuckxter.site。
 * 线上浏览器请求带不上这个头（自定义头会先触发预检，而我们没把它列进
 * Access-Control-Allow-Headers），所以可以拿它当本地开发的标记。
 */
function isDevProxyRequest(request: Request): boolean {
  return request.headers.has("mf-original-hostname");
}

function originAllowed(
  origin: string,
  patterns: string[],
  request: Request,
): boolean {
  const listed = patterns.some((pattern) => {
    if (!pattern.includes("*")) return origin === pattern;
    const [prefix, suffix] = pattern.split("*");
    return origin.startsWith(prefix) && origin.endsWith(suffix);
  });
  if (listed) return true;
  try {
    const originUrl = new URL(origin);
    if (isLoopbackHostname(originUrl.hostname)) return true;
    // 本地代理改写后的「同源」请求：Origin 就是请求自己的域名
    return (
      isDevProxyRequest(request) && originUrl.host === new URL(request.url).host
    );
  } catch {
    return false;
  }
}

export function assertTrustedOrigin(request: Request, env: Env): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (!originAllowed(origin, allowedOrigins(env), request)) {
    throw new HttpError(
      403,
      "ORIGIN_FORBIDDEN",
      `请求来源不被允许（Origin: ${origin}）。`,
    );
  }
}

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("Origin");
  if (origin && originAllowed(origin, allowedOrigins(env), request)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Fuckxter-Client, X-File-Name, X-Storage-Config-Id",
    );
    headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

export function json(
  body: unknown,
  request: Request,
  env: Env,
  init: ResponseInit = {},
): Response {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { ...init, headers });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求体不是合法的 JSON。");
  }
}

export function errorResponse(
  error: unknown,
  request: Request,
  env: Env,
): Response {
  if (error instanceof HttpError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      request,
      env,
      { status: error.status },
    );
  }

  console.error(error);
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "服务器内部错误。",
      },
    },
    request,
    env,
    { status: 500 },
  );
}
