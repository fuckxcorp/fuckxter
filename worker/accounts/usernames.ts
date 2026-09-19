import { HttpError } from "../shared/http";

const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{1,31}$/u;

export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim();
}

export function usernameKey(value: string): string {
  return normalizeUsername(value).toLocaleLowerCase("und");
}

export function validateUsername(value: string): {
  handle: string;
  handleKey: string;
} {
  const handle = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(handle)) {
    throw new HttpError(
      400,
      "INVALID_USERNAME",
      "用户名需为 2-32 个 Unicode 字母、数字、组合符号、下划线或连字符。",
    );
  }
  return { handle, handleKey: usernameKey(handle) };
}
