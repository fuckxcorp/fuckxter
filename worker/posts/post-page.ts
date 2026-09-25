import type { Env, HtmlRewriterConstructor } from "../shared/platform";
import { getPostByPath } from "./posts";

declare const HTMLRewriter: HtmlRewriterConstructor;

const POST_PATH = /^\/post\/([^/]+)\/([^/]+)\/?$/i;
const TITLE_EXCERPT = 48;
const DESCRIPTION_EXCERPT = 180;
const FALLBACK_IMAGE = "/fuckxter_bk.avif";
const AVATAR_FALLBACK = "/user.avif";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function excerpt(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return [...flat].slice(0, max).join("");
}

/** 首屏 HTML 和客户端 renderRichText 使用同一套链接规则。 */
function renderPostText(value: string): string {
  const pattern = /(fk:\/\/https?:\/\/[^\s<>"']+|https?:\/\/[^\s<>"']+)/giu;
  let lastIndex = 0;
  let html = "";
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(value.slice(lastIndex, index));
    let token = match[0];
    const trailing =
      token.match(/[.,!?;:，。！？；：)}\]》”’"']+$/u)?.[0] ?? "";
    if (trailing) token = token.slice(0, -trailing.length);
    if (token.startsWith("fk://")) {
      html += escapeHtml(token.slice("fk://".length));
    } else {
      html += `<a class="inline-link" href="${escapeHtml(token)}" target="_blank" rel="noopener noreferrer">${escapeHtml(token)}</a>`;
    }
    html += escapeHtml(trailing);
    lastIndex = index + match[0].length;
  }
  return html + escapeHtml(value.slice(lastIndex));
}

function absolute(origin: string, value: string | null | undefined) {
  if (!value) return null;
  return value.startsWith("/") ? `${origin}${value}` : value;
}

function apiOrigin(url: URL): string {
  if (
    url.hostname === "fuckxter.site" ||
    url.hostname === "www.fuckxter.site"
  ) {
    return "https://api.fuckxter.site";
  }
  return url.origin;
}

