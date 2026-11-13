import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import worker from "./index.ts";
import { createPost } from "./posts/posts.ts";
import { etagMatches } from "./routes/media.ts";
import { cleanSecurityState } from "./shared/rate-limit.ts";
import { addSession, addUser, createTestEnv } from "./testing/env.ts";
import type { TestEnv } from "./testing/env.ts";

const API = "https://api.fuckxter.site";
const SHA = "a".repeat(64);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const context = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

let t: TestEnv;
let alice: string;

beforeEach(() => {
  t = createTestEnv();
  alice = addUser(t, "Alice");
});

function call(path: string, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.1");
  return worker.fetch(
    new Request(API + path, { ...init, headers }),
    t.env,
    context,
  );
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("routing", () => {
  test("health and unknown paths", async () => {
    const health = await call("/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "fuckxter-api",
    });

    const missing = await call("/posts/a/b/c/d/e/f/g");
    assert.equal(missing.status, 404);
    assert.equal(await errorCode(missing), "NOT_FOUND");
  });

  test("account routes require a session", async () => {
    for (const path of ["/me/saved", "/notice", "/messages"]) {
      const response = await call(path, {
        headers: { Accept: "application/json" },
      });
      assert.equal(response.status, 401, path);
    }
    const cookie = await addSession(t, alice);
    const saved = await call("/me/saved", { headers: { Cookie: cookie } });
    assert.deepEqual(await saved.json(), { posts: [] });
  });

  test("auth/me reports the signed-in account", async () => {
    assert.deepEqual(await (await call("/auth/me")).json(), { account: null });
    const cookie = await addSession(t, alice);
    const body = (await (
      await call("/auth/me", { headers: { Cookie: cookie } })
    ).json()) as { account: { profile: { handle: string } } };
    assert.equal(body.account.profile.handle, "Alice");
  });

  test("posting, reading by id and by path, and the timeline", async () => {
    const cookie = await addSession(t, alice);
    const created = await call("/posts", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "第一条帖子" }),
    });
    assert.equal(created.status, 201);
    const post = (await created.json()) as { id: string; slug: string };

    assert.equal((await call(`/posts/${post.id}`)).status, 200);
    assert.equal((await call(`/posts/alice/${post.slug}`)).status, 200);
    assert.equal((await call("/posts/alice/nope")).status, 404);

    const timeline = (await (await call("/timeline?tab=latest")).json()) as {
      posts: { id: string }[];
    };
    assert.deepEqual(
      timeline.posts.map((item) => item.id),
      [post.id],
    );

    const invalid = await call("/posts", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x", mediaIDs: [1] }),
    });
    assert.equal(await errorCode(invalid), "INVALID_MEDIA");
  });

  test("writes from a foreign origin are rejected", async () => {
    const response = await call("/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(response.status, 403);
  });
});

describe("sessions", () => {
  test("the cookie is HttpOnly, Secure and SameSite=Lax", async () => {
    const cookie = await addSession(t, alice);
    assert.match(cookie, /^fk_session=/);
    const { createSession } = await import("./accounts/security.ts");
    const header = await createSession(t.env, alice, new Request(API));
    assert.match(header, /; HttpOnly; SameSite=Lax; /);
    assert.match(header, /; Secure$/);
  });

  test("the daily cleanup deletes expired sessions only", async () => {
    await addSession(t, alice);
    await addSession(t, alice);
    t.sqlite
      .prepare(
        "UPDATE sessions SET expires_at = 1 WHERE id = (SELECT id FROM sessions LIMIT 1)",
      )
      .run();
    await cleanSecurityState(t.env);
    const left = t.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get();
    assert.equal(left?.n, 1);
  });
});

