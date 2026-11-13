import { requireUser } from "../accounts/security";
import {
  countUnreadMessages,
  getConversation,
  listConversations,
  listMessageSuggestions,
  markConversationRead,
  recallMessage,
  sendMessage,
} from "../messages/messages";
import { HttpError, json, readJson } from "../shared/http";
import { limitAction } from "../shared/rate-limit";
import { segment } from "../shared/router";
import type { RouteHandler } from "../shared/router";

export const messageRoutes: RouteHandler = async ({
  request,
  env,
  url,
  parts,
  method,
  context,
}) => {
  if (parts[1] !== "messages") return null;
  const user = await requireUser(request, env);

  if (parts.length === 3 && parts[2] === "live" && method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "UPGRADE_REQUIRED", "需要 WebSocket 连接。");
    }
    const hub = env.DM_HUB.get(env.DM_HUB.idFromName(user.id));
    return hub.fetch(new Request("https://dm-hub/connect", request));
  }

  if (parts.length === 2 && method === "GET") {
    const [threads, unread, suggestions] = await Promise.all([
      listConversations(env, user.id),
      countUnreadMessages(env, user.id),
      listMessageSuggestions(env, user.id),
    ]);
    return json({ threads, unread, suggestions }, request, env);
  }

  if (parts.length === 3) {
    const handle = segment(parts, 2);
    if (method === "GET") {
      const conversation = await getConversation(
        env,
        user.id,
        handle,
        url.searchParams.get("before"),
        url.searchParams.get("after"),
      );
      return json(
        { ...conversation, unread: await countUnreadMessages(env, user.id) },
        request,
        env,
      );
    }
    if (method === "POST") {
      const body = await readJson<{ text?: unknown }>(request);
      if (typeof body.text !== "string") {
        throw new HttpError(400, "INVALID_MESSAGE", "私信内容无效。");
      }
      await limitAction(env, request, user, "message", handle);
      return json(
        await sendMessage(env, user.id, handle, body.text, (promise) =>
          context.waitUntil(promise),
        ),
        request,
        env,
        { status: 201 },
      );
    }
  }

  if (parts.length === 4 && parts[3] === "read" && method === "POST") {
    await limitAction(env, request, user, "interact");
    await markConversationRead(env, user.id, segment(parts, 2));
    return json(
      { unread: await countUnreadMessages(env, user.id) },
      request,
      env,
    );
  }

  if (parts.length === 4 && method === "DELETE") {
    await limitAction(env, request, user, "interact");
    const handle = segment(parts, 2);
    return json(
      await recallMessage(env, user.id, handle, segment(parts, 3)),
      request,
      env,
    );
  }

  return null;
};
