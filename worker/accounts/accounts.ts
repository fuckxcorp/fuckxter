import { HttpError } from "../shared/http";
import {
  createPasswordHash,
  decryptSecret,
  encryptSecret,
  randomId,
  randomBytes,
  verifyPassword,
} from "../shared/crypto";
import type { Env, UserRow } from "../shared/platform";
import { moveAvatar, moveHeader } from "../posts/media";
import { headerObjectKey } from "./avatar";
import { accountFromRow } from "./security";
import {
  consumeRecoveryCode,
  generateTotpSecret,
  randomRecoveryCode,
  recoveryCodeHash,
  verifyTotp,
} from "./two-factor";
import { usernameKey, validateUsername } from "./usernames";

const RESERVED_HANDLES = new Set(["user", "post", "settings", "api", "assets"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_BIRTHDAY = "1700-01-01";
/** 申请删除后的宽限期：这之内登录回来就自动取消删除。 */
const DELETION_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function validateBirthday(value: string): string {
  const birthday = value.trim();
  if (!birthday) return "";
  const date = new Date(`${birthday}T00:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(birthday) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== birthday ||
    birthday < MIN_BIRTHDAY ||
    birthday > today
  ) {
    throw new HttpError(
      400,
      "INVALID_BIRTHDAY",
      "生日必须在 1700-01-01 到今天之间。",
    );
  }
  return birthday;
}

/** 用户名用的字母表：去掉 l / o 这类易混字符，刚好 32 个，取模无偏差。 */
const HANDLE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const HANDLE_LENGTH = 10;

/**
 * 注册时分配的用户名完全随机，不从邮箱推导：
 * 免得两个同名前缀的邮箱互相挤占，也不至于把邮箱暴露在用户名里。
 * 10 位 32 进制 = 50 bit，撞名基本不可能，下面仍然会查一次库兜底。
 */
function randomHandle(): string {
  return [...randomBytes(HANDLE_LENGTH)]
    .map((byte) => HANDLE_ALPHABET[byte % HANDLE_ALPHABET.length])
    .join("");
}

async function uniqueHandle(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const handle = randomHandle();
    if (RESERVED_HANDLES.has(handle)) continue;
    const taken = await env.DB.prepare(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
    )
      .bind(handle)
      .first<{ id: string }>();
    if (!taken) return handle;
  }
  return randomHandle();
}

async function findUserByIdentifier(
  env: Env,
  identifier: string,
): Promise<UserRow | null> {
  const handleKey = identifier.includes("@") ? "" : usernameKey(identifier);
  return env.DB.prepare(
    "SELECT * FROM users WHERE email = ? COLLATE NOCASE OR id = ? LIMIT 1",
  )
    .bind(identifier, handleKey)
    .first<UserRow>();
}

async function getAccount(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT u.*,
       (SELECT COUNT(*) FROM recovery_codes rc
        WHERE rc.user_id = u.id AND rc.used_at IS NULL) AS recovery_code_count
     FROM users u
     WHERE u.id = ?`,
  )
    .bind(userId)
    .first<UserRow & { recovery_code_count: number }>();
  if (!row) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在。");
  return accountFromRow(env, row);
}

export async function loginOrRegister(
  env: Env,
  identifierValue: string,
  password: string,
  code?: string,
  recoveryCode?: string,
) {
  const identifier = identifierValue.trim().replace(/^@/, "").normalize("NFKC");
  if (!identifier) throw new HttpError(400, "EMAIL_REQUIRED", "请填写邮箱。");
  if (!password) throw new HttpError(400, "PASSWORD_REQUIRED", "请填写密码。");
  const isEmail = identifier.includes("@");
  if (isEmail && (identifier.length > 254 || !EMAIL_PATTERN.test(identifier))) {
    throw new HttpError(400, "INVALID_EMAIL", "邮箱地址无效。");
  }

  let user = await findUserByIdentifier(env, identifier);
  if (user) {
    if (!(await verifyPassword(password, user))) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "邮箱或密码错误。");
    }
    let restored = false;
    if (user.deleted_at) {
      if (Date.now() - Date.parse(user.deleted_at) > DELETION_GRACE_MS) {
        // 宽限期已过（定时清理还没跑到）：直接清掉，按新账号走注册
        await purgeUser(env, user);
        user = null;
      } else {
        await env.DB.prepare(
          "UPDATE users SET deleted_at = NULL, updated_at = ? WHERE id = ?",
        )
          .bind(new Date().toISOString(), user.id)
          .run();
        user = { ...user, deleted_at: null };
        restored = true;
      }
    }
    if (user) {
      if (user.two_factor_enabled) {
        if (recoveryCode?.trim()) {
          if (!(await consumeRecoveryCode(env, user.id, recoveryCode))) {
            throw new HttpError(
              401,
              "INVALID_RECOVERY_CODE",
              "恢复码无效或已被使用。",
            );
          }
        } else {
          if (!code?.trim()) {
            throw new HttpError(
              428,
              "TWO_FACTOR_REQUIRED",
              "请输入动态验证码。",
            );
          }
          const secret = await decryptSecret(
            user.totp_secret ?? "",
            env,
            `user:${user.id}:totp`,
          );
          if (!(await verifyTotp(secret, code.trim()))) {
            throw new HttpError(401, "INVALID_TOTP", "动态验证码不正确。");
          }
        }
      }
      return {
        userId: user.id,
        account: await getAccount(env, user.id),
        restored,
      };
    }
  }

  if (!isEmail) {
    throw new HttpError(400, "INVALID_EMAIL", "注册需要填写有效的邮箱地址。");
  }

  const email = identifier;
  const now = new Date().toISOString();
  const passwordValue = await createPasswordHash(password);
  let createdId: string | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const handle = await uniqueHandle(env);
    const handleKey = usernameKey(handle);
    // 昵称先给一个占位，用户随时可以在设置里改
    const name = `user-${handle}`;
    try {
      await env.DB.prepare(
        `INSERT INTO users (
           id, handle, email, password_hash, password_salt, name, verified,
           bio, region, gender, birthday, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, '', '', '', '', ?, ?)`,
      )
        .bind(
          handleKey,
          handle,
          email,
          passwordValue.hash,
          passwordValue.salt,
          name,
          now,
          now,
        )
        .run();
      createdId = handleKey;
      break;
    } catch {
      const existing = await findUserByIdentifier(env, email);
      if (existing) {
        if (!(await verifyPassword(password, existing))) {
          throw new HttpError(
            409,
            "IDENTIFIER_EXISTS",
            "邮箱或用户名已被使用。",
          );
        }
        return {
          userId: existing.id,
          account: await getAccount(env, existing.id),
        };
      }
    }
  }
  if (!createdId) {
    throw new HttpError(409, "IDENTIFIER_EXISTS", "邮箱或用户名已被使用。");
  }
  user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(createdId)
    .first<UserRow>();
  if (!user) {
    throw new HttpError(500, "USER_CREATE_FAILED", "创建账号失败。");
  }
  // 欢迎通知交给调用方用 waitUntil 丢进队列：注册响应不必等队列确认
  return {
    userId: user.id,
    account: await getAccount(env, user.id),
    created: true,
  };
}

