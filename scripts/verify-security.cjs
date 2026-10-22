const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const { createHmac } = require("node:crypto");
const repo = process.env.FX_REPO || path.resolve(__dirname, "..");
const ts = require(
  require.resolve("typescript", {
    paths: [repo + "/node_modules/.pnpm/node_modules"],
  }),
);
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory())
    file = path.join(file, "index.ts");
  else if (!file.endsWith(".ts")) file += ".ts";
  if (modules.has(file)) return modules.get(file).exports;
  const m = { exports: {} };
  modules.set(file, m);
  const text = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInThisContext("(function(require,module,exports){" + text + "\n})", {
    filename: file,
  })((id) => load(path.resolve(path.dirname(file), id)), m, m.exports);
  return m.exports;
}
const sql = new DatabaseSync(":memory:");
for (const file of fs.readdirSync(repo + "/worker/databases").sort())
  sql.exec(fs.readFileSync(repo + "/worker/databases/" + file, "utf8"));
const DB = {
  prepare(query) {
    return {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...this.values) || null;
      },
      async all() {
        return {
          success: true,
          results: sql.prepare(query).all(...this.values),
        };
      },
      async run() {
        const result = sql.prepare(query).run(...this.values);
        return {
          success: true,
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
      },
    };
  },
  async batch(statements) {
    sql.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sql.exec("COMMIT");
      return results;
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  },
};
const objects = new Map(),
  kv = new Map();
let transforms = 0;
const env = {
  DB,
  FUCKXTER_SECRET: "regression-secret-only",
  FUCKXTER_ORIGINS: "https://web.example.org",
  KV: {
    get: async (k) => kv.get(k) || null,
    put: async (k, v) => kv.set(k, v),
    delete: async (k) => kv.delete(k),
  },
  JOBS: { send: async () => {} },
  MEDIA_CACHE: {
    async put(k, bytes, options) {
      objects.set(k, {
        bytes: bytes.slice(0),
        type: options?.httpMetadata?.contentType,
      });
    },
    async get(k) {
      const o = objects.get(k);
      return o
        ? {
            body: new Response(o.bytes).body,
            size: o.bytes.byteLength,
            httpMetadata: { contentType: o.type },
            arrayBuffer: async () => o.bytes.slice(0),
          }
        : null;
    },
    head: async (k) =>
      objects.has(k) ? { size: objects.get(k).bytes.byteLength } : null,
    delete: async (k) => objects.delete(k),
  },
  IMAGES: {
    input(_stream) {
      return {
        transform(options) {
          assert.ok([128, 640, 1280, 2048].includes(options.width));
          transforms++;
          return this;
        },
        async output(options) {
          return {
            response: () =>
              new Response(new Uint8Array(40), {
                headers: { "Content-Type": options.format },
              }),
          };
        },
      };
    },
  },
};
const cryptoLib = load(repo + "/worker/shared/crypto"),
  security = load(repo + "/worker/accounts/security"),
  storage = load(repo + "/worker/posts/storage"),
  media = load(repo + "/worker/posts/media"),
  posts = load(repo + "/worker/posts/posts"),
  messages = load(repo + "/worker/messages/messages"),
  worker = load(repo + "/worker/index").default,
  s3 = load(repo + "/worker/accounts/s3");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const realFetch = global.fetch;
let outbound = 0,
  mode = "ok",
  huge = false,
  badType = false;
