import { ApiError, apiEndpoint, apiRequest } from "../core/http";
import type {
  Comment,
  CommentPage,
  ConversationListPage,
  ConversationPage,
  FeedPage,
  FeedTab,
  LikeResult,
  NotificationPage,
  Post,
  PostMedia,
  RepostResult,
  SearchResult,
  StorageOption,
  UserSummary,
  UserProfile,
} from "../core/types";

const query = (values: Record<string, string | null>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) params.set(key, value);
  }
  return params.toString();
};

export function getTimeline(
  tab: FeedTab,
  cursor: string | null,
): Promise<FeedPage> {
  return apiRequest<FeedPage>(
    `/timeline?${query({ tab, cursor, limit: "10" })}`,
  );
}

export function createPost(
  text: string,
  mediaId?: string,
  visibility: Post["visibility"] = "public",
): Promise<Post> {
  return apiRequest<Post>("/posts", {
    method: "POST",
    body: JSON.stringify({ text, mediaId, visibility }),
  });
}

export function updatePost(
  id: string,
  text: string,
  visibility?: Post["visibility"],
): Promise<Post> {
  return apiRequest<Post>(`/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ text, visibility }),
  });
}

export async function deletePost(id: string): Promise<void> {
  await apiRequest(`/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

interface MediaUploadTicket {
  objectKey: string;
  originalName: string;
  contentType: string;
  storageConfigId: string | null;
  url: string;
  headers: Record<string, string>;
}

async function proxyUploadMedia(
  file: File,
  storageConfigId?: string,
): Promise<PostMedia> {
  const headers: Record<string, string> = {
    "Content-Type": file.type,
    "X-File-Name": encodeURIComponent(file.name),
  };
  if (storageConfigId) headers["X-Storage-Config-Id"] = storageConfigId;
  const response = await apiRequest<{ media: PostMedia }>("/media", {
    method: "POST",
    headers,
    body: file,
  });
  return response.media;
}

function putFileToStorage(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(
        new ApiError(
          `S3 直传失败（${request.status}）。请检查存储桶的 CORS 配置。`,
          request.status,
          "S3_DIRECT_UPLOAD_FAILED",
        ),
      );
    });
    request.addEventListener("error", () => {
      reject(
        new ApiError(
          "S3 直传被拦截。请在存储桶的 CORS 配置中允许本站执行 PUT 并携带 Content-Type。",
          0,
          "S3_CORS_DENIED",
        ),
      );
    });
    request.addEventListener("abort", () => {
      reject(new ApiError("上传已取消。", 0, "ABORTED"));
    });
    request.send(file);
  });
}

export async function uploadMedia(
  file: File,
  storageConfigId?: string,
  onProgress?: (percent: number) => void,
  uploadMode: "proxy" | "direct" = "proxy",
): Promise<PostMedia> {
  if (uploadMode === "proxy") {
    return proxyUploadMedia(file, storageConfigId);
  }

  let presign: { upload: MediaUploadTicket };
  try {
    presign = await apiRequest<{ upload: MediaUploadTicket }>(
      "/media/uploads",
      {
        method: "POST",
        body: JSON.stringify({
          storageConfigId,
          fileName: file.name,
          contentType: file.type,
        }),
      },
    );
  } catch (error) {
    // 走平台存储时没法直传（浏览器拿不到 R2 的签名），退回 Worker 中转
    if (
      error instanceof ApiError &&
      error.code === "DIRECT_UPLOAD_UNAVAILABLE"
    ) {
      return proxyUploadMedia(file, storageConfigId);
    }
    throw error;
  }
  await putFileToStorage(
    presign.upload.url,
    presign.upload.headers,
    file,
    onProgress,
  );
  const response = await apiRequest<{ media: PostMedia }>("/media/finalize", {
    method: "POST",
    body: JSON.stringify({
      objectKey: presign.upload.objectKey,
      originalName: presign.upload.originalName,
      contentType: presign.upload.contentType,
      storageConfigId: presign.upload.storageConfigId,
    }),
  });
  return response.media;
}

export async function getStorageOptions(): Promise<StorageOption[]> {
  const response = await apiRequest<{ options: StorageOption[] }>(
    "/me/storage/options",
  );
  return response.options;
}

export function getNotifications(
  cursor: string | null,
  limit = 30,
): Promise<NotificationPage> {
  return apiRequest<NotificationPage>(
    `/notice?${query({ cursor, limit: String(limit) })}`,
  );
}

export async function getUnreadNotificationCount(): Promise<number> {
  const page = await getNotifications(null, 1);
  return page.unread;
}

export function getConversations(): Promise<ConversationListPage> {
  return apiRequest<ConversationListPage>("/messages");
}

export function getConversation(handle: string): Promise<ConversationPage> {
  return apiRequest<ConversationPage>(
    `/messages/${encodeURIComponent(handle)}`,
  );
}

export function sendDirectMessage(
  handle: string,
  text: string,
): Promise<ConversationPage> {
  return apiRequest<ConversationPage>(
    `/messages/${encodeURIComponent(handle)}`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  );
}

export async function markConversationRead(handle: string): Promise<number> {
  const response = await apiRequest<{ unread: number }>(
    `/messages/${encodeURIComponent(handle)}/read`,
    { method: "POST" },
  );
  return response.unread;
}

