# 界面语言

`locales/*.json` 以简体中文界面文案为键。`{0}`、`{1}` 等是动态参数，翻译时保留这些标记；按钮与辅助标签共用词典。帖子、回帖、私信、引用正文和用户姓名均排除在界面翻译之外。

## 长益片湘语与大连话

`locales/hsn.json` 使用长益片湘语的汉字口语，以长沙及邻近地区常用表达为基础；`locales/zh-x-dalian.json` 使用大连话的汉字口语。长益片内部、大连市区及周边地区的说法都有差异，词典采用便于界面阅读的写法，保留「密码」「存储」「验证码」等技术名词。两套词典都覆盖全部界面词条，日期格式使用简中地区设置。

可以直接修改对应 JSON 的译文，保留 `{0}` 等参数，刷新预览即可看到修改。菜单使用「简中」「繁中」的短名称，English 与 Español 排在最后。

用词核对参考：[长沙话词汇](https://zh.wikipedia.org/wiki/%E9%95%BF%E6%B2%99%E8%AF%9D)、[大连话词汇](https://zh.wikipedia.org/wiki/%E5%A4%A7%E8%BF%9E%E8%AF%9D)。译文按界面含义改写，不使用谐音字模拟口音。

## 喃字

`vi-Hani.json` 使用汉喃字。字形读音参考 [Chunom Project](https://chunom.org/pages/ime/) 与 [Unicode Unihan](https://www.unicode.org/reports/tr38/)，句子按越南语翻译后逐词核对。汉喃异体字较多，语言词典可继续人工校订。

本站仅加载包含界面所需字形的 `public/fonts/nom-ui.woff2`。字形源为 [NomNaTong 5.18](https://github.com/nomfoundation/font/releases/tag/v5.18)，MIT 许可证保存在 `public/fonts/NomNaTong-LICENSE.txt`。

缺字时使用 `public/nom-glyphs/<Unicode 十六进制码点>.svg`。这些本地字形图片来自同一字体的轮廓，按当前文字颜色显示；用户内容不会进入缺字检测或任何外部翻译服务。添加新喃字时需同步添加字体子集与字形图片。
