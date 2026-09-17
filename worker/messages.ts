import { buildAvatarUrl } from "./avatar";
import { HttpError } from "./http";
import type { Env } from "./platform";
import { randomId } from "./security";
import { usernameKey } from "./usernames";
import { isBlockedBetween } from "./users";

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
    throw new HttpError(400, "INVALID_HANDLE", "Invalid username.");
  }
  const person = await env.DB.prepare(
    `SELECT ${PERSON_COLUMNS} FROM users o WHERE o.id = ?`,
  )
    .bind(normalized)
    .first<PersonRow>();
  if (!person) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found.");
  }
  return person;
}

async function findThreadId(
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
       ) AS unread
     FROM dm_threads t
     JOIN users o
       ON o.id = CASE WHEN t.user_low_id = ? THEN t.user_high_id ELSE t.user_low_id END
     LEFT JOIN dm_messages m
       ON m.id = (
         SELECT id FROM dm_messages
         WHERE thread_id = t.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
     WHERE t.user_low_id = ? OR t.user_high_id = ?
     ORDER BY t.last_message_at DESC
     LIMIT ?`,
  )
    .bind(userId, userId, userId, userId, THREAD_LIST_LIMIT)
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
  const threadId = await findThreadId(env, low, high);
  const messages = threadId ? await loadMessages(env, threadId, userId) : [];

  return {
    user: serializePerson(person),
    messages,
    unread: messages.filter((message) => !message.mine && !message.read).length,
  };
}

async function loadMessages(env: Env, threadId: string, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, body, sender_id, created_at, read_at
     FROM dm_messages
     WHERE thread_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
  )
    .bind(threadId, THREAD_PAGE_SIZE)
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

  const person = await findPerson(env, handle);
  if (person.id === userId) {
    throw new HttpError(400, "SELF_MESSAGE", "不能和自己私信。");
  }
  if (await isBlockedBetween(env, userId, person.id)) {
    throw new HttpError(403, "BLOCKED", "你们之间存在拉黑关系，无法私信。");
  }

  const [low, high] = pairFor(userId, person.id);
  const now = new Date().toISOString();
  let threadId = await findThreadId(env, low, high);
  if (!threadId) {
    const candidate = randomId();
    await env.DB.prepare(
      `INSERT INTO dm_threads (id, user_low_id, user_high_id, created_at, last_message_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_low_id, user_high_id) DO NOTHING`,
    )
      .bind(candidate, low, high, now, now)
      .run();
    threadId = (await findThreadId(env, low, high)) ?? candidate;
  }

  await env.DB.prepare(
    `INSERT INTO dm_messages (id, thread_id, sender_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(randomId(), threadId, userId, body, now)
    .run();
  await env.DB.prepare("UPDATE dm_threads SET last_message_at = ? WHERE id = ?")
    .bind(now, threadId)
    .run();

  return getConversation(env, userId, handle);
}

export async function markConversationRead(
  env: Env,
  userId: string,
  handle: string,
): Promise<void> {
  const person = await findPerson(env, handle);
  const [low, high] = pairFor(userId, person.id);
  const threadId = await findThreadId(env, low, high);
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
): Promise<void> {
  const person = await findPerson(env, handle);
  const [low, high] = pairFor(userId, person.id);
  const threadId = await findThreadId(env, low, high);
  if (!threadId) {
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found.");
  }

  const removed = await env.DB.prepare(
    "DELETE FROM dm_messages WHERE id = ? AND thread_id = ? AND sender_id = ?",
  )
    .bind(messageId, threadId, userId)
    .run();
  if (!Number(removed.meta?.changes ?? 0)) {
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found.");
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
}

export async function countUnreadMessages(
  env: Env,
  userId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM dm_messages m
     JOIN dm_threads t ON t.id = m.thread_id
     WHERE m.sender_id != ?
       AND m.read_at IS NULL
       AND (t.user_low_id = ? OR t.user_high_id = ?)`,
  )
    .bind(userId, userId, userId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}
