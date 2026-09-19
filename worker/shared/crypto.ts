import { HttpError } from "./http";
import type { Env, UserRow } from "./platform";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** HKDF 的固定盐，只用来把本项目派生的密钥和其他用途隔开。 */
const HKDF_SALT = encoder.encode("fuckxter.hkdf.v1");

/** 密钥用途：不同用途派生不同子密钥，互不通用。 */
export const KEY_PURPOSE_RECOVERY_CODE = "recovery-code";
const KEY_PURPOSE_SECRET = "secret";

/**
 * PBKDF2-HMAC-SHA256 迭代次数。
 * 注意：Cloudflare 运行时硬性限制最多 100000 次（超过会抛
 * NotSupportedError: iteration counts above 100000 are not supported），
 * 所以这里就是上限，不能往上调。参数写进哈希串，将来换算法时旧密码仍可校验。
 */
export const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_FORMAT = "pbkdf2-sha256";
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BITS = 256;
const PASSWORD_MAX_ITERATIONS = 5_000_000;

/** 密文格式版本，写进密文里，方便以后换算法。 */
const SECRET_VERSION = "v1";

export type Bytes = Uint8Array<ArrayBuffer>;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Bytes {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Bytes;
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomId(): string {
  return bytesToBase64Url(randomBytes(16));
}

export function randomToken(): string {
  return bytesToBase64Url(randomBytes(32));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

/** 定长比较，避免用字符串比较泄露信息。 */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function requireSecret(env: Env): string {
  if (!env.FUCKXTER_SECRET) {
    throw new HttpError(
      500,
      "FUCKXTER_SECRET_REQUIRED",
      "未配置 FUCKXTER_SECRET。",
    );
  }
  return env.FUCKXTER_SECRET;
}

const derivedKeys = new Map<string, Promise<CryptoKey>>();

/**
 * 用 HKDF-SHA256 从 FUCKXTER_SECRET 派生子密钥。
 * 同一个 isolate 里同一用途只派生一次。
 */
function derivedKey(
  env: Env,
  purpose: string,
  algorithm: AesDerivedKeyParams | HmacImportParams,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const secret = requireSecret(env);
  const cacheKey = `${purpose}\u0000${secret}`;
  const cached = derivedKeys.get(cacheKey);
  if (cached) return cached;

  const derived = (async () => {
    const master = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: HKDF_SALT,
        info: encoder.encode(`fuckxter:${purpose}`),
      },
      master,
      algorithm,
      false,
      usages,
    );
  })();

  derivedKeys.set(cacheKey, derived);
  return derived;
}

function secretKey(env: Env): Promise<CryptoKey> {
  return derivedKey(env, KEY_PURPOSE_SECRET, { name: "AES-GCM", length: 256 }, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * 用派生的 HMAC 密钥签名，返回 base64url。
 * 用途靠 purpose 区分，避免同一把密钥被不同场景复用。
 */
export async function hmacSha256(
  env: Env,
  purpose: string,
  value: string,
): Promise<string> {
  const key = await derivedKey(
    env,
    purpose,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(mac));
}

/**
 * AES-256-GCM 加密。aad 会绑定密文的用途和归属：
 * 换一行记录、换一个字段去解密都会直接失败。
 */
export async function encryptSecret(
  value: string,
  env: Env,
  aad: string,
): Promise<string> {
  const key = await secretKey(env);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(value),
  );
  return [
    SECRET_VERSION,
    bytesToBase64Url(iv),
    bytesToBase64Url(new Uint8Array(ciphertext)),
  ].join(".");
}

export async function decryptSecret(
  value: string,
  env: Env,
  aad: string,
): Promise<string> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== SECRET_VERSION) {
    throw new HttpError(
      500,
      "SECRET_FORMAT_INVALID",
      "密文格式无法识别，请重新保存这份配置。",
    );
  }
  const key = await secretKey(env);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(parts[1]),
        additionalData: encoder.encode(aad),
      },
      key,
      base64UrlToBytes(parts[2]),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new HttpError(
      500,
      "SECRET_DECRYPT_FAILED",
      "无法解密密文，请确认 FUCKXTER_SECRET 没有被改动。",
    );
  }
}

async function derivePassword(
  password: string,
  salt: Bytes,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PASSWORD_KEY_BITS,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function createPasswordHash(password: string): Promise<{
  hash: string;
  salt: string;
}> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const digest = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    hash: `${PASSWORD_FORMAT}$${PASSWORD_ITERATIONS}$${digest}`,
    salt: bytesToBase64Url(salt),
  };
}

export async function verifyPassword(
  password: string,
  row: Pick<UserRow, "password_hash" | "password_salt">,
): Promise<boolean> {
  const hash = String(row.password_hash ?? "");
  const salt = String(row.password_salt ?? "");
  const [format, iterationsValue, expected] = hash.split("$");
  if (format !== PASSWORD_FORMAT || !iterationsValue || !expected || !salt) {
    return false;
  }
  const iterations = Number(iterationsValue);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > PASSWORD_MAX_ITERATIONS
  ) {
    return false;
  }
  try {
    const actual = await derivePassword(
      password,
      base64UrlToBytes(salt),
      iterations,
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
