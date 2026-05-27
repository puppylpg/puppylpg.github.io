---
title: "扒开 Claude Code 51 万行源码：Harness Engineering 全景"
date: 2026-05-27 13:21:39 +0800
description: "从泄漏的 51 万行 Claude Code 源码出发,拆解四层架构、Tool-Use Loop、System Prompt、记忆系统与上下文压缩等核心 Harness Engineering 实践。"
---

1. Table of Contents, ordered
{:toc}

> 原文:[面试官:"简历写着用过 Claude Code,那源码看过吗?",我怼回去:"没看过,又能怎?"](https://mp.weixin.qq.com/s?__biz=MzUxODAzNDg4NQ==&mid=2247556000&idx=1&sn=01e3a55e22467c677af3e75f9a6d7c62&scene=21&poc_token=HFPWFWqjEUarHcMfjZYjUEsjtOojBSJ4iEW1c3sG)

Claude Code 因为 npm 打包时把 `.map` 文件一起传了上去,51 万行客户端源码全网裸奔。泄漏的是客户端而非 Claude Opus 大模型,但这份代码恰恰是 **Harness Engineering(线束工程)** 的最佳教科书。

所谓 Harness Engineering,就是 AI 圈的最新风向:与其祈求大模型变聪明,不如给这匹野马套上缰绳——80% 的代码不是搞黑科技让 AI 更聪明,而是死磕「可靠性」。

# 一、Claude Code 是什么

Claude Code 是 Anthropic 官方的编程 Agent,直接在终端干活,能读代码、改文件、跑命令、管 Git。它的本质是 AI Agent,需要先和聊天机器人/Copilot 区分开:

- **ChatBot**:一问一答,一次性
- **Copilot**:写代码时补全建议,一次性预测
- **Agent**:「感知-决策-行动」自主循环。给一个目标(「修这个 bug」),它自己决定先读哪个文件、跑什么命令、改哪行代码,可能循环几十轮直到任务完成

循环的关键是**大模型自己决定下一步做什么**,不是按预定义流程图走,而是每次看完上下文后自主判断「读文件」/「执行命令」/「回复用户」。

# 二、四层架构

一个自主编程 Agent 要处理太多事:调 API、执行 40+ 工具、管权限、压上下文、维护记忆、多 Agent 协作。Claude Code 用四层分层架构组织:

- **引擎层(大脑)**:不含任何业务逻辑,只做三件事——协调(把用户输入、系统指令、历史对话拼起来发给模型)、分发(模型说要用工具就找对应工具执行)、决策(根据返回决定继续循环还是结束)。新增能力只需新增工具,引擎层不动。
- **工具层(能力)**:40 多个工具,每个工具遵循统一规范。规范不仅定义「能做什么」,还**强制**定义三个安全属性:是否只读、是否破坏性需要确认、是否可并发。漏一个就编译不过——「每把刀都有刀鞘」。
- **服务层(基础设施)**:跨层共享的水电煤——调大模型 API、上下文压缩、MCP 协议。
- **安全与治理层**:不是分块管,而是横跨所有层的安全网。包括权限系统、Hook 系统(工具前后插自定义行为,如 git push 前跑 lint)、Bash 安全模块(语法级分析检测命令注入、路径逃逸,而不是简单正则匹配)。

# 三、Agent 工作模式:Tool-Use Loop 而非 ReAct

## ReAct 的问题

ReAct(2022 提出) = Thought + Action + Observation 三步循环。模型先输出「思考」文本,再选工具调用,再拿到结果。这个模式在 GPT-3.5 时代很流行,但有三个问题:

1. **Token 浪费**:每轮都输出 Thought 文本,50 轮任务下来好几万 Token 浪费
2. **应用层复杂**:要解析模型输出区分 Thought/Action,格式不标准就崩
3. **为弱模型设计**:Claude Opus 推理能力够强,在内部完成推理即可,无需显式写出每一步

## Tool-Use Loop

Claude Code 用一个简洁得多的 `while(true)` 循环——**没有 Thought 步骤**。模型在内部完成推理(通过 Extended Thinking,不占上下文),直接返回:

- `tool_use`:要用某工具 → 应用层执行 → 拼入消息 → 继续循环
- `end_turn`:说完了 → 跳出循环 → 返回最终结果

`query.ts` 主循环简化版:

```typescript
async function* queryLoop(params, consumedCommandUuids) {
  let state = { messages, toolUseContext, turnCount: 1, ... }
  while (true) {
    // 步骤 1: 压缩上下文(五步从轻到重)
    // 步骤 2: 调大模型 API,流式接收
    for await (const event of streamAPI(params)) {
      yield event
    }
    // 步骤 3: 分析返回
    if (response.stopReason === 'end_turn') break
    // 步骤 4: 执行工具调用(并发/串行编排)
    const toolResults = await executeToolCalls(toolUseMessages)
    // 步骤 5: 更新 state,继续循环
    state = { ...state, messages: updatedMessages, turnCount: turnCount + 1 }
    continue
  }
}
```

## 为什么比 ReAct 好

| 维度 | ReAct | Tool-Use Loop |
| --- | --- | --- |
| 推理方式 | 显式 Thought 文本 | 模型内部 Extended Thinking |
| 工具调用 | 解析文本提取 Action | API 原生 tool_use |
| 终止判断 | 检测「Final Answer」 | API 原生 end_turn |
| Token 开销 | 每轮要输出 Thought | 无额外开销 |
| 编排复杂度 | 高(需解析) | 低(if/else) |
| 适合场景 | 弱模型 + 简单工具 | 强模型 + 复杂工具集 |

设计哲学:**信任模型推理,应用层做到最简**。ReAct 是「帮模型思考」,Tool-Use Loop 是「让模型自己想」。

## Plan Mode

Claude Code 不只有「边想边做」,还有 Plan Mode——「先规划再执行」的两阶段工作流。但它**不是独立框架**,而是同一个 Tool-Use Loop 中通过 `EnterPlanMode` 和 `ExitPlanMode` 两个工具实现:

1. **进入**:模型自主判断复杂任务时调用 `EnterPlanMode`,简单任务(typo、加 log)不进。用户也可 `Shift+Tab` 手动切换。
2. **只读探索**:进入后权限降为只读,只能用 Read/Grep/Glob,不能写文件、改代码、跑命令。计划写入 `.claude/plans/`。每 5 轮对话给模型塞一张「小纸条」提醒它还在 Plan Mode。
3. **审批后实施**:模型调 `ExitPlanMode` 需用户确认,批准后权限恢复,按计划自由实施。

最值得学的是「**工具即能力**」——对模型来说 Plan Mode 不是特殊「模式切换」,只是调了两个工具,引擎层不需要任何特殊处理。

# 四、System Prompt 的构造

System Prompt 是 Claude Code 的灵魂,定义身份、行为规范、工具、安全约束。它不是静态文件,而是动态组装,十几个 Section 拼接而成。

## 角色定义与安全红线

```
你是一个交互式代理(interactive agent),帮助用户完成软件工程任务。
重要:你绝对不能为用户生成或猜测 URL,除非...
```

两个关键点:定位为「interactive agent」而非「assistant」(暗示主动行动);立刻划安全红线(不能瞎编 URL,否则用户执行恶意 npm 包就完了)。

紧接着的安全约束指令很值得抄作业:

```
重要:允许协助已授权的安全测试、防御性安全研究、CTF 挑战赛和教育场景。
拒绝涉及破坏性技术、DoS 攻击、大规模目标扫描、供应链攻击或用于恶意目的的检测规避请求。
```

**先肯定可以做什么,再约束不能做什么**——比纯禁止清单效果好得多。

## 行为准则

- **修改代码前先读**:不要对没读过的代码提修改建议
- **少即是多**:不在用户要求外加功能/重构/「改进」。修 bug 不顺手清理周围代码。三行相似代码比一个过早的抽象更好。不为一次性操作创建辅助函数/工具类/抽象层
- **失败先诊断再换方案**:不盲目重试相同操作,也不一次失败就放弃可行方案

## 操作安全:可逆性 + 影响范围

```
仔细考虑操作的可逆性(reversibility)和影响范围(blast radius)。
高风险操作示例:
- 破坏性:删文件/分支、删表、rm -rf
- 难以逆转:force-push、git reset --hard、修改已发布 commit
- 对他人可见:推送代码、创建/关闭 PR、发消息
- 上传到第三方:可能被缓存索引,删除也无法撤回
```

补一刀:**用户批准一次不代表所有场景都批准,授权仅对指定范围有效**。这解决了「权限蔓延」。

## 工具使用指南

```
- 读文件用 Read,而不是 cat/head/tail/sed
- 编辑文件用 Edit,而不是 sed/awk
- 创建文件用 Write,而不是 echo 重定向
- 搜文件用 Glob,而不是 find/ls
- 搜内容用 Grep,而不是 grep/rg
```

为什么不让用 Bash?**可审查性 + 安全性**。Read 工具会显示「正在读取 src/index.ts」,而 `cat src/index.ts` 用户只看到一坨命令输出。专用工具还有专用权限检查。

## Git 安全协议

```
- 绝不修改 git config
- 绝不执行破坏性命令(push --force, reset --hard, checkout., clean -f)
- 绝不跳过 hooks(--no-verify)
- 绝不 force push 到 main/master
- 关键:始终创建 NEW commit,而不是用 --amend
```

最后一条尤其精妙:很多人 commit 失败后会习惯性 `git commit --amend`。但若失败原因是 pre-commit hook 拒绝,**commit 实际没发生**,`--amend` 会修改上一个不相关 commit 导致代码丢失。Claude Code 直接在 Prompt 防住。

## 输出风格

```
直奔重点。要极度简洁。
工具调用之间的文字不超过 25 个词。最终回复不超过 100 个词。
先给答案/行动而不是推理。跳过填充词、开场白、过渡句。不要复述用户。
```

25 词限制极苛刻——避免 Agent 话痨。

## 环境信息注入

每次对话开始注入当前环境:工作目录、是否 Git 仓库、OS 平台、Shell 类型、模型版本、知识截止日期。让模型知道「自己在哪里」,不会在 macOS 上 `apt-get install`。

## 分割线与三级缓存

System Prompt 中插入 `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 分割标记:

- **分割线之上**:角色定义、安全红线、行为准则、Git 安全协议、输出风格——所有用户完全一样
- **分割线之下**:环境信息、CLAUDE.md、记忆指令、MCP 指令——每个用户不同

为什么这么分?Claude API 的 **Prompt Cache** 机制:Prompt 前缀完全相同时复用计算结果,**费用降 90%**。分割线之上全球共享缓存,分割线之下因人而异。

三级缓存:全局缓存(分割线之上,跨组织共享)→ 组织缓存(同组织内跨会话)→ 会话缓存(一次会话内 Section 只算一次)。

## 三个最值得抄作业的设计

1. **先给范围再画红线**:先说能做什么,再说不能做什么
2. **用可逆性 + 影响范围两维度分层风险**:比笼统「危险/安全」精细得多
3. **静态/动态用分割线隔开**:看似排版调整,背后是实打实成本优化

# 五、记忆系统

每次启动都是全新会话,但用户偏好、项目背景、行为反馈需要跨会话保持。业界常见方案是向量数据库 + embedding 相似度检索,但 Claude Code 没用——因为要记的不是「相似文档片段」,而是「用户说过别 mock 数据库」这种**结构化行为指令**。向量检索这种内容效果很差,会被一堆无关「数据库」关键词淹没。

## 记什么:四类型分类

```typescript
export const MEMORY_TYPES = [
  'user',      // 用户画像:角色、偏好、知识水平
  'feedback',  // 行为反馈:该做/不该做
  'project',   // 项目动态:进展、截止日期、协作信息
  'reference', // 外部指针:哪里能找到什么
] as const
```

只有这四种,不能加新的。**无约束的记忆会膨胀成垃圾堆**,限定四类是逼 Agent 做分类决策。

- **User**:让回答因人而异(后端工程师讲前端用类比)
- **Feedback**(最重要):不仅记规则,还记 **Why** 和 **How to apply**。光记「不要 mock 数据库」不够,边缘情况(纯单元测试)需要根据 Why 判断是否适用
- **Project**:必须把相对日期转绝对日期(「周四」过几天就废了,「2026-03-05」永远准确)
- **Reference**:不需要知道外部系统具体内容,只需要知道去哪找

## 不记什么:排除清单

- 代码模式、项目架构、文件结构(grep/git/CLAUDE.md 能拿到,存了反而不一致)
- Git 历史和最近改动(git log/blame 才是权威)
- 调试方案、修复方法(已经在代码里了)
- CLAUDE.md 已写的内容
- 临时任务状态、当前对话上下文

核心原则:**可以从当前代码推导出来的信息一律不存**。代码是「活的」,记忆是「死的」,存下来就定格,可能变成「权威的错误」。

## 怎么存:索引 + 独立文件

每条记忆是独立 `.md` 文件,frontmatter 是「身份证」:

```yaml
---
name: no-mock-database
description: 集成测试必须使用真实数据库,不能用 mock
type: feedback
---

集成测试必须使用真实数据库,不能用 mock。
**Why:** 上季度 mock 测试全过但生产环境迁移失败了。
**How to apply:** 在这个模块写测试时,始终连真实数据库。
```

`MEMORY.md` 作为索引,**不超过 200 行(25KB)**,同时检查行数和字节数(防止 199 行每行 500 字爆字节)。

关键设计:**MEMORY.md 索引始终加载到 System Prompt,独立记忆按需加载**。两全其美——Agent 看到索引知道有啥,只加载真正相关的几条。

## 怎么召回:Sonnet 当秘书

用廉价小模型(Sonnet)做记忆检索,三步:

1. **扫描头部**:只读每个 `.md` 前 30 行(够提取 frontmatter),不读全文。即使 200 个文件扫描开销也很小
2. **拼清单交给 Sonnet 选**:把头部信息拼成清单,连同用户输入发给 Sonnet,要求选最多 5 条最相关的。Sonnet 只返回**文件名列表**,`max_tokens: 256`
3. **加载选中记忆**:作为 `<system-reminder>` 注入当前对话

**陈旧度检测**:超过 1 天的记忆自动加警告:

```
这条记忆已经有 N 天了。记忆是某个时间点的观察,不是实时状态——
其中关于代码行为或 file:line 引用的断言可能已经过时。
在当作事实引用前,请先对照当前代码验证。
```

避免模型盲目相信 30 天前的 `src/auth.ts:42` 引用。

## 性能:并行预取

记忆召回**不是主模型需要时才触发**,而是用户提交消息后立刻启动,与主模型 API 调用并行。Sonnet 比 Opus 快得多(几百毫秒),主模型响应回来时记忆选择早就完成,几乎零额外延迟。

还有小优化:用户正在用某 MCP 工具时,Sonnet 自动过滤该工具的「使用文档类」记忆(已经在用了,文档是噪声),但保留「该工具的已知 bug 类」记忆(此刻最需要知道坑在哪)。

## 三句话总结

1. **记该记的,不记能推导的**——四类型 + 排除清单
2. **存索引,按需加载详情**——MEMORY.md 常驻,独立文件按需加载
3. **小模型当秘书,大模型做决策**——Sonnet 并行预取,Opus 只管决策

# 六、上下文窗口管理:五步压缩

200K Token 窗口看着大,一次复杂编程任务读几十个文件、跑几十条命令很快塞满。简单截断会丢关键信息(20 轮前的配置文件被砍了,Agent 后面犯低级错误);全量摘要又贵又有信息损失。

Claude Code 核心理念:**压缩一定有信息损失,所以能不压就不压,必须压时从最轻开始**。五步从轻到重,像医院分诊:

## 第 1 步:大结果存磁盘

工具结果进消息列表前先「体检」:

```typescript
async function maybePersistLargeToolResult(toolResultBlock, toolName) {
  const size = contentSize(content)
  if (size <= threshold) return toolResultBlock  // 没超原样通过
  // 超 50KB:完整内容写磁盘,消息里只留 2KB 预览
  const result = await persistToolResult(content, toolUseId)
  const preview = buildLargeToolResultMessage(result)
  return { ...toolResultBlock, content: preview }
}
```

单个工具超 ~50KB 写磁盘,消息留 2KB 预览。还有消息级总量控制:同条消息所有工具结果总和不超 200KB。**完整内容没丢**,模型后续可以再调 Read 读特定行。

## 第 2 步:砍掉远古消息(Snip)

最粗暴最高效——直接把对话开头一批老消息删掉,插入边界标记。**不做摘要,零 API 开销**。

会把「释放了多少 Token」(`snipTokensFreed`)传给第 5 层,避免和 Auto-Compact 重复压缩。

## 第 3 步:裁剪老的工具输出(Micro-Compact)

时间衰减:越老的工具结果越不重要。但不是所有工具都能裁剪:

```typescript
const COMPACTABLE_TOOLS = new Set([
  FILE_READ_TOOL_NAME,    // 读文件 → 可重读
  ...SHELL_TOOL_NAMES,    // 执行命令 → 可重跑
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
])
```

规律:**可裁剪的都是「可重新获取」的工具**。`AgentTool`(子 Agent 输出)、`TaskTool`(任务状态)永远不裁——子 Agent 推理过程不可重复。

策略「保留最近 N 个,清理其余」,被裁剪的替换为 `[Old tool result content cleared]` 标记。

为什么叫「时间衰减」?触发条件跟时间有关——距上次 API 调用超 60 分钟,Prompt Cache 大概率已过期,这时清旧工具结果不浪费缓存投入。

## 第 4 步:读时投影(Context Collapse)

前三层是「写时压缩」,直接改消息列表。Context Collapse 不改原始消息,**只在调 API 那一刻动态算「压缩视图」**:

```typescript
// 这是"读时投影"——不修改 REPL 完整历史,只在发 API 时计算压缩视图
if (feature('CONTEXT_COLLAPSE') && contextCollapse) {
  const collapseResult = await contextCollapse.applyCollapsesIfNeeded(...)
  messagesForQuery = collapseResult.messages
}
```

两级阈值:90% 主动分段压缩旧消息,95% 紧急压缩。

最精妙之处:**Context Collapse 在 Auto-Compact 之前运行**,如果它把上下文压到阈值以下,Auto-Compact 就不触发。模型保留更多细节,而不是被粗糙摘要替代。

## 第 5 步:全量摘要(Auto-Compact)

代价最高也最强,前四层不够时才触发。阈值公式:

```typescript
function getAutoCompactThreshold(model) {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  return effectiveContextWindow - 13_000  // 有效窗口 - 13K 缓冲
}
```

200K 模型:有效窗口 180K(留 20K 给输出)- 13K = 167K 触发。

三步:

1. **生成摘要**:精心设计的 Prompt 要求模型按多维度总结——用户主要请求和意图、关键技术概念、涉及文件和代码片段、错误和修复、问题解决过程、用户**所有**消息(不能漏)、待完成任务、当前工作状态、建议下一步。漏一条「用户还有待完成任务」模型就忘了
2. **替换旧消息**:压缩边界前所有消息删掉换成摘要,插入边界标记记录压缩前 Token 数
3. **Post-Compact Restoration**(最关键):压缩后主动恢复重要上下文

```typescript
export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5
export const POST_COMPACT_TOKEN_BUDGET = 50_000
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
```

从 `fileStateCache` 找最近访问的文件按时间排序,挑最多 5 个总共不超 50K Token 重新注入。同时恢复活跃 Skill(不超 25K),进行中的 Plan 也恢复。

为什么恢复?压缩后模型「失忆」,不恢复模型第一反应就是「让我重读文件」白白浪费一轮。

**熔断器**:全量摘要连续失败 3 次自动放弃,防止失败的压缩拖垮 Agent。

## 五步对比

| 层级 | 手段 | 信息损失 | API 开销 | 触发条件 |
| --- | --- | --- | --- | --- |
| 第 1 层 | 大结果存磁盘 | 几乎为零 | 零 | 工具结果超 50KB |
| 第 2 层 | 砍远古消息 | 低 | 零 | 消息过时 |
| 第 3 层 | 清老工具输出 | 中低 | 零 | 缓存过期/数量超限 |
| 第 4 层 | 读时投影压缩 | 中 | 低 | 上下文达 90% |
| 第 5 层 | 全量摘要 | 高 | 高(一次 API 调用) | 上下文达 ~93% |

设计哲学:**能轻则轻,逐步加码**。大部分场景前三层够用,完全无需额外 API 调用。各层互相协调:Snip 告诉 Auto-Compact 「我已释放 N Token」,Context Collapse 在 Auto-Compact 前运行——**每层都在为下一层减负**。

# 写在最后

51 万行源码里没有什么黑科技,每件事单拎出来都不算什么——五步压缩、四类型记忆、System Prompt 设计……但**全串在一起,就是一套能把野马驯成耕牛的缰绳系统**。

启发:做 Agent 别老盯着模型发呆。模型是发动机,但车能不能安全上路靠的是刹车、方向盘、安全带。这些「不起眼」的工程实践,才是真正决定成败的。
