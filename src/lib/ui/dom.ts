import type { Post } from "../core/types";
import { apiEndpoint } from "../core/http";

export const ICONS = {
  reply:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="2.2" aria-hidden="true"><path d="M3.5 3.5h16v11H10.5L5.5 20.5v-6h-2z"></path></svg>',
  repost:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="2.2" aria-hidden="true"><path d="M16 2.5 21 7.5 16 12.5"></path><path d="M3.5 10.5V6.5h17.5"></path><path d="M8 21.5 3 16.5 8 11.5"></path><path d="M20.5 13.5v4H3"></path></svg>',
  heart:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="2.2" aria-hidden="true"><path d="M12 20.5 3.5 12 3.5 7.2 8 3.5 12 7.2 16 3.5 20.5 7.2 20.5 12Z"></path></svg>',
  share:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M16 6l-4-4-4 4"></path><path d="M12 2v13"></path></svg>',
  copy: '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
  quote:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h11v11H4z"></path><path d="M10 19h10V9"></path><path d="m16 5 4 4-4 4"></path></svg>',
  bookmark:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
  edit: '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z"></path></svg>',
  trash:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 15H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
  verified:
    '<svg class="verified" viewBox="0 0 24 24" aria-label="认证账号" role="img"><path fill="currentColor" d="M12 1.5l2.6 2 3.2-.4 1.2 3 3 1.2-.4 3.2 2 2.5-2 2.5.4 3.2-3 1.2-1.2 3-3.2-.4-2.6 2-2.6-2-3.2.4-1.2-3-3-1.2.4-3.2-2-2.5 2-2.5-.4-3.2 3-1.2 1.2-3 3.2.4z"></path><path class="verified-check" d="M10.7 15.9l-3-3 1.3-1.3 1.7 1.7 4.3-4.3 1.3 1.3z"></path></svg>',
};

const AVATAR_GRADIENTS: [number, number][] = [
  [24, 334],
  [258, 231],
  [190, 218],
  [160, 174],
  [348, 330],
  [38, 28],
];

export function avatarGradient(handle: string): string {
  const hash = [...handle].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return `background-image: linear-gradient(115deg, hsl(${from} 44% 72%), hsl(${to} 48% 58%), hsl(${from} 38% 66%)); background-size: 220% 100%;`;
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

export function collapseSubmenus(
  scope: ParentNode,
  except?: HTMLElement | null,
): void {
  scope.querySelectorAll<HTMLElement>(".submenu").forEach((submenu) => {
    if (submenu === except || submenu.hidden) return;
    hidePanel(submenu);
    submenu.parentElement
      ?.querySelector<HTMLElement>(".menu-expandable")
      ?.setAttribute("aria-expanded", "false");
  });
}

const PANEL_EXIT_MS = 360;
const closingTimers = new WeakMap<HTMLElement, number>();

export function showPanel(panel: HTMLElement): void {
  const timer = closingTimers.get(panel);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    closingTimers.delete(panel);
  }
  panel.classList.remove("is-closing");
  panel.hidden = false;
}

export function isPanelOpen(panel: HTMLElement): boolean {
  return !panel.hidden && !panel.classList.contains("is-closing");
}

export function hidePanel(panel: HTMLElement): void {
  if (panel.hidden || closingTimers.has(panel)) return;
  panel.classList.add("is-closing");
  const timer = window.setTimeout(() => {
    closingTimers.delete(panel);
    panel.classList.remove("is-closing");
    panel.hidden = true;
  }, PANEL_EXIT_MS);
  closingTimers.set(panel, timer);
}

