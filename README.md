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

### 本地开发

如果希望在本地开发FuckXter 您可能会需要加载帖子部分以查看UI

执行下列命令（windows除外）即可

```bash
cat <<'EOF'> ./.env.development
API_URL=http://127.0.0.1:8787
EOF
```

## ⚖️ 条款与授权

FuckXter的代码基于[MoPL](https://867678.xyz/docs/mopl)开源

FuckXter平台内的内容将完全自由 除非Cloudflare封禁我的账号
