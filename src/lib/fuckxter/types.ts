/**
 * FuckXter 数据契约：UI 与后端共同遵守的类型定义。
 * 后端接口的请求/响应体都以这里为准。
 */

export type FeedTab = "foryou" | "following";

export interface FeedUser {
  id: string;
  name: string;
  /** 不带 @ 前缀 */
  handle: string;
  verified?: boolean;
  avatarUrl?: string | null;
}

export interface PostStats {
  replies: number;
  reposts: number;
  likes: number;
}

export interface PostMedia {
  id: string;
  url: string;
  alt: string;
  contentType: string;
  byteSize: number;
}

export interface Post {
  id: string;
  /** Stable public URL segment returned by the backend. */
  slug: string;
  author: FeedUser;
  text: string;
  /** ISO 8601 */
  createdAt: string;
  stats: PostStats;
  media?: PostMedia;
  viewer?: {
    liked: boolean;
    reposted: boolean;
    saved: boolean;
    followingAuthor?: boolean;
    isAuthor?: boolean;
  };
}

/** 时间线分页响应：nextCursor 为 null 表示没有更多了 */
export interface FeedPage {
  tab: FeedTab;
  posts: Post[];
  nextCursor: string | null;
}

export interface LikeResult {
  id: string;
  liked: boolean;
  likes: number;
}

export interface RepostResult {
  id: string;
  reposted: boolean;
  reposts: number;
}

export interface SearchResult {
  query: string;
  posts: Post[];
}

export interface Comment {
  id: string;
  kind: "reply";
  author: FeedUser;
  text: string;
  createdAt: string;
}

export interface CommentPage {
  comments: Comment[];
  total: number;
}

export interface UserProfile {
  id: string;
  handle: string;
  name: string;
  verified?: boolean;
  bio: string;
  region: string;
  gender: string;
  birthday: string;
  createdAt: string;
  avatarUrl: string | null;
  headerUrl: string | null;
  stats: {
    posts: number;
    followers: number;
    following: number;
  };
  viewer: {
    following: boolean;
  };
}

export interface StorageOption {
  id: string;
  name: string;
  bucket: string;
  isDefault: boolean;
}

export type NotificationType =
  "reply" | "like" | "repost" | "follow" | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
  actor: FeedUser | null;
  post: {
    id: string;
    slug: string;
    authorHandle: string;
    text: string;
  } | null;
  comment: {
    id: string;
    text: string;
  } | null;
  data: Record<string, unknown>;
}

export interface NotificationPage {
  notices: Notification[];
  nextCursor: string | null;
  unread: number;
}
