import { randomID, randomToken, sha256 } from "../shared/crypto";
import { HttpError } from "../shared/http";
import type { Env, SessionUserRow, UserRow } from "../shared/platform";
import { buildAvatarUrl, buildHeaderUrl, headerExists } from "./avatar";

const SESSION_COOKIE = "fk_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

function sessionCookie(
  request: Request,
  token: string,
  maxAge = SESSION_TTL_SECONDS,
): string {
  const isSecure = new URL(request.url).protocol === "https:";
  const sameSite = isSecure ? "None" : "Lax";
  const secure = isSecure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(request: Request): string {
  return sessionCookie(request, "", 0);
}

export async function createSession(
  env: Env,
  userId: string,
  request: Request,
): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(randomID(), userId, tokenHash, now + SESSION_TTL_SECONDS * 1000, now)
    .run();
  return sessionCookie(request, token);
}

export async function deleteSession(request: Request, env: Env): Promise<void> {
  const token = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256(token))
    .run();
}

export async function getOptionalUser(
  request: Request,
  env: Env,
): Promise<SessionUserRow | null> {
  const token = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.*, s.id AS session_id,
       (SELECT COUNT(*) FROM recovery_codes rc
        WHERE rc.user_id = u.id AND rc.used_at IS NULL) AS recovery_code_count
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), Date.now())
    .first<SessionUserRow>();
}

export async function requireUser(
  request: Request,
  env: Env,
): Promise<SessionUserRow> {
  const user = await getOptionalUser(request, env);
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "请先登录。");
  return user;
}

export async function accountFromRow(
  env: Env,
  row: UserRow & { recovery_code_count?: number },
) {
  const header = await headerExists(env, row.handle);
  return {
    profile: {
      name: row.name,
      handle: row.handle,
      bio: row.bio,
      email: row.email,
      region: row.region,
      gender: row.gender,
      birthday: row.birthday,
    },
    avatarUrl: buildAvatarUrl({
      handle: row.handle,
      avatarKey: row.avatar_key,
      avatarMediaId: row.avatar_media_id,
      updatedAt: row.updated_at,
    }),
    headerUrl: buildHeaderUrl({
      handle: row.handle,
      updatedAt: row.updated_at,
      exists: Boolean(header),
    }),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    recoveryCodeCount: Number(row.recovery_code_count ?? 0),
    dmPolicy: row.dm_policy ?? "everyone",
    createdAt: row.created_at,
  };
}
