import { HttpError } from "./http";
import type { Env, MediaRow } from "./platform";
import { signedS3Request } from "./s3";
import { randomId, randomToken } from "./security";
import { getStorageConfig } from "./storage";
import { usernameKey } from "./usernames";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 512;
const MEDIA_MAX_DIMENSION = 2048;
const HEADER_MAX_DIMENSION = 2048;
const AVIF_QUALITY = 82;
const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

function startsWith(bytes: Uint8Array, value: string): boolean {
  return value
    .split("")
    .every((char, index) => bytes[index] === char.charCodeAt(0));
}

function detectImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x89 && startsWith(bytes.slice(1), "PNG\r\n\x1a\n")) {
    return "image/png";
  }
  if (startsWith(bytes, "GIF87a") || startsWith(bytes, "GIF89a")) {
    return "image/gif";
  }
  if (startsWith(bytes, "RIFF") && startsWith(bytes.slice(8), "WEBP")) {
    return "image/webp";
  }
  if (
    startsWith(bytes.slice(4), "ftyp") &&
    new TextDecoder("ascii").decode(bytes.slice(8, 32)).includes("avif")
  ) {
    return "image/avif";
  }
  return null;
}

function safeFileName(value: string | null): string {
  let decoded = value ?? "image";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}
  const cleaned = decoded
    .replace(/[/\\\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "image";
}

async function convertToAvif(
  env: Env,
  bytes: ArrayBuffer,
  options: {
    maxDimension: number;
    animated: boolean;
  },
): Promise<ArrayBuffer> {
  const body = new Response(bytes).body;
  if (!body) {
    throw new HttpError(
      500,
      "IMAGE_CONVERSION_FAILED",
      "Image conversion could not read the source.",
    );
  }

  try {
    const output = await env.IMAGES.input(body)
      .transform({
        width: options.maxDimension,
        height: options.maxDimension,
        fit: "scale-down",
      })
      .output({
        format: "image/avif",
        quality: AVIF_QUALITY,
        anim: options.animated,
      });
    const response = output.response();
    if (!response.ok) {
      throw new Error(`Images binding returned ${response.status}`);
    }
    return response.arrayBuffer();
  } catch (error) {
    console.error("Image conversion failed", error);
    throw new HttpError(
      502,
      "IMAGE_CONVERSION_FAILED",
      "Image conversion failed.",
    );
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function mediaJson(row: MediaRow) {
  return {
    id: row.id,
    url: `/api/media/${encodeURIComponent(row.id)}`,
    alt: row.original_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
  };
}

async function readImage(request: Request): Promise<{
  bytes: ArrayBuffer;
  contentType: string;
  originalName: string;
}> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "MEDIA_TOO_LARGE", "Image cannot exceed 10 MB.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "MEDIA_TOO_LARGE", "Image cannot exceed 10 MB.");
  }
  const header = new Uint8Array(bytes.slice(0, 64));
  const contentType = detectImageType(header);
  if (!contentType || !ALLOWED_MEDIA.has(contentType)) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA",
      "Only JPEG, PNG, GIF, WebP, and AVIF images are supported.",
    );
  }
  return {
    bytes,
    contentType,
    originalName: safeFileName(request.headers.get("X-File-Name")),
  };
}

export async function uploadMedia(
  request: Request,
  env: Env,
  userId: string,
  handle: string,
) {
  const { bytes: sourceBytes, originalName } = await readImage(request);
  const bytes = await convertToAvif(env, sourceBytes, {
    maxDimension: MEDIA_MAX_DIMENSION,
    animated: true,
  });
  const contentType = "image/avif";

  const requestedConfigId =
    request.headers.get("X-Storage-Config-Id")?.trim() || undefined;
  const config = await getStorageConfig(env, userId, requestedConfigId);
  if (!config) {
    throw new HttpError(
      400,
      "STORAGE_REQUIRED",
      "Configure S3-compatible storage first.",
    );
  }

  const objectKey = `media/${handle}/${Date.now()}-${randomToken().slice(0, 8)}.avif`;
  const { response } = await signedS3Request(
    config,
    "PUT",
    objectKey,
    bytes,
    contentType,
  );
  if (!response.ok) {
    throw new HttpError(
      502,
      "MEDIA_UPLOAD_FAILED",
      `Media upload failed (S3 ${response.status}).`,
    );
  }

  const sha256 = await sha256Hex(bytes);
  const cacheKey = `media/${sha256}`;
  await env.MEDIA_CACHE.put(cacheKey, bytes, {
    httpMetadata: { contentType },
  });

  const id = randomId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO media_objects (
       id, owner_id, storage_config_id, object_key, original_name, content_type,
       sha256, byte_size, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
  )
    .bind(
      id,
      userId,
      config.id ?? null,
      objectKey,
      originalName,
      contentType,
      sha256,
      bytes.byteLength,
      now,
      now,
    )
    .run();

  return mediaJson({
    id,
    owner_id: userId,
    storage_config_id: config.id ?? null,
    object_key: objectKey,
    original_name: originalName,
    content_type: contentType,
    sha256,
    byte_size: bytes.byteLength,
    status: "ready",
    created_at: now,
    updated_at: now,
  });
}

