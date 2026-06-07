---
title: "【Anthropic】Claude Code 中的 Skills：从内部实践中汲取的经验"
date: 2026-06-08 01:01:08 +0800
categories: [ai, claude-code]
tags: [claude-code, skills, agent, ai-native, development]
description: "Anthropic 团队总结了内部数百个 Skills 的使用经验：9 大类别、编写技巧与分布式管理，完整介绍如何设计高效 Skills 加速开发"
---

1. Table of Contents, ordered
{:toc}

> 原文：[Lessons from building Claude Code: How we use skills](https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills)

# 什么是 Skills

很多人以为 Skills 只是一些 markdown 文件，但其实它们是包含指令、脚本和资源的完整文件夹，agent 可以发现并调用这些资源来更准确、高效地完成任务。Claude Code 中的 Skills 还支持丰富的配置选项，比如注册动态 hooks。那些效果最好的 Skills，往往都充分利用了这些配置和文件夹结构。

# 9 大类别

Anthropic 团队把内部数百个 Skills 归了类，发现它们自然落入了 9 个类别。好的 Skill 通常边界清晰，归属于单一类别；而那些试图跨越多个类别的 Skill 反而容易让 agent 困惑。这份分类不是穷举，但对识别自己 Skills 库中的空白很有帮助。

## 1. 库和 API 参考

教 Claude 如何正确使用某个库、CLI 或 SDK。既可以是内部库，也可以是 Claude 容易踩坑的常见库。这类 Skill 通常附带一组参考代码片段和一份常见陷阱清单。

- `billing-lib`：内部计费库的边界情况和易踩坑点
- `internal-platform-cli`：每个子命令的用法和使用时机
- `sandbox-proxy`：组织的出站网关配置——哪些主机可达、怎么排查连接错误、如何加白名单

## 2. 产品验证

描述如何测试或验证代码是否按预期工作，通常会配合 Playwright、tmux 等外部工具。**这类 Skill 对输出质量的提升最为显著**，值得花一周时间让工程师精心打磨。可以尝试让 Claude 录制测试视频以观察它的操作，或在每一步加入程序化断言——这些都可以通过 Skill 内的脚本实现。

- `signup-flow-driver`：在无头浏览器中跑完注册→邮箱验证→onboarding 全流程，每一步都有状态断言
- `checkout-verifier`：用 Stripe 测试卡驱动结账 UI，验证发票落入正确状态
- `tmux-cli-driver`：测试需要 TTY 的交互式 CLI

## 3. 数据获取与分析

连接数据和监控体系。可能包含带凭证的数据获取脚本、特定仪表板 ID，以及常见查询方式的说明。

- `funnel-query`：signup→activation→paid 各阶段需要哪些 event 联接、包含规范 user_id 的实际表
- `cohort-compare`：比较两个队列的留存或转化，标注统计显著差异，链接到分群定义
- `grafana`：数据源 UID、集群名、问题→仪表板映射表
- `datadog`：字段参考（`@request_id` vs `trace_id`）、服务列表、metric 前缀约定

## 4. 业务流程与团队自动化

把重复性工作流自动化成一条命令。指令本身可能很简单，但对其他 Skills 或 MCP 的依赖可能比较复杂。在日志文件中保存前期结果，能帮助模型保持一致性，也能让它回顾前几步的执行情况。

- `standup-post`：聚合 ticket 系统和 GitHub 活动，格式化为 standup，只输出增量
- `create-<ticket-system>-ticket`：强制校验 schema（有效枚举值、必填字段），创建后触发后续流程（通知 reviewer、发 Slack）
- `weekly-recap`：合并 PR + 关闭的 ticket + 部署记录 → 格式化周报

## 5. 代码脚手架与模板

为代码库中的特定结构生成样板代码。可以和可组合的脚本配合使用。当脚手架需要自然语言判断、不能纯靠代码覆盖时，这类 Skill 特别有用。

- `new-<framework>-workflow`：用你的注解脚手架出新的 service/workflow/handler
- `new-migration`：migration 文件模板加常见陷阱
- `create-app`：新内部应用，认证、日志和部署配置都预置好

## 6. 代码质量与评审

在组织内强制代码质量标准、辅助代码评审。可以包含确定性脚本或高鲁棒性的工具链，适合作为 hooks 或 GitHub Action 的一部分自动运行。

- `adversarial-review`：派出一个全新视角的子 agent 进行批评、实施修复、反复迭代直到发现降级为细节问题
- `code-style`：强制代码风格，特别是 Claude 默认处理不好的部分
- `testing-practices`：如何写测试、测试什么的说明

## 7. CI/CD 与部署

帮助获取、推送和部署代码。这类 Skill 可能引用其他 Skill 来收集数据。

- `babysit-pr`：监控 PR → 重试不稳定的 CI → 解决合并冲突 → 启用自动合并
- `deploy-<service>`：构建 → 冒烟测试 → 逐步放量并与错误率对比 → 出问题自动回滚
- `cherry-pick-prod`：隔离 worktree → cherry-pick → 解决冲突 → 用模板创建 PR

## 8. 运行手册（Runbooks）

