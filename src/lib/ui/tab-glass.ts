export function mountGlassTabs(nav: HTMLElement): void {
  if (nav.dataset.glass) return;
  const buttons = [...nav.querySelectorAll<HTMLButtonElement>(".tab")];
  if (!buttons.length) return;
  const surface = document.createElement("span");
  surface.className = "tab-glass-surface";
  surface.setAttribute("aria-hidden", "true");
  surface.innerHTML =
    '<span class="tab-glass-face"><span class="tab-glass-lens"></span><span class="tab-glass-edge"></span></span>';
  nav.prepend(surface);
  nav.dataset.glass = "true";
  const root = document.documentElement;
  let bounds = nav.getBoundingClientRect();
  let metrics: { button: HTMLButtonElement; left: number; width: number }[] =
    [];
  let pointer: number | null = null;
  let dragX = 0;
  let startX = 0;
  let dragged = false;
  let frame = 0;
  let suppressUntil = 0;
  let first = true;
  const active = () =>
    buttons.find((button) => button.classList.contains("is-active")) ??
    buttons[0];
  const place = (left: number, width: number) => {
    surface.style.width = `${width}px`;
    surface.style.transform = `translate3d(${left}px, 8px, 0) skewX(-14deg)`;
  };
  const select = (button: HTMLButtonElement) => {
    const item = metrics.find((item) => item.button === button);
    if (item) place(item.left, item.width);
  };
  const resize = () => {
    bounds = nav.getBoundingClientRect();
    metrics = buttons.map((button) => ({
      button,
      left: button.offsetLeft + 5.6,
      width: Math.max(20, button.offsetWidth - 11.2),
    }));
    surface.style.height = `${Math.max(16, bounds.height - 14.4)}px`;
    if (first) {
      surface.style.transition = "none";
      select(active());
      surface.getBoundingClientRect();
      surface.style.removeProperty("transition");
      first = false;
    } else if (pointer === null) select(active());
  };
  const nearest = (x: number) =>
    metrics.reduce((best, item) =>
      Math.abs(item.left + item.width / 2 - x) <
      Math.abs(best.left + best.width / 2 - x)
        ? item
        : best,
    );
  const drag = () => {
    frame = 0;
    if (pointer === null) return;
    const item = nearest(dragX);
    place(
      Math.max(
        metrics[0].left,
        Math.min(dragX - item.width / 2, metrics.at(-1)!.left),
      ),
      item.width,
    );
    buttons.forEach((button) =>
      button.toggleAttribute("data-glass-target", button === item.button),
    );
  };
  const down = (event: PointerEvent) => {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      !(event.target as Element).closest(".tab")
    )
      return;
    bounds = nav.getBoundingClientRect();
    pointer = event.pointerId;
    dragX = event.clientX - bounds.left;
    startX = event.clientX;
    dragged = false;
    nav.setPointerCapture(pointer);
    nav.dataset.glassPressed = "true";
    const item = nearest(dragX);
    buttons.forEach((button) =>
      button.toggleAttribute("data-glass-target", button === item.button),
    );
    select(item.button);
  };
  const move = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    dragX = event.clientX - bounds.left;
    if (!dragged) {
      if (Math.abs(event.clientX - startX) < 5) return;
      dragged = true;
      nav.dataset.glassDragging = "true";
    }
    if (!frame) frame = requestAnimationFrame(drag);
  };
  const release = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    pointer = null;
    cancelAnimationFrame(frame);
    frame = 0;
    delete nav.dataset.glassDragging;
    delete nav.dataset.glassPressed;
    buttons.forEach((button) => button.removeAttribute("data-glass-target"));
    if (nav.hasPointerCapture(event.pointerId))
      nav.releasePointerCapture(event.pointerId);
    if (event.type === "pointerup") {
      suppressUntil = performance.now() + 400;
      const item = nearest(event.clientX - bounds.left);
      item.button.click();
      select(item.button);
    } else select(active());
  };
  const click = (event: MouseEvent) => {
    if (
      event.isTrusted &&
      event.detail > 0 &&
      performance.now() < suppressUntil
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const button = (event.target as Element).closest<HTMLButtonElement>(".tab");
    if (!button) return;
    event.preventDefault();
    const index = buttons.indexOf(button);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) %
            buttons.length;
    buttons[next].focus({ preventScroll: true });
    buttons[next].click();
  };
  const sync = () => {
    buttons.forEach((button) =>
      button.setAttribute("aria-pressed", String(button === active())),
    );
    if (pointer === null) select(active());
  };
  const pause = () => {
    if (!document.hidden && !root.classList.contains("menu-open")) return;
    cancelAnimationFrame(frame);
    frame = 0;
    if (pointer !== null) {
      const id = pointer;
      pointer = null;
      if (nav.hasPointerCapture(id)) nav.releasePointerCapture(id);
    }
    delete nav.dataset.glassDragging;
    delete nav.dataset.glassPressed;
    buttons.forEach((button) => button.removeAttribute("data-glass-target"));
    select(active());
  };
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(nav);
  buttons.forEach((button) => sizeObserver.observe(button));
  const tabObserver = new MutationObserver(sync);
  buttons.forEach((button) =>
    tabObserver.observe(button, {
      attributes: true,
      attributeFilter: ["class"],
    }),
  );
  const menuObserver = new MutationObserver(pause);
  menuObserver.observe(root, { attributes: true, attributeFilter: ["class"] });
  nav.addEventListener("pointerdown", down);
  nav.addEventListener("pointermove", move);
  nav.addEventListener("pointerup", release);
  nav.addEventListener("pointercancel", release);
  nav.addEventListener("lostpointercapture", release);
  nav.addEventListener("click", click, true);
  nav.addEventListener("keydown", keydown);
  document.addEventListener("visibilitychange", pause);
  resize();
  sync();
  document.addEventListener(
    "astro:before-swap",
    () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      tabObserver.disconnect();
      menuObserver.disconnect();
      nav.removeEventListener("pointerdown", down);
      nav.removeEventListener("pointermove", move);
      nav.removeEventListener("pointerup", release);
      nav.removeEventListener("pointercancel", release);
      nav.removeEventListener("lostpointercapture", release);
      nav.removeEventListener("click", click, true);
      nav.removeEventListener("keydown", keydown);
      document.removeEventListener("visibilitychange", pause);
      surface.remove();
      delete nav.dataset.glass;
    },
    { once: true },
  );
}
