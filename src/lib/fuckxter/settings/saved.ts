import { navigate } from "astro:transitions/client";
import { getSavedPosts, toggleSave } from "../api";
import { avatarGradient, el, relativeTime } from "../dom";
import { apiEndpoint } from "../http";
import type { Post } from "../types";
import { postPath } from "../urls";

export function mountSavedSettings(root: HTMLElement): void {
  const savedList = root.querySelector<HTMLElement>("[data-role=saved-list]")!;
  const savedEmpty = root.querySelector<HTMLElement>(
    "[data-role=saved-empty]",
  )!;
  const postsById = new Map<string, Post>();

  const renderSavedList = async () => {
    try {
      const posts = await getSavedPosts();
      postsById.clear();
      savedEmpty.textContent = "还没有收藏内容";
      savedEmpty.hidden = posts.length > 0;
      savedList.replaceChildren(
        ...posts.map((post) => {
          const item = el("article", "fk-post fk-saved-item");
          item.dataset.postId = post.id;
          const avatar = el("div", "fk-avatar");
          avatar.setAttribute("style", avatarGradient(post.author.handle));
          const avatarImage = el("img", "fk-avatar-image");
          avatarImage.src = post.author.avatarUrl
            ? post.author.avatarUrl.startsWith("/")
              ? apiEndpoint(post.author.avatarUrl)
              : post.author.avatarUrl
            : "/user.webp";
          avatarImage.alt = post.author.name;
          avatar.append(avatarImage);
          const body = el("div", "fk-post-body");
          const head = el("header", "fk-post-head");
          const name = el("span", "fk-post-name");
          name.textContent = post.author.name;
          const meta = el("span", "fk-post-meta");
          meta.textContent = `@${post.author.handle} · ${relativeTime(post.createdAt)}`;
          head.append(name, meta);
          const text = el("p", "fk-post-text");
          text.textContent = post.text;
          const remove = el("button", "fk-saved-remove");
          remove.type = "button";
          remove.textContent = "取消收藏";
          remove.title = "取消收藏";
          body.append(head, text, remove);
          item.append(avatar, body);
          return item;
        }),
      );
      for (const post of posts) postsById.set(post.id, post);
    } catch (error) {
      savedList.replaceChildren();
      savedEmpty.textContent =
        error instanceof Error ? error.message : "收藏加载失败";
      savedEmpty.hidden = false;
    }
  };

  savedList.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>(".fk-saved-item");
    if (!item) return;
    const post = postsById.get(item.dataset.postId ?? "");
    if (!post) return;
    if (target.closest<HTMLButtonElement>(".fk-saved-remove")) {
      try {
        await toggleSave(post, false);
        await renderSavedList();
      } catch {}
      return;
    }
    void navigate(postPath(post));
  });

  void renderSavedList();
}
