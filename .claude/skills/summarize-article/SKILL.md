---
name: summarize-article
description: "把用户给的文章总结成一篇博客 post,默认发布到 _ai 集合。流程:派子 agent 抓原文并写出总结 → 主 agent 启动本地 Jekyll 给用户预览 → 用户确认后用 gh 发布到远端,否则清理。当用户说『总结这篇文章』『总结一下 <URL>』『把这篇文章写成 post』时触发。"
---

# 总结文章到博客 post

把用户给定的文章（URL、文件路径或粘贴的文本）总结成一篇可发布的 Jekyll 博客文章，默认放到 `_ai/` 集合下，本地预览确认后再决定推远端。

## 触发条件

用户表达「总结 / summarize / 整理这篇文章」之类的意图，并给出一篇文章（链接、文件、或正文）时。

## 总体架构

**主 agent 不要自己去 `WebFetch` / `Read` 原文 —— 那会吃掉大量 context。** 派一个子 agent 去做「抓正文 + 写总结 + 落盘」，主 agent 只接收一份精简的结果（文件路径、标题、一句话描述），然后做本地预览和 git 操作。

```
主 agent ──spawn──> 子 agent: 抓原文 + 写总结 + Write 到 _ai/
   │                                │
   │ <──── path + title + summary ──┘
   │
   ├── bin/jekyll-dev.sh restart
   ├── open 预览 URL
   ├── 等用户确认
   └── OK → 本地 git commit + gh api 写远端 + gh run 看 CI
       不 OK → rm 文件 / 派新子 agent 重写
```

## 工作流程

按顺序执行，每完成一步用一句话向用户同步。

### 1. 派子 agent 去抓取 + 总结 + 写文件

用 `Agent` 工具，`subagent_type: "general-purpose"`，prompt 用下面这个模板（替换 `<...>` 占位符）：

```
你是帮我把一篇文章总结成 Jekyll 博客 post 的子 agent。完成后把文件直接 Write 到磁盘，最后返回精简的结果摘要给我。

输入：
- 原文来源：<URL / 本地路径 / 用户粘贴的正文>
- 今天日期：<YYYY-MM-DD，从环境上下文 Today's date 取>
- 当前时刻：<HH:MM:SS，用于 frontmatter 的 date>

—— 第一步：抓取原文 ——
- 微信公众号（URL 包含 mp.weixin.qq.com）→ **必须用 playwright MCP**（`mcp__playwright__browser_navigate` 打开页面，然后用 `mcp__playwright__browser_snapshot` 或 `mcp__playwright__browser_evaluate` 提取 `#js_content` 里的正文）。不要用 WebFetch，会抓不全或被风控拦截。读完后调用 `mcp__playwright__browser_close` 关掉。
- 其他 URL → 用 `WebFetch`。
- 本地路径 → 用 `Read`。
- 已经是正文文本 → 直接用。

完整通读一遍，识别：核心问题、关键论证步骤、结论、必要的代码/示例。

—— 第二步：写总结 ——
要求：
- **精炼但完整**：去掉啰嗦铺垫，但文章的核心流程、关键逻辑链条、关键概念、关键示例必须全部保留，让读者不读原文也能掌握主旨。不是摘要、不是 TL;DR。
- **结构化**：用 `#` / `##` 分节，按原文逻辑或「问题→分析→结论」组织。可适当用列表、代码块、引用。
- **保留原文链接**：正文开头放 `> 原文：[标题](URL)`。
- **中文写**（除非原文和用户语境都是英文）。
- **不要加水分**：不写「本文将介绍」「综上所述」这类空话。

正文骨架（frontmatter 后紧跟）：
```
1. Table of Contents, ordered
{:toc}

> 原文：[原文标题](原文URL)

# 第一节标题

...
```

—— 第三步：组装 frontmatter ——
```
---
title: "中文简洁标题"
date: YYYY-MM-DD HH:MM:SS +0800
categories: [ai, 子分类]
tags: [tag1, tag2, tag3]
description: "一句话摘要"
---
```
铁律：
- **`title` 根据实际内容总结，不要照搬原文标题**。原文标题常常是营销/标题党风格（「震惊！」「我看完之后……」「一文搞懂 X」），或者很长很啰嗦。你要做的是读完正文后,用一句简洁、信息量高的中文短句概括「这篇文章到底讲了什么」,作为博客 post 的 title。原文标题只放在正文开头的 `> 原文：[原文标题](URL)` 里保留出处。
- **不要写 `layout:`**（`_config.yml` defaults 已经接管）
- `date` 必须带 `+0800`，精确到秒
- `categories` / `tags` **全部小写**
- 不要写 `last_modified_at`（插件会从 git 注入）

—— 第四步：落盘 ——
文件路径：`_ai/YYYY-MM-DD-<slug>.md`
- `YYYY-MM-DD` 用今天
- `<slug>` 用英文短横线小写串。中文标题先取一个简短的英文/拼音 slug，不要把整个中文标题塞进文件名

用 `Write` 工具直接落盘。

—— 第五步：返回 ——
**只**返回以下三行（不要任何额外说明、不要把全文塞回来）：

