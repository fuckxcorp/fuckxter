import type { Env, HtmlRewriterConstructor } from "../shared/platform";
import { getComments, getPostByPath } from "./posts";

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

function absolute(origin: string, value: string | null | undefined) {
  if (!value) return null;
  return value.startsWith("/") ? `${origin}${value}` : value;
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
type Comment = Awaited<ReturnType<typeof getComments>>["comments"][number];

/**
 * 边缘渲染帖子正文。
 * 结构、类名都跟前端 renderOriginPost 保持一致，
 * 客户端水合时整块替换，所以这里既是爬虫看到的内容，也是首屏内容。
 */
function renderOriginPost(post: Post): string {
  const avatar = post.author.avatarUrl ?? AVATAR_FALLBACK;
  const initial = [...post.author.name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const handle = escapeHtml(post.author.handle);

  const media = post.media
    ? `<div class="media"><img class="media-image" src="${escapeHtml(post.media.url)}" alt="${escapeHtml(post.media.alt)}" loading="eager" decoding="async" referrerpolicy="no-referrer"></div>`
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
    `<p class="thread-text">${escapeHtml(post.text)}</p>`,
    media,
    `</div>`,
    `</article>`,
  ].join("");
}

function renderComment(
  comment: Comment,
  children: Map<string, Comment[]>,
): string {
  const avatar = comment.author.avatarUrl ?? AVATAR_FALLBACK;
  const initial =
    [...comment.author.name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const handle = escapeHtml(comment.author.handle);
  const replies = children.get(comment.id) ?? [];
  const parent = comment.parent
    ? `<div class="reply-quote"><strong>回覆 @${escapeHtml(comment.parent.handle)}</strong><span>：${escapeHtml(excerpt(comment.parent.text, 40))}</span></div>`
    : "";
  const nested = replies.length
    ? `<div class="thread-children">${replies.map((reply) => renderComment(reply, children)).join("")}</div>`
    : "";

  return [
    `<article id="comment-${escapeHtml(comment.id)}" class="thread-post thread-reply shard" data-shard="${postShard(comment.id)}">`,
    `<span class="thread-kind">回帖</span>`,
    `<a class="avatar avatar-link" data-handle="${handle}" href="/user/${encodeURIComponent(comment.author.handle)}" title="查看 @${handle} 的主页">`,
    `<span class="avatar-fallback">${escapeHtml(initial)}</span>`,
    `<img class="avatar-image" src="${escapeHtml(avatar)}" alt="${escapeHtml(comment.author.name)}" loading="lazy" decoding="async" fetchpriority="low">`,
    `</a>`,
    `<div class="thread-body">`,
    `<header class="thread-meta"><div class="thread-who"><strong>${escapeHtml(comment.author.name)}</strong><span class="thread-handle">@${handle}</span></div><time datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(formatTime(comment.createdAt))}</time></header>`,
    parent,
    `<p class="thread-text">${escapeHtml(comment.text)}</p>`,
    `</div>`,
    nested,
    `</article>`,
  ].join("");
}

function renderComments(comments: Comment[], total: number): string {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const children = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  for (const comment of comments) {
    const parentId = comment.parent?.id;
    if (!parentId || !byId.has(parentId)) {
      roots.push(comment);
      continue;
    }
    const bucket = children.get(parentId) ?? [];
    bucket.push(comment);
    children.set(parentId, bucket);
  }
  const count =
    total > comments.length ? `${comments.length}/${total}` : String(total);
  const content = roots.length
    ? roots.map((comment) => renderComment(comment, children)).join("")
    : `<div class="comments-empty"><strong>还没有回帖</strong><span>来发布第一条回帖吧。</span></div>`;
  return `<section class="thread-replies"><header class="replies-head"><h2>回帖</h2><span>${count}</span></header><div class="comments-list thread-list">${content}</div></section>`;
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

    const comments = await getComments(env, null, post.id);
    const origin = url.origin;
    const title = `${post.author.name}：${excerpt(post.text, TITLE_EXCERPT) || "查看这条帖子"}`;
    const description =
      excerpt(post.text, DESCRIPTION_EXCERPT) || "查看这条帖子";
    const image =
      absolute(origin, post.media?.url) ??
      absolute(origin, post.author.avatarUrl) ??
      `${origin}${FALLBACK_IMAGE}`;
    const canonical = `${origin}${url.pathname}`;
    const card = post.media ? "summary_large_image" : "summary";

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
            element.replace(renderOriginPost(post), { html: true });
          },
        })
        .on(".thread-replies", {
          element(element) {
            element.replace(renderComments(comments.comments, comments.total), {
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
