import { getAccount } from "../accounts/auth";
import type { Post } from "../core/types";
import { postPath } from "../core/urls";

type Visit = {
  id: string;
  path: string;
  name: string;
  text: string;
  at: string;
};
const key = () => `fk-history:${getAccount()?.profile.handle ?? "guest"}`;

export function readHistory(): Visit[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(key()) ?? "[]");
    return Array.isArray(items)
      ? items
          .filter(
            (item): item is Visit =>
              item &&
              typeof item.id === "string" &&
              typeof item.path === "string" &&
              item.path.startsWith("/post/") &&
              typeof item.name === "string" &&
              typeof item.text === "string" &&
              typeof item.at === "string",
          )
          .slice(0, 200)
      : [];
  } catch {
    return [];
  }
}

export function rememberPost(post: Post): void {
  const item: Visit = {
    id: post.id,
    path: postPath(post),
    name: post.author.name,
    text: post.text.slice(0, 200),
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(
      key(),
      JSON.stringify(
        [item, ...readHistory().filter((visit) => visit.id !== post.id)].slice(
          0,
          200,
        ),
      ),
    );
  } catch {}
}

export function clearHistory(): void {
  localStorage.removeItem(key());
}
