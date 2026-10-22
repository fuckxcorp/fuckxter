import type { Env } from "./platform";

function allowedOrigins(env: Env): string[] {
  return env.FUCKXTER_ORIGINS.split(",").map((item) => item.trim());
}

// Local development accepts loopback and private IPv4 addresses, never DNS prefixes.
function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) {
    return true;
  }
  const octets = host.split(".");
  if (
    octets.length !== 4 ||
    octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  )
    return false;
  const [first, second] = octets.map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

function originAllowed(
  origin: string,
  patterns: string[],
  request: Request,
  development: boolean,
): boolean {
  const listed = patterns.some((pattern) => {
    if (!pattern.includes("*")) return origin === pattern;
    const [prefix, suffix] = pattern.split("*");
    return origin.startsWith(prefix) && origin.endsWith(suffix);
  });
  if (listed) return true;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    return (
      ["http:", "https:"].includes(originUrl.protocol) &&
      ((isLoopbackHostname(requestUrl.hostname) &&
        isLoopbackHostname(originUrl.hostname)) ||
        (development &&
          (isLoopbackHostname(originUrl.hostname) ||
            originUrl.origin === requestUrl.origin)))
    );
  } catch {
    return false;
  }
}

export function assertTrustedOrigin(request: Request, env: Env): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (
    !originAllowed(
      origin,
      allowedOrigins(env),
      request,
      env.FUCKXTER_DEV === "true",
    )
  ) {
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
  retryAfter?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("Origin");
  if (
    origin &&
    originAllowed(
      origin,
      allowedOrigins(env),
      request,
      env.FUCKXTER_DEV === "true",
    )
  ) {
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
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return Response.json(body, { ...init, headers });
}

export async function readJson<T>(request: Request): Promise<T> {
  const limit = 1024 * 1024;
  const tooLarge = () => new HttpError(413, "BODY_TOO_LARGE", "请求体过大。");
  if (Number(request.headers.get("Content-Length")) > limit) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "INVALID_JSON", "请求体不是合法的 JSON。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_JSON", "请求体不是合法的 JSON。");
  } finally {
    reader.releaseLock();
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
      {
        status: error.status,
        headers: error.retryAfter
          ? { "Retry-After": String(error.retryAfter) }
          : undefined,
      },
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
