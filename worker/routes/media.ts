import { getOptionalUser, requireUser } from "../accounts/security";
import {
  displayImage,
  displayWidth,
  expectedMediaEtag,
  finalizeMediaUpload,
  getAvatar,
  getHeader,
  getMediaAccess,
  presignMediaUpload,
  readMedia,
  uploadMedia,
} from "../posts/media";
import { corsHeaders, json, readJson } from "../shared/http";
import type { Env } from "../shared/platform";
import { rateLimit } from "../shared/rate-limit";
import { segment, stringFields } from "../shared/router";
import type { RouteHandler } from "../shared/router";

/**
 * public：匿名也能看的图。浏览器存一小时，边缘只存五分钟，
 * 这样帖子改成私密或删除后，最多五分钟就不会再发给新访客。
 * private：只进这个人自己的浏览器缓存，每次都回源校验权限。
 * profile：头像和头图，地址里带了资料更新时间。
 */
type ImageCache = "public" | "private" | "profile";

interface Image {
  body: ReadableStream | ArrayBuffer;
  contentType: string;
  size: number;
  etag: string;
}

function imageHeaders(
  request: Request,
  env: Env,
  etag: string,
  cache: ImageCache,
): Headers {
  const headers = corsHeaders(request, env);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("ETag", `"${etag}"`);
  if (cache === "public") {
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("CDN-Cache-Control", "public, max-age=300");
  } else if (cache === "private") {
    headers.set("Cache-Control", "private, no-cache");
    headers.set("CDN-Cache-Control", "no-store");
    headers.append("Vary", "Cookie");
  } else {
    headers.set("Cache-Control", "public, max-age=300, must-revalidate");
  }
  return headers;
}

export function etagMatches(request: Request, etag: string): boolean {
  const header = request.headers.get("If-None-Match");
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, ""))
    .some((value) => value === "*" || value === etag);
}

function notModified(
  request: Request,
  env: Env,
  etag: string,
  cache: ImageCache,
): Response {
  return new Response(null, {
    status: 304,
    headers: imageHeaders(request, env, etag, cache),
  });
}

async function imageResponse(
  request: Request,
  env: Env,
  image: Image,
  cache: ImageCache,
): Promise<Response> {
  if (etagMatches(request, image.etag)) {
    if (!(image.body instanceof ArrayBuffer)) await image.body.cancel();
    return notModified(request, env, image.etag, cache);
  }
  const headers = imageHeaders(request, env, image.etag, cache);
  headers.set("Content-Type", image.contentType);
  headers.set("Content-Length", String(image.size));
  headers.set("Content-Disposition", "inline");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  if (request.method === "HEAD") {
    if (!(image.body instanceof ArrayBuffer)) await image.body.cancel();
    return new Response(null, { status: 200, headers });
  }
  return new Response(image.body, { status: 200, headers });
}

const UPLOAD_FIELDS = ["storageConfigId", "fileName", "contentType"] as const;
const FINALIZE_FIELDS = [
  "objectKey",
  "originalName",
  "contentType",
  "storageConfigId",
] as const;

export const mediaRoutes: RouteHandler = async ({
  request,
  env,
  url,
  parts,
  method,
}) => {
  if (parts[1] === "media") {
    if (parts.length === 3 && parts[2] === "uploads" && method === "POST") {
      const user = await requireUser(request, env);
      await rateLimit(env, `upload:${user.id}`, 100, 3600);
      const body = await readJson<Record<string, unknown>>(request);
      return json(
        {
          upload: await presignMediaUpload(
            env,
            user.id,
            stringFields(body, UPLOAD_FIELDS),
          ),
        },
        request,
        env,
        { status: 201 },
      );
    }

    if (parts.length === 3 && parts[2] === "finalize" && method === "POST") {
      const user = await requireUser(request, env);
      const body = await readJson<Record<string, unknown>>(request);
      const fields = stringFields(body, FINALIZE_FIELDS);
      return json(
        {
          media: await finalizeMediaUpload(env, user.id, {
            ...fields,
            storageConfigId: fields.storageConfigId ?? null,
          }),
        },
        request,
        env,
        { status: 201 },
      );
    }

    if (parts.length === 2 && method === "POST") {
      const user = await requireUser(request, env);
      await rateLimit(env, `upload:${user.id}`, 100, 3600);
      return json(
        { media: await uploadMedia(request, env, user.id) },
        request,
        env,
        { status: 201 },
      );
    }

    if (parts.length === 3 && method === "GET") {
      const viewer = await getOptionalUser(request, env);
      const width = displayWidth(url);
      const preview =
        width === null && url.searchParams.get("preview") === "640";
      const { row, isPublic } = await getMediaAccess(
        env,
        segment(parts, 2),
        viewer?.id ?? null,
      );
      const cache: ImageCache = isPublic ? "public" : "private";
      // 浏览器手里的版本还是最新的：权限已经验过，不用再去读 R2 / S3
      const expected = expectedMediaEtag(env, row, width, preview);
      if (expected && etagMatches(request, expected)) {
        return notModified(request, env, expected, cache);
      }
      const media = await displayImage(
        env,
        await readMedia(env, row, preview),
        width,
      );
      return imageResponse(request, env, media, cache);
    }

    return null;
  }

  if (
    (parts[1] === "avatars" || parts[1] === "headers") &&
    parts.length === 3 &&
    (method === "GET" || method === "HEAD")
  ) {
    const handle = segment(parts, 2);
    const width = displayWidth(url);
    const source =
      parts[1] === "avatars"
        ? await getAvatar(env, handle)
        : await getHeader(env, handle);
    return imageResponse(
      request,
      env,
      await displayImage(env, source, width),
      "profile",
    );
  }

  return null;
};
