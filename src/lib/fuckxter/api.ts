import { ApiError, apiEndpoint, apiRequest } from "./http";
import type {
  Comment,
  FeedPage,
  FeedTab,
  LikeResult,
  Post,
  PostMedia,
  RepostResult,
  SearchResult,
  UserProfile,
} from "./types";

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
    `/api/timeline?${query({ tab, cursor, limit: "10" })}`,
  );
}

export function createPost(text: string, mediaId?: string): Promise<Post> {
  return apiRequest<Post>("/api/posts", {
    method: "POST",
    body: JSON.stringify({ text, mediaId }),
  });
}

export function updatePost(id: string, text: string): Promise<Post> {
  return apiRequest<Post>(`/api/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ text }),
  });
}

export async function deletePost(id: string): Promise<void> {
  await apiRequest(`/api/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function uploadMedia(file: File): Promise<PostMedia> {
  const response = await apiRequest<{ media: PostMedia }>("/api/media", {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  return response.media;
}

export function toggleLike(id: string, liked: boolean): Promise<LikeResult> {
  return apiRequest<LikeResult>(`/api/posts/${encodeURIComponent(id)}/like`, {
    method: liked ? "PUT" : "DELETE",
  });
}

export function toggleRepost(
  id: string,
  reposted: boolean,
): Promise<RepostResult> {
  return apiRequest<RepostResult>(
    `/api/posts/${encodeURIComponent(id)}/repost`,
    {
      method: reposted ? "PUT" : "DELETE",
    },
  );
}

export async function getSavedPosts(): Promise<Post[]> {
  const response = await apiRequest<{ posts: Post[] }>("/api/me/saved");
  return response.posts;
}

export async function toggleSave(post: Post, saved: boolean): Promise<Post[]> {
  const response = await apiRequest<{ posts: Post[] }>(
    `/api/posts/${encodeURIComponent(post.id)}/save`,
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
      `/api/posts/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getPostsByUser(handle: string): Promise<Post[]> {
  const response = await apiRequest<{ posts: Post[] }>(
    `/api/users/${encodeURIComponent(handle)}/posts`,
  );
  return response.posts;
}

export function searchPosts(queryText: string): Promise<SearchResult> {
  return apiRequest<SearchResult>(`/api/search?${query({ q: queryText })}`);
}

export async function getComments(postId: string): Promise<Comment[]> {
  const response = await apiRequest<{ comments: Comment[] }>(
    `/api/posts/${encodeURIComponent(postId)}/comments`,
  );
  return response.comments;
}

export async function createComment(
  postId: string,
  text: string,
): Promise<Comment> {
  const response = await apiRequest<{ comment: Comment }>(
    `/api/posts/${encodeURIComponent(postId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  );
  return response.comment;
}

export async function deleteComment(
  postId: string,
  commentId: string,
): Promise<void> {
  await apiRequest(
    `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function getUserProfile(handle: string): Promise<UserProfile> {
  const response = await apiRequest<{ user: UserProfile }>(
    `/api/users/${encodeURIComponent(handle)}`,
  );
  return response.user;
}

export function setFollow(
  handle: string,
  following: boolean,
): Promise<{ handle: string; following: boolean; followers: number }> {
  return apiRequest(`/api/users/${encodeURIComponent(handle)}/follow`, {
    method: following ? "PUT" : "DELETE",
  });
}

export function uploadAvatar(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", apiEndpoint("/api/me/avatar"));
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
            `请求失败（${request.status}）`,
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

export async function removeAvatar(): Promise<void> {
  await apiRequest("/api/me/avatar", {
    method: "DELETE",
  });
}
