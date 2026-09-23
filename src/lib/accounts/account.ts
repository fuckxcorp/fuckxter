import { navigate } from "astro:transitions/client";
import { getAccount, signOut, type Account } from "./auth";
import { getUnreadMessageCount, getUnreadNotificationCount } from "./api";
import {
  avatarGradient,
  collapseSubmenus,
  hidePanel,
  isPanelOpen,
  showPanel,
} from "../ui/dom";
import { apiEndpoint } from "../core/http";
import { userPath } from "../core/urls";

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
  const accountWrap = container.querySelector<HTMLElement>(".account")!;
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

  let account: Account | null = getAccount();
  let unreadRequestId = 0;
  let messageRequestId = 0;
  let unreadNotices = 0;
  let unreadMessages = 0;

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
    } catch {}
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
      if (requestId !== messageRequestId) return;
      if (!account || account.profile.handle !== owner) return;
      setUnreadMessages(unread);
    } catch {}
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
        image.className = "account-image";
        image.src = account.avatarUrl
          ? account.avatarUrl.startsWith("/")
            ? apiEndpoint(account.avatarUrl)
            : account.avatarUrl
          : "/user.avif";
        image.alt = "";
        image.decoding = "async";
        image.fetchPriority = "low";
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

  const setPeeled = (open: boolean) => {
    document.documentElement.classList.toggle("menu-open", open);
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
  });

  accountMenu.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const authOpen = target.closest<HTMLButtonElement>("[data-auth-open]");
    if (authOpen) {
      closeAccountMenu();
      void navigate("/login");
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
      const name = account?.profile.handle;
      const ok = confirm(
        name
          ? `确定要注销 @${name} 吗？注销后需要重新登录。`
          : "确定要注销吗？注销后需要重新登录。",
      );
      if (!ok) return;
      void signOut().then(() => {
        account = null;
        closeAccountMenu();
        renderAccountUI();
      });
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
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(unreadInterval);
    },
  };
}
