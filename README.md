# FuckXter

[在线页面](https://fuckxter.site)

FuckXter 是一个基于 Astro 和 Cloudflare 全家桶 的轻量社交平台。

## 🚀 特性

- 类似X的体验
- 发帖、图片上传、编辑和删除
- 推荐流、关注流、搜索与话题标签
- 推荐流按点赞数排序，同赞数按发布时间排序；也可切换最新或关注流。
- 点赞、转发、收藏、分享和提及
- 评论、评论删除和“发起 / 回帖”帖子线程
- 用户主页、关注关系和个人资料
- 主页头图上传
- 邮箱登录、双重验证和恢复码
- 可自定义媒体存储+使用FuckXter内置的存储

## ⏰ 起源

在2026年9月8日凌晨12:08分许 我的X(https://x.com/com0loquieras)被处于只读模式

随后我尝试申诉 但并无任何用途 而且尝试导出数据 我只收到一个冰冷的 “出错了。”

于是 我就想能否自行开发一个类似的社交平台 然后 这就是成品

那么FuckXter messages呢 没错 就在今天我的Telegram也被列为限制账户了

死因是我给别人发了小广告或者某些夸大事实的事情 我自查发现根本没有 我已提交申诉 他要不解 那我用FuckXter Messages

## 🔧 对于开发者

### 部署配置

- `FUCKXTER_SECRET`（可选）：加密 TOTP 密钥和恢复码用的主密钥，用
  `wrangler secret put FUCKXTER_SECRET` 配置。不配置时 Worker 会在第一次用到加密时
  自动生成一把随机密钥存进 D1 的 `app_secrets` 表，双重验证开箱可用。
  设置过之后不要随便换值，否则已经保存的 TOTP 密钥会解不开。
- `PUBLIC_FUCKXTER_API_URL`（可选）：前端请求 API 的地址。默认和页面同源
  （Worker 本身同时提供页面和 API），同源请求不会被广告拦截器、隐私工具或者
  只允许主域的 DNS 过滤器拦掉。只有把 API 单独部署到别的域名时才需要设置。

## ⚖️ 条款与授权

FuckXter的代码基于[MoPL](https://867678.xyz/docs/mopl)开源

FuckXter平台内的内容基于[FuckXter规则](https://fuckxter.site/rules)处理和授权
