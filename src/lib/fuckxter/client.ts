import { mountAccountControls } from "./account";
import { hydrateSession } from "./auth";
import { mountFeed } from "./feed";

function mountFuckxter(container: HTMLElement): void {
  if (container.dataset.fkMounted) return;
  container.dataset.fkMounted = "true";

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

export function mountFuckxterBySelector(selector: string): void {
  const container = document.querySelector<HTMLElement>(selector);
  if (container) mountFuckxter(container);
}
