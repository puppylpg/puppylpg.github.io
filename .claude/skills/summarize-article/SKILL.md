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
- 本地路径 → `Read`。
- 外部 URL → 优先用 `WebFetch`；如果返回内容为空或明显不完整，fallback 到 playwright MCP（`browser_navigate` → `browser_snapshot` → `browser_close`）。
- 微信公众号（mp.weixin.qq.com）→ WebFetch 必定失败，直接用 playwright，不要先试 WebFetch 浪费时间。

—— 第二步：写总结 ——
- 精炼但完整：核心流程、关键逻辑、关键概念、关键示例全部保留，不是 TL;DR。
- 结构化：`#` / `##` 分节，按原文逻辑或「问题→分析→结论」组织。
- 正文开头：`> 原文：[原文标题](URL)`
- 中文写，不写「本文将介绍」「综上所述」等空话。
- **翻译信达雅**：翻译英文文章时，不要逐字硬翻。用中文读者自然的表达习惯重述，保留原意但不拘泥于原文句式。长句拆短、被动改主动、从句重组为中文节奏。宁可意译也不要生硬直译——读者应该感觉在读一篇中文原创文章，而不是翻译稿。
- **英文原文标注**：翻译自英文的文章，晦涩或专业术语首次出现时必须附上英文原词，格式为`中文（English term）`。首次出现标注，后续不再重复。判断标准：
  - **要标注**：中文技术圈没有统一译法的词（如 progressive disclosure、railroading、gotchas、progressive delivery）、自造复合词（如 transcript classifier、reasoning-blind、deny-and-continue）、架构/模式名（如 stale-while-revalidate、circuit breaker——除非已有广为人知的中文译名如"熔断器"）。标注格式为`中文意译（English term）`，如"渐进式披露（progressive disclosure）""把指令写得太死（railroading）"。
  - **不要标注**：API、git、shell 等通用词；已有广为人知中文译名且不会产生歧义的词（如"微服务""负载均衡""熔断器"）；纯英文缩写（如 CI/CD、SDK、CLI）。
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
- 若原文来自主流 AI 大厂官方域名（anthropic.com、openai.com、deepmind.google、blog.google、moonshot.cn/kimi 等），在 title 前加品牌前缀，格式为 `【Anthropic】`、`【OpenAI】`、`【Google】`、`【Kimi】` 等，首字母大写，使用中文全角中括号。其他来源不加品牌前缀
- frontmatter 其他规则（不写 `layout:`/`last_modified_at`、categories 和 tags 小写等）遵循仓库 CLAUDE.md 中的「内容规则」，不在此重复

—— 第四步：自审 ——
写完正文后，逐项检查以下清单，每项不通过就当场修改：
- [ ] **硬翻检查**：有没有逐字硬翻、读起来不像中文的句子？长句拆短、被动改主动、从句重组。重点扫动词和连接词——"被""的""在...中"过多就是信号。
- [ ] **标题重想**：每个 `##` 标题是中文自然表达还是英文直译？英文原文常用比喻/俏皮话做标题，必须按中文习惯重想。如 "Avoid Railroading Claude" → "不要把指令写得太死"，而非 "避免导轨 Claude"。
- [ ] **术语标注**：英文术语标注是否遗漏或多余？按第二步的判断标准逐个检查。
- [ ] **空话检查**：有没有"本文将介绍""综上所述""首先...其次...最后"等套话？删掉。
- [ ] **frontmatter**：title 是否自己总结的？品牌前缀是否正确？`categories`/`tags` 是否小写？有没有多余的 `layout:` 或 `last_modified_at`？

—— 第五步：落盘 ——
路径：`_ai/YYYY-MM-DD-<slug>.md`（slug 用英文短横线小写串）
用 `Write` 写到 `/Users/puppylpg/Codes/github/puppylpg.github.io/_ai/YYYY-MM-DD-<slug>.md`。

—— 第六步：返回 ——
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
- ❌ 文件名用中文
- ❌ 不等用户确认直接 commit
- ❌ title 照搬原文标题
- ❌ 英文文章的晦涩专业术语首次出现时不附英文原词
