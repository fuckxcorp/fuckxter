import { HttpError } from "../shared/http";
import type { D1PreparedStatement, Env, PostRow } from "../shared/platform";
import { randomId } from "../shared/crypto";
import { usernameKey } from "../accounts/usernames";
import { buildAvatarUrl } from "../accounts/avatar";
import {
  createNotification,
  deleteNotification,
} from "../notifications/notifications";

const POST_SELECT = `
  SELECT
    p.id,
    p.slug,
    p.text,
    p.media_json,
    p.created_at,
    p.view_count,
    p.visibility,
    u.id AS author_id,
    u.handle AS author_handle,
    u.name AS author_name,
    u.verified AS author_verified,
    u.avatar_media_id AS author_avatar_media_id,
    u.avatar_key AS author_avatar_key,
    u.updated_at AS author_updated_at,
    (SELECT COUNT(*) FROM comments c
      WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS reply_count,
    (SELECT COUNT(*) FROM reposts rp WHERE rp.post_id = p.id) AS repost_count,
    p.like_count,
    EXISTS(
      SELECT 1 FROM likes vl
      WHERE vl.post_id = p.id AND vl.user_id = ?
    ) AS liked,
    EXISTS(
      SELECT 1 FROM reposts vr
      WHERE vr.post_id = p.id AND vr.user_id = ?
    ) AS reposted,
    EXISTS(
      SELECT 1 FROM bookmarks vb
      WHERE vb.post_id = p.id AND vb.user_id = ?
    ) AS saved,
    EXISTS(
      SELECT 1 FROM follows vf
      WHERE vf.follower_id = ? AND vf.followee_id = p.author_id
    ) AS author_following
  FROM posts p
  JOIN users u ON u.id = p.author_id AND u.deleted_at IS NULL
`;

