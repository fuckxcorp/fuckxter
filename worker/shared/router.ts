import { HttpError } from "./http";
import type { Env } from "./platform";

export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  /** 路径分段，下标从 1 开始：/posts/abc → ["", "posts", "abc"] */
  parts: string[];
  method: string;
  context: ExecutionContext;
}

/** 一组路由。认不出这个请求就返回 null，交给下一组。 */
export type RouteHandler = (route: RouteContext) => Promise<Response | null>;

export function routeSegments(pathname: string): string[] {
  return ["", ...pathname.split("/").filter(Boolean)];
}

export function segment(values: string[], index: number): string {
  try {
    return decodeURIComponent(values[index] ?? "");
  } catch {
    throw new HttpError(400, "INVALID_PATH", "请求路径无效。");
  }
}

export function withCookie(response: Response, cookie: string): Response {
  response.headers.append("Set-Cookie", cookie);
  return response;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 从 JSON 请求体里只取出字符串字段，其它类型一律当没传。 */
export function stringFields<K extends string>(
  body: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = stringOrUndefined(body[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function isStringArray(value: unknown, max?: number): value is string[] {
  return (
    Array.isArray(value) &&
    (max === undefined || value.length <= max) &&
    value.every((item) => typeof item === "string")
  );
}
