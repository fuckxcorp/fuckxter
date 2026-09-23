import { mountFeed } from "../feed/feed";

function mountApp(container: HTMLElement): void {
  if (container.dataset.mounted) return;
  container.dataset.mounted = "true";

  const feed = mountFeed(container);
  const syncUser = () => feed.syncUser();
  document.addEventListener("fuckxter:account-change", syncUser);
  feed.syncUser();

  document.addEventListener(
    "astro:before-swap",
    () => {
      feed.dispose();
      document.removeEventListener("fuckxter:account-change", syncUser);
    },
    { once: true },
  );
}

export function mount(selector: string): void {
  const container = document.querySelector<HTMLElement>(selector);
  if (container) mountApp(container);
}
