import { buildAvatarUrl } from "./avatar";
import { HttpError } from "./http";
import type { Env } from "./platform";
import { randomId } from "./security";

export type NotificationType =
  "reply" | "like" | "repost" | "follow" | "system";

interface NotificationInput {
  recipientId: string;
  actorId?: string | null;
  type: NotificationType;
  eventKey: string;
  postId?: string | null;
  commentId?: string | null;
  data?: Record<string, unknown>;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  post_id: string | null;
  comment_id: string | null;
  data_json: string;
  read_at: string | null;
  created_at: string;
  actor_id: string | null;
  actor_handle: string | null;
  actor_name: string | null;
  actor_verified: number | null;
  actor_avatar_media_id: string | null;
  actor_avatar_key: string | null;
  actor_updated_at: string | null;
  post_slug: string | null;
  post_text: string | null;
  post_author_handle: string | null;
  comment_text: string | null;
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

function publicNotification(row: NotificationRow) {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {}

  return {
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    read: Boolean(row.read_at),
    actor:
      row.actor_id && row.actor_handle
        ? {
            id: row.actor_id,
            name: row.actor_name ?? row.actor_handle,
            handle: row.actor_handle,
            verified: Boolean(row.actor_verified),
            avatarUrl: buildAvatarUrl({
              handle: row.actor_handle,
              avatarKey: row.actor_avatar_key,
              avatarMediaId: row.actor_avatar_media_id,
              updatedAt: row.actor_updated_at ?? row.created_at,
            }),
          }
        : null,
    post:
      row.post_id && row.post_slug && row.post_author_handle
        ? {
            id: row.post_id,
            slug: row.post_slug,
            authorHandle: row.post_author_handle,
            text: row.post_text ?? "",
          }
        : null,
    comment: row.comment_id
      ? { id: row.comment_id, text: row.comment_text ?? "" }
      : null,
    data,
  };
}

export async function createNotification(
  env: Env,
  input: NotificationInput,
): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) return;
  await env.DB.prepare(
    `INSERT INTO notifications (
       id, recipient_id, actor_id, type, post_id, comment_id,
       event_key, data_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_key) DO UPDATE SET
       data_json = excluded.data_json`,
  )
    .bind(
      randomId(),
      input.recipientId,
      input.actorId ?? null,
      input.type,
      input.postId ?? null,
      input.commentId ?? null,
      input.eventKey,
      JSON.stringify(input.data ?? {}),
      new Date().toISOString(),
    )
    .run();
}

export async function deleteNotification(
  env: Env,
  eventKey: string,
): Promise<void> {
  await env.DB.prepare("DELETE FROM notifications WHERE event_key = ?")
    .bind(eventKey)
    .run();
}

export async function getNotifications(
  env: Env,
  userId: string,
  cursor: string | null,
  limitValue: string | null,
) {
  const limit = Math.min(Math.max(Number(limitValue ?? 30) || 30, 1), 50);
  const params: unknown[] = [userId];
  const conditions = ["n.recipient_id = ?"];

  if (cursor) {
    const [createdAt, id] = decodeCursor(cursor);
    conditions.push("(n.created_at < ? OR (n.created_at = ? AND n.id < ?))");
    params.push(createdAt, createdAt, id);
  }
  params.push(limit + 1);

  const result = await env.DB.prepare(
    `SELECT
       n.id,
       n.type,
       n.post_id,
       n.comment_id,
       n.data_json,
       n.read_at,
       n.created_at,
       a.id AS actor_id,
       a.handle AS actor_handle,
       a.name AS actor_name,
       a.verified AS actor_verified,
       a.avatar_media_id AS actor_avatar_media_id,
       a.avatar_key AS actor_avatar_key,
       a.updated_at AS actor_updated_at,
       p.slug AS post_slug,
       p.text AS post_text,
       pu.handle AS post_author_handle,
       c.text AS comment_text
     FROM notifications n
     LEFT JOIN users a ON a.id = n.actor_id
     LEFT JOIN posts p ON p.id = n.post_id
     LEFT JOIN users pu ON pu.id = p.author_id
     LEFT JOIN comments c ON c.id = n.comment_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT ?`,
  )
    .bind(...params)
    .all<NotificationRow>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    notices: page.map(publicNotification),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function markNotificationsRead(
  env: Env,
  userId: string,
  noticeId?: string,
): Promise<void> {
  const now = new Date().toISOString();
  if (noticeId) {
    await env.DB.prepare(
      `UPDATE notifications SET read_at = ?
       WHERE id = ? AND recipient_id = ? AND read_at IS NULL`,
    )
      .bind(now, noticeId, userId)
      .run();
    return;
  }
  await env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL",
  )
    .bind(now, userId)
    .run();
}

export async function getUnreadNotificationCount(
  env: Env,
  userId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL",
  )
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}