export async function updateProfile(
  env: Env,
  userId: string,
  input: {
    name?: string;
    bio?: string;
    region?: string;
    gender?: string;
    birthday?: string;
    handle?: string;
  },
) {
  const current = await env.DB.prepare("SELECT handle FROM users WHERE id = ?")
    .bind(userId)
    .first<{ handle: string }>();
  if (!current) {
    throw new HttpError(401, "UNAUTHORIZED", "请先登录。");
  }

  const username = validateUsername(input.handle ?? current.handle);
  const birthday = validateBirthday(input.birthday ?? "");
  if (username.handleKey !== userId) {
    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
    )
      .bind(username.handleKey)
      .first<{ id: string }>();
    if (existing && existing.id !== userId) {
      throw new HttpError(409, "USERNAME_TAKEN", "用户名已被使用。");
    }
  }
  if (username.handle !== current.handle) {
    await Promise.all([
      moveAvatar(env, userId, username.handle),
      moveHeader(env, current.handle, username.handle),
    ]);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE users
       SET id = ?, handle = ?, name = ?, bio = ?, region = ?, gender = ?,
           birthday = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        username.handleKey,
        username.handle,
        input.name?.trim() || "User",
        input.bio?.trim() ?? "",
        input.region?.trim() ?? "",
        input.gender?.trim() ?? "",
        birthday,
        now,
        userId,
      )
      .run();
  } catch {
    throw new HttpError(409, "USERNAME_TAKEN", "用户名已被使用。");
  }
  return getAccount(env, username.handleKey);
}

