const rowSpring = Array.from({ length: 33 }, (_, index) => {
  const time = (index / 32) * 0.52;
  return index === 32
    ? 1
    : 1 -
        Math.exp(-14 * time) *
          (Math.cos(17.44 * time) + (14 / 17.44) * Math.sin(17.44 * time));
});

export function mountAccountMotion(menu: HTMLElement, trigger: HTMLElement) {
  const root = document.documentElement;
  const container = menu.closest<HTMLElement>(".app")!;
  const aura = document.createElement("div");
  aura.className = "account-aura";
  aura.setAttribute("aria-hidden", "true");
  aura.innerHTML =
    '<span class="account-aura-veil"></span><span class="account-aura-sweep"></span><span class="account-aura-frame"><span class="account-aura-light" data-edge="top"></span><span class="account-aura-light" data-edge="right"></span><span class="account-aura-light" data-edge="bottom"></span><span class="account-aura-light" data-edge="left"></span></span>';
  container.append(aura);
  const sweep = aura.querySelector<HTMLElement>(".account-aura-sweep")!;
  const animations = new Map<HTMLElement, Animation>();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const content = [...container.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child !== aura &&
      !child.matches(".topbar"),
  );
  const inert = new Map(content.map((element) => [element, element.inert]));
  let open = false;
  let exitTimer = 0;

  const animate = (
    element: HTMLElement,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
    hold = false,
  ) => {
    animations.get(element)?.cancel();
    const animation = element.animate(frames, options);
    animations.set(element, animation);
    void animation.finished
      .then(() => {
        if (hold || animations.get(element) !== animation) return;
        animations.delete(element);
        animation.cancel();
      })
      .catch(() => {});
  };

  const animateRows = (rows: HTMLElement[], value: boolean, sub = false) => {
    const states = rows.map((row) => {
      if (animations.get(row)?.playState !== "running") return null;
      const style = getComputedStyle(row);
      return { opacity: style.opacity, transform: style.transform };
    });
    rows.forEach((row, index) => {
      const current = states[index];
      const start = current
        ? {
            opacity: current.opacity,
            transform: current.transform,
          }
        : value
          ? {
              opacity: 0,
              transform: sub
                ? "translate(10px, 16px) scale(0.96)"
                : "translate(12px, 28px) scale(0.92)",
            }
          : { opacity: 1, transform: "none" };
      const end = value
        ? { opacity: 1, transform: "none" }
        : {
            opacity: 0,
            transform: "translate(14px, -20px) scale(0.92)",
          };
      if (reduced.matches) {
        animations.get(row)?.cancel();
        animations.delete(row);
        return;
      }
      const matrix = new DOMMatrixReadOnly(
        start.transform === "none" ? undefined : start.transform,
      );
      const opacity = Number(start.opacity);
      const frames = value
        ? rowSpring.map((progress, index) => {
            const rest = 1 - progress;
            return {
              offset: index / 32,
              opacity: opacity + (1 - opacity) * Math.min(1, progress * 1.5),
              transform: `translate(${matrix.e * rest}px, ${matrix.f * rest}px) scale(${1 + (matrix.a - 1) * rest})`,
            };
          })
        : [start, end];
      animate(
        row,
        frames,
        {
          duration: value ? 520 : 220,
          delay:
            value && !current ? (sub ? 12 + index * 16 : 20 + index * 22) : 0,
          easing: value ? "linear" : "cubic-bezier(0.4, 0, 1, 1)",
          fill: "both",
        },
        !value,
      );
    });
  };

  const setOpen = (value: boolean) => {
    if (open === value) return;
    open = value;
    clearTimeout(exitTimer);
    if (!value)
      exitTimer = window.setTimeout(() => {
        if (open) return;
        animations.forEach((animation, element) => {
          if (animation.playState !== "finished") return;
          animation.cancel();
          animations.delete(element);
        });
      }, 400);
    menu.inert = !value;
    root.classList.toggle("menu-open", value);
    aura.classList.toggle("is-open", value);
    content.forEach((element) => {
      element.inert = value || inert.get(element)!;
    });
    const anchor = trigger.getBoundingClientRect();
    aura.style.setProperty(
      "--aura-origin-y",
      `${anchor.top + anchor.height / 2}px`,
    );
    const rows = [
      ...menu.querySelectorAll<HTMLElement>(
        ":scope > .menu-item, :scope > .menu-row > .menu-item, :scope > [data-role] > .menu-item, :scope > [data-role] > .menu-user, :scope > [data-role] > .menu-title",
      ),
    ].filter((element) => !element.closest("[hidden]"));
    animateRows(rows, value);
    if (!reduced.matches) {
      if (value) {
        animate(
          sweep,
          [
            {
              opacity: 0,
              transform: "translate(30vw, -15vh) scale(0.2)",
              offset: 0,
            },
            {
              opacity: 0.72,
              transform: "translate(10vw, -5vh) scale(0.65)",
              offset: 0.12,
            },
            {
              opacity: 0.34,
              transform: "translate(-25vw, 10vh) scale(1.15)",
              offset: 0.4,
            },
            {
              opacity: 0.06,
              transform: "translate(-60vw, 24vh) scale(1.5)",
              offset: 0.66,
            },
            {
              opacity: 0,
              transform: "translate(-88vw, 30vh) scale(1.7)",
              offset: 0.84,
            },
            { opacity: 0, transform: "translate(-115vw, 35vh) scale(1.8)" },
          ],
          { duration: 500, easing: "cubic-bezier(0.22, 0.82, 0.78, 0.18)" },
        );
      } else {
        const current = getComputedStyle(sweep).opacity;
        animate(sweep, [{ opacity: current }, { opacity: 0 }], {
          duration: 180,
        });
      }
    }
  };

  const setSubmenuOpen = (panel: HTMLElement, value: boolean) => {
    panel.inert = !value;
    animateRows(
      [...panel.querySelectorAll<HTMLElement>(":scope > .menu-item")],
      value,
      true,
    );
    if (reduced.matches) return;
    const current =
      animations.get(panel)?.playState === "running"
        ? getComputedStyle(panel)
        : null;
    const start = current
      ? { opacity: current.opacity, transform: current.transform }
      : value
        ? { opacity: 0, transform: "translate(10px, 0) scale(0.96)" }
        : { opacity: 1, transform: "none" };
    animate(
      panel,
      [
        start,
        value
          ? { opacity: 1, transform: "none" }
          : { opacity: 0, transform: "translate(8px, 0) scale(0.97)" },
      ],
      {
        duration: value ? 360 : 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
      !value,
    );
  };

  const visibility = () => {
    aura.classList.toggle("is-suspended", document.hidden);
    animations.forEach((animation) => {
      if (document.hidden && animation.playState === "running")
        animation.pause();
      else if (!document.hidden && animation.playState === "paused")
        animation.play();
    });
  };
  document.addEventListener("visibilitychange", visibility);

  return {
    setOpen,
    setSubmenuOpen,
    dispose: () => {
      clearTimeout(exitTimer);
      document.removeEventListener("visibilitychange", visibility);
      root.classList.remove("menu-open");
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      inert.forEach((value, element) => {
        element.inert = value;
      });
      aura.remove();
    },
  };
}
