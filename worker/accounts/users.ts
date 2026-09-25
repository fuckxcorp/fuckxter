import { HttpError } from "../shared/http";
import type { Env } from "../shared/platform";
import { usernameKey } from "./usernames";
import {
  buildAvatarUrl,
  buildHeaderUrl,
  headerExists,
  headerObjectKey,
} from "./avatar";
import { deleteNotification } from "../notifications/notifications";
import { enqueueJob } from "../shared/jobs";

interface ProfileRow {
  id: string;
  handle: string;
  name: string;
  verified: number;
  bio: string;
  region: string;
  gender: string;
  birthday: string;
  created_at: string;
  updated_at: string;
  avatar_media_id: string | null;
  avatar_key: string | null;
  deleted_at: string | null;
  post_count: number;
  follower_count: number;
  following_count: number;
  following: number;
  blocked: number;
  dm_policy: string;
  is_self: number;
  follows_viewer: number;
}

interface UserSummaryRow {
  id: string;
  handle: string;
  name: string;
  verified: number;
  bio: string;
  avatar_media_id: string | null;
  avatar_key: string | null;
  updated_at: string;
  created_at: string;
  post_count: number;
  follower_count: number;
  following_count: number;
}

function publicUserSummary(row: UserSummaryRow) {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    verified: Boolean(row.verified),
    bio: row.bio,
    createdAt: row.created_at,
    stats: {
      posts: Number(row.post_count),
      followers: Number(row.follower_count),
      following: Number(row.following_count),
    },
    avatarUrl: buildAvatarUrl({
      handle: row.handle,
      avatarKey: row.avatar_key,
      avatarMediaId: row.avatar_media_id,
      updatedAt: row.updated_at,
    }),
  };
}

function publicProfile(row: ProfileRow, headerUrl: string | null) {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    verified: Boolean(row.verified),
    bio: row.bio,
    region: row.region,
    gender: row.gender,
    birthday: row.birthday,
    createdAt: row.created_at,
    avatarUrl: buildAvatarUrl({
      handle: row.handle,
      avatarKey: row.avatar_key,
      avatarMediaId: row.avatar_media_id,
      updatedAt: row.updated_at,
    }),
    headerUrl,
    stats: {
      posts: Number(row.post_count),
      followers: Number(row.follower_count),
      following: Number(row.following_count),
    },
    viewer: {
      following: Boolean(row.following),
      blocked: Boolean(row.blocked),
      canMessage: canMessageFrom(row),
    },
    deleted: Boolean(row.deleted_at),
  };
}

/** 按对方的私信权限判断「我能不能给他发私信」，主页上的私信按钮据此置灰 */
function canMessageFrom(row: ProfileRow): boolean {
  if (row.is_self || row.blocked || row.deleted_at) return false;
  if (row.dm_policy === "nobody") return false;
  if (row.dm_policy === "mutual") {
    return Boolean(row.following && row.follows_viewer);
  }
  return true;
}

export async function getUserProfile(
  env: Env,
  viewerId: string | null,
  handle: string,
) {
  const row = await env.DB.prepare(
    `SELECT
       u.id,
       u.handle,
       u.name,
       u.verified,
       u.bio,
       u.region,
       u.gender,
       u.birthday,
       u.created_at,
       u.avatar_media_id,
       u.avatar_key,
       u.deleted_at,
       u.updated_at,
       (SELECT COUNT(*) FROM posts p
         WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS post_count,
       (SELECT COUNT(*) FROM follows f
         WHERE f.followee_id = u.id) AS follower_count,
       (SELECT COUNT(*) FROM follows f
         WHERE f.follower_id = u.id) AS following_count,
       EXISTS(
         SELECT 1 FROM follows vf
         WHERE vf.follower_id = ? AND vf.followee_id = u.id
       ) AS following,
       EXISTS(
         SELECT 1 FROM blocks vb
         WHERE vb.blocker_id = ? AND vb.blocked_id = u.id
       ) AS blocked,
       u.dm_policy,
       (u.id = ?) AS is_self,
       EXISTS(
         SELECT 1 FROM follows back
         WHERE back.follower_id = u.id AND back.followee_id = ?
       ) AS follows_viewer
     FROM users u
     WHERE u.id = ?
     LIMIT 1`,
  )
    .bind(
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      viewerId ?? "",
      usernameKey(handle),
    )
    .first<ProfileRow>();
  if (!row) return null;
  return publicProfile(
    row,
    buildHeaderUrl({
      handle: row.handle,
      updatedAt: row.updated_at,
      exists: await headerExists(env, row.handle),
    }),
  );
}

export async function searchUsers(env: Env, query: string, limit = 10) {
  const value = query.trim();
  if (!value) return [];
  const pattern = `%${value}%`;
  const result = await env.DB.prepare(
    `SELECT u.id, u.handle, u.name, u.verified, u.bio, u.avatar_media_id,
            u.avatar_key, u.updated_at, u.created_at,
            (SELECT COUNT(*) FROM posts p
              WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS post_count,
            (SELECT COUNT(*) FROM follows f
              WHERE f.followee_id = u.id) AS follower_count,
            (SELECT COUNT(*) FROM follows f
              WHERE f.follower_id = u.id) AS following_count
     FROM users u
     WHERE (u.handle LIKE ? OR u.name LIKE ?) AND u.deleted_at IS NULL
     ORDER BY CASE WHEN u.handle = ? THEN 0 ELSE 1 END, u.handle ASC
     LIMIT ?`,
  )
    .bind(
      pattern,
      pattern,
      usernameKey(value),
      Math.min(Math.max(limit, 1), 20),
    )
    .all<UserSummaryRow>();
  return (result.results ?? []).map(publicUserSummary);
}

