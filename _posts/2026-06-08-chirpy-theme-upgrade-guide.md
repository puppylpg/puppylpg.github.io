---
title: "Chirpy 主题升级指南：从版本比对到本地覆盖维护"
date: 2026-06-08 15:18:14 +0800
categories: [tutorial, blog]
tags: [jekyll, chirpy, upgrade, maintenance]
description: "如何升级 jekyll-theme-chirpy gem 主题版本：检查 breaking changes、盘点本地覆盖文件、处理 JS 架构变动，供人类或 AI 在未来升级时参考。"
---

这篇文章记录 jekyll-theme-chirpy 主题的升级思路和操作流程，既是本次从 v6 → v7 的操作日志，也是未来升级的可复用参考手册。

## Gem 主题升级：成本其实很低

Chirpy 是一个 **gem-based 主题**，这是 Jekyll 官方推荐的主题发布方式。所有布局、样式、JS、默认 includes 都打包在 gem 里，博客仓库本身不持有主题代码。升级时，只需要：

1. 改一行 `Gemfile` 版本约束
2. 跑 `bundle update jekyll-theme-chirpy`

gem 会自动拉取新版。**你不需要手动合并上游几千行的主题代码**，这和 fork 了主题仓库再手动 cherry-pick 的模式完全不同。

升级成本来自两处，但都是可控的：

- **`_config.yml` breaking changes**：大版本才有，看 Release Notes 逐项改配置 key，通常几分钟搞定。
- **本地覆盖文件**：这才是真正的成本。凡是你在本地 `_layouts/`、`_includes/`、`assets/js/` 里放了和 gem 同名的文件，升级时就要手动对比上游新版、合并你的定制。**有多少覆盖文件，就有多少升级债务**。

所以升级策略的核心是：**尽量少覆盖，覆盖了就记录为什么覆盖**。

## 升级前：三件事必须先做

### 1. 锁定 gem 当前版本，找到目标版本

```bash
# 查看当前安装版本
bundle list | grep chirpy

# 列出所有 release（含日期）
gh release list --repo cotes2020/jekyll-theme-chirpy --limit 20
```

目标版本确定后，先去看**该版本的 Release Notes** 和 **CHANGELOG**：

```bash
gh release view v7.5.0 --repo cotes2020/jekyll-theme-chirpy
```

或直接访问 GitHub Releases 页面，重点看"Breaking Changes"部分。

### 2. 盘点本地覆盖文件（核心维护成本）

gem-based 主题的机制：本地文件同路径优先于 gem 内文件。每个覆盖文件都是**升级时必须手动合并的债务**。

```bash
# 找出所有本地 layout、include、plugin 覆盖
find _layouts _includes _plugins assets/js -type f | sort

# 与上游 v7 对应路径比对
gh api "repos/cotes2020/jekyll-theme-chirpy/git/trees/v7.5.0?recursive=1" \
  --jq '.tree[].path' | grep -E '^_layouts|^_includes'
```

升级前必须搞清楚：每个本地覆盖文件，**改了什么、为什么改**。没有文档记录的覆盖最危险。

### 3. 查看 `_config.yml` breaking changes

`_config.yml` 的 key 名每个大版本可能重命名。最可靠的方式是把上游新版 sample config 拉下来对比：

```bash
# 获取上游最新 _config.yml 作参考
gh api "repos/cotes2020/jekyll-theme-chirpy/contents/_config.yml?ref=v7.5.0" \
  --jq '.content' | base64 -d > /tmp/chirpy-config-v7.yml

diff _config.yml /tmp/chirpy-config-v7.yml
```

## v6 → v7 的具体 Breaking Changes

本次从 v6.2.3 升到 v7.5.0，以下配置 key 发生了重命名：

| v6 key | v7 key | 说明 |
|--------|--------|------|
| `img_cdn:` | `cdn:` | CDN 前缀 |
| `google_site_verification:` | `webmaster_verifications:\n  google:` | 站点验证 |
| `google_analytics:\n  id:` | `analytics:\n  google:\n    id:` | Google Analytics |
| `comments:\n  active:` | `comments:\n  provider:` | 评论系统 provider |

此外 v7 新增了 `pageviews:` 配置块（目前仅支持 goatcounter）。

## 升级操作步骤

### Step 1：更新 Gemfile

```ruby
# 从
gem "jekyll-theme-chirpy", "~> 6.2.3", "< 6.3"
# 改为
gem "jekyll-theme-chirpy", "~> 7.5"
```

### Step 2：Ruby 版本兼容

v7 要求 `Ruby ~> 3.1`（即 `>= 3.1, < 4.0`）。若系统默认 Ruby >= 4，需要切换到 3.x：

```bash
# Homebrew 安装 ruby@3.4
brew install ruby@3.4

# 临时切换（或写入 .zshrc/.bashrc）
export PATH="/opt/homebrew/opt/ruby@3.4/bin:$PATH"

# 验证
ruby --version   # 应显示 3.4.x
```

### Step 3：更新依赖

```bash
bundle update jekyll-theme-chirpy
```

### Step 4：迁移 `_config.yml`

按上面的表格逐项修改。

### Step 5：处理本地覆盖文件

见下一节"维护本地覆盖文件"。

