import { navigate } from "astro:transitions/client";
import {
  createPost,
  deletePost,
  getStorageOptions,
  getTimeline,
  recordPostView,
  search,
  setFollow,
  toggleLike,
  toggleRepost,
  toggleSave,
  uploadMedia,
} from "../accounts/api";
import {
  getAccount,
  requestAuthentication,
  toFeedUser,
} from "../accounts/auth";
import {
  authorAvatar,
  avatarGradient,
  collapseSubmenus,
  el,
  fmtCount,
  hidePanel,
  isPanelOpen,
  postMetaText,
  renderPost,
  showPanel,
  setFollowButtonState,
  showToast,
  statusRow,
} from "../ui/dom";
import { ApiError, apiEndpoint } from "../core/http";
import { openPostShareMenu } from "../ui/share";
import type {
  FeedTab,
  Post,
  PostMedia,
  SearchResult,
  StorageOption,
} from "../core/types";
import { isHdrImage } from "../core/hdr";
import { dismissHomeSplash } from "../ui/splash";
import { postPath, userPath } from "../core/urls";

const MAX_CHARS = 1000;

const COLUMN_STORAGE_KEY = "fk_columns";

const COLUMN_QUERIES: [string, number][] = [
  ["(min-width: 2200px)", 4],
  ["(min-width: 1024px)", 3],
  ["(min-width: 700px)", 2],
];

export type ColumnChoice = "auto" | "1" | "2" | "3";

const autoColumnCount = (): number => {
  for (const [query, count] of COLUMN_QUERIES) {
    if (matchMedia(query).matches) return count;
  }
  return 1;
};

function readColumnChoice(): ColumnChoice {
  try {
    const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (
      stored === "auto" ||
      stored === "1" ||
      stored === "2" ||
      stored === "3"
    ) {
      return stored;
    }
  } catch {}

  // 未保存偏好时始终采用自适应列数；具体列数再由 autoColumnCount
  // 按当前视口决定，不能把首次访问固化成 1 列或 2 列偏好。
  return "auto";
}

function storeColumnChoice(choice: ColumnChoice): void {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, choice);
  } catch {}
}

interface FeedState {
  tab: FeedTab;
  cursor: string | null;
  done: boolean;
  loading: boolean;
  seq: number;
  search: string | null;
}

export interface FeedControls {
  syncUser: () => void;
  dispose: () => void;
}

function searchHead(result: SearchResult, exit: () => void): HTMLElement {
  const head = el("div", "search-head");
  const label = el("span");
  const strong = el("strong");
  strong.textContent = `“${result.query}”`;
  label.append(
    document.createTextNode(
      `搜索 ${strong.textContent} · ${result.users.length} 个用户 · ${result.posts.length} 条帖子`,
    ),
  );
  const exitBtn = el("button", "search-exit");
  exitBtn.type = "button";
  exitBtn.textContent = "返回推荐流";
  exitBtn.addEventListener("click", exit);
  head.append(label, exitBtn);
  return head;
}

function searchUsersSection(result: SearchResult): HTMLElement | null {
  if (result.users.length === 0) return null;
  const section = el("section", "search-users");
  const title = el("h2", "search-users-title");
  title.textContent = "用户";
  section.append(title);
  for (const user of result.users) {
    const row = el("div", "search-user");
    const avatar = authorAvatar(
      user.handle,
      user.name,
      "avatar",
      user.avatarUrl,
    );
    const copy = el("a", "search-user-copy");
    copy.href = userPath(user.handle);
    const name = el("strong");
    name.textContent = user.name;
    const handle = el("span");
    handle.textContent = `@${user.handle}`;
    const bio = el("p");
    bio.textContent = user.bio || "这个人很懒，什么都没有写。";
    copy.append(name, handle, bio);
    row.append(avatar, copy);
    section.append(row);
  }
  return section;
}

