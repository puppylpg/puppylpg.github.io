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

派 agent 前先执行 `date '+%Y-%m-%d %H:%M:%S'` 拿到实际日期和时间，再填入 prompt。**不得硬写时间**。

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
- **翻译信达雅**：翻译英文文章时，不要逐字硬翻。用中文读者自然的表达习惯重述，保留原意但不拘泥于原文句式。长句拆短、被动改主动、从句重组为中文节奏。宁可意译也不要生硬直译——读者应该感觉在读一篇中文原创文章，而不是翻译稿。
- **英文原文标注**：翻译自英文的文章，晦涩或专业术语首次出现时必须附上英文原词，格式为`中文（English term）`。例如"转录分类器（transcript classifier）""推理失明（reasoning-blind）""拒绝且继续（deny-and-continue）"。首次出现标注，后续不再重复。通用词（如 API、git、shell）不需要标注。
- 正文末尾加两节：`# 核心` + `# 评价`，用 `---` 分隔。核心节用自己的语言提炼原文最值得记住的洞察，不是复述；评价节对原文的观点和内容做批判性分析——哪些说得好、哪些有问题、哪些没说到、有哪些隐含假设或盲点。两节都要有干货，评价节不能只写"文章不错"。

正文骨架（TOC 必须严格是下面这两行，不能改成 `##` 标题）：
```
1. Table of Contents, ordered
{:toc}

> 原文：[原文标题](原文URL)

# 第一节标题
...

---

# 核心
（用自己的语言提炼原文最值得记住的洞察，不是复述）

# 评价
（对原文的批判性分析：哪些说得好、哪些有问题、哪些没说到、隐含假设或盲点）
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
- 若原文来自主流 AI 大厂官方域名（anthropic.com、openai.com、deepmind.google、blog.google、moonshot.cn/kimi 等），在 title 前加品牌前缀，格式为 `【Anthropic】`、`【OpenAI】`、`【Google】`、`【Kimi】` 等，首字母大写，使用中文全角中括号
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
git push
```

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
- ❌ title 照搬原文标题
- ❌ 英文文章的晦涩专业术语首次出现时不附英文原词
