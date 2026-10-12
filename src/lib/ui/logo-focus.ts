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
    const play = () => {
      if (!logo.isConnected) return;
      const filter = getComputedStyle(logo).filter;
      const base = filter === "none" ? "" : `${filter} `;
      logo.animate(
        [
          { filter: `${base}blur(12px)` },
          { filter: `${base}blur(12px)`, offset: 0.15 },
          { filter: `${base}blur(5px)`, offset: 0.55 },
          { filter: `${base}blur(0px)`, offset: 0.9 },
          { filter: `${base}blur(0px)` },
        ],
        { duration: 320, easing: "cubic-bezier(0.45, 0, 0.2, 1)" },
      );
    };
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