global.fetch = async (value, init = {}) => {
  const url = new URL(value);
  if (url.hostname === "cloudflare-dns.com")
    return Response.json({
      Status: 0,
      Answer:
        url.searchParams.get("type") === "A"
          ? [
              {
                type: 1,
                data: url.searchParams.get("name").startsWith("private.")
                  ? "127.0.0.1"
                  : "93.184.216.34",
              },
            ]
          : [],
    });
  outbound++;
  if (mode === "outage") return new Response(null, { status: 503 });
  if (mode === "redirect")
    return new Response(null, {
      status: 307,
      headers: { Location: "https://private.example.org" },
    });
  if (init.method === "HEAD")
    return new Response(null, {
      headers: {
        "Content-Length": String(huge ? 100 * 1024 * 1024 : png.byteLength),
        "Content-Type": badType ? "text/plain" : "image/png",
      },
    });
  if (init.method === "GET")
    return new Response(badType ? "not an image" : png, {
      headers: {
        "Content-Length": String(badType ? 12 : png.byteLength),
        "Content-Type": badType ? "text/plain" : "image/png",
      },
    });
  return new Response(null, { status: 204 });
};
const tasks = [];
const context = {
  waitUntil(p) {
    tasks.push(p);
  },
};
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function seed(id) {
  const password = await cryptoLib.createPasswordHash("fixture-password");
  sql
    .prepare(
      `INSERT INTO users(id,credential_id,handle,email,password_hash,password_salt,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      "credential-" + id,
      id,
      id + "@example.org",
      password.hash,
      password.salt,
      id,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
}
async function api(url, options = {}, cookie = "") {
  const headers = new Headers(options.headers);
  if (!headers.has("CF-Connecting-IP"))
    headers.set("CF-Connecting-IP", "198.51.100.7");
  if (cookie) headers.set("Cookie", cookie);
  if (typeof options.body === "string")
    headers.set("Content-Type", "application/json");
  return worker.fetch(
    new Request("https://api.fuckxter.site" + url, { ...options, headers }),
    env,
    context,
  );
}
async function session(id) {
  return (
    await security.createSession(
      env,
      id,
      new Request("https://api.fuckxter.site"),
    )
  ).split(";")[0];
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0,
    bytes = [];
  for (const c of secret) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = hash[19] & 15;
  return String((hash.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
(async () => {
  await test("JSON bodies are bounded even without a trustworthy Content-Length", async () => {
    const { readJson } = load(repo + "/worker/shared/http.ts");
    const request = (body, headers = {}) =>
      new Request("https://api.fuckxter.site/posts", {
        method: "POST",
        body,
        headers,
      });
    assert.deepEqual(await readJson(request('{"text":"hello"}')), {
      text: "hello",
    });
    await assert.rejects(
      readJson(request("{")),
      (error) => error.status === 400,
    );
    await assert.rejects(
      readJson(request("{}", { "Content-Length": "1048577" })),
      (error) => error.status === 413,
    );
    for (const headers of [{}, { "Content-Length": "2" }]) {
      await assert.rejects(
        readJson(request('"' + "x".repeat(1048576) + '"', headers)),
        (error) => error.status === 413,
      );
    }
    assert.equal(
      (await readJson(request('"' + "x".repeat(1048574) + '"'))).length,
      1048574,
    );
  });
  await seed("alice");
  await seed("bob");
  let cookie = await session("alice"),
    bob = await session("bob");
  await test("Password change atomically revokes old sessions and rotates current cookie", async () => {
    const stolen = await session("alice");
    const response = await api(
      "/me/password",
      {
        method: "PUT",
        body: JSON.stringify({
          current: "fixture-password",
          next: "new-fixture-password",
        }),
      },
      cookie,
    );
    assert.equal(response.status, 200);
    cookie = response.headers.get("Set-Cookie").split(";")[0];
    assert.equal(
      await security.getOptionalUser(
        new Request("https://api.fuckxter.site", {
          headers: { Cookie: stolen },
        }),
        env,
      ),
      null,
    );
    assert.ok(
      await security.getOptionalUser(
        new Request("https://api.fuckxter.site", {
          headers: { Cookie: cookie },
        }),
        env,
      ),
    );
  });
  let originalSecret;
  await test("MFA requires password and keeps pending secrets session-bound", async () => {
    const denied = await api(
      "/me/2fa/setup",
      { method: "POST", body: "{}" },
      cookie,
    );
    assert.equal(denied.status, 403);
    const response = await api(
      "/me/2fa/setup",
      {
        method: "POST",
        body: JSON.stringify({ password: "new-fixture-password" }),
      },
      cookie,
    );
    assert.equal(response.status, 200);
    originalSecret = (await response.json()).secret;
    const other = await session("alice");
    assert.equal(
      (
        await api(
          "/me/2fa/confirm",
          {
            method: "POST",
            body: JSON.stringify({ code: totp(originalSecret) }),
          },
          other,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          "/me/2fa/confirm",
          {
            method: "POST",
            body: JSON.stringify({ code: totp(originalSecret) }),
          },
          cookie,
        )
      ).status,
      200,
    );
    const old = sql
      .prepare("SELECT totp_secret FROM users WHERE id=?")
      .get("alice").totp_secret;
    assert.equal(
      (
        await api(
          "/me/2fa/setup",
          {
            method: "POST",
            body: JSON.stringify({ password: "new-fixture-password" }),
          },
          cookie,
        )
      ).status,
      403,
    );
    const pending = await api(
      "/me/2fa/setup",
      {
        method: "POST",
        body: JSON.stringify({
          password: "new-fixture-password",
          code: totp(originalSecret),
        }),
      },
      cookie,
    );
    assert.equal(pending.status, 200);
    const row = sql.prepare("SELECT * FROM users WHERE id=?").get("alice");
    assert.equal(row.two_factor_enabled, 1);
    assert.equal(row.totp_secret, old);
    assert.notEqual(row.pending_totp_secret, old);
  });
  await test("Recovery-code replacement also requires active factors", async () => {
    assert.equal(
      (
        await api(
          "/me/2fa/recovery-codes",
          { method: "POST", body: "{}" },
          cookie,
        )
      ).status,
      403,
    );
    const response = await api(
      "/me/2fa/recovery-codes",
      {
        method: "POST",
        body: JSON.stringify({
          password: "new-fixture-password",
          code: totp(originalSecret),
        }),
      },
      cookie,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).codes.length, 8);
  });
  const config = await storage.saveStorageConfig(env, "alice", {
    name: "Fixture",
    endpoint: "https://storage.example.org",
    bucket: "bucket",
    pathStyle: true,
    accessKeyId: "fixture",
    secretAccessKey: "fixture",
    isDefault: true,
  });
  let uploaded;
  await test("Platform upload ignores existing or expired default custom bucket", async () => {
    mode = "outage";
    const before = outbound;
    const response = await api(
      "/media",
      {
        method: "POST",
        body: png,
        headers: {
          "Content-Type": "image/png",
          "X-Storage-Config-Id": "platform",
        },
      },
      cookie,
    );
    assert.equal(response.status, 201);
    uploaded = (await response.json()).media;
    assert.equal(outbound, before);
    assert.equal(
      sql
        .prepare("SELECT storage_config_id FROM media_objects WHERE id=?")
        .get(uploaded.id).storage_config_id,
      null,
    );
    assert.equal(
      (
        await api(
          "/media",
          {
            method: "POST",
            body: png,
            headers: { "X-Storage-Config-Id": config.id },
          },
          cookie,
        )
      ).status,
      502,
    );
    mode = "ok";
  });
  await test("Custom storage deletion archives referenced config without breaking old reads", async () => {
    const item = await media.uploadMedia(
      new Request("https://api.fuckxter.site/media", {
        method: "POST",
        body: png,
        headers: { "X-Storage-Config-Id": config.id },
      }),
      env,
      "alice",
    );
    assert.equal(
      (await storage.deleteStorageConfig(env, "alice", config.id)).archived,
      true,
    );
    assert.equal((await storage.getStorageOptions(env, "alice")).length, 0);
    assert.equal(await storage.getStorageConfig(env, "alice", config.id), null);
    assert.ok(await storage.getStorageConfig(env, "alice", config.id, true));
    assert.equal(
      (await media.getMedia(env, item.id, "alice")).size,
      png.byteLength,
    );
    await storage.saveStorageConfig(env, "alice", { ...config, enabled: true });
  });
  await test("Private post view counting enforces read permissions and batched deduplication", async () => {
    const hidden = await posts.createPost(
      env,
      "alice",
      "private fixture",
      [],
      "private",
    );
    assert.equal(
      (await api("/posts/" + hidden.id + "/view", { method: "POST" })).status,
      404,
    );
    const shown = await posts.createPost(env, "alice", "public fixture");
    const first = await api(
      "/posts/views",
      {
        method: "POST",
        body: JSON.stringify({ ids: [hidden.id, shown.id, shown.id] }),
      },
      bob,
    );
    assert.equal(first.status, 200);
    const rows = (await first.json()).views;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, shown.id);
    assert.equal(rows[0].views, 1);
    const second = await posts.recordPostViews(
      env,
      new Request("https://api.fuckxter.site"),
      "bob",
      [shown.id],
    );
    assert.equal(second.views[0].views, 1);
    assert.equal(second.views[0].counted, false);
  });
  await test("Storage endpoints reject loopback, private DNS, credential URLs and redirects", async () => {
    for (const endpoint of [
      "http://127.0.0.1:8000",
      "https://127.0.0.1",
      "https://[::1]",
      "https://user:pass@storage.example.org",
      "https://storage.example.org:444",
      "https://localhost",
    ])
      assert.throws(() => s3.validateStorageInput({ ...config, endpoint }));
    await assert.rejects(
      s3.testStorageConnection({
        ...config,
        endpoint: "https://private.example.org",
      }),
      (e) => e.code === "INVALID_ENDPOINT",
    );
    mode = "redirect";
    await assert.rejects(
      s3.testStorageConnection(config),
      (e) => e.code === "S3_REDIRECT_FORBIDDEN",
    );
    mode = "ok";
  });
  await test("Direct upload requires an unexpired owner/object/config-bound ticket and verified bytes", async () => {
    await assert.rejects(
      media.finalizeMediaUpload(env, "alice", {
        objectKey: "fuckxter/media/arbitrary.png",
        contentType: "image/png",
        storageConfigId: config.id,
      }),
      (e) => e.code === "INVALID_MEDIA",
    );
    const ticket = await media.presignMediaUpload(env, "alice", {
      storageConfigId: config.id,
      fileName: "fixture.png",
      contentType: "image/png",
    });
    await assert.rejects(
      media.finalizeMediaUpload(env, "bob", ticket),
      (e) => e.code === "INVALID_MEDIA",
    );
    huge = true;
    await assert.rejects(
      media.finalizeMediaUpload(env, "alice", ticket),
      (e) => e.code === "MEDIA_TOO_LARGE",
    );
    huge = false;
    badType = true;
    await assert.rejects(
      media.finalizeMediaUpload(env, "alice", ticket),
      (e) => e.code === "UNSUPPORTED_MEDIA",
    );
    badType = false;
    const result = await media.finalizeMediaUpload(env, "alice", ticket);
    assert.equal(result.byteSize, png.byteLength);
    assert.equal(result.contentType, "image/png");
    assert.equal(
      (await media.finalizeMediaUpload(env, "alice", ticket)).id,
      result.id,
    );
    assert.equal(
      sql
        .prepare("SELECT COUNT(*) AS n FROM upload_tickets WHERE object_key=?")
        .get(ticket.objectKey).n,
      0,
    );
  });
  await test("Private previews check access before using cached transformed bytes and preserve originals", async () => {
    await posts.createPost(
      env,
      "alice",
      "private image",
      [uploaded.id],
      "private",
    );
    await assert.rejects(
      media.getMedia(env, uploaded.id, "bob", true),
      (e) => e.status === 404,
    );
    const preview = await media.getMedia(env, uploaded.id, "alice", true);
    assert.equal(preview.size, 40);
    assert.equal(preview.contentType, "image/avif");
    const before = transforms;
    await media.getMedia(env, uploaded.id, "alice", true);
    assert.equal(transforms, before);
    assert.equal(
      (await media.getMedia(env, uploaded.id, "alice", false)).size,
      png.byteLength,
    );
    await assert.rejects(
      media.getMedia(env, uploaded.id, null, true),
      (e) => e.status === 404,
    );
  });
  await test("Native WebP variants remain private, use bounded sizes and never fall back to AVIF", async () => {
    assert.equal(
      media.displayWidth(
        new URL("https://example.test/media/id?format=webp&width=128"),
      ),
      128,
    );
    assert.throws(
      () =>
        media.displayWidth(
          new URL("https://example.test/media/id?format=webp&width=999"),
        ),
      (e) => e.status === 400,
    );
    assert.throws(
      () =>
        media.displayWidth(
          new URL("https://example.test/media/id?format=avif"),
        ),
      (e) => e.status === 400,
    );
    const variant = `/media/${uploaded.id}?format=webp&width=640`;
    const aliceCookie = await session("alice");
    const bobCookie = await session("bob");
    const first = await api(variant, {}, aliceCookie);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("Content-Type"), "image/webp");
    assert.equal(first.headers.get("Cache-Control"), "private, no-store");
    const before = transforms;
    assert.equal((await api(variant, {}, aliceCookie)).status, 200);
    assert.equal(transforms, before);
    assert.equal((await api(variant, {}, bobCookie)).status, 404);
    assert.equal((await api(variant)).status, 404);
    const images = env.IMAGES;
    env.IMAGES = {
      input() {
        throw new Error("transform unavailable");
      },
    };
    try {
      assert.equal(
        (
          await api(
            `/media/${uploaded.id}?format=webp&width=2048`,
            {},
            aliceCookie,
          )
        ).status,
        502,
      );
    } finally {
      env.IMAGES = images;
    }
    const firstSource = {
      body: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      size: png.byteLength,
      contentType: "image/png",
      etag: "avatar",
    };
    const firstAvatar = await media.displayImage(env, firstSource, 128);
    const secondAvatar = await media.displayImage(
      env,
      { ...firstSource, body: new Uint8Array([1, 2, 3]).buffer, size: 3 },
      128,
    );
    assert.notEqual(firstAvatar.etag, secondAvatar.etag);
  });
  await test("Comment pagination preserves ancestors, same-time ordering, focus and all 105 replies", async () => {
    const post = await posts.createPost(env, "alice", "comment fixture");
    let parent = null;
    for (let i = 0; i < 105; i++) {
      const id = "c" + String(105 - i).padStart(3, "0");
      sql
        .prepare(
          "INSERT INTO comments(id,post_id,author_id,text,parent_id,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(id, post.id, "bob", "reply " + i, parent, "2026-01-01T00:00:00Z");
      parent = id;
    }
    const all = new Set();
    let cursor = null,
      pages = 0;
    do {
      const page = await posts.getComments(env, "alice", post.id, cursor);
      for (const comment of page.comments) {
        all.add(comment.id);
        if (comment.parent)
          assert.ok(page.comments.some((c) => c.id === comment.parent.id));
      }
      cursor = page.nextCursor;
      pages++;
      assert.ok(pages < 5);
    } while (cursor);
    assert.equal(all.size, 105);
    assert.equal(pages, 3);
    const focus = await posts.getComments(env, "alice", post.id, null, "c001");
    assert.ok(focus.comments.some((c) => c.id === "c001"));
    assert.equal(focus.total, 105);
  });
  await test("Direct-message cursors expose all history and do not skip same-time messages", async () => {
    sql
      .prepare(
        "INSERT INTO dm_threads(id,user_low_id,user_high_id,created_at,last_message_at) VALUES(?,?,?,?,?)",
      )
      .run(
        "thread",
        "alice",
        "bob",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
      );
    for (let i = 0; i < 121; i++)
      sql
        .prepare(
          "INSERT INTO dm_messages(id,thread_id,sender_id,body,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          "m" + String(i).padStart(3, "0"),
          "thread",
          "bob",
          "message " + i,
          "2026-01-01T00:00:00Z",
        );
    const latest = await messages.getConversation(env, "alice", "bob");
    assert.equal(latest.messages.length, 50);
    const ids = new Set(latest.messages.map((m) => m.id));
    let cursor = latest.nextCursor;
    while (cursor) {
      const page = await messages.getConversation(env, "alice", "bob", cursor);
      page.messages.forEach((m) => ids.add(m.id));
      cursor = page.nextCursor;
    }
    assert.equal(ids.size, 121);
    const start = load(repo + "/worker/shared/cursor").encodeCursor(
      "2026-01-01T00:00:00Z",
      "m000",
    );
    const update = await messages.getConversation(
      env,
      "alice",
      "bob",
      null,
      start,
    );
    assert.equal(update.messages[0].id, "m001");
    assert.ok(update.nextAfter);
    await assert.rejects(
      messages.getConversation(env, "alice", "bob", "garbage"),
      (e) => e.code === "INVALID_CURSOR",
    );
  });
  await test("Authentication returns 429 with Retry-After before unlimited guessing", async () => {
    const codes = [];
    for (let i = 0; i < 20; i++) {
      const response = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: "bob", password: "bad-password" }),
      });
      codes.push(response.status);
      if (response.status === 429)
        assert.ok(Number(response.headers.get("Retry-After")) > 0);
    }
    assert.ok(codes.includes(401));
    assert.ok(codes.includes(429));
  });

  await seed("carl");
  await seed("dan");
  const carl = await session("carl");
  let clock = Date.now();
  const realNow = Date.now;
  Date.now = () => clock;
  const resetLimits = () => sql.exec("DELETE FROM rate_limits");
  const write = (url, method, body, cookie = bob, ip = "198.51.100.7") =>
    api(
      url,
      {
        method,
        headers: { "CF-Connecting-IP": ip },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      cookie,
    );
  const assertLimited = async (response) => {
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
    assert.ok(Number(response.headers.get("Retry-After")) > 0);
  };
  await test("Registration and password changes enforce the same server-side 8–128 character policy", async () => {
    resetLimits();
    for (const [index, password] of [
      "x",
      "1234567",
      "x".repeat(129),
      {},
      "😀".repeat(7),
    ].entries()) {
      const response = await write(
        "/auth/register",
        "POST",
        { identifier: `weak-${index}@example.invalid`, password },
        "",
      );
      assert.equal(response.status, 400);
      assert.equal(
        sql
          .prepare("SELECT COUNT(*) AS n FROM users WHERE email=?")
          .get(`weak-${index}@example.invalid`).n,
        0,
      );
    }
    for (const [index, password] of [
      "12345678",
      "😀".repeat(8),
      "😀".repeat(128),
    ].entries()) {
      const response = await write(
        "/auth/register",
        "POST",
        { identifier: `valid-${index}@example.invalid`, password },
        "",
      );
      assert.equal(response.status, 200);
    }
    for (const password of ["1234567", "x".repeat(129), {}]) {
      assert.equal(
        (
          await write("/me/password", "PUT", {
            current: "fixture-password",
            next: password,
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await write(
          "/me/password",
          "PUT",
          { current: "fixture-password", next: "x".repeat(128) },
          carl,
        )
      ).status,
      200,
    );
  });
  await test("Existing weak-password accounts can still log in while new weak registrations are blocked", async () => {
    resetLimits();
    await seed("legacy");
    const password = await cryptoLib.createPasswordHash("x");
    sql
      .prepare("UPDATE users SET password_hash=?, password_salt=? WHERE id=?")
      .run(password.hash, password.salt, "legacy");
    assert.equal(
      (
        await write(
          "/auth/login",
          "POST",
          { identifier: "legacy", password: "x" },
          "",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await write(
          "/auth/login",
          "POST",
          { identifier: "missing@example.invalid", password: "x" },
          "",
        )
      ).status,
      400,
    );
  });
  const source = await posts.createPost(env, "alice", "business-rate fixture");
  const comment = await posts.createComment(
    env,
    "alice",
    source.id,
    "comment-rate fixture",
  );
  await test("Posting, replies, quote reposts and both repost routes share one publication quota", async () => {
    resetLimits();
    const routes = [
      ["/posts", "POST", { text: "publication fixture" }],
      [`/posts/${source.id}/comments`, "POST", { text: "reply fixture" }],
      [`/posts/${source.id}/quote`, "POST", { text: "quote fixture" }],
      [`/posts/${source.id}/repost`, "PUT"],
      [`/posts/${source.id}/comments/${comment.id}/repost`, "PUT"],
    ];
    for (let i = 0; i < 30; i++) {
      const response = await write(...routes[i % routes.length]);
      assert.ok(
        response.ok,
        `${i}: ${response.status} ${await response.text()}`,
      );
    }
    const before = sql.prepare("SELECT COUNT(*) AS n FROM posts").get().n;
    for (const route of routes) await assertLimited(await write(...route));
    assert.equal(
      sql.prepare("SELECT COUNT(*) AS n FROM posts").get().n,
      before,
    );
  });
  await test("Likes, saves, follow, block, editing, recalls and removals all enforce the interaction quota", async () => {
    resetLimits();
    for (let i = 0; i < 120; i++)
      assert.equal(
        (await write(`/posts/${source.id}/like`, "PUT")).status,
        200,
      );
    const routes = [
      [`/posts/${source.id}/like`, "DELETE"],
      [`/posts/${source.id}/save`, "PUT"],
      [`/posts/${source.id}/repost`, "DELETE"],
      [`/posts/${source.id}`, "PATCH", { text: "edit fixture" }],
      [`/posts/${source.id}`, "DELETE"],
      [`/posts/${source.id}/comments/${comment.id}`, "DELETE"],
      [`/posts/${source.id}/comments/${comment.id}/like`, "PUT"],
      [`/posts/${source.id}/comments/${comment.id}/repost`, "DELETE"],
      ["/users/alice/follow", "PUT"],
      ["/users/alice/block", "PUT"],
      ["/messages/alice/read", "POST"],
      ["/messages/alice/missing", "DELETE"],
    ];
    for (const route of routes) await assertLimited(await write(...route));
  });
  await test("Single and batched view routes share a quota for members and guests and keep deduplication", async () => {
    for (const cookie of [bob, ""]) {
      resetLimits();
      for (let i = 0; i < 120; i++)
        assert.equal(
          (
            await write(
              i % 2 ? `/posts/${source.id}/view` : "/posts/views",
              "POST",
              i % 2 ? undefined : { ids: [source.id] },
              cookie,
            )
          ).status,
          200,
        );
      await assertLimited(
        await write(`/posts/${source.id}/view`, "POST", undefined, cookie),
      );
      await assertLimited(
        await write("/posts/views", "POST", { ids: [source.id] }, cookie),
      );
      assert.ok((await api(`/posts/${source.id}`, {}, cookie)).ok);
      clock += 60001;
      assert.equal(
        (await write("/posts/views", "POST", { ids: [source.id] }, cookie))
          .status,
        200,
      );
    }
    assert.equal(
      sql
        .prepare("SELECT COUNT(*) AS n FROM post_views WHERE post_id=?")
        .get(source.id).n,
      2,
    );
  });
  await test("Message recipient quota preserves other conversations and normalizes recipient aliases", async () => {
    resetLimits();
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await write("/messages/alice", "POST", { text: "pair-rate fixture" }))
          .status,
        201,
      );
    await assertLimited(
      await write("/messages/alice", "POST", { text: "pair-rate denied" }),
    );
    assert.equal(
      (
        await write("/messages/dan", "POST", {
          text: "other-recipient fixture",
        })
      ).status,
      201,
    );
    await assertLimited(
      await write("/messages/ALICE", "POST", {
        text: "normalized-recipient denied",
      }),
    );
  });
  await test("Message sender quota is shared across recipients", async () => {
    resetLimits();
    for (let i = 0; i < 60; i++)
      assert.equal(
        (
          await write("/messages/" + ["alice", "carl", "dan"][i % 3], "POST", {
            text: "sender-rate fixture",
          })
        ).status,
        201,
      );
    await assertLimited(
      await write("/messages/alice", "POST", { text: "sender-rate denied" }),
    );
  });
  await test("Account limits survive username and source-IP changes", async () => {
    resetLimits();
    await seed("renamer");
    const renamed = await session("renamer");
    for (let i = 0; i < 30; i++)
      assert.equal(
        (
          await write(
            "/posts",
            "POST",
            { text: "rename-rate fixture" },
            renamed,
          )
        ).status,
        201,
      );
    sql
      .prepare(
        "UPDATE users SET id='renamer-new',handle='renamer-new' WHERE id='renamer'",
      )
      .run();
    try {
      await assertLimited(
        await write(
          "/posts",
          "POST",
          { text: "renamed-actor denied" },
          renamed,
          "198.51.100.8",
        ),
      );
    } finally {
      sql
        .prepare(
          "UPDATE users SET id='renamer',handle='renamer' WHERE id='renamer-new'",
        )
        .run();
    }
  });
  await test("Source-IP limits are shared across accounts", async () => {
    resetLimits();
    const actors = [bob, await session("carl"), await session("dan")];
    for (let i = 0; i < 300; i++)
      assert.equal(
        (
          await write(
            `/posts/${source.id}/like`,
            "PUT",
            undefined,
            actors[i % 3],
          )
        ).status,
        200,
      );
    await assertLimited(
      await write(`/posts/${source.id}/like`, "PUT", undefined, bob),
    );
    assert.equal(
      (
        await write(
          `/posts/${source.id}/like`,
          "PUT",
          undefined,
          bob,
          "198.51.100.8",
        )
      ).status,
      200,
    );
  });
  await test("Daily publication and message-pair quotas persist across minute windows", async () => {
    resetLimits();
    for (let i = 0; i < 300; i++) {
      if (i && i % 30 === 0) clock += 60001;
      assert.equal(
        (await write("/posts", "POST", { text: "daily-rate fixture" })).status,
        201,
      );
    }
    clock += 60001;
    const denied = await write("/posts", "POST", { text: "daily-rate denied" });
    assert.ok(Number(denied.headers.get("Retry-After")) > 60);
    await assertLimited(denied);
    resetLimits();
    for (let i = 0; i < 500; i++) {
      if (i && i % 20 === 0) clock += 60001;
      assert.equal(
        (await write("/messages/alice", "POST", { text: "daily-pair fixture" }))
          .status,
        201,
      );
    }
    clock += 60001;
    await assertLimited(
      await write("/messages/alice", "POST", { text: "daily-pair denied" }),
    );
    clock += 86400001;
    assert.equal(
      (await write("/messages/alice", "POST", { text: "new-day fixture" }))
        .status,
      201,
    );
  });
  await test("Concurrent publication requests cannot exceed the database quota", async () => {
    resetLimits();
    const responses = await Promise.all(
      Array.from({ length: 40 }, () =>
        write("/posts", "POST", { text: "concurrent-rate fixture" }),
      ),
    );
    assert.equal(
      responses.filter((response) => response.status === 201).length,
      30,
    );
    assert.equal(
      responses.filter((response) => response.status === 429).length,
      10,
    );
  });
  Date.now = realNow;

  await Promise.allSettled(tasks);
  global.fetch = realFetch;
  sql.close();
  console.log(`${passed} security/data regression groups passed.`);
})().catch((error) => {
  global.fetch = realFetch;
  console.error(error);
  process.exitCode = 1;
});
