import { navigate } from "astro:transitions/client";
import { prefetch } from "astro:prefetch";
import {
  createPost,
  deletePost,
  getStorageOptions,
  getTimeline,
  search,
  setFollow,
  toggleLike,
  toggleRepost,
  toggleSave,
  updatePost,
  uploadMedia,
} from "./api";
import { getAccount, requestAuthentication, toFeedUser } from "./auth";
import {
  authorAvatar,
  avatarGradient,
  el,
  fmtCount,
  renderPost,
  setFollowButtonState,
  showToast,
  statusRow,
} from "./dom";
import { ApiError, apiEndpoint } from "./http";
import { openPostShareMenu } from "./share";
import type {
  FeedTab,
  Post,
  PostMedia,
  SearchResult,
  StorageOption,
} from "./types";
import { postPath, userPath } from "./urls";

const MAX_CHARS = 1000;

const COLUMN_QUERIES: [string, number][] = [
  ["(min-width: 2200px)", 4],
  ["(min-width: 1024px)", 3],
  ["(min-width: 700px)", 2],
];

const columnCount = (): number => {
  for (const [query, count] of COLUMN_QUERIES) {
    if (matchMedia(query).matches) return count;
  }
  return 1;
};

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
  reload: () => void;
  dispose: () => void;
}

function searchHead(result: SearchResult, exit: () => void): HTMLElement {
  const head = el("div", "fk-search-head");
  const label = el("span");
  const strong = el("strong");
  strong.textContent = `“${result.query}”`;
  label.append(
    document.createTextNode(
      `搜索 ${strong.textContent} · ${result.users.length} 个用户 · ${result.posts.length} 条帖子`,
    ),
  );
  const exitBtn = el("button", "fk-search-exit");
  exitBtn.type = "button";
  exitBtn.textContent = "返回推荐流";
  exitBtn.addEventListener("click", exit);
  head.append(label, exitBtn);
  return head;
}

