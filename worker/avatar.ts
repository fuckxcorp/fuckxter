import { usernameKey } from "./usernames";

export function buildAvatarUrl(input: {
  handle: string;
  avatarKey: string | null;
  avatarMediaId: string | null;
  updatedAt: string;
}): string | null {
  if (input.avatarKey) {
    return `/api/avatars/${encodeURIComponent(input.handle)}?v=${encodeURIComponent(input.updatedAt)}`;
  }
  return input.avatarMediaId
    ? `/api/media/${encodeURIComponent(input.avatarMediaId)}`
    : null;
}

export function buildHeaderUrl(input: {
  handle: string;
  updatedAt: string;
  exists: boolean;
}): string | null {
  return input.exists
    ? `/api/headers/${encodeURIComponent(input.handle)}?v=${encodeURIComponent(input.updatedAt)}`
    : null;
}

export function headerObjectKey(handle: string): string {
  return `headers/${usernameKey(handle)}.avif`;
}
