# Agent 协作指南

本项目是 Jekyll + Chirpy 主题的个人博客，部署在 GitHub Pages 上。

`AGENTS.md` 是本仓库面向所有 coding agent 的主入口。Codex、Claude、Cursor、Gemini CLI 等工具都应优先遵循这里的规则；工具私有文件只保留入口转发、权限、hook、命令等专属配置。

## 仓库背景

这是基于 Chirpy gem 主题的个人 Jekyll 博客。大部分布局、样式、JS 在主题 gem 中；本仓库主要放站点配置、文章内容、少量自定义 layout/plugin 和本地开发脚本。

Ruby 环境、本地开发完整流程以 `README.md` 为准。这里记录 agent 工作时必须稳定遵守的仓库约定。

## 项目内 Skill

项目内可复用工作流放在 `.agents/skills/`：

| Skill | 用途 |
|-------|------|
| `archive-chat` | 将当前对话整理成结构化总结并发布为博客文章 |
| `summarize-article` | 将用户给的文章 URL 总结成博客文章 |

使用这些 skill 时，先读取对应 `SKILL.md`，再按本文的文章发布通用流程执行预览、确认和发布。

`.agents/skills/` 是 skill 的唯一真实维护源。`.claude/skills/` 只放 Claude Code 兼容用的薄代理文件，代理文件必须指向 `.agents/skills/<skill>/SKILL.md`，不要复制完整流程。

## 文章发布通用流程

任何将文章写入 `_ai/`、`_posts/` 或 `_tutorials/` 的 skill/agent，开始修改前应先确认工作区干净，并执行 `git pull --rebase` 同步远端 `master`。本项目可能由多个环境同时维护，不要基于落后的本地 `master` 工作。

如果开始时已经存在未提交修改，不要直接 `git pull`；应先说明当前状态，并根据情况提交后 rebase，或在用户确认后 stash / 处理冲突。

落盘后遵循以下流程：

1. 本地预览。
2. 等用户确认。
3. 询问用户后再执行 `git commit` 和 `git push`，不要自动推送。
4. 用户不满意时，删除文件或按反馈修改后重来。
5. 用户确认并发布后，关闭本地预览服务并做善后清理（见下方「发布后的善后」）。

### 目标目录与默认分类

| 用户说法 | 目标目录 | 默认 categories |
|---------|---------|----------------|
| 未特别说明 / “发到 AI” / 默认 | `_ai/` | `[ai]` |
| “发到 tech” / “发到 post” / “发到 _posts” | `_posts/` | `[tech]` |
| “发到 tutorial” / “发到 _tutorials” | `_tutorials/` | `[tutorial]` |

- 若主题有更细分领域，可在默认分类后追加，例如 `[ai, tools]`、`[tech, tools]`、`[tutorial, docker]`。
- `categories` 和 `tags` 必须小写。

### 本地预览命令

按操作系统选择：

| 系统 | 推荐命令 | 说明 |
|-----|---------|-----|
| macOS / Linux | `bin/jekyll-dev.sh start` 或 `bin/jekyll-dev.sh restart` | 本地 Ruby 环境 |
| macOS / Linux | `bin/jekyll-docker.sh start` | Docker 方式 |
| Windows | `bin/jekyll-docker.ps1 start` | Docker 方式 |

预览后向用户提供文章链接，等待用户确认。

本地发布预览的验收标准是站点能成功启动，并且目标文章页面能在浏览器中访问。不要在日常本地预览阶段强制复刻远端 GitHub Actions 的完整校验；尤其不要把 `htmlproofer` 作为写文章后的必跑步骤。`htmlproofer` 主要用于 CI 或用户明确要求的链接检查。

常见 URL：

- `_ai`：`/ai/YYYY/MM/DD/<slug>/`
- `_posts`：`/posts/YYYY/MM/DD/<slug>/` 或主题生成的 post permalink
- `_tutorials`：`/tutorials/YYYY/MM/DD/<slug>/`
- `_open`：`/open/<slug>/`

### Git 发布与清理

- 用户确认文章无误后，先询问是否执行 `git commit` 和 `git push`。
- 不要未经用户同意自动 commit/push。
- 若用户不同意或需要修改，直接删除刚写的文件，或根据用户反馈修改 / 重写后再走预览流程。
- 推送后可查看 GitHub Actions / GitHub Pages CI 状态。