function searchUsersSection(result: SearchResult): HTMLElement | null {
  if (result.users.length === 0) return null;
  const section = el("section", "fk-search-users");
  const title = el("h2", "fk-search-users-title");
  title.textContent = "用户";
  section.append(title);
  for (const user of result.users) {
    const row = el("div", "fk-search-user");
    const avatar = authorAvatar(
      user.handle,
      user.name,
      "fk-avatar",
      user.avatarUrl,
    );
    const copy = el("a", "fk-search-user-copy");
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
  const scroller = container.querySelector<HTMLElement>(".fk-main")!;
  const feed = container.querySelector<HTMLElement>(".fk-feed")!;
  const sentinel = container.querySelector<HTMLElement>(".fk-sentinel")!;
  const spinner = sentinel.querySelector<HTMLElement>(".fk-spinner")!;
  const tabs = [...container.querySelectorAll<HTMLButtonElement>(".fk-tab")];
  const composer = container.querySelector<HTMLElement>(".fk-composer")!;
  const composerInput =
    container.querySelector<HTMLTextAreaElement>(".fk-composer-input")!;
  const composerBtn =
    container.querySelector<HTMLButtonElement>(".fk-post-btn")!;
  const charCount = container.querySelector<HTMLElement>(".fk-char-count")!;
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
  const mediaStorageWrap = container.querySelector<HTMLElement>(
    "[data-role=media-storage-wrap]",
  )!;
  const mediaStorage = container.querySelector<HTMLSelectElement>(
    "[data-role=media-storage]",
  )!;
  const searchInput =
    container.querySelector<HTMLInputElement>(".fk-search-input")!;
  const composerAvatar = container.querySelector<HTMLElement>(
    ".fk-composer .fk-avatar",
  )!;
  let selectedMedia: PostMedia | null = null;
  let uploadingMedia = false;
  let editingPostId: string | null = null;
  let storageOptions: StorageOption[] | null = null;
  let storageOptionsPromise: Promise<void> | null = null;
  let storageOwner: string | null = null;
  let storageRequestId = 0;

  const loadStorageOptions = (owner: string): Promise<void> => {
    if (storageOptions) return Promise.resolve();
    if (storageOptionsPromise) return storageOptionsPromise;
    const requestId = ++storageRequestId;
    const request = getStorageOptions()
      .then((options) => {
        if (storageOwner !== owner) return;
        storageOptions = options;
        const current = mediaStorage.value;
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = options.length
          ? "默认（自动选择）"
          : "尚未配置对象存储";
        mediaStorage.replaceChildren(
          placeholder,
          ...options.map((config) => {
            const option = document.createElement("option");
            option.value = config.id;
            option.textContent = `${config.name} · ${config.bucket}${
              config.isDefault ? "（默认）" : ""
            }`;
            return option;
          }),
        );
        if (options.some((config) => config.id === current)) {
          mediaStorage.value = current;
        }
      })
      .catch((error: unknown) => {
        if (storageOwner !== owner) return;
        storageOptions = [];
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "存储桶加载失败，将使用默认配置";
        mediaStorage.replaceChildren(option);
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
    image.className = "fk-avatar-image";
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
    mediaStorage.disabled = !account;
    const owner = account?.profile.handle ?? null;
    if (owner !== storageOwner) {
      storageOwner = owner;
      storageRequestId += 1;
      storageOptions = null;
      storageOptionsPromise = null;
      mediaStorage.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "默认存储桶";
      mediaStorage.append(placeholder);
    }
    if (account) void loadStorageOptions(account.profile.handle);
    if (!account) {
      editingPostId = null;
      selectedMedia = null;
      mediaInput.value = "";
      mediaStatus.hidden = true;
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
  const orderedPosts: HTMLElement[] = [];
  const postsById = new Map<string, Post>();
  const prefetchedPosts = new Set<string>();

  const shortestColumn = (): HTMLElement => {
    let target = columns[0];
    for (const column of columns) {
      if (column.offsetHeight < target.offsetHeight) target = column;
    }
    return target;
  };

  const buildColumns = (count: number): HTMLElement => {
    const root = el("div", "fk-feed-columns");
    if (count > 1) root.classList.add("is-masonry");
    columns = Array.from({ length: count }, () => {
      const column = el("div", "fk-feed-col");
      root.append(column);
      return column;
    });
    activeColumnCount = count;
    return root;
  };

  const ensureLayout = (): void => {
    const count = columnCount();
    if (columnsRoot && count === activeColumnCount) return;
    const root = buildColumns(count);
    if (columnsRoot) columnsRoot.replaceWith(root);
    else feed.append(root);
    columnsRoot = root;
    for (const post of orderedPosts) shortestColumn().append(post);
  };

  const onMediaChange = () => ensureLayout();
  for (const [query] of COLUMN_QUERIES) {
    matchMedia(query).addEventListener("change", onMediaChange);
  }

  const resetFeed = (head?: HTMLElement): void => {
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
        .querySelector<HTMLElement>('.fk-action[data-action="save"]')
        ?.classList.add("is-saved");
    }
    orderedPosts.push(node);
    postsById.set(post.id, post);
    shortestColumn().append(node);
    return node;
  };

  const setSentinelBusy = (busy: boolean) => {
    sentinel.classList.toggle("is-done", state.done && !busy);
    spinner.style.visibility = busy ? "visible" : "hidden";
  };

  const sentinelReached = (): boolean => {
    const rect = sentinel.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    return rect.top - view.bottom < 360;
  };

  const renderError = (retry: () => void) => {
    feed.querySelectorAll(".fk-status").forEach((node) => node.remove());
    const row = el("div", "fk-status");
    row.append(
      document.createTextNode("加载失败。"),
      Object.assign(el("button", "fk-retry-btn"), {
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
      }
    }
  };

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void doSearch(searchInput.value);
  });

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
    { root: scroller, rootMargin: "360px" },
  );
  observer.observe(sentinel);

  const flashCount = (button: HTMLElement) => {
    const counter = button.querySelector<HTMLElement>(".fk-action-count");
    if (!counter) return;
    counter.classList.remove("is-flash");
    void counter.offsetWidth;
    counter.classList.add("is-flash");
  };

  const setCount = (button: HTMLElement, count: number) => {
    button.querySelector<HTMLElement>(".fk-action-count")!.textContent =
      count > 0 ? fmtCount(count) : "";
  };

  feed.addEventListener("pointerover", (event) => {
    const article = (event.target as HTMLElement).closest<HTMLElement>(
      ".fk-post",
    );
    const id = article?.dataset.postId;
    if (!id || prefetchedPosts.has(id)) return;
    const post = postsById.get(id);
    if (!post) return;
    prefetchedPosts.add(id);
    prefetch(postPath(post));
  });

  feed.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const avatarLink = target.closest<HTMLElement>(".fk-avatar-link");
    if (avatarLink?.dataset.handle) {
      event.preventDefault();
      void navigate(userPath(avatarLink.dataset.handle));
      return;
    }

    const inlineLink = target.closest<HTMLAnchorElement>(".fk-inline-link");
    if (inlineLink) {
      event.preventDefault();
      if (inlineLink.dataset.hashtag) {
        const query = `#${inlineLink.dataset.hashtag}`;
        searchInput.value = query;
        void doSearch(query);
        scroller.scrollTo({ top: 0 });
      } else if (inlineLink.dataset.mention) {
        void navigate(userPath(inlineLink.dataset.mention));
      }
      return;
    }

    const followButton = target.closest<HTMLButtonElement>(".fk-follow-btn");
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

    const button = target.closest<HTMLButtonElement>(".fk-action");
    if (!button) {
      const article = target.closest<HTMLElement>(".fk-post");
      const id = article?.dataset.postId;
      const post = id ? postsById.get(id) : undefined;
      if (post) void navigate(postPath(post));
      return;
    }

    const article = button.closest<HTMLElement>(".fk-post");
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
      editingPostId = post.id;
      composer.hidden = false;
      composerInput.value = post.text;
      composerInput.style.height = "auto";
      composerInput.style.height = `${composerInput.scrollHeight}px`;
      composerBtn.textContent = "保存";
      mediaStatus.textContent = "正在编辑这条帖子";
      mediaStatus.hidden = false;
      composerInput.focus();
      composerInput.scrollIntoView({ behavior: "smooth", block: "center" });
      syncComposer();
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
    editingPostId = null;
    composerInput.value = "";
    composerInput.style.height = "";
    selectedMedia = null;
    mediaStatus.textContent = "";
    mediaStatus.hidden = true;
    composerBtn.textContent = getAccount() ? "发帖" : "注册后发帖";
    syncComposer();
  };

  composerInput.addEventListener("input", syncComposer);
  composerInput.addEventListener("input", () => {
    composerInput.style.height = "auto";
    composerInput.style.height = `${composerInput.scrollHeight}px`;
  });
  composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editingPostId) {
      event.preventDefault();
      resetComposer();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!composerBtn.disabled) composerBtn.click();
    }
  });
  syncComposer();

  attachMediaBtn.addEventListener("click", () => {
    if (!getAccount()) {
      requestAuthentication();
      return;
    }
    mediaInput.click();
  });

  mediaInput.addEventListener("change", async () => {
    const file = mediaInput.files?.[0];
    if (!file) return;
    uploadingMedia = true;
    attachMediaBtn.disabled = true;
    mediaStatus.textContent = "上传中…";
    mediaStatus.hidden = false;
    syncComposer();
    try {
      selectedMedia = await uploadMedia(
        file,
        mediaStorage.value || undefined,
        (percent) => {
          mediaStatus.textContent = `上传中 ${percent}%`;
        },
      );
      mediaStatus.textContent = `已添加：${file.name}`;
    } catch (error) {
      selectedMedia = null;
      mediaStatus.textContent =
        error instanceof ApiError && error.code === "STORAGE_REQUIRED"
          ? "请先在设置中配置 S3 对象存储。"
          : error instanceof Error
            ? error.message
            : "图片上传失败";
      if (error instanceof ApiError && error.status === 401) {
        requestAuthentication();
      }
    } finally {
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
    const editing = editingPostId !== null;
    const label = composerBtn.textContent;
    composerBtn.disabled = true;
    composerBtn.textContent = editing ? "保存中…" : "发送中…";
    mediaStatus.textContent = "";
    mediaStatus.hidden = true;
    try {
      if (editingPostId) {
        await updatePost(editingPostId, text);
      } else {
        await createPost(text, selectedMedia?.id);
      }
      if (state.search !== null) {
        searchInput.value = "";
        state.search = null;
      }
      composer.hidden = false;
      state.cursor = null;
      state.done = false;
      resetComposer();
      scroller.scrollTo({ top: 0 });
      await loadPage(true);
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
    reload: () => {
      state.cursor = null;
      state.done = false;
      void loadPage(true);
    },
    dispose: () => {
      observer.disconnect();
      for (const [query] of COLUMN_QUERIES) {
        matchMedia(query).removeEventListener("change", onMediaChange);
      }
    },
  };
}
