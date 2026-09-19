const MIN_MS = 720;
const EXIT_MS = 560;
const SAFETY_MS = 4000;

function currentSplash(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-role=splash]");
}

/**
 * 收起开屏遮罩。
 * 状态记在元素自己身上（data-state），不要用模块层旗标：
 * 从别的页面用前端路由回到首页时模块不会重新执行，旗标会是旧的 true，
 * 新的遮罩就永远没人收。
 */
export function dismissHomeSplash(): void {
  const splash = currentSplash();
  if (!splash) return;
  const state = splash.dataset.state;
  if (state === "dismissing" || state === "done") return;
  splash.dataset.state = "dismissing";

  const shownAt = Number(splash.dataset.shownAt ?? NaN);
  const elapsed = Number.isFinite(shownAt)
    ? performance.now() - shownAt
    : MIN_MS;

  const play = () => {
    if (!splash.isConnected) return;
    splash.dataset.state = "done";
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      splash.remove();
      return;
    }
    splash.classList.add("is-exit");
    window.setTimeout(() => splash.remove(), EXIT_MS);
  };

  const wait = Math.max(0, MIN_MS - elapsed);
  if (wait === 0) play();
  else window.setTimeout(play, wait);
}

/**
 * 每次页面加载（含前端路由回到首页）都替当下的遮罩挂一个保险，
 * 就算数据一直没回来、或收尾逻辑没被调用，遮罩也会自己消失。
 */
function armSplashSafety(): void {
  const splash = currentSplash();
  if (!splash || splash.dataset.armed === "true") return;
  splash.dataset.armed = "true";
  window.setTimeout(() => {
    if (currentSplash() === splash) dismissHomeSplash();
  }, SAFETY_MS);
}

if (typeof window !== "undefined") {
  armSplashSafety();
  document.addEventListener("astro:page-load", armSplashSafety);
}