export async function getFollowUsers(
  env: Env,
  handle: string,
  kind: "followers" | "following",
) {
  const relation =
    kind === "followers" ? "u.id = f.follower_id" : "u.id = f.followee_id";
  const result = await env.DB.prepare(
    `SELECT u.id, u.handle, u.name, u.verified, u.bio,
            u.avatar_media_id, u.avatar_key, u.updated_at, u.created_at,
            (SELECT COUNT(*) FROM posts p
              WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS post_count,
            (SELECT COUNT(*) FROM follows sf
              WHERE sf.followee_id = u.id) AS follower_count,
            (SELECT COUNT(*) FROM follows sf
              WHERE sf.follower_id = u.id) AS following_count
     FROM follows f
     JOIN users u ON ${relation}
     WHERE ${kind === "followers" ? "f.followee_id" : "f.follower_id"} = ?
       AND u.deleted_at IS NULL
     ORDER BY f.created_at DESC
     LIMIT 100`,
  )
    .bind(usernameKey(handle))
    .all<UserSummaryRow>();
  return (result.results ?? []).map(publicUserSummary);
}

export async function setFollow(
  env: Env,
  followerId: string,
  handle: string,
  active: boolean,
) {
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(usernameKey(handle))
    .first<{ id: string }>();
  if (!target) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在。");
  if (target.id === followerId) {
    throw new HttpError(400, "CANNOT_FOLLOW_SELF", "不能关注自己。");
  }
  if (await isBlockedBetween(env, followerId, target.id)) {
    throw new HttpError(403, "BLOCKED", "你们之间存在拉黑关系。");
  }

  const eventKey = `follow:${followerId}:${target.id}`;
  if (active) {
    await env.DB.prepare(
      `INSERT INTO follows (follower_id, followee_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(follower_id, followee_id) DO NOTHING`,
    )
      .bind(followerId, target.id, new Date().toISOString())
      .run();
    await enqueueJob(env, {
      type: "notification.follow.sync",
      recipientId: target.id,
      followerId,
      eventKey,
    });
  } else {
    await env.DB.prepare(
      "DELETE FROM follows WHERE follower_id = ? AND followee_id = ?",
    )
      .bind(followerId, target.id)
      .run();
    await enqueueJob(env, {
      type: "notification.follow.sync",
      recipientId: target.id,
      followerId,
      eventKey,
    });
  }

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM follows WHERE followee_id = ?",
  )
    .bind(target.id)
    .first<{ count: number }>();
  return {
    handle,
    following: active,
    followers: Number(count?.count ?? 0),
  };
}

export async function isBlockedBetween(
  env: Env,
  a: string,
  b: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS hit FROM blocks
     WHERE (blocker_id = ? AND blocked_id = ?)
        OR (blocker_id = ? AND blocked_id = ?)
     LIMIT 1`,
  )
    .bind(a, b, b, a)
    .first<{ hit: number }>();
  return Boolean(row);
}

export async function setBlock(
  env: Env,
  blockerId: string,
  handle: string,
  active: boolean,
) {
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(usernameKey(handle))
    .first<{ id: string }>();
  if (!target) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在。");
  if (target.id === blockerId) {
    throw new HttpError(400, "CANNOT_BLOCK_SELF", "不能拉黑自己。");
  }

  if (active) {
    await env.DB.prepare(
      `INSERT INTO blocks (blocker_id, blocked_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(blocker_id, blocked_id) DO NOTHING`,
    )
      .bind(blockerId, target.id, new Date().toISOString())
      .run();
    await env.DB.prepare(
      `DELETE FROM follows
       WHERE (follower_id = ? AND followee_id = ?)
          OR (follower_id = ? AND followee_id = ?)`,
    )
      .bind(blockerId, target.id, target.id, blockerId)
      .run();
    await deleteNotification(env, `follow:${blockerId}:${target.id}`);
    await deleteNotification(env, `follow:${target.id}:${blockerId}`);
  } else {
    await env.DB.prepare(
      "DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?",
    )
      .bind(blockerId, target.id)
      .run();
  }

  return { handle: target.id, blocked: active };
}

export async function clearAvatar(env: Env, userId: string) {
  const user = await env.DB.prepare("SELECT avatar_key FROM users WHERE id = ?")
    .bind(userId)
    .first<{ avatar_key: string | null }>();
  await env.DB.prepare(
    `UPDATE users
     SET avatar_media_id = NULL, avatar_key = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(new Date().toISOString(), userId)
    .run();
  if (user?.avatar_key) await env.MEDIA_CACHE.delete(user.avatar_key);
}

export async function clearHeader(env: Env, handle: string) {
  await env.MEDIA_CACHE.delete(headerObjectKey(handle));
  await env.DB.prepare("UPDATE users SET updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), usernameKey(handle))
    .run();
}
