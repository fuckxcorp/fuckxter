import { getPostByPath } from "../accounts/api";
import { getAccount } from "../accounts/auth";
import type { Post } from "../core/types";
import { usernameKey } from "../core/validation";

let pending: {
  key: string;
  account: ReturnType<typeof getAccount>;
  at: number;
  request: Promise<Post | null>;
} | null = null;

export function preloadPost(post: Post): void {
  const handle = usernameKey(post.author.handle);
  const slug = post.slug.toLowerCase();
  const request = getPostByPath(handle, slug);
  pending = {
    key: `${handle}/${slug}`,
    account: getAccount(),
    at: Date.now(),
    request,
  };
  void request.catch(() => {});
}

export function loadPost(handle: string, slug: string): Promise<Post | null> {
  const next = pending;
  pending = null;
  if (
    next?.key === `${handle}/${slug}` &&
    next.account === getAccount() &&
    Date.now() - next.at < 10_000
  ) {
    return next.request;
  }
  return getPostByPath(handle, slug);
}