async function createPostId(env: Env): Promise<string> {
  const result = await env.DB.prepare(
    "INSERT INTO post_sequence DEFAULT VALUES",
  ).run();
  const sequence = result.meta?.last_row_id;
  if (!sequence) {
    throw new HttpError(500, "POST_SEQUENCE_FAILED", "分配帖子序号失败。");
  }
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${timestamp}-${sequence}`;
}

function isPostIdConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: posts\.(id|slug)/.test(error.message)
  );
}

/** 附件是图片、并且发帖人勾了「HDR 显示」才记这个标记。 */
function isDisplayHdr(contentType: string | null, hdr: boolean): boolean {
  return Boolean(hdr) && (contentType ?? "").startsWith("image/");
}

export type PostVisibility = "public" | "mutual" | "private";

export function normalizeVisibility(value: unknown): PostVisibility {
  if (value === "mutual" || value === "private") return value;
  return "public";
}

const VIEWER_FILTER = `
  (
    p.visibility = 'public'
    OR p.author_id = ?
    OR (
      p.visibility = 'mutual'
      AND EXISTS (
        SELECT 1 FROM follows vf1
        WHERE vf1.follower_id = ? AND vf1.followee_id = p.author_id
      )
      AND EXISTS (
        SELECT 1 FROM follows vf2
        WHERE vf2.follower_id = p.author_id AND vf2.followee_id = ?
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM blocks vb
    WHERE (vb.blocker_id = ? AND vb.blocked_id = p.author_id)
       OR (vb.blocker_id = p.author_id AND vb.blocked_id = ?)
  )
`;

function viewerFilterParams(viewerId: string | null): string[] {
  const viewer = viewerId ?? "";
  return [viewer, viewer, viewer, viewer, viewer];
}

function viewerFilter(viewerId: string | null): {
  condition: string;
  params: string[];
} {
  if (!viewerId) {
    return { condition: "p.visibility = 'public'", params: [] };
  }
  return { condition: VIEWER_FILTER, params: viewerFilterParams(viewerId) };
}

function encodeCursor(...parts: string[]): string {
  return btoa(JSON.stringify(parts))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor(cursor: string): string[] {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const value = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    ) as unknown;
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      value.length > 3 ||
      value.some((part) => typeof part !== "string")
    ) {
      throw new Error("invalid cursor");
    }
    return value as string[];
  } catch {
    throw new HttpError(400, "INVALID_CURSOR", "分页游标无效。");
  }
}

function publicPost(row: PostRow, viewerId: string | null) {
  return {
    id: row.id,
    slug: row.slug,
    author: {
      id: row.author_id,
      name: row.author_name,
      handle: row.author_handle,
      verified: Boolean(row.author_verified),
      avatarUrl: buildAvatarUrl({
        handle: row.author_handle,
        avatarKey: row.author_avatar_key,
        avatarMediaId: row.author_avatar_media_id,
        updatedAt: row.author_updated_at,
      }),
    },
    text: row.text,
    createdAt: row.created_at,
    visibility: row.visibility ?? "public",
    stats: {
      replies: Number(row.reply_count),
      reposts: Number(row.repost_count),
      likes: Number(row.like_count),
      views: Number(row.view_count ?? 0),
    },
    media: row.media_json ? JSON.parse(row.media_json) : undefined,
    viewer: {
      liked: Boolean(row.liked),
      reposted: Boolean(row.reposted),
      saved: Boolean(row.saved),
      followingAuthor: Boolean(row.author_following),
      isAuthor: viewerId === row.author_id,
    },
  };
}

async function allPosts<T extends PostRow>(
  statement: D1PreparedStatement,
): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export type TimelineTab = "foryou" | "latest" | "following";

export function timelineTab(value: string | null): TimelineTab {
  if (value === "latest" || value === "following") return value;
  return "foryou";
}

export async function getTimeline(
  env: Env,
  viewerId: string | null,
  tab: string,
  cursor: string | null,
  limitValue: string | null,
) {
  const viewer = viewerId ?? "";
  const filter = viewerFilter(viewerId);
  const limit = Math.min(Math.max(Number(limitValue ?? 10) || 10, 1), 30);
  const params: unknown[] = [viewer, viewer, viewer, viewer, ...filter.params];
  const conditions = ["p.deleted_at IS NULL", filter.condition];
  const resolved = timelineTab(tab);
  // 推荐流没有算法：按点赞量排序，点赞数相同就按时间。
  // 每个赞的分量一样，新帖在 0 赞档里也能靠时间拿到曝光。
  const byLikes = resolved === "foryou";
  const likeCount = "p.like_count";

  if (resolved === "following") {
    if (!viewerId) {
      return { tab: "following", posts: [], nextCursor: null };
    }
    conditions.push(
      "EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = p.author_id)",
    );
    params.push(viewerId);
  }

  if (cursor) {
    const parts = decodeCursor(cursor);
    if (byLikes && parts.length === 3) {
      const [likes, createdAt, id] = parts;
      conditions.push(
        `(${likeCount} < ?
          OR (${likeCount} = ?
            AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))))`,
      );
      params.push(Number(likes), Number(likes), createdAt, createdAt, id);
    } else {
      const [createdAt, id] = parts;
      conditions.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
      params.push(createdAt, createdAt, id);
    }
  }

  params.push(limit + 1);
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${
         byLikes
           ? "like_count DESC, p.created_at DESC, p.id DESC"
           : "p.created_at DESC, p.id DESC"
       }
       LIMIT ?`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);

  return {
    tab: resolved,
    posts: pageRows.map((row) => publicPost(row, viewerId)),
    nextCursor:
      hasMore && last
        ? byLikes
          ? encodeCursor(String(last.like_count ?? 0), last.created_at, last.id)
          : encodeCursor(last.created_at, last.id)
        : null,
  };
}

async function viewerKey(
  request: Request,
  viewerId: string | null,
): Promise<string> {
  if (viewerId) return `user:${viewerId}`;
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const agent = request.headers.get("User-Agent") ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}\n${agent}`),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `anon:${hash.slice(0, 32)}`;
}

export async function recordPostView(
  env: Env,
  request: Request,
  viewerId: string | null,
  postId: string,
): Promise<{ id: string; views: number; counted: boolean }> {
  const post = await env.DB.prepare(
    "SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(postId)
    .first<{ id: string }>();
  if (!post) {
    throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO post_views (post_id, viewer_key, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(post_id, viewer_key) DO NOTHING`,
  )
    .bind(postId, await viewerKey(request, viewerId), new Date().toISOString())
    .run();

  const counted = Number(inserted.meta?.changes ?? 0) > 0;
  if (counted) {
    await env.DB.prepare(
      "UPDATE posts SET view_count = view_count + 1 WHERE id = ?",
    )
      .bind(postId)
      .run();
  }

  const row = await env.DB.prepare("SELECT view_count FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ view_count: number }>();

  return { id: postId, views: Number(row?.view_count ?? 0), counted };
}

