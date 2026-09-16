import { navigate } from "astro:transitions/client";
import { getAccount, hydrateSession, type Account } from "../auth";
import { mountProfileSettings } from "./profile";
import { mountSecuritySettings } from "./security";
import { type SettingsContext, type SettingsSection } from "./shared";
import { mountStorageSettings } from "./storage";

export function mountFuckxterSettings(
  root: HTMLElement,
  initialTab: SettingsSection = "profile",
): void {
  if (root.dataset.fkSettingsMounted) return;
  root.dataset.fkSettingsMounted = "true";
  void mountSettings(root, initialTab);
}

async function mountSettings(
  root: HTMLElement,
  initialTab: SettingsSection,
): Promise<void> {
  let account: Account | null = getAccount();
  if (account) {
    void hydrateSession().then((next) => {
      if (next) {
        account = next;
      } else {
        account = null;
        void navigate("/");
      }
    });
  } else {
    account = await hydrateSession();
  }
  if (!account) {
    void navigate("/");
    return;
  }

  root
    .querySelector<HTMLButtonElement>("[data-role=back]")!
    .addEventListener("click", () => void navigate("/"));

  const context: SettingsContext = {
    getAccount: () => account,
    setAccount: (next) => {
      account = next;
    },
  };

  if (initialTab === "profile") mountProfileSettings(root, context);
  else if (initialTab === "security") mountSecuritySettings(root, context);
  else mountStorageSettings(root);
}
