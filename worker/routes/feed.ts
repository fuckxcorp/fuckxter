import { getOptionalUser } from "../accounts/security";
import { searchUsers } from "../accounts/users";
import { getTimeline, searchPosts } from "../posts/posts";
import { json } from "../shared/http";
import { limitRead } from "../shared/rate-limit";
import type { RouteHandler } from "../shared/router";

export const feedRoutes: RouteHandler = async ({
  request,
  env,
  url,
  parts,
  method,
}) => {
  if (parts.length !== 2 || method !== "GET") return null;

  if (parts[1] === "health") {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{
      ok: number;
    }>();
    return json(
      { ok: result?.ok === 1, service: "fuckxter-api" },
      request,
      env,
    );
  }

  if (parts[1] === "timeline") {
    await limitRead(env, request, "read");
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

  if (parts[1] === "search") {
    await limitRead(env, request, "search");
    const user = await getOptionalUser(request, env);
    const query = url.searchParams.get("q") ?? "";
    const [postResult, users] = await Promise.all([
      searchPosts(env, user?.id ?? null, query),
      searchUsers(env, query),
    ]);
    return json({ ...postResult, users }, request, env);
  }

  return null;
};
