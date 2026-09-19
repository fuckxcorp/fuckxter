export function onPageReady(callback: () => void): void {
  document.addEventListener("astro:page-load", callback);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
}