export async function uploadAvatar(
  request: Request,
  env: Env,
  userId: string,
  handle: string,
): Promise<string> {
  const { bytes: sourceBytes } = await readImage(request);
  const bytes = await convertToAvif(env, sourceBytes, {
    maxDimension: AVATAR_MAX_DIMENSION,
    animated: false,
  });
  const contentType = "image/avif";
  const objectKey = `avatars/${handle}.avif`;
  const current = await env.DB.prepare(
    "SELECT avatar_key FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ avatar_key: string | null }>();
  await env.MEDIA_CACHE.put(objectKey, bytes, {
    httpMetadata: { contentType },
  });
  await env.DB.prepare(
    `UPDATE users
     SET avatar_key = ?, avatar_media_id = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(objectKey, new Date().toISOString(), userId)
    .run();
  if (current?.avatar_key && current.avatar_key !== objectKey) {
    await env.MEDIA_CACHE.delete(current.avatar_key);
  }
  return `/api/avatars/${encodeURIComponent(handle)}`;
}

export async function uploadHeader(
  request: Request,
  env: Env,
  userId: string,
  handle: string,
): Promise<string> {
  const { bytes: sourceBytes } = await readImage(request);
  const bytes = await convertToAvif(env, sourceBytes, {
    maxDimension: HEADER_MAX_DIMENSION,
    animated: false,
  });
  const contentType = "image/avif";
  const objectKey = `headers/${handle}.avif`;
  const current = await env.DB.prepare(
    "SELECT header_key FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ header_key: string | null }>();
  await env.MEDIA_CACHE.put(objectKey, bytes, {
    httpMetadata: { contentType },
  });
  await env.DB.prepare(
    `UPDATE users
     SET header_key = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(objectKey, new Date().toISOString(), userId)
    .run();
  if (current?.header_key && current.header_key !== objectKey) {
    await env.MEDIA_CACHE.delete(current.header_key);
  }
  return `/api/headers/${encodeURIComponent(handle)}`;
}

export async function moveAvatar(
  env: Env,
  userId: string,
  nextHandle: string,
): Promise<void> {
  const user = await env.DB.prepare("SELECT avatar_key FROM users WHERE id = ?")
    .bind(userId)
    .first<{ avatar_key: string | null }>();
  if (!user?.avatar_key) return;

  const nextKey = `avatars/${nextHandle}.avif`;
  if (user.avatar_key === nextKey) return;

  const object = await env.MEDIA_CACHE.get(user.avatar_key);
  if (!object) return;
  await env.MEDIA_CACHE.put(nextKey, await object.arrayBuffer(), {
    httpMetadata: {
      contentType: object.httpMetadata?.contentType ?? "image/avif",
    },
  });
  await env.DB.prepare("UPDATE users SET avatar_key = ? WHERE id = ?")
    .bind(nextKey, userId)
    .run();
  await env.MEDIA_CACHE.delete(user.avatar_key);
}

export async function moveHeader(
  env: Env,
  userId: string,
  nextHandle: string,
): Promise<void> {
  const user = await env.DB.prepare("SELECT header_key FROM users WHERE id = ?")
    .bind(userId)
    .first<{ header_key: string | null }>();
  if (!user?.header_key) return;

  const nextKey = `headers/${nextHandle}.avif`;
  if (user.header_key === nextKey) return;

  const object = await env.MEDIA_CACHE.get(user.header_key);
  if (!object) return;
  await env.MEDIA_CACHE.put(nextKey, await object.arrayBuffer(), {
    httpMetadata: {
      contentType: object.httpMetadata?.contentType ?? "image/avif",
    },
  });
  await env.DB.prepare("UPDATE users SET header_key = ? WHERE id = ?")
    .bind(nextKey, userId)
    .run();
  await env.MEDIA_CACHE.delete(user.header_key);
}

export async function getAvatar(
  env: Env,
  handle: string,
): Promise<{
  body: ReadableStream;
  contentType: string;
  size: number;
  etag: string;
}> {
  const user = await env.DB.prepare("SELECT avatar_key FROM users WHERE id = ?")
    .bind(usernameKey(handle))
    .first<{ avatar_key: string | null }>();
  if (!user?.avatar_key) {
    throw new HttpError(404, "AVATAR_NOT_FOUND", "Avatar not found.");
  }
  const object = await env.MEDIA_CACHE.get(user.avatar_key);
  if (!object) {
    throw new HttpError(404, "AVATAR_NOT_FOUND", "Avatar not found.");
  }
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    size: object.size,
    etag: user.avatar_key,
  };
}

export async function getHeader(
  env: Env,
  handle: string,
): Promise<{
  body: ReadableStream;
  contentType: string;
  size: number;
  etag: string;
}> {
  const user = await env.DB.prepare("SELECT header_key FROM users WHERE id = ?")
    .bind(usernameKey(handle))
    .first<{ header_key: string | null }>();
  if (!user?.header_key) {
    throw new HttpError(404, "HEADER_NOT_FOUND", "Header image not found.");
  }
  const object = await env.MEDIA_CACHE.get(user.header_key);
  if (!object) {
    throw new HttpError(404, "HEADER_NOT_FOUND", "Header image not found.");
  }
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    size: object.size,
    etag: user.header_key,
  };
}

