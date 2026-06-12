---
name: summarize-article
description: "把用户给的文章 URL 总结成博客 post。默认发布到 _ai/，也可按用户要求发布到 _posts/（tech）或 _tutorials/。"
---

# 总结文章到博客 post

## 总体架构

主 agent 不自己抓原文，派子 agent 做「抓正文 + 写总结 + 落盘」，主 agent 只接收三行结果，再按 `AGENTS.md` 执行预览和 git 操作。

```
主 agent
  ├── 确定发布目标（默认 _ai/，用户可指定 tech/post/tutorial）
  ├── 执行 date 获取时间
  ├── spawn 子 agent: 抓原文 + 写总结 + Write 到 _<target>/
  │       │
  │ <──── PATH + TITLE + COMMIT_DESC
  │
  └── 后续按 AGENTS.md 中的「文章发布通用流程」执行预览、确认、git 发布/清理
```

> 文章发布通用流程（目标目录、本地预览、用户确认、git 操作、清理重写）见项目根目录 `AGENTS.md`。

## 工作流程

### 1. 确定发布目标

按 `AGENTS.md` 中的「目标目录与默认分类」执行：

- 默认 → `_ai/`，默认分类 `[ai]`
- tech / post → `_posts/`，默认分类 `[tech]`
- tutorial → `_tutorials/`，默认分类 `[tutorial]`

### 2. 派子 agent 抓取 + 总结 + 写文件

派 agent 前先执行 `date '+%Y-%m-%d %H:%M:%S %z'` 拿到实际日期和时间。**不得硬写时间**。

使用当前环境支持的子 agent / 子任务机制执行，prompt 使用同目录下 `PROMPT.md` 中的模板。

派子 agent 时必须传入：

- 原文来源 URL
- 当前日期时间
- **目标目录**（`_ai/`、`_posts/` 或 `_tutorials/`）
- **默认分类**（`[ai]`、`[tech]` 或 `[tutorial]`）

### 3. 预览与发布

子 agent 返回 `PATH`、`TITLE`、`COMMIT_DESC` 后，主 agent 按 `AGENTS.md` 中的「文章发布通用流程」执行：本地预览 → 用户确认 → 询问后 git commit/push → 或清理/重写。

重写时：派新子 agent，prompt 带上原始来源、现有文件路径、修改意见、目标目录、默认分类、同样的写作和 frontmatter 规则。

## 常见错误

- ❌ 主 agent 自己抓取原文
- ❌ 微信公众号用常规抓取工具（必须用浏览器自动化）
- ❌ 子 agent 把全文 markdown 塞回返回值
- ❌ 文件名用中文
- ❌ title 照搬原文标题
- ❌ 英文文章的晦涩专业术语首次出现时不附英文原词
- ❌ 默认发布到错误目录（未说明时应发到 `_ai/`）
