# CLAUDE.md

给 Claude Code 在本仓库工作时看的说明。

## 仓库背景

这是基于 Chirpy gem 主题（`jekyll-theme-chirpy ~6.2`）的个人 Jekyll 博客。大部分布局、样式、JS 都在主题 gem 里；本仓库主要放站点配置、文章内容、少量自定义 layout/plugin 和本地开发脚本。

Ruby 环境、本地开发完整流程以 `README.md` 为准。这里只记录仓库特有规则和容易踩坑的点。

## 中文标点规则

- 中文正文中的引号**必须用中文弯引号**，且**左引号 `"`（U+201C）和右引号 `"`（U+201D）必须配对**，不能两个都用右引号 `""`。
- 这是反复犯的错误：写中文引号时经常把左引号也写成右引号，变成了 `""为什么"` 而不是正确的 `“为什么”`。生成后必须检查左引号是否为 U+201C。

## 构建与质量卡点

仓库没有独立测试套件。CI 的卡点是 `bundle exec jekyll build` 和 `htmlproofer`：

```bash
# 生产构建，对齐 CI
JEKYLL_ENV=production bundle exec jekyll build

# 本地链接检查（CI 还会额外忽略 tutorials 和本地 URL，详见 pages-deploy.yml）
bundle exec htmlproofer _site --disable-external --no-enforce-https
```

## 内容规则

- 博文放在 `_posts/YYYY-MM-DD-title.md`；Jekyll 要求文件名带日期。侧边栏 Tab 名为 `tech`，所以"发布到 tech"等同于放入 `_posts/`。
- 集合文章放在 `_<collection>/<file>.md`。
- 新内容 front matter 必填：`title`、`date`。
- 推荐补齐：`categories`、`tags`、`description`。
- 日期带 `+0800`；站点时区是 `Asia/Shanghai`。
- `date` 必须用当前真实时间，不要编造。用 `date '+%Y-%m-%d %H:%M:%S %z'` 获取。
- `categories` 和 `tags` 保持小写。
- 新增集合文章时不要写 `layout:`，交给 `_config.yml` 的 defaults scope。
- 不要手写 `last_modified_at`，它由 `_plugins/posts-lastmod-hook.rb` 从 git 历史注入。
- `_open` 额外需要整数 `order:`，用于卡片排序；也可以写 `image:` 作为卡片封面。

最小 front matter 示例：

```yaml
---
title: "文章标题"
date: 2026-05-27 14:30:00 +0800
categories: [category, subcategory]
tags: [tag1, tag2]
description: "一句话摘要，用于 SEO 和 feed"
---
```

各集合默认值不完全相同：

- `_posts`、`_ai`、`_open`、`_tutorials`：`comments: true`、`toc: true`、`math: true`、`mermaid: true`。
- `_books`、`_life`：`comments: true`、`toc: true`；没有默认 `math` / `mermaid`。

只有需要覆盖默认行为时才显式写开关，例如 `toc: false`、`comments: false`、`math: false`、`mermaid: false`。

## Collections 关键约束

`_config.yml` 定义了 5 个自定义集合：`ai`、`open`、`books`、`life`、`tutorials`。集合概述和列表布局见 `README.md`，这里只记硬约束：

- **`_tabs/<name>.md` 的 basename 必须和 collection label 一致。** 自定义列表 layout 会拿 tab 文件名和 `collection.label` 比较；只改一边会导致页面静默变空。
- 除 `open` 外，所有自定义集合 permalink 都是 `/:collection/:year/:month/:day/:title/`。
- `open` 使用 `/:collection/:title/`，列表按 front matter 的 `order` 排序。

## Mermaid 图规则

博客已支持 Mermaid（`_posts`、`_ai`、`_open`、`_tutorials` 默认开启）。写技术文章时，遇到以下场景应主动插入 Mermaid 图帮助理解：

- **接口/类继承体系**：用 `classDiagram`，突出继承和组合关系
- **多步骤流程**：用 `flowchart TD`（纵向）或 `flowchart LR`（横向），用 `style` 给关键节点上色
- **时序交互**：用 `sequenceDiagram`，展示组件间的调用顺序和事件
- **优先级/层级**：用 `flowchart TD`，从高到低排列，用颜色分组

绘图原则：

- **美观**：用 `style` 填充色区分角色/阶段（如 `#fff9c4` 高亮关键步骤，`#e3f2fd` 标注回调，`#e8f5e9` 标注实例化）
- **层次清晰**：`flowchart` 用子图 `subgraph` 划分阶段；`classDiagram` 用 `<<interface>>` 标注接口
- **依赖/包含关系突出**：`classDiagram` 用 `--|>` 表示继承、`--` 表示组合；`flowchart` 用箭头方向表示依赖
- **不滥用**：纯文字能说清楚的不要画图；一张图专注一个关注点，避免信息过载

## 构建坑点

- `categories` / `tags` 必须小写。`jekyll-archives` 只管 `_posts` 的归档页；自定义集合由 `_plugins/collection-archives.rb` 处理，两者都依赖 slugify，大小写混用会生成重复归档页。
- `_tutorials/` 里有 Chirpy starter 模板残留的坏链接。CI 故意给 `htmlproofer` 传 `--ignore-files "/tutorials/"`；清理前不要去掉。
- `last_modified_at` 依赖 git 历史。CI 已经设置 `fetch-depth: 0`；浅克隆可能让 hook 失效。
- `assets/lib` submodule 只有在 `_config.yml` 启用 `assets.self_host.enabled` 时才需要，日常开发不必 `git submodule update --init`。

## gh CLI 速查

- 看部署状态：`gh run list --workflow=pages-deploy.yml`；失败日志：`gh run view <id> --log-failed`
- 手动触发部署：`gh workflow run pages-deploy.yml`
- PR / Issue：`gh pr ...`、`gh issue ...`
- 仓库元信息 / Release：`gh repo view`、`gh release ...`

## 文章发布流程

适用于所有 skill（summarize-article、archive-chat 等）生成的文章。

### 本地预览

```bash
bin/jekyll-dev.sh restart
open "http://127.0.0.1:4000/<collection>/<path>/"
```

- `_ai` 集合的 URL 格式：`/ai/YYYY/MM/DD/<slug>/`
- `_open` 集合的 URL 格式：`/open/<slug>/`
- 先让用户预览，确认 OK 后再 commit，不自动 commit

### 文件命名

- 集合文章文件名：`YYYY-MM-DD-<slug>.md`
- slug 用英文短横线小写串（去掉中文标点和特殊符号，保留中英文单词和数字，用短横线连接）
- 不用中文做文件名

### Git 提交与发布

```bash
git add <PATH>
git commit -m "Add: <一句话描述>

Co-Authored-By: Claude <noreply@anthropic.com>"
git push
```

查 CI：`gh run list --workflow=pages-deploy.yml --limit 1`

用户不满意时清理：`rm <PATH>`

## Commit 签名

所有 commit message 必须附加 Co-Authored-By trailer 标识 Claude 参与贡献:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

例如:

```
Add: 总结 Claude Code 51 万行源码架构

Co-Authored-By: Claude <noreply@anthropic.com>
```

这是仓库惯例(之前 Cursor 也用类似格式 `Co-authored-by: Cursor <cursoragent@cursor.com>`)。