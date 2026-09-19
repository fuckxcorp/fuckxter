import { HttpError } from "../shared/http";
import type { Env, MediaRow } from "../shared/platform";
import {
  presignS3Put,
  presignS3Request,
  signedS3Request,
} from "../accounts/s3";
import { randomId, randomToken } from "../shared/crypto";
import { getStorageConfig } from "./storage";
import { usernameKey } from "../accounts/usernames";
import { headerObjectKey } from "../accounts/avatar";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 512;
const MEDIA_MAX_DIMENSION = 2048;
const HEADER_MAX_WIDTH = 1500;
const HEADER_MAX_HEIGHT = 300;
const STREAM_FALLBACK_BYTES = 25 * 1024 * 1024;
const AVIF_QUALITY = 82;
const HEADER_AVIF_QUALITY = 92;
const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const MEDIA_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

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
    width: number;
    height: number;
    animated: boolean;
    quality?: number;
  },
): Promise<ArrayBuffer> {
  const body = new Response(bytes).body;
  if (!body) {
    throw new HttpError(
      500,
      "IMAGE_CONVERSION_FAILED",
      "图片转换无法读取源文件。",
    );
  }

  try {
    const output = await env.IMAGES.input(body)
      .transform({
        width: options.width,
        height: options.height,
        fit: "scale-down",
      })
      .output({
        format: "image/avif",
        quality: options.quality ?? AVIF_QUALITY,
        anim: options.animated,
      });
    const response = output.response();
    if (!response.ok) {
      throw new Error(`Images binding returned ${response.status}`);
    }
    return response.arrayBuffer();
  } catch (error) {
    console.error("Image conversion failed", error);
    throw new HttpError(502, "IMAGE_CONVERSION_FAILED", "图片转换失败。");
  }
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function mediaJson(row: MediaRow) {
  return {
    id: row.id,
    url: `/media/${encodeURIComponent(row.id)}`,
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
    throw new HttpError(413, "MEDIA_TOO_LARGE", "图片不能超过 30 MB。");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "MEDIA_TOO_LARGE", "图片不能超过 30 MB。");
  }
  const header = new Uint8Array(bytes.slice(0, 64));
  const contentType = detectImageType(header);
  if (!contentType || !ALLOWED_MEDIA.has(contentType)) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA",
      "仅支持 JPEG、PNG、GIF、WebP 和 AVIF 图片。",
    );
  }
  return {
    bytes,
    contentType,
    originalName: safeFileName(request.headers.get("X-File-Name")),
  };
}

export async function uploadMedia(request: Request, env: Env, userId: string) {
  const { bytes, contentType, originalName } = await readImage(request);

  const requestedConfigId =
    request.headers.get("X-Storage-Config-Id")?.trim() || undefined;
  const config = await getStorageConfig(env, userId, requestedConfigId);
  if (!config && requestedConfigId) {
    throw new HttpError(404, "STORAGE_NOT_FOUND", "存储配置不存在。");
  }

  const extension = MEDIA_EXTENSIONS[contentType] ?? "bin";
  const sha256 = await sha256Hex(bytes);
  // 平台存储直接用这个键：它既是源文件，也是首次读取时被原地转成 AVIF 的缓存，
  // 所以整张图在 R2 里只占一份。
  const cacheKey = `media/${sha256}`;
  let objectKey: string;

  if (config) {
    objectKey = `fuckxter/media/${Date.now()}-${randomToken().slice(0, 8)}.${extension}`;
    // 用户自己的 S3：签名后由 Worker 代传
    const upload = await presignS3Request(
      config,
      "PUT",
      objectKey,
      contentType,
    );
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: bytes,
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.text()).trim().slice(0, 240);
      } catch {}
      throw new HttpError(
        502,
        "MEDIA_UPLOAD_FAILED",
        `媒体上传失败（S3 ${response.status}）${detail ? `: ${detail}` : "。"}`,
      );
    }
  } else {
    // 没配 S3：落到平台自己的 R2，只有这一份
    objectKey = cacheKey;
  }

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
      config?.id ?? null,
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
    storage_config_id: config?.id ?? null,
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

