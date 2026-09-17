import { defineMiddleware } from "astro:middleware";

const POST_PATH = /^\/post\/([^/]+)\/[^/]+\/?$/i;
const USER_PATH = /^\/user\/([^/]+)\/?$/i;
const MESSAGE_PATH = /^\/messages\/([^/]+)\/?$/i;
const CONNECTIONS_PATH = /^\/user\/([^/]+)\/(followers|following)\/?$/i;

export const onRequest = defineMiddleware((context, next) => {
  const { pathname } = context.url;

  if (POST_PATH.test(pathname)) return next("/post/");

  if (MESSAGE_PATH.test(pathname)) return next("/messages/");

  if (CONNECTIONS_PATH.test(pathname)) return next("/connections/");

  if (USER_PATH.test(pathname)) return next("/user/");

  return next();
});
