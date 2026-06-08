---
title: "Chirpy 主题升级指南：从版本比对到本地覆盖维护"
date: 2026-06-08 15:18:14 +0800
categories: [jekyll]
tags: [jekyll, chirpy, upgrade, maintenance]
description: "Jekyll Chirpy 主题从 v6 升级到 v7 的完整记录：breaking changes、本地覆盖文件的正确维护方式、升级后踩的两个大坑（生产环境 CSS 丢失、PWA 缓存不刷新）及解决方案。"
---

这篇文章记录 jekyll-theme-chirpy 主题从 v6.2.3 升级到 v7.5.0 的完整过程，包含升级方法论、具体操作、以及**升级后实际踩的两个大坑**。既是操作日志，也是未来升级的可复用参考。

## Gem-based 主题：升级成本其实很低

Chirpy 是一个 **gem-based 主题**。所有布局、样式、JS、默认 includes 都打包在 gem 里，博客仓库本身不持有主题代码。升级时，只需要：

1. 改一行 `Gemfile` 版本约束
2. 跑 `bundle update jekyll-theme-chirpy`

**你不需要手动合并上游几千行主题代码**，这和 fork 主题仓库再手动 cherry-pick 的模式完全不同。

升级成本来自两处：

- **`_config.yml` breaking changes**：大版本才有，看 Release Notes 逐项改配置 key，通常几分钟搞定。
- **本地覆盖文件**：这才是真正的成本。凡是你在本地 `_layouts/`、`_includes/`、`assets/` 里放了和 gem 同名的文件，升级时就要手动对比上游新版、合并你的定制。**有多少覆盖文件，就有多少升级债务**。

核心策略：**尽量少覆盖，覆盖了就记录为什么覆盖**。

## 升级前：三件事必须先做

### 1. 锁定当前版本，找到目标版本

```bash
# 查看当前安装版本
bundle list | grep chirpy

# 列出所有 release
gh release list --repo cotes2020/jekyll-theme-chirpy --limit 20

# 查看目标版本的 Release Notes（重点看 Breaking Changes）
gh release view v7.5.0 --repo cotes2020/jekyll-theme-chirpy
```

### 2. 盘点本地覆盖文件

gem-based 主题的机制：**本地文件同路径优先于 gem 内文件**。每个覆盖文件都是升级时必须手动合并的债务。

```bash
# 找出所有本地覆盖
find _layouts _includes _plugins assets/js assets/css -type f 2>/dev/null | sort

# 与上游对应路径比对
gh api "repos/cotes2020/jekyll-theme-chirpy/git/trees/v7.5.0?recursive=1" \
  --jq '.tree[].path' | grep -E '^_layouts|^_includes|^assets'
```

升级前必须搞清楚：每个本地覆盖文件，**改了什么、为什么改**。没有文档记录的覆盖最危险。

### 3. 查看 `_config.yml` breaking changes