export async function changeEmail(
  env: Env,
  userId: string,
  emailValue: string,
  password: string,
) {
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "请先登录。");
  if (!(await verifyPassword(password, user))) {
    throw new HttpError(403, "INVALID_PASSWORD", "当前密码不正确。");
  }
  const email = emailValue.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, "INVALID_EMAIL", "邮箱地址无效。");
  }
  try {
    await env.DB.prepare(
      "UPDATE users SET email = ?, updated_at = ? WHERE id = ?",
    )
      .bind(email, new Date().toISOString(), userId)
      .run();
  } catch {
    throw new HttpError(409, "EMAIL_EXISTS", "该邮箱已被使用。");
  }
  return getAccount(env, userId);
}

export async function changePassword(
  env: Env,
  userId: string,
  current: string,
  next: string,
): Promise<void> {
  if ([...next].length < 8) {
    throw new HttpError(400, "PASSWORD_TOO_SHORT", "新密码至少需要 8 个字符。");
  }
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "请先登录。");
  if (!(await verifyPassword(current, user))) {
    throw new HttpError(403, "INVALID_PASSWORD", "当前密码不正确。");
  }
  const passwordValue = await createPasswordHash(next);
  await env.DB.prepare(
    `UPDATE users
     SET password_hash = ?, password_salt = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      passwordValue.hash,
      passwordValue.salt,
      new Date().toISOString(),
      userId,
    )
    .run();
}

export async function beginTwoFactor(env: Env, userId: string) {
  const secret = generateTotpSecret();
  await env.DB.prepare(
    `UPDATE users
     SET totp_secret = ?, two_factor_enabled = 0, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      await encryptSecret(secret, env, `user:${userId}:totp`),
      new Date().toISOString(),
      userId,
    )
    .run();
  return { secret };
}

export async function confirmTwoFactor(env: Env, userId: string, code: string) {
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user?.totp_secret) {
    throw new HttpError(400, "TOTP_NOT_STARTED", "请先开始动态验证码设置。");
  }
  const secret = await decryptSecret(
    user.totp_secret,
    env,
    `user:${userId}:totp`,
  );
  if (!(await verifyTotp(secret, code.trim()))) {
    throw new HttpError(400, "INVALID_TOTP", "动态验证码不正确。");
  }
  await env.DB.prepare(
    `UPDATE users
     SET two_factor_enabled = 1, updated_at = ?
     WHERE id = ?`,
  )
    .bind(new Date().toISOString(), userId)
    .run();
  return { account: await getAccount(env, userId) };
}

export async function replaceRecoveryCodes(env: Env, userId: string) {
  const user = await env.DB.prepare(
    "SELECT two_factor_enabled FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<Pick<UserRow, "two_factor_enabled">>();
  if (!user?.two_factor_enabled) {
    throw new HttpError(400, "TOTP_REQUIRED", "请先启用双重验证。");
  }
  const codes = Array.from({ length: 8 }, randomRecoveryCode);
  const now = new Date().toISOString();
  const hashes = await Promise.all(
    codes.map((code) => recoveryCodeHash(env, userId, code)),
  );
  await env.DB.batch([
    env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId),
    ...codes.map((_, index) =>
      env.DB.prepare(
        `INSERT INTO recovery_codes (id, user_id, code_hash, created_at)
           VALUES (?, ?, ?, ?)`,
      ).bind(randomId(), userId, hashes[index], now),
    ),
  ]);
  return { codes, recoveryCodeCount: codes.length };
}

/**
 * 申请删除账号：只做标记并踢掉所有会话，外发内容立刻对外不可见。
 * 宽限期内登录会自动取消（见 loginOrRegister）。
 */
export async function requestAccountDeletion(
  env: Env,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ?",
    ).bind(now, now, userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
  ]);
}

/** 真正删掉一个账号，顺带清掉它在 R2 里的头像和头图。 */
async function purgeUser(
  env: Env,
  user: Pick<UserRow, "id" | "handle">,
): Promise<void> {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  await Promise.all([
    env.MEDIA_CACHE.delete(`avatars/${user.handle}.avif`),
    env.MEDIA_CACHE.delete(headerObjectKey(user.handle)),
  ]);
}

/** 定时任务：清理已经超过宽限期的账号。 */
export async function purgeDeletedAccounts(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - DELETION_GRACE_MS).toISOString();
  const rows = await env.DB.prepare(
    "SELECT id, handle FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?",
  )
    .bind(cutoff)
    .all<{ id: string; handle: string }>();
  const pending = rows.results ?? [];
  for (const user of pending) await purgeUser(env, user);
  return pending.length;
}
