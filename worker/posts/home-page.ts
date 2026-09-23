import type { Env, HtmlRewriterConstructor } from "../shared/platform";
import { getTimeline } from "./posts";

declare const HTMLRewriter: HtmlRewriterConstructor;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function apiUrl(value: string): string {
  return value.startsWith("/") ? `https://api.fuckxter.site${value}` : value;
}

type Post = Awaited<ReturnType<typeof getTimeline>>["posts"][number];

function renderPost(post: Post): string {
  const handle = escapeHtml(post.author.handle);
  const avatar = post.author.avatarUrl
    ? apiUrl(post.author.avatarUrl)
    : "/user.avif";
  const initial = [...post.author.name.trim()][0]?.toLocaleUpperCase() ?? "?";
  const media = post.media
    ? `<div class="media${post.media.hdr ? " is-hdr" : ""}"><img class="media-image" src="${escapeHtml(apiUrl(post.media.url))}" alt="${escapeHtml(post.media.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`
    : "";
  return [
    `<article class="post shard" data-post-id="${escapeHtml(post.id)}" data-handle="${handle}">`,
    `<a class="avatar avatar-link" data-handle="${handle}" href="/user/${encodeURIComponent(post.author.handle)}">`,
    `<span class="avatar-fallback">${escapeHtml(initial)}</span>`,
    `<img class="avatar-image" src="${escapeHtml(avatar)}" alt="${escapeHtml(post.author.name)}" loading="lazy" decoding="async">`,
    `</a>`,
    `<div class="post-body">`,
    `<header class="post-head"><span class="post-name">${escapeHtml(post.author.name)}</span><span class="post-meta">@${handle}</span></header>`,
    `<p class="post-text">${escapeHtml(post.text)}</p>`,
    media,
    `<footer class="actions" aria-hidden="true"></footer>`,
    `</div>`,
    `</article>`,
  ].join("");
}

export async function withHomePageHtml(
  request: Request,
  env: Env,
  response: Response,
): Promise<Response> {
  if (request.method !== "GET") return response;
  try {
    const page = await getTimeline(env, null, "foryou", null, "10");
    if (page.posts.length === 0) return response;
    const columns = ["", ""];
    page.posts.forEach((post, index) => {
      columns[index % columns.length] += renderPost(post);
    });
    const html = `<div class="feed-columns is-masonry"><div class="feed-col">${columns[0]}</div><div class="feed-col">${columns[1]}</div></div>`;
    return new HTMLRewriter()
      .on(".feed", {
        element(element) {
          element.setInnerContent(html, { html: true });
        },
      })
      .transform(response);
  } catch (error) {
    console.error("Home page render failed", error);
    return response;
  }
}
