import { HttpError } from "./http";
import type { Env } from "./platform";
import { usernameKey } from "./usernames";
import { buildAvatarUrl } from "./avatar";

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
  post_count: number;
  follower_count: number;
  following_count: number;
  following: number;
}

function publicProfile(row: ProfileRow) {
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
    stats: {
      posts: Number(row.post_count),
      followers: Number(row.follower_count),
      following: Number(row.following_count),
    },
    viewer: {
      following: Boolean(row.following),
    },
  };
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
       ) AS following
     FROM users u
     WHERE u.id = ?
     LIMIT 1`,
  )
    .bind(viewerId ?? "", usernameKey(handle))
    .first<ProfileRow>();
  return row ? publicProfile(row) : null;
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
  if (!target) throw new HttpError(404, "USER_NOT_FOUND", "User not found.");
  if (target.id === followerId) {
    throw new HttpError(
      400,
      "CANNOT_FOLLOW_SELF",
      "You cannot follow yourself.",
    );
  }

  if (active) {
    await env.DB.prepare(
      `INSERT INTO follows (follower_id, followee_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(follower_id, followee_id) DO NOTHING`,
    )
      .bind(followerId, target.id, new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare(
      "DELETE FROM follows WHERE follower_id = ? AND followee_id = ?",
    )
      .bind(followerId, target.id)
      .run();
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
