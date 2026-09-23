import { hidePanel, showPanel } from "./dom";
import type { Post } from "../core/types";
import { postPath } from "../core/urls";

export type ShareResult = "shared" | "copied" | "cancelled";
export type ShareMenuResult = ShareResult | "failed";

function postUrl(post: Post): string {
  return `${location.origin}${postPath(post)}`;
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("剪贴板不可用。");
  await navigator.clipboard.writeText(value);
}

export async function copyPostLink(post: Post): Promise<"copied"> {
  await copyText(postUrl(post));
  return "copied";
}

export async function sharePost(post: Post): Promise<ShareResult> {
  const url = postUrl(post);
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

function shareMenuButton(
  label: string,
  description: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item share-menu-item";
  button.setAttribute("role", "menuitem");

  const strong = document.createElement("strong");
  strong.textContent = label;
  const small = document.createElement("span");
  small.textContent = description;
  button.append(strong, small);
  return button;
}

export function openPostShareMenu(
  anchor: HTMLElement,
  post: Post,
): Promise<ShareMenuResult> {
  return new Promise((resolve) => {
    document.querySelector("[data-share-menu]")?.remove();

    const menu = document.createElement("div");
    menu.className = "submenu share-menu";
    menu.dataset.shareMenu = "";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "分享帖子");
    menu.hidden = true;
    anchor.setAttribute("aria-expanded", "true");

    const canUseSystemShare =
      typeof (navigator as Navigator & { share?: unknown }).share ===
      "function";

    const systemShare = shareMenuButton(
      "系统分享",
      canUseSystemShare ? "打开设备的分享面板" : "当前浏览器不支持",
    );
    systemShare.disabled = !canUseSystemShare;
    const copyLink = shareMenuButton("复制链接", "复制这条帖子的网址");
    menu.append(systemShare, copyLink);
    document.body.append(menu);
    showPanel(menu);

    const placeMenu = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - menu.offsetWidth - margin),
      );
      const below = rect.bottom + margin;
      const top =
        below + menu.offsetHeight <= window.innerHeight - margin
          ? below
          : Math.max(margin, rect.top - menu.offsetHeight - margin);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    requestAnimationFrame(placeMenu);

    let settled = false;
    const finish = (result: ShareMenuResult) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      anchor.removeAttribute("aria-expanded");
      hidePanel(menu);
      window.setTimeout(() => {
        menu.remove();
        resolve(result);
      }, 360);
    };
    const onViewportChange = () => finish("cancelled");
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) finish("cancelled");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish("cancelled");
    };

    const choose = async (action: "share" | "copy") => {
      systemShare.disabled = true;
      copyLink.disabled = true;
      try {
        finish(
          action === "share" ? await sharePost(post) : await copyPostLink(post),
        );
      } catch {
        finish("failed");
      }
    };

    systemShare.addEventListener("click", () => void choose("share"));
    copyLink.addEventListener("click", () => void choose("copy"));
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    requestAnimationFrame(() =>
      systemShare.disabled ? copyLink.focus() : systemShare.focus(),
    );
  });
}
