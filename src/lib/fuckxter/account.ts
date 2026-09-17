import { navigate } from "astro:transitions/client";
import {
  AUTH_REQUIRED_EVENT,
  getAccount,
  signIn,
  signOut,
  type Account,
} from "./auth";
import { getUnreadMessageCount, getUnreadNotificationCount } from "./api";
import {
  avatarGradient,
  collapseSubmenus,
  hidePanel,
  isPanelOpen,
  showPanel,
} from "./dom";
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
  const messageMenuItem = accountMenu.querySelector<HTMLElement>(
    "[data-role=message-menu-item]",
  )!;
  const messageMenuBadge = accountMenu.querySelector<HTMLElement>(
    "[data-role=message-menu-badge]",
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
  let messageRequestId = 0;
  let unreadNotices = 0;
  let unreadMessages = 0;

  /** 头像上的小红点：通知或私信有未读都会亮。 */
  const syncUnreadDot = () => {
    accountNoticeDot.hidden = unreadNotices === 0 && unreadMessages === 0;
  };

  const setUnreadNotifications = (count: number) => {
    const unread = Math.max(0, Math.floor(count));
    const hasUnread = unread > 0;
    unreadNotices = unread;
    syncUnreadDot();
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

  const setUnreadMessages = (count: number) => {
    const unread = Math.max(0, Math.floor(count));
    const hasUnread = unread > 0;
    unreadMessages = unread;
    syncUnreadDot();
    messageMenuBadge.hidden = !hasUnread;
    messageMenuBadge.textContent = unread > 99 ? "99+" : String(unread);
    messageMenuItem.classList.toggle("has-unread", hasUnread);
    messageMenuItem.setAttribute(
      "aria-label",
      hasUnread ? `私信，${unread} 条未读` : "私信",
    );
  };

  const refreshUnreadMessages = async (owner: string) => {
    const requestId = ++messageRequestId;
    try {
      const unread = await getUnreadMessageCount();
      if (requestId !== unreadRequestId) return;
      if (!account || account.profile.handle !== owner) return;
      setUnreadMessages(unread);
    } catch {
      // 私信计数失败不能影响菜单其他部分。
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
      void refreshUnreadMessages(account.profile.handle);
    } else {
      unreadRequestId += 1;
      messageRequestId += 1;
      setUnreadNotifications(0);
      setUnreadMessages(0);
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
    hidePanel(themeSubmenu);
    themeTrigger.setAttribute("aria-expanded", "false");
  };

  /** 菜单展开时，让左侧的页面像纸被掀起来一样。 */
  const setPeeled = (open: boolean) => {
    document.documentElement.classList.toggle("fk-menu-open", open);
  };

  const closeAccountMenu = () => {
    hidePanel(accountMenu);
    setPeeled(false);
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
    if (!isPanelOpen(accountMenu)) {
      renderAccountUI();
      showPanel(accountMenu);
      setPeeled(true);
      accountBtn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onMenuKeydown, true);
    } else {
      closeAccountMenu();
    }
  });

  themeTrigger.addEventListener("click", () => {
    const willOpen = !isPanelOpen(themeSubmenu);
    // 展開主題時把列數那類子選單收起來，兩塊面板才不會疊在一起。
    if (willOpen) collapseSubmenus(accountMenu, themeSubmenu);
    if (willOpen) showPanel(themeSubmenu);
    else hidePanel(themeSubmenu);
    themeTrigger.setAttribute("aria-expanded", String(willOpen));
  });

  themeSubmenu.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-theme-choice]",
    );
    if (!item) return;
    applyThemeChoice(item.dataset.themeChoice!);
    syncThemeMenu();
    // 保留選單開著，讓勾選的白色平行四邊形動畫看得見。
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
      } else if (open.dataset.accountOpen === "messages" && account) {
        closeAccountMenu();
        navigate("/messages");
      } else if (open.dataset.accountOpen === "saved" && account) {
        closeAccountMenu();
        navigate("/saved");
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
      void refreshUnreadMessages(account.profile.handle);
    }
  };
  const unreadInterval = window.setInterval(() => {
    if (document.visibilityState === "visible" && account) {
      void refreshUnreadNotifications(account.profile.handle);
      void refreshUnreadMessages(account.profile.handle);
    }
  }, 30_000);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    sync: () => {
      account = getAccount();
      renderAccountUI();
    },
    dispose: () => {
      setPeeled(false);
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
