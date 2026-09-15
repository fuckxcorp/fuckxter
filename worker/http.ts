import type { Env } from "./platform";

function allowedOrigins(env: Env): string[] {
  return env.FUCKXTER_ORIGINS.split(",").map((item) => item.trim());
}

function originAllowed(origin: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (!pattern.includes("*")) return origin === pattern;
    const [prefix, suffix] = pattern.split("*");
    return origin.startsWith(prefix) && origin.endsWith(suffix);
  });
}

export function assertTrustedOrigin(request: Request, env: Env): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (!originAllowed(origin, allowedOrigins(env))) {
    throw new HttpError(
      403,
      "ORIGIN_FORBIDDEN",
      "Request origin is not allowed.",
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
  if (origin && originAllowed(origin, allowedOrigins(env))) {
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
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON.");
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
        message: "Internal server error.",
      },
    },
    request,
    env,
    { status: 500 },
  );
}