### 发布后的善后

一旦用户确认并让 agent 发布（执行了 commit + push），本地预览服务的使命就结束了，应主动关闭并清理：

| 启动方式 | 关闭命令 |
|---------|---------|
| 本地 Ruby（`bin/jekyll-dev.sh`） | `bin/jekyll-dev.sh stop` |
| Docker（`bin/jekyll-docker.sh`） | `bin/jekyll-docker.sh stop` |
| Windows Docker（`bin/jekyll-docker.ps1`） | `bin/jekyll-docker.ps1 stop` |

- 预览服务可能绑定在 `0.0.0.0`（公网可达），发布后继续挂着有被扫描探测的风险，**不要长期遗留**。
- 顺带清理预览/验证过程中产生的临时文件（如 `/tmp` 下的测试脚本、截图）。
- 例外：用户明确表示还要继续预览其他内容时，保留服务，但在收尾时提醒用户它还开着。

## Commit 签名

如果 agent 参与创建 commit，commit message 应附加对应 agent 自己的 `Co-Authored-By` trailer。不要统一冒充某一个 agent。

示例：

```text
Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Cursor <cursoragent@cursor.com>
Co-Authored-By: Codex <noreply@openai.com>
```

实际提交时只添加参与本次改动的 agent。若不确定某个 agent 的推荐邮箱，使用该工具官方或本项目既有惯例；没有明确惯例时，先询问用户。

## 通用 Frontmatter 约定

- `date` 通过执行 `date '+%Y-%m-%d %H:%M:%S %z'` 获取，不得硬写时间。
- 新内容 front matter 必填：`title`、`date`。
- 推荐补齐：`categories`、`tags`、`description`。
- 日期带 `+0800`；站点时区是 `Asia/Shanghai`。
- `categories` 和 `tags` 必须小写。
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

TOC 固定使用：

```markdown
1. Table of Contents, ordered
{:toc}
```

各集合默认值：

- `_posts`、`_ai`、`_open`、`_tutorials`、`_viewed`：`comments: true`、`toc: true`、`math: true`、`mermaid: true`。
- `_books`、`_life`：`comments: true`、`toc: true`；没有默认 `math` / `mermaid`。

只有需要覆盖默认行为时才显式写开关，例如 `toc: false`、`comments: false`、`math: false`、`mermaid: false`。

## 文件命名

文章保存为 `_<target>/YYYY-MM-DD-<slug>.md`：

- slug 用小写英文、数字、连字符，不超过 50 字符，不含中文和特殊符号。
- 中文主题用拼音或英文关键词缩写。
- 不用中文做文件名。

## 内容规则

- 博文放在 `_posts/YYYY-MM-DD-title.md`；Jekyll 要求文件名带日期。侧边栏 Tab 名为 `tech`，所以“发布到 tech”等同于放入 `_posts/`。
- 集合文章放在 `_<collection>/<file>.md`。
- 中文正文中的引号必须用中文弯引号，左引号 `“`（U+201C）和右引号 `”`（U+201D）必须配对。
- 生成中文内容后检查不要把左引号也写成右引号，例如错误的 `”为什么”`。

## Collections 关键约束

`_config.yml` 定义了 6 个自定义集合：`ai`、`open`、`books`、`life`、`viewed`、`tutorials`。

- `_tabs/<name>.md` 的 basename 必须和 collection label 一致。自定义列表 layout 会拿 tab 文件名和 `collection.label` 比较；只改一边会导致页面静默变空。
- 除 `open` 外，所有自定义集合 permalink 都是 `/:collection/:year/:month/:day/:title/`。
- `open` 使用 `/:collection/:title/`，列表按 front matter 的 `order` 排序。

## Mermaid 图规则

博客已支持 Mermaid（`_posts`、`_ai`、`_open`、`_tutorials` 默认开启）。写技术文章时，遇到以下场景应主动插入 Mermaid 图帮助理解：

