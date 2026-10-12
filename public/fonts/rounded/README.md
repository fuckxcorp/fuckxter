# 默认圆体字体

- 中文：Resource Han Rounded CN 0.990，来自 [作者发布页](https://github.com/CyanoHao/Resource-Han-Rounded/releases/tag/v0.990)，保留 Regular 400 与 Bold 700。
- 拉丁文字：Nunito 可变字体，来自 [Google Fonts 官方仓库](https://github.com/google/fonts/tree/main/ofl/nunito)，保留 200–1000 字重及拉丁字母、重音字符。
- 两套字体均遵循 SIL OFL 1.1；许可证随字体保存在本目录。中文子集更名为 FuckXter Rounded Han，版权信息保留在字体内部。

中文完整字体转为 WOFF2 并按字符拆分。界面常用字为 `*-ui.woff2`；其他字符按 Unicode 区间分块，通过 `src/styles/fonts.css` 中的 `unicode-range` 按需加载。字体文件总计约 11.3 MiB；两个界面常用字文件合计约 443 KiB，Nunito 约 92 KiB。页面会根据内容额外加载所需的字符块，字体均从本站加载。

字体未加载或未覆盖的字符使用系统无衬线字体；喃字保留已有字体与 SVG 兜底。`font-display: swap` 允许页面先显示文字，日常开发和构建无需安装字体处理工具。
