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

任何将文章写入 `_ai/`、`_posts/` 或 `_tutorials/` 的 skill/agent，开始修改前应先执行 `git pull --rebase --autostash` 同步远端 `master`。本项目可能由多个环境同时维护，该命令会自动 stash 未提交修改、拉取远端、rebase 后再 pop，一步完成。

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

### 本地预览命令

按操作系统选择：

| 系统 | 推荐命令 | 说明 |
|-----|---------|-----|
| macOS / Linux | `bin/jekyll-dev.sh start` 或 `bin/jekyll-dev.sh restart` | 本地 Ruby 环境 |
| macOS / Linux | `bin/jekyll-docker.sh start` | Docker 方式 |
| Windows | `bin/jekyll-docker.ps1 start` | Docker 方式 |

预览验收标准：站点能启动、目标文章页面可访问。预览后向用户提供文章链接，等待确认。

常见 URL：

- `_ai`：`/ai/YYYY/MM/DD/<slug>/`
- `_posts`：`/posts/YYYY/MM/DD/<slug>/` 或主题生成的 post permalink
- `_tutorials`：`/tutorials/YYYY/MM/DD/<slug>/`
- `_open`：`/open/<slug>/`

### Windows Bash 环境注意事项

Windows 下 agent 的 Bash 工具通常是非登录 shell，PATH 里可能没有 docker。用登录 shell 包一层即可：

```bash
bash -l -c 'powershell.exe -ExecutionPolicy Bypass -File bin/jekyll-docker.ps1 start'
```

### 发布后的善后

发布完成后，用对应脚本的 `stop` 命令关闭预览服务，不要长期遗留。

## Commit 签名

Commit message 附加参与本次改动的 agent 的 `Co-Authored-By` trailer。不同 agent 使用各自对应的邮箱：

| Agent | Co-Authored-By 格式 | 说明 |
|-------|---------------------|------|
| Claude | `Co-Authored-By: Claude <noreply@anthropic.com>` | Anthropic 官方常用格式 |
| Codex | `Co-Authored-By: Codex <codex@openai.com>` | OpenAI 已创建 `github.com/codex` 账户并验证该邮箱 |
| Kimi | `Co-Authored-By: Kimi <noreply@moonshot.ai>` | 社区常用格式，Moonshot 尚未官方确认统一邮箱；若后续官方有变，以官方为准 |

## 通用 Frontmatter 约定

- `date` 通过执行 `date '+%Y-%m-%d %H:%M:%S %z'` 获取，不得硬写时间。
- 新内容 front matter 必填：`title`、`date`。
- 推荐补齐：`categories`、`tags`、`description`。
- 日期带 `+0800`；站点时区是 `Asia/Shanghai`。
- `categories` 和 `tags` 必须小写。
- 新增集合文章时不要写 `layout:`，交给 `_config.yml` 的 defaults scope。
- 不要手写 `last_modified_at`，它由 `_plugins/posts-lastmod-hook.rb` 从 git 历史注入。

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

## 正文格式与可视化

- 不要大段纯文本平铺；对关键概念、核心结论、易错点适当加粗，对代码/SQL 关键字用行内代码，保持整篇强调风格一致。
- 引用外部资料时使用 Markdown 内联链接，嵌入有意义文字中；不要贴裸 URL。
- 流程、层级、时序、继承、架构布局、状态流转等结构优先用 Mermaid 图表达；不要默认所有内容都画成 `flowchart`，应按表达目的选择更合适的图形形态，以加深读者的形象化理解。站点固定暗色模式，浅色节点文字一般由 `assets/js/custom-mermaid.js` 自动处理，通常无需手动指定 `color`。
- Mermaid 图形选型建议：流程/依赖/映射用 `flowchart`；调用链用 `sequenceDiagram`；状态机用 `stateDiagram-v2`；类或接口关系用 `classDiagram`；数据实体关系用 `erDiagram`；系统架构、模块分层、内存/缓存块布局可优先尝试 `block-beta` 或带 `subgraph` 的 `flowchart`；时间演化用 `timeline` 或 `gantt`；知识树用 `mindmap`；简单占比用 `pie`；二维取舍用 `quadrantChart`。
- 同一概念如果有多个理解视角，可以保留多张互补图：例如先用 `flowchart` 讲依赖和映射，再用 `block-beta` 讲结构布局。但每张图都必须承担不同解释任务，避免重复装饰。
- 函数、公式或参数变化优先画图辅助：单变量函数画曲线标关键点；向量到分布画概率分布/热力图；参数影响画多组对比。图放在对应概念第一次深入解释的位置。
- 数学公式用 LaTeX，先直觉解释再给出公式，并定义关键符号与维度。
- 教学代码加足够注释；关键演示代码可逐行解释，注释放在被解释代码上一行，避免行尾 inline comment。

## Collections 关键约束

`_config.yml` 定义了 6 个自定义集合：`ai`、`open`、`books`、`life`、`viewed`、`tutorials`。

- `_tabs/<name>.md` 的 basename 必须和 collection label 一致。自定义列表 layout 会拿 tab 文件名和 `collection.label` 比较；只改一边会导致页面静默变空。
- 除 `open` 外，所有自定义集合 permalink 都是 `/:collection/:year/:month/:day/:title/`。
- `open` 使用 `/:collection/:title/`。

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

CI 卡点：`bundle exec jekyll build` + `htmlproofer`。本地日常预览不需要跑 `htmlproofer`。

注意：

- `jekyll-archives` 只管 `_posts`；自定义集合由 `_plugins/collection-archives.rb` 处理，两者都依赖 slugify，大小写混用会生成重复归档页。
- `_tutorials/` 有模板残留坏链接，CI 的 `htmlproofer` 故意 `--ignore-files "/tutorials/"`；清理前不要去掉。
- `last_modified_at` 依赖 git 历史，浅克隆会让 hook 失效（CI 已设 `fetch-depth: 0`）。

## gh CLI

部署工作流名为 `pages-deploy.yml`，可用 `gh run list`/`gh run view` 查看状态。
