import { HttpError } from "./http";

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
      "Username must be 2-32 Unicode letters, numbers, combining marks, underscores, or hyphens.",
    );
  }
  return { handle, handleKey: usernameKey(handle) };
}
