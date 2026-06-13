---
title: chirpy
date: 2026-06-13 11:10:16 +0800
---

- [my issue](https://github.com/cotes2020/jekyll-theme-chirpy/issues?q=is%3Aissue+author%3A%40me+)
- [my PR](https://github.com/cotes2020/jekyll-theme-chirpy/pulls?q=is%3Apr+author%3A%40me+)

1. Table of Contents, ordered
{:toc}

## [#2754](https://github.com/cotes2020/jekyll-theme-chirpy/pull/2754)

用 chirpy 写博客时发现 Mermaid 图的节点 label 右侧会被裁掉几个像素。最初以为是 CSS 问题，陆续加了 `overflow: visible`、`word-break`、`white-space` 等规则"治标"，但症状总是换个方式回来。

排查后发现根本原因是**字体加载时序**：`loadMermaid()` 在 webfont 还没到货时就调用了 `mermaid.initialize()`（默认 `startOnLoad: true`），Mermaid 用 fallback 字体测出了偏小的宽度并固定了节点框；等 webfont 替换上来，更宽的字形就被 `foreignObject` 默认的 `overflow: hidden` 截掉了。

修复只改了一个文件（`_javascript/modules/components/mermaid.js`）：给 `mermaidConf` 加上 `startOnLoad: false`，再用 `Promise.race([document.fonts.ready, 2.5s timeout])` 推迟 `mermaid.run()` 到字体就绪之后。2.5 秒的兜底保证字体 CDN 挂起时图表也不会永远等待。

> 这个 repo 有 `pr-filter.js` bot：PR body 必须使用官方模板格式，含 `## Type of change` 并勾选 `[x]`，否则自动关闭。建议先开 Issue、再提 PR，并在 `## Additional context` 里写 `Fixes #issue`。
{: .prompt-tip }