export async function getPostById(
  env: Env,
  viewerId: string | null,
  id: string,
) {
  const filter = viewerFilter(viewerId);
  const row = await env.DB.prepare(
    `${POST_SELECT}
     WHERE p.id = ? AND p.deleted_at IS NULL AND ${filter.condition}
     LIMIT 1`,
  )
    .bind(
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      id,
      ...filter.params,
    )
    .first<PostRow>();
  return row ? publicPost(row, viewerId) : null;
}

export async function getPostByPath(
  env: Env,
  viewerId: string | null,
  handle: string,
  slug: string,
) {
  const filter = viewerFilter(viewerId);
  const row = await env.DB.prepare(
    `${POST_SELECT}
     WHERE p.slug = ? AND u.id = ?
       AND p.deleted_at IS NULL
       AND ${filter.condition}
     LIMIT 1`,
  )
    .bind(
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      slug,
      usernameKey(handle),
      ...filter.params,
    )
    .first<PostRow>();
  return row ? publicPost(row, viewerId) : null;
}

export async function getPostsByUser(
  env: Env,
  viewerId: string | null,
  handle: string,
) {
  const filter = viewerFilter(viewerId);
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       WHERE u.id = ? AND p.deleted_at IS NULL
         AND ${filter.condition}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 100`,
    ).bind(
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      usernameKey(handle),
      ...filter.params,
    ),
  );
  return rows.map((row) => publicPost(row, viewerId));
}

export async function createPost(
  env: Env,
  authorId: string,
  text: string,
  mediaId?: string,
  visibility: PostVisibility = "public",
  hdr = false,
) {
  const cleanText = text.trim();
  if (!cleanText) throw new HttpError(400, "EMPTY_POST", "帖子内容不能为空。");
  if ([...cleanText].length > 1000) {
    throw new HttpError(400, "POST_TOO_LONG", "帖子不能超过 1000 个字符。");
  }
  const now = new Date().toISOString();
  let mediaJson: string | null = null;
  if (mediaId) {
    const media = await env.DB.prepare(
      `SELECT id, original_name, content_type, byte_size
       FROM media_objects
       WHERE id = ? AND owner_id = ? AND status = 'ready'`,
    )
      .bind(mediaId, authorId)
      .first<{
        id: string;
        original_name: string;
        content_type: string;
        byte_size: number;
      }>();
    if (!media) {
      throw new HttpError(400, "INVALID_MEDIA", "媒体不存在或不属于该用户。");
    }
    mediaJson = JSON.stringify({
      id: media.id,
      url: `/media/${encodeURIComponent(media.id)}`,
      alt: media.original_name,
      contentType: media.content_type,
      byteSize: Number(media.byte_size),
      // 只有图片才谈得上 HDR 显示（HDR 视频、音频之类以后再说）
      ...(isDisplayHdr(media.content_type, hdr) ? { hdr: true } : {}),
    });
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = await createPostId(env);
    try {
      await env.DB.prepare(
        `INSERT INTO posts (
           id, slug, author_id, text, media_json, visibility,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, id, authorId, cleanText, mediaJson, visibility, now, now)
        .run();
      return getPostById(env, authorId, id);
    } catch (error) {
      if (!isPostIdConflict(error) || attempt === 4) throw error;
    }
  }

  throw new HttpError(500, "POST_ID_FAILED", "生成帖子 ID 失败。");
}

