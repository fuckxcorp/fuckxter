import { loginOrRegister } from "../accounts/accounts";
import {
  accountFromRow,
  clearSessionCookie,
  createSession,
  deleteSession,
  getOptionalUser,
} from "../accounts/security";
import { json, readJson } from "../shared/http";
import { enqueueJob } from "../shared/jobs";
import { limitLogin } from "../shared/rate-limit";
import { withCookie } from "../shared/router";
import type { RouteHandler } from "../shared/router";

export const authRoutes: RouteHandler = async ({
  request,
  env,
  parts,
  method,
  context,
}) => {
  if (parts[1] !== "auth" || parts.length !== 3) return null;

  if (parts[2] === "me" && method === "GET") {
    const user = await getOptionalUser(request, env);
    return json(
      { account: user ? await accountFromRow(env, user) : null },
      request,
      env,
    );
  }

  if ((parts[2] === "login" || parts[2] === "register") && method === "POST") {
    const body = await readJson<{
      identifier?: string;
      password?: string;
      code?: string;
      recoveryCode?: string;
    }>(request);
    await limitLogin(env, request, body.identifier ?? "");
    const result = await loginOrRegister(
      env,
      body.identifier ?? "",
      body.password ?? "",
      body.code,
      body.recoveryCode,
      request.headers.get("CF-Connecting-IP") || "unknown",
    );
    const response = json(
      { account: result.account, restored: Boolean(result.restored) },
      request,
      env,
    );
    // 新注册：欢迎通知丢后台，不占注册响应的时间
    if (result.created) {
      context.waitUntil(
        enqueueJob(env, {
          type: "notification.welcome",
          userId: result.userId,
        }),
      );
    }
    return withCookie(
      response,
      await createSession(env, result.userId, request),
    );
  }

  if (parts[2] === "logout" && method === "POST") {
    await deleteSession(request, env);
    const response = json({ ok: true }, request, env);
    return withCookie(response, clearSessionCookie(request));
  }

  return null;
};