PATH: _ai/YYYY-MM-DD-<slug>.md
TITLE: <中文标题>
COMMIT_DESC: <一句话描述这篇文章，用于 git commit message>
```

> 注意：prompt 模板里嵌套的反引号代码块只是写给子 agent 看的内容，不要漏字段。

### 2. 解析子 agent 输出

子 agent 返回三行：`PATH:`、`TITLE:`、`COMMIT_DESC:`。把这三个值记下来。

主 agent 不需要再 `Read` 文件正文 —— 用户即将在浏览器里看，文件已经在盘上了。

### 3. 启动本地 Jekyll 并打开预览

```bash
bin/jekyll-dev.sh restart
```

`restart` 同时处理「未启动」和「已启动」两种情况。脚本会同步源码到 `/tmp/puppylpg-build4` 并在 `:4000` 监听。

等几秒让 Jekyll 完成首次构建，然后打开浏览器。`_ai` 的 permalink 是 `/:collection/:year/:month/:day/:title/`：

```bash
open "http://127.0.0.1:4000/ai/YYYY/MM/DD/<slug>/"
```

月份和日期按文件名里的写法直接拼即可。如果 404，回退到打开首页 `http://127.0.0.1:4000/`，让用户从侧边栏 AI tab 进入。

### 4. 等用户确认

用一句话告诉用户:「预览已打开(URL),看一下内容 OK 吗?OK 我就本地 commit 并用 `gh` 发布到远端,不 OK 我就把文件清掉(或者你说改哪里我再派子 agent 重写)。」

**不要**自动 commit 或发布。等用户回复。

### 5. 用户确认 OK → 发布

按 CLAUDE.md 规则:本地 `git` 可以,远端发布**只能用 `gh`**,严禁 `git push`。

第一步,本地 commit(留下本地历史):

```bash
git add <PATH>
git commit -m "Add: <COMMIT_DESC>"
```

第二步,用 `gh api` 把文件直接提交到远端 master(等价一次远端 commit,**不用 `git push`**):

```bash
# 拿到本地 commit 用的 blob 内容并 base64
CONTENT_B64=$(base64 -i <PATH>)

gh api -X PUT "repos/puppylpg/puppylpg.github.io/contents/<PATH>" \
  -f message="Add: <COMMIT_DESC>" \
  -f content="$CONTENT_B64" \
  -f branch=master \
  -f sha=$(git hash-object <PATH>)  # 仅当远端已有同路径文件时需要,新建文件可省略
```

注意:`gh api` 创建的远端 commit 会和本地 commit hash 不一样,本地分支会和 `origin/master` 出现"假分叉"(内容相同、SHA 不同)。下次操作前先 `git fetch`,然后:

- 如果本地只有这一笔(和远端内容一致):`git reset --hard origin/master` 对齐。
- 如果本地有其他未发布改动,或者 `gh api` 之前远端被别人推过、产生真冲突:
  1. `git stash`(保护未发布的本地改动)
  2. `git pull --rebase`(拉远端,解任何冲突)
  3. `git stash pop`,解冲突,再 `git commit`
  4. 再走一次 `gh api PUT contents` 把这次的改动同步到远端

**绝不要用 `git push` 兜底**,包括 `git push -f`。

第三步,看 CI 状态:

```bash
gh run list --workflow=pages-deploy.yml --limit 1
```

告诉用户最新一次 run 的状态和链接。

### 6. 用户不满意 → 清理或重写

**清理**：

```bash
rm <PATH>
```

不要 stop 本地 dev server（用户可能还要继续别的事）。告诉用户文件已清理。

**要求改而不是清掉** → 派一个新的子 agent 重写，prompt 里带上：
- 原始来源（URL / 路径 / 正文）
- 现有文件路径（让它覆盖 Write）
- 用户的具体修改意见
- 同样的写作要求和 frontmatter 规则

子 agent 改完后 Jekyll 会自动重建，主 agent 重新提示用户确认。

## 常见错误

- ❌ 主 agent 自己 `WebFetch` 原文 —— 占 context，违背本 skill 设计；只能由子 agent 做
- ❌ 抓微信公众号用 `WebFetch` —— 内容渲染依赖 JS，抓回来基本是空壳；必须用 playwright
- ❌ 子 agent 返回里把全文 markdown 塞回来 —— 失去了用子 agent 的意义；只返回 `PATH/TITLE/COMMIT_DESC` 三行
- ❌ Front matter 里加 `layout: post` —— 多余，会和 defaults 冲突排查很麻烦
- ❌ tag / category 用大写 —— `jekyll-archives` 会生成重复归档页
- ❌ 文件名用中文 —— URL 会变成 percent-encoding，难看且容易出问题
- ❌ 自动 commit 不等用户确认 —— 用户明确要求要先预览
- ❌ **用 `git push` 发布** —— 本项目禁用 `git push`,远端发布**只能**用 `gh api`/`gh pr`,见 CLAUDE.md
- ❌ 远端发布后不报部署状态 —— 按 CLAUDE.md 约定要用 `gh run list` 查 CI
- ❌ 总结里只写 TL;DR,省掉关键步骤 —— 用户要的是「核心流程完整」,不是摘要
- ❌ `title` 直接照搬原文标题 —— 原文常常是标题党或过长，post title 要根据正文内容自己总结一句信息量高的中文短句
