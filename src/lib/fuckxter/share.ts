import type { Post } from "./types";
import { postPath } from "./urls";

export type ShareResult = "shared" | "copied" | "cancelled";

function postUrl(post: Post): string {
  return `${location.origin}${postPath(post)}`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard unavailable.");
}

export async function copyPostLink(post: Post): Promise<"copied"> {
  await copyText(postUrl(post));
  return "copied";
}

export async function sharePost(post: Post): Promise<ShareResult> {
  const url = `${location.origin}${postPath(post)}`;
  if (navigator.share) {
    try {
      await navigator.share({
        title: `${post.author.name} 的帖子`,
        text: post.text,
        url,
      });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "cancelled";
      }
      throw error;
    }
  }
  await copyText(url);
  return "copied";
}
