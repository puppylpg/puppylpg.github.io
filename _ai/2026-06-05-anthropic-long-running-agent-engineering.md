---
title: "【Anthropic】构建长期自主 Agent 的三重挑战与解法"
date: 2026-06-05 01:44:11 +0800
categories: [ai, agent]
tags: [context-engineering, harness, long-running-agent, multi-agent, anthropic]
description: "从 context engineering 到 harness 架构，Anthropic 三篇工程博客拼出一幅完整图景：如何让 AI Agent 在有限 token、跨 session、自我评估三个维度上真正跑稳"
---

1. Table of Contents, ordered
{:toc}

> 原文三篇：
> - [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
> - [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
> - [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps)

# 从单轮对话到长期自主：三个挑战

AI Agent 从「回答一个问题」演进到「完成一项工程任务」，遇到了三个性质不同的挑战：

1. **注意力稀释**：token 是有限资源，塞得越满，模型对关键信息的关注越弱。
2. **跨 session 失忆**：每次新会话都是一张白纸，Agent 不知道前一班发生了什么。
3. **自我评估偏差**：让 Agent 评价自己的工作，它会系统性地过度乐观。

Anthropic 的三篇工程博客分别对应这三个挑战，而且彼此是递进的——前一个是基础，后一个是在此基础上解决更深的问题。

---

# 第一重：Token 是有限资源

## Context Rot

Transformer 的 attention 是 O(n²) 的。随着上下文增长，模型注意力被分散到越来越多的 token 上，关键信息的权重被稀释——这就是「context rot」。

更反直觉的是：**低质量的 token 不只是浪费空间，它们在主动竞争模型的注意力**。堆砌内容有时反而让 Agent 更差。

## 最小高信号 Token 集合

Context engineering 的黄金法则：**找到最小的、高信号密度的 token 组合**。

具体体现在：

- **系统提示**：在「过度规定」和「过度模糊」之间找平衡。用 XML 标签或 Markdown 分节组织，给目标和约束，让 Agent 自主决策，而不是规定每一步。
- **工具集**：精挑细选，避免功能重叠。工具描述要清晰到「工程师一眼就知道该用哪个」。
- **样例**：选多样、规范的样例，覆盖关键路径，丢掉冗余的边界情况。

## 长任务的 Token 管理

单个任务跑长了之后，还有三种回收策略：

| 策略 | 做法 | 适用场景 |
|---|---|---|
| Compaction | 总结历史，精简重启 | 对话历史过长 |
| 结构化笔记 | 维护外部 NOTES.md | 需要跨步骤记忆决策 |
| 多 Agent | 拆分子 agent，返回摘要 | 任务复杂度超单 agent 上限 |

---

# 第二重：跨 Session 的连贯性

Token 管理解决了单次推理的质量问题，但长期自主任务往往横跨多个 session——每次新会话 Agent 都以无历史记忆开始。上下文压缩并不够，因为它解决不了「新 Agent 完全不知道前任做了什么」的根本问题。

## 两阶段 Harness

解法是把 harness（容器/框架）设计成可续接的状态机：

**初始化 Agent**（只跑一次）：
- 生成 `init.sh` 确保后续 session 能复现环境
- 创建 `claude-progress.txt` 作为 Agent 间的交接文档
- 执行初始 git commit 建立基线

**编码 Agent**（每个 session 循环执行）：
1. 读取目录结构和 git 日志，理解已完成的工作
2. 读进度日志，找到下一个待处理特性
3. 跑 E2E 测试验证环境
4. 实现单个特性
5. git commit + 更新进度日志

## 关键设计：特性列表初始全部标记为失败

维护一个包含所有特性的 JSON 文件，**所有特性初始状态都是「未完成」**。这个看似悲观的设计有三个好处：

- 为每个新 Agent 提供明确的工作清单
- 防止 Agent 过早宣布「已完成」
- 强制每项特性都要通过验证才能标记通过

## E2E 测试是硬约束

Agent 容易对自己的输出过度乐观——它认为「功能实现了」，但实际上核心逻辑在运行时断裂。只靠单元测试不够，需要 Playwright 等工具做浏览器自动化 E2E 验证，像真实用户一样操作界面。

---

# 第三重：自我评估的乐观偏差

解决了连贯性之后，还有更深的问题：即使 Agent 能稳定地跨 session 工作，**它对自己工作的评价是系统性偏高的**。被要求评估自己时，它会说「很好」，即使人类看来质量平庸。这在主观任务（如前端设计）中尤为明显，在有客观验证的编码任务中也存在。

## 角色分离：Generator + Evaluator

解法是不让 Agent 自我批评，而是拆出独立的 Evaluator：

- **Generator**：专注生成，以 sprint-by-feature 推进
- **Evaluator**：用 Playwright 像真实用户一样测试，根据评分标准打分，任一维度不达标则整个 sprint 失败并反馈详情

独立 Evaluator 仍然是 LLM，天然对 LLM 输出宽松——但关键在于，**调校一个独立评估器比让生成器自我批评容易得多**。评估标准的措辞可以精确控制，偏差来源单一，可以通过读日志、迭代 prompt 来修正。

## 三层架构：Planner + Generator + Evaluator

完整的长期编程 harness 由三个 agent 组成：

**Planner**：接收 1-4 句简述，展开为完整产品规格。刻意约束于可交付物和高层技术设计，不过度指定细节——细节错误会级联到下游。

**Generator**：按规格逐特性实现，使用 React/Vite/FastAPI/SQLite 栈，有 git 版本控制。每轮实现后移交 Evaluator。

**Evaluator**：用 Playwright 主动点击应用，测试 UI、API、数据库，根据四个维度打分：
- 产品深度
- 功能性
- 视觉设计
- 代码质量

关键创新：**Generator 和 Evaluator 在编码前协商 sprint contract**——确定「完成」的定义，弥补高层用户故事和可测试实现之间的鸿沟。

## 随模型演进裁减 Harness

第一版 harness 笨重且昂贵。Anthropic 的策略是：harness 的每一个组件都是对模型能力的一项假设，这些假设会随模型升级过时。

从 Claude 4.5 升级到 4.6 后，sprint 分解变得不必要——4.6 可以连贯处理更长任务，Evaluator 从「每 sprint 评估」改为「末尾单轮通过」，成本大幅下降。

**Evaluator 不是固定决策，而是成本-收益的阈值**：当任务超出当前模型单独可靠完成的范围时才值得引入；随着模型提升，阈值外移。

---

# 核心思想

这三篇文章合在一起，描述的是同一件事：**如何让 Agent 从「能跑」变成「跑稳」**。

三个层次递进但独立：

- **Context Engineering** 解决的是推理时的信号质量——输入什么信息，模型就有什么注意力。这是最基础的层，任何 Agent 都绕不过。
- **Harness 连贯性** 解决的是时间跨度问题——单次推理再好，跨 session 的状态管理不做好，长任务就会在交接处断裂。
- **角色分离** 解决的是自我评估问题——这是最难靠 prompt 解决的，因为它是模型的系统性倾向，不是偶发的错误。

三者有一个共同的底层逻辑：**不要指望一个 Agent 在一次推理中做好所有事**。Token 是有限的，记忆是有限的，自我批评能力是有限的。好的工程不是压榨单个 Agent 的极限，而是设计清晰的职责边界、状态交接、对抗式验证——让系统整体比任何单个部分都更可靠。

这个洞察和软件工程里的「单一职责」「测试驱动」「代码审查」是同构的。不同的是，这里的「模块」是 Agent，「接口」是文件和 prompt，「测试」是 Playwright 驱动的 E2E 验证。形式变了，原则没变。
