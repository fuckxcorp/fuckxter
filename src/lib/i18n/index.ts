import en from "./locales/en.json";
import ja from "./locales/ja.json";
import es from "./locales/es.json";
import traditional from "./locales/zh-Hant.json";
import cantonese from "./locales/yue-Hant.json";
import nom from "./locales/vi-Hani.json";
import xiang from "./locales/hsn.json";
import dalian from "./locales/zh-x-dalian.json";

export const languages = [
  { code: "zh-CN", name: "简中" },
  { code: "zh-Hant", name: "繁中" },
  { code: "ja", name: "日本語" },
  { code: "vi-Hani", name: "㗂越（𡨸喃）" },
  { code: "yue-Hant", name: "粵語" },
  { code: "hsn", name: "湘语（长益片）" },
  { code: "zh-x-dalian", name: "大连话" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
] as const;
export type Language = (typeof languages)[number]["code"];
const catalogs: Record<string, Record<string, string>> = {
  en,
  ja,
  es,
  "zh-Hant": traditional,
  "yue-Hant": cantonese,
  "vi-Hani": nom,
  hsn: xiang,
  "zh-x-dalian": dalian,
};
export function getLanguage(): Language {
  try {
    const value = localStorage.getItem("fk-language");
    if (languages.some((item) => item.code === value)) return value as Language;
  } catch {}
  return "zh-CN";
}
export function getLocale(): string {
  const language = getLanguage();
  return language === "vi-Hani"
    ? "vi-VN"
    : language === "hsn" || language === "zh-x-dalian"
      ? "zh-CN"
      : language;
}
const templates = Object.keys(en)
  .filter((key) => /\{\d+\}/.test(key))
  .map((key) => ({
    key,
    pattern: new RegExp(
      "^" +
        key
          .split(/(\{\d+\})/)
          .map((part) =>
            /^\{\d+\}$/.test(part)
              ? "(.+?)"
              : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("") +
        "$",
      "u",
    ),
  }))
  .sort(
    (a, b) =>
      b.key.replace(/\{\d+\}/g, "").length -
      a.key.replace(/\{\d+\}/g, "").length,
  );
const fragments = Object.keys(en)
  .filter((key) => !/\{\d+\}/.test(key))
  .sort((a, b) => b.length - a.length);
export function t(source: string): string {
  const language = getLanguage();
  const strings = catalogs[language];
  if (!strings || !/\p{Script=Han}/u.test(source)) return source;
  const text = source.replace(/\s+/g, " ").trim();
  const exact = (value: string) => {
    if (strings[value]) return strings[value];
    for (const { key, pattern } of templates) {
      const match = value.match(pattern);
      if (!match || !strings[key]) continue;
      return strings[key].replace(
        /\{(\d+)\}/g,
        (_, index) => match[Number(index) + 1],
      );
    }
    return "";
  };
  let result =
    text.startsWith("@") && text.includes(" · ")
      ? text
          .split(" · ")
          .map((part, index) => (index === 0 ? part : exact(part) || part))
          .join(" · ")
      : exact(text);
  if (!result) {
    result = text.replace(
      /\d+分钟前|\d+小时前|\d+天前|\d+(?:\.\d+)?万|\d+ 次浏览/g,
      (part) => exact(part) || part,
    );
    const handles: string[] = [];
    result = result.replace(/@[^\s·，:：)）…。?!？!]+/gu, (handle) => {
      handles.push(handle);
      return `\uE000${handles.length - 1}\uE001`;
    });
    for (const key of fragments) {
      if (strings[key] && result.includes(key))
        result = result.split(key).join(strings[key]);
    }
    result = result.replace(
      /\uE000(\d+)\uE001/g,
      (_, index) => handles[Number(index)],
    );
  }
  return (
    (source.match(/^\s*/)?.[0] ?? "") +
    result +
    (source.match(/\s*$/)?.[0] ?? "")
  );
}
export function confirmTranslated(message: string): boolean {
  return window.confirm(t(message));
}

const excluded = [
  "script",
  "style",
  "[data-no-translate]",
  "[contenteditable]",
  ".post-text",
  ".thread-text",
  ".chat-bubble",
  ".hot-text",
  ".post-name",
  ".menu-user-meta",
  ".thread-top strong",
  ".thread-top small",
  ".quick-start-name",
  ".search-user-copy strong",
  ".search-user-copy p",
  ".avatar-fallback",
  "[data-role=user-name]",
  "[data-role=user-bio]",
  "[data-role=chat-name]",
  "[data-role=chat-handle]",
  ".user-name",
  ".user-handle",
  ".connection-name",
  ".connection-bio",
  ".post-source-text",
  ".post-source-link strong",
  ".quote-preview strong",
  ".quote-preview p",
  ".post-source-name",
  ".thread-who strong",
  ".thread-handle",
  ".post-info-author-name",
  ".hot-meta",
  ".post-source-author",
  ".repost-author",
  ".user-list-identity",
  ".user-list-details p",
  ".post-info-author strong",
].join(",");
const texts = new WeakMap<Text, { source: string; rendered: string }>();
const attributes = new WeakMap<
  Element,
  Map<string, { source: string; rendered: string }>
>();
const wrappers = new WeakMap<Element, string>();
const glyphs = new Map<string, boolean>();
const nomChars = new Set(
  [
    ...(Object.values(nom).join("") +
      languages.find((item) => item.code === "vi-Hani")!.name),
  ].filter((char) => /\p{Script=Han}/u.test(char)),
);
const canvas =
  typeof document === "undefined" ? null : document.createElement("canvas");
if (canvas) {
  canvas.width = 64;
  canvas.height = 64;
}
const context = canvas?.getContext("2d", { willReadFrequently: true });
function hasGlyph(char: string, font: string): boolean {
  const key = font + char;
  const known = glyphs.get(key);
  if (known !== undefined) return known;
  if (!context) return true;
  context.font = "32px " + font;
  const pixels = (value: string) => {
    context.clearRect(0, 0, 64, 64);
    context.fillText(value, 4, 48);
    return context.getImageData(0, 0, 64, 64).data;
  };
  const actual = pixels(char);
  const missing = pixels("\u{10ffff}");
  const exists = actual.some((value, index) => value !== missing[index]);
  glyphs.set(key, exists);
  return exists;
}
function paint(wrapper: HTMLElement, source: string, native = false): void {
  const value = native ? source : t(source);
  const font = getComputedStyle(wrapper).fontFamily;
  const children: (Node | string)[] = [];
  for (const part of value.split(/(@[^\s·，:：)）…。?!？!]+)/gu)) {
    if (part.startsWith("@")) {
      children.push(part);
      continue;
    }
    for (const char of part) {
      if (
        (native || getLanguage() === "vi-Hani") &&
        nomChars.has(char) &&
        !hasGlyph(char, font)
      ) {
        const glyph = document.createElement("span");
        glyph.className = "nom-glyph";
        glyph.setAttribute("aria-label", char);
        glyph.style.setProperty(
          "--nom-image",
          `url(/nom-glyphs/${char.codePointAt(0)!.toString(16)}.svg)`,
        );
        const text = document.createElement("span");
        text.textContent = char;
        glyph.append(text);
        children.push(glyph);
      } else children.push(char);
    }
  }
  wrapper.replaceChildren(...children);
}
function translateText(node: Text): void {
  const parent = node.parentElement;
  if (
    !parent ||
    (parent.closest(excluded) && !parent.closest("[data-i18n-ui]")) ||
    parent.closest("[data-i18n-rendered]")
  )
    return;
  const previous = texts.get(node);
  const source =
    previous && node.data === previous.rendered ? previous.source : node.data;
  const rendered = t(source);
  if (getLanguage() === "vi-Hani" && /\p{Script=Han}/u.test(rendered)) {
    const font = getComputedStyle(parent).fontFamily;
    if (
      [...rendered].some((char) => nomChars.has(char) && !hasGlyph(char, font))
    ) {
      const wrapper = document.createElement("span");
      wrapper.dataset.i18nRendered = "";
      wrappers.set(wrapper, source);
      node.replaceWith(wrapper);
      paint(wrapper, source);
      return;
    }
  }
  texts.set(node, { source, rendered });
  if (node.data !== rendered) node.data = rendered;
}
function translateElement(node: Element): void {
  if (
    (node.closest(excluded) && !node.closest("[data-i18n-ui]")) ||
    node.closest("[data-i18n-rendered]")
  )
    return;
  const saved = attributes.get(node) ?? new Map();
  for (const name of ["placeholder", "title", "aria-label", "aria-valuetext"]) {
    const value = node.getAttribute(name);
    if (!value) continue;
    const previous = saved.get(name);
    const source =
      previous && value === previous.rendered ? previous.source : value;
    const rendered = t(source);
    saved.set(name, { source, rendered });
    if (value !== rendered) node.setAttribute(name, rendered);
  }
  if (node.matches('meta[name="description"]')) {
    const source = "FuckXter 是一个开放、轻量的社交平台。";
    const rendered = t(source);
    if (node.getAttribute("content") !== rendered)
      node.setAttribute("content", rendered);
  }
  attributes.set(node, saved);
}
function translateTree(root: Node): void {
  if (root instanceof Text) {
    translateText(root);
    return;
  }
  if (root instanceof HTMLElement && wrappers.has(root)) {
    paint(root, wrappers.get(root)!);
    return;
  }
  if (
    root instanceof Element &&
    root.closest(excluded) &&
    !root.closest("[data-i18n-ui]")
  )
    return;
  if (root instanceof Element) translateElement(root);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return node instanceof Element &&
          node.matches(excluded + ",[data-i18n-rendered]") &&
          !node.hasAttribute("data-i18n-ui")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const nodes: Node[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node);
  for (const node of nodes) {
    if (node instanceof Text) translateText(node);
    else if (node instanceof Element) translateElement(node);
  }
  if (root instanceof Element)
    for (const wrapper of root.querySelectorAll<HTMLElement>(
      "[data-i18n-rendered]",
    )) {
      const source = wrappers.get(wrapper);
      if (source !== undefined) paint(wrapper, source);
    }
}
function syncLanguage(): void {
  const language = getLanguage();
  document.documentElement.lang = language;
  for (const item of document.querySelectorAll<HTMLElement>(
    "[data-language-choice]",
  )) {
    item.setAttribute(
      "aria-checked",
      String(item.dataset.languageChoice === language),
    );
  }
}
export function setLanguage(language: Language): void {
  if (!languages.some((item) => item.code === language)) return;
  try {
    localStorage.setItem("fk-language", language);
  } catch {}
  syncLanguage();
  translateTree(document.head);
  translateTree(document.body);
  for (const label of document.querySelectorAll<HTMLElement>(
    "[data-nom-label]",
  )) {
    paint(label, label.dataset.nomLabel!, true);
  }
  document.dispatchEvent(new Event("fuckxter:language-change"));
  if (language === "vi-Hani")
    void document.fonts
      .load('16px "FuckXter Nôm"')
      .then(() => {
        glyphs.clear();
        if (getLanguage() === "vi-Hani") translateTree(document.body);
        for (const label of document.querySelectorAll<HTMLElement>(
          "[data-nom-label]",
        )) {
          paint(label, label.dataset.nomLabel!, true);
        }
      })
      .catch(() => {});
}
let mounted = false;
export function installI18n(): void {
  if (mounted) return;
  mounted = true;
  setLanguage(getLanguage());
  const pending = new Set<Node>();
  let frame = 0;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList")
        for (const node of mutation.addedNodes) pending.add(node);
      else pending.add(mutation.target);
    }
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const node of pending) if (node.isConnected) translateTree(node);
        pending.clear();
      });
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label", "aria-valuetext"],
  });
  document.addEventListener("astro:page-load", () =>
    setLanguage(getLanguage()),
  );
  window.addEventListener("storage", (event) => {
    if (event.key === "fk-language") setLanguage(getLanguage());
  });
}
