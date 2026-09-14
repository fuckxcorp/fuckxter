import type { Account } from "../auth";

export type SettingsSection = "profile" | "security" | "saved" | "storage";

export interface SettingsContext {
  getAccount: () => Account | null;
  setAccount: (account: Account) => void;
}

export function setStatus(element: HTMLElement | null, message: string): void {
  if (element) element.textContent = message;
}

export function downloadRecoveryCodes(codes: string[]): void {
  const content = [
    "FuckXter 恢复密钥",
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    ...codes,
    "",
    "请妥善保管：每个恢复密钥只能使用一次。",
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fuckxter-recovery-codes.txt";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
