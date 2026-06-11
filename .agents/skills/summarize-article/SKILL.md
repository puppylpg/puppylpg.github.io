---
name: summarize-article
description: "把用户给的文章 URL 总结成博客 post 发布到 _ai 集合。"
---

# 总结文章到博客 post

## 总体架构

主 agent 不自己抓原文，派子 agent 做「抓正文 + 写总结 + 落盘」，主 agent 只接收三行结果，再做预览和 git 操作。

```
主 agent ──spawn──> 子 agent: 抓原文 + 写总结 + Write 到 _ai/
   │                                │
   │ <──── PATH + TITLE + COMMIT_DESC ──┘
   │
   ├── 本地预览（见下方「文章发布流程」）
   ├── 等用户确认
   └── OK → git commit + push + 查 CI
       不 OK → rm 文件 / 派新子 agent 重写
```

## 工作流程

### 1. 派子 agent 抓取 + 总结 + 写文件

派 agent 前先执行 `date '+%Y-%m-%d %H:%M:%S %z'` 拿到实际日期和时间，再填入 prompt。**不得硬写时间**。

使用当前环境支持的子 agent / 子任务机制执行，prompt 使用同目录下 `PROMPT.md` 中的模板。
> 各 Agent 的子任务调用方式不同（如 Claude 的 `Agent` 工具、Kimi 的 `Agent` 工具、Codex 的内联 agent 等），按当前环境实际支持的方式执行即可。

### 2. 预览、发布、清理

遵循「文章发布流程」：本地预览 → 用户确认 → commit + push + CI → 或清理/重写。

> 本项目使用 Jekyll + Chirpy 主题，CI 由 GitHub Pages 处理。

重写时：派新子 agent，prompt 带上原始来源、现有文件路径、修改意见、同样的写作和 frontmatter 规则。

## 常见错误

- ❌ 主 agent 自己抓取原文
- ❌ 微信公众号用常规抓取工具（必须用浏览器自动化）
- ❌ 子 agent 把全文 markdown 塞回返回值
- ❌ 文件名用中文
- ❌ 不等用户确认直接 commit
- ❌ title 照搬原文标题
- ❌ 英文文章的晦涩专业术语首次出现时不附英文原词
