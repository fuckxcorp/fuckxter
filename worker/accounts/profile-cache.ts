import type { Env } from "../shared/platform";
import { usernameKey } from "./usernames";

const TTL = 60;

const key = (handle: string) => `profile:${usernameKey(handle)}`;

export async function getCachedProfile<T>(
  env: Env,
  handle: string,
): Promise<T | null> {
  const value = await env.KV.get(key(handle));
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    await env.KV.delete(key(handle));
    return null;
  }
}

export function cacheProfile(
  env: Env,
  handle: string,
  profile: unknown,
): Promise<void> {
  return env.KV.put(key(handle), JSON.stringify(profile), {
    expirationTtl: TTL,
  });
}

export function clearProfileCache(env: Env, ...handles: string[]) {
  return Promise.all(handles.map((handle) => env.KV.delete(key(handle))));
}
