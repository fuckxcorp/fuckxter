/**
 * FuckXter 数据契约：UI 与后端共同遵守的类型定义。
 * 后端接口的请求/响应体都以这里为准。
 */

/** 推荐 = 按浏览热度，实时 = 按发布时间，关注 = 只看来往的人。 */
export type FeedTab = "foryou" | "latest" | "following";

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
  views: number;
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
  /** 公开 / 仅互关可见 / 私密贴 */
  visibility?: "public" | "mutual" | "private";
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
  users: UserSummary[];
  posts: Post[];
}

export interface UserSummary {
  id: string;
  name: string;
  handle: string;
  verified?: boolean;
  bio: string;
  avatarUrl: string | null;
  createdAt: string;
  stats: {
    posts: number;
    followers: number;
    following: number;
  };
}

export interface Comment {
  id: string;
  kind: "reply";
  author: FeedUser;
  text: string;
  createdAt: string;
  /** 回覆某條回帖時帶上被回覆的內容，用來畫出引用行。 */
  parent?: {
    id: string;
    handle: string;
    name: string;
    text: string;
  } | null;
  stats: {
    likes: number;
    reposts: number;
  };
  viewer: {
    liked: boolean;
    reposted: boolean;
  };
}

export interface CommentPage {
  comments: Comment[];
  total: number;
}

export interface DirectMessage {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  read: boolean;
}

export interface Conversation {
  id: string;
  other: FeedUser;
  lastMessageAt: string;
  unread: number;
  lastMessage: { body: string; mine: boolean; createdAt: string } | null;
}

export interface ConversationListPage {
  threads: Conversation[];
  unread: number;
}

export interface ConversationPage {
  user: FeedUser;
  messages: DirectMessage[];
  unread: number;
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
    blocked?: boolean;
    blockedBy?: boolean;
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
