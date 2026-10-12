import { playImageFocus } from "./image-focus";

export function focusLogoOnLoad(): void {
  const focus = async () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const logo = [
      ...document.querySelectorAll<HTMLImageElement>(
        ".topbar .brand .logo-img",
      ),
    ].find((image) => getComputedStyle(image).display !== "none");
    if (!logo) return;
    await logo.decode().catch(() => {});
    const play = () => playImageFocus(logo);
    const splash = document.querySelector("[data-role=splash]");
    if (!splash) {
      play();
      return;
    }
    const observer = new MutationObserver(() => {
      if (splash.isConnected) return;
      observer.disconnect();
      play();
    });
    observer.observe(document.body, { childList: true });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => void focus(), {
      once: true,
    });
  else void focus();
}
