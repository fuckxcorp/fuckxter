/**
 * 页面脚本的挂载入口。
 *
 * 不能用一个「整辈子只跑一次」的旗标：客户端路由是按脚本地址去重的，同一个页面
 * 模块在一个 document 里只会执行一次。于是 /messages → /messages/xxx、
 * /user/a → /user/b、/settings/profile → /settings/security 这种「同一个页面模块
 * 换到另一个地址」的导航里模块不会再执行，旗标却还是 true，新换上的 DOM 就永远
 * 没人挂载，页面卡在「正在加载…」。
 *
 * 也不能每次 astro:page-load 都无条件跑：首次加载时模块自己会先跑一次，
 * 紧接着 astro:page-load 又派发一次，重复执行会让同一个按钮绑上两遍事件
 * （设置页那个菜单按钮点一下开又关，看起来像「点了没反应」）。
 *
 * 也不能把「这一份 DOM 处理过了」记成全局状态：所有页面模块共用这个文件，
 * 各自都会注册一份回调，换页时这些回调会同时收到 astro:page-load。先跑的那个
 * 回调如果占掉了全局标记，后面真正该挂载的那个页面就被顺手跳过了，表现成
 * 「有时候回到首页/打开私信就一直转圈」。
 *
 * 所以去重按「回调自己 + 当前这一份 DOM」来记：客户端路由每次换页都会把
 * <body> 换成新元素，body 一变就说明是新渲染的页面，这个回调要重新挂载一次；
 * 同一份 DOM 上的多次事件只跑一次。各页面自己再带 DOM 级挂载标记兜底。
 */
export function onPageReady(callback: () => void): void {
  let handledBody: Element | null = null;
  const run = () => {
    const body = document.body ?? document.documentElement;
    if (handledBody === body) return;
    handledBody = body;
    callback();
  };

  document.addEventListener("astro:page-load", run);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