describe("login rate limit", () => {
  const attempt = (ip: string) =>
    call("/auth/login", {
      method: "POST",
      ip,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "alice", password: "wrong-password" }),
    });

  test("one address is cut off after 12 tries on an account", async () => {
    for (let index = 0; index < 12; index += 1) {
      assert.notEqual((await attempt("198.51.100.7")).status, 429);
    }
    const blocked = await attempt("198.51.100.7");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  });

  test("switching addresses does not reset the per-account limit", async () => {
    for (let index = 0; index < 60; index += 1) {
      assert.notEqual(
        (await attempt(`10.0.${index}.1`)).status,
        429,
        `#${index}`,
      );
    }
    assert.equal((await attempt("10.9.9.9")).status, 429);
  });
});

describe("read rate limit", () => {
  test("search is refused once the limiter says no", async () => {
    let allowed = 2;
    const keys: string[] = [];
    t.env.SEARCH_LIMITER = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        allowed -= 1;
        return { success: allowed >= 0 };
      },
    } as RateLimit;
    assert.equal((await call("/search?q=abc")).status, 200);
    assert.equal((await call("/search?q=abc")).status, 200);
    assert.equal((await call("/search?q=abc")).status, 429);
    assert.deepEqual(new Set(keys), new Set(["search:203.0.113.1"]));
  });
});

describe("media caching", () => {
  async function addMedia(visibility: "public" | "private") {
    t.sqlite
      .prepare(
        `INSERT INTO media_objects (
           id, owner_id, storage_config_id, object_key, original_name,
           content_type, sha256, byte_size, status, created_at, updated_at
         ) VALUES ('m1', ?, NULL, 'uploads/m1', 'a.png', 'image/png', ?, ?, 'ready', 'now', 'now')`,
      )
      .run(alice, SHA, PNG.byteLength);
    await t.bucket.put(`media/${SHA}`, PNG, {
      httpMetadata: { contentType: "image/png" },
    });
    await createPost(t.env, alice, "带图的帖子", ["m1"], visibility);
  }

  test("If-None-Match parsing", () => {
    const request = (value: string) =>
      new Request(API, { headers: { "If-None-Match": value } });
    assert.equal(etagMatches(request('"abc"'), "abc"), true);
    assert.equal(etagMatches(request('W/"x", "abc"'), "abc"), true);
    assert.equal(etagMatches(request('"abcd"'), "abc"), false);
    assert.equal(etagMatches(new Request(API), "abc"), false);
  });

  test("public images are cacheable and revalidate with 304", async () => {
    await addMedia("public");
    const response = await call("/media/m1");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("ETag"), `"${SHA}"`);
    assert.doesNotMatch(response.headers.get("Vary") ?? "", /Cookie/);
    assert.equal((await response.arrayBuffer()).byteLength, PNG.byteLength);

    // 304 不应该去读对象存储
    t.bucket.objects.clear();
    const again = await call("/media/m1", {
      headers: { "If-None-Match": `"${SHA}"` },
    });
    assert.equal(again.status, 304);
    assert.equal(again.headers.get("Cache-Control"), "public, max-age=3600");
  });

  test("private images are only served to the author, never shared-cacheable", async () => {
    await addMedia("private");
    assert.equal((await call("/media/m1")).status, 404);

    const stranger = await addSession(t, addUser(t, "Bob"));
    assert.equal(
      (await call("/media/m1", { headers: { Cookie: stranger } })).status,
      404,
    );

    const cookie = await addSession(t, alice);
    const own = await call("/media/m1", { headers: { Cookie: cookie } });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("Cache-Control"), "private, no-cache");
    assert.equal(own.headers.get("CDN-Cache-Control"), "no-store");
    assert.match(own.headers.get("Vary") ?? "", /Cookie/);

    // 带着匹配的 ETag 也得先过权限
    const anonymous = await call("/media/m1", {
      headers: { "If-None-Match": `"${SHA}"` },
    });
    assert.equal(anonymous.status, 404);
  });

  test("a public image stops being public when the post goes private", async () => {
    await addMedia("public");
    t.sqlite.exec("UPDATE posts SET visibility = 'private'");
    assert.equal((await call("/media/m1")).status, 404);
  });
});