/** 与前端 dom.ts 的 postShard 保持一致，水合时才不会跳版 */
function postShard(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String(Math.abs(hash) % 8);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      dateStyle: "long",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

type Post = NonNullable<Awaited<ReturnType<typeof getPostByPath>>>;

/**
 * 边缘渲染帖子正文。
 * 结构、类名都跟前端 renderOriginPost 保持一致，
 * 客户端水合时整块替换，所以这里既是爬虫看到的内容，也是首屏内容。
 */
function renderOriginPost(post: Post, origin: string): string {
  const avatar = post.author.avatarUrl ?? AVATAR_FALLBACK;
  const initial = [...post.author.name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const handle = escapeHtml(post.author.handle);

  const media = post.media?.length
    ? `<div class="media-list is-detail">${post.media
        .map(
          (item) =>
            `<div class="media${item.hdr ? " is-hdr" : ""}"><img class="media-image" src="${escapeHtml(absolute(origin, item.url) ?? item.url)}" alt="${escapeHtml(item.alt)}" loading="eager" decoding="async" referrerpolicy="no-referrer">${item.hdr ? '<span class="media-hdr-badge">HDR</span>' : ""}</div>`,
        )
        .join("")}</div>`
    : "";

  return [
    `<article class="thread-post thread-origin shard" data-shard="${postShard(post.id)}">`,
    `<span class="thread-kind">发起</span>`,
    `<a class="avatar avatar-link" data-handle="${handle}" href="/user/${encodeURIComponent(post.author.handle)}" title="查看 @${handle} 的主页" aria-label="查看 ${escapeHtml(post.author.name)}（@${handle}）的主页">`,
    `<span class="avatar-fallback">${escapeHtml(initial)}</span>`,
    `<img class="avatar-image" src="${escapeHtml(avatar)}" alt="${escapeHtml(post.author.name)}" loading="lazy" decoding="async">`,
    `</a>`,
    `<div class="thread-body">`,
    `<header class="thread-meta">`,
    `<div class="thread-who">`,
    `<strong>${escapeHtml(post.author.name)}</strong>`,
    `<span class="thread-handle">@${handle}</span>`,
    `</div>`,
    `<time datetime="${escapeHtml(post.createdAt)}">${escapeHtml(formatTime(post.createdAt))}</time>`,
    `</header>`,
    `<p class="thread-text">${renderPostText(post.text)}</p>`,
    media,
    `</div>`,
    `</article>`,
  ].join("");
}

/**
 * 首屏先给出完整的回复区域轮廓；客户端拿到会话后会接管成可提交的输入框。
 * 这样详情页不再先出现正文、过一会儿才突然插入回复框。
 */
function renderReplyComposer(post: Post): string {
  const inputId = `reply-${encodeURIComponent(post.id)}`;
  return [
    `<section class="thread-composer shard" data-shard="${postShard(`${post.id}:composer`)}" aria-busy="true">`,
    `<span class="avatar" aria-hidden="true"></span>`,
    `<div class="composer-body">`,
    `<textarea id="${escapeHtml(inputId)}" name="reply" class="comment-input side-comment-input reply-composer-input" rows="2" maxlength="1000" placeholder="正在加载" aria-label="回复内容" autocomplete="off" disabled></textarea>`,
    `<p class="thread-status" aria-live="polite"></p>`,
    `<div class="thread-composer-actions reply-composer-actions"><span class="comment-count">0 / 1000</span><button type="button" class="primary-btn comment-submit reply-submit" disabled>回复</button></div>`,
    `</div>`,
    `</section>`,
  ].join("");
}

const SIDE_ICONS = {
  reply:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3.5 3.5h16v11H10.5L5.5 20.5v-6h-2z"></path></svg>',
  repost:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M16 2.5 21 7.5 16 12.5"></path><path d="M3.5 10.5V6.5h17.5"></path><path d="M8 21.5 3 16.5 8 11.5"></path><path d="M20.5 13.5v4H3"></path></svg>',
  like: '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20.5 3.5 12 3.5 7.2 8 3.5 12 7.2 16 3.5 20.5 7.2 20.5 12Z"></path></svg>',
  share:
    '<svg class="action-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M16 6l-4-4-4 4"></path><path d="M12 2v13"></path></svg>',
};

function renderSide(post: Post, origin: string): string {
  const avatar = absolute(origin, post.author.avatarUrl) ?? AVATAR_FALLBACK;
  const initial = [...post.author.name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const count = (value: number) =>
    value > 0
      ? `<span class="action-count">${value}</span>`
      : '<span class="action-count"></span>';
  const action = (name: keyof typeof SIDE_ICONS, label: string, value = 0) =>
    `<button type="button" class="action" data-action="${name}" data-count="${value}" aria-label="${label}" title="${label}">${SIDE_ICONS[name]}${count(value)}</button>`;

  return [
    `<section class="post-info shard" data-shard="${postShard(`${post.id}:info`)}">`,
    `<h4 class="post-info-title">详情</h4>`,
    `<div class="post-info-author"><a class="avatar avatar-link" data-handle="${escapeHtml(post.author.handle)}" href="/user/${encodeURIComponent(post.author.handle)}"><span class="avatar-fallback">${escapeHtml(initial)}</span><img class="avatar-image" src="${escapeHtml(avatar)}" alt="${escapeHtml(post.author.name)}" loading="lazy" decoding="async"></a><div><strong>${escapeHtml(post.author.name)}</strong><small>@${escapeHtml(post.author.handle)}</small></div><button type="button" class="follow-btn" data-handle="${escapeHtml(post.author.handle)}" data-following="false">关注</button></div>`,
    `<dl class="post-info-rows"><dt>发布时间</dt><dd>${escapeHtml(formatTime(post.createdAt))}</dd><dt>帖子 ID</dt><dd>${escapeHtml(post.id)}</dd><dt>正文字数</dt><dd>${[...post.text].length} 字</dd><dt>互动数据</dt><dd>${post.stats.replies} 回帖 · ${post.stats.reposts} 转发 · ${post.stats.likes} 喜欢 · ${post.stats.views} 次浏览</dd></dl>`,
    `</section>`,
    `<section class="post-controls shard" data-shard="${postShard(`${post.id}:controls`)}"><h4 class="post-controls-title">互动</h4><div class="post-control-actions">${action("reply", "回帖", post.stats.replies)}${action("repost", "转发", post.stats.reposts)}${action("like", "喜欢", post.stats.likes)}${action("share", "分享")}</div></section>`,
    `<section class="hot-posts shard" data-shard="${postShard(`${post.id}:hot`)}"><h4 class="hot-title">热门帖子</h4><p class="hot-hint">按浏览热度排序</p><div class="hot-list"><div class="status">正在加载…</div></div></section>`,
  ].join("");
}

/**
 * 帖子页在边缘补全：
 * 1. head 里的 og:* / title / description（爬虫不跑 JS）
 * 2. 正文骨架换成真实内容（浏览器首屏直接看到帖子，不用等 JS）
 */
export async function withPostPageHtml(
  request: Request,
  env: Env,
  url: URL,
  response: Response,
): Promise<Response> {
  if (request.method !== "GET") return response;
  const match = POST_PATH.exec(url.pathname);
  if (!match) return response;

  let handle: string;
  let slug: string;
  try {
    handle = decodeURIComponent(match[1]);
    slug = decodeURIComponent(match[2]).toLowerCase();
  } catch {
    return response;
  }

  try {
    // 匿名视角：私密贴和仅互关可见的帖子查不到，不会漏进卡片或 HTML
    const post = await getPostByPath(env, null, handle, slug);
    if (!post) return response;

    const origin = url.origin;
    const mediaOrigin = apiOrigin(url);
    const title = `${post.author.name}：${excerpt(post.text, TITLE_EXCERPT) || "查看这条帖子"}`;
    const description =
      excerpt(post.text, DESCRIPTION_EXCERPT) || "查看这条帖子";
    const image =
      absolute(mediaOrigin, post.media?.[0]?.url) ??
      absolute(origin, post.author.avatarUrl) ??
      `${origin}${FALLBACK_IMAGE}`;
    const canonical = `${origin}${url.pathname}`;
    const card = post.media?.length ? "summary_large_image" : "summary";

    const tags = [
      `<meta property="og:type" content="article">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${escapeHtml(canonical)}">`,
      `<meta property="og:image" content="${escapeHtml(image)}">`,
      `<meta name="twitter:card" content="${card}">`,
      `<meta name="twitter:title" content="${escapeHtml(title)}">`,
      `<meta name="twitter:description" content="${escapeHtml(description)}">`,
      `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    ].join("");

    return (
      new HTMLRewriter()
        .on("title", {
          element(element) {
            element.setInnerContent(title);
          },
        })
        .on('meta[name="description"]', {
          element(element) {
            element.setAttribute("content", description);
          },
        })
        .on("head", {
          element(element) {
            element.append(tags, { html: true });
          },
        })
        // 骨架文章 → 真实帖子
        .on("article.post-skeleton", {
          element(element) {
            element.replace(
              `${renderOriginPost(post, mediaOrigin)}${renderReplyComposer(post)}`,
              {
                html: true,
              },
            );
          },
        })
        .on(".post-side", {
          element(element) {
            element.setInnerContent(renderSide(post, mediaOrigin), {
              html: true,
            });
          },
        })
        .transform(response)
    );
  } catch (error) {
    // 渲染失败不能连累页面本身
    console.error("Post page render failed", error);
    return response;
  }
}
