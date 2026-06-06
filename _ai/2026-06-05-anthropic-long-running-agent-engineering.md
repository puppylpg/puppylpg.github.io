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
> - [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
> - [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
> - [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)

# 从单轮对话到长期自主：三个挑战

AI Agent 从「回答一个问题」演进到「完成一项工程任务」，遇到了三个性质不同的挑战：

1. **注意力稀释**：Transformer 架构中每个 token 需要关注所有其他 token，上下文越长，注意力越分散，关键信息的权重被稀释——这就是「context rot」现象。
2. **跨 session 失忆**：每次新会话都是一张白纸，Agent 不知道上一班发生了什么。上下文压缩并不够，因为它解决不了「新 Agent 完全不知道前任做了什么」的根本问题。
3. **自我评估偏差**：让 Agent 评价自己的工作，它会系统性地过度乐观。被要求评估自己时，它会说「很好」，即使人类看来质量平庸。这在缺少客观验证的设计、代码质量等领域都存在。

Anthropic 的三篇工程博客分别对应这三个挑战，而且彼此是递进的——前一个是基础，后一个是在此基础上解决更深的问题。

---

# 第一重：Context Engineering——管理有限的注意力

## Context rot 与注意力预算

Transformer 的 attention 是 O(n²) 的。随着上下文增长，模型注意力被分散到越来越多的 token 上，关键信息的权重被稀释。

更反直觉的是：**低质量的 token 不只是浪费空间，它们在主动竞争模型的注意力**。堆砌内容有时反而让 Agent 更差。

Context engineering 的黄金法则：**找到最小的、高信号密度的 token 组合**。

## 有效上下文的四个组件

### 系统提示

系统提示需要在「过度规定」和「过度模糊」之间找平衡。用 XML 标签或 Markdown 分节组织，给目标和约束，让 Agent 自主决策，而不是规定每一步。

错误的两个极端：
- 硬编码逻辑：用复杂的 if-else 规划 Agent 的每一步行为。这造成脆弱性，难以维护。
- 模糊指令：给高层目标但缺少具体信号，模型无法理解到底要做什么。

### 工具集

工具是 Agent 与信息/操作空间之间的契约。工具设计要：
- 功能清晰，JSON 参数描述性强，工程师一眼知道该用哪个。
- 功能不重叠，避免决策歧义。
- 输出信息 token 高效，工具返回精炼的摘要而非原始数据。
- 错误处理健壮，一个工具失败不影响 Agent 继续运行。

### 样例

样例是 LLM 的「图片」——好过千言。但不要堆砌边界情况，而是选择**多样、规范的样例**，覆盖关键路径即可。堆砌冗余样例会吃掉宝贵的 token 而不增加信号。

### 消息历史

消息历史的精炼与动态检索。传统做法是预计算并塞入所有相关数据，但现代更接近**「just-in-time」检索**：

- 维护文件路径、存储查询、链接等轻量级标识符
- 用 git 历史作为压缩的语义索引
- 运行时通过 Bash 命令如 head/tail/grep 按需加载数据

这模仿人类工作记忆的模式：不背诵整个语料库，而是建立外部组织系统（如文件系统、索引、书签），按需检索相关信息。

## 长时任务的上下文管理

单个任务跑长了之后，还有三种回收策略：

### 压缩（Compaction）

将长对话精炼为摘要，然后基于摘要重启新的上下文窗口。关键在于选择保留什么与丢弃什么。过激进会丢失关键细节，过保守又压缩不够。

工具结果清理是最轻量的压缩形式——一旦工具调用在历史深处完成，后续 Agent 无需再看到原始输出。

### 结构化笔记

Agent 定期将笔记写入外部记忆（如 NOTES.md），后续按需拉回上下文。这提供了**持久的记忆，最小开销**。

Claude Code 的任务列表、Claude playing Pokémon 的训练进度表，都是这种模式。笔记支持跨 session 的连贯决策，让 Agent 在数小时的持续工作中保持战略一致。

### 子 Agent 架构

主 Agent 做高层规划，子 Agent 执行深度技术工作或用工具搜索信息，返回压缩摘要（通常 1,000-2,000 token）。这实现了清晰的职责分离——主 Agent 专注综合结果，子 Agent 的搜索上下文隔离在局部。

| 策略 | 做法 | 适用场景 |
|---|---|---|
| 压缩 | 总结历史，精简重启 | 对话历史过长 |
| 结构化笔记 | 维护外部 NOTES.md | 需要跨步骤记忆决策 |
| 多 Agent | 拆分子 agent，返回摘要 | 任务复杂度超单 agent 上限 |

---

# 第二重：Harness 连贯性——跨 Session 的状态管理

Token 管理解决了单次推理的质量问题，但长期自主任务往往横跨多个 session。

## 两阶段 Harness

解法是把 harness（容器/框架）设计成可续接的状态机：

### 初始化 Agent（只跑一次）

- 生成 `init.sh` 确保后续 session 能复现环境
- 创建 `claude-progress.txt` 作为 Agent 间的交接文档
- 执行初始 git commit 建立基线

初始化 Agent 的核心任务是将用户简述扩展为完整的产品规格，聚焦于**交付物和高层技术设计**，不过度指定细节——细节错误会级联到下游。

### 编码 Agent（每个 session 循环执行）

1. 读取目录结构和 git 日志，理解已完成的工作
2. 读进度日志，找到下一个待处理特性
3. 跑 E2E 测试验证环境
4. 实现单个特性（React/Vite/FastAPI/SQLite 栈，有 git 版本控制）
5. git commit + 更新进度日志

每个 session 结束前，编码 Agent 必须清理环境状态——代码有序且文档充分，下一位工程师可以在没有先清理无关混乱的情况下开始新特性。

## 关键设计：特性列表初始全部标记为失败

维护一个包含所有特性的 JSON 文件，**所有特性初始状态都是「未完成」**。这个看似悲观的设计有三个好处：

- 为每个新 Agent 提供明确的工作清单
- 防止 Agent 过早宣布「已完成」
- 强制每项特性都要通过验证才能标记通过

基于 claude.ai 克隆的经验，初始化 Agent 生成了包含 200+ 个特性的列表，每项都写得详细步骤，并通过 `passes: false` 标记失败。这防止了 Agent 试图「一次性完成项目」。

## E2E 测试是硬约束

Agent 容易对自己的输出过度乐观——它认为「功能实现了」，但实际上核心逻辑在运行时断裂。只靠单元测试不够，需要 Playwright 等工具做浏览器自动化 E2E 验证，像真实用户一样操作界面。

给 Agent 提供 Puppeteer MCP、Playwright 等浏览器自动化工具后，它能：
- 截图并验证 UI 功能
- 检测浏览器原生 alert modals
- 像人类用户一样点击流程
- 识别无法从代码本身看出的 bug

| 问题 | 初始化 Agent 解法 | 编码 Agent 解法 |
|---|---|---|
| Claude 一次性宣布项目完成 | 设置特性列表文件：基于输入规格，结构化 JSON 包含端到端功能描述 |
| Claude 留下带 bug 或未文档进度 | 初始 git 仓库和进度笔记文件 |
| Claude 过早标记功能为完成 | 设置特性列表文件 | 每个 session 只修改状态字段，强词禁「覆盖或删除测试」 |
| Claude 浅表测试但没有 E2E 验证 | 编写 init.sh 启动开发服务器 | 每个 session 开始先运行基础 E2E 测试 |

---

# 第三重：角色分离——通过对抗验证解决自我评估偏差

解决了连贯性之后，还有更深的问题：即使 Agent 能稳定地跨 session 工作，**它对自己工作的评价是系统性偏高的**。

## 角色：Generator + Evaluator

解法是让 Agent 自我批评，而是拆出独立的 Evaluator：

- **Generator**：专注生成，以 sprint-by-feature 推进
- **Evaluator**：用 Playwright 像真实用户一样测试，根据评分标准打分，任一维度不达标则整个 sprint 失败并反馈详情

独立 Evaluator 仍然是 LLM，天然对 LLM 输出宽松——但关键在于，**调校一个独立评估器比让生成器自我批评容易得多**。评估标准的措辞可以精确控制，偏差来源单一，可以通过读日志、迭代 prompt 来修正。

## 项目级三 Agent 架构：Planner + Generator + Evaluator

完整的长期编程 harness 由三个 agent 组成：

### Planner

接收 1-4 句简述，展开为完整产品规格。刻意约束于可交付物和高层技术设计，**让 Agent 自己发现实现路径**。这避免了过早指定细节导致的错误级联。

Planner 还可以利用 AI 特有功能将设计能力、Agent 集成等自然编织入规格。

### Generator

按规格逐特性实现，使用 React/Vite/FastAPI/SQLite 栈，有 git 版本控制。每个实现后必须自我评估才移交 Evaluator。

### Evaluator

用 Playwright 主动点击应用，测试 UI、API、数据库，根据四个维度打分：

- **产品深度**：规格要求的功能是否完整实现
- **功能性**：用户能否理解界面、找到主要操作、完成任务
- **视觉设计**：设计质量、原创性、工艺质量、功能独立于美感
- **代码质量**：（隐含）代码整洁度、架构合理性

每个维度都有明确的评分标准（而非模糊的「好不好」），任一维度达不到阈值，sprint 失败并向 Generator 反馈具体问题。

## Sprint contract：弥合高屋用户故事与可测试实现之间的鸿沟

关键创新：**Generator 和 Evaluator 在编码前协商 sprint contract**——确定「完成」的定义。这弥补了高层用户故事和可测试实现之间的鸿沟。

例如，对于游戏精灵编辑器：
- Generator 提议：「实现通过选填充创建矩形区域的功能」
- Evaluator 评审：「'fill'工具只在拖动起始点放置瓦片，未触发 mouseUp 事件」——这不符向用户实际工作流。

两者协商后，Generator 才开始编码。这确保了实现方向正确，避免无效工作。

## 随模型演进裁减 Harness

第一版 harness 笨重且昂贵。Anthropic 的策略是：harness 的每一个组件都是对模型能力的一项假设，这些假设会随模型升级过时。

从 Claude 4.5 升级到 4.6 后，sprint 分解变得不必要——4.6 可以连贯处理更长任务，Evaluator 从「每 sprint 评估」改为「末尾单轮通过」，成本大幅下降。

| 版本 | Harness 变化 | 原因 |
|---|---|---|
| Claude 4.5 | 需要 per-sprint 评估、sprint contract、context reset | 模型 context 焦虑、长任务连贯性差 |
| Claude 4.6 | 删除 sprint construct、evaluator 单次通过 | 模型长上下文能力强、自我判断更准 |

从 4.5 到 4.6 的升级，其他变化还包括：
- **长上下文检索能力提升**：不再需要复杂的 prompt engineering
- **自我评估更可靠**：Evaluator 可以在无每轮监督下判断基本质量

**Evaluator 不是固定决策，而是成本-收益的阈值**：当任务超出当前模型单独可靠完成的范围时才值得引入；随着模型提升，阈值外移。

---

# 核心

这三篇文章合在一起，描述的是同一件事：**如何让 Agent 从「能跑」变成「跑稳」**。

三个层次递进但独立：

- **Context Engineering** 解决的是推理时的信号质量——找到最小高信号密度的 token 组合，避免注意力稀释。这是最基础的层，任何 Agent 都绕不过。
- **Harness 连贯性** 解决的是时间跨度问题——设计可续接的状态机（初始化 Agent + 编码 Agent），通过结构化交接文档和 git 历史让 Agent 跨 session 协同工作。
- **角色分离** 解决的是自我评估问题——这是最难靠 prompt 解决的，因为它是模型的系统性倾向。通过引入独立的 Evaluator，将设计质量、功能完整性、视觉美学等转化为可评分的客观标准，形成对抗式验证循环。

三者有一个共同的底层逻辑：**不要指望一个 Agent 在一次推理中做好所有事**。Token 是有限的，记忆是有限的，自我批评能力是有限的。好的工程不是压榨单个 Agent 的极限，而是设计清晰的职责边界（Planner/Generator/Evaluator）、状态交接（progress files、git）、对抗式验证（Generator vs. Evaluator）——让系统整体比任何单个部分都更可靠。

这个洞察和软件工程里的「单一职责」「测试驱动」「代码审查」是同构的。不同的是，这里的「模块」是 Agent，「接口」是文件和 prompt，「测试」是 Evaluator 驱动的 E2E 验证。形式变了，原则没变。

---

# 评价

## 说得好的地方

**层次递进的论述框架**——三篇文章正好对应 Agent 能力递进的三个维度（单次推理质量、跨 session 连贯性、自我评估可靠性），逻辑清晰，读者可以逐层理解并应用到自己的场景。

**可操作的工程实践**——不是空谈理论，而是给出了具体可复制的设计模式：
- 文件名约定（`init.sh`、`claude-progress.txt`、`features.json`）
- JSON vs Markdown 的选择
- E2E 测试工具（Playwright、Puppeteer MCP）
- Sprint contract 协商机制

**Engineering measurement 数据**——harness V2 版本有详细的统计数据（Planner 4.7 min/$0.46、Builder 各轮时间与成本），这让评估变得可量化和可比，不是「感觉跑得好就够」。

**诚实的技术局限**——明确承认了 Evaluator 的盲点（见不到浏览器原生 modals、难以测试深层嵌套功能），以及 Generator 自己判断的边界（4.5 vs 4.6 的能力差异）。不自夸大模型能力。

**演进思维**——强调 harness 是可裁减的，每个组件都应被质疑并随模型升级逐步移除。这避免了「一次构建永久维护」的债务。

## 问题与未说到的

**Harnes V2 成本过高**——6 小时 200 美元、$124 总成本，远超单人开发成本。虽然比「20 分钟 solo run 得到的东西好 20 倍」，但实践中是否值得？对于大多数团队，harnes 的开发调试成本可能超过了从零手写代码。文章没有深入讨论 ROI 平衡点（什么项目值得 vs 不值得）。

**Evaluator 标准的主观性**——虽然论文称「将主观判断转化为可评分标准」，但四个维度中，「视觉设计」本身就需要主观判断。代码可以用 linter/test runner 自动评估，但美感、原创性仍需要人类定义偏好并调校。这意味orkr 需要持续与 Evaluator 对齐，否则它给的方向可能符合它自己的审美但不符向你的。

**多 Agent vs 单 Agent 的成本不明确**——V2 改进了「单 Agent 就够」的任务，但耗时稍有增加。这意味着 harnes 成本的增减优化（去除 planner/evaluator）应该基于**具体任务特征去衡量**，而不是一刀切。例如简单任务可能就不值得三 agent 开销，复杂任务则值得。

**未涉及现实世界的工程约束**——文章聚焦于「Agent + 现年代码库」的理想场景。实际产品开发还有：遗留代码库(debt)、团队协作（多个 Agent 同时修改可能冲突）、产品迭代（需求中途变化）、用户反馈循环、部署与监控等。这套 harnes 如何与 CI/CD、代码审查、用户测试等现有工程体系集成，没有讨论。

**Harnes 开销本身**——三篇原文是工程经验总结，但没有说明这套 harnes 本身维护成本是多少。如果发现模式变了或模型升级导致行为退化，团队需要投入多少工程师去调校 prompt、增加评分标准、更新 contract 模板？这是拥抱 harnes 架构的隐性成本。文章称「组件都应被质疑」，但这质疑本身的时间精力投入没有量化。

**Planner 的质量保证**——Planner 从 1-4 句扩展到 16-feature spec 仍然可能幻觉或过度承诺（如「AI 辅助的精灵生成器」——最后并未实现）。如果 Planner 的输出质量不可靠，整个 pipeline 在源头上就 parasite。这个问题可以通过「先用 cheap model 生成，再用强模型审核」缓解，但会增加成本排队。

**Generator 和 Evaluator 的良心调料**——文中提到 Generator 在某次迭代后「意识到之前的迭代更好」，暗示模型有长期偏好记忆或 personal taste。这意味ork 可能需要给更明确的指令来对抗这种「审美惯性」，否则 Evaluator 不断给反馈但 Generator 还是回到自己喜欢的样子。

## 总评

三篇文章的价值在于**给出了一个从「能跑」到「跑稳」的完整工程路径**，填补了「Agent 可以做复杂任务」到「工程上可靠交付」之间的鸿沟。特别是角色分离（Generator vs. Evaluator）和 Sprint Contract 机制，是将 AI 工程从「游戏」推向「实践」的关键一步。

但读者需要清醒的两点是：

1. **Harnes V2 成本高昂**——对于非 AI 原生团队（e.g. 创业公司、AI 初创公司）可以接受，但传统软件团队可能需要衡量投入产出比。
2. **Harnes 本身需要持续维护**——当你拥抱(prompt)。这些不是写一次就完了，而是需要像产品一样迭代。

如果只记住了「三 Agent 架构很帅」，而忽视了这些隐性成本，可能会在实践中踩坑。Harnes 的价值在于规模化与可复用，但只有在你愿意付维护代价时，它才真正划算。