import { FUCKXTER_API_URL } from "./config";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function apiEndpoint(path: string): string {
  return `${FUCKXTER_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

const inFlightRequests = new Map<string, Promise<unknown>>();

async function performRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const timeout = AbortSignal.timeout(
    options.method === "GET" ? 15_000 : 30_000,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetch(apiEndpoint(path), {
      ...options,
      headers,
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (timeout.aborted) {
      throw new ApiError("请求超时，请稍后重试。", 408, "TIMEOUT");
    }
    if (options.signal?.aborted) {
      throw new ApiError("请求已取消。", 0, "ABORTED");
    }
    throw new ApiError(
      "无法连接服务器，请检查网络或确认 API 已启动。",
      0,
      "NETWORK",
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const error = (body ?? {}) as ApiErrorBody;
    throw new ApiError(
      error.error?.message ?? error.message ?? `请求失败（${response.status}）`,
      response.status,
      error.error?.code,
    );
  }

  return body as T;
}

export function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const key = `${method}:${path}`;
  if (method === "GET") {
    const existing = inFlightRequests.get(key);
    if (existing) return existing as Promise<T>;
  }

  const request = performRequest<T>(path, options);
  if (method !== "GET") return request;

  inFlightRequests.set(key, request);
  const clear = () => {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  };
  void request.then(clear, clear);
  return request;
}