async function getMediaRow(env: Env, id: string): Promise<MediaRow> {
  const row = await env.DB.prepare(
    "SELECT * FROM media_objects WHERE id = ? AND status = 'ready'",
  )
    .bind(id)
    .first<MediaRow>();
  if (!row) throw new HttpError(404, "MEDIA_NOT_FOUND", "Media not found.");
  return row;
}

export async function getMedia(
  env: Env,
  id: string,
): Promise<{
  body: ReadableStream | ArrayBuffer;
  contentType: string;
  size: number;
  etag: string;
}> {
  const row = await getMediaRow(env, id);
  const cacheKey = `media/${row.sha256}`;
  const cached = await env.MEDIA_CACHE.get(cacheKey);
  if (cached) {
    if (cached.httpMetadata?.contentType === "image/avif") {
      return {
        body: cached.body,
        contentType: "image/avif",
        size: cached.size,
        etag: row.sha256,
      };
    }
    const avifBytes = await convertToAvif(env, await cached.arrayBuffer(), {
      maxDimension: MEDIA_MAX_DIMENSION,
      animated: true,
    });
    await env.MEDIA_CACHE.put(cacheKey, avifBytes, {
      httpMetadata: { contentType: "image/avif" },
    });
    return {
      body: avifBytes,
      contentType: "image/avif",
      size: avifBytes.byteLength,
      etag: row.sha256,
    };
  }

  const config = await getStorageConfig(
    env,
    row.owner_id,
    row.storage_config_id ?? undefined,
  );
  if (!config) {
    throw new HttpError(
      502,
      "STORAGE_UNAVAILABLE",
      "The media source storage is unavailable.",
    );
  }
  const { response } = await signedS3Request(config, "GET", row.object_key);
  if (!response.ok) {
    throw new HttpError(
      502,
      "MEDIA_FETCH_FAILED",
      `Media fetch failed (S3 ${response.status}).`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(
      502,
      "MEDIA_TOO_LARGE",
      "Source media exceeds the size limit.",
    );
  }
  const detected = detectImageType(new Uint8Array(bytes.slice(0, 64)));
  if (!detected || detected !== row.content_type) {
    throw new HttpError(
      502,
      "MEDIA_CHANGED",
      "Source media content has changed.",
    );
  }
  const avifBytes =
    detected === "image/avif"
      ? bytes
      : await convertToAvif(env, bytes, {
          maxDimension: MEDIA_MAX_DIMENSION,
          animated: true,
        });
  await env.MEDIA_CACHE.put(cacheKey, avifBytes, {
    httpMetadata: { contentType: "image/avif" },
  });
  return {
    body: avifBytes,
    contentType: "image/avif",
    size: avifBytes.byteLength,
    etag: row.sha256,
  };
}