export async function updatePost(
  env: Env,
  userId: string,
  postId: string,
  text: string,
  visibility?: PostVisibility,
  hdr?: boolean,
) {
  const cleanText = text.trim();
  if (!cleanText) throw new HttpError(400, "EMPTY_POST", "帖子内容不能为空。");
  if ([...cleanText].length > 1000) {
    throw new HttpError(400, "POST_TOO_LONG", "帖子不能超过 1000 个字符。");
  }
  const post = await env.DB.prepare(
    `SELECT author_id, media_json
     FROM posts WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(postId)
    .first<{ author_id: string; media_json: string | null }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
  if (post.author_id !== userId) {
    throw new HttpError(403, "FORBIDDEN", "无法编辑这条帖子。");
  }
  let mediaJson = post.media_json;
  if (hdr !== undefined && mediaJson) {
    try {
      const media = JSON.parse(mediaJson) as {
        contentType?: unknown;
        hdr?: unknown;
      };
      const contentType =
        typeof media.contentType === "string" ? media.contentType : "";
      if (contentType.startsWith("image/")) {
        if (isDisplayHdr(contentType, hdr)) media.hdr = true;
        else delete media.hdr;
        mediaJson = JSON.stringify(media);
      }
    } catch {
      // media_json 坏了就别动它，编辑正文本身不该因此失败
    }
  }
  await env.DB.prepare(
    `UPDATE posts
     SET text = ?,
         visibility = COALESCE(?, visibility),
         media_json = COALESCE(?, media_json),
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      cleanText,
      visibility ?? null,
      mediaJson,
      new Date().toISOString(),
      postId,
    )
    .run();
  return getPostById(env, userId, postId);
}

export async function deletePost(
  env: Env,
  userId: string,
  postId: string,
): Promise<void> {
  const post = await env.DB.prepare(
    "SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ author_id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
  if (post.author_id !== userId) {
    throw new HttpError(403, "FORBIDDEN", "无法删除这条帖子。");
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(now, now, postId)
    .run();
  await env.DB.prepare("DELETE FROM notifications WHERE post_id = ?")
    .bind(postId)
    .run();
}

export async function setLike(
  env: Env,
  userId: string,
  postId: string,
  active: boolean,
) {
  const post = await env.DB.prepare(
    "SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ id: string; author_id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
  const eventKey = `like:${userId}:${postId}`;
  if (active) {
    await env.DB.prepare(
      `INSERT INTO likes (user_id, post_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, post_id) DO NOTHING`,
    )
      .bind(userId, postId, new Date().toISOString())
      .run();
    await createNotification(env, {
      recipientId: post.author_id,
      actorId: userId,
      type: "like",
      postId,
      eventKey,
    });
  } else {
    await env.DB.prepare("DELETE FROM likes WHERE user_id = ? AND post_id = ?")
      .bind(userId, postId)
      .run();
    await deleteNotification(env, eventKey);
  }
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM likes WHERE post_id = ?",
  )
    .bind(postId)
    .first<{ count: number }>();
  return { id: postId, liked: active, likes: Number(count?.count ?? 0) };
}

export async function setRepost(
  env: Env,
  userId: string,
  postId: string,
  active: boolean,
) {
  const post = await env.DB.prepare(
    "SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ id: string; author_id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
  const eventKey = `repost:${userId}:${postId}`;
  if (active) {
    await env.DB.prepare(
      `INSERT INTO reposts (user_id, post_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, post_id) DO NOTHING`,
    )
      .bind(userId, postId, new Date().toISOString())
      .run();
    await createNotification(env, {
      recipientId: post.author_id,
      actorId: userId,
      type: "repost",
      postId,
      eventKey,
    });
  } else {
    await env.DB.prepare(
      "DELETE FROM reposts WHERE user_id = ? AND post_id = ?",
    )
      .bind(userId, postId)
      .run();
    await deleteNotification(env, eventKey);
  }
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM reposts WHERE post_id = ?",
  )
    .bind(postId)
    .first<{ count: number }>();
  return {
    id: postId,
    reposted: active,
    reposts: Number(count?.count ?? 0),
  };
}

export async function getSavedPosts(env: Env, userId: string) {
  const filter = viewerFilter(userId);
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       JOIN bookmarks saved ON saved.post_id = p.id
       WHERE saved.user_id = ? AND p.deleted_at IS NULL
         AND ${filter.condition}
       ORDER BY saved.created_at DESC
       LIMIT 200`,
    ).bind(userId, userId, userId, userId, userId, ...filter.params),
  );
  return rows.map((row) => publicPost(row, userId));
}

export async function setSaved(
  env: Env,
  userId: string,
  postId: string,
  active: boolean,
) {
  const post = await env.DB.prepare(
    "SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
  if (active) {
    await env.DB.prepare(
      `INSERT INTO bookmarks (user_id, post_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, post_id) DO NOTHING`,
    )
      .bind(userId, postId, new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare(
      "DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?",
    )
      .bind(userId, postId)
      .run();
  }
  return getSavedPosts(env, userId);
}

export async function searchPosts(
  env: Env,
  viewerId: string | null,
  queryText: string,
) {
  const query = queryText.trim();
  if (!query) return { query, posts: [] };
  const filter = viewerFilter(viewerId);
  const pattern = `%${query}%`;
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       WHERE p.deleted_at IS NULL
         AND ${filter.condition}
         AND (p.text LIKE ? OR u.name LIKE ? OR u.handle LIKE ?)
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 50`,
    ).bind(
      // 顺序必须和 SQL 里的占位符一致：POST_SELECT 的四个 -> 可见范围过滤 -> LIKE
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      ...filter.params,
      pattern,
      pattern,
      pattern,
    ),
  );
  return { query, posts: rows.map((row) => publicPost(row, viewerId)) };
}

