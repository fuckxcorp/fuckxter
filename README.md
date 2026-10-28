# FuckXter

[在线页面](https://fuckxter.site)

FuckXter 是一个基于 Astro 和 Cloudflare 全家桶 的轻量社交平台。

## 🚀 特性

- 类似X的体验，但开放源代码
- 发帖、图片上传、编辑和删除
- 没有算法创造信息茧房的推荐流
- 邮箱登录、双重验证和恢复码
- 可自定义媒体存储+使用FuckXter内置的存储

## ⏰ 起源

在2026年9月8日凌晨12:08分许 我的X(https://x.com/com0loquieras)被处于只读模式

随后我尝试申诉 但并无任何用途 而且尝试导出数据 我只收到一个冰冷的 “出错了。”

于是 我就想能否自行开发一个类似的社交平台 所以 这就是成品

## 🔧 对于开发者

### 初始化本地环境

```bash
git clone git@github.com:fuckxcorp/fuckxter.git
pnpm install
#确保您装有最新稳定版pnpm
```

当然 `pnpm dev` 会不成功，因为该项目的设计是，提交到workers中，通过cloudflare workers的内网访问数据库。

所以需要将其提交到主仓库，编译之后放入workers才能看到效果，或者在本地通过wrangler连接D1数据库。

但是您不是`MoAEIOU`的话，没有权限查看FuckXter Worker的D1，所以需要为主仓库提交PR。

### 原生客户端图片

`/media/:id`、`/avatars/:handle`、`/headers/:handle` 支持 `format=webp&width=128|640|1280|2048`，默认尺寸为 1280。输出限制在对应尺寸的方形边界内并保持原图比例及动画。原生客户端使用此接口避免平台 AVIF 解码差异。

私有媒体在读取派生缓存前校验权限，HTTP 响应禁止共享缓存。派生对象按源文件内容与尺寸缓存，转换失败返回 502，不返回原始 AVIF。原图接口继续用于网站与原图读取。发布顺序为 Worker 在先、App 在后。

## ⚖️ 条款与授权

FuckXter的代码基于[MoPL](https://867678.xyz/docs/mopl)开源
