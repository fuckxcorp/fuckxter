export function onPageReady(callback: () => void): void {
  // 首次加载时脚本会先直接跑一次，客户端路由随后又会派发 astro:page-load。
  // 不去重的话同一个回调会绑两遍事件：设置页那个菜单按钮就会点一下开又关，
  // 看起来像「点了没反应」。
  let started = false;
  const run = () => {
    if (started) return;
    started = true;
    callback();
  };

  document.addEventListener("astro:page-load", run);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
