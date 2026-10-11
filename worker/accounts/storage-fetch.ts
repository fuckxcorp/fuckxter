import { HttpError } from "../shared/http";

export function storageURL(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(
      400,
      "INVALID_ENDPOINT",
      "Endpoint 必须是公开的 HTTPS 地址。",
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)
  ) {
    throw new HttpError(
      400,
      "INVALID_ENDPOINT",
      "Endpoint 必须是公开的 HTTPS 地址。",
    );
  }
  return url;
}

function publicAddress(value: string): boolean {
  if (value.includes(":")) {
    if (!/^[0-9a-f:]+$/i.test(value) || value.split("::").length > 2)
      return false;
    const halves = value.toLowerCase().split("::");
    const left = halves[0].split(":").filter(Boolean);
    const right = (halves[1] ?? "").split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return false;
    const words = [...left, ...Array(missing).fill("0"), ...right];
    if (words.some((word) => word.length > 4)) return false;
    const [a, b] = words.map((word) => Number.parseInt(word, 16));
    return (
      a >= 0x2000 &&
      a <= 0x3fff &&
      a !== 0x2002 &&
      !(a === 0x2001 && (b < 0x200 || b === 0xdb8))
    );
  }
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b, c] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export async function storageFetch(
  value: string | URL,
  init: RequestInit,
): Promise<Response> {
  const target = new URL(value);
  storageURL(target.origin);
  const answers = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const url = new URL("https://cloudflare-dns.com/dns-query");
      url.searchParams.set("name", target.hostname);
      url.searchParams.set("type", type);
      const response = await fetch(url, {
        headers: { Accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new HttpError(
          502,
          "STORAGE_UNAVAILABLE",
          "媒体所在的存储不可用。",
        );
      const dns = (await response.json()) as {
        Status?: number;
        Answer?: { type: number; data: string }[];
      };
      if (dns.Status !== 0)
        throw new HttpError(
          400,
          "INVALID_ENDPOINT",
          "Endpoint 必须是公开的 HTTPS 地址。",
        );
      return (dns.Answer ?? [])
        .filter((a) => a.type === 1 || a.type === 28)
        .map((a) => a.data);
    }),
  );
  const addresses = answers.flat();
  if (!addresses.length || addresses.some((ip) => !publicAddress(ip)))
    throw new HttpError(
      400,
      "INVALID_ENDPOINT",
      "Endpoint 必须是公开的 HTTPS 地址。",
    );
  const response = await fetch(target, {
    ...init,
    redirect: "manual",
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new HttpError(
      502,
      "S3_REDIRECT_FORBIDDEN",
      "存储服务发生重定向，请填写最终 Endpoint。",
    );
  }
  return response;
}
