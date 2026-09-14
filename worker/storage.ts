import { HttpError } from "./http";
import type { Env } from "./platform";
import type { S3Config } from "./s3";
import { decryptSecret, encryptSecret, randomId } from "./security";

interface StorageRow {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_ciphertext: string;
  path_style: number;
  is_default: number;
}

async function storageFromRow(env: Env, row: StorageRow): Promise<S3Config> {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    accessKeyId: row.access_key_id,
    secretAccessKey: await decryptSecret(row.secret_ciphertext, env),
    pathStyle: Boolean(row.path_style),
    isDefault: Boolean(row.is_default),
  };
}

export async function getStorageConfigs(
  env: Env,
  userId: string,
): Promise<S3Config[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM s3_configs
     WHERE user_id = ?
     ORDER BY is_default DESC, created_at ASC`,
  )
    .bind(userId)
    .all<StorageRow>();
  return Promise.all(
    (result.results ?? []).map((row) => storageFromRow(env, row)),
  );
}

export async function getStorageConfig(
  env: Env,
  userId: string,
  configId?: string,
): Promise<S3Config | null> {
  const row = configId
    ? await env.DB.prepare(
        "SELECT * FROM s3_configs WHERE id = ? AND user_id = ?",
      )
        .bind(configId, userId)
        .first<StorageRow>()
    : await env.DB.prepare(
        `SELECT * FROM s3_configs
         WHERE user_id = ?
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
      )
        .bind(userId)
        .first<StorageRow>();
  return row ? storageFromRow(env, row) : null;
}

export async function saveStorageConfig(
  env: Env,
  userId: string,
  input: S3Config,
): Promise<S3Config> {
  const id = input.id?.trim() || randomId();
  const name = input.name?.trim() || input.bucket?.trim() || "S3";
  const endpoint = input.endpoint?.trim() ?? "";
  const region = input.region?.trim() || "auto";
  const bucket = input.bucket?.trim() ?? "";
  const accessKeyId = input.accessKeyId?.trim() ?? "";
  if (!/^https?:\/\//.test(endpoint)) {
    throw new HttpError(
      400,
      "INVALID_ENDPOINT",
      "Endpoint must start with http(s)://.",
    );
  }
  if (!bucket)
    throw new HttpError(400, "BUCKET_REQUIRED", "Bucket is required.");

  const existing = await env.DB.prepare(
    `SELECT id, secret_ciphertext, is_default FROM s3_configs
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, userId)
    .first<{
      id: string;
      secret_ciphertext: string;
      is_default: number;
    }>();
  if (input.id && !existing) {
    throw new HttpError(404, "STORAGE_NOT_FOUND", "Storage config not found.");
  }

  const suppliedSecret = input.secretAccessKey ?? "";
  const secretCiphertext = suppliedSecret
    ? await encryptSecret(suppliedSecret, env)
    : existing?.secret_ciphertext;
  if (!secretCiphertext) {
    throw new HttpError(
      400,
      "SECRET_REQUIRED",
      "Secret Access Key is required.",
    );
  }

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM s3_configs WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ count: number }>();
  const isDefault =
    Boolean(input.isDefault) ||
    Number(count?.count ?? 0) === 0 ||
    Boolean(existing?.is_default);
  const now = new Date().toISOString();

  if (isDefault) {
    await env.DB.prepare(
      "UPDATE s3_configs SET is_default = 0 WHERE user_id = ?",
    )
      .bind(userId)
      .run();
  }

  if (existing) {
    await env.DB.prepare(
      `UPDATE s3_configs
       SET name = ?, endpoint = ?, region = ?, bucket = ?,
           access_key_id = ?, secret_ciphertext = ?, path_style = ?,
           is_default = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        name,
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretCiphertext,
        input.pathStyle ? 1 : 0,
        isDefault ? 1 : 0,
        now,
        id,
        userId,
      )
      .run();
  } else {
    try {
      await env.DB.prepare(
        `INSERT INTO s3_configs (
           id, user_id, name, endpoint, region, bucket, access_key_id,
           secret_ciphertext, path_style, is_default, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          userId,
          name,
          endpoint,
          region,
          bucket,
          accessKeyId,
          secretCiphertext,
          input.pathStyle ? 1 : 0,
          isDefault ? 1 : 0,
          now,
          now,
        )
        .run();
    } catch {
      throw new HttpError(
        409,
        "STORAGE_NAME_EXISTS",
        "A storage config with this name already exists.",
      );
    }
  }

  const config = await getStorageConfig(env, userId, id);
  if (!config) {
    throw new HttpError(500, "STORAGE_SAVE_FAILED", "Failed to save storage.");
  }
  return config;
}

export async function deleteStorageConfig(
  env: Env,
  userId: string,
  configId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT is_default FROM s3_configs WHERE id = ? AND user_id = ?",
  )
    .bind(configId, userId)
    .first<{ is_default: number }>();
  if (!row) {
    throw new HttpError(404, "STORAGE_NOT_FOUND", "Storage config not found.");
  }
  const used = await env.DB.prepare(
    "SELECT id FROM media_objects WHERE storage_config_id = ? LIMIT 1",
  )
    .bind(configId)
    .first<{ id: string }>();
  if (used) {
    throw new HttpError(
      409,
      "STORAGE_IN_USE",
      "This storage config is used by existing media.",
    );
  }
  await env.DB.prepare("DELETE FROM s3_configs WHERE id = ? AND user_id = ?")
    .bind(configId, userId)
    .run();
  if (row.is_default) {
    await env.DB.prepare(
      `UPDATE s3_configs
       SET is_default = 1
       WHERE id = (
         SELECT id FROM s3_configs
         WHERE user_id = ?
         ORDER BY created_at ASC
         LIMIT 1
       )`,
    )
      .bind(userId)
      .run();
  }
}
