# FuckXter

FuckXter 是一个基于 Astro 和 Cloudflare 全家桶 的轻量社交平台。

## 功能

- 类似X的体验
- 发帖（最多 1000 字）、图片上传、编辑和删除
- 推荐流、关注流、搜索与话题标签
- 点赞、转发、收藏、分享和 `@提及`
- 评论、评论删除和“发起 / 回帖”帖子线程页
- 用户主页、关注关系和个人资料
- 主页头图上传
- 邮箱登录、双重验证和恢复码
- 多套 S3 媒体存储配置

## 架构

前端是静态站点，运行时通过 `PUBLIC_FUCKXTER_API_URL` 访问 Worker。
本地开发默认使用 `http://localhost:4321`，生产环境默认使用`https://api.fuckxter.site`。

## 媒体存储

R2 bucket 名称为 `fuckxter`。头像统一使用可预测的对象键：

```text
avatars/<username>.avif
```

主页头图统一存储为：

```text
headers/<username>.avif
```

上传头像、主页头图和帖子图片时会通过 Cloudflare Images binding 转换为 AVIF（quality `82`）。头像最大 512×512，主页头图最大 1000×300，帖子图片最大 2048×2048，均保持宽高比且不会上采样。

帖子附件默认通过预签名 URL 由浏览器直传用户自己的 S3 存储，不设置应用层文件大小上限。存储桶需要允许站点域名执行 `PUT`，并允许 `Content-Type` 请求头。例如 Cloudflare R2 的 CORS 可以配置为：

```json
[
  {
    "AllowedOrigins": ["https://fuckxter.site", "https://www.fuckxter.site"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

如果直传因存储桶 CORS 配置失败，30 MB 以内的文件会自动回退到 Worker 中转；超过该大小的文件需要先修正存储桶 CORS。

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

## 自动部署

GitHub Actions 在推送到 `main` 后执行检查、构建并部署 Worker 和 Pages。
工作流位于 `.github/workflows/build.yml`，使用仓库 Secret：

```text
CLOUDFLARE_API_TOKEN
```

## 条款与授权

FuckXter的代码基于[MoPL](https://867678.xyz/docs/mopl)开源

FuckXter平台内的内容基于[FuckXter规则](https://fuckxter.site/rules)处理和授权
