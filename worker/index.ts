import {
  beginTwoFactor,
  changeEmail,
  changePassword,
  confirmTwoFactor,
  loginOrRegister,
  replaceRecoveryCodes,
  updateProfile,
} from "./accounts";
import {
  assertTrustedOrigin,
  corsHeaders,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "./http";
import {
  getAvatar,
  getHeader,
  getMedia,
  finalizeMediaUpload,
  presignMediaUpload,
  uploadAvatar,
  uploadHeader,
  uploadMedia,
} from "./media";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
} from "./notifications";
import type { Env } from "./platform";
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  getComments,
  getPostById,
  getPostByPath,
  getPostsByUser,
  getSavedPosts,
  getTimeline,
  searchPosts,
  setLike,
  setRepost,
  setSaved,
  updatePost,
} from "./posts";
import { testStorageConnection } from "./s3";
import {
  accountFromRow,
  clearSessionCookie,
  createSession,
  deleteSession,
  getOptionalUser,
  requireUser,
} from "./security";
import {
  deleteStorageConfig,
  getStorageConfigs,
  getStorageOptions,
  saveStorageConfig,
} from "./storage";
import {
  clearAvatar,
  clearHeader,
  getFollowUsers,
  getUserProfile,
  searchUsers,
  setFollow,
} from "./users";

function withCookie(response: Response, cookie: string): Response {
  response.headers.append("Set-Cookie", cookie);
  return response;
}

function segment(values: string[], index: number): string {
  try {
    return decodeURIComponent(values[index] ?? "");
  } catch {
    throw new HttpError(400, "INVALID_PATH", "Invalid request path.");
  }
}

function routeSegments(pathname: string): string[] {
  return ["", ...pathname.split("/").filter(Boolean)];
}

const POST_ASSET_PATH = /^\/post\/([^/]+)\/([^/]+)\/?$/i;
const USER_ASSET_PATH = /^\/user\/([^/]+)\/?$/i;
const CONNECTIONS_ASSET_PATH = /^\/user\/([^/]+)\/(followers|following)\/?$/i;
const PRETTY_ASSET_PATHS = new Set([
  "/connections",
  "/notice",
  "/saved",
  "/settings",
  "/settings/profile",
  "/settings/security",
  "/settings/storage",
]);

