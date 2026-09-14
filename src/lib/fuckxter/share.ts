import type { Post } from "./types";
import { postPath } from "./urls";

export async function sharePost(
  post: Post,
  copyOnly = false,
): Promise<"shared" | "copied"> {
  const url = `${location.origin}${postPath(post)}`;
  if (!copyOnly && navigator.share) {
    await navigator.share({
      title: `${post.author.name} 的帖子`,
      text: post.text,
      url,
    });
    return "shared";
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}