```bash
# 获取上游新版 _config.yml 作参考
gh api "repos/cotes2020/jekyll-theme-chirpy/contents/_config.yml?ref=v7.5.0" \
  --jq '.content' | base64 -d > /tmp/chirpy-config-v7.yml

diff _config.yml /tmp/chirpy-config-v7.yml
```

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
brew install ruby@3.4
export PATH="/opt/homebrew/opt/ruby@3.4/bin:$PATH"
ruby --version   # 应显示 3.4.x
```

### Step 3：更新依赖

```bash
bundle update jekyll-theme-chirpy
```

### Step 4：迁移 `_config.yml`

本次从 v6.2.3 升到 v7.5.0，以下配置 key 发生了重命名：

| v6 key | v7 key | 说明 |
|--------|--------|------|
| `img_cdn:` | `cdn:` | CDN 前缀 |
| `google_site_verification:` | `webmaster_verifications:\n  google:` | 站点验证 |
| `google_analytics:\n  id:` | `analytics:\n  google:\n    id:` | Google Analytics |
| `comments:\n  active:` | `comments:\n  provider:` | 评论系统 provider |

v7 新增了 `pageviews:` 配置块（目前仅支持 goatcounter）。

### Step 5：处理本地覆盖文件

见下面"维护本地覆盖文件"一节。

### Step 6：生产构建验证

```bash
JEKYLL_ENV=production bundle exec jekyll build
bundle exec htmlproofer _site --disable-external --no-enforce-https
```

## 维护本地覆盖文件

这是升级中最耗时、最容易出错的部分。

### 原则：能不覆盖就不覆盖

**每个覆盖文件 = 未来每次升级要手动合并一次**。能用 gem 提供的扩展点（hook、placeholder）实现的，绝不覆盖原文件。

gem 提供了两个安全的扩展点：
- `_includes/metadata-hook.html`：空 placeholder，可以在 `<head>` 末尾注入自定义内容
- `assets/css/jekyll-theme-chirpy.scss` 底部的 `/* append your custom style below */` 注释

但第二个扩展点有陷阱（见下面的"血泪教训"）。

### 本仓库的覆盖文件清单

| 文件 | 覆盖原因 | 升级风险 |
|------|---------|---------|
| `_layouts/home.html` | 合并所有集合（Tech/AI/Open/Tutorial/Book/Life），显示彩色徽章 | **高**：每次升级必须与上游 diff 合并 |
| `_layouts/custom-collection.html` | 通用集合列表（支持按 date 或 order 排序） | **高**：同上 |
| `_includes/js-selector.html` | 注入 `custom-toc.js` | **中**：整体替换上游版本 + 加一行 |
| `_includes/metadata-hook.html` | 加载 `custom.css` | **无**：gem 提供空 placeholder |
| `assets/css/custom.scss` | post-badge、TOC 层级样式 | **无**：纯追加样式，不覆盖 gem 入口 |
| `assets/js/custom-toc.js` | h1 加入 TOC | **低**：独立脚本，只需注意 API 变化 |

升级风险为"无"的文件，意味着 gem 怎么升级都不影响它们。**这是我们追求的目标状态**。

### 各文件的升级处理方式

#### `_includes/js-selector.html`：跟踪上游内容

这个文件在 v6 → v7 间变化巨大（去掉了 jQuery、Bootstrap JS，换用 glightbox，MathJax 路径变了）。

升级策略：**拉取上游新版，整体替换，再加一行 custom-toc.js 注入**。

```bash
# 拉取上游版本
gh api "repos/cotes2020/jekyll-theme-chirpy/contents/_includes/js-selector.html?ref=v7.5.0" \
  --jq '.content' | base64 -d > _includes/js-selector.html

