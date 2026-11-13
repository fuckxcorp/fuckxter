import type { SecurityProof } from "../accounts/accounts";
import {
  beginTwoFactor,
  changeEmail,
  changePassword,
  confirmTwoFactor,
  replaceRecoveryCodes,
  requestAccountDeletion,
  updateDmPolicy,
  updateProfile,
} from "../accounts/accounts";
import { testStorageConnection } from "../accounts/s3";
import {
  accountFromRow,
  clearSessionCookie,
  createSession,
  requireUser,
} from "../accounts/security";
import { clearAvatar, clearHeader } from "../accounts/users";
import { uploadAvatar, uploadHeader } from "../posts/media";
import { getSavedPosts } from "../posts/posts";
import {
  deleteStorageConfig,
  getStorageConfigs,
  getStorageOptions,
  saveStorageConfig,
} from "../posts/storage";
import { json, readJson } from "../shared/http";
import { rateLimit } from "../shared/rate-limit";
import { segment, withCookie } from "../shared/router";
import type { RouteHandler } from "../shared/router";

function storageConnection(body: Record<string, unknown>) {
  return {
    endpoint: String(body.endpoint ?? ""),
    region: String(body.region ?? ""),
    bucket: String(body.bucket ?? ""),
    accessKeyId: String(body.accessKeyId ?? ""),
    secretAccessKey: String(body.secretAccessKey ?? ""),
    pathStyle: Boolean(body.pathStyle),
  };
}

function storageInput(body: Record<string, unknown>) {
  return {
    ...storageConnection(body),
    name: String(body.name ?? ""),
    isDefault: Boolean(body.isDefault),
    enabled: body.enabled !== false,
  };
}

export const meRoutes: RouteHandler = async ({
  request,
  env,
  parts,
  method,
}) => {
  if (parts[1] !== "me") return null;
  const user = await requireUser(request, env);
  if (!["GET", "HEAD"].includes(method))
    await rateLimit(env, `security:${user.id}`, 30, 600);

  /** 改完资料后重新读一遍用户，返回最新的账号信息。 */
  const currentAccount = async () =>
    json(
      {
        account: await accountFromRow(env, await requireUser(request, env)),
      },
      request,
      env,
    );

  if (parts.length === 2 && method === "PATCH") {
    const body = await readJson<Record<string, string>>(request);
    return json(
      { account: await updateProfile(env, user.id, body) },
      request,
      env,
    );
  }

  if (parts.length === 2 && method === "DELETE") {
    await requestAccountDeletion(env, user.id);
    const response = json({ ok: true }, request, env);
    return withCookie(response, clearSessionCookie(request));
  }

  // 私信权限单独一个接口：资料那套 PATCH 会把没传的字段当空值写回去
  if (parts[2] === "dm-policy" && parts.length === 3 && method === "PATCH") {
    const body = await readJson<{ policy?: unknown }>(request);
    await updateDmPolicy(env, user.id, body.policy);
    return currentAccount();
  }

  if (parts[2] === "email" && parts.length === 3 && method === "PUT") {
    const body = await readJson<{ email?: string; password?: string }>(request);
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
    return withCookie(
      json({ ok: true }, request, env),
      await createSession(env, user.id, request),
    );
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
    return currentAccount();
  }

  if (
    parts[2] === "header" &&
    parts.length === 3 &&
    (method === "PUT" || method === "DELETE")
  ) {
    if (method === "PUT") {
      await uploadHeader(request, env, user.id, user.handle);
    } else await clearHeader(env, user.handle);
    return currentAccount();
  }

  if (parts[2] === "2fa" && parts.length === 4 && method === "POST") {
    if (parts[3] === "setup") {
      const proof = await readJson<SecurityProof>(request);
      return json(
        await beginTwoFactor(env, user.id, user.session_id, proof),
        request,
        env,
      );
    }
    if (parts[3] === "confirm") {
      const body = await readJson<{ code?: string }>(request);
      return json(
        await confirmTwoFactor(env, user.id, user.session_id, body.code ?? ""),
        request,
        env,
      );
    }
    if (parts[3] === "recovery-codes") {
      const proof = await readJson<SecurityProof>(request);
      return json(
        await replaceRecoveryCodes(env, user.id, proof),
        request,
        env,
      );
    }
  }

  if (parts[2] === "storage") {
    if (parts.length === 3 && method === "GET") {
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

    if (parts.length === 3 && method === "POST") {
      const body = await readJson<Record<string, unknown>>(request);
      return json(
        { config: await saveStorageConfig(env, user.id, storageInput(body)) },
        request,
        env,
        { status: 201 },
      );
    }

    // options 和 test 是固定路径，必须排在 /me/storage/:id 前面
    if (parts.length === 4 && parts[3] === "options" && method === "GET") {
      return json(
        { options: await getStorageOptions(env, user.id) },
        request,
        env,
      );
    }

    if (parts.length === 4 && parts[3] === "test" && method === "POST") {
      const body = await readJson<Record<string, unknown>>(request);
      return json(
        { message: await testStorageConnection(storageConnection(body)) },
        request,
        env,
      );
    }

    if (parts.length === 4) {
      const configId = segment(parts, 3);
      if (method === "PUT") {
        const body = await readJson<Record<string, unknown>>(request);
        return json(
          {
            config: await saveStorageConfig(env, user.id, {
              id: configId,
              ...storageInput(body),
            }),
          },
          request,
          env,
        );
      }
      if (method === "DELETE") {
        const result = await deleteStorageConfig(env, user.id, configId);
        return json({ ok: true, ...result }, request, env);
      }
    }
  }

  return null;
};
