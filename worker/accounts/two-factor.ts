import {
  KEY_PURPOSE_RECOVERY_CODE,
  hmacSha256,
  hmacSha256All,
  randomBytes,
  type Bytes,
} from "../shared/crypto";
import type { Env } from "../shared/platform";
import { HttpError } from "../shared/http";

async function credentialId(env: Env, userId: string): Promise<string> {
  const user = await env.DB.prepare(
    "SELECT credential_id FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ credential_id: string }>();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "请先登录。");
  return user.credential_id;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
/** 允许前后各一个时间步，容忍客户端与服务端的时钟漂移。 */
const TOTP_WINDOW = 1;

const RECOVERY_ALPHABET = "ACDEFGHJKLMNPQRSTUVWXY3456789";
const RECOVERY_LENGTH = 8;

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
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return false;
  const counter = Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const message = new ArrayBuffer(8);
    new DataView(message).setUint32(4, counter + offset);
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, message),
    );
    const hmacOffset = digest[digest.length - 1] & 15;
    const binary =
      ((digest[hmacOffset] & 127) << 24) |
      ((digest[hmacOffset + 1] & 255) << 16) |
      ((digest[hmacOffset + 2] & 255) << 8) |
      (digest[hmacOffset + 3] & 255);
    const expected = String(binary % 10 ** TOTP_DIGITS).padStart(
      TOTP_DIGITS,
      "0",
    );
    if (expected === code) return true;
  }
  return false;
}

/** 去掉分隔符并转大写，得到恢复码的规范形式。 */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 用拒绝采样生成恢复码，避免取模偏差。 */
export function randomRecoveryCode(): string {
  const limit = 256 - (256 % RECOVERY_ALPHABET.length);
  const chars: string[] = [];
  while (chars.length < RECOVERY_LENGTH) {
    for (const byte of randomBytes(RECOVERY_LENGTH)) {
      if (byte >= limit) continue;
      chars.push(RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
      if (chars.length === RECOVERY_LENGTH) break;
    }
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * 恢复码的存储哈希：HMAC(派生密钥, 用户 id + 规范化后的码)。
 * 绑定用户后，同一个码属于不同用户会得到不同哈希，跨用户碰撞不再有意义。
 */
export async function recoveryCodeHash(
  env: Env,
  userId: string,
  code: string,
): Promise<string> {
  return hmacSha256(
    env,
    KEY_PURPOSE_RECOVERY_CODE,
    `${await credentialId(env, userId)}:${normalizeRecoveryCode(code)}`,
  );
}

/** 校验时把所有候选主密钥的哈希都算出来，换过主密钥的老恢复码也还算数。 */
export async function recoveryCodeHashes(
  env: Env,
  userId: string,
  code: string,
): Promise<string[]> {
  return hmacSha256All(
    env,
    KEY_PURPOSE_RECOVERY_CODE,
    `${await credentialId(env, userId)}:${normalizeRecoveryCode(code)}`,
  );
}

/**
 * 校验并消费一个恢复码：命中就标记 used_at，同一个码只能用一次。
 */
export async function consumeRecoveryCode(
  env: Env,
  userId: string,
  code: string,
): Promise<boolean> {
  const hashes = await recoveryCodeHashes(env, userId, code);
  const row = await env.DB.prepare(
    `UPDATE recovery_codes SET used_at = ?
     WHERE user_id = ? AND code_hash IN (${hashes.map(() => "?").join(", ")})
       AND used_at IS NULL
     RETURNING id`,
  )
    .bind(new Date().toISOString(), userId, ...hashes)
    .first<{ id: string }>();
  return Boolean(row);
}
