import type { Post } from "./types";
import { apiEndpoint } from "./http";

export const ICONS = {
  reply:
    '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>',
  repost:
    '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>',
  heart:
    '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
  share:
    '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M16 6l-4-4-4 4"></path><path d="M12 2v13"></path></svg>',
  copy: '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
  bookmark:
    '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
  edit: '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z"></path></svg>',
  trash:
    '<svg class="fk-action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 15H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
  verified:
    '<svg class="fk-verified" viewBox="0 0 24 24" aria-label="认证账号" role="img"><path fill="currentColor" d="M12 1.5l2.6 2 3.2-.4 1.2 3 3 1.2-.4 3.2 2 2.5-2 2.5.4 3.2-3 1.2-1.2 3-3.2-.4-2.6 2-2.6-2-3.2.4-1.2-3-3-1.2.4-3.2-2-2.5 2-2.5-.4-3.2 3-1.2 1.2-3 3.2.4z"></path><path class="fk-verified-check" d="M10.7 15.9l-3-3 1.3-1.3 1.7 1.7 4.3-4.3 1.3 1.3z"></path></svg>',
};

const AVATAR_GRADIENTS: [string, string][] = [
  ["#f97316", "#ef4444"],
  ["#8b5cf6", "#6366f1"],
  ["#06b6d4", "#3b82f6"],
  ["#10b981", "#14b8a6"],
  ["#f43f5e", "#ec4899"],
  ["#f59e0b", "#d97706"],
];

export function avatarGradient(handle: string): string {
  const hash = [...handle].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return `background-image: linear-gradient(135deg, ${from}, ${to})`;
}

