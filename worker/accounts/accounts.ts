import { HttpError } from "../shared/http";
import type { Env, UserRow } from "../shared/platform";
import { moveAvatar, moveHeader } from "../posts/media";
import {
  accountFromRow,
  createPasswordHash,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  randomId,
  randomToken,
  randomRecoveryCode,
  recoverableCodeHash,
  verifyPassword,
  verifyTotp,
} from "./security";
import { usernameKey, validateUsername } from "./usernames";
import { createNotification } from "../notifications/notifications";

const RESERVED_HANDLES = new Set(["user", "post", "settings", "api", "assets"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_BIRTHDAY = "1700-01-01";

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

function handleFromEmail(email: string): string {
  const base = email
    .split("@")[0]
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase()
    .slice(0, 20);
  if (/^[a-z0-9_]{2,20}$/.test(base) && !RESERVED_HANDLES.has(base)) {
    return base;
  }
  const suffix = randomToken()
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  return `guest${suffix}`;
}

async function uniqueHandle(env: Env, email: string): Promise<string> {
  const preferred = handleFromEmail(email);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix =
      attempt === 0
        ? ""
        : randomToken()
            .replace(/[^a-z0-9]/gi, "")
            .slice(0, 6)
            .toLowerCase();
    const handle = suffix
      ? `${preferred.slice(0, 14)}${suffix}`.slice(0, 20)
      : preferred;
    if (RESERVED_HANDLES.has(handle)) continue;
    const taken = await env.DB.prepare(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
    )
      .bind(usernameKey(handle))
      .first<{ id: string }>();
    if (!taken) return handle;
  }
  return `guest${randomToken()
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase()}`;
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
    if (user.two_factor_enabled) {
      if (!code?.trim()) {
        throw new HttpError(428, "TWO_FACTOR_REQUIRED", "请输入动态验证码。");
      }
      const secret = await decryptSecret(user.totp_secret ?? "", env);
      if (!(await verifyTotp(secret, code.trim()))) {
        throw new HttpError(401, "INVALID_TOTP", "动态验证码不正确。");
      }
    }
    return { userId: user.id, account: await getAccount(env, user.id) };
  }

  if (!isEmail) {
    throw new HttpError(400, "INVALID_EMAIL", "注册需要填写有效的邮箱地址。");
  }

  const email = identifier;
  const now = new Date().toISOString();
  const passwordValue = await createPasswordHash(password);
  let createdId: string | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const handle = await uniqueHandle(env, email);
    const handleKey = usernameKey(handle);
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
          handle,
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
  await createNotification(env, {
    recipientId: user.id,
    type: "system",
    eventKey: `system:welcome:${user.id}`,
    data: {
      title: "欢迎来到 FuckXter",
      body: "账号已就绪，完善资料就可以开始了。",
    },
  });
  return { userId: user.id, account: await getAccount(env, user.id) };
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
    .bind(await encryptSecret(secret, env), new Date().toISOString(), userId)
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
  const secret = await decryptSecret(user.totp_secret, env);
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
    codes.map((code) => recoverableCodeHash(env, code)),
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
