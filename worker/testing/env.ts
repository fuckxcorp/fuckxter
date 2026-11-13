// 测试环境：用 node:sqlite 跑真实的迁移脚本，再包一层 D1 的接口。
// 其它绑定只实现测试用得到的那一小部分。
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Env } from "../shared/platform.ts";

const MIGRATIONS = fileURLToPath(new URL("../databases/", import.meta.url));

type Value = string | number | bigint | null | Uint8Array;

function toValue(value: unknown): Value {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as Value;
}

class Statement {
  private readonly db: DatabaseSync;
  private readonly sql: string;
  private readonly values: Value[];

  constructor(db: DatabaseSync, sql: string, values: Value[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map(toValue));
  }

  async first<T>(): Promise<T | null> {
    const rows = this.db.prepare(this.sql).all(...this.values);
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T>() {
    const results = this.db.prepare(this.sql).all(...this.values) as T[];
    return { results, success: true as const, meta: {} };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return {
      success: true as const,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class MemoryBucket {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string }
  >();

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    this.objects.set(key, {
      bytes: new Uint8Array(value),
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    const { bytes, contentType } = object;
    return {
      size: bytes.byteLength,
      etag: `etag-${key}-${bytes.byteLength}`,
      httpMetadata: { contentType },
      get body() {
        return new Response(bytes).body!;
      },
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { size: object.bytes.byteLength } : null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

export interface TestEnv {
  env: Env;
  sqlite: DatabaseSync;
  bucket: MemoryBucket;
  jobs: unknown[];
}

export function createTestEnv(): TestEnv {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (file.endsWith(".sql")) {
      sqlite.exec(readFileSync(MIGRATIONS + file, "utf8"));
    }
  }
  const bucket = new MemoryBucket();
  const jobs: unknown[] = [];
  const env = {
    DB: {
      prepare: (sql: string) => new Statement(sqlite, sql),
      batch: async (statements: Statement[]) => {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      },
    },
    MEDIA_CACHE: bucket,
    JOBS: { send: async (job: unknown) => void jobs.push(job) },
    FUCKXTER_ORIGINS: "https://fuckxter.site,https://api.fuckxter.site",
  } as unknown as Env;
  return { env, sqlite, bucket, jobs };
}

let userCount = 0;

/** 直接往库里插一个用户，返回它的 id（就是小写的用户名）。 */
export function addUser(test: TestEnv, handle: string, name = handle): string {
  const id = handle.toLowerCase();
  const now = new Date().toISOString();
  userCount += 1;
  test.sqlite
    .prepare(
      `INSERT INTO users (
         id, credential_id, handle, email, password_hash, password_salt, name,
         verified, bio, region, gender, birthday, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'x', 'x', ?, 0, '', '', '', '', ?, ?)`,
    )
    .run(id, `cred-${userCount}`, handle, `${id}@example.test`, name, now, now);
  return id;
}

/** 给用户建一个会话，返回可以直接放进 Cookie 头的值。 */
export async function addSession(
  test: TestEnv,
  userId: string,
): Promise<string> {
  const { createSession } = await import("../accounts/security.ts");
  const cookie = await createSession(
    test.env,
    userId,
    new Request("https://api.fuckxter.site/"),
  );
  return cookie.split(";")[0];
}