export function renderRichText(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  // fk:// 是发帖时用来禁止自动链接的转义前缀：
  // fk://https://example.com 会展示为 https://example.com，但保持纯文本。
  const pattern =
    /(fk:\/\/https?:\/\/[^\s<>"']+|https?:\/\/[^\s<>"']+|@[a-z0-9_]{2,20}|#[\p{L}\p{N}_]{1,50})/giu;
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      fragment.append(document.createTextNode(value.slice(lastIndex, index)));
    }

    let token = match[0];
    // 句尾标点不应成为 URL 的一部分，例如“见 https://example.com。”
    const trailing =
      token.match(/[.,!?;:，。！？；：)}\]》”’"']+$/u)?.[0] ?? "";
    if (trailing) token = token.slice(0, -trailing.length);
    if (!token) {
      fragment.append(document.createTextNode(match[0]));
      lastIndex = index + match[0].length;
      continue;
    }

    if (token.startsWith("fk://")) {
      fragment.append(document.createTextNode(token.slice("fk://".length)));
      if (trailing) fragment.append(document.createTextNode(trailing));
      lastIndex = index + match[0].length;
      continue;
    }

    const link = el("a", "inline-link");
    if (token.startsWith("http://") || token.startsWith("https://")) {
      link.href = token;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else if (token.startsWith("@")) {
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
    if (trailing) fragment.append(document.createTextNode(trailing));
    lastIndex = index + match[0].length;
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
  const btn = el("button", "action");
  btn.type = "button";
  btn.dataset.action = action;
  btn.dataset.count = String(count);
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = `${icon}<span class="action-count"></span>`;
  btn.querySelector(".action-count")!.textContent =
    count > 0 ? fmtCount(count) : "";
  return btn;
}

export function followButton(post: Post): HTMLButtonElement {
  const button = el("button", "follow-btn");
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

export function postMetaText(
  post: Post,
  timeMode: "relative" | "absolute",
): string {
  const stamp =
    timeMode === "relative"
      ? relativeTime(post.createdAt)
      : new Date(post.createdAt).toLocaleString("zh-CN");
  const views = post.stats.views ?? 0;
  return `@${post.author.handle} · ${stamp}${
    views > 0 ? ` · ${fmtCount(views)} 次浏览` : ""
  }`;
}

export function postHead(post: Post, timeMode: "relative" | "absolute") {
  const head = el("header", "post-head");
  const name = el("span", "post-name");
  name.textContent = post.author.name;
  head.append(name);
  if (post.author.verified)
    head.insertAdjacentHTML("beforeend", ICONS.verified);
  const meta = el("span", "post-meta");
  meta.textContent = postMetaText(post, timeMode);
  head.append(meta);

  if (post.visibility && post.visibility !== "public") {
    const label = el("span", "post-visibility");
    label.textContent = post.visibility === "private" ? "私密贴" : "仅互关可见";
    head.append(label);
  }
  head.append(followButton(post));
  return head;
}

export function postMedia(post: Post): HTMLElement {
  const list = el("div", "media-list");
  for (const media of post.media ?? []) {
    const node = el("div", media.hdr ? "media is-hdr" : "media");
    const image = el("img", "media-image");
    image.src = media.url.startsWith("/") ? apiEndpoint(media.url) : media.url;
    image.alt = media.alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.fetchPriority = "low";
    image.referrerPolicy = "no-referrer";
    const size = () => {
      const landscape = image.naturalWidth >= image.naturalHeight;
      const maxWidth = landscape ? 520 : 320;
      const maxHeight = landscape ? 360 : 480;
      const scale = Math.min(
        1,
        maxWidth / image.naturalWidth,
        maxHeight / image.naturalHeight,
      );
      node.classList.toggle("is-landscape", landscape);
      node.classList.toggle("is-portrait", !landscape);
      node.style.setProperty(
        "--media-ratio",
        `${image.naturalWidth} / ${image.naturalHeight}`,
      );
      node.style.setProperty(
        "--media-width",
        `${image.naturalWidth * scale}px`,
      );
    };
    image.addEventListener("load", size, { once: true });
    if (image.complete) size();
    node.append(image);
    if (media.hdr) {
      const badge = el("span", "media-hdr-badge");
      badge.textContent = "HDR";
      badge.title = "这条图片按 HDR 显示：在支持 HDR 的屏幕上不做 SDR 压暗";
      node.append(badge);
    }
    list.append(node);
  }
  if ((post.media?.length ?? 0) < 2) return list;

  const strip = el("div", "media-strip");
  const previous = el("button", "media-scroll is-previous");
  const next = el("button", "media-scroll is-next");
  previous.type = next.type = "button";
  previous.textContent = "‹";
  next.textContent = "›";
  previous.setAttribute("aria-label", "查看前面的图片");
  next.setAttribute("aria-label", "查看更多图片");
  const sync = () => {
    previous.hidden = list.scrollLeft <= 1;
    next.hidden = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
  };
  const scroll = (direction: number) => {
    list.scrollBy({
      left: direction * list.clientWidth * 0.8,
      behavior: "smooth",
    });
  };
  previous.addEventListener("click", (event) => {
    event.stopPropagation();
    scroll(-1);
  });
  next.addEventListener("click", (event) => {
    event.stopPropagation();
    scroll(1);
  });
  list.addEventListener("scroll", sync, { passive: true });
  list.addEventListener("load", sync, true);
  strip.append(list, previous, next);
  requestAnimationFrame(sync);
  return strip;
}

export function authorAvatar(
  handle: string,
  name: string,
  className = "avatar",
  avatarUrl?: string | null,
): HTMLAnchorElement {
  const avatar = el("a", `${className} avatar-link`);
  avatar.dataset.handle = handle;
  avatar.href = `/user/${encodeURIComponent(handle)}`;
  avatar.setAttribute("style", avatarGradient(handle));
  const fallback = el("span", "avatar-fallback");
  fallback.textContent = [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const image = el("img", "avatar-image");
  image.src =
    avatarUrl && avatarUrl.startsWith("/")
      ? apiEndpoint(avatarUrl)
      : avatarUrl || "/user.avif";
  image.alt = name;
  image.loading = "lazy";
  image.decoding = "async";
  image.fetchPriority = "low";
  avatar.append(fallback, image);
  avatar.title = `查看 @${handle} 的主页`;
  avatar.setAttribute("aria-label", `查看 ${name}（@${handle}）的主页`);
  return avatar;
}

export function postShard(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String(Math.abs(hash) % 8);
}

export function renderPost(post: Post): HTMLElement {
  const article = el("article", "post");
  article.dataset.postId = post.id;
  article.dataset.handle = post.author.handle;

  const avatar = authorAvatar(
    post.author.handle,
    post.author.name,
    "avatar",
    post.author.avatarUrl,
  );

  const body = el("div", "post-body");
  body.append(postHead(post, "relative"));

  const text = el("p", "post-text");
  text.append(renderRichText(post.text));
  body.append(text);

  if (post.media?.length) body.append(postMedia(post));

  const actions = el("footer", "actions");
  actions.append(
    actionButton("reply", ICONS.reply, "回帖", post.stats.replies),
    actionButton("repost", ICONS.repost, "转发", post.stats.reposts),
    actionButton("like", ICONS.heart, "喜欢", post.stats.likes),
    actionButton("save", ICONS.bookmark, "收藏", 0),
    actionButton("share", ICONS.share, "分享", 0),
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

export function statusRow(message: string): HTMLElement {
  const row = el("div", "status");
  row.textContent = message;
  return row;
}

let toastTimer: number | undefined;

export function showToast(message: string): void {
  let toast = document.querySelector<HTMLElement>("[data-toast]");
  if (!toast) {
    toast = el("div", "toast");
    toast.dataset.toast = "";
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
