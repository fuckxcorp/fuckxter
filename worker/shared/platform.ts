import type { Job } from "./jobs";

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
  head(key: string): Promise<{ size: number } | null>;
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

export interface KVStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface QueueProducer<T> {
  send(body: T, options?: { delaySeconds?: number }): Promise<void>;
}

/** HTMLRewriter 的最小类型（项目没有装 workers-types，手写一份够用的）。 */
export interface HtmlElement {
  setAttribute(name: string, value: string): void;
  setInnerContent(content: string, options?: { html?: boolean }): void;
  append(content: string, options?: { html?: boolean }): void;
  replace(content: string, options?: { html?: boolean }): void;
}

export interface HtmlRewriterHandler {
  element(element: HtmlElement): void;
}

export interface HtmlRewriterInstance {
  on(selector: string, handlers: HtmlRewriterHandler): HtmlRewriterInstance;
  transform(response: Response): Response;
}

export interface HtmlRewriterConstructor {
  new (): HtmlRewriterInstance;
}

export interface ImageTransformer {
  transform(options: {
    width?: number;
    height?: number;
    fit?: "scale-down";
  }): ImageTransformer;
  output(options: {
    format: "image/avif";
    quality: number;
    anim: boolean;
  }): Promise<{ response(): Response }>;
}

export interface ImagesBinding {
  input(stream: ReadableStream): ImageTransformer;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  MEDIA_CACHE: R2Bucket;
  IMAGES: ImagesBinding;
  KV: KVStore;
  JOBS: QueueProducer<Job>;
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
  deleted_at: string | null;
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
  visibility?: string;
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
  view_count: number;
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
