import { getOptionalUser, requireUser } from "../accounts/security";
import {
  getFollowUsers,
  getUserProfile,
  setBlock,
  setFollow,
} from "../accounts/users";
import { getPostsByUserPage } from "../posts/posts";
import { HttpError, json } from "../shared/http";
import { limitAction } from "../shared/rate-limit";
import { segment } from "../shared/router";
import type { RouteHandler } from "../shared/router";

export const userRoutes: RouteHandler = async ({
  request,
  env,
  url,
  parts,
  method,
}) => {
  if (parts[1] !== "users") return null;

  if (parts.length === 3 && method === "GET") {
    const user = await getOptionalUser(request, env);
    const profile = await getUserProfile(
      env,
      user?.id ?? null,
      segment(parts, 2),
    );
    if (!profile) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在。");
    return json({ user: profile }, request, env);
  }

  if (parts.length !== 4) return null;
  const handle = segment(parts, 2);
  const action = parts[3];

  if ((action === "followers" || action === "following") && method === "GET") {
    return json(
      { users: await getFollowUsers(env, handle, action) },
      request,
      env,
    );
  }

  if (
    (action === "follow" || action === "block") &&
    (method === "PUT" || method === "DELETE")
  ) {
    const user = await requireUser(request, env);
    await limitAction(env, request, user, "interact");
    const active = method === "PUT";
    return json(
      action === "follow"
        ? await setFollow(env, user.id, handle, active)
        : await setBlock(env, user.id, handle, active),
      request,
      env,
    );
  }

  if (action === "posts" && method === "GET") {
    const user = await getOptionalUser(request, env);
    return json(
      await getPostsByUserPage(
        env,
        user?.id ?? null,
        handle,
        url.searchParams.get("cursor"),
        url.searchParams.get("limit"),
      ),
      request,
      env,
    );
  }

  return null;
};
