import { quotePost as publishQuote } from "../accounts/api";
import { getAccount, requestAuthentication } from "../accounts/auth";
import { postPath } from "../core/urls";
import type { Post } from "../core/types";
import { el, renderRichText, showToast } from "./dom";

export type RepostMenuResult = "repost" | "quote" | "cancelled";

export function openPostRepostMenu(
  anchor: HTMLElement,
  reposted: boolean,
): Promise<RepostMenuResult> {
  return new Promise((resolve) => {
    document.querySelector("[data-repost-menu]")?.remove();

    const menu = el("div", "submenu share-menu");
    menu.dataset.repostMenu = "";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "转发帖子");
    menu.hidden = true;
    anchor.setAttribute("aria-expanded", "true");

    const choice = (label: string, description: string) => {
      const button = el("button", "menu-item share-menu-item");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      const strong = el("strong");
      strong.textContent = label;
      const small = el("span");
      small.textContent = description;
      button.append(strong, small);
      return button;
    };
    const direct = choice(
      reposted ? "取消转发" : "直接转发",
      reposted ? "从你的动态中移除" : "立即转发到你的动态",
    );
    const quote = choice("评论并转发", "添加评论后再发布");
    menu.append(direct, quote);
    document.body.append(menu);
    menu.hidden = false;

    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${
      rect.bottom + menu.offsetHeight + 8 <= innerHeight
        ? rect.bottom + 8
        : Math.max(8, rect.top - menu.offsetHeight - 8)
    }px`;

    let settled = false;
    const finish = (result: RepostMenuResult) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("scroll", cancel, true);
      anchor.removeAttribute("aria-expanded");
      menu.remove();
      resolve(result);
    };
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) finish("cancelled");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish("cancelled");
    };
    const cancel = () => finish("cancelled");
    direct.addEventListener("click", () => finish("repost"));
    quote.addEventListener("click", () => finish("quote"));
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", cancel);
    window.addEventListener("scroll", cancel, true);
    direct.focus();
  });
}

export function quotePost(post: Post): Promise<Post | null> {
  if (!getAccount()) {
    requestAuthentication();
    return Promise.resolve(null);
  }
  if (post.visibility && post.visibility !== "public") {
    showToast("只有公开帖子可以转发。");
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const dialog = el("dialog", "quote-dialog");
    const title = el("h2");
    title.textContent = "转发并评论";
    const form = el("form");
    const preview = el("blockquote", "quote-preview");
    const author = el("strong");
    author.textContent = `${post.author.name} @${post.author.handle}`;
    const excerpt =
      [...post.text].slice(0, 500).join("") +
      ([...post.text].length > 500 ? "…" : "");
    const text = el("p");
    text.append(renderRichText(excerpt));
    const source = el("a", "inline-link");
    source.href = new URL(postPath(post), location.origin).href;
    source.textContent = "查看原帖 ↗";
    preview.append(author, text, source);
    const input = el("textarea");
    input.rows = 3;
    input.placeholder = "写下你的评论（可选）";
    input.setAttribute("aria-label", "转发评论");
    input.maxLength = 1000;
    const status = el("p", "status");
    status.setAttribute("aria-live", "polite");
    const foot = el("div", "quote-dialog-actions");
    const cancel = el("button", "ghost-btn");
    cancel.type = "button";
    cancel.textContent = "取消";
    const send = el("button", "primary-btn");
    send.type = "submit";
    send.textContent = "发布转发";
    let busy = false;
    let created: Post | null = null;
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", (event) => {
      if (busy) event.preventDefault();
    });
    const onSwap = () => {
      if (dialog.open) dialog.close();
    };
    dialog.addEventListener(
      "close",
      () => {
        document.removeEventListener("astro:before-swap", onSwap);
        dialog.remove();
        resolve(created);
      },
      { once: true },
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      send.disabled = cancel.disabled = true;
      input.disabled = true;
      status.textContent = "正在发布…";
      try {
        const note = input.value.trim();
        created = await publishQuote(post.id, note);
        showToast("已发布转发，原帖链接已保留。");
        dialog.close();
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "发布失败，请重试。";
      } finally {
        busy = false;
        send.disabled = cancel.disabled = input.disabled = false;
      }
    });
    document.addEventListener("astro:before-swap", onSwap, { once: true });
    foot.append(cancel, send);
    form.append(preview, input, status, foot);
    dialog.append(title, form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