接收一个症状（Slack 消息、告警、错误签名），跨多个工具排查，最后生成结构化报告。

- `<service>-debugging`：症状→工具→查询模式的映射（针对最高流量服务）
- `oncall-runner`：拿到告警 → 检查常见疑点 → 格式化发现日志
- `log-correlator`：给定 request ID，从每个可能接触过它的系统拉取匹配日志

## 9. 基础设施运维

执行日常维护和运维操作，其中一些涉及破坏性操作，需要保护措施。这类 Skill 让工程师更容易在关键运维中遵循最佳实践。

- `<resource>-orphans`：查找孤立 pod/volume → 发到 Slack → 等待观察期 → 用户确认 → 级联清理
- `dependency-management`：你组织的依赖审批工作流
- `cost-investigation`："为什么存储/出站账单飙升"，带上具体的 bucket 和查询方式

# 编写 Skills 的最佳实践

决定做一个 Skill 后，怎么写好它？以下是 Claude Code 团队总结的实践和技巧。

## 不要说显而易见的事

Claude 已经会写代码，也能读你的代码库。一个只是重复 Claude 默认行为的 Skill 只会增加上下文开销，而不会带来价值。如果你的 Skill 主要是知识型的，要聚焦那些能把 Claude 推出常规思维模式的信息。

前端设计 Skill 就是很好的例子——Anthropic 的一位工程师通过与客户反复迭代，让 Claude 的设计品味跳出"Inter 字体 + 紫色渐变"的经典套路。

## 写好"易踩坑"（Gotchas）部分

任何 Skill 中信号最强的内容就是 Gotchas 部分。它应该从 Claude 使用你的 Skill 时遇到的真实失败点中逐步积累——随着 Claude 碰到新的边界情况，不断更新你的 Skill。

几个例子：

- "subscriptions 表是追加式的。你要的行是版本最高的那一行，不是 `created_at` 最近的那一行。"
- "这个字段在 API gateway 里叫 `@request_id`，在计费服务里叫 `trace_id`。它们是同一个值。"
- "Staging 环境在 Stripe webhook 没有真正处理时也返回 200。检查 `payment_events` 才能获得真实状态。"

## 用文件系统做渐进式信息披露

SKILL.md 指向 Claude 可以在特定情况下参考的其他几个文件——比如某个任务卡住时，它应该去看 `stuck-jobs.md`。

前面说过，Skill 是一个文件夹，不是单个 markdown 文件。你应该把整个文件系统当作上下文工程和渐进式信息披露的手段。告诉 Claude 你 Skill 里有哪些文件，它会在合适的时候去读。

最简单的形式是指向其他 markdown 文件供 Claude 参考，比如把详细的函数签名和使用示例拆到 `references/api.md`。如果你最终要输出一个 markdown 文件，可以在 `assets/` 中放一个模板让 Claude 复制使用。你还可以有参考文档、脚本、示例等子文件夹，这些都有助于 Claude 更高效地工作。

## 不要把指令写得太死

Claude 通常会尽力遵守你的指令，而 Skills 又是可复用的，所以要注意别把指令写得太死板（railroading）。给 Claude 需要的信息，但也留出适应具体情况的灵活性。

比如，一个好的 Skill 应该在 Slack 频道未配置时主动询问用户，而不是硬编码。

## 想好设置流程

有些 Skill 需要从用户那里获取上下文信息。比如你做了一个发送 standup 到 Slack 的 Skill，可能想让 Claude 询问发送到哪个频道。

一个好的模式是把设置信息存在 Skill 目录下的 `config.json` 中。如果配置未设置，agent 就去问用户。如果你想让 agent 提出结构化的多选问题，可以指示 Claude 使用 `AskUserQuestion` 工具。

## 描述写给模型看，不是写给人看

Claude Code 启动会话时，会构建一份所有可用 Skills 及其描述的列表。Claude 扫描这份列表来决定"这个请求应该触发哪个 Skill？"——所以描述字段不是摘要，而是**触发条件的说明**。

在描述中包含触发关键词很有帮助，比如 babysit Skill 的描述里加上"babysit"。

## 帮 Claude 记住过去

一个简单的文本日志文件就能帮 Claude 记住过去的事件，比如"评审了 Sarah 的认证 PR"。

有些 Skill 可以在自身目录中存储数据来实现记忆——简单到追加式文本日志或 JSON 文件，复杂到 SQLite 数据库都行。比如 `standup-post` Skill 可以保留一个 `standups.log`，记录它写过的每一篇 post。下次运行时，Claude 读自己的历史，就能告诉用户相比昨天发生了什么变化。

