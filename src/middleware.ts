import { defineMiddleware } from "astro:middleware";

const POST_PATH = /^\/post\/([^/]+)\/[^/]+\/?$/i;
const USER_PATH = /^\/user\/([^/]+)\/?$/i;

export const onRequest = defineMiddleware((context, next) => {
  const { pathname } = context.url;

  if (POST_PATH.test(pathname)) return next("/post/");

  if (USER_PATH.test(pathname)) return next("/user/");

  return next();
});
