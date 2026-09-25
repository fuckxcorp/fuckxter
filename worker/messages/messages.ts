import { buildAvatarUrl } from "../accounts/avatar";
import { HttpError } from "../shared/http";
import type { Env } from "../shared/platform";
import { randomID } from "../shared/crypto";
import { usernameKey } from "../accounts/usernames";
import { isBlockedBetween } from "../accounts/users";

const MAX_BODY_LENGTH = 1000;
const THREAD_PAGE_SIZE = 50;
const THREAD_LIST_LIMIT = 100;

interface PersonRow {
  id: string;
  handle: string;
  name: string;
  verified: number;
  avatar_key: string | null;
  avatar_media_id: string | null;
  updated_at: string;
}

interface ThreadRow extends PersonRow {
  thread_id: string;
  last_message_at: string;
  last_body: string | null;
  last_sender_id: string | null;
  last_created_at: string | null;
  unread: number;
}

interface MessageRow {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
  read_at: string | null;
}

interface ThreadIdRow {
  id: string;
}

const PERSON_COLUMNS = `
  o.id,
  o.handle,
  o.name,
  o.verified,
  o.avatar_key,
  o.avatar_media_id,
  o.updated_at
`;

function serializePerson(row: PersonRow) {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    verified: Boolean(row.verified),
    avatarUrl: buildAvatarUrl({
      handle: row.handle,
      avatarKey: row.avatar_key,
      avatarMediaId: row.avatar_media_id,
      updatedAt: row.updated_at,
    }),
  };
}

function pairFor(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function findPerson(env: Env, handle: string) {
  const normalized = usernameKey(handle);
  if (!normalized) {
    throw new HttpError(400, "INVALID_HANDLE", "用户名无效。");
  }
  const person = await env.DB.prepare(
    `SELECT ${PERSON_COLUMNS} FROM users o WHERE o.id = ?`,
  )
    .bind(normalized)
    .first<PersonRow>();
  if (!person) {
    throw new HttpError(404, "USER_NOT_FOUND", "用户不存在。");
  }
  return person;
}

async function findThreadID(
  env: Env,
  lowId: string,
  highId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT id FROM dm_threads WHERE user_low_id = ? AND user_high_id = ?",
  )
    .bind(lowId, highId)
    .first<ThreadIdRow>();
  return row?.id ?? null;
}

/**
 * 能不能给这个人发私信？按对方的私信权限判断：
 * everyone 谁都可以、mutual 只有互关可以、nobody 谁都不行。
 * 顺带把「不行」的原因带上，前端可以直接显示。
 */
export async function dmGate(
  env: Env,
  fromId: string,
  toId: string,
): Promise<{ allowed: boolean; policy: string; reason: string | null }> {
  const row = await env.DB.prepare(
    `SELECT
       u.dm_policy AS policy,
       EXISTS(
         SELECT 1 FROM follows f
         WHERE f.follower_id = ? AND f.followee_id = u.id
       ) AS viewer_follows,
       EXISTS(
         SELECT 1 FROM follows f
         WHERE f.follower_id = u.id AND f.followee_id = ?
       ) AS target_follows
     FROM users u WHERE u.id = ?`,
  )
    .bind(fromId, fromId, toId)
    .first<{
      policy: string;
      viewer_follows: number;
      target_follows: number;
    }>();
  const policy = row?.policy ?? "everyone";
  if (!row) return { allowed: false, policy, reason: "用户不存在。" };
  if (policy === "nobody") {
    return { allowed: false, policy, reason: "对方不接收私信。" };
  }
  if (policy === "mutual" && !(row.viewer_follows && row.target_follows)) {
    return {
      allowed: false,
      policy,
      reason: "对方只接收互相关注的人发来的私信。",
    };
  }
  return { allowed: true, policy, reason: null };
}

interface ThreadContextRow extends PersonRow {
  blocked: number;
  thread_id: string | null;
}