- 接口/类继承体系：用 `classDiagram`，突出继承和组合关系。
- 多步骤流程：用 `flowchart TD`（纵向）或 `flowchart LR`（横向），用 `style` 给关键节点上色。
- 时序交互：用 `sequenceDiagram`，展示组件间的调用顺序和事件。
- 优先级/层级：用 `flowchart TD`，从高到低排列，用颜色分组。

绘图原则：

- 用 `style` 填充色区分角色/阶段，例如 `#fff9c4` 高亮关键步骤，`#e3f2fd` 标注回调，`#e8f5e9` 标注实例化。
- 站点固定暗色模式，mermaid 暗色主题默认文字是浅色。`assets/js/custom-mermaid.js` 会在渲染后自动给浅色填充的节点换深色文字，写图时无需手动指定 `color`；如需精确控制也可显式写 `style A fill:#fff9c4,color:#1f2937`。
- `flowchart` 用子图 `subgraph` 划分阶段；`classDiagram` 用 `<<interface>>` 标注接口。
- `classDiagram` 用 `--|>` 表示继承、`--` 表示组合；`flowchart` 用箭头方向表示依赖。
- 纯文字能说清楚的不要画图；一张图专注一个关注点，避免信息过载。

## 本地覆盖 gem 主题的文件

gem-based 主题机制：本地同路径文件优先于 gem 内文件。以下是本仓库对 `jekyll-theme-chirpy` 的覆盖清单：

| 本地文件 | 覆盖原因 |
|---------|---------|
| `_includes/update-list.html` | 原版只遍历 `site.posts`，覆盖后让右侧栏“最近更新”涵盖所有集合（ai、open、tutorials、books、life） |
| `_layouts/home.html` | 首页合并所有集合按日期倒序展示，而非仅 `_posts` |
| `_includes/js-selector.html` | 在原版基础上追加加载 `assets/js/custom-toc.js`；mermaid 页面追加 `assets/js/custom-mermaid.js`（等 webfont 加载完成后再渲染避免文字被裁，并自动给浅色填充节点换深色文字） |
| `_includes/metadata-hook.html` | 原版是空占位符（官方自定义入口），覆盖后注入 `custom.css`、赛博皮肤 `cyber-skin.css`、星空背景 `starfield.js`、3D 纵深交互 `cyber-depth.js`，tags 页另注入 `tag-sphere.js` |
| `assets/404.html` | 原版只有一句话，覆盖为“迷失太空”主题 404（故障风数字 + 漂浮宇航员 + 回首页/去 3D 世界按钮） |

任何时候新增或删除对 gem 主题的覆盖文件，必须同步更新此表。每个覆盖文件都是升级主题时的手动合并债务。

## 构建与质量卡点

仓库没有独立测试套件。CI 的卡点是 `bundle exec jekyll build` 和 `htmlproofer`：

```bash
# 生产构建，对齐 CI
JEKYLL_ENV=production bundle exec jekyll build

# 本地链接检查
bundle exec htmlproofer _site --disable-external --no-enforce-https
```

本地写作和预览不需要默认执行完整 CI 校验。发布前本地只需确认 Jekyll 预览服务能跑起来、目标页面可访问；`htmlproofer` 属于远端 CI 或用户明确要求时再跑的检查。

构建坑点：

- `categories` / `tags` 必须小写。`jekyll-archives` 只管 `_posts` 的归档页；自定义集合由 `_plugins/collection-archives.rb` 处理，两者都依赖 slugify，大小写混用会生成重复归档页。
- `_tutorials/` 里有 Chirpy starter 模板残留的坏链接。CI 故意给 `htmlproofer` 传 `--ignore-files "/tutorials/"`；清理前不要去掉。
- `last_modified_at` 依赖 git 历史。CI 已经设置 `fetch-depth: 0`；浅克隆可能让 hook 失效。
- `assets/lib` submodule 只有在 `_config.yml` 启用 `assets.self_host.enabled` 时才需要，日常开发不必 `git submodule update --init`。

## gh CLI 速查

- 看部署状态：`gh run list --workflow=pages-deploy.yml`
- 失败日志：`gh run view <id> --log-failed`
- 手动触发部署：`gh workflow run pages-deploy.yml`
- PR / Issue：`gh pr ...`、`gh issue ...`
- 仓库元信息 / Release：`gh repo view`、`gh release ...`
