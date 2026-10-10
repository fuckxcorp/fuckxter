import { getLanguage, setLanguage, type Language } from "../i18n";

export function mountPersonalizationSettings(root: HTMLElement): void {
  const layout = root.querySelector<HTMLSelectElement>(
    "[data-role=layout-setting]",
  )!;
  const theme = root.querySelector<HTMLSelectElement>(
    "[data-role=theme-setting]",
  )!;
  const language = root.querySelector<HTMLSelectElement>(
    "[data-role=language-setting]",
  )!;
  const columns = localStorage.getItem("fk_columns") ?? "auto";
  layout.value = ["auto", "1", "2", "3"].includes(columns) ? columns : "auto";
  theme.value = localStorage.getItem("theme") ?? "auto";
  language.value = getLanguage();
  layout.addEventListener("change", () =>
    localStorage.setItem("fk_columns", layout.value),
  );
  theme.addEventListener("change", () => {
    const mode = theme.value;
    localStorage.setItem("theme", mode);
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme =
      mode === "dark" ||
      (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";
  });
  language.addEventListener("change", () =>
    setLanguage(language.value as Language),
  );
}