export async function getComments(
  env: Env,
  viewerId: string | null,
  postId: string,
) {
  const result = await env.DB.prepare(
    `SELECT
       c.id,
       c.text,
       c.created_at,
       COUNT(*) OVER() AS total_count,
       u.id AS author_id,
       u.name AS author_name,
       u.handle AS author_handle,
       u.verified AS author_verified,
       u.avatar_media_id AS author_avatar_media_id,
       u.avatar_key AS author_avatar_key,
       u.updated_at AS author_updated_at,
       (SELECT COUNT(*) FROM comment_likes cl
         WHERE cl.comment_id = c.id) AS like_count,
       (SELECT COUNT(*) FROM comment_reposts cr
         WHERE cr.comment_id = c.id) AS repost_count,
       EXISTS(
         SELECT 1 FROM comment_likes cv
         WHERE cv.comment_id = c.id AND cv.user_id = ?
       ) AS liked,
       EXISTS(
         SELECT 1 FROM comment_reposts cv
         WHERE cv.comment_id = c.id AND cv.user_id = ?
       ) AS reposted,
       parent.id AS parent_id,
       parent.text AS parent_text,
       pu.handle AS parent_handle,
       pu.name AS parent_name
     FROM comments c
     JOIN users u ON u.id = c.author_id
     LEFT JOIN comments parent ON parent.id = c.parent_id
     LEFT JOIN users pu ON pu.id = parent.author_id
     WHERE c.post_id = ? AND c.deleted_at IS NULL
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 100`,
  )
    .bind(viewerId ?? "", viewerId ?? "", postId)
    .all<{
      id: string;
      text: string;
      created_at: string;
      total_count: number;
      author_id: string;
      author_name: string;
      author_handle: string;
      author_verified: number;
      author_avatar_media_id: string | null;
      author_avatar_key: string | null;
      author_updated_at: string;
      like_count: number;
      repost_count: number;
      liked: number;
      reposted: number;
      parent_id: string | null;
      parent_text: string | null;
      parent_handle: string | null;
      parent_name: string | null;
    }>();

  const rows = [...(result.results ?? [])].reverse();
  return {
    total: Number(rows[0]?.total_count ?? 0),
    comments: rows.map((row) => ({
      id: row.id,
      author: {
        id: row.author_id,
        name: row.author_name,
        handle: row.author_handle,
        verified: Boolean(row.author_verified),
        avatarUrl: buildAvatarUrl({
          handle: row.author_handle,
          avatarKey: row.author_avatar_key,
          avatarMediaId: row.author_avatar_media_id,
          updatedAt: row.author_updated_at,
        }),
      },
      text: row.text,
      createdAt: row.created_at,
      parent:
        row.parent_id && row.parent_handle
          ? {
              id: row.parent_id,
              handle: row.parent_handle,
              name: row.parent_name ?? row.parent_handle,
              text: row.parent_text ?? "",
            }
          : null,
      stats: {
        likes: Number(row.like_count),
        reposts: Number(row.repost_count),
      },
      viewer: {
        liked: Boolean(row.liked),
        reposted: Boolean(row.reposted),
      },
    })),
  };
}

