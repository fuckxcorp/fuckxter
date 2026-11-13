import type { Job } from "./jobs";

/**
 * 绑定类型由 `pnpm types` 根据 wrangler.toml 生成（worker/worker-configuration.d.ts）。
 * 这里只补上生成结果表达不了的部分：哪些绑定在本地可能没有、队列消息的形状、
 * 以及不写在 wrangler.toml 里的变量。
 */
type GeneratedEnv = Omit<
  Cloudflare.Env,
  "ASSETS" | "JOBS" | "READ_LIMITER" | "SEARCH_LIMITER" | "FUCKXTER_ORIGINS"
>;

export interface Env extends GeneratedEnv {
  ASSETS?: Fetcher;
  JOBS: Queue<Job>;
  /** 读接口限流。没配绑定时不限流。 */
  READ_LIMITER?: RateLimit;
  SEARCH_LIMITER?: RateLimit;
  FUCKXTER_ORIGINS: string;
  FUCKXTER_DEV?: string;
  FUCKXTER_DEV_ASSET_ORIGIN?: string;
  /** 可选：加密 TOTP 密钥的主密钥。不配就用 D1 里自动生成的那把。 */
  FUCKXTER_SECRET?: string;
}

export interface UserRow {
  id: string;
  credential_id: string;
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
  /** 私信权限：everyone | mutual | nobody */
  dm_policy: string;
  totp_secret: string | null;
  pending_totp_secret: string | null;
  pending_totp_session: string | null;
  pending_totp_expires: number | null;
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
  source_post_id: string | null;
  repost_kind: "repost" | "quote" | null;
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