/**
 * 一次查询拿齐「对方资料 + 有没有拉黑 + 已有的会话 id」。
 * 这三件事以前是三次串行往返，而发消息每次都要问一遍。
 */
async function loadThreadContext(env: Env, userId: string, handle: string) {
  const normalized = usernameKey(handle);
  if (!normalized) {
    throw new HttpError(400, "INVALID_HANDLE", "用户名无效。");
  }
  const [low, high] = pairFor(userId, normalized);
  const row = await env.DB.prepare(
    `SELECT ${PERSON_COLUMNS},
       EXISTS(
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = ? AND b.blocked_id = o.id)
            OR (b.blocker_id = o.id AND b.blocked_id = ?)
       ) AS blocked,
       (
         SELECT t.id FROM dm_threads t
         WHERE t.user_low_id = ? AND t.user_high_id = ?
       ) AS thread_id
     FROM users o
     WHERE o.id = ?`,
  )
    .bind(userId, userId, low, high, normalized)
    .first<ThreadContextRow>();
  if (!row) {
    throw new HttpError(404, "USER_NOT_FOUND", "用户不存在。");
  }
  return {
    person: row,
    blocked: Boolean(row.blocked),
    threadId: row.thread_id,
  };
}

export async function listConversations(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT
       t.id AS thread_id,
       t.last_message_at,
       ${PERSON_COLUMNS},
       m.body AS last_body,
       m.sender_id AS last_sender_id,
       m.created_at AS last_created_at,
       (
         SELECT COUNT(*) FROM dm_messages um
         WHERE um.thread_id = t.id
           AND um.sender_id != ?
           AND um.read_at IS NULL
           AND um.created_at > COALESCE(dc.cleared_at, '')
       ) AS unread
     FROM dm_threads t
     LEFT JOIN dm_thread_clears dc
       ON dc.thread_id = t.id AND dc.user_id = ?
     JOIN users o
       ON o.id = CASE WHEN t.user_low_id = ? THEN t.user_high_id ELSE t.user_low_id END
     LEFT JOIN dm_messages m
       ON m.id = (
         SELECT id FROM dm_messages
         WHERE thread_id = t.id
           AND created_at > COALESCE(dc.cleared_at, '')
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
     WHERE (t.user_low_id = ? OR t.user_high_id = ?)
       AND t.last_message_at > COALESCE(dc.cleared_at, '')
     ORDER BY t.last_message_at DESC
     LIMIT ?`,
  )
    .bind(userId, userId, userId, userId, userId, THREAD_LIST_LIMIT)
    .all<ThreadRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.thread_id,
    other: serializePerson(row),
    lastMessageAt: row.last_message_at,
    unread: Number(row.unread ?? 0),
    lastMessage:
      row.last_body === null || row.last_created_at === null
        ? null
        : {
            body: row.last_body,
            mine: row.last_sender_id === userId,
            createdAt: row.last_created_at,
          },
  }));
}

/**
 * 私信页「快速发起会话」的人选：你关注的人。
 * mutual    = 对方也关注你（互关）
 * hasThread = 已经有会话了
 * canDm     = 按对方的私信权限，你现在能不能给他发
 */
export async function listMessageSuggestions(
  env: Env,
  userId: string,
  limit = 24,
) {
  const rows = await env.DB.prepare(
    `SELECT
       ${PERSON_COLUMNS},
       EXISTS(
         SELECT 1 FROM follows back
         WHERE back.follower_id = o.id AND back.followee_id = ?
       ) AS mutual,
       EXISTS(
         SELECT 1 FROM dm_threads t
         WHERE (t.user_low_id = ? AND t.user_high_id = o.id)
            OR (t.user_high_id = ? AND t.user_low_id = o.id)
       ) AS has_thread,
       (
         o.dm_policy = 'everyone'
         OR (
           o.dm_policy = 'mutual'
           AND EXISTS(
             SELECT 1 FROM follows back
             WHERE back.follower_id = o.id AND back.followee_id = ?
           )
         )
       ) AS can_dm
     FROM follows f
     JOIN users o ON o.id = f.followee_id
     WHERE f.follower_id = ?
       AND o.deleted_at IS NULL
       AND NOT EXISTS(
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = ? AND b.blocked_id = o.id)
            OR (b.blocker_id = o.id AND b.blocked_id = ?)
       )
     ORDER BY mutual DESC, has_thread ASC, o.handle ASC
     LIMIT ?`,
  )
    .bind(
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      Math.min(Math.max(limit, 1), 50),
    )
    .all<PersonRow & { mutual: number; has_thread: number; can_dm: number }>();

  return (rows.results ?? []).map((row) => ({
    ...serializePerson(row),
    mutual: Boolean(row.mutual),
    hasThread: Boolean(row.has_thread),
    canDm: Boolean(row.can_dm),
  }));
}

export async function getConversation(
  env: Env,
  userId: string,
  handle: string,
) {
  const person = await findPerson(env, handle);
  if (person.id === userId) {
    throw new HttpError(400, "SELF_MESSAGE", "不能和自己私信。");
  }
  if (await isBlockedBetween(env, userId, person.id)) {
    throw new HttpError(403, "BLOCKED", "你们之间存在拉黑关系，无法私信。");
  }
  const [low, high] = pairFor(userId, person.id);
  const threadId = await findThreadID(env, low, high);
  const messages = threadId ? await loadMessages(env, threadId, userId) : [];
  const gate = await dmGate(env, userId, person.id);

  return {
    user: serializePerson(person),
    messages,
    unread: messages.filter((message) => !message.mine && !message.read).length,
    // 对方的私信权限：不行的时候前端把输入框锁掉并显示原因
    canSend: gate.allowed,
    dmPolicy: gate.policy,
    hint: gate.reason,
  };
}

async function loadMessages(env: Env, threadId: string, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, body, sender_id, created_at, read_at
     FROM dm_messages
     WHERE thread_id = ?
       AND created_at > COALESCE(
         (SELECT cleared_at FROM dm_thread_clears
          WHERE thread_id = ? AND user_id = ?),
         ''
       )
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
  )
    .bind(threadId, threadId, userId, THREAD_PAGE_SIZE)
    .all<MessageRow>();

  return (rows.results ?? [])
    .map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      mine: row.sender_id === userId,
      read: row.read_at !== null,
    }))
    .reverse();
}

export async function sendMessage(
  env: Env,
  userId: string,
  handle: string,
  text: string,
  messageId = randomID(),
) {
  const body = text.trim();
  if (!body) {
    throw new HttpError(400, "EMPTY_MESSAGE", "私信内容不能为空。");
  }
  if ([...body].length > MAX_BODY_LENGTH) {
    throw new HttpError(
      400,
      "MESSAGE_TOO_LONG",
      `私信内容不能超过 ${MAX_BODY_LENGTH} 个字。`,
    );
  }

  const {
    person,
    blocked,
    threadId: existingThreadId,
  } = await loadThreadContext(env, userId, handle);
  if (person.id === userId) {
    throw new HttpError(400, "SELF_MESSAGE", "不能和自己私信。");
  }
  if (blocked) {
    throw new HttpError(403, "BLOCKED", "你们之间存在拉黑关系，无法私信。");
  }
  const gate = await dmGate(env, userId, person.id);
  if (!gate.allowed) {
    throw new HttpError(
      403,
      "DM_NOT_ALLOWED",
      gate.reason ?? "对方不接收私信。",
    );
  }

  const now = new Date().toISOString();
  let threadId = existingThreadId;
  if (!threadId) {
    const [low, high] = pairFor(userId, person.id);
    const candidate = randomID();
    const created = await env.DB.prepare(
      `INSERT INTO dm_threads (id, user_low_id, user_high_id, created_at, last_message_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_low_id, user_high_id) DO NOTHING`,
    )
      .bind(candidate, low, high, now, now)
      .run();
    // 并发开聊时对方可能刚插进去，插入没生效就回读真实 id
    threadId =
      Number(created.meta?.changes ?? 0) > 0
        ? candidate
        : ((await findThreadID(env, low, high)) ?? candidate);
  }

  // 插消息 + 更新会话时间，一次往返
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO dm_messages (id, thread_id, sender_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    ).bind(`${userId}:${messageId}`, threadId, userId, body, now),
    env.DB.prepare(
      "UPDATE dm_threads SET last_message_at = ? WHERE id = ?",
    ).bind(now, threadId),
  ]);

  const messages = await loadMessages(env, threadId, userId);
  return {
    user: serializePerson(person),
    messages,
    unread: messages.filter((message) => !message.mine && !message.read).length,
  };
}

export async function markConversationRead(
  env: Env,
  userId: string,
  handle: string,
): Promise<void> {
  const person = await findPerson(env, handle);
  const [low, high] = pairFor(userId, person.id);
  const threadId = await findThreadID(env, low, high);
  if (!threadId) return;
  await env.DB.prepare(
    `UPDATE dm_messages SET read_at = ?
     WHERE thread_id = ? AND sender_id != ? AND read_at IS NULL`,
  )
    .bind(new Date().toISOString(), threadId, userId)
    .run();
}

export async function recallMessage(
  env: Env,
  userId: string,
  handle: string,
  messageId: string,
) {
  const { person, blocked, threadId } = await loadThreadContext(
    env,
    userId,
    handle,
  );
  if (person.id === userId) {
    throw new HttpError(400, "SELF_MESSAGE", "不能和自己私信。");
  }
  if (blocked) {
    throw new HttpError(403, "BLOCKED", "你们之间存在拉黑关系，无法私信。");
  }
  if (!threadId) {
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "私信不存在。");
  }

  const removed = await env.DB.prepare(
    "DELETE FROM dm_messages WHERE id = ? AND thread_id = ? AND sender_id = ?",
  )
    .bind(messageId, threadId, userId)
    .run();
  if (!Number(removed.meta?.changes ?? 0)) {
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "私信不存在。");
  }

  const latest = await env.DB.prepare(
    `SELECT created_at FROM dm_messages
     WHERE thread_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(threadId)
    .first<{ created_at: string }>();
  if (latest) {
    await env.DB.prepare(
      "UPDATE dm_threads SET last_message_at = ? WHERE id = ?",
    )
      .bind(latest.created_at, threadId)
      .run();
  } else {
    await env.DB.prepare("DELETE FROM dm_threads WHERE id = ?")
      .bind(threadId)
      .run();
  }

  const messages = latest ? await loadMessages(env, threadId, userId) : [];
  return {
    user: serializePerson(person),
    messages,
    unread: messages.filter((message) => !message.mine && !message.read).length,
  };
}

export async function deleteConversation(
  env: Env,
  userId: string,
  handle: string,
): Promise<void> {
  const person = await findPerson(env, handle);
  const [low, high] = pairFor(userId, person.id);
  const threadId = await findThreadID(env, low, high);
  if (!threadId) return;
  await env.DB.prepare(
    `INSERT INTO dm_thread_clears (thread_id, user_id, cleared_at)
     VALUES (?, ?, ?)
     ON CONFLICT (thread_id, user_id)
     DO UPDATE SET cleared_at = excluded.cleared_at`,
  )
    .bind(threadId, userId, new Date().toISOString())
    .run();
}

export async function countUnreadMessages(
  env: Env,
  userId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM dm_messages m
     JOIN dm_threads t ON t.id = m.thread_id
     LEFT JOIN dm_thread_clears dc
       ON dc.thread_id = t.id AND dc.user_id = ?
     WHERE m.sender_id != ?
       AND m.read_at IS NULL
       AND m.created_at > COALESCE(dc.cleared_at, '')
       AND (t.user_low_id = ? OR t.user_high_id = ?)`,
  )
    .bind(userId, userId, userId, userId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}
