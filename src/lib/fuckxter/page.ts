// astro:page-load 在脚本加载慢时可能先于本模块触发而被错过，
// 所以首次进入页面额外用 DOMContentLoaded 兜底；
// 回调内部各自带 mount 标记，重复调用是安全的。
export function onFuckxterPageReady(callback: () => void): void {
  document.addEventListener("astro:page-load", callback);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
}
