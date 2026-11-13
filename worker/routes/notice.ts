import { requireUser } from "../accounts/security";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
} from "../notifications/notifications";
import { HttpError, json, readJson } from "../shared/http";
import type { RouteHandler } from "../shared/router";

export const noticeRoutes: RouteHandler = async ({
  request,
  env,
  url,
  parts,
  method,
}) => {
  if (parts[1] !== "notice" || parts.length !== 2) return null;
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
      throw new HttpError(400, "INVALID_NOTICE", "通知 ID 无效。");
    }
    await markNotificationsRead(env, user.id, body.id);
    return json(
      { unread: await getUnreadNotificationCount(env, user.id) },
      request,
      env,
    );
  }

  return null;
};
