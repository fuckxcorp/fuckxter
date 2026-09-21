import type { Env } from "../shared/platform";
import { usernameKey } from "./usernames";

export function buildAvatarUrl(input: {
  handle: string;
  avatarKey: string | null;
  avatarMediaId: string | null;
  updatedAt: string;
}): string | null {
  if (input.avatarKey) {
    return `/avatars/${encodeURIComponent(input.handle)}?v=${encodeURIComponent(input.updatedAt)}`;
  }
  return input.avatarMediaId
    ? `/media/${encodeURIComponent(input.avatarMediaId)}`
    : null;
}

export function buildHeaderUrl(input: {
  handle: string;
  updatedAt: string;
  exists: boolean;
}): string | null {
  return input.exists
    ? `/headers/${encodeURIComponent(input.handle)}?v=${encodeURIComponent(input.updatedAt)}`
    : null;
}

export function headerObjectKey(handle: string): string {
  return `headers/${usernameKey(handle)}.avif`;
}

export async function headerExists(env: Env, handle: string): Promise<boolean> {
  try {
    return Boolean(await env.MEDIA_CACHE.head(headerObjectKey(handle)));
  } catch (error) {
    console.error("header lookup failed", handle, error);
    return false;
  }
}
