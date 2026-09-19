import { mountAccountControls } from "./account";
import { hydrateSession } from "./auth";
import { mountFeed } from "../feed/feed";

function mountApp(container: HTMLElement): void {
  if (container.dataset.mounted) return;
  container.dataset.mounted = "true";

  const feed = mountFeed(container);
  const account = mountAccountControls(container, {
    onAccountChange: feed.syncUser,
  });
  void hydrateSession().then(() => {
    feed.syncUser();
    account.sync();
  });

  document.addEventListener(
    "astro:before-swap",
    () => {
      feed.dispose();
      account.dispose();
    },
    { once: true },
  );
}

export function mount(selector: string): void {
  const container = document.querySelector<HTMLElement>(selector);
  if (container) mountApp(container);
}