export async function setCommentInteraction(
  env: Env,
  userId: string,
  postId: string,
  commentId: string,
  kind: "like" | "repost",
  active: boolean,
) {
  const comment = await env.DB.prepare(
    `SELECT id FROM comments
     WHERE id = ? AND post_id = ? AND deleted_at IS NULL`,
  )
    .bind(commentId, postId)
    .first<{ id: string }>();
  if (!comment) {
    throw new HttpError(404, "COMMENT_NOT_FOUND", "回覆不存在。");
  }
  const table = kind === "like" ? "comment_likes" : "comment_reposts";
  if (active) {
    await env.DB.prepare(
      `INSERT INTO ${table} (user_id, comment_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, comment_id) DO NOTHING`,
    )
      .bind(userId, commentId, new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare(
      `DELETE FROM ${table} WHERE user_id = ? AND comment_id = ?`,
    )
      .bind(userId, commentId)
      .run();
  }
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE comment_id = ?`,
  )
    .bind(commentId)
    .first<{ count: number }>();
  return {
    id: commentId,
    [kind === "like" ? "liked" : "reposted"]: active,
    [kind === "like" ? "likes" : "reposts"]: Number(count?.count ?? 0),
  };
}

export async function createComment(
  env: Env,
  userId: string,
  postId: string,
  text: string,
  parentId?: string,
) {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new HttpError(400, "EMPTY_COMMENT", "回覆内容不能为空。");
  }
  if ([...cleanText].length > 1000) {
    throw new HttpError(400, "COMMENT_TOO_LONG", "回覆不能超过 1000 个字符。");
  }
  const post = await env.DB.prepare(
    "SELECT id, author_id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ id: string; author_id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");

  let parent: { id: string; author_id: string } | null = null;
  if (parentId) {
    parent = await env.DB.prepare(
      `SELECT id, author_id FROM comments
       WHERE id = ? AND post_id = ? AND deleted_at IS NULL`,
    )
      .bind(parentId, postId)
      .first<{ id: string; author_id: string }>();
    if (!parent) {
      throw new HttpError(404, "COMMENT_NOT_FOUND", "回覆的目标不存在。");
    }
  }

  const id = randomId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO comments (id, post_id, author_id, text, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, postId, userId, cleanText, parent?.id ?? null, now)
    .run();

  const user = await env.DB.prepare(
    `SELECT id, name, handle, verified, avatar_media_id, avatar_key, updated_at
     FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{
      id: string;
      name: string;
      handle: string;
      verified: number;
      avatar_media_id: string | null;
      avatar_key: string | null;
      updated_at: string;
    }>();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "请先登录。");

  await createNotification(env, {
    recipientId: post.author_id,
    actorId: userId,
    type: "reply",
    postId,
    commentId: id,
    eventKey: `reply:${id}`,
    data: { excerpt: cleanText.slice(0, 120) },
  });
  if (parent && parent.author_id !== post.author_id) {
    await createNotification(env, {
      recipientId: parent.author_id,
      actorId: userId,
      type: "reply",
      postId,
      commentId: id,
      eventKey: `reply-to-comment:${id}`,
      data: { excerpt: cleanText.slice(0, 120) },
    });
  }

  return {
    id,
    author: {
      id: user.id,
      name: user.name,
      handle: user.handle,
      verified: Boolean(user.verified),
      avatarUrl: buildAvatarUrl({
        handle: user.handle,
        avatarKey: user.avatar_key,
        avatarMediaId: user.avatar_media_id,
        updatedAt: user.updated_at,
      }),
    },
    text: cleanText,
    createdAt: now,
    stats: { likes: 0, reposts: 0 },
    viewer: { liked: false, reposted: false },
  };
}

export async function deleteComment(
  env: Env,
  userId: string,
  postId: string,
  commentId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT c.author_id, p.author_id AS post_author_id
     FROM comments c
     JOIN posts p ON p.id = c.post_id
     WHERE c.id = ? AND c.post_id = ? AND c.deleted_at IS NULL`,
  )
    .bind(commentId, postId)
    .first<{ author_id: string; post_author_id: string }>();
  if (!row) throw new HttpError(404, "COMMENT_NOT_FOUND", "回覆不存在。");
  if (row.author_id !== userId && row.post_author_id !== userId) {
    throw new HttpError(403, "FORBIDDEN", "无法删除这条回覆。");
  }
  await env.DB.prepare("UPDATE comments SET deleted_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), commentId)
    .run();
  await deleteNotification(env, `reply:${commentId}`);
}
