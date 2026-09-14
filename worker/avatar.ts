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
