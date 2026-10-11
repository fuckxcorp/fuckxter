import { HttpError } from "./http";
export function encodeCursor(time: string, id: string): string {
  return btoa(JSON.stringify([time, id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function decodeCursor(value: string): [string, string] {
  try {
    const text = value.replace(/-/g, "+").replace(/_/g, "/");
    const result = JSON.parse(
      atob(text.padEnd(Math.ceil(text.length / 4) * 4, "=")),
    );
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      result.some((item) => typeof item !== "string") ||
      !result[0] ||
      !result[1]
    )
      throw new Error();
    return result as [string, string];
  } catch {
    throw new HttpError(400, "INVALID_CURSOR", "翻页参数无效。");
  }
}
