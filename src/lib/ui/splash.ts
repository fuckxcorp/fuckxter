const MIN_MS = 180;
const EXIT_MS = 220;
const SAFETY_MS = 1500;

/**
 * 首页里那段内联脚本靠 sessionStorage 判断「这个会话已经播过开屏」，
 * 但内联脚本在客户端路由里只按内容去重，回到首页时不会再执行，
 * 于是遮罩又盖了上来，只能等收尾逻辑或 4 秒保险把它掀掉——看起来就像「卡在加载」。
 * 所以这里自己记一笔：只要发生过前端路由跳转，之后每次页面载入都直接掀掉遮罩。
 */
let routedNavigation = false;

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
  document.addEventListener("astro:before-swap", () => {
    routedNavigation = true;
  });
  document.addEventListener("astro:page-load", () => {
    const splash = currentSplash();
    // 前端路由回到首页：开屏动画这个会话已经放过，直接掀掉，别再闪一下。
    if (routedNavigation && splash) {
      splash.remove();
      return;
    }
    armSplashSafety();
  });
}
