---
title: "【Anthropic】AI Agent 的上下文工程：让有限的 token 更高效"
date: 2026-06-05 01:26:52 +0800
categories: [ai, prompt-engineering]
tags: [context-engineering, prompt-engineering, llm-agents, token-optimization]
description: "Anthropic 工程博客：在 LLM 推理中优化 token 资源配置，通过系统提示、工具设计、样例选择和长时任务策略提升 agent 性能"
---

1. Table of Contents, ordered
{:toc}

> 原文：[Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

## 从 Prompt Engineering 到 Context Engineering

传统的 prompt engineering 关注单个提示词的编写。但随着 AI agent 从单轮对话演进到多轮任务执行，问题的焦点发生了变化：不是「如何写一个好提示」，而是「在整个推理过程中，什么配置的上下文最有可能产生我们想要的行为」。

Context engineering 就是这样一个更宽泛的概念——在 LLM 推理阶段，精心策划和维护最优的 token 集合。这个集合涵盖系统指令、工具定义、外部数据、对话历史等所有成分。

## Context Rot：有限的"注意力预算"

Transformer 架构的每个 token 对都维持 n² 的两两关系（pairwise attention）。这意味着随着上下文长度增加，模型经历所谓的「context rot」——准确度下降。

简单讲：每多一个 token，就在用掉有限的「注意力预算」。当上下文变长时，这个预算被拉扯得越来越薄，模型在关键信息上的专注力随之衰减。

## 核心原则：最小的高信号 Token 集合

Context engineering 的黄金法则是：**找到最小的、高信号密度的 token 组合，使其最大化目标行为的可能性**。

这个原则贯穿以下几个维度：

### 系统提示设计

系统提示不应该是"僵硬到处处是规则"也不应该"模糊到只有启发式建议"。要在具体性和灵活性之间找平衡：

- 用清晰的结构（XML 标签或 Markdown 分节）组织指令
- 明确 agent 的目标和约束
- 提供足够的上下文让 agent 自主决策，而不是规定每一步

### 工具设计最小化

工具集应该是精心挑选的，而不是囊括所有可能：

- 避免功能重叠。如果一个工具和另一个做的事情太接近，agent 会困惑
- 参数描述必须清晰。工程师应该能一眼看出「在这个情景下应该用哪个工具」；如果工程师都看不清，agent 也不会好到哪里去
- 工具的粒度要合适。太细会爆炸上下文，太粗会失去灵活性

### 样例选择策略

不要堆砌所有边界情况。而要选择**多样、规范的样例**：

- 覆盖关键的路径和决策点
- 样例之间差异大，让 agent 学到泛化模式
- 丢掉那些冗余或过度特化的边界情况

## 长时任务的三大策略

Agent 在执行长链路任务时容易吃光 token 预算。有三种方法缓解：

### 1. Compaction（压缩）

当对话历史接近上下文上限时：

- 总结关键的架构决策和思路
- 丢掉冗余的中间输出
- 用更紧凑的格式重启上下文

这样既保留了 agent 需要的"脑子里"的东西，也释放了 token 空间。

### 2. 结构化笔记（Structured Note-Taking）

Agent 维护一个持久的外部记忆（比如 NOTES.md 文件）：

- 记录重要的决定、进度、架构细节
- 在需要时查询而非依赖上下文中的历史
- 让 agent 的"长期记忆"不受 token 窗口限制

### 3. 多 Agent 架构（Sub-agent Architecture）

任务复杂到无法一个 agent 完成时，拆分成多个专精的子 agent：

- 每个子 agent 专注某个具体领域，上下文简洁
- 返回精炼的摘要而不是完整输出
- 主 agent 汇聚各子 agent 的结果，保持全局视图

## 渐进的哲学

Anthropic 的观点是：**随着模型能力提升，需要的工程会越来越少，但对 token 的重视永远不会过时**。

这不是说「以后就不用 context engineering 了」，而是说：

- 模型本身更强，对 prompt 的细节优化需求会降低
- 但 context 作为有限资源的属性不会改变
- 把 context 当宝贵资源的意识需要贯穿始终

## 实践要点

- **测度信号质量**：不是 token 越多越好，而是高信号密度
- **迭代和验证**：改一个系统提示、加一个例子、调整工具集，逐步观察效果
- **权衡灵活性和确定性**：过度规定会让 agent 僵化，过度模糊会让 agent 迷茫
- **为长时任务规划**：设计阶段就考虑 token 的消耗和回收机制

# 核心思想

Context engineering 本质上是一种**资源管理思维**的迁移——把我们对 CPU、内存的管理直觉，搬到 token 上来。

软件工程里有一条古老的法则：premature optimization is the root of all evil，但它的前提是资源充裕。当资源有限时，节约就不是过早优化，而是基本设计原则。token 窗口就是这样一种硬性约束：不管模型上下文窗口扩展到多大，attention 的 n² 代价决定了"塞满"永远是下策。

更值得关注的一点是：这篇文章用"注意力预算"这个比喻，暗示了一个更深的问题——**模型的注意力不是均匀分布的**。你塞进去的每一个 token，都在和其他 token 竞争模型的"关注"。低质量的 token 不只是浪费空间，它还在稀释高质量信息的权重。这意味着"删减"有时比"补充"更能提升 agent 的表现。

这对工程师的启示是：设计 agent 系统时，最重要的问题不是"我能给模型什么信息"，而是"我应该拿走什么信息"。
