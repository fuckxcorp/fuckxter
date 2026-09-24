import type { Env, HtmlRewriterConstructor } from "../shared/platform";
import { getOptionalUser } from "../accounts/security";
import { countUnreadMessages, listConversations } from "./messages";

declare const HTMLRewriter: HtmlRewriterConstructor;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function apiUrl(value: string | null | undefined): string {
  if (!value) return "/user.avif";
  return value.startsWith("/") ? `https://api.fuckxter.site${value}` : value;
}

export async function withMessagesPageHtml(
  request: Request,
  env: Env,
  response: Response,
): Promise<Response> {
  if (request.method !== "GET") return response;
  try {
    const user = await getOptionalUser(request, env);
    if (!user) return response;
    const [threads, unread] = await Promise.all([
      listConversations(env, user.id),
      countUnreadMessages(env, user.id),
    ]);
    const summary =
      unread > 0
        ? `${threads.length} 个会话 · ${unread} 条未读`
        : `${threads.length} 个会话`;
    const rows = threads
      .map((thread) => {
        const other = thread.other;
        const preview = thread.lastMessage
          ? `${thread.lastMessage.mine ? "我：" : ""}${thread.lastMessage.body}`
          : "还没有消息";
        return `<a class="thread${thread.unread > 0 ? " is-unread" : ""}" href="/messages/${encodeURIComponent(other.handle)}" data-handle="${escapeHtml(other.handle)}"><span class="avatar thread-avatar"><img class="avatar-image" src="${escapeHtml(apiUrl(other.avatarUrl))}" alt="${escapeHtml(other.name)}" loading="lazy" decoding="async"></span><span class="thread-body"><span class="thread-top"><strong>${escapeHtml(other.name)}</strong><small>@${escapeHtml(other.handle)}</small><time datetime="${escapeHtml(thread.lastMessage?.createdAt ?? thread.lastMessageAt)}"></time></span><span class="thread-preview">${escapeHtml(preview)}</span></span>${thread.unread > 0 ? `<span class="thread-unread">${thread.unread}</span>` : ""}</a>`;
      })
      .join("");
    const transformed = new HTMLRewriter()
      .on('[data-role="threads-summary"]', {
        element(element) {
          element.setInnerContent(summary);
        },
      })
      .on('[data-role="thread-list"]', {
        element(element) {
          element.setAttribute("data-ssr", "true");
          element.setInnerContent(rows, { html: true });
        },
      })
      .on('[data-role="threads-empty"]', {
        element(element) {
          if (threads.length === 0) element.removeAttribute("hidden");
        },
      })
      .transform(response);
    const headers = new Headers(transformed.headers);
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("CDN-Cache-Control", "no-store");
    headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    headers.set("Vary", "Cookie");
    return new Response(transformed.body, {
      status: transformed.status,
      statusText: transformed.statusText,
      headers,
    });
  } catch (error) {
    console.error("Messages page render failed", error);
    return response;
  }
}