# 然后在最后一个 <script> 标签后面加一行：
# <script defer src="{% raw %}{{ '/assets/js/custom-toc.js' | relative_url }}{% endraw %}"></script>
```

每次升级都重复这个操作，比手动 merge diff 更安全。

#### `assets/js/custom-toc.js`：v7 的 tocbot 调用方式变了

**v6 写法**（直接 `destroy` + `init`）：

```javascript
tocbot.destroy();
tocbot.init({ headingSelector: 'h1, h2, h3', ... });
```

**v7 写法**（必须用 `refresh` + `setTimeout`）：

```javascript
setTimeout(function () {
  tocbot.refresh({ headingSelector: 'h1, h2, h3', ... });
}, 0);
```

原因：v7 把 tocbot 打包进了 Rollup bundle，内部会自动调用 `tocbot.init()`。外部 `defer` 脚本的执行顺序不保证晚于 bundle，所以用 `setTimeout(fn, 0)` 把回调推到下一个事件循环，确保 override 总是在 bundle 的 init 之后生效。

#### `_layouts/home.html`：注意 include 名称变更

v7 把 `no-linenos.html` + 内联 excerpt 逻辑统一进了 `post-summary.html`。

如果你的 layout 里有：

{% raw %}
```liquid
{% include no-linenos.html content=post.content %}
{{ content | markdownify | strip_html | truncate: 200 | escape }}
```
{% endraw %}

在 v7 中这个 include 不存在了，构建直接报错。替换为：

{% raw %}
```liquid
{% include post-summary.html %}
```
{% endraw %}

## 升级后踩的两个大坑

本地 `jekyll serve` 一切正常，push 到 GitHub Pages 后才发现问题。以下两个坑都是**只在生产环境出现**的，本地开发完全看不出来。

### 坑一：生产环境页面严重错位（Bootstrap CSS 丢失）

#### 症状

部署后页面结构全乱——侧边栏导航有 bullet points、布局不成列、按钮样式消失。强刷也没用。本地 `jekyll serve` 完全正常。

#### 根因

Chirpy v7.5 的 CSS 架构做了根本性变化。gem 的 SCSS 入口文件 `assets/css/jekyll-theme-chirpy.scss` 使用 Liquid 条件逻辑：

```scss
/* prettier-ignore */
{% raw %}@use 'main
{%- if jekyll.environment == 'production' -%}
  .bundle
{%- endif -%}
';{% endraw %}
```

- **开发环境**：编译 `main.scss`（不含 Bootstrap），Bootstrap 通过 CDN `<link>` 单独加载
- **生产环境**：编译 `main.bundle.scss`（内含 Bootstrap），CSS 一体打包，不走 CDN

同时 `_includes/head.html` 里：

```liquid
{% raw %}{% unless jekyll.environment == 'production' %}
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css">
{% endunless %}{% endraw %}
```

生产环境**不加载 Bootstrap CDN**——因为它假定 Bootstrap 已经被打包进了 CSS 文件。

我之前为了加自定义样式（`.post-badge` 等），覆盖了这个 SCSS 入口文件，写了简单的 `@import 'main'`。升级后这个覆盖文件：
- 覆盖了 gem 原版的 Liquid 条件逻辑
- 生产环境仍然编译 `main`（不含 Bootstrap）
- 而 CDN 也不会加载（被 `unless production` 阻止了）

结果：**生产环境的 Bootstrap 完全丢失**，只有 440 条 CSS 规则（正常应有几千条）。

#### 解决方案

**不要覆盖 gem 的 SCSS 入口文件**。自定义样式通过独立文件加载：

1. 创建 `assets/css/custom.scss`，放自定义样式
2. 创建 `_includes/metadata-hook.html`，在 `<head>` 末尾加载自定义 CSS：

```html
<link rel="stylesheet" href="{% raw %}{{ '/assets/css/custom.css' | relative_url }}{% endraw %}">
```

`metadata-hook.html` 是 gem 提供的空 placeholder，不存在同步问题。gem 入口文件由 gem 自己管理，升级零成本。

#### 教训

覆盖 gem 文件时，不仅要看"我需要加什么"，还要看"原文件里有什么不能丢的逻辑"。**SCSS 入口文件里嵌入了 Liquid 条件分支**——这种"在样式文件里藏环境判断"的设计很容易被忽略。

### 坑二：部署后浏览器不刷新（PWA 缓存）

#### 症状

push 新内容后，浏览器始终显示旧页面。不强制刷新（Ctrl+Shift+R）就看不到更新。以前会弹出"有新版本可用"的提示条，现在也不弹了。

#### 根因

Chirpy v7 默认启用 PWA（Service Worker）：

```yaml
pwa:
  enabled: true
```

Service Worker 会把所有页面缓存到浏览器本地。理论上 deploy 新内容后 SW 会检测到更新并提示刷新，但从 v6 升级到 v7 后这个机制没有正常工作。

#### 解决方案

对个人博客来说，离线缓存带来的好处远不如"每次都能看到最新内容"重要。关掉 PWA：

```yaml
pwa:
  enabled: false
```

关掉后不再注册 Service Worker，浏览器走正常的 HTTP 缓存（GitHub Pages CDN 默认约 10 分钟），刷新页面就能拿到最新内容。

> 已缓存的老用户第一次仍需强刷清掉旧 SW 注册，之后就一切正常。
{: .prompt-info }

## 升级后验证清单

本地验证：

- [ ] `JEKYLL_ENV=production bundle exec jekyll build` 无报错
- [ ] `htmlproofer _site --disable-external` 无 broken links
- [ ] 本地 `jekyll serve` 启动，首页正常渲染
- [ ] 文章页 TOC 正常显示（包括 h1）
- [ ] 评论区加载正常（utterances）
- [ ] 代码块渲染正常（含行号）
- [ ] Mermaid 图渲染正常
- [ ] MathJax 渲染正常

**部署后还要验证**（本地看不出的问题）：

- [ ] 远端页面布局正常（Bootstrap 生效，无错位）
- [ ] 刷新能看到最新内容（PWA 不阻塞更新）
- [ ] DevTools Network 面板确认 CSS 文件体积合理（应包含 Bootstrap）

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

# 本地覆盖文件 vs 上游 diff
gh api "repos/cotes2020/jekyll-theme-chirpy/contents/_includes/js-selector.html?ref=v7.5.0" \
  --jq '.content' | base64 -d > /tmp/upstream.html
diff _includes/js-selector.html /tmp/upstream.html
```