export async function presignMediaUpload(
  env: Env,
  userId: string,
  input: {
    storageConfigId?: string;
    fileName?: string;
    contentType?: string;
  },
) {
  const contentType = input.contentType?.trim().toLowerCase() ?? "";
  const extension = MEDIA_EXTENSIONS[contentType];
  if (!extension) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA",
      "仅支持 JPEG、PNG、GIF、WebP 和 AVIF 图片。",
    );
  }
  const config = await getStorageConfig(env, userId, input.storageConfigId);
  if (!config) {
    throw new HttpError(
      400,
      "DIRECT_UPLOAD_UNAVAILABLE",
      "当前存储不支持浏览器直传，请改用 Worker 中转。",
    );
  }
  const objectKey = `fuckxter/media/${Date.now()}-${randomToken().slice(0, 8)}.${extension}`;
  const presigned = await presignS3Put(config, objectKey, contentType, 3600);
  return {
    objectKey,
    originalName: safeFileName(input.fileName ?? null),
    contentType,
    storageConfigId: config.id ?? null,
    ...presigned,
  };
}

export async function finalizeMediaUpload(
  env: Env,
  userId: string,
  input: {
    objectKey?: string;
    originalName?: string;
    contentType?: string;
    storageConfigId?: string | null;
  },
) {
  const objectKey = input.objectKey?.trim() ?? "";
  const prefix = "fuckxter/media/";
  if (
    !objectKey.startsWith(prefix) ||
    objectKey.length === prefix.length ||
    objectKey.includes("..")
  ) {
    throw new HttpError(400, "INVALID_MEDIA", "媒体对象键无效。");
  }
  const contentType = input.contentType?.trim().toLowerCase() ?? "";
  if (!ALLOWED_MEDIA.has(contentType)) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA",
      "仅支持 JPEG、PNG、GIF、WebP 和 AVIF 图片。",
    );
  }
  const config = await getStorageConfig(
    env,
    userId,
    input.storageConfigId ?? undefined,
  );
  if (!config) {
    throw new HttpError(400, "STORAGE_REQUIRED", "请先配置 S3 存储。");
  }

  const existing = await env.DB.prepare(
    `SELECT * FROM media_objects
     WHERE owner_id = ? AND object_key = ? AND status = 'ready'
     LIMIT 1`,
  )
    .bind(userId, objectKey)
    .first<MediaRow>();
  if (existing) return mediaJson(existing);

  const { response } = await signedS3Request(config, "HEAD", objectKey);
  if (!response.ok) {
    throw new HttpError(
      502,
      "MEDIA_UPLOAD_NOT_FOUND",
      `未找到已上传的媒体（S3 ${response.status}）。`,
    );
  }
  const byteSize = Number(response.headers.get("Content-Length") ?? "0");
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new HttpError(
      502,
      "MEDIA_SIZE_UNAVAILABLE",
      "无法获取已上传媒体的大小。",
    );
  }

  const id = randomId();
  const now = new Date().toISOString();
  const sha256 = await sha256Hex(
    new TextEncoder().encode(`${config.id ?? "storage"}:${objectKey}`),
  );
  const row: MediaRow = {
    id,
    owner_id: userId,
    storage_config_id: config.id ?? null,
    object_key: objectKey,
    original_name: safeFileName(input.originalName ?? null),
    content_type: contentType,
    sha256,
    byte_size: byteSize,
    status: "ready",
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO media_objects (
       id, owner_id, storage_config_id, object_key, original_name, content_type,
       sha256, byte_size, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
  )
    .bind(
      row.id,
      row.owner_id,
      row.storage_config_id,
      row.object_key,
      row.original_name,
      row.content_type,
      row.sha256,
      row.byte_size,
      row.created_at,
      row.updated_at,
    )
    .run();
  return mediaJson(row);
}