export function recallDirectMessage(
  handle: string,
  messageId: string,
): Promise<ConversationPage> {
  return apiRequest<ConversationPage>(
    `/messages/${encodeURIComponent(handle)}/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );
}

export async function getUnreadMessageCount(): Promise<number> {
  const page = await getConversations();
  return page.unread;
}

export async function markNotificationsRead(
  id?: string,
  keepalive = false,
): Promise<number> {
  const response = await apiRequest<{ unread: number }>("/notice", {
    method: "POST",
    body: JSON.stringify(id ? { id } : {}),
    keepalive,
  });
  return response.unread;
}

export function toggleLike(id: string, liked: boolean): Promise<LikeResult> {
  return apiRequest<LikeResult>(`/posts/${encodeURIComponent(id)}/like`, {
    method: liked ? "PUT" : "DELETE",
  });
}

export function toggleRepost(
  id: string,
  reposted: boolean,
): Promise<RepostResult> {
  return apiRequest<RepostResult>(`/posts/${encodeURIComponent(id)}/repost`, {
    method: reposted ? "PUT" : "DELETE",
  });
}

export function recordPostView(id: string): Promise<{ views: number }> {
  return apiRequest<{ views: number }>(
    `/posts/${encodeURIComponent(id)}/view`,
    { method: "POST" },
  );
}

export async function getSavedPosts(): Promise<Post[]> {
  const response = await apiRequest<{ posts: Post[] }>("/me/saved");
  return response.posts;
}

export async function toggleSave(post: Post, saved: boolean): Promise<Post[]> {
  const response = await apiRequest<{ posts: Post[] }>(
    `/posts/${encodeURIComponent(post.id)}/save`,
    {
      method: saved ? "PUT" : "DELETE",
    },
  );
  return response.posts;
}

export async function getPostByPath(
  handle: string,
  slug: string,
): Promise<Post | null> {
  try {
    return await apiRequest<Post>(
      `/posts/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getPostsByUser(handle: string): Promise<Post[]> {
  const response = await apiRequest<{ posts: Post[] }>(
    `/users/${encodeURIComponent(handle)}/posts`,
  );
  return response.posts;
}

export function search(queryText: string): Promise<SearchResult> {
  return apiRequest<SearchResult>(`/search?${query({ q: queryText })}`);
}

export async function getUserList(
  handle: string,
  kind: "followers" | "following",
): Promise<UserSummary[]> {
  const response = await apiRequest<{ users: UserSummary[] }>(
    `/users/${encodeURIComponent(handle)}/${kind}`,
  );
  return response.users;
}

export function getComments(postId: string): Promise<CommentPage> {
  return apiRequest<CommentPage>(
    `/posts/${encodeURIComponent(postId)}/comments`,
  );
}

export async function createComment(
  postId: string,
  text: string,
  parentId?: string,
): Promise<Comment> {
  const response = await apiRequest<{ comment: Comment }>(
    `/posts/${encodeURIComponent(postId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ text, parentId }),
    },
  );
  return response.comment;
}

export async function deleteComment(
  postId: string,
  commentId: string,
): Promise<void> {
  await apiRequest(
    `/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function getUserProfile(handle: string): Promise<UserProfile> {
  const response = await apiRequest<{ user: UserProfile }>(
    `/users/${encodeURIComponent(handle)}`,
  );
  return response.user;
}

export function setFollow(
  handle: string,
  following: boolean,
): Promise<{ handle: string; following: boolean; followers: number }> {
  return apiRequest(`/users/${encodeURIComponent(handle)}/follow`, {
    method: following ? "PUT" : "DELETE",
  });
}

export function setBlock(
  handle: string,
  blocked: boolean,
): Promise<{ handle: string; blocked: boolean }> {
  return apiRequest(`/users/${encodeURIComponent(handle)}/block`, {
    method: blocked ? "PUT" : "DELETE",
  });
}

export function toggleCommentLike(
  postId: string,
  commentId: string,
  liked: boolean,
): Promise<LikeResult> {
  return apiRequest<LikeResult>(
    `/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/like`,
    { method: liked ? "PUT" : "DELETE" },
  );
}

export function toggleCommentRepost(
  postId: string,
  commentId: string,
  reposted: boolean,
): Promise<RepostResult> {
  return apiRequest<RepostResult>(
    `/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/repost`,
    { method: reposted ? "PUT" : "DELETE" },
  );
}

export function uploadAvatar(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", apiEndpoint("/me/avatar"));
    request.withCredentials = true;
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      let body: {
        error?: { code?: string; message?: string };
        message?: string;
      } = {};
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {}
      reject(
        new ApiError(
          body.error?.message ??
            body.message ??
            `请求失败（${request.status}）。`,
          request.status,
          body.error?.code,
        ),
      );
    });
    request.addEventListener("error", () => {
      reject(new ApiError("头像上传失败，请检查网络后重试。", 0, "NETWORK"));
    });
    request.addEventListener("abort", () => {
      reject(new ApiError("头像上传已取消。", 0, "ABORTED"));
    });
    request.send(file);
  });
}

export function uploadHeader(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", apiEndpoint("/me/header"));
    request.withCredentials = true;
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      let body: {
        error?: { code?: string; message?: string };
        message?: string;
      } = {};
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {}
      reject(
        new ApiError(
          body.error?.message ??
            body.message ??
            `请求失败（${request.status}）。`,
          request.status,
          body.error?.code,
        ),
      );
    });
    request.addEventListener("error", () => {
      reject(new ApiError("头图上传失败，请检查网络后重试。", 0, "NETWORK"));
    });
    request.addEventListener("abort", () => {
      reject(new ApiError("头图上传已取消。", 0, "ABORTED"));
    });
    request.send(file);
  });
}

export async function removeAvatar(): Promise<void> {
  await apiRequest("/me/avatar", {
    method: "DELETE",
  });
}

export async function removeHeader(): Promise<void> {
  await apiRequest("/me/header", {
    method: "DELETE",
  });
}
