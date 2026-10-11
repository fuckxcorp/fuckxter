import { sha256 } from "./crypto";
import { HttpError } from "./http";
import type { Env, UserRow } from "./platform";
import { usernameKey } from "../accounts/usernames";

type Limit = [key: string, count: number, seconds: number];
type Action = "publish" | "interact" | "message";

const ACTION_LIMITS: Record<Action, [number, number]> = {
  publish: [30, 300],
  interact: [120, 3000],
  message: [60, 2000],
};

async function checkLimits(env: Env, limits: Limit[]): Promise<void> {
  const now = Date.now();
  const keys = await Promise.all(limits.map(([key]) => sha256(key)));
  const rows = await env.DB.prepare(
    `INSERT INTO rate_limits (key, hits, expires_at)
    VALUES ${limits.map(() => "(?, 1, ?)").join(", ")}
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN expires_at <= ? THEN 1 ELSE hits + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING key, hits, expires_at`,
  )
    .bind(
      ...limits.flatMap(([, , seconds], index) => [
        keys[index],
        now + seconds * 1000,
      ]),
      now,
      now,
    )
    .all<{ key: string; hits: number; expires_at: number }>();
  const counts = new Map(
    limits.map(([, count], index) => [keys[index], count]),
  );
  const denied = (rows.results ?? []).filter(
    (row) => row.hits > (counts.get(row.key) ?? 0),
  );
  if ((rows.results?.length ?? 0) !== limits.length || denied.length) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "操作太频繁，请稍后重试。",
      Math.max(
        1,
        ...denied.map((row) => Math.ceil((row.expires_at - now) / 1000)),
      ),
    );
  }
}

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  seconds: number,
): Promise<void> {
  await checkLimits(env, [[key, limit, seconds]]);
}

export async function limitAction(
  env: Env,
  request: Request,
  user: Pick<UserRow, "credential_id">,
  action: Action,
  recipient?: string,
): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const actor = user.credential_id;
  const [minute, daily] = ACTION_LIMITS[action];
  const limits: Limit[] = [
    [`write:source:${ip}`, 300, 60],
    [`write:${action}:actor:${actor}`, minute, 60],
    [`write:${action}:daily:${actor}`, daily, 86400],
  ];
  if (action === "message" && recipient) {
    const target = await env.DB.prepare(
      "SELECT credential_id FROM users WHERE id = ? AND deleted_at IS NULL",
    )
      .bind(usernameKey(recipient))
      .first<{ credential_id: string }>();
    if (target) {
      const pair = `${actor}:${target.credential_id}`;
      limits.push(
        [`write:message:pair:${pair}`, 20, 60],
        [`write:message:pair-daily:${pair}`, 500, 86400],
      );
    }
  }
  await checkLimits(env, limits);
}

export async function limitViews(
  env: Env,
  request: Request,
  user: Pick<UserRow, "credential_id"> | null,
): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await checkLimits(env, [
    [`views:source:${ip}`, 600, 60],
    [user ? `views:actor:${user.credential_id}` : `views:guest:${ip}`, 120, 60],
  ]);
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