export function mountFeed(container: HTMLElement): FeedControls {
  const feed = container.querySelector<HTMLElement>(".feed")!;
  dismissHomeSplash();
  const sentinel = container.querySelector<HTMLElement>(".sentinel")!;
  const spinner = sentinel.querySelector<HTMLElement>(".spinner")!;
  const tabs = [...container.querySelectorAll<HTMLButtonElement>(".tab")];
  const accountMenu = container.querySelector<HTMLElement>(
    "[data-role=account-menu]",
  );
  const columnsTrigger = container.querySelector<HTMLButtonElement>(
    "[data-role=columns-trigger]",
  );
  const columnsSubmenu = container.querySelector<HTMLElement>(
    "[data-role=columns-submenu]",
  );
  const columnsValue = container.querySelector<HTMLElement>(
    "[data-role=columns-value]",
  );
  const composer = container.querySelector<HTMLElement>(".composer")!;
  const composerInput =
    container.querySelector<HTMLTextAreaElement>(".composer-input")!;
  const composerBtn = container.querySelector<HTMLButtonElement>(".post-btn")!;
  const charCount = container.querySelector<HTMLElement>(".char-count")!;
  const composerAuthHint = container.querySelector<HTMLElement>(
    "[data-role=composer-auth-hint]",
  )!;
  const mediaInput = container.querySelector<HTMLInputElement>(
    "[data-role=media-input]",
  )!;
  const attachMediaBtn = container.querySelector<HTMLButtonElement>(
    "[data-role=attach-media]",
  )!;
  const mediaStatus = container.querySelector<HTMLElement>(
    "[data-role=media-status]",
  )!;
  const mediaPreview = container.querySelector<HTMLElement>(
    "[data-role=media-preview]",
  )!;
  const mediaPreviewImages = container.querySelector<HTMLElement>(
    "[data-role=media-preview-images]",
  )!;
  const mediaHdrWrap = container.querySelector<HTMLElement>(
    "[data-role=media-hdr-wrap]",
  )!;
  const mediaHdrInput = container.querySelector<HTMLInputElement>(
    "[data-role=media-hdr]",
  )!;
  const mediaStorageWrap = container.querySelector<HTMLElement>(
    "[data-role=media-storage-wrap]",
  )!;
  const mediaStorageTrigger = container.querySelector<HTMLButtonElement>(
    "[data-role=media-storage-trigger]",
  )!;
  const mediaStorageValue = container.querySelector<HTMLElement>(
    "[data-role=media-storage-value]",
  )!;
  const mediaStorageMenu = container.querySelector<HTMLElement>(
    "[data-role=media-storage-menu]",
  )!;
  const visibilityTrigger = container.querySelector<HTMLButtonElement>(
    "[data-role=visibility-trigger]",
  );
  const visibilityValue = container.querySelector<HTMLElement>(
    "[data-role=visibility-value]",
  );
  const visibilityMenu = container.querySelector<HTMLElement>(
    "[data-role=visibility-menu]",
  );
  // visibility 在类型上是 optional，这里只需要实际的三个值。
  const VISIBILITY_LABELS: Record<NonNullable<Post["visibility"]>, string> = {
    public: "公开可见",
    mutual: "仅互关可见",
    private: "私密贴",
  };
  let selectedStorageId = "";
  let selectedVisibility: Post["visibility"] = "public";
  const searchInput =
    container.querySelector<HTMLInputElement>(".search-input")!;
  const composerAvatar =
    container.querySelector<HTMLElement>(".composer .avatar")!;
  let selectedMedia: PostMedia[] = [];
  const draftCookie = "fk-post-draft";
  const draftCookieOptions = () =>
    `Path=/; Max-Age=604800; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  const clearDraft = () => {
    document.cookie = `${draftCookie}=; Path=/; Max-Age=0; SameSite=Lax`;
  };
  const saveDraft = (text: string) => {
    if (!text) {
      clearDraft();
      return;
    }
    // Cookie 有约 4 KB 上限；保留能安全放入 Cookie 的最长前缀。
    let draft = text;
    while (draft && encodeURIComponent(draft).length > 3500) {
      draft = [...draft].slice(0, -1).join("");
    }
    document.cookie = `${draftCookie}=${encodeURIComponent(draft)}; ${draftCookieOptions()}`;
  };
  const readDraft = () => {
    const value = document.cookie
      .split("; ")
      .find((part) => part.startsWith(`${draftCookie}=`))
      ?.slice(draftCookie.length + 1);
    if (!value) return "";
    try {
      return decodeURIComponent(value);
    } catch {
      clearDraft();
      return "";
    }
  };

  const hdrMedia = new Set<string>();
  const canUseHdr = (media: PostMedia[] | undefined): boolean =>
    Boolean(media?.some((item) => hdrMedia.has(item.id)));

  const applyHdrPreview = () => {
    mediaPreview.classList.toggle("is-hdr", mediaHdrInput.checked);
  };

  const readHdrChoice = (): boolean =>
    canUseHdr(selectedMedia) && mediaHdrInput.checked;

  /** 把已选/已有的图片直接显示在按钮下面，尺寸和帖子里的图片一致 */
  const showMediaPreview = (media: PostMedia[] | undefined) => {
    if (!media?.length) {
      mediaPreview.hidden = true;
      mediaHdrWrap.hidden = true;
      mediaHdrInput.checked = false;
      applyHdrPreview();
      mediaPreviewImages.replaceChildren();
      return;
    }
    mediaPreviewImages.replaceChildren(
      ...media.map((item) => {
        const image = el("img", "media-image");
        image.src = item.url.startsWith("/") ? apiEndpoint(item.url) : item.url;
        image.alt = item.alt;
        return image;
      }),
    );
    mediaHdrWrap.hidden = !canUseHdr(media);
    mediaHdrInput.checked = media.some((item) => item.hdr === true);
    applyHdrPreview();
    mediaPreview.hidden = false;
  };
  let uploadingMedia = false;
  let failedMedia: File[] = [];
  let storageOptions: StorageOption[] | null = null;
  let storageOptionsPromise: Promise<void> | null = null;
  let storageOwner: string | null = null;
  let storageRequestId = 0;

  const menuChoice = (
    value: string,
    label: string,
    attr: string,
    checked: boolean,
  ): HTMLButtonElement => {
    const button = el("button", "menu-item");
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", checked ? "true" : "false");
    button.dataset[attr] = value;
    const check = el("span", "menu-check");
    check.textContent = "✓";
    button.append(check, document.createTextNode(label));
    return button;
  };

  const setVisibility = (value: Post["visibility"]) => {
    selectedVisibility = value;
    if (visibilityValue)
      visibilityValue.textContent = VISIBILITY_LABELS[value ?? "public"];
    visibilityMenu
      ?.querySelectorAll<HTMLButtonElement>("[data-visibility-choice]")
      .forEach((item) => {
        item.setAttribute(
          "aria-checked",
          item.dataset.visibilityChoice === value ? "true" : "false",
        );
      });
  };

  const storageLabel = (
    options: StorageOption[],
    emptyLabel = "默认存储桶",
  ): string => {
    const current = options.find((config) => config.id === selectedStorageId);
    if (!current) return emptyLabel;
    return `${current.name} · ${current.bucket}${
      current.isDefault ? "（默认）" : ""
    }`;
  };

  const renderStorageMenu = (
    options: StorageOption[],
    emptyLabel = options.length ? "默认存储桶" : "平台存储",
  ) => {
    mediaStorageValue.textContent = storageLabel(options, emptyLabel);
    mediaStorageMenu.replaceChildren(
      menuChoice("", emptyLabel, "storageChoice", selectedStorageId === ""),
      ...options.map((config) =>
        menuChoice(
          config.id,
          `${config.name} · ${config.bucket}${
            config.isDefault ? "（默认）" : ""
          }`,
          "storageChoice",
          config.id === selectedStorageId,
        ),
      ),
    );
  };

  const placeComposerSubmenu = (trigger: HTMLElement, submenu: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const gap = 10;
    const width = Math.max(228, submenu.offsetWidth || 228);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    submenu.style.position = "fixed";
    submenu.style.right = "auto";
    submenu.style.left = `${left}px`;
    const below = rect.bottom + gap;
    const estimated = submenu.offsetHeight || 160;
    if (
      below + estimated > window.innerHeight - 8 &&
      rect.top > estimated + gap
    ) {
      submenu.style.top = "auto";
      submenu.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else {
      submenu.style.bottom = "auto";
      submenu.style.top = `${below}px`;
    }
  };

  const pickerWraps = [mediaStorageWrap, visibilityMenu?.parentElement].filter(
    (node): node is HTMLElement => Boolean(node),
  );

  const closeComposerPickers = () => {
    for (const wrap of pickerWraps) {
      const submenu = wrap.querySelector<HTMLElement>(".submenu");
      const trigger = wrap.querySelector<HTMLButtonElement>(
        ".composer-picker-btn",
      );
      if (submenu) hidePanel(submenu);
      trigger?.setAttribute("aria-expanded", "false");
    }
    document.removeEventListener("click", onPickerDocClick, true);
  };

  const onPickerDocClick = (event: MouseEvent) => {
    const target = event.target as Node;
    if (pickerWraps.some((wrap) => wrap.contains(target))) return;
    closeComposerPickers();
  };

  const toggleComposerPicker = (
    trigger: HTMLButtonElement,
    submenu: HTMLElement,
  ) => {
    const willOpen = !isPanelOpen(submenu);
    if (willOpen) collapseSubmenus(container, submenu);
    closeComposerPickers();
    if (!willOpen) return;
    showPanel(submenu);
    trigger.setAttribute("aria-expanded", "true");
    placeComposerSubmenu(trigger, submenu);
    document.addEventListener("click", onPickerDocClick, true);
  };

  const loadStorageOptions = (owner: string): Promise<void> => {
    if (storageOptions) return Promise.resolve();
    if (storageOptionsPromise) return storageOptionsPromise;
    const requestId = ++storageRequestId;
    const request = getStorageOptions()
      .then((options) => {
        if (storageOwner !== owner) return;
        storageOptions = options;
        if (!options.some((config) => config.id === selectedStorageId)) {
          selectedStorageId = "";
        }
        renderStorageMenu(options);
      })
      .catch((error: unknown) => {
        if (storageOwner !== owner) return;
        // 读不到配置就静默用平台存储，不打扰用户
        storageOptions = [];
        selectedStorageId = "";
        renderStorageMenu([], "平台存储");
        console.error("Failed to load storage options", error);
      })
      .finally(() => {
        if (storageRequestId === requestId) storageOptionsPromise = null;
      });
    storageOptionsPromise = request;
    return request;
  };

  const syncComposerUser = () => {
    const account = getAccount();
    const me = toFeedUser(account);
    composerAvatar.setAttribute("style", avatarGradient(me.handle));
    composerAvatar.title = `@${me.handle}`;
    const image = document.createElement("img");
    image.className = "avatar-image";
    image.src = account?.avatarUrl
      ? account.avatarUrl.startsWith("/")
        ? apiEndpoint(account.avatarUrl)
        : account.avatarUrl
      : "/user.avif";
    image.alt = me.name;
    image.decoding = "async";
    composerAvatar.replaceChildren(image);
    composerAuthHint.hidden = Boolean(account);
    composerBtn.textContent = account ? "发帖" : "注册后发帖";
    const composerLength = [...composerInput.value].length;
    composerBtn.disabled =
      !account ||
      composerLength === 0 ||
      composerLength > MAX_CHARS ||
      uploadingMedia;
    composerInput.placeholder = account ? "有什么新鲜事？" : "注册后才能发帖";
    mediaStorageWrap.hidden = !account;
    mediaStorageTrigger.disabled = !account;
    const owner = account?.profile.handle ?? null;
    if (owner !== storageOwner) {
      storageOwner = owner;
      storageRequestId += 1;
      storageOptions = null;
      storageOptionsPromise = null;
      selectedStorageId = "";
      renderStorageMenu([]);
    }
    if (!account) {
      selectedMedia = [];
      mediaInput.value = "";
      mediaStatus.hidden = true;
      showMediaPreview([]);
    }
  };
  syncComposerUser();

  const state: FeedState = {
    tab: "foryou",
    cursor: null,
    done: false,
    loading: false,
    seq: 0,
    search: null,
  };

  let columnsRoot: HTMLElement | null = null;
  let columns: HTMLElement[] = [];
  let activeColumnCount = 0;
  let columnPreference: ColumnChoice = readColumnChoice();
  const orderedPosts: HTMLElement[] = [];
  const postsById = new Map<string, Post>();

  const columnCount = (): number =>
    columnPreference === "auto" ? autoColumnCount() : Number(columnPreference);

  const buildColumns = (count: number): HTMLElement => {
    const root = el("div", "feed-columns");
    if (count > 1) root.classList.add("is-masonry");
    else root.classList.add("is-single");
    columns = Array.from({ length: count }, () => {
      const column = el("div", "feed-col");
      root.append(column);
      return column;
    });
    activeColumnCount = count;
    return root;
  };

  const shortestColumn = (): HTMLElement => {
    let target = columns[0];
    for (const column of columns) {
      if (column.offsetHeight < target.offsetHeight) target = column;
    }
    return target;
  };

  const ensureLayout = (): void => {
    const count = columnCount();
    if (columnsRoot && count === activeColumnCount) return;
    const root = buildColumns(count);
    if (columnsRoot) columnsRoot.replaceWith(root);
    else feed.append(root);
    columnsRoot = root;
    orderedPosts.forEach((post, index) => {
      const column = index < columns.length ? columns[index] : shortestColumn();
      column.append(post);
    });
  };

  const onMediaChange = () => ensureLayout();
  for (const [query] of COLUMN_QUERIES) {
    matchMedia(query).addEventListener("change", onMediaChange);
  }

  const syncColumnsMenu = () => {
    if (columnsValue) {
      columnsValue.textContent =
        columnPreference === "auto" ? "自动" : `${columnPreference} 列`;
    }
    columnsSubmenu
      ?.querySelectorAll<HTMLButtonElement>("[data-columns-choice]")
      .forEach((item) => {
        item.setAttribute(
          "aria-checked",
          String(item.dataset.columnsChoice === columnPreference),
        );
      });
  };

  const applyColumnChoice = (choice: ColumnChoice) => {
    columnPreference = choice;
    storeColumnChoice(choice);
    syncColumnsMenu();
    activeColumnCount = 0;
    ensureLayout();
  };

  const viewedPosts = new Set<string>();
  const viewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target as HTMLElement;
        viewObserver.unobserve(node);
        const id = node.dataset.postId;
        if (!id || viewedPosts.has(id)) continue;
        viewedPosts.add(id);
        void recordPostView(id)
          .then((result) => {
            const post = postsById.get(id);
            if (post) post.stats.views = result.views;
            const meta = node.querySelector<HTMLElement>(".post-meta");
            if (post && meta) meta.textContent = postMetaText(post, "relative");
          })
          .catch(() => {
            viewedPosts.delete(id);
          });
      }
    },
    { root: null, rootMargin: "0px 0px -10% 0px", threshold: 0.45 },
  );

  const resetFeed = (head?: HTMLElement): void => {
    for (const node of orderedPosts) viewObserver.unobserve(node);
    orderedPosts.length = 0;
    feed.replaceChildren();
    if (head) feed.append(head);
    columnsRoot = null;
    activeColumnCount = 0;
    ensureLayout();
  };

  const addPost = (post: Post): HTMLElement => {
    ensureLayout();
    const node = renderPost(post);
    if (post.viewer?.saved) {
      node
        .querySelector<HTMLElement>('.action[data-action="save"]')
        ?.classList.add("is-saved");
    }
    orderedPosts.push(node);
    postsById.set(post.id, post);
    const column =
      orderedPosts.length - 1 < columns.length
        ? columns[orderedPosts.length - 1]
        : shortestColumn();
    column.append(node);
    viewObserver.observe(node);
    return node;
  };

  /**
   * 用户刚发出的帖子优先留在本机信息流顶部。不要立刻重拉首页，
   * 否则服务端的时间/热度排序可能会把它挪走；刷新后再以服务器排序为准。
   */
  const addPostAtStart = (post: Post): HTMLElement => {
    feed.querySelectorAll(".status").forEach((node) => node.remove());
    const node = renderPost(post);
    if (post.viewer?.saved) {
      node
        .querySelector<HTMLElement>('.action[data-action="save"]')
        ?.classList.add("is-saved");
    }
    orderedPosts.unshift(node);
    postsById.set(post.id, post);
    // 多列布局也按照新的数组顺序重新分栏，确保视觉上的第一条就是新帖。
    activeColumnCount = 0;
    ensureLayout();
    viewObserver.observe(node);
    return node;
  };

  const setSentinelBusy = (busy: boolean) => {
    sentinel.classList.toggle("is-done", state.done && !busy);
    spinner.style.visibility = busy ? "visible" : "hidden";
  };

  const sentinelReached = (): boolean => {
    const rect = sentinel.getBoundingClientRect();
    return rect.top - window.innerHeight < 360;
  };

  const renderError = (retry: () => void) => {
    feed.querySelectorAll(".status").forEach((node) => node.remove());
    const row = el("div", "status");
    row.append(
      document.createTextNode("加载失败。"),
      Object.assign(el("button", "retry-btn"), {
        type: "button",
        textContent: "重试",
      }),
    );
    row.querySelector("button")!.addEventListener("click", retry);
    feed.append(row);
  };

  const loadPage = async (replace: boolean) => {
    if (state.search !== null) return;
    if (!replace && (state.loading || state.done)) return;

    const seq = ++state.seq;
    state.loading = true;
    setSentinelBusy(true);
    try {
      const page = await getTimeline(state.tab, replace ? null : state.cursor);
      if (seq !== state.seq) return;
      if (replace) resetFeed();
      for (const post of page.posts) addPost(post);
      state.cursor = page.nextCursor;
      state.done = page.nextCursor === null;
      if (state.done && orderedPosts.length === 0) {
        feed.append(statusRow("还没有帖子，发布第一条吧。"));
      } else if (state.done) {
        feed.append(statusRow("你已看完全部内容"));
      } else if (sentinelReached()) {
        window.setTimeout(() => {
          if (seq === state.seq) loadPage(false);
        }, 0);
      }
    } catch {
      if (seq === state.seq) renderError(() => loadPage(replace));
    } finally {
      if (seq === state.seq) {
        state.loading = false;
        setSentinelBusy(false);
        if (replace) dismissHomeSplash();
      }
    }
  };

  const setSearchUrl = (query: string | null) => {
    const url = new URL(location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const exitSearch = () => {
    state.search = null;
    state.done = false;
    state.cursor = null;
    composer.hidden = false;
    searchInput.value = "";
    setSearchUrl(null);
    loadPage(true);
  };

  const doSearch = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) {
      if (state.search !== null) exitSearch();
      return;
    }
    const seq = ++state.seq;
    state.search = query;
    state.done = true;
    setSearchUrl(query);
    state.loading = true;
    composer.hidden = true;
    setSentinelBusy(true);
    try {
      const result = await search(query);
      if (seq !== state.seq) return;
      resetFeed(searchHead(result, exitSearch));
      const usersSection = searchUsersSection(result);
      if (usersSection) columnsRoot?.before(usersSection);
      if (result.users.length === 0 && result.posts.length === 0) {
        feed.append(statusRow("没有找到相关内容"));
      }
      for (const post of result.posts) addPost(post);
    } catch {
      if (seq === state.seq) renderError(() => doSearch(query));
    } finally {
      if (seq === state.seq) {
        state.loading = false;
        setSentinelBusy(false);
        dismissHomeSplash();
      }
    }
  };

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void doSearch(searchInput.value);
  });

  const collapseColumnsSubmenu = () => {
    if (!columnsSubmenu) return;
    hidePanel(columnsSubmenu);
    columnsTrigger?.setAttribute("aria-expanded", "false");
  };

  columnsTrigger?.addEventListener("click", () => {
    if (!columnsSubmenu) return;
    const willOpen = !isPanelOpen(columnsSubmenu);
    if (willOpen) collapseSubmenus(container, columnsSubmenu);
    if (willOpen) showPanel(columnsSubmenu);
    else hidePanel(columnsSubmenu);
    columnsTrigger.setAttribute("aria-expanded", String(willOpen));
  });

  columnsSubmenu?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-columns-choice]",
    );
    const choice = item?.dataset.columnsChoice;
    if (choice !== "auto" && choice !== "1" && choice !== "2" && choice !== "3")
      return;
    applyColumnChoice(choice);
  });

  mediaStorageTrigger.addEventListener("click", () => {
    const account = getAccount();
    if (!account) {
      requestAuthentication();
      return;
    }
    toggleComposerPicker(mediaStorageTrigger, mediaStorageMenu);
    void loadStorageOptions(account.profile.handle).then(() => {
      if (isPanelOpen(mediaStorageMenu)) {
        placeComposerSubmenu(mediaStorageTrigger, mediaStorageMenu);
      }
    });
  });

  mediaStorageMenu.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-storage-choice]",
    );
    if (!item || item.dataset.storageChoice === undefined) return;
    selectedStorageId = item.dataset.storageChoice;
    renderStorageMenu(storageOptions ?? []);
    closeComposerPickers();
  });

  visibilityTrigger?.addEventListener("click", () => {
    if (!visibilityMenu) return;
    toggleComposerPicker(visibilityTrigger, visibilityMenu);
  });

  visibilityMenu?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-visibility-choice]",
    );
    const choice = item?.dataset.visibilityChoice;
    if (choice !== "public" && choice !== "mutual" && choice !== "private")
      return;
    setVisibility(choice);
    closeComposerPickers();
  });

  window.addEventListener("scroll", closeComposerPickers, { passive: true });

  const accountMenuObserver = accountMenu
    ? new MutationObserver(() => {
        if (accountMenu.hidden) collapseColumnsSubmenu();
        else closeComposerPickers();
      })
    : null;
  accountMenuObserver?.observe(accountMenu!, {
    attributes: true,
    attributeFilter: ["hidden"],
  });

  syncColumnsMenu();

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const next = tab.dataset.tab as FeedTab | undefined;
      if (!next) return;
      if (state.search === null && next === state.tab) return;
      if (state.search !== null) {
        state.search = null;
        composer.hidden = false;
        searchInput.value = "";
      }
      state.tab = next;
      state.cursor = null;
      state.done = false;
      for (const item of tabs) item.classList.toggle("is-active", item === tab);
      void loadPage(true);
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadPage(false);
    },
    { root: null, rootMargin: "360px" },
  );
  observer.observe(sentinel);

  const flashCount = (button: HTMLElement) => {
    const counter = button.querySelector<HTMLElement>(".action-count");
    if (!counter) return;
    counter.classList.remove("is-flash");
    void counter.offsetWidth;
    counter.classList.add("is-flash");
  };

  const setCount = (button: HTMLElement, count: number) => {
    button.querySelector<HTMLElement>(".action-count")!.textContent =
      count > 0 ? fmtCount(count) : "";
  };

  feed.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".media")) return;

    const avatarLink = target.closest<HTMLElement>(".avatar-link");
    if (avatarLink?.dataset.handle) {
      event.preventDefault();
      void navigate(userPath(avatarLink.dataset.handle));
      return;
    }

    const inlineLink = target.closest<HTMLAnchorElement>(".inline-link");
    if (inlineLink) {
      event.preventDefault();
      if (inlineLink.dataset.hashtag) {
        const query = `#${inlineLink.dataset.hashtag}`;
        searchInput.value = query;
        void doSearch(query);
        window.scrollTo({ top: 0 });
      } else if (inlineLink.dataset.mention) {
        void navigate(userPath(inlineLink.dataset.mention));
      }
      return;
    }

    const followButton = target.closest<HTMLButtonElement>(".follow-btn");
    if (followButton?.dataset.handle) {
      if (!getAccount()) {
        requestAuthentication();
        return;
      }
      followButton.disabled = true;
      const following = followButton.dataset.following !== "true";
      try {
        const result = await setFollow(followButton.dataset.handle, following);
        setFollowButtonState(followButton, result.following);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          requestAuthentication();
        }
      } finally {
        followButton.disabled = false;
      }
      return;
    }

    const button = target.closest<HTMLButtonElement>(".action");
    if (!button) {
      const article = target.closest<HTMLElement>(".post");
      const id = article?.dataset.postId;
      const post = id ? postsById.get(id) : undefined;
      if (post && article) {
        article.classList.add("is-opening");
        window.setTimeout(() => void navigate(postPath(post)), 140);
      }
      return;
    }

    const article = button.closest<HTMLElement>(".post");
    const id = article?.dataset.postId;
    const post = id ? postsById.get(id) : undefined;
    if (!id || !post) return;
    const action = button.dataset.action;

    if (action === "save") {
      const willSave = !button.classList.contains("is-saved");
      button.classList.toggle("is-saved", willSave);
      try {
        await toggleSave(post, willSave);
      } catch {
        button.classList.toggle("is-saved", !willSave);
      }
      return;
    }

    if (action === "like" || action === "repost") {
      const activeClass = action === "like" ? "is-liked" : "is-reposted";
      const willActive = !button.classList.contains(activeClass);
      button.classList.toggle(activeClass, willActive);
      flashCount(button);
      const current = Number(button.dataset.count ?? "0");
      const optimistic = Math.max(0, current + (willActive ? 1 : -1));
      button.dataset.count = String(optimistic);
      setCount(button, optimistic);
      try {
        let serverCount: number;
        let serverActive: boolean;
        if (action === "like") {
          const result = await toggleLike(id, willActive);
          serverCount = result.likes;
          serverActive = result.liked;
        } else {
          const result = await toggleRepost(id, willActive);
          serverCount = result.reposts;
          serverActive = result.reposted;
        }
        button.dataset.count = String(serverCount);
        setCount(button, serverCount);
        button.classList.toggle(activeClass, serverActive);
      } catch {
        button.classList.toggle(activeClass, !willActive);
        button.dataset.count = String(current);
        setCount(button, current);
      }
      return;
    }

    if (action === "reply") {
      if (!getAccount()) {
        requestAuthentication();
        return;
      }
      void navigate(`${postPath(post)}#reply`);
      return;
    }

    if (action === "edit") {
      if (!post.viewer?.isAuthor) return;
      void navigate(`/edit?post=${encodeURIComponent(postPath(post))}`);
      return;
    }

    if (action === "delete") {
      if (!post.viewer?.isAuthor || !confirm("确定删除这条帖子吗？")) return;
      button.disabled = true;
      try {
        await deletePost(post.id);
        postsById.delete(post.id);
        const index = orderedPosts.indexOf(article);
        if (index !== -1) orderedPosts.splice(index, 1);
        article.remove();
        if (orderedPosts.length === 0) {
          feed.append(statusRow("还没有帖子，发布第一条吧。"));
        }
      } catch (error) {
        button.disabled = false;
        mediaStatus.textContent =
          error instanceof Error ? error.message : "删除失败，请重试。";
        mediaStatus.hidden = false;
      }
      return;
    }

    if (action === "share") {
      const result = await openPostShareMenu(button, post);
      if (result === "copied") showToast("链接已复制");
      if (result === "shared") showToast("已分享");
      if (result === "failed") showToast("分享失败");
    }
  });

  const syncComposer = () => {
    const length = [...composerInput.value].length;
    charCount.textContent = `${length} / ${MAX_CHARS}`;
    charCount.classList.toggle("is-over", length > MAX_CHARS);
    composerBtn.disabled =
      !getAccount() || length === 0 || length > MAX_CHARS || uploadingMedia;
  };

  const resetComposer = () => {
    showMediaPreview([]);
    composerInput.value = "";
    clearDraft();
    composerInput.style.height = "";
    selectedMedia = [];
    mediaStatus.textContent = "";
    mediaStatus.hidden = true;
    composerBtn.textContent = getAccount() ? "发帖" : "注册后发帖";
    syncComposer();
  };

  composerInput.addEventListener("input", () => {
    saveDraft(composerInput.value);
    syncComposer();
    composerInput.style.height = "auto";
    composerInput.style.height = `${composerInput.scrollHeight}px`;
  });
  const draft = readDraft();
  if (draft) {
    composerInput.value = draft;
    composerInput.style.height = "auto";
    composerInput.style.height = `${composerInput.scrollHeight}px`;
  }
  composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeComposerPickers();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!composerBtn.disabled) composerBtn.click();
    }
  });
  syncComposer();

  attachMediaBtn.addEventListener("click", () => {
    const account = getAccount();
    if (!account) {
      requestAuthentication();
      return;
    }
    void loadStorageOptions(account.profile.handle);
    mediaInput.click();
  });

  mediaHdrInput.addEventListener("change", applyHdrPreview);

  const uploadFiles = async (files: File[], keep: boolean) => {
    uploadingMedia = true;
    attachMediaBtn.disabled = true;
    mediaStatus.textContent = "上传中…";
    mediaStatus.hidden = false;
    syncComposer();
    if (!keep) {
      selectedMedia = [];
      hdrMedia.clear();
    }
    failedMedia = [];
    const progress = files.map(() => 0);
    const mode =
      localStorage.getItem("fk-upload-mode") === "direct" ? "direct" : "proxy";
    const results = await Promise.allSettled(
      files.map(async (file, index) => {
        const hdr = await isHdrImage(file);
        const media = await uploadMedia(
          file,
          selectedStorageId || undefined,
          (percent) => {
            progress[index] = percent;
            const total = Math.round(
              progress.reduce((sum, value) => sum + value, 0) / files.length,
            );
            mediaStatus.textContent = `上传中 ${total}%`;
          },
          mode,
        );
        if (hdr) hdrMedia.add(media.id);
        return media;
      }),
    );
    const errors: unknown[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") selectedMedia.push(result.value);
      else {
        failedMedia.push(files[index]);
        errors.push(result.reason);
      }
    });
    showMediaPreview(selectedMedia);
    if (failedMedia.length) {
      const error = errors[0];
      const message =
        error instanceof ApiError && error.code === "STORAGE_REQUIRED"
          ? "请先在设置中配置自定义存储。"
          : `${failedMedia.length} 张图片上传失败`;
      const retry = el("button", "media-retry");
      retry.type = "button";
      retry.textContent = "重试";
      retry.addEventListener("click", () => {
        const pending = failedMedia;
        void uploadFiles(pending, true);
      });
      mediaStatus.replaceChildren(
        document.createTextNode(`${message} · `),
        retry,
      );
      mediaStatus.hidden = false;
      if (error instanceof ApiError && error.status === 401) {
        requestAuthentication();
      }
    } else {
      mediaStatus.hidden = true;
    }
    uploadingMedia = false;
    attachMediaBtn.disabled = false;
    mediaInput.value = "";
    syncComposer();
  };

  mediaInput.addEventListener("change", async () => {
    const selected = [...(mediaInput.files ?? [])];
    if (selected.length > 3) {
      mediaStatus.textContent = "每条帖子最多上传 3 张图片。";
      mediaStatus.hidden = false;
      mediaInput.value = "";
      return;
    }
    const files = selected;
    if (!files.length) return;
    try {
      await uploadFiles(files, false);
    } catch (error) {
      mediaStatus.textContent =
        error instanceof Error ? error.message : "图片上传失败";
      uploadingMedia = false;
      attachMediaBtn.disabled = false;
      mediaInput.value = "";
      syncComposer();
    }
  });

  composerBtn.addEventListener("click", async () => {
    if (!getAccount()) {
      requestAuthentication();
      return;
    }
    const text = composerInput.value.trim();
    if (!text) return;
    const label = composerBtn.textContent;
    composerBtn.disabled = true;
    composerBtn.textContent = "发送中…";
    mediaStatus.textContent = "";
    mediaStatus.hidden = true;
    try {
      let created: Post | null = null;
      created = await createPost(
        text,
        selectedMedia.map((media) => media.id),
        selectedVisibility,
        readHdrChoice(),
      );
      if (state.search !== null) {
        searchInput.value = "";
        state.search = null;
      }
      composer.hidden = false;
      resetComposer();
      window.scrollTo({ top: 0 });
      if (created) {
        addPostAtStart(created);
      } else {
        // 编辑已有帖子仍以服务端结果更新当前列表。
        state.cursor = null;
        state.done = false;
        await loadPage(true);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        composerBtn.textContent = "注册后发帖";
        composerBtn.disabled = false;
        requestAuthentication();
        return;
      }
      const message =
        error instanceof Error ? error.message : "发送失败，请稍后重试。";
      composerBtn.textContent = "发送失败";
      mediaStatus.textContent = message;
      mediaStatus.hidden = false;
      setTimeout(() => {
        composerBtn.textContent = label;
        syncComposer();
      }, 1600);
      return;
    }
    composerBtn.textContent = label;
  });

  const initialQuery = new URL(location.href).searchParams.get("q")?.trim();
  if (initialQuery) {
    searchInput.value = initialQuery;
    void doSearch(initialQuery);
  } else {
    void loadPage(true);
  }

  return {
    syncUser: syncComposerUser,
    dispose: () => {
      observer.disconnect();
      viewObserver.disconnect();
      accountMenuObserver?.disconnect();
      closeComposerPickers();
      window.removeEventListener("scroll", closeComposerPickers);
      for (const [query] of COLUMN_QUERIES) {
        matchMedia(query).removeEventListener("change", onMediaChange);
      }
    },
  };
}
