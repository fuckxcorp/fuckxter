const animations = new WeakMap<HTMLImageElement, Animation>();

export function playImageFocus(image: HTMLImageElement): void {
  if (
    !image.isConnected ||
    !image.naturalWidth ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  animations.get(image)?.cancel();
  const filter = getComputedStyle(image).filter;
  const base = filter === "none" ? "" : `${filter} `;
  const animation = image.animate(
    [
      { filter: `${base}blur(12px)` },
      { filter: `${base}blur(12px)`, offset: 0.15 },
      { filter: `${base}blur(5px)`, offset: 0.55 },
      { filter: `${base}blur(0px)`, offset: 0.9 },
      { filter: `${base}blur(0px)` },
    ],
    { duration: 320, easing: "cubic-bezier(0.45, 0, 0.2, 1)" },
  );
  animations.set(image, animation);
}

export function installImageFocus(): void {
  const selector = ".media-image, [data-media-viewer] img";
  const focused = new WeakMap<HTMLImageElement, string>();
  const waiting = new Set<HTMLImageElement>();
  let splashObserver: MutationObserver | null = null;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const image = entry.target as HTMLImageElement;
      if (!entry.isIntersecting && image.isConnected) continue;
      observer.unobserve(image);
      waiting.delete(image);
      if (!image.isConnected) continue;
      const source = image.currentSrc || image.src;
      if (!source || focused.get(image) === source) continue;
      void image
        .decode()
        .then(() => {
          if (!image.isConnected || (image.currentSrc || image.src) !== source)
            return;
          focused.set(image, source);
          playImageFocus(image);
        })
        .catch(() => {});
    }
  });
  const watch = (image: HTMLImageElement) => {
    for (const old of waiting) {
      if (old.isConnected) continue;
      observer.unobserve(old);
      waiting.delete(old);
    }
    if (
      image.matches(selector) &&
      image.naturalWidth &&
      !document.querySelector("[data-role=splash]") &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      waiting.add(image);
      observer.observe(image);
    }
  };
  const scan = () => {
    const splash = document.querySelector("[data-role=splash]");
    if (splash) {
      if (splashObserver) return;
      splashObserver = new MutationObserver(() => {
        if (splash.isConnected) return;
        splashObserver?.disconnect();
        splashObserver = null;
        scan();
      });
      splashObserver.observe(document.body, { childList: true });
      return;
    }
    document.querySelectorAll<HTMLImageElement>(selector).forEach(watch);
  };
  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLImageElement) watch(event.target);
    },
    true,
  );
  document.addEventListener("astro:before-swap", () => {
    observer.disconnect();
    waiting.clear();
    splashObserver?.disconnect();
    splashObserver = null;
  });
  document.addEventListener("astro:page-load", scan);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  else scan();
}
