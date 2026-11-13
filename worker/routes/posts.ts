import { getOptionalUser, requireUser } from "../accounts/security";
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  getComments,
  getPostByID,
  getPostByPath,
  normalizeVisibility,
  quotePost,
  recordPostView,
  recordPostViews,
  setCommentInteraction,
  setLike,
  setRepost,
  setSaved,
  updatePost,
} from "../posts/posts";
import { HttpError, json, readJson } from "../shared/http";
import { limitAction, limitViews } from "../shared/rate-limit";
import { isStringArray, segment } from "../shared/router";
import type { RouteContext, RouteHandler } from "../shared/router";

/** /posts 和 /posts/views */
async function collection({ request, env, parts, method }: RouteContext) {
  if (parts[2] === "views" && parts.length === 3 && method === "POST") {
    const body = await readJson<{ ids?: unknown }>(request);
    if (!isStringArray(body.ids, 20))
      throw new HttpError(400, "INVALID_POST", "帖子参数无效。");
    const viewer = await getOptionalUser(request, env);
    await limitViews(env, request, viewer);
    return json(
      await recordPostViews(env, request, viewer?.id ?? null, body.ids),
      request,
      env,
    );
  }

  if (parts.length === 2 && method === "POST") {
    const user = await requireUser(request, env);
    const body = await readJson<{
      text?: unknown;
      mediaIDs?: unknown;
      visibility?: unknown;
      hdr?: unknown;
    }>(request);
    if (typeof body.text !== "string") {
      throw new HttpError(400, "INVALID_POST", "帖子内容不能为空。");
    }
    if (body.mediaIDs !== undefined && !isStringArray(body.mediaIDs, 10)) {
      throw new HttpError(400, "INVALID_MEDIA", "图片引用无效。");
    }
    await limitAction(env, request, user, "publish");
    return json(
      await createPost(
        env,
        user.id,
        body.text,
        body.mediaIDs,
        normalizeVisibility(body.visibility),
        body.hdr === true,
      ),
      request,
      env,
      { status: 201 },
    );
  }

  return null;
}

/** /posts/:id */
async function single({ request, env, parts, method }: RouteContext) {
  const postId = segment(parts, 2);
  const user = await getOptionalUser(request, env);

  if (method === "GET") {
    const post = await getPostByID(env, user?.id ?? null, postId);
    if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
    return json(post, request, env);
  }

  if (method === "PATCH" || method === "DELETE") {
    const actor = await requireUser(request, env);
    await limitAction(env, request, actor, "interact");
    if (method === "DELETE") {
      await deletePost(env, actor.id, postId);
      return json({ ok: true }, request, env);
    }
    const body = await readJson<{
      text?: string;
      visibility?: unknown;
      hdr?: unknown;
    }>(request);
    return json(
      await updatePost(
        env,
        actor.id,
        postId,
        body.text ?? "",
        typeof body.visibility === "string"
          ? normalizeVisibility(body.visibility)
          : undefined,
        typeof body.hdr === "boolean" ? body.hdr : undefined,
      ),
      request,
      env,
    );
  }

  return null;
}

/** /posts/:id/:action，以及按 /posts/:handle/:slug 取帖子 */
async function action({ request, env, url, parts, method }: RouteContext) {
  const postId = segment(parts, 2);
  const name = parts[3];

  if (name === "quote" && method === "POST") {
    const user = await requireUser(request, env);
    const body = await readJson<{ text?: unknown }>(request);
    if (body.text !== undefined && typeof body.text !== "string")
      throw new HttpError(400, "INVALID_POST", "评论内容无效。");
    await limitAction(env, request, user, "publish");
    return json(
      await quotePost(env, user.id, postId, body.text ?? ""),
      request,
      env,
      { status: 201 },
    );
  }

  if (name === "view" && method === "POST") {
    const user = await getOptionalUser(request, env);
    await limitViews(env, request, user);
    return json(
      await recordPostView(env, request, user?.id ?? null, postId),
      request,
      env,
    );
  }

  if (name === "comments" && method === "GET") {
    const user = await getOptionalUser(request, env);
    return json(
      await getComments(
        env,
        user?.id ?? null,
        postId,
        url.searchParams.get("cursor"),
        url.searchParams.get("focus"),
      ),
      request,
      env,
    );
  }

  if (name === "comments" && method === "POST") {
    const user = await requireUser(request, env);
    const body = await readJson<{
      text?: string;
      parentId?: unknown;
      mediaIDs?: unknown;
    }>(request);
    if (body.parentId !== undefined && typeof body.parentId !== "string") {
      throw new HttpError(400, "INVALID_COMMENT", "回覆的目标无效。");
    }
    if (body.mediaIDs !== undefined && !isStringArray(body.mediaIDs)) {
      throw new HttpError(400, "INVALID_MEDIA", "图片参数无效。");
    }
    await limitAction(env, request, user, "publish");
    return json(
      {
        comment: await createComment(
          env,
          user.id,
          postId,
          body.text ?? "",
          body.parentId,
          body.mediaIDs,
        ),
      },
      request,
      env,
      { status: 201 },
    );
  }

  if (
    (name === "like" || name === "repost" || name === "save") &&
    (method === "PUT" || method === "DELETE")
  ) {
    const user = await requireUser(request, env);
    const active = method === "PUT";
    await limitAction(
      env,
      request,
      user,
      name === "repost" && active ? "publish" : "interact",
    );
    if (name === "like") {
      return json(await setLike(env, user.id, postId, active), request, env);
    }
    if (name === "repost") {
      return json(await setRepost(env, user.id, postId, active), request, env);
    }
    return json(
      { posts: await setSaved(env, user.id, postId, active) },
      request,
      env,
    );
  }

  if (method === "GET") {
    const user = await getOptionalUser(request, env);
    const post = await getPostByPath(
      env,
      user?.id ?? null,
      postId,
      segment(parts, 3),
    );
    if (!post) throw new HttpError(404, "POST_NOT_FOUND", "帖子不存在。");
    return json(post, request, env);
  }

  return null;
}

/** /posts/:id/comments/:commentId 及其 like / repost */
async function comment({ request, env, parts, method }: RouteContext) {
  if (parts[3] !== "comments") return null;

  if (parts.length === 5 && method === "DELETE") {
    const user = await requireUser(request, env);
    await limitAction(env, request, user, "interact");
    const deleted = await deleteComment(
      env,
      user.id,
      segment(parts, 2),
      segment(parts, 4),
    );
    return json({ ok: true, deleted }, request, env);
  }

  const kind = parts[5];
  if (
    parts.length === 6 &&
    (kind === "like" || kind === "repost") &&
    (method === "PUT" || method === "DELETE")
  ) {
    const user = await requireUser(request, env);
    const active = method === "PUT";
    await limitAction(
      env,
      request,
      user,
      kind === "repost" && active ? "publish" : "interact",
    );
    return json(
      await setCommentInteraction(
        env,
        user.id,
        segment(parts, 2),
        segment(parts, 4),
        kind,
        active,
      ),
      request,
      env,
    );
  }

  return null;
}

export const postRoutes: RouteHandler = async (route) => {
  const { parts } = route;
  if (parts[1] !== "posts") return null;
  if (parts.length <= 3) {
    return (
      (await collection(route)) ??
      (parts.length === 3 ? await single(route) : null)
    );
  }
  if (parts.length === 4) return action(route);
  return comment(route);
};
