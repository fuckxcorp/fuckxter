import { HttpError } from "./http";
import type { Env, SessionUserRow, UserRow } from "./platform";
import { buildAvatarUrl } from "./avatar";

const SESSION_COOKIE = "fk_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 100_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

type Bytes = Uint8Array<ArrayBuffer>;

function base64UrlToBytes(value: string): Bytes {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Bytes;
}

function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomId(): string {
  return bytesToBase64Url(randomBytes(16));
}

export function randomToken(): string {
  return bytesToBase64Url(randomBytes(32));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePassword(
  password: string,
  salt: Bytes,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function createPasswordHash(password: string): Promise<{
  hash: string;
  salt: string;
}> {
  const salt = randomBytes(16);
  return {
    hash: await derivePassword(password, salt),
    salt: bytesToBase64Url(salt),
  };
}

export async function verifyPassword(
  password: string,
  row: Pick<UserRow, "password_hash" | "password_salt">,
): Promise<boolean> {
  const actual = await derivePassword(
    password,
    base64UrlToBytes(row.password_salt),
  );
  const expected = row.password_hash;
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

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
    .bind(randomId(), userId, tokenHash, now + SESSION_TTL_SECONDS * 1000, now)
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
  if (!user)
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required.");
  return user;
}

export function accountFromRow(
  row: UserRow & { recovery_code_count?: number },
) {
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
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    recoveryCodeCount: Number(row.recovery_code_count ?? 0),
    createdAt: row.created_at,
  };
}

export async function recoverableCodeHash(
  env: Env,
  code: string,
): Promise<string> {
  if (!env.FUCKXTER_SECRET) {
    throw new HttpError(
      500,
      "FUCKXTER_SECRET_REQUIRED",
      "FUCKXTER_SECRET is not configured.",
    );
  }
  return sha256(`${env.FUCKXTER_SECRET}:${code.toUpperCase()}`);
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.FUCKXTER_SECRET) {
    throw new HttpError(
      500,
      "FUCKXTER_SECRET_REQUIRED",
      "FUCKXTER_SECRET is not configured.",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(env.FUCKXTER_SECRET),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(value: string, env: Env): Promise<string> {
  const key = await encryptionKey(env);
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return `enc:v1:${bytesToBase64Url(iv)}:${bytesToBase64Url(
    new Uint8Array(encrypted),
  )}`;
}

export async function decryptSecret(value: string, env: Env): Promise<string> {
  if (!value.startsWith("enc:v1:")) return value;
  const key = await encryptionKey(env);
  if (!key) {
    throw new HttpError(
      500,
      "FUCKXTER_SECRET_REQUIRED",
      "FUCKXTER_SECRET is not configured.",
    );
  }
  const [, , ivValue, encryptedValue] = value.split(":");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivValue) },
    key,
    base64UrlToBytes(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Bytes {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output) as Bytes;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export async function verifyTotp(
  secret: string,
  code: string,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 30_000);
  for (const offset of [-1, 0, 1]) {
    const value = counter + offset;
    const message = new ArrayBuffer(8);
    const view = new DataView(message);
    view.setUint32(4, value);
    const key = await crypto.subtle.importKey(
      "raw",
      base32Decode(secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, message),
    );
    const hmacOffset = digest[digest.length - 1] & 15;
    const binary =
      ((digest[hmacOffset] & 127) << 24) |
      ((digest[hmacOffset + 1] & 255) << 16) |
      ((digest[hmacOffset + 2] & 255) << 8) |
      (digest[hmacOffset + 3] & 255);
    if (String(binary % 1_000_000).padStart(6, "0") === code) return true;
  }
  return false;
}

export function randomRecoveryCode(): string {
  const alphabet = "ACDEFGHJKLMNPQRSTUVWXY3456789";
  const bytes = randomBytes(8);
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}