export function relativeTime(iso: string): string {
  const diffSeconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (diffSeconds < 60) return "刚刚";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}分钟前`;
  if (diffSeconds < 86_400) return `${Math.floor(diffSeconds / 3600)}小时前`;
  if (diffSeconds < 86_400 * 7)
    return `${Math.floor(diffSeconds / 86_400)}天前`;
  return new Date(iso).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export function fmtCount(n: number): string {
  if (n < 10_000) return String(n);
  const wan = n / 10_000;
  return `${wan >= 10 ? Math.round(wan) : Math.round(wan * 10) / 10}万`;
}

export function renderRichText(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const pattern = /(@[a-z0-9_]{2,20}|#[\p{L}\p{N}_]{1,50})/giu;
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      fragment.append(document.createTextNode(value.slice(lastIndex, index)));
    }

    const token = match[0];
    const link = el("a", "fk-inline-link");
    if (token.startsWith("@")) {
      const handle = token.slice(1);
      link.href = `/user/${encodeURIComponent(handle)}`;
      link.dataset.mention = handle;
    } else {
      const tag = token.slice(1);
      link.href = `/?q=${encodeURIComponent(token)}`;
      link.dataset.hashtag = tag;
    }
    link.textContent = token;
    fragment.append(link);
    lastIndex = index + token.length;
  }

  if (lastIndex < value.length) {
    fragment.append(document.createTextNode(value.slice(lastIndex)));
  }
  return fragment;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function actionButton(
  action: string,
  icon: string,
  label: string,
  count: number,
): HTMLButtonElement {
  const btn = el("button", "fk-action");
  btn.type = "button";
  btn.dataset.action = action;
  btn.dataset.count = String(count);
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = `${icon}<span class="fk-action-count"></span>`;
  btn.querySelector(".fk-action-count")!.textContent =
    count > 0 ? fmtCount(count) : "";
  return btn;
}

export function followButton(post: Post): HTMLButtonElement {
  const button = el("button", "fk-follow-btn");
  button.type = "button";
  button.dataset.handle = post.author.handle;
  button.hidden = Boolean(post.viewer?.isAuthor);
  setFollowButtonState(button, Boolean(post.viewer?.followingAuthor));
  return button;
}

export function setFollowButtonState(
  button: HTMLButtonElement,
  following: boolean,
): void {
  button.dataset.following = String(following);
  button.textContent = following ? "已关注" : "关注";
  button.classList.toggle("is-following", following);
}

export function postHead(post: Post, timeMode: "relative" | "absolute") {
  const head = el("header", "fk-post-head");
  const name = el("span", "fk-post-name");
  name.textContent = post.author.name;
  head.append(name);
  if (post.author.verified)
    head.insertAdjacentHTML("beforeend", ICONS.verified);
  const meta = el("span", "fk-post-meta");
  meta.textContent = `@${post.author.handle} · ${
    timeMode === "relative"
      ? relativeTime(post.createdAt)
      : new Date(post.createdAt).toLocaleString("zh-CN")
  }`;
  head.append(meta);
  head.append(followButton(post));
  return head;
}

export function postMedia(post: Post): HTMLElement {
  const media = post.media;
  if (!media) return el("div");
  const node = el("div", "fk-media");
  const image = el("img", "fk-media-image");
  image.src = media.url.startsWith("/") ? apiEndpoint(media.url) : media.url;
  image.alt = media.alt;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  node.append(image);
  return node;
}

export function authorAvatar(
  handle: string,
  name: string,
  className = "fk-avatar",
  avatarUrl?: string | null,
): HTMLAnchorElement {
  const avatar = el("a", `${className} fk-avatar-link`);
  avatar.dataset.handle = handle;
  avatar.href = `/user/${encodeURIComponent(handle)}`;
  avatar.setAttribute("style", avatarGradient(handle));
  const image = el("img", "fk-avatar-image");
  image.src =
    avatarUrl && avatarUrl.startsWith("/")
      ? apiEndpoint(avatarUrl)
      : avatarUrl || "/user.avif";
  image.alt = name;
  image.loading = "lazy";
  image.decoding = "async";
  avatar.append(image);
  avatar.title = `查看 @${handle} 的主页`;
  avatar.setAttribute("aria-label", `查看 ${name}（@${handle}）的主页`);
  return avatar;
}

export function renderPost(post: Post): HTMLElement {
  const article = el("article", "fk-post");
  article.dataset.postId = post.id;
  article.dataset.handle = post.author.handle;

  const avatar = authorAvatar(
    post.author.handle,
    post.author.name,
    "fk-avatar",
    post.author.avatarUrl,
  );

  const body = el("div", "fk-post-body");
  body.append(postHead(post, "relative"));

  const text = el("p", "fk-post-text");
  text.append(renderRichText(post.text));
  body.append(text);

  if (post.media) body.append(postMedia(post));

  const actions = el("footer", "fk-actions");
  actions.append(
    actionButton("reply", ICONS.reply, "回帖", post.stats.replies),
    actionButton("repost", ICONS.repost, "转发", post.stats.reposts),
    actionButton("like", ICONS.heart, "喜欢", post.stats.likes),
    actionButton("save", ICONS.bookmark, "收藏", 0),
    actionButton("share", ICONS.share, "分享", 0),
    actionButton("copy", ICONS.copy, "复制链接", 0),
  );
  if (post.viewer?.isAuthor) {
    const edit = actionButton("edit", ICONS.edit, "编辑", 0);
    const remove = actionButton("delete", ICONS.trash, "删除", 0);
    remove.classList.add("is-danger");
    actions.append(edit, remove);
  }
  if (post.viewer?.reposted) {
    actions
      .querySelector<HTMLElement>('[data-action="repost"]')
      ?.classList.add("is-reposted");
  }
  if (post.viewer?.liked) {
    actions
      .querySelector<HTMLElement>('[data-action="like"]')
      ?.classList.add("is-liked");
  }
  if (post.viewer?.saved) {
    actions
      .querySelector<HTMLElement>('[data-action="save"]')
      ?.classList.add("is-saved");
  }

  body.append(actions);
  article.append(avatar, body);
  return article;
}

export function renderPostDetail(post: Post): HTMLElement {
  const article = el("article", "fk-post-detail fk-post-content-only");
  article.dataset.postId = post.id;

  const body = el("div", "fk-post-body");

  const text = el("p", "fk-post-text");
  text.append(renderRichText(post.text));
  body.append(text);

  if (post.media) body.append(postMedia(post));

  article.append(body);
  return article;
}

export function statusRow(message: string): HTMLElement {
  const row = el("div", "fk-status");
  row.textContent = message;
  return row;
}

let toastTimer: number | undefined;

export function showToast(message: string): void {
  let toast = document.querySelector<HTMLElement>("[data-fk-toast]");
  if (!toast) {
    toast = el("div", "fk-toast");
    toast.dataset.fkToast = "";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast?.classList.remove("is-visible");
  }, 1800);
}
