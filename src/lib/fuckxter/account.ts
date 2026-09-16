import { navigate } from "astro:transitions/client";
import {
  AUTH_REQUIRED_EVENT,
  getAccount,
  signIn,
  signOut,
  type Account,
} from "./auth";
import { getUnreadNotificationCount } from "./api";
import { avatarGradient } from "./dom";
import { ApiError, apiEndpoint } from "./http";
import { userPath } from "./urls";
import { isValidEmail } from "./validation";

interface AccountControlsOptions {
  onAccountChange: () => void;
}

export interface AccountControls {
  sync: () => void;
  dispose: () => void;
}

export function mountAccountControls(
  container: HTMLElement,
  options: AccountControlsOptions,
): AccountControls {
  const accountWrap = container.querySelector<HTMLElement>(".fk-account")!;
  const accountBtn = accountWrap.querySelector<HTMLButtonElement>(
    "[data-role=account-btn]",
  )!;
  const accountMenu = accountWrap.querySelector<HTMLElement>(
    "[data-role=account-menu]",
  )!;
  const authItems = accountMenu.querySelector<HTMLElement>(
    "[data-role=auth-items]",
  )!;
  const userItems = accountMenu.querySelector<HTMLElement>(
    "[data-role=user-items]",
  )!;
  const signoutItems = accountMenu.querySelector<HTMLElement>(
    "[data-role=signout-items]",
  )!;
  const menuAvatar = accountMenu.querySelector<HTMLElement>(
    "[data-role=menu-avatar]",
  )!;
  const menuName = accountMenu.querySelector<HTMLElement>(
    "[data-role=menu-name]",
  )!;
  const menuHandle = accountMenu.querySelector<HTMLElement>(
    "[data-role=menu-handle]",
  )!;
  const accountAvatar = container.querySelector<HTMLElement>(
    "[data-role=account-avatar]",
  )!;
  const accountIcon = container.querySelector<SVGElement>(
    "[data-role=account-icon]",
  )!;
  const noticeMenuItem = accountMenu.querySelector<HTMLElement>(
    "[data-role=notice-menu-item]",
  )!;
  const noticeMenuBadge = accountMenu.querySelector<HTMLElement>(
    "[data-role=notice-menu-badge]",
  )!;
  const accountNoticeDot = container.querySelector<HTMLElement>(
    "[data-role=account-notice-dot]",
  )!;
  const themeTrigger = accountMenu.querySelector<HTMLButtonElement>(
    "[data-account-open=theme]",
  )!;
  const themeSubmenu = accountMenu.querySelector<HTMLElement>(
    "[data-role=theme-submenu]",
  )!;

  const authModal = document.querySelector<HTMLElement>(
    "[data-role=auth-modal]",
  )!;

  let account: Account | null = getAccount();
  let unreadRequestId = 0;

  const setUnreadNotifications = (count: number) => {
    const unread = Math.max(0, Math.floor(count));
    const hasUnread = unread > 0;
    accountNoticeDot.hidden = !hasUnread;
    noticeMenuBadge.hidden = !hasUnread;
    noticeMenuBadge.textContent = unread > 99 ? "99+" : String(unread);
    noticeMenuItem.classList.toggle("has-unread", hasUnread);
    noticeMenuItem.setAttribute(
      "aria-label",
      hasUnread ? `通知，${unread} 条未读` : "通知",
    );
  };

  const refreshUnreadNotifications = async (owner: string) => {
    const requestId = ++unreadRequestId;
    try {
      const unread = await getUnreadNotificationCount();
      if (requestId !== unreadRequestId) return;
      if (!account || account.profile.handle !== owner) return;
      setUnreadNotifications(unread);
    } catch {
      // Notification status must not block the account menu.
    }
  };

  const applyThemeChoice = (mode: string) => {
    localStorage.setItem("theme", mode);
    const dark =
      mode === "dark" ||
      (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };

  const syncThemeMenu = () => {
    const current = localStorage.getItem("theme") ?? "auto";
    for (const item of themeSubmenu.querySelectorAll<HTMLButtonElement>(
      "[data-theme-choice]",
    )) {
      item.setAttribute(
        "aria-checked",
        item.dataset.themeChoice === current ? "true" : "false",
      );
    }
  };

  const renderAccountUI = () => {
    if (account) {
      accountAvatar.hidden = false;
      accountIcon.setAttribute("style", "display:none");
      accountAvatar.setAttribute(
        "style",
        avatarGradient(account.profile.handle),
      );
      menuAvatar.setAttribute("style", avatarGradient(account.profile.handle));
      for (const element of [accountAvatar, menuAvatar]) {
        const image = document.createElement("img");
        image.className = "fk-account-image";
        image.src = account.avatarUrl
          ? account.avatarUrl.startsWith("/")
            ? apiEndpoint(account.avatarUrl)
            : account.avatarUrl
          : "/user.avif";
        image.alt = "";
        image.decoding = "async";
        element.replaceChildren(image);
      }
      menuName.textContent = account.profile.name;
      menuHandle.textContent = `@${account.profile.handle}`;
      authItems.hidden = true;
      userItems.hidden = false;
      signoutItems.hidden = false;
      accountBtn.setAttribute("aria-label", "账号菜单");
      accountBtn.title = "账号菜单";
      void refreshUnreadNotifications(account.profile.handle);
    } else {
      unreadRequestId += 1;
      setUnreadNotifications(0);
      accountAvatar.hidden = true;
      accountIcon.removeAttribute("style");
      authItems.hidden = false;
      userItems.hidden = true;
      signoutItems.hidden = true;
      accountBtn.setAttribute("aria-label", "登录或注册");
      accountBtn.title = "登录或注册";
    }
    options.onAccountChange();
    syncThemeMenu();
  };

  const closeSubmenu = () => {
    themeSubmenu.hidden = true;
    themeTrigger.setAttribute("aria-expanded", "false");
  };

  const closeAccountMenu = () => {
    accountMenu.hidden = true;
    accountBtn.setAttribute("aria-expanded", "false");
    closeSubmenu();
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onMenuKeydown, true);
  };
  const onDocClick = (event: MouseEvent) => {
    if (!accountWrap.contains(event.target as Node)) closeAccountMenu();
  };
  const onMenuKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeAccountMenu();
  };

  accountBtn.addEventListener("click", () => {
    if (accountMenu.hidden) {
      renderAccountUI();
      accountMenu.hidden = false;
      accountBtn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onMenuKeydown, true);
    } else {
      closeAccountMenu();
    }
  });

  themeTrigger.addEventListener("click", () => {
    const willOpen = themeSubmenu.hidden;
    themeSubmenu.hidden = !willOpen;
    themeTrigger.setAttribute("aria-expanded", String(willOpen));
  });

  themeSubmenu.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-theme-choice]",
    );
    if (!item) return;
    applyThemeChoice(item.dataset.themeChoice!);
    syncThemeMenu();
    closeAccountMenu();
  });

  const onModalKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (!authModal.hidden) closeModal(authModal);
  };
  let modalKeysBound = false;
  const bindModalKeys = () => {
    if (modalKeysBound) return;
    modalKeysBound = true;
    document.addEventListener("keydown", onModalKeydown, true);
  };
  const unbindModalKeys = () => {
    if (!modalKeysBound || !authModal.hidden) return;
    modalKeysBound = false;
    document.removeEventListener("keydown", onModalKeydown, true);
  };
  const openModal = (modal: HTMLElement) => {
    modal.hidden = false;
    bindModalKeys();
  };
  const closeModal = (modal: HTMLElement) => {
    modal.hidden = true;
    unbindModalKeys();
  };
  const setStatus = (element: HTMLElement | null, message: string) => {
    if (element) element.textContent = message;
  };

  accountMenu.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const authOpen = target.closest<HTMLButtonElement>("[data-auth-open]");
    if (authOpen) {
      closeAccountMenu();
      openAuthModal();
      return;
    }
    const open = target.closest<HTMLButtonElement>("[data-account-open]");
    if (open) {
      if (open.dataset.accountOpen === "profile" && account) {
        closeAccountMenu();
        navigate(userPath(account.profile.handle));
      } else if (open.dataset.accountOpen === "notice" && account) {
        closeAccountMenu();
        navigate("/notice");
      } else if (open.dataset.accountOpen === "saved" && account) {
        closeAccountMenu();
        navigate("/settings/saved");
      } else if (open.dataset.accountOpen === "settings" && account) {
        closeAccountMenu();
        navigate("/settings/profile");
      }
      return;
    }
    const action = target.closest<HTMLButtonElement>("[data-account-action]")
      ?.dataset.accountAction;
    if (action === "signout") {
      void signOut().then(() => {
        account = null;
        closeAccountMenu();
        renderAccountUI();
      });
    }
  });

  const signinForm = authModal.querySelector<HTMLFormElement>(
    "[data-role=signin-form]",
  )!;
  const signinIdentifier =
    signinForm.querySelector<HTMLInputElement>("[name=identifier]")!;
  const signinStatus = authModal.querySelector<HTMLElement>(
    "[data-role=signin-status]",
  )!;
  const loginTfaField = authModal.querySelector<HTMLElement>(
    "[data-role=login-tfa-field]",
  )!;
  const loginTfaInput =
    loginTfaField.querySelector<HTMLInputElement>("[name=code]")!;

  const openAuthModal = () => {
    signinForm.reset();
    loginTfaField.hidden = true;
    setStatus(signinStatus, "");
    openModal(authModal);
  };

  authModal
    .querySelector<HTMLButtonElement>("[data-role=auth-close]")!
    .addEventListener("click", () => closeModal(authModal));
  authModal
    .querySelector<HTMLElement>("[data-role=auth-backdrop]")!
    .addEventListener("click", () => closeModal(authModal));

  const onAuthRequired = () => {
    closeAccountMenu();
    openAuthModal();
  };
  window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);

  signinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(signinForm);
    const identifier = String(data.get("identifier") ?? "").trim();
    if (!isValidEmail(identifier)) {
      signinIdentifier.setAttribute("aria-invalid", "true");
      setStatus(signinStatus, "请输入有效的邮箱地址");
      signinIdentifier.focus();
      return;
    }
    signinIdentifier.removeAttribute("aria-invalid");
    const button =
      signinForm.querySelector<HTMLButtonElement>(".fk-primary-btn")!;
    button.disabled = true;
    setStatus(signinStatus, "登录中…");
    try {
      account = await signIn({
        identifier,
        password: String(data.get("password") ?? ""),
        code: String(data.get("code") ?? ""),
      });
      renderAccountUI();
      closeModal(authModal);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "TWO_FACTOR_REQUIRED" || error.code === "INVALID_TOTP")
      ) {
        loginTfaField.hidden = false;
        loginTfaInput.focus();
      }
      setStatus(
        signinStatus,
        error instanceof Error ? error.message : "登录失败",
      );
    } finally {
      button.disabled = false;
    }
  });

  renderAccountUI();

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && account) {
      void refreshUnreadNotifications(account.profile.handle);
    }
  };
  const unreadInterval = window.setInterval(() => {
    if (document.visibilityState === "visible" && account) {
      void refreshUnreadNotifications(account.profile.handle);
    }
  }, 30_000);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    sync: () => {
      account = getAccount();
      renderAccountUI();
    },
    dispose: () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onMenuKeydown, true);
      document.removeEventListener("keydown", onModalKeydown, true);
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(unreadInterval);
      modalKeysBound = false;
    },
  };
}
