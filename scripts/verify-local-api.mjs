import assert from "node:assert/strict";

const base = process.env.FX_TEST_API ?? "http://127.0.0.1:8787";
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname),
  "This check only runs against a local API.",
);
assert.ok(
  process.env.FX_TEST_IDENTIFIER && process.env.FX_TEST_PASSWORD,
  "Set FX_TEST_IDENTIFIER and FX_TEST_PASSWORD to local test credentials.",
);
const created = new Set();
let cookie = "";
async function request(path, { anonymous = false, data, ...options } = {}) {
  const headers = { Accept: "application/json", ...options.headers };
  if (!anonymous && cookie) headers.Cookie = cookie;
  if (data !== undefined) headers["Content-Type"] = "application/json";
  return fetch(new URL(path, base), {
    ...options,
    headers,
    body: data === undefined ? options.body : JSON.stringify(data),
  });
}
async function create(data) {
  const response = await request("/posts", { method: "POST", data });
  assert.equal(response.status, 201);
  const post = await response.json();
  created.add(post.id);
  return post;
}
try {
  const login = await request("/auth/login", {
    method: "POST",
    data: {
      identifier: process.env.FX_TEST_IDENTIFIER,
      password: process.env.FX_TEST_PASSWORD,
    },
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const me = (await login.json()).account.profile;
  const upload = await request("/media", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  assert.equal(upload.status, 201);
  const media = (await upload.json()).media;
  assert.equal((await request(media.url, { anonymous: true })).status, 404);
  const source = await create({
    text: "Local API regression fixture",
    mediaIDs: [media.id],
  });
  assert.equal((await request(media.url, { anonymous: true })).status, 200);
  const copies = await Promise.all(
    Array.from({ length: 3 }, () =>
      request(`/posts/${source.id}/repost`, { method: "PUT" }),
    ),
  );
  const results = await Promise.all(
    copies.map(async (response) => {
      assert.equal(response.status, 200);
      return response.json();
    }),
  );
  const thread = results[0].post;
  created.add(thread.id);
  assert.ok(results.every((result) => result.post.id === thread.id));
  assert.notEqual(thread.id, source.id);
  assert.equal(thread.author.handle, me.handle);
  assert.equal(thread.source.id, source.id);
  assert.equal(thread.repostKind, "repost");
  assert.equal(thread.source.media[0].id, media.id);
  const reply = await request(`/posts/${thread.id}/comments`, {
    method: "POST",
    data: { text: "Independent thread reply", mediaIDs: [media.id] },
  });
  assert.equal(reply.status, 201);
  assert.equal(
    (await (await request(`/posts/${source.id}/comments`)).json()).comments
      .length,
    0,
  );
  assert.equal(
    (await (await request(`/posts/${thread.id}/comments`)).json()).comments
      .length,
    1,
  );
  const quoted = await request(`/posts/${source.id}/quote`, {
    method: "POST",
    data: { text: "My quote comment" },
  });
  assert.equal(quoted.status, 201);
  const quote = await quoted.json();
  created.add(quote.id);
  assert.equal(quote.text, "My quote comment");
  assert.equal(quote.source.id, source.id);
  assert.equal(quote.repostKind, "quote");
  const profile = await (await request(`/users/${me.handle}/posts`)).json();
  assert.ok(profile.posts.some((post) => post.id === thread.id));
  const read = await request(media.url, { anonymous: true });
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.ok(read.headers.get("vary").includes("Cookie"));
  // Remove the independent reply before checking revocation of the source image.
  const commentId = (await reply.json()).comment.id;
  assert.equal(
    (
      await request(`/posts/${thread.id}/comments/${commentId}`, {
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/posts/${source.id}`, {
        method: "PATCH",
        data: { text: source.text, visibility: "private" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/posts/${source.id}`, { anonymous: true })).status,
    404,
  );
  assert.equal(
    (await request(`/posts/${source.id}/comments`, { anonymous: true })).status,
    404,
  );
  assert.equal((await request(media.url, { anonymous: true })).status, 404);
  assert.equal((await request(media.url)).status, 200);
  const hiddenCopy = await (
    await request(`/posts/${thread.id}`, { anonymous: true })
  ).json();
  assert.equal(hiddenCopy.source, null);
  assert.equal(hiddenCopy.media, undefined);
  assert.ok(!hiddenCopy.text.includes(source.text));
  assert.equal(
    (await request(`/posts/${source.id}/repost`, { method: "PUT" })).status,
    403,
  );
  assert.equal(
    (
      await request(`/posts/${source.id}/quote`, {
        method: "POST",
        data: { text: "Must fail" },
      })
    ).status,
    403,
  );
  assert.equal((await request(`/posts/${source.id}/comments`)).status, 200);
  assert.equal(
    (
      await request(`/posts/${source.id}`, {
        method: "PATCH",
        data: { text: source.text, visibility: "public" },
      })
    ).status,
    200,
  );
  const cancel = await request(`/posts/${source.id}/repost`, {
    method: "DELETE",
  });
  assert.equal(cancel.status, 200);
  assert.equal((await request(`/posts/${thread.id}`)).status, 404);
  console.log(
    "PASS: private reply/media authorization, media revocation and cache policy, independent repost threads and replies, concurrent idempotence, quote references and cancellation.",
  );
} finally {
  for (const id of created) await request(`/posts/${id}`, { method: "DELETE" });
}