### Step 6：生产构建验证

```bash
JEKYLL_ENV=production bundle exec jekyll build
```

构建无报错后，再跑 htmlproofer：

```bash
bundle exec htmlproofer _site --disable-external --no-enforce-https
```

## 维护本地覆盖文件

这是升级中最耗时、最容易出错的部分。

### 原则：最小化覆盖

**每个覆盖文件 = 未来每次升级要手动合并一次**。能删掉或缩小覆盖范围，就应该优先这样做。

### 本仓库的覆盖文件清单

| 文件 | 覆盖原因 | 升级处理方式 |
|------|---------|------------|
| `_layouts/home.html` | 合并 `site.posts` 和 `site.ai`，显示 Tech/AI 徽章 | 必须保留；每次升级与上游 diff，手动合并 |
| `_layouts/open-layout.html` | `_open` 集合自定义列表页 | 必须保留；注意 include 名称变更（v7 用 `post-summary.html`）|
| `_layouts/custom-collection.html` | 通用集合列表 | 同上 |
| `_includes/js-selector.html` | 注入 `custom-toc.js` | v7 起完整替换为 v7 内容 + 注入行 |
| `assets/js/custom-toc.js` | h1 加入 TOC | v7 需改用 `tocbot.refresh()`（见下）|

### `_includes/js-selector.html`：跟踪上游内容

这个文件在 v6 → v7 间变化巨大（去掉了 jQuery、Bootstrap，换用 glightbox，MathJax 路径变了）。

升级策略：**拉取上游新版，整体替换，再加上一行 custom-toc.js 注入**。

```bash
# 拉取上游版本
gh api "repos/cotes2020/jekyll-theme-chirpy/contents/_includes/js-selector.html?ref=v7.5.0" \
  --jq '.content' | base64 -d > _includes/js-selector.html

# 然后在 `<script defer src="{{ script | relative_url }}"></script>` 后面加一行：
# <script defer src="{{ '/assets/js/custom-toc.js' | relative_url }}"></script>
```

每次升级都重复这个操作，比手动 merge diff 更安全。

### `assets/js/custom-toc.js`：v7 的 tocbot 调用方式变了

**v6 写法**（直接 `destroy` + `init`）：

```javascript
tocbot.destroy();
tocbot.init({ headingSelector: 'h1, h2, h3', ... });
```

**v7 写法**（必须用 `refresh` + `setTimeout`）：

```javascript
// v7 通过 Rollup 把 tocbot 打包进模块；tocbot.init() 在模块内部调用。
// 外部脚本用 tocbot.refresh() + setTimeout(fn, 0) 确保在内部 init 之后运行。
setTimeout(function () {
  tocbot.refresh({ headingSelector: 'h1, h2, h3', ... });
}, 0);
```

原因：v7 把 `TocDesktop` / `TocMobile` 迁进了 Rollup bundle（`_javascript/modules/components/toc/`），bundle 加载后会自动调用 `tocbot.init()`。外部 `defer` 脚本的执行顺序不保证晚于 bundle，所以用 `setTimeout(fn, 0)` 把回调推到下一个事件循环，确保 override 总是在 bundle 的 init 之后生效。

### `_layouts/home.html`：注意 include 名称变更

v7 把 `no-linenos.html` + 内联 excerpt 逻辑统一进了 `post-summary.html`。

如果你的 `home.html` 或其他 layout 里有：

{% raw %}
```liquid
{% include no-linenos.html content=post.content %}
{{ content | markdownify | strip_html | truncate: 200 | escape }}
```
{% endraw %}

在 v7 中，这个 include 不存在了，构建直接报错。替换为：

{% raw %}
```liquid
{% include post-summary.html %}
```
{% endraw %}

`post-summary.html` 会自动使用 `post.description`（如果存在），否则截取 `post.content`，行为与 v6 一致。

## 升级后验证清单

- [ ] `bundle exec jekyll build` 无报错
- [ ] `htmlproofer _site --disable-external` 无 broken links
- [ ] 本地 `jekyll serve` 启动，首页正常渲染
- [ ] 文章页 TOC 正常显示（包括 h1）
- [ ] 评论区加载正常（utterances）
- [ ] 代码块渲染正常（含行号）
- [ ] Mermaid 图渲染正常（找一篇有 mermaid 的文章验证）
- [ ] MathJax 渲染正常（找一篇有数学公式的文章验证）

## 快速比对命令速查

```bash
# 查看目标版本 release notes
gh release view <version> --repo cotes2020/jekyll-theme-chirpy

# 列出上游某版本的所有文件
gh api "repos/cotes2020/jekyll-theme-chirpy/git/trees/<version>?recursive=1" \
  --jq '.tree[].path'

# 获取上游某文件内容
gh api "repos/cotes2020/jekyll-theme-chirpy/contents/<path>?ref=<version>" \
  --jq '.content' | base64 -d

# 本地覆盖文件 vs 上游 diff（示例）
gh api "repos/cotes2020/jekyll-theme-chirpy/contents/_includes/js-selector.html?ref=v7.5.0" \
  --jq '.content' | base64 -d > /tmp/upstream-js-selector.html
diff _includes/js-selector.html /tmp/upstream-js-selector.html
```