export async function uploadAvatar(
  request: Request,
  env: Env,
  userId: string,
  handle: string,
): Promise<string> {
  const { bytes: sourceBytes } = await readImage(request);
  const bytes = await convertToAvif(env, sourceBytes, {
    width: AVATAR_MAX_DIMENSION,
    height: AVATAR_MAX_DIMENSION,
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
  return `/avatars/${encodeURIComponent(handle)}`;
}

export async function uploadHeader(
  request: Request,
  env: Env,
  userId: string,
  handle: string,
): Promise<string> {
  const { bytes: sourceBytes } = await readImage(request);
  const bytes = await convertToAvif(env, sourceBytes, {
    width: HEADER_MAX_WIDTH,
    height: HEADER_MAX_HEIGHT,
    animated: false,
    quality: HEADER_AVIF_QUALITY,
  });
  const contentType = "image/avif";
  const objectKey = headerObjectKey(handle);
  await env.MEDIA_CACHE.put(objectKey, bytes, {
    httpMetadata: { contentType },
  });
  await env.DB.prepare("UPDATE users SET updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), userId)
    .run();
  return `/headers/${encodeURIComponent(handle)}`;
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
  currentHandle: string,
  nextHandle: string,
): Promise<void> {
  const currentKey = headerObjectKey(currentHandle);
  const nextKey = headerObjectKey(nextHandle);
  if (currentKey === nextKey) return;

  const object = await env.MEDIA_CACHE.get(currentKey);
  if (!object) return;
  await env.MEDIA_CACHE.put(nextKey, await object.arrayBuffer(), {
    httpMetadata: {
      contentType: object.httpMetadata?.contentType ?? "image/avif",
    },
  });
  await env.MEDIA_CACHE.delete(currentKey);
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
    throw new HttpError(404, "AVATAR_NOT_FOUND", "头像不存在。");
  }
  const object = await env.MEDIA_CACHE.get(user.avatar_key);
  if (!object) {
    throw new HttpError(404, "AVATAR_NOT_FOUND", "头像不存在。");
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
  const objectKey = headerObjectKey(usernameKey(handle));
  const object = await env.MEDIA_CACHE.get(objectKey);
  if (!object) {
    throw new HttpError(404, "HEADER_NOT_FOUND", "主页头图不存在。");
  }
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    size: object.size,
    etag: objectKey,
  };
}

async function getMediaRow(env: Env, id: string): Promise<MediaRow> {
  const row = await env.DB.prepare(
    "SELECT * FROM media_objects WHERE id = ? AND status = 'ready'",
  )
    .bind(id)
    .first<MediaRow>();
  if (!row) throw new HttpError(404, "MEDIA_NOT_FOUND", "媒体不存在。");
  return row;
}

/** 源图 → AVIF 并写进缓存。平台存储和用户 S3 共用这一段。 */
async function avifFromSource(env: Env, row: MediaRow, bytes: ArrayBuffer) {
  const detected = detectImageType(new Uint8Array(bytes.slice(0, 64)));
  if (!detected || detected !== row.content_type) {
    throw new HttpError(502, "MEDIA_CHANGED", "源媒体内容已变更。");
  }
  const avifBytes =
    detected === "image/avif"
      ? bytes
      : await convertToAvif(env, bytes, {
          width: MEDIA_MAX_DIMENSION,
          height: MEDIA_MAX_DIMENSION,
          animated: true,
        });
  await env.MEDIA_CACHE.put(`media/${row.sha256}`, avifBytes, {
    httpMetadata: { contentType: "image/avif" },
  });
  return {
    body: avifBytes,
    contentType: "image/avif",
    size: avifBytes.byteLength,
    etag: row.sha256,
  };
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
      width: MEDIA_MAX_DIMENSION,
      height: MEDIA_MAX_DIMENSION,
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

  // 平台存储：源文件本来就在 R2 里，不用再问 S3
  if (!row.storage_config_id) {
    const object = await env.MEDIA_CACHE.get(row.object_key);
    if (!object) {
      throw new HttpError(
        502,
        "MEDIA_FETCH_FAILED",
        "媒体读取失败（平台存储）。",
      );
    }
    return avifFromSource(env, row, await object.arrayBuffer());
  }

  const config = await getStorageConfig(
    env,
    row.owner_id,
    row.storage_config_id,
  );
  if (!config) {
    throw new HttpError(502, "STORAGE_UNAVAILABLE", "媒体所在的存储不可用。");
  }
  const { response } = await signedS3Request(config, "GET", row.object_key);
  if (!response.ok) {
    throw new HttpError(
      502,
      "MEDIA_FETCH_FAILED",
      `媒体读取失败（S3 ${response.status}）。`,
    );
  }
  const sourceSize =
    Number(row.byte_size) ||
    Number(response.headers.get("Content-Length") ?? "0");
  if (sourceSize > STREAM_FALLBACK_BYTES && response.body) {
    return {
      body: response.body,
      contentType: row.content_type,
      size: sourceSize,
      etag: row.sha256,
    };
  }
  return avifFromSource(env, row, await response.arrayBuffer());
}
