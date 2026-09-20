export type FeedTab = "foryou" | "latest" | "following";

export interface FeedUser {
  id: string;
  name: string;

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
  /** 发帖时勾了「HDR 显示」：在支持 HDR 的屏幕上不做 SDR 压暗。只有图片会有。 */
  hdr?: boolean;
}

export interface Post {
  id: string;

  slug: string;
  author: FeedUser;
  text: string;

  createdAt: string;

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
  author: FeedUser;
  text: string;
  createdAt: string;

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
  /** 「快速发起会话」用的人选：你关注的人（含互关标记与权限判断） */
  suggestions?: MessageSuggestion[];
}

/** 谁可以给我发私信：everyone 所有人 / mutual 仅互关 / nobody 不接收 */
export type DmPolicy = "everyone" | "mutual" | "nobody";

export interface MessageSuggestion extends FeedUser {
  mutual: boolean;
  hasThread: boolean;
  canDm: boolean;
}

export interface ConversationPage {
  user: FeedUser;
  messages: DirectMessage[];
  unread: number;
  /** 按对方的私信权限，我现在能不能发 */
  canSend?: boolean;
  dmPolicy?: DmPolicy;
  hint?: string | null;
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
    /** 按对方的私信权限，我能不能给他发私信 */
    canMessage?: boolean;
  };
  /** 已申请删除（3 天宽限期内）的账号：昵称还在，但主页标注为已删除 */
  deleted?: boolean;
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
