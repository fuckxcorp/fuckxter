# FuckXter

FuckXter 是一个基于 Astro 和 Cloudflare Workers 的轻量社交平台。

## 功能

- 发帖、图片上传、编辑和删除
- 推荐流、关注流、搜索与话题标签
- 点赞、转发、收藏、分享和 `@提及`
- 评论、评论删除和帖子详情页
- 用户主页、关注关系和个人资料
- 邮箱登录、双重验证和恢复码
- 多套 S3 媒体存储配置

## 架构

```text
Astro static site
  └── src/lib/fuckxter      浏览器端 API 客户端和页面逻辑
Cloudflare Worker
  └── worker/index.ts       HTTP 路由
      ├── accounts.ts       账号与认证
      ├── posts.ts          帖子、时间线和互动
      ├── media.ts          图片与头像
      └── users.ts          用户资料与关注
Cloudflare D1
  └── worker/migrations     数据库结构迁移
Cloudflare R2
  └── MEDIA_CACHE           缓存头像和媒体
```

前端是静态站点，运行时通过 `PUBLIC_FUCKXTER_API_URL` 访问 Worker。
本地开发默认使用 `http://localhost:8787`，生产环境默认使用
`https://api.fuckxter.site`。

## 开发

要求 Node.js 24.21.0 或更新版本。

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm api:migrate:local
```

分别启动 API 和前端：

```bash
pnpm api:dev
pnpm dev
```

## 命令

| 命令                     | 作用                                |
| ------------------------ | ----------------------------------- |
| `pnpm dev`               | 启动 Astro 开发服务器               |
| `pnpm build`             | 构建生产前端到 `dist/`              |
| `pnpm check`             | 执行 Astro 类型检查与 Prettier 检查 |
| `pnpm api:dev`           | 本地启动 Cloudflare Worker API      |
| `pnpm api:migrate:local` | 应用本地 D1 数据库迁移              |
| `pnpm api:deploy`        | 部署 Worker API                     |

## 生产配置

`.dev.vars` 和 Cloudflare Secret 至少需要：

```dotenv
FUCKXTER_SECRET=replace-with-a-long-random-secret
```

Worker 的允许来源在 `wrangler.jsonc` 的 `FUCKXTER_ORIGINS` 中配置。
新增前端域名时，必须同时加入该列表。
