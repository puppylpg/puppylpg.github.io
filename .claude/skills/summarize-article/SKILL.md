---
name: summarize-article
description: "把用户给的文章总结成一篇博客 post,默认发布到 _ai 集合。流程:派子 agent 抓原文并写出总结 → 主 agent 启动本地 Jekyll 给用户预览 → 用户确认后用 gh 发布到远端,否则清理。当用户说『总结这篇文章』『总结一下 <URL>』『把这篇文章写成 post』时触发。"
---

# 总结文章到博客 post

## 总体架构

主 agent 不自己抓原文，派子 agent 做「抓正文 + 写总结 + 落盘」，主 agent 只接收三行结果，再做预览和 git 操作。

```
主 agent ──spawn──> 子 agent: 抓原文 + 写总结 + Write 到 _ai/
   │                                │
   │ <──── PATH + TITLE + COMMIT_DESC ──┘
   │
   ├── bin/jekyll-dev.sh restart → open 预览 URL
   ├── 等用户确认
   └── OK → git commit + gh api 写远端 + gh run 看 CI
       不 OK → rm 文件 / 派新子 agent 重写
```

## 工作流程

### 1. 派子 agent 抓取 + 总结 + 写文件

`Agent` 工具，`subagent_type: "general-purpose"`，**`model: "haiku"`**，prompt：

```
你是帮我把一篇文章总结成 Jekyll 博客 post 的子 agent。

输入：
- 原文来源：<URL / 本地路径 / 正文>
- 今天日期：<YYYY-MM-DD>
- 当前时刻：<HH:MM:SS>

—— 第一步：抓取原文 ——
- 微信公众号（mp.weixin.qq.com）→ 用 playwright MCP：`mcp__playwright__browser_navigate` 打开，`mcp__playwright__browser_snapshot` 读内容，完成后 `mcp__playwright__browser_close`。
- 其他 URL → `WebFetch`。
- 本地路径 → `Read`。

—— 第二步：写总结 ——
- 精炼但完整：核心流程、关键逻辑、关键概念、关键示例全部保留，不是 TL;DR。
- 结构化：`#` / `##` 分节，按原文逻辑或「问题→分析→结论」组织。
- 正文开头：`> 原文：[原文标题](URL)`
- 中文写，不写「本文将介绍」「综上所述」等空话。

正文骨架：
```
1. Table of Contents, ordered
{:toc}

> 原文：[原文标题](原文URL)

# 第一节标题
...
```

—— 第三步：frontmatter ——
```
---
title: "中文简洁标题"
date: YYYY-MM-DD HH:MM:SS +0800
categories: [ai, 子分类]
tags: [tag1, tag2, tag3]
description: "一句话摘要"
---
```
- title 根据正文内容自己总结，不照搬原文标题（原文标题常是标题党/过长）
- 不写 `layout:`、不写 `last_modified_at`
- categories / tags 全部小写

—— 第四步：落盘 ——
路径：`_ai/YYYY-MM-DD-<slug>.md`（slug 用英文短横线小写串）
用 `Write` 写到 `/Users/puppylpg/Codes/github/puppylpg.github.io/_ai/YYYY-MM-DD-<slug>.md`。

—— 第五步：返回 ——
只返回这三行：

PATH: _ai/YYYY-MM-DD-<slug>.md
TITLE: <中文标题>
COMMIT_DESC: <一句话描述>
```

### 2. 本地预览

```bash
bin/jekyll-dev.sh restart
open "http://127.0.0.1:4000/ai/YYYY/MM/DD/<slug>/"
```

告诉用户预览 URL，等确认。不自动 commit。

### 3. 用户确认 OK → 发布

```bash
git add <PATH>
git commit -m "Add: <COMMIT_DESC>

Co-Authored-By: Claude <noreply@anthropic.com>"
```

```bash
CONTENT_B64=$(base64 -i <PATH>)
gh api -X PUT "repos/puppylpg/puppylpg.github.io/contents/<PATH>" \
  -f message="Add: <COMMIT_DESC>" \
  -f content="$CONTENT_B64" \
  -f branch=master
```

（新文件不需要 `-f sha=...`；若文件已存在远端则需要加）

`gh api` 产生的远端 commit 与本地 hash 不同，之后执行 `git fetch && git reset --hard origin/master` 对齐。

查 CI：
```bash
gh run list --workflow=pages-deploy.yml --limit 1
```

### 4. 用户不满意 → 清理或重写

清理：`rm <PATH>`

重写：派新子 agent，prompt 带上原始来源、现有文件路径、修改意见、同样的写作和 frontmatter 规则。

## 常见错误

- ❌ 主 agent 自己 WebFetch 原文
- ❌ 微信公众号用 WebFetch（必须 playwright）
- ❌ 子 agent 把全文 markdown 塞回返回值
- ❌ frontmatter 写 `layout:` 或 `last_modified_at`
- ❌ tag / category 大写
- ❌ 文件名用中文
- ❌ 不等用户确认直接 commit
- ❌ 用 `git push`（禁止，只能用 `gh api`）
- ❌ title 照搬原文标题
