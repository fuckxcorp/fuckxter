import { festivals } from "../ui/festivals";

export function mountPersonalizationSettings(root: HTMLElement): void {
  const layout = root.querySelector<HTMLSelectElement>(
    "[data-role=layout-setting]",
  )!;
  const theme = root.querySelector<HTMLSelectElement>(
    "[data-role=theme-setting]",
  )!;
  const columns = localStorage.getItem("fk_columns") ?? "auto";
  layout.value = ["auto", "1", "2", "3"].includes(columns) ? columns : "auto";
  theme.value = localStorage.getItem("theme") ?? "auto";
  layout.addEventListener("change", () =>
    localStorage.setItem("fk_columns", layout.value),
  );
  const choices = root.querySelectorAll<HTMLInputElement>(
    "[data-festival-choice]",
  );
  const current = root.querySelector<HTMLElement>(
    "[data-role=festival-current]",
  )!;
  const syncFestival = () => {
    const { festivalMode = "auto", festival = "none" } =
      document.documentElement.dataset;
    for (const choice of choices)
      choice.checked = choice.value === festivalMode;
    current.textContent =
      festivals.find((item) => item.code === festival)?.name ?? "普通配色";
  };
  syncFestival();
  theme.addEventListener("change", () => {
    try {
      localStorage.setItem("theme", theme.value);
    } catch {}
    document.dispatchEvent(
      new CustomEvent("fuckxter:theme-update", {
        detail: { theme: theme.value },
      }),
    );
  });
  for (const choice of choices)
    choice.addEventListener("change", () => {
      if (!choice.checked) return;
      try {
        localStorage.setItem("fk-festival", choice.value);
      } catch {}
      document.dispatchEvent(
        new CustomEvent("fuckxter:theme-update", {
          detail: { festival: choice.value },
        }),
      );
    });
  const controller = new AbortController();
  document.addEventListener("fuckxter:festival-change", syncFestival, {
    signal: controller.signal,
  });
  document.addEventListener("astro:before-swap", () => controller.abort(), {
    once: true,
  });
}
