import type { Env, HtmlRewriterConstructor } from "../shared/platform";
import { getPostsByUser } from "../posts/posts";
import { getUserProfile } from "./users";

declare const HTMLRewriter: HtmlRewriterConstructor;

const PATH = /^\/user\/([^/]+)\/?$/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absolute(value: string | null | undefined): string {
  if (!value) return "/user.avif";
  return value.startsWith("/") ? `https://api.fuckxter.site${value}` : value;
}

function textHtml(value: string): string {
  const pattern = /(fk:\/\/https?:\/\/[^\s<>"']+|https?:\/\/[^\s<>"']+)/giu;
  let last = 0;
  let html = "";
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(value.slice(last, index));
    const token = match[0];
    html += token.startsWith("fk://")
      ? escapeHtml(token.slice(5))
      : `<a class="inline-link" href="${escapeHtml(token)}">${escapeHtml(token)}</a>`;
    last = index + token.length;
  }
  return html + escapeHtml(value.slice(last));
}

function postPath(post: { author: { handle: string }; slug: string }): string {
  return `/post/${encodeURIComponent(post.author.handle)}/${encodeURIComponent(post.slug)}`;
}

function renderMedia(
  media: Array<{ url: string; alt: string; hdr?: boolean }> | undefined,
): string {
  if (!media?.length) return "";
  return `<div class="media-list${media.length > 3 ? " is-scrollable" : ""}">${media
    .map(
      (item) =>
        `<div class="media${item.hdr ? " is-hdr" : ""}"><img class="media-image" src="${escapeHtml(absolute(item.url))}" alt="${escapeHtml(item.alt)}" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">${item.hdr ? '<span class="media-hdr-badge">HDR</span>' : ""}</div>`,
    )
    .join("")}</div>`;
}

type Post = Awaited<ReturnType<typeof getPostsByUser>>[number];
type Profile = NonNullable<Awaited<ReturnType<typeof getUserProfile>>>;

function renderPost(post: Post): string {
  const href = postPath(post);
  const initial = [...post.author.name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const views = post.stats.views ? ` · ${post.stats.views} 次浏览` : "";
  return [
    `<article class="post user-post-link" data-post-id="${escapeHtml(post.id)}" data-handle="${escapeHtml(post.author.handle)}" tabindex="0" role="link" aria-label="打开这条帖子">`,
    `<a class="post-permalink" href="${escapeHtml(href)}" data-astro-prefetch aria-label="打开 ${escapeHtml(post.author.name)} 的帖子"><span class="sr-only">查看帖子</span></a>`,
    `<a class="avatar avatar-link" data-handle="${escapeHtml(post.author.handle)}" href="/user/${encodeURIComponent(post.author.handle)}"><span class="avatar-fallback">${escapeHtml(initial)}</span><img class="avatar-image" src="${escapeHtml(absolute(post.author.avatarUrl))}" alt="${escapeHtml(post.author.name)}" loading="lazy" decoding="async" fetchpriority="low"></a>`,
    `<div class="post-body"><header class="post-head"><span class="post-name">${escapeHtml(post.author.name)}</span><span class="post-meta">@${escapeHtml(post.author.handle)} · ${escapeHtml(new Date(post.createdAt).toLocaleString("zh-CN"))}${views}</span></header>`,
    post.repostKind === "repost"
      ? `<div class="post-source">${post.source ? textHtml(post.source.text) : "原帖已不可用。"}</div>`
      : `<p class="post-text">${textHtml(post.text)}</p>${renderMedia(post.media)}`,
    `<footer class="actions"><a class="action" href="${escapeHtml(href)}#reply" aria-label="回帖"><span class="action-count">${post.stats.replies || ""}</span></a><span class="action" aria-label="转发"><span class="action-count">${post.stats.reposts || ""}</span></span><span class="action" aria-label="喜欢"><span class="action-count">${post.stats.likes || ""}</span></span><a class="action" href="${escapeHtml(href)}" aria-label="查看帖子"><span class="action-count"></span></a></footer></div>`,
    `</article>`,
  ].join("");
}

function chip(role: string, label: string, value: string): string {
  return `<span class="user-chip" data-role="user-chip-${role}"${value ? "" : " hidden"}><span class="user-chip-label">${label}</span><span class="user-chip-value" data-role="user-${role}">${escapeHtml(value)}</span></span>`;
}

function renderCard(profile: Profile): string {
  const initial = [...profile.name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const verified = profile.verified
    ? '<span data-role="user-verified"><svg class="verified" viewBox="0 0 24 24" aria-label="认证账号" role="img"><path fill="currentColor" d="M12 1.5l2.6 2 3.2-.4 1.2 3 3 1.2-.4 3.2 2 2.5-2 2.5.4 3.2-3 1.2-1.2 3-3.2-.4-2.6 2-2.6-2-3.2.4-1.2-3-3-1.2.4-3.2-2-2.5 2-2.5-.4-3.2 3-1.2 1.2-3 3.2.4z"></path><path class="verified-check" d="M10.7 15.9l-3-3 1.3-1.3 1.7 1.7 4.3-4.3 1.3 1.3z"></path></svg></span>'
    : '<span data-role="user-verified" hidden></span>';
  return [
    `<div class="user-row"><button type="button" class="user-avatar" data-role="user-avatar" data-handle="${escapeHtml(profile.handle)}" aria-label="放大 ${escapeHtml(profile.name)} 的头像" aria-haspopup="dialog"><span class="avatar-fallback" data-role="user-avatar-fallback">${escapeHtml(initial)}</span><img class="avatar-image" src="${escapeHtml(absolute(profile.avatarUrl))}" data-role="user-avatar-image" alt="${escapeHtml(profile.name)}" loading="eager" decoding="async"></button>`,
    `<div class="user-who"><div class="user-name-line"><strong data-role="user-name">${escapeHtml(profile.name)}</strong>${verified}</div><div class="user-handle" data-role="user-handle">@${escapeHtml(profile.handle)}</div><span class="user-deleted" data-role="user-deleted"${profile.deleted ? "" : " hidden"}>已删除账号</span></div></div>`,
    `<p class="user-bio" data-role="user-bio">${escapeHtml(profile.bio || "这个人很懒，什么都没有写。")}</p>`,
    `<div class="user-meta">${chip("gender", "性别", profile.gender)}${chip("region", "地区", profile.region)}${chip("birthday", "生日", profile.birthday)}${chip("created", "加入时间", new Date(profile.createdAt).toLocaleDateString("zh-CN"))}${chip("posts-count", "帖子", String(profile.stats.posts))}<a class="user-chip user-chip-action" data-role="user-chip-followers" href="/user/${encodeURIComponent(profile.handle)}/followers"><span class="user-chip-label">粉丝</span><span class="user-chip-value" data-role="user-followers">${profile.stats.followers}</span></a><a class="user-chip user-chip-action" data-role="user-chip-following" href="/user/${encodeURIComponent(profile.handle)}/following"><span class="user-chip-label">关注</span><span class="user-chip-value" data-role="user-following">${profile.stats.following}</span></a></div>`,
    `<div class="user-actions"><button type="button" class="primary-btn" data-role="user-edit" hidden>编辑资料</button><button type="button" class="primary-btn" data-role="user-follow" hidden>关注</button><button type="button" class="ghost-btn" data-role="user-message" hidden>私信</button><button type="button" class="ghost-btn block-btn" data-role="user-block" hidden>拉黑</button></div>`,
  ].join("");
}

export async function withUserPageHtml(
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
    const [profile, posts] = await Promise.all([
      getUserProfile(env, null, handle),
      getPostsByUser(env, null, handle),
    ]);
    if (!profile) return response;
    const title = `${profile.name}（@${profile.handle}）`;
    const description = profile.bio || `${profile.name} 的 FuckXter 个人主页`;
    const bootstrap = JSON.stringify({
      handle: profile.handle,
      profile,
      posts,
    }).replace(/</g, "\\u003c");
    const rendered = new HTMLRewriter()
      .on("title", {
        element(element) {
          element.setInnerContent(`${title} | FuckXter`);
        },
      })
      .on('meta[name="description"]', {
        element(element) {
          element.setAttribute("content", description);
        },
      })
      .on("head", {
        element(element) {
          element.append(
            `<meta property="og:type" content="profile"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><script type="application/json" data-user-bootstrap>${bootstrap}</script>`,
            { html: true },
          );
        },
      })
      .on('[data-role="user-card"]', {
        element(element) {
          element.setAttribute("aria-busy", "false");
          element.setInnerContent(renderCard(profile), { html: true });
        },
      })
      .on('[data-role="user-banner"]', {
        element(element) {
          if (!profile.headerUrl) return;
          element.removeAttribute("hidden");
          element.setInnerContent(
            `<div class="user-banner is-media-ready" data-role="user-banner-card"><img class="user-banner-image" data-role="user-banner-image" src="${escapeHtml(absolute(profile.headerUrl))}" alt="${escapeHtml(profile.name)} 的主页头图" loading="eager" decoding="async"></div>`,
            { html: true },
          );
        },
      })
      .on('[data-role="user-posts"]', {
        element(element) {
          element.setInnerContent(
            posts.length
              ? posts.map(renderPost).join("")
              : '<div class="status" data-role="user-post-empty">还没有发过帖子。</div>',
            { html: true },
          );
        },
      })
      .transform(response);
    const headers = new Headers(rendered.headers);
    headers.set("X-Fuckxter-SSR", "user");
    return new Response(rendered.body, {
      status: rendered.status,
      statusText: rendered.statusText,
      headers,
    });
  } catch (error) {
    console.error("User page render failed", error);
    return response;
  }
}