存储数据时可以用环境变量 `${CLAUDE_PLUGIN_DATA}` 获取一个稳定的目录，详见 [Persisting data in skills](https://code.claude.com/docs/en/plugins-reference#persistent-data-directory)。

## 存脚本、生成代码

你能给 Claude 的最强大的工具之一是代码。给它脚本和库，让它把思考周期花在编排上——决定下一步做什么——而不是重构样板代码。

比如在你的数据科学 Skill 中，可以放一个从事件源获取数据的函数库，再给一组辅助函数。Claude 就能即时组合这些功能做更高级的分析，回答"星期二发生了什么？"这类问题。

## 用按需 Hooks

Skills 可以包含仅在调用该 Skill 时激活、只在当前会话持续的 hooks。这适合那些限制较严格、你不希望一直开着、但有时极其有用的 hooks（on-demand hooks）。

- `/careful`：通过 PreToolUse matcher 在 Bash 中阻止 `rm -rf`、`DROP TABLE`、force-push、`kubectl delete`。只在触碰生产环境时才开启——一直开着会让人崩溃。
- `/freeze`：阻止任何不在特定目录中的 Edit/Write。调试时很有用："我想加点日志但老是不小心'修'了不相关的代码。"

# 分布式 Skills

Skills 最大的好处之一是可以和团队分享。两种方式：

1. **检入仓库**：放在 `./.claude/skills` 下，适合在较少仓库中工作的较小团队。
2. **制作 Plugin**：发布到 Claude Code Plugin marketplace，让别人自行安装，详见[文档](https://code.claude.com/docs/en/plugins-reference)。

检入仓库的方式简单直接，但每个 Skill 都会给模型上下文增加一点开销。当规模增长后，内部 plugin marketplace 让团队自主选择安装哪些 Skill，同时包含设置流程。

## 管理 Skills 市场

如何决定哪些 Skills 进入市场？人们如何提交？

在 Anthropic，没有中央团队做决策——而是有机地浮现最有用的 Skills。如果有人想让别人试试自己的 Skill，可以上传到 GitHub 的一个沙箱文件夹并在 Slack 等论坛分享。一旦获得关注度（由 Skill 所有者判断），就可以提 PR 将其移入市场。

## 组合 Skills

你可能想要有依赖关系的 Skills——比如一个上传文件的 Skill，以及一个制作 CSV 并上传的 Skill。目前市场和 Skills 内还没有原生的依赖管理，但你可以按名称引用其他 Skills，如果它们已安装，model 就会调用它们。

# 测量 Skills

为了理解一个 Skill 的表现如何，团队用 PreToolUse hook 来记录公司内部的 Skill 使用情况，从而发现受欢迎的 Skills 或相比预期触发不足的 Skills。

---

# 核心

三个最关键的洞察：

1. **分类让复杂度可控**：9 个类别让每个 Skill 职责单一、边界清晰，agent 触发更精准。试图跨多个类别的"万能 Skill"反而会让 agent 困惑。

2. **上下文工程 > 详细指令**：最高效的 Skills 靠的不是啰嗦的指令，而是文件夹结构、易踩坑点（Gotchas）、示例代码和可复用脚本。本质是"给工具而非说教"——让 Claude 把精力放在编排上，而不是重构样板。

3. **验证 Skills 投资回报最高**：Anthropic 团队明确指出产品验证类 Skills 对输出质量提升最为显著。这意味着 AI agent 时代的质量保证正在演变——不再是事后测试，而是内置到 agent 工作流中的持续验证。

---

# 评价

**优点：**

- 分类框架切实可行。9 个类别覆盖了工程团队的大多数常见需求，从代码生成到监控运维。分类本身就是一种教育。
- 最佳实践务实且具体。"易踩坑（Gotchas）部分""渐进式信息披露""为模型写描述而非为人"这些原则都有具体例子支撑，不是空话。
- 承认 Skills 的演进性。最好的 Skill 都是从几行文字和一个 gotcha 开始的，随着 Claude 碰到新边界情况不断完善——这符合真实工程实践。

**不足：**

- **缺少成本分析**。文章提到"每个检入的 Skill 都会给模型上下文增加一点开销"，但没有量化这个成本，也没有给出权衡建议。在超大规模团队中这可能是关键约束。
- **市场治理偏乐观**。"有机浮现"和"由所有者决定何时升级"依赖人的自律。现实中可能出现重复 Skill、陈旧 Skill 堆积、版本管理混乱等问题，文章没有涉及。
- **跨 Skill 编排欠缺**。虽然提到可以"按名称引用其他 Skills"，但没有讨论依赖管理、版本兼容、失败恢复等编排复杂性。
- **安全和权限模糊**。第 9 类涉及"破坏性操作"和"保护措施"，但没解释如何确保只有授权人员能触发，或如何防止误用。
- **测量指标不清晰**。只提到用 PreToolUse hook 记录使用情况，但没定义什么叫"有用"或"触发不足"——点击率？完成率？用户满意度？

**隐含假设：**

- 默认 Skills 是内部共享的。对 IP 敏感的团队（金融、医疗），分享内部 Skills 的边界需要更多讨论。
- 假设 Claude model 足够稳定，Skill 设计可以相对长期有效。如果 model 能力快速演变，之前整理的易踩坑点和渐进式信息披露可能很快过时。

**总体评价：**

这是一篇精良的实战指南。Anthropic 团队将数月内部积累浓缩成了可操作的框架，9 大类别和"为模型编写"的原则尤其值得行业学习。但作为面向生产环境的最佳实践，它在成本管理、市场治理和安全审计等企业级关切上还不够深入。