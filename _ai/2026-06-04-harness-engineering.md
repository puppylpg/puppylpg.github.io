---
title: "Harness Engineering：AI Agent 从能跑到跑稳的第三道关"
date: 2026-06-04 10:00:00 +0800
categories: [ai, agent]
tags: [harness engineering, prompt engineering, context engineering, llm, agent]
description: "从 Prompt Engineering 到 Context Engineering 再到 Harness Engineering，讲清楚让 Agent 持续稳定交付的完整工程框架及六层核心组件"
---

1. Table of Contents, ordered
{:toc}

> 原文：[鹅厂面试官："你怎么看 Harness Engineering？" 我："就是给大模型套缰绳" 他拍桌：终于有人说明白了](https://mp.weixin.qq.com/s?__biz=MzUxODAzNDg4NQ==&mid=2247556454&idx=1&sn=ad92c367b10877933f4556d0aceb497c&scene=21)

# 三个概念的演进脉络

AI 工程的重心过去两年换了三次，每次都是被上一代撞到天花板逼出来的：

| 阶段 | 解决的问题 |
|---|---|
| Prompt Engineering | 怎么让模型「听懂」你想干啥 |
| Context Engineering | 怎么让模型「知道」该用什么信息 |
| Harness Engineering | 怎么让模型在真实执行里「持续做对」一连串的事 |

三者是**层层包含**关系，不是替代关系。Prompt 是 Context 的子集，Context 是 Harness 的子集。

## Prompt Engineering：塑造概率空间

大模型本质是一个对上下文极度敏感的概率生成器——根据输入预测下一个字最有可能是什么。提示词的作用是把它的输出概率空间往目标方向推。

一份完整提示词通常包含：角色设定、背景信息、参考资料、明确任务、约束条件、输出格式。

**局限**：只解决「表达」问题，不能补充模型不知道的知识，也无法管理动态变化的信息。

## Context Engineering：动态管理输入

Agent 火了之后，模型要做多轮对话、调工具、跨步骤传中间结果，光靠提示词远不够。模型需要知道：当前文档、历史记录、规范文件、中间结论、收件人偏好……这一整坨才叫完整的「任务环境」。

核心三步：

1. **召回**：用 RAG 等手段，从大量资料里找出当前任务最相关的那部分
2. **压缩**：对过长内容做摘要，对历史对话做 rolling summary，只保留关键
3. **组装**：按顺序和格式拼装——重要指令放靠后（模型对靠后信息更敏感）

**关键认知**：上下文不是「塞得越多越好」，而是**按需给、分层给、在正确时机给**。Anthropic 的 Agent Skills 用「渐进式披露」——先给目录，等模型真的需要某工具再动态加载详细说明。

**局限**：还停留在「输入侧」——信息供给对了，但模型在长链路任务里还是会跑偏、失焦、忘了初衷。

## Harness Engineering：驾驭整个运行过程

Harness（马具/缰绳）的比喻很贴切：马有力量，马具让这股力量为你所用。等价公式：

```
Agent = Model + Harness
Harness = Agent − Model
```

除了模型本身，几乎所有决定 Agent 能否稳定交付的东西都属于 Harness。

这个词由基础设施老将 Mitchell Hashimoto 在 2026 年 2 月的博客《My AI Adoption Journey》中首先叫响，随后 OpenAI 发文介绍内部一个 3 人小组用 5 个月靠 Agent 写出 100 万行代码的实践，概念随即被推上风口。

Mitchell 的核心理念：**每次 Agent 犯错，花时间把修复工程化到环境里，让它永远不会再犯同样的错误**。这是复利——环境变强 → Agent 犯错变少 → 改进更快。

# Harness 的六层核心组件

可以按「干什么」分成三组：

- **输入侧**：上下文精细化管理 + 记忆与状态管理
- **动作侧**：工具系统 + 任务执行编排
- **校验侧**：评估观测 + 约束恢复

| 层 | 解决的问题 |
|---|---|
| 上下文精细化 | 模型这一轮该看到什么？ |
| 工具系统 | 模型用什么动手？ |
| 执行编排 | 模型下一步该干啥？ |
| 记忆与状态 | 模型跨轮该记住什么？ |
| 评估与观测 | 模型做得好不好有没有尺子？ |
| 约束与恢复 | 模型出错了能不能爬起来？ |

以下用一个贯穿全程的例子说明：一个 **PR Review Agent**，每天扫 GitHub 关注仓库的新 PR，挑出值得关注的，生成摘要，发到 Slack。

## 第一层：上下文精细化管理

区分时空：
- 第一层管「空间」——这一轮发给模型的那一坨上下文长啥样
- 第四层管「时间」——上一轮的状态怎么流动到下一轮

PR Review Agent 真正需要的是精选信息（PR 标题描述、改动文件、对应模块说明、作者提交风格、code review 惯例），而不是把整个 diff 全扔进去。信息越多注意力越散——Anthropic 称之为「context rot（上下文腐化）」，解法是 just-in-time retrieval（边干活边按需抓）。

三件核心工作：
1. **把角色和目标钉死**：Agent 是什么、当前任务是什么、成功标准是什么
2. **动态筛选而不是一次塞满**：只拉当前 PR 相关信息，其余留在文件系统
3. **结构化组织**：固定规则 / 动态证据 / 中间结论三者分开，防止「自我污染」

## 第二层：工具系统的可控调用

没有工具，大模型只是文本预测器。但工具不是越多越好——OpenAI 早期 Codex 给太多工具，Agent 频繁用错，砍掉一大半反而效果上升。

三个问题：
- **给哪些工具**：PR Review Agent 需要 `gh` CLI、读文件、代码搜索、Slack 发送，其余先不加
- **什么时候用哪个**：该查再查，上下文里已有的不重复拉
- **工具结果怎么喂回**：搜出 30 条不是全塞，要先提炼出关键条再注入

MCP（Model Context Protocol）本质上是工具层的标准化，让任何工具都能用同一种方式接入任何 Agent。

## 第三层：任务执行的全局编排

Agent 的本质是 for 循环：**思考 → 行动 → 观察结果 → 再思考**，即 ReAct（Reasoning + Acting）。

问题在于每一步会做，串起来就跑偏。PR Review Agent 需要明确的工作轨道：

```
1. 拉取所有开放 PR 列表
2. 对每个 PR：
   a. 读 diff 和描述
   b. 判断是否涉及核心模块
   c. 核心模块做深度分析
   d. 给出重要性打分（1-5）
3. 按重要性排序，选前 3 个
4. 为每个生成摘要和点评
5. 汇总发到 Slack
6. 检查发送是否成功，失败则重试
```

其他常见编排模式：Plan-and-Execute（先规划再执行，适合长链路）、Reflexion（失败后反思再重试）、Tree of Thoughts（同时探索多条思路再选最优）。

## 第四层：记忆与状态的分层管理

没有状态管理的 Agent 每轮都失忆。三类状态生命周期完全不同，必须分层存：

| 类型 | 存储位置 | 生命周期 |
|---|---|---|
| 任务状态（今天处理到哪个 PR、各打分） | `today-progress.json` | 任务结束归档 |
| 会话中间结果（当前轮初步判断） | 上下文内 | 当轮结束丢弃 |
| 长期记忆和用户偏好（关注什么类型 PR） | `user-preferences.md` | 跨任务常驻 |

CLAUDE.md / `.cursorrules` 就是「长期记忆」的典型实现——每次调用自动注入，Agent 永远「记得」项目核心约束。

## 第五层：独立的评估与观测体系

最容易被跳过、跳过后进退两难的一层。

**Eval 集（核心）**：手写一批典型任务 + 标注正确答案，每次改动 Harness 后都跑一遍对比成功率。PR Review Agent 可以从过去 3 个月挑 20 个真实 PR，每个标注「是否重要」「摘要应该怎么写」。没有 Eval 集，对 Agent 好坏的判断永远停留在「感觉还行」的玄学阶段。

LangChain 把 Terminal Bench 成绩从 52.8 推到 66.5、从榜单 30 名外冲进前 5，靠的就是基于 Eval 集的 trace 回放迭代。

**Trace + 日志 + 指标**：记录 Agent 每步决策、调了哪个工具、拿到什么返回、花了多少 token。LangSmith、Langfuse 等工具让调试从「猜」变成「看」。

## 第六层：约束校验与失败恢复

生产环境里失败是常态，不是例外。

三件事：
1. **约束**：定义 Agent 不能做什么（最多分析 20 个 PR、不能对 closed PR 评论、token 超 10 万立刻停）。约束要硬编码进代码或 linter 规则，而不是靠提示词让 Agent 自己遵守
2. **校验**：每步输出前后做自动检查（摘要格式对不对？Slack 频道在白名单里吗？）
3. **恢复**：每种典型失败都有预案（GitHub 限流 → 等待重试；Slack 失败 → 落到本地队列；token 快耗光 → 保存进度下轮继续）

# 五个大厂踩过的典型坑

## 难题一：Agent 跑久了为什么越走越偏？

**现象**：Cognition（做 Devin 的公司）发现了「上下文焦虑」（Context Anxiety）——当模型感知到窗口快满时，开始着急收尾、简化方案、跳过验证、提前宣布完成。而且模型对自己「剩余上下文」的估计非常不准。

**解法**：Anthropic 明确指出光做上下文压缩不够，焦虑感依然存在。真正的解是 **Context Reset**——整个丢掉旧上下文窗口，换一个干净的接手。

具体做法：Agent 维护 `claude-progress.txt` + `init.sh` + 完整 git history 作为「长期记忆介质」。每一新轮从文件系统读取进度，面对干净的上下文窗口继续。这和程序内存泄漏的处理思路一致：不压缩内存，直接重启进程，从磁盘恢复状态。

> **原则一：重启胜过修补，状态沉到文件里，Agent 随时可以在干净的上下文窗口里接力。**

## 难题二：让 Agent 自己给自己打分，为什么总偏乐观？

**现象**：Agent 做完事再让它自评，在没有标准答案的任务上会自动忽略做得不好的部分，系统性地给自己打高分。

**解法**：Anthropic 在 Agent 架构里实施三角分工：
- **Planner**：把模糊需求扩展成完整规格
- **Generator**：一步步实现
- **Evaluator**：像 QA 一样真实操作页面、看交互、检查运行结果（必须有真实环境托底，不能只看代码）

> **原则二：生产和验收必须分离，验收方必须能摸到真实世界。**

## 难题三：Agent 总是失败，工程师该干啥？

**现象**：本能反应是调提示词或换更强模型，但这两招都是错方向。

**OpenAI Codex 实践**：人类工程师几乎不写代码，专注三件事：
1. 把产品目标拆解成 Agent 能力边界内的小任务
2. Agent 反复失败时，不是催它「再努力」，而是看「环境里缺了什么能力」然后补进去
3. 建立反馈链路，让 Agent 能看到自己工作的结果

旧思路：遇到 bug 加提示词「请仔细检查不要有 bug」，祈祷模型听话。  
新思路：给 Agent 接上 lint、单测、运行环境，让它自己写完自己跑，看见 bug 自己改。

> **原则三：Agent 反复失败时，别问模型能不能更努力，要问环境还缺什么。**

## 难题四：规范文件越写越长，Agent 反而更糊涂？

**现象**：OpenAI 早期把所有规范塞进一个超大 AGENTS.md，认为规则越全越好。结果模型注意力被严重稀释，更糊涂。

**解法**：把 AGENTS.md 从「百科全书」改成「目录页」——**主文件只保留约 100 行核心索引**，详细内容拆到具体子文档（架构文档、设计原则、产品规格、执行计划、质量评分），Agent 按需钻入。

这是渐进式披露（Progressive Disclosure）——和软件设计里的「懒加载」一脉相承。如果你的 CLAUDE.md 或 `.cursorrules` 已经「百科全书化」了，赶紧拆。

> **原则四：规则文件宁缺毋滥，给模型看的东西少即是多。**

## 难题五：Agent 写的代码越堆越烂，技术债怎么还？

**现象**：Agent 会疯狂模仿仓库里已有的代码模式——好的被复制，坏的也被复制，越堆越歪，即「AI slop（AI 代码泔水）」。OpenAI 一开始每周拿出整个周五让工程师手工清理，结果 Agent 产出速度远超人工清理速度，彻底失败。

**解法**两步：
1. 把资深工程师关于「什么是好代码」的经验写成 **Golden Principles**（黄金原则），比如「优先用共享工具包而不是手写 helper」，显式沉进仓库
2. 后台 Agent 按固定节奏自动扫描仓库、对比 Golden Principles、开修复 PR，大部分可以 1 分钟内审完 auto merge

> 技术债就像高利息贷款，几乎永远应该每天小额还一点，而不是攒着等某天集中还。

> **原则五：技术债不是攒一堆集中还，而是每天让后台 Agent 自动偿还一点。**

## 附：Agent 用「老技术」反而更稳

OpenAI 发现，Agent 对那些被人称为「boring」的老技术掌握得最好——组合性好、API 稳定、训练数据里出现频率高。新框架文档少，AI 容易张冠李戴。有时甚至宁愿让 Agent 自己实现一个小工具函数，也不引入不熟悉的 npm 包，因为自己写的代码 Agent 能 100% 理解和控制。

# 总结

```
Agent = Model + Harness
```

模型决定 Agent 的天花板，Harness 决定它能不能落地、能不能稳定交付。同样的模型，不同产品效果差距很大，差的往往是 Harness。

五条原则口诀：**重启胜过修补，生产验收分家，与其催模型不如改环境，规则宁缺毋滥，技术债天天还。**

未来工程师的主战场不是「一天能写多少行代码」，而是「能为 Agent 设计多好的一套运行环境」。

# 参考资料

1. Mitchell Hashimoto，[My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey)
2. OpenAI，[Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
3. Anthropic，[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
4. Anthropic，[Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
5. Anthropic，[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
6. LangChain，[Improving Deep Agents with harness engineering](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/)
7. Cognition，[Rebuilding Devin for Claude Sonnet 4.5: Lessons and Challenges](https://cognition.ai/blog/devin-sonnet-4-5-lessons-and-challenges)
