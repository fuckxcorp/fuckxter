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
          const item = el("article", "fk-notice-item fk-saved-item");
          item.dataset.postId = post.id;

          const actor = el("div", "fk-notice-actor");
          const avatar = el("span", "fk-notice-avatar");
          avatar.setAttribute("style", avatarGradient(post.author.handle));
          const avatarImage = el("img", "fk-avatar-image");
          avatarImage.src = post.author.avatarUrl
            ? post.author.avatarUrl.startsWith("/")
              ? apiEndpoint(post.author.avatarUrl)
              : post.author.avatarUrl
            : "/user.avif";
          avatarImage.alt = post.author.name;
          avatarImage.loading = "lazy";
          avatarImage.decoding = "async";
          avatar.append(avatarImage);

          const actorCopy = el("div", "fk-notice-actor-copy");
          const nameLine = el("div", "fk-notice-actor-name");
          const name = el("strong");
          name.textContent = post.author.name;
          nameLine.append(name);
          const handle = el("span", "fk-notice-actor-handle");
          handle.textContent = `@${post.author.handle}`;
          const action = el("span", "fk-notice-action");
          action.textContent = "收藏的帖子";
          const time = el("time", "fk-notice-time");
          time.dateTime = post.createdAt;
          time.textContent = relativeTime(post.createdAt);
          actorCopy.append(nameLine, handle, action, time);
          actor.append(avatar, actorCopy);

          const content = el("div", "fk-notice-content");
          const text = el("p", "fk-notice-text");
          text.textContent = post.text || "（图片帖子）";
          const actions = el("footer", "fk-saved-actions");
          const remove = el("button", "fk-saved-remove");
          remove.type = "button";
          remove.textContent = "取消收藏";
          remove.title = "取消收藏";
          const openHint = el("span", "fk-notice-open-hint");
          openHint.textContent = "查看帖子 →";
          actions.append(remove, openHint);
          content.append(text, actions);
          item.append(actor, content);
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
