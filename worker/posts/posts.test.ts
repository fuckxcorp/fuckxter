import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  createPost,
  getTimeline,
  pruneSearchIndex,
  searchPosts,
  setLike,
  updatePost,
} from "./posts.ts";
import { likePattern, normalizeSearch } from "../shared/search.ts";
import { addUser, createTestEnv } from "../testing/env.ts";
import type { TestEnv } from "../testing/env.ts";

const DAY = 86400_000;
let t: TestEnv;
let alice: string;
let bob: string;

beforeEach(() => {
  t = createTestEnv();
  alice = addUser(t, "Alice");
  bob = addUser(t, "Bob");
});

async function post(author: string, text: string, ageDays = 0, likes = 0) {
  const created = (await createPost(t.env, author, text))!;
  t.sqlite
    .prepare("UPDATE posts SET created_at = ? WHERE id = ?")
    .run(new Date(Date.now() - ageDays * DAY).toISOString(), created.id);
  for (let index = 0; index < likes; index += 1) {
    const fan = addUser(t, `fan${created.id.replace(/\W/g, "")}n${index}`);
    await setLike(t.env, fan, created.id, true);
  }
  return created.id;
}

const texts = (result: { posts: { text: string }[] }) =>
  result.posts.map((item) => item.text);

describe("search", () => {
  test("escapes LIKE wildcards", () => {
    assert.equal(likePattern("50%_a\\b"), "%50\\%\\_a\\\\b%");
  });

  test("caps query length by characters", () => {
    assert.equal([...normalizeSearch(`  ${"字".repeat(300)}  `)].length, 100);
  });

  test("finds CJK substrings through the full-text index", async () => {
    await post(alice, "今天天气真好，出门散步");
    await post(bob, "明天要下雨");
    assert.deepEqual(texts(await searchPosts(t.env, null, "天气真好")), [
      "今天天气真好，出门散步",
    ]);
  });

  test("two-character queries still work without the index", async () => {
    await post(alice, "今天天气真好");
    await post(bob, "明天要下雨");
    assert.deepEqual(texts(await searchPosts(t.env, null, "下雨")), [
      "明天要下雨",
    ]);
  });

  test("matches by author name as before", async () => {
    await post(alice, "hello world");
    await post(bob, "something else");
    assert.deepEqual(texts(await searchPosts(t.env, null, "alice")), [
      "hello world",
    ]);
  });

  test("treats % and _ as literal text", async () => {
    await post(alice, "打折 50% 起");
    await post(bob, "打折 500 起");
    assert.deepEqual(texts(await searchPosts(t.env, null, "50%")), [
      "打折 50% 起",
    ]);
    assert.deepEqual(texts(await searchPosts(t.env, null, "___")), []);
  });

  test("an edited post no longer matches its old text", async () => {
    const id = await post(alice, "原来的内容在这里");
    await updatePost(t.env, alice, id, "改过之后的内容");
    assert.deepEqual(texts(await searchPosts(t.env, null, "原来的内容")), []);
    assert.deepEqual(texts(await searchPosts(t.env, null, "改过之后")), [
      "改过之后的内容",
    ]);
  });

  test("private posts stay hidden from other people", async () => {
    await createPost(t.env, alice, "只有自己能看的秘密", [], "private");
    assert.deepEqual(texts(await searchPosts(t.env, null, "自己能看")), []);
    assert.deepEqual(texts(await searchPosts(t.env, bob, "自己能看")), []);
    assert.equal((await searchPosts(t.env, alice, "自己能看")).posts.length, 1);
  });

  test("falls back to a table scan when the index is missing", async () => {
    await post(alice, "今天天气真好");
    t.sqlite.exec(
      "DROP TRIGGER posts_fts_insert; DROP TRIGGER posts_fts_update; DROP TABLE posts_fts;",
    );
    assert.equal((await searchPosts(t.env, null, "天气真好")).posts.length, 1);
    await pruneSearchIndex(t.env);
  });

  test("prune removes rows left by edits and deletions", async () => {
    const edited = await post(alice, "第一版的正文内容");
    await updatePost(t.env, alice, edited, "第二版的正文内容");
    const removed = await post(bob, "马上要被删掉的帖子");
    t.sqlite.prepare("DELETE FROM posts WHERE id = ?").run(removed);
    await pruneSearchIndex(t.env);
    assert.deepEqual(
      t.sqlite
        .prepare("SELECT text FROM posts_fts")
        .all()
        .map((row) => row.text),
      ["第二版的正文内容"],
    );
  });
});

describe("for-you timeline", () => {
  async function seed() {
    await post(alice, "old-viral", 30, 5);
    await post(alice, "old-quiet", 20);
    await post(bob, "recent-liked", 2, 2);
    await post(bob, "recent-quiet", 1);
    await post(alice, "fresh", 0);
  }

  test("ranks recent posts by likes, then older posts by time", async () => {
    await seed();
    const page = await getTimeline(t.env, null, "foryou", null, "30");
    assert.deepEqual(texts(page), [
      "recent-liked",
      "fresh",
      "recent-quiet",
      "old-quiet",
      "old-viral",
    ]);
    assert.equal(page.nextCursor, null);
  });

  test("paging visits every post exactly once", async () => {
    await seed();
    for (const size of ["1", "2", "3", "4"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof getTimeline>> = await getTimeline(
          t.env,
          null,
          "foryou",
          cursor,
          size,
        );
        seen.push(...texts(page));
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(
        seen,
        ["recent-liked", "fresh", "recent-quiet", "old-quiet", "old-viral"],
        `page size ${size}`,
      );
    }
  });

  test("accepts cursors issued by the previous like-ordered feed", async () => {
    await seed();
    const first = await getTimeline(t.env, null, "latest", null, "2");
    const [createdAt, id] = JSON.parse(atob(first.nextCursor!));
    const legacy = btoa(JSON.stringify(["0", createdAt, id]));
    const page = await getTimeline(t.env, null, "foryou", legacy, "30");
    assert.deepEqual(texts(page), ["recent-liked", "old-quiet", "old-viral"]);
  });

  test("latest stays purely chronological", async () => {
    await seed();
    const page = await getTimeline(t.env, null, "latest", null, "30");
    assert.deepEqual(texts(page), [
      "fresh",
      "recent-quiet",
      "recent-liked",
      "old-quiet",
      "old-viral",
    ]);
  });
});
