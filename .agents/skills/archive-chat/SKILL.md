---
name: archive-chat
description: "将当前对话整理成结构化总结，发布到博客。默认发布到 _ai/，也可按用户要求发布到 _posts/（tech）或 _tutorials/。"
---

# 对话总结与发布

## 总体架构

```
主 agent
  ├── 回顾对话，提炼核心信息
  ├── 自动生成 title / tags / description
  ├── 确定发布目标（默认 _ai/，用户可指定 tech/post/tutorial）
  ├── 写文件到对应目录
  └── 后续按 AGENTS.md 中的「文章发布通用流程」执行预览、确认、git 发布/清理
```

> 文章发布通用流程（本地预览、用户确认、git 操作、清理重写）见项目根目录 `AGENTS.md`。

## 工作流程

### 1. 回顾对话，提取核心信息

从当前会话上下文中提炼：

- **主题**：这次对话围绕什么展开（一句话概括）
- **主要步骤**：按逻辑层次（而非对话时间线）列出关键阶段
- **关键指令与输出**：用户的核心请求、AI 执行的关键操作、关键输出结果
- **核心结论**：解决了什么问题、学到了什么、最终成果
- **清晰原理阐述**（如有）：对话中用户认可的层次化原理解释，保留结构化形式
- **技术栈/关键词**：涉及的技术、工具、概念，用于生成 tags

### 2. 确定发布目标

按 `AGENTS.md` 中的「目标目录与默认分类」执行：

- 默认 → `_ai/`，`categories: [ai]`
- tech / post → `_posts/`，`categories: [tech]`
- tutorial → `_tutorials/`，`categories: [tutorial]`

### 3. 生成元数据

根据对话内容直接生成 title、tags、description，不需要向用户确认。

执行 `date '+%Y-%m-%d %H:%M:%S %z'` 获取当前时间。**不得硬写时间**。

### 4. 生成 Markdown 文件

文件保存到对应目录：`_<target>/YYYY-MM-DD-<slug>.md`。

- slug 规则见 `AGENTS.md`。
- 正文格式和结构要求见 `assets/TEMPLATE.md`。

### 5. 预览与发布

按 `AGENTS.md` 中的「文章发布通用流程」执行：本地预览 → 用户确认 → 询问后 git commit/push → 或清理/重写。

## 常见错误

- ❌ 写文件前停下来确认 title / tags / description
- ❌ 文件名用中文
- ❌ 大段粘贴原始对话而不重新组织
- ❌ 硬写日期时间而不执行 `date` 命令
- ❌ 把结构化原理阐述扁平化成叙述体
- ❌ 按对话时间线组织文章（应改为按逻辑层次重新编排）
- ❌ 默认发布到错误目录（未说明时应发到 `_ai/`）

## 正文与可视化要求

正文格式和结构要求见 `assets/TEMPLATE.md`。补充一点：

引用外部资料时，必须使用 Markdown 内联链接，把链接嵌入到有意义的文字中，例如 `[OpenAI Codex 的 AGENTS.md 文档](https://developers.openai.com/codex/guides/agents-md)`。不要把裸 URL 单独贴在正文里。需要增强可信度时，应优先引用官方文档或项目主页，并在正文中解释来源支持了哪个判断。

当对话内容涉及流程、层级、对比、时序等结构时，**优先使用 Mermaid 图**（`mermaid` 代码块）替代 ASCII 示意图或纯文本层级图。博客主题已原生支持 Mermaid 渲染。

常用场景与图表类型：

| 场景 | 推荐图表 |
|------|---------|
| 多步骤流程 / 决策分支 | `flowchart TD`（纵向）或 `flowchart LR`（横向） |
| 层级 / 架构分层 | `flowchart` + `subgraph` 划分子系统 |
| 时序交互 / 调用链 | `sequenceDiagram` |
| 接口继承 / 类关系 | `classDiagram` |

样式约定：
- 用 `style` 给关键节点上色，区分不同路径或状态（如 `#e3f2fd` 正常流程、`#e8f5e9` 成功/直连、`#fff3bf` 警告/中间环节、`#ffe3e3` 错误/阻塞）
- 避免纯装饰性节点，每个节点和箭头都应承载信息
- 单张图只表达一个核心关注点，复杂流程拆成多张
