import { HttpError } from "../shared/http";

export interface S3Config {
  id?: string;
  name?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  pathStyle?: boolean;
  isDefault?: boolean;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array<ArrayBuffer>,
  value: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function s3Target(input: S3Config, key: string): URL {
  const endpoint = new URL(input.endpoint?.trim() ?? "");
  const bucket = input.bucket?.trim() ?? "";
  const target = new URL(endpoint.toString());
  if (input.pathStyle) {
    target.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${bucket}/${key}`;
  } else {
    target.hostname = `${bucket}.${endpoint.hostname}`;
    target.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${key}`;
  }
  return target;
}

export function validateStorageInput(input: S3Config): void {
  if (!/^https?:\/\//.test(input.endpoint?.trim() ?? "")) {
    throw new HttpError(
      400,
      "INVALID_ENDPOINT",
      "Endpoint 必须以 http(s):// 开头。",
    );
  }
  if (!input.bucket?.trim()) {
    throw new HttpError(400, "BUCKET_REQUIRED", "必须填写 Bucket。");
  }
}

export async function signedS3Request(
  input: S3Config,
  method: "GET" | "HEAD" | "PUT" | "DELETE",
  key: string,
  body?: ArrayBuffer,
  contentType?: string,
): Promise<{ response: Response }> {
  validateStorageInput(input);
  const region = input.region?.trim() || "auto";
  const accessKeyId = input.accessKeyId?.trim() ?? "";
  const secretAccessKey = input.secretAccessKey ?? "";
  if (!accessKeyId || !secretAccessKey) {
    throw new HttpError(
      400,
      "STORAGE_CREDENTIALS_REQUIRED",
      "必须填写 Access Key ID 和 Secret Access Key。",
    );
  }

  const target = s3Target(input, key);

  const payloadHash = body
    ? hex(await crypto.subtle.digest("SHA-256", body))
    : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = encodePath(target.pathname || "/");
  const headers = new Headers({
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  });
  if (contentType) headers.set("Content-Type", contentType);

  const canonicalHeaderEntries = [
    ...(contentType ? [["content-type", contentType] as const] : []),
    ["host", target.host] as const,
    ["x-amz-content-sha256", payloadHash] as const,
    ["x-amz-date", amzDate] as const,
  ].sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = canonicalHeaderEntries
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join("");
  const signedHeaders = canonicalHeaderEntries.map(([name]) => name).join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalHash = hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalRequest),
    ),
  );
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, canonicalHash].join(
    "\n",
  );
  const dateKey = await hmacSha256(
    new TextEncoder().encode(`AWS4${secretAccessKey}`),
    dateStamp,
  );
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, "s3");
  const signingKey = await hmacSha256(serviceKey, "aws4_request");
  const signature = hex(await hmacSha256(signingKey, stringToSign));
  headers.set(
    "Authorization",
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  const response = await fetch(target, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  return { response };
}

export async function presignS3Request(
  input: S3Config,
  method: "PUT" | "DELETE",
  key: string,
  contentType?: string,
  expiresSeconds = 900,
): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  validateStorageInput(input);
  const region = input.region?.trim() || "auto";
  const accessKeyId = input.accessKeyId?.trim() ?? "";
  const secretAccessKey = input.secretAccessKey ?? "";
  if (!accessKeyId || !secretAccessKey) {
    throw new HttpError(
      400,
      "STORAGE_CREDENTIALS_REQUIRED",
      "必须填写 Access Key ID 和 Secret Access Key。",
    );
  }

  const target = s3Target(input, key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${accessKeyId}/${scope}`;
  const signedHeaders = contentType ? "content-type;host" : "host";
  const canonicalUri = encodePath(target.pathname || "/");
  const canonicalHeaders = contentType
    ? `content-type:${contentType.trim()}\nhost:${target.host}\n`
    : `host:${target.host}\n`;
  const queryEntries: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const canonicalQuery = queryEntries
    .map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const canonicalHash = hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalRequest),
    ),
  );
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, canonicalHash].join(
    "\n",
  );
  const dateKey = await hmacSha256(
    new TextEncoder().encode(`AWS4${secretAccessKey}`),
    dateStamp,
  );
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, "s3");
  const signingKey = await hmacSha256(serviceKey, "aws4_request");
  const signature = hex(await hmacSha256(signingKey, stringToSign));
  const url = new URL(target.toString());
  url.search = `${canonicalQuery}&X-Amz-Signature=${awsEncode(signature)}`;

  return {
    url: url.toString(),
    headers: contentType ? { "Content-Type": contentType } : {},
  };
}

export function presignS3Put(
  input: S3Config,
  key: string,
  contentType: string,
  expiresSeconds = 900,
) {
  return presignS3Request(input, "PUT", key, contentType, expiresSeconds);
}

export async function testStorageConnection(input: S3Config): Promise<string> {
  const key = `fuckxter/media/__connection-test-${crypto.randomUUID()}.txt`;
  const body = crypto.getRandomValues(new Uint8Array(32)).buffer;
  const put = await presignS3Request(input, "PUT", key, "text/plain");
  const putResponse = await fetch(put.url, {
    method: "PUT",
    headers: put.headers,
    body,
  });
  if (!putResponse.ok) {
    let detail = "";
    try {
      detail = (await putResponse.text()).trim().slice(0, 240);
    } catch {}
    throw new HttpError(
      502,
      "S3_WRITE_FAILED",
      `写入测试失败（S3 ${putResponse.status}）${detail ? `: ${detail}` : "。"}`,
    );
  }

  const remove = await presignS3Request(input, "DELETE", key);
  const removeResponse = await fetch(remove.url, { method: "DELETE" });
  if (!removeResponse.ok) {
    let detail = "";
    try {
      detail = (await removeResponse.text()).trim().slice(0, 240);
    } catch {}
    throw new HttpError(
      502,
      "S3_DELETE_FAILED",
      `删除测试失败（S3 ${removeResponse.status}）${detail ? `: ${detail}` : "。"}`,
    );
  }

  return `连接成功：${input.bucket} @ ${new URL(put.url).host}`;
}
