import type { Env, HtmlRewriterConstructor } from "../shared/platform";
import { getFollowUsers } from "./users";

declare const HTMLRewriter: HtmlRewriterConstructor;

const PATH = /^\/user\/([^/]+)\/(followers|following)\/?$/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function apiUrl(value: string | null): string {
  if (!value) return "/user.avif";
  return value.startsWith("/") ? `https://api.fuckxter.site${value}` : value;
}

export async function withConnectionsPageHtml(
  request: Request,
  env: Env,
  url: URL,
  response: Response,
): Promise<Response> {
  if (request.method !== "GET") return response;
  const match = PATH.exec(url.pathname);
  if (!match) return response;
  try {
    const handle = decodeURIComponent(match[1]);
    const kind = match[2].toLowerCase() as "followers" | "following";
    const title = kind === "followers" ? "粉丝" : "关注";
    const users = await getFollowUsers(env, handle, kind);
    const rows = users.length
      ? users
          .map(
            (user) =>
              `<div class="user-list-item"><a class="avatar avatar-link" href="/user/${encodeURIComponent(user.handle)}" data-handle="${escapeHtml(user.handle)}"><img class="avatar-image" src="${escapeHtml(apiUrl(user.avatarUrl))}" alt="${escapeHtml(user.name)}" loading="lazy" decoding="async"></a><a class="user-list-identity" href="/user/${encodeURIComponent(user.handle)}"><strong>${escapeHtml(user.name)}</strong><span>@${escapeHtml(user.handle)}</span></a><div class="user-list-details"><p>${escapeHtml(user.bio || "这个人很懒，什么都没有写。")}</p><div class="user-list-stats"><span>帖子 ${user.stats.posts}</span><span>粉丝 ${user.stats.followers}</span><span>关注 ${user.stats.following}</span></div><time datetime="${escapeHtml(user.createdAt)}">加入于 ${escapeHtml(new Date(user.createdAt).toLocaleDateString("zh-CN"))}</time></div></div>`,
          )
          .join("")
      : `<p class="status">这里还没有用户。</p>`;
    return new HTMLRewriter()
      .on("title", {
        element(element) {
          element.setInnerContent(`${title} · @${handle} | FuckXter`);
        },
      })
      .on('[data-role="connections-title"]', {
        element(element) {
          element.setInnerContent(title);
        },
      })
      .on('[data-role="connections-summary"]', {
        element(element) {
          element.setInnerContent(`${users.length} 个用户`);
        },
      })
      .on('[data-role="connections-list"]', {
        element(element) {
          element.setAttribute("data-ssr", "true");
          element.setInnerContent(rows, { html: true });
        },
      })
      .transform(response);
  } catch (error) {
    console.error("Connections page render failed", error);
    return response;
  }
}