function assetPagePath(pathname: string): string | null {
  if (POST_ASSET_PATH.test(pathname) || pathname === "/post") return "/post/";
  if (CONNECTIONS_ASSET_PATH.test(pathname)) return "/connections/";
  if (USER_ASSET_PATH.test(pathname) || pathname === "/user") return "/user/";
  if (PRETTY_ASSET_PATHS.has(pathname)) return `${pathname}/`;
  return null;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function cacheableAssetResponse(
  response: Response,
  immutable: boolean,
): Response {
  const headers = new Headers(response.headers);
  if (immutable) {
    headers.set(
      "Cache-Control",
      "public, max-age=31536000, s-maxage=31536000, immutable",
    );
    headers.set("CDN-Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAsset(
  request: Request,
  env: Env,
  assetUrl: URL,
  cacheUrl: URL,
  context: WorkerExecutionContext,
  cacheable: boolean,
): Promise<Response> {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(cacheUrl, { method: request.method });
  const cached = cacheable ? await cache.match(cacheKey) : undefined;
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Fuckxter-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  let response = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (response.status === 503) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    response = await env.ASSETS.fetch(new Request(assetUrl, request));
  }
  if (
    !cacheable ||
    !response.ok ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    if ((response.headers.get("Content-Type") ?? "").includes("text/html")) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("CDN-Cache-Control", "no-store");
      headers.set("Cloudflare-CDN-Cache-Control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }

  const stored = cacheableAssetResponse(response, true);
  const headers = new Headers(stored.headers);
  headers.set("X-Fuckxter-Cache", "MISS");
  const result = new Response(stored.body, {
    status: stored.status,
    statusText: stored.statusText,
    headers,
  });
  context.waitUntil(cache.put(cacheKey, result.clone()));
  return result;
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = routeSegments(url.pathname);
  const method = request.method;

  if (parts[1] === "health" && parts.length === 2 && method === "GET") {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{
      ok: number;
    }>();
    return json(
      { ok: result?.ok === 1, service: "fuckxter-api" },
      request,
      env,
    );
  }

  if (parts[1] === "auth") {
    if (parts[2] === "me" && parts.length === 3 && method === "GET") {
      const user = await getOptionalUser(request, env);
      return json(
        { account: user ? await accountFromRow(env, user) : null },
        request,
        env,
      );
    }

    if (
      (parts[2] === "login" || parts[2] === "register") &&
      parts.length === 3 &&
      method === "POST"
    ) {
      const body = await readJson<{
        identifier?: string;
        password?: string;
        code?: string;
      }>(request);
      const result = await loginOrRegister(
        env,
        body.identifier ?? "",
        body.password ?? "",
        body.code,
      );
      const response = json({ account: result.account }, request, env);
      return withCookie(
        response,
        await createSession(env, result.userId, request),
      );
    }

    if (parts[2] === "logout" && parts.length === 3 && method === "POST") {
      await deleteSession(request, env);
      const response = json({ ok: true }, request, env);
      return withCookie(response, clearSessionCookie(request));
    }
  }

  if (parts[1] === "notice" && parts.length === 2) {
    const user = await requireUser(request, env);
    if (method === "GET") {
      const [page, unread] = await Promise.all([
        getNotifications(
          env,
          user.id,
          url.searchParams.get("cursor"),
          url.searchParams.get("limit"),
        ),
        getUnreadNotificationCount(env, user.id),
      ]);
      return json({ ...page, unread }, request, env);
    }
    if (method === "POST") {
      const body = await readJson<{ id?: unknown }>(request);
      if (body.id !== undefined && typeof body.id !== "string") {
        throw new HttpError(400, "INVALID_NOTICE", "Invalid notice id.");
      }
      await markNotificationsRead(env, user.id, body.id);
      return json(
        { unread: await getUnreadNotificationCount(env, user.id) },
        request,
        env,
      );
    }
  }

  if (parts[1] === "timeline" && parts.length === 2 && method === "GET") {
    const user = await getOptionalUser(request, env);
    return json(
      await getTimeline(
        env,
        user?.id ?? null,
        url.searchParams.get("tab") ?? "foryou",
        url.searchParams.get("cursor"),
        url.searchParams.get("limit"),
      ),
      request,
      env,
    );
  }

  if (parts[1] === "media") {
    if (parts.length === 3 && parts[2] === "uploads" && method === "POST") {
      const user = await requireUser(request, env);
      const body = await readJson<{
        storageConfigId?: unknown;
        fileName?: unknown;
        contentType?: unknown;
      }>(request);
      return json(
        {
          upload: await presignMediaUpload(env, user.id, user.handle, {
            storageConfigId:
              typeof body.storageConfigId === "string"
                ? body.storageConfigId
                : undefined,
            fileName:
              typeof body.fileName === "string" ? body.fileName : undefined,
            contentType:
              typeof body.contentType === "string"
                ? body.contentType
                : undefined,
          }),
        },
        request,
        env,
        { status: 201 },
      );
    }

    if (parts.length === 3 && parts[2] === "finalize" && method === "POST") {
      const user = await requireUser(request, env);
      const body = await readJson<{
        objectKey?: unknown;
        originalName?: unknown;
        contentType?: unknown;
        storageConfigId?: unknown;
      }>(request);
      return json(
        {
          media: await finalizeMediaUpload(env, user.id, user.handle, {
            objectKey:
              typeof body.objectKey === "string" ? body.objectKey : undefined,
            originalName:
              typeof body.originalName === "string"
                ? body.originalName
                : undefined,
            contentType:
              typeof body.contentType === "string"
                ? body.contentType
                : undefined,
            storageConfigId:
              typeof body.storageConfigId === "string"
                ? body.storageConfigId
                : null,
          }),
        },
        request,
        env,
        { status: 201 },
      );
    }

    if (parts.length === 2 && method === "POST") {
      const user = await requireUser(request, env);
      return json(
        { media: await uploadMedia(request, env, user.id, user.handle) },
        request,
        env,
        { status: 201 },
      );
    }

    if (parts.length === 3 && method === "GET") {
      const media = await getMedia(env, segment(parts, 2));
      const headers = corsHeaders(request, env);
      headers.set("Content-Type", media.contentType);
      headers.set("Content-Length", String(media.size));
      headers.set("Content-Disposition", "inline");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("ETag", `"${media.etag}"`);
      return new Response(media.body, { status: 200, headers });
    }
  }

  if (
    parts[1] === "avatars" &&
    parts.length === 3 &&
    (method === "GET" || method === "HEAD")
  ) {
    const avatar = await getAvatar(env, segment(parts, 2));
    const headers = corsHeaders(request, env);
    headers.set("Content-Type", avatar.contentType);
    headers.set("Content-Length", String(avatar.size));
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", `"${avatar.etag}"`);
    return new Response(method === "HEAD" ? null : avatar.body, {
      status: 200,
      headers,
    });
  }

  if (
    parts[1] === "headers" &&
    parts.length === 3 &&
    (method === "GET" || method === "HEAD")
  ) {
    const header = await getHeader(env, segment(parts, 2));
    const headers = corsHeaders(request, env);
    headers.set("Content-Type", header.contentType);
    headers.set("Content-Length", String(header.size));
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", `"${header.etag}"`);
    return new Response(method === "HEAD" ? null : header.body, {
      status: 200,
      headers,
    });
  }

  if (parts[1] === "search" && parts.length === 2 && method === "GET") {
    const user = await getOptionalUser(request, env);
    const query = url.searchParams.get("q") ?? "";
    const [postResult, users] = await Promise.all([
      searchPosts(env, user?.id ?? null, query),
      searchUsers(env, query),
    ]);
    return json({ ...postResult, users }, request, env);
  }

  if (parts[1] === "me") {
    const user = await requireUser(request, env);

    if (parts.length === 2 && method === "PATCH") {
      const body = await readJson<Record<string, string>>(request);
      return json(
        { account: await updateProfile(env, user.id, body) },
        request,
        env,
      );
    }

    if (parts[2] === "email" && parts.length === 3 && method === "PUT") {
      const body = await readJson<{ email?: string; password?: string }>(
        request,
      );
      return json(
        {
          account: await changeEmail(
            env,
            user.id,
            body.email ?? "",
            body.password ?? "",
          ),
        },
        request,
        env,
      );
    }

    if (parts[2] === "password" && parts.length === 3 && method === "PUT") {
      const body = await readJson<{ current?: string; next?: string }>(request);
      await changePassword(env, user.id, body.current ?? "", body.next ?? "");
      return json({ ok: true }, request, env);
    }

    if (parts[2] === "saved" && parts.length === 3 && method === "GET") {
      return json({ posts: await getSavedPosts(env, user.id) }, request, env);
    }

    if (
      parts[2] === "avatar" &&
      parts.length === 3 &&
      (method === "PUT" || method === "DELETE")
    ) {
      if (method === "PUT") {
        await uploadAvatar(request, env, user.id, user.handle);
      } else await clearAvatar(env, user.id);
      const updated = await requireUser(request, env);
      return json(
        { account: await accountFromRow(env, updated) },
        request,
        env,
      );
    }

    if (
      parts[2] === "header" &&
      parts.length === 3 &&
      (method === "PUT" || method === "DELETE")
    ) {
      if (method === "PUT") {
        await uploadHeader(request, env, user.id, user.handle);
      } else await clearHeader(env, user.handle);
      const updated = await requireUser(request, env);
      return json(
        { account: await accountFromRow(env, updated) },
        request,
        env,
      );
    }

    if (parts[2] === "2fa" && parts[3] === "setup" && method === "POST") {
      return json(await beginTwoFactor(env, user.id), request, env);
    }

    if (parts[2] === "2fa" && parts[3] === "confirm" && method === "POST") {
      const body = await readJson<{ code?: string }>(request);
      return json(
        await confirmTwoFactor(env, user.id, body.code ?? ""),
        request,
        env,
      );
    }

    if (
      parts[2] === "2fa" &&
      parts[3] === "recovery-codes" &&
      method === "POST"
    ) {
      return json(await replaceRecoveryCodes(env, user.id), request, env);
    }

    if (parts[2] === "storage" && parts[3] === "options" && method === "GET") {
      return json(
        { options: await getStorageOptions(env, user.id) },
        request,
        env,
      );
    }

    if (parts[2] === "storage" && parts.length === 3) {
      if (method === "GET") {
        const configs = await getStorageConfigs(env, user.id);
        return json(
          {
            configs,
            defaultId: configs.find((config) => config.isDefault)?.id ?? null,
          },
          request,
          env,
        );
      }
      if (method === "POST") {
        const body = await readJson<Record<string, unknown>>(request);
        return json(
          {
            config: await saveStorageConfig(env, user.id, {
              endpoint: String(body.endpoint ?? ""),
              region: String(body.region ?? ""),
              bucket: String(body.bucket ?? ""),
              accessKeyId: String(body.accessKeyId ?? ""),
              secretAccessKey: String(body.secretAccessKey ?? ""),
              pathStyle: Boolean(body.pathStyle),
              name: String(body.name ?? ""),
              isDefault: Boolean(body.isDefault),
            }),
          },
          request,
          env,
          { status: 201 },
        );
      }
    }

    if (parts[2] === "storage" && parts.length === 4) {
      const configId = segment(parts, 3);
      if (method === "PUT") {
        const body = await readJson<Record<string, unknown>>(request);
        return json(
          {
            config: await saveStorageConfig(env, user.id, {
              id: configId,
              endpoint: String(body.endpoint ?? ""),
              region: String(body.region ?? ""),
              bucket: String(body.bucket ?? ""),
              accessKeyId: String(body.accessKeyId ?? ""),
              secretAccessKey: String(body.secretAccessKey ?? ""),
              pathStyle: Boolean(body.pathStyle),
              name: String(body.name ?? ""),
              isDefault: Boolean(body.isDefault),
            }),
          },
          request,
          env,
        );
      }
      if (method === "DELETE") {
        await deleteStorageConfig(env, user.id, configId);
        return json({ ok: true }, request, env);
      }
    }

    if (parts[2] === "storage" && parts[3] === "test" && method === "POST") {
      const body = await readJson<Record<string, unknown>>(request);
      return json(
        {
          message: await testStorageConnection({
            endpoint: String(body.endpoint ?? ""),
            region: String(body.region ?? ""),
            bucket: String(body.bucket ?? ""),
            accessKeyId: String(body.accessKeyId ?? ""),
            secretAccessKey: String(body.secretAccessKey ?? ""),
            pathStyle: Boolean(body.pathStyle),
          }),
        },
        request,
        env,
      );
    }
  }

  if (parts[1] === "posts") {
    if (parts.length === 2 && method === "POST") {
      const user = await requireUser(request, env);
      const body = await readJson<{ text?: unknown; mediaId?: unknown }>(
        request,
      );
      if (typeof body.text !== "string") {
        throw new HttpError(400, "INVALID_POST", "Post text is required.");
      }
      if (body.mediaId !== undefined && typeof body.mediaId !== "string") {
        throw new HttpError(400, "INVALID_MEDIA", "Invalid media reference.");
      }
      return json(
        await createPost(env, user.id, body.text, body.mediaId),
        request,
        env,
        { status: 201 },
      );
    }

    if (parts.length === 3) {
      const postId = segment(parts, 2);
      const user = await getOptionalUser(request, env);

      if (method === "GET") {
        const post = await getPostById(env, user?.id ?? null, postId);
        if (!post)
          throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");
        return json(post, request, env);
      }

      if (method === "PATCH" || method === "DELETE") {
        const actor = await requireUser(request, env);
        if (method === "DELETE") {
          await deletePost(env, actor.id, postId);
          return json({ ok: true }, request, env);
        }
        const body = await readJson<{ text?: string }>(request);
        return json(
          await updatePost(env, actor.id, postId, body.text ?? ""),
          request,
          env,
        );
      }
    }

    if (parts.length === 4) {
      const postId = segment(parts, 2);
      const action = parts[3];

      if (action === "comments" && method === "GET") {
        return json(await getComments(env, postId), request, env);
      }

      if (action === "comments" && method === "POST") {
        const user = await requireUser(request, env);
        const body = await readJson<{ text?: string }>(request);
        return json(
          {
            comment: await createComment(env, user.id, postId, body.text ?? ""),
          },
          request,
          env,
          { status: 201 },
        );
      }

      if (
        (action === "like" || action === "repost" || action === "save") &&
        (method === "PUT" || method === "DELETE")
      ) {
        const user = await requireUser(request, env);
        const active = method === "PUT";
        if (action === "like") {
          return json(
            await setLike(env, user.id, postId, active),
            request,
            env,
          );
        }
        if (action === "repost") {
          return json(
            await setRepost(env, user.id, postId, active),
            request,
            env,
          );
        }
        return json(
          { posts: await setSaved(env, user.id, postId, active) },
          request,
          env,
        );
      }
    }

    if (parts.length === 5 && parts[3] === "comments" && method === "DELETE") {
      const user = await requireUser(request, env);
      await deleteComment(env, user.id, segment(parts, 2), segment(parts, 4));
      return json({ ok: true }, request, env);
    }

    if (parts.length === 4 && method === "GET") {
      const user = await getOptionalUser(request, env);
      const post = await getPostByPath(
        env,
        user?.id ?? null,
        segment(parts, 2),
        segment(parts, 3),
      );
      if (!post) throw new HttpError(404, "POST_NOT_FOUND", "Post not found.");
      return json(post, request, env);
    }
  }

  if (
    parts[1] === "users" &&
    (parts[3] === "followers" || parts[3] === "following") &&
    parts.length === 4 &&
    method === "GET"
  ) {
    return json(
      {
        users: await getFollowUsers(
          env,
          segment(parts, 2),
          parts[3] === "followers" ? "followers" : "following",
        ),
      },
      request,
      env,
    );
  }

  if (parts[1] === "users" && parts.length === 3 && method === "GET") {
    const user = await getOptionalUser(request, env);
    const profile = await getUserProfile(
      env,
      user?.id ?? null,
      segment(parts, 2),
    );
    if (!profile) throw new HttpError(404, "USER_NOT_FOUND", "User not found.");
    return json({ user: profile }, request, env);
  }

  if (
    parts[1] === "users" &&
    parts[3] === "follow" &&
    parts.length === 4 &&
    (method === "PUT" || method === "DELETE")
  ) {
    const user = await requireUser(request, env);
    return json(
      await setFollow(env, user.id, segment(parts, 2), method === "PUT"),
      request,
      env,
    );
  }

  if (parts[1] === "users" && parts[3] === "posts" && method === "GET") {
    const user = await getOptionalUser(request, env);
    return json(
      {
        posts: await getPostsByUser(env, user?.id ?? null, segment(parts, 2)),
      },
      request,
      env,
    );
  }

  throw new HttpError(404, "NOT_FOUND", "Endpoint not found.");
}

export default {
  async fetch(
    request: Request,
    env: Env,
    context: WorkerExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const isApiHost =
      hostname === "api.fuckxter.site" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    if (!isApiHost) {
      const assetPath = assetPagePath(url.pathname);
      const fileName = url.pathname.split("/").at(-1) ?? "";
      const cacheable = !assetPath && fileName.includes(".");
      if (
        assetPath &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const assetUrl = new URL(url);
        assetUrl.pathname = assetPath;
        const cacheUrl = new URL(assetUrl);
        cacheUrl.search = "";
        return fetchAsset(request, env, assetUrl, cacheUrl, context, cacheable);
      }
      return fetchAsset(request, env, url, url, context, cacheable);
    }

    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    try {
      assertTrustedOrigin(request, env);
      return await route(request, env, url);
    } catch (error) {
      return errorResponse(error, request, env);
    }
  },
};
