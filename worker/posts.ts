import { HttpError } from "./http";
import type { D1PreparedStatement, Env, PostRow } from "./platform";
import { randomId } from "./security";
import { usernameKey } from "./usernames";
import { buildAvatarUrl } from "./avatar";

const POST_SELECT = `
  SELECT
    p.id,
    p.slug,
    p.text,
    p.media_json,
    p.created_at,
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
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
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
  JOIN users u ON u.id = p.author_id
`;

async function createPostId(env: Env): Promise<string> {
  const result = await env.DB.prepare(
    "INSERT INTO post_sequence DEFAULT VALUES",
  ).run();
  const sequence = result.meta?.last_row_id;
  if (!sequence) {
    throw new HttpError(
      500,
      "POST_SEQUENCE_FAILED",
      "Failed to allocate a post sequence.",
    );
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

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify([createdAt, id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const value = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    ) as unknown;
    if (
      !Array.isArray(value) ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    return [value[0], value[1]];
  } catch {
    throw new HttpError(400, "INVALID_CURSOR", "Invalid pagination cursor.");
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
    stats: {
      replies: Number(row.reply_count),
      reposts: Number(row.repost_count),
      likes: Number(row.like_count),
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

export async function getTimeline(
  env: Env,
  viewerId: string | null,
  tab: string,
  cursor: string | null,
  limitValue: string | null,
) {
  const viewer = viewerId ?? "";
  const limit = Math.min(Math.max(Number(limitValue ?? 10) || 10, 1), 30);
  const params: unknown[] = [viewer, viewer, viewer, viewer];
  const conditions = ["p.deleted_at IS NULL"];

  if (tab === "following") {
    if (!viewerId) {
      return { tab: "following", posts: [], nextCursor: null };
    }
    conditions.push(
      "EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = p.author_id)",
    );
    params.push(viewerId);
  }

  if (cursor) {
    const [createdAt, id] = decodeCursor(cursor);
    conditions.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    params.push(createdAt, createdAt, id);
  }

  params.push(limit + 1);
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       WHERE ${conditions.join(" AND ")}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ?`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);

  return {
    tab: tab === "following" ? "following" : "foryou",
    posts: pageRows.map((row) => publicPost(row, viewerId)),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function getPostById(
  env: Env,
  viewerId: string | null,
  id: string,
) {
  const row = await env.DB.prepare(
    `${POST_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL LIMIT 1`,
  )
    .bind(viewerId ?? "", viewerId ?? "", viewerId ?? "", viewerId ?? "", id)
    .first<PostRow>();
  return row ? publicPost(row, viewerId) : null;
}

export async function getPostByPath(
  env: Env,
  viewerId: string | null,
  handle: string,
  slug: string,
) {
  const row = await env.DB.prepare(
    `${POST_SELECT}
     WHERE p.slug = ? AND u.id = ?
       AND p.deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      slug,
      usernameKey(handle),
    )
    .first<PostRow>();
  return row ? publicPost(row, viewerId) : null;
}

export async function getPostsByUser(
  env: Env,
  viewerId: string | null,
  handle: string,
) {
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       WHERE u.id = ? AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 100`,
    ).bind(
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      usernameKey(handle),
    ),
  );
  return rows.map((row) => publicPost(row, viewerId));
}

export async function createPost(
  env: Env,
  authorId: string,
  text: string,
  mediaId?: string,
) {
  const cleanText = text.trim();
  if (!cleanText)
    throw new HttpError(400, "EMPTY_POST", "Post text is required.");
  if ([...cleanText].length > 500) {
    throw new HttpError(
      400,
      "POST_TOO_LONG",
      "Post cannot exceed 500 characters.",
    );
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
      throw new HttpError(
        400,
        "INVALID_MEDIA",
        "Media not found or does not belong to this user.",
      );
    }
    mediaJson = JSON.stringify({
      id: media.id,
      url: `/api/media/${encodeURIComponent(media.id)}`,
      alt: media.original_name,
      contentType: media.content_type,
      byteSize: Number(media.byte_size),
    });
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = await createPostId(env);
    try {
      await env.DB.prepare(
        `INSERT INTO posts (
           id, slug, author_id, text, media_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, id, authorId, cleanText, mediaJson, now, now)
        .run();
      return getPostById(env, authorId, id);
    } catch (error) {
      if (!isPostIdConflict(error) || attempt === 4) throw error;
    }
  }

  throw new HttpError(500, "POST_ID_FAILED", "Failed to create a post ID.");
}

export async function updatePost(
  env: Env,
  userId: string,
  postId: string,
  text: string,
) {
  const cleanText = text.trim();
  if (!cleanText)
    throw new HttpError(400, "EMPTY_POST", "Post text is required.");
  if ([...cleanText].length > 500) {
    throw new HttpError(
      400,
      "POST_TOO_LONG",
      "Post cannot exceed 500 characters.",
    );
  }
  const post = await env.DB.prepare(
    "SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ author_id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");
  if (post.author_id !== userId) {
    throw new HttpError(403, "FORBIDDEN", "You cannot edit this post.");
  }
  await env.DB.prepare("UPDATE posts SET text = ?, updated_at = ? WHERE id = ?")
    .bind(cleanText, new Date().toISOString(), postId)
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
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");
  if (post.author_id !== userId) {
    throw new HttpError(403, "FORBIDDEN", "You cannot delete this post.");
  }
  await env.DB.prepare(
    "UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), new Date().toISOString(), postId)
    .run();
}

export async function setLike(
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
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");
  if (active) {
    await env.DB.prepare(
      `INSERT INTO likes (user_id, post_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, post_id) DO NOTHING`,
    )
      .bind(userId, postId, new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare("DELETE FROM likes WHERE user_id = ? AND post_id = ?")
      .bind(userId, postId)
      .run();
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
    "SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");
  if (active) {
    await env.DB.prepare(
      `INSERT INTO reposts (user_id, post_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, post_id) DO NOTHING`,
    )
      .bind(userId, postId, new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare(
      "DELETE FROM reposts WHERE user_id = ? AND post_id = ?",
    )
      .bind(userId, postId)
      .run();
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
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       JOIN bookmarks saved ON saved.post_id = p.id
       WHERE saved.user_id = ? AND p.deleted_at IS NULL
       ORDER BY saved.created_at DESC
       LIMIT 200`,
    ).bind(userId, userId, userId, userId, userId),
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
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");
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
  const pattern = `%${query}%`;
  const rows = await allPosts<PostRow>(
    env.DB.prepare(
      `${POST_SELECT}
       WHERE p.deleted_at IS NULL
         AND (p.text LIKE ? OR u.name LIKE ? OR u.handle LIKE ?)
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 50`,
    ).bind(
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      pattern,
      pattern,
      pattern,
    ),
  );
  return { query, posts: rows.map((row) => publicPost(row, viewerId)) };
}

export async function getComments(env: Env, postId: string) {
  const result = await env.DB.prepare(
    `SELECT
       c.id,
       c.text,
       c.created_at,
       u.id AS author_id,
       u.name AS author_name,
       u.handle AS author_handle,
       u.verified AS author_verified,
       u.avatar_media_id AS author_avatar_media_id,
       u.avatar_key AS author_avatar_key,
       u.updated_at AS author_updated_at
     FROM comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.post_id = ? AND c.deleted_at IS NULL
     ORDER BY c.created_at ASC
     LIMIT 500`,
  )
    .bind(postId)
    .all<{
      id: string;
      text: string;
      created_at: string;
      author_id: string;
      author_name: string;
      author_handle: string;
      author_verified: number;
      author_avatar_media_id: string | null;
      author_avatar_key: string | null;
      author_updated_at: string;
    }>();

  return (result.results ?? []).map((row) => ({
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
  }));
}

export async function createComment(
  env: Env,
  userId: string,
  postId: string,
  text: string,
) {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new HttpError(400, "EMPTY_COMMENT", "Comment text is required.");
  }
  if ([...cleanText].length > 500) {
    throw new HttpError(
      400,
      "COMMENT_TOO_LONG",
      "Comment cannot exceed 500 characters.",
    );
  }
  const post = await env.DB.prepare(
    "SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ id: string }>();
  if (!post) throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");

  const id = randomId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO comments (id, post_id, author_id, text, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, postId, userId, cleanText, now)
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
  if (!user)
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required.");

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
  if (!row) throw new HttpError(404, "COMMENT_NOT_FOUND", "Comment not found.");
  if (row.author_id !== userId && row.post_author_id !== userId) {
    throw new HttpError(403, "FORBIDDEN", "You cannot delete this comment.");
  }
  await env.DB.prepare("UPDATE comments SET deleted_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), commentId)
    .run();
}
