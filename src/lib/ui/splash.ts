const MIN_MS = 720;
const EXIT_MS = 560;
const SAFETY_MS = 4000;

function currentSplash(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-role=splash]");
}

/**
 * 收起開屏遮罩。
 * 狀態記在元素自己身上（data-state），不要用模組層旗標：
 * 從別頁用前端路由回到首頁時模組不會重新執行，旗標會是舊的 true，
 * 新的遮罩就永遠沒人收。
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
 * 每次頁面載入（含前端路由回到首頁）都替當下的遮罩掛一個保險，
 * 就算資料一直沒回來、或收尾邏輯沒被呼叫，遮罩也會自己消失。
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
