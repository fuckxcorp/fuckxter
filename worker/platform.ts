export interface D1Result<T> {
  results?: T[];
  success: boolean;
}

export interface D1RunResult {
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpMetadata?: {
    contentType?: string;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Bucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  MEDIA_CACHE: R2Bucket;
  FUCKXTER_ORIGINS: string;
  FUCKXTER_SECRET?: string;
}

export interface UserRow {
  id: string;
  handle: string;
  email: string;
  password_hash: string;
  password_salt: string;
  name: string;
  verified: number;
  bio: string;
  region: string;
  gender: string;
  birthday: string;
  avatar_media_id: string | null;
  avatar_key: string | null;
  totp_secret: string | null;
  two_factor_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface SessionUserRow extends UserRow {
  session_id: string;
  recovery_code_count?: number;
}

export interface PostRow {
  id: string;
  slug: string;
  text: string;
  media_json: string | null;
  created_at: string;
  author_id: string;
  author_handle: string;
  author_name: string;
  author_verified: number;
  author_avatar_media_id: string | null;
  author_avatar_key: string | null;
  author_updated_at: string;
  reply_count: number;
  repost_count: number;
  like_count: number;
  liked: number;
  reposted: number;
  saved: number;
  author_following: number;
}

export interface MediaRow {
  id: string;
  owner_id: string;
  storage_config_id: string | null;
  object_key: string;
  original_name: string;
  content_type: string;
  sha256: string;
  byte_size: number;
  status: string;
  created_at: string;
  updated_at: string;
}
