import { sha256 } from "./crypto";
import { HttpError } from "./http";
import type { Env } from "./platform";

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  seconds: number,
): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, hits, expires_at)
    VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN expires_at <= ? THEN 1 ELSE hits + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING hits, expires_at`,
  )
    .bind(await sha256(key), now + seconds * 1000, now, now)
    .first<{ hits: number; expires_at: number }>();
  if (!row || row.hits > limit) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "操作太频繁，请稍后重试。",
      Math.max(
        1,
        Math.ceil(((row?.expires_at ?? now + seconds * 1000) - now) / 1000),
      ),
    );
  }
}

export async function limitLogin(
  env: Env,
  request: Request,
  identifier: string,
): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const account = identifier
    .trim()
    .replace(/^@/, "")
    .normalize("NFKC")
    .toLowerCase();
  await rateLimit(env, `auth:source:${ip}`, 60, 600);
  await rateLimit(env, `auth:account:${account}:${ip}`, 12, 600);
}

export async function cleanSecurityState(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").bind(
      Date.now(),
    ),
    env.DB.prepare("DELETE FROM upload_tickets WHERE expires_at <= ?").bind(
      Date.now(),
    ),
    env.DB.prepare(
      "UPDATE users SET pending_totp_secret = NULL, pending_totp_session = NULL, pending_totp_expires = NULL WHERE pending_totp_expires <= ?",
    ).bind(Date.now()),
  ]);
}
