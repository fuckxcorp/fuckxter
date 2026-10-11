import type { Account } from "../accounts/auth";

export const draftKey = (account: Account): string =>
  `fk-draft:${encodeURIComponent(account.profile.email.toLowerCase())}:${encodeURIComponent(account.profile.handle)}`;
export function clearLegacyDraft(): void {
  document.cookie = "fk-post-draft=; Path=/; Max-Age=0; SameSite=Lax";
}
export function clearAccountDraft(account: Account | null): void {
  clearLegacyDraft();
  if (account) {
    try {
      localStorage.removeItem(draftKey(account));
    } catch {}
  }
}
export function readAccountDraft(account: Account | null): string {
  clearLegacyDraft();
  if (!account) return "";
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(account)) ?? "null");
    if (
      value &&
      typeof value.text === "string" &&
      typeof value.at === "number" &&
      Date.now() - value.at < 604800_000 &&
      value.at <= Date.now()
    )
      return value.text;
    localStorage.removeItem(draftKey(account));
  } catch {}
  return "";
}
export function saveAccountDraft(account: Account | null, text: string): void {
  clearLegacyDraft();
  if (!account) return;
  if (!text) {
    clearAccountDraft(account);
    return;
  }
  localStorage.setItem(
    draftKey(account),
    JSON.stringify({ text, at: Date.now() }),
  );
}
