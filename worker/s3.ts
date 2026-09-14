import { HttpError } from "./http";

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

export function validateStorageInput(input: S3Config): void {
  if (!/^https?:\/\//.test(input.endpoint?.trim() ?? "")) {
    throw new HttpError(
      400,
      "INVALID_ENDPOINT",
      "Endpoint must start with http(s)://.",
    );
  }
  if (!input.bucket?.trim()) {
    throw new HttpError(400, "BUCKET_REQUIRED", "Bucket is required.");
  }
}

export async function signedS3Request(
  input: S3Config,
  method: "GET" | "HEAD" | "PUT",
  key: string,
  body?: ArrayBuffer,
  contentType?: string,
): Promise<{ response: Response; endpoint: URL }> {
  validateStorageInput(input);
  const endpointValue = input.endpoint?.trim() ?? "";
  const region = input.region?.trim() || "auto";
  const bucket = input.bucket?.trim() ?? "";
  const accessKeyId = input.accessKeyId?.trim() ?? "";
  const secretAccessKey = input.secretAccessKey ?? "";
  if (!accessKeyId || !secretAccessKey) {
    throw new HttpError(
      400,
      "STORAGE_CREDENTIALS_REQUIRED",
      "Access Key ID and Secret Access Key are required.",
    );
  }

  const endpoint = new URL(endpointValue);
  const pathStyle = Boolean(input.pathStyle);
  const target = new URL(endpoint.toString());
  if (pathStyle) {
    target.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${bucket}/${key}`;
  } else {
    target.hostname = `${bucket}.${endpoint.hostname}`;
    target.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${key}`;
  }

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
  return { response, endpoint };
}

export async function testStorageConnection(input: S3Config): Promise<string> {
  const { response, endpoint } = await signedS3Request(input, "HEAD", "");
  if (response.ok) {
    return `Connection succeeded: ${input.bucket} @ ${endpoint.host}`;
  }
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(
      400,
      "S3_AUTH_FAILED",
      "Connection failed: the access key or secret key is invalid.",
    );
  }
  throw new HttpError(
    502,
    "S3_CONNECTION_FAILED",
    `Connection failed: S3 returned ${response.status}.`,
  );
}
