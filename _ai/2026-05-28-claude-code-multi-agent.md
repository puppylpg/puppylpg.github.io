---
title: "Claude Code 多 Agent 机制：隔离、通信与并发的源码解析"
date: 2026-05-28 10:00:00 +0800
categories: [ai, agent]
tags: [claude code, multi-agent, subagent, coordinator, fork, llm]
description: "从 Claude Code 源码视角，解析多 Agent 的工具隔离、上下文隔离、父子通信（消息队列+XML）、Fork 缓存复用和 Coordinator 并行协调五大机制。"
---

1. Table of Contents, ordered
{:toc}

> 原文：[面试官皱眉："你知道 Claude Code 多Agent实现机制吗？" 我："何止知道？我还看过源码"，他愣了…](https://mp.weixin.qq.com/s?__biz=MzUxODAzNDg4NQ==&mid=2247557309&idx=1&sn=db872d9df4336797d2c364b5c4e4e880&scene=21&poc_token=HJk9GGqjLt3zqujpkMs8F3LuxWWF4DYU30Feil8-)

# 为什么需要 Multi-Agent

单 agent 面对复杂任务有三个硬伤：

1. **上下文爆炸**：多阶段任务把大量内容塞进同一上下文，token 迅速耗尽。
2. **职责混乱**：一个 agent 身兼研究员、程序员、评审员，容易跑偏。
3. **无法并发**：一次只能做一件事，各阶段串行等待。

Multi-Agent 的核心思想类似"老板带团队"：把任务拆给多个职责清晰的 agent，每个 agent 上下文干净、职责单一，多个 agent 可以同时开工。

## 三种常见形态

- **父子型**：主 agent 遇到子问题时派 subagent，拿结果后继续。Claude Code 的 Task 工具是这种。
- **平级协作型**：职责对等，通过共享状态互相协作。工程上较难落地。
- **主从型（Coordinator-Worker）**：协调者不干活，只派 worker、收结果、做合成。高并发场景标配。

Claude Code 实现了三套机制：**常规 Subagent**（父子型）、**Fork Subagent**（父子型的缓存优化版）、**Coordinator 模式**（主从型）。

# 一、Subagent 的隔离机制

## 工具隔离：三道准入门

主 agent 拥有几十个工具，但不能原封不动地给 subagent。Claude Code 按"agent 身份"过三道门：

**第一道：全局黑名单（所有 subagent 适用）**
- 能派新 subagent 的工具 → 防止子派孙、孙派重孙的递归嵌套
- 能主动问用户的工具 → 子 agent 不该抢主 agent 的对话权
- 能切换规划模式的工具 → 规划模式是主 agent 专属
- 能停止其他任务的工具 → 任务管理权归主线程

**第二道：自定义 agent 加严黑名单**
用户自定义的 agent（非官方内置）比内置 agent 再严一层。

**第三道：后台异步 agent 用白名单**
后台 agent 默认不准用，只有显式列出的工具（读文件、搜代码、执行命令、编辑文件）才能用。白名单比黑名单更保险。

```typescript
// src/tools/AgentTool/agentToolUtils.ts:70
export function filterToolsForAgent({ tools, isBuiltIn, isAsync, permissionMode }): Tools {
  return tools.filter(tool => {
    if (tool.name.startsWith('mcp__')) return true  // MCP 工具全放行
    if (ALL_AGENT_DISALLOWED_TOOLS.has(tool.name)) return false
    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(tool.name)) return false
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(tool.name)) return false
    return true
  })
}
```

## 上下文隔离：按字段粒度决策

父 agent 有庞大的运行时上下文（文件缓存、UI 状态、中止信号、任务注册表等）。

- **完全共享**：子 agent 读文件会污染父 agent 的文件视图缓存。
- **完全新建**：父 agent 广播中止信号，子 agent 收不到，自顾自继续跑。

Claude Code 的解法：**不按整体决策，而是按字段决策**。

| 决策 | 方案 | 原因 |
|---|---|---|
| 读文件缓存 | 克隆一份给子 | 子读文件不污染父的视图 |
| 写全局 UI 状态 | 设为空操作 | 防止父子并发改同一状态导致界面错乱 |
| 注册后台任务的通路 | 例外保留 | 不然子 agent 起的后台进程变成无人回收的孤儿进程 |
| agent ID 和深度 | 独立 ID + 深度 +1 | 可追踪，超过阈值（如 5 层）报警或强制停止 |

```typescript
// src/utils/forkedAgent.ts:345
export function createSubagentContext(parentContext, overrides): ToolUseContext {
  return {
    readFileState: cloneFileStateCache(parentContext.readFileState), // 决策一：克隆
    setAppState: () => {},                                           // 决策二：空操作
    setAppStateForTasks: parentContext.setAppStateForTasks ?? parentContext.setAppState, // 决策三：保留通路
    agentId: overrides?.agentId ?? createAgentId(),
    queryTracking: {
      chainId: randomUUID(),
      depth: (parentContext.queryTracking?.depth ?? -1) + 1,        // 决策四：深度 +1
    },
  }
}
```

# 二、父子 Agent 的通信机制

## 为什么不用函数调用

直觉上"父 agent 调函数等 subagent 返回"有两个致命问题：
- subagent 跑 5 分钟，父 agent 同步阻塞，用户无法交互。
- 要同时派 5 个并发 subagent，手动搓并发代码复杂混乱。

Claude Code 的解法：**消息驱动**。每个 subagent 有自己的"信箱"，父 agent 往里扔消息走人不等，subagent 自己来取。

## 子 agent 的"员工档案"

每个 subagent 在全局 task 表里有一份档案：

```typescript
// src/tasks/LocalAgentTask/LocalAgentTask.tsx:116
export type LocalAgentTaskState = TaskStateBase & {
  type: 'local_agent';
  agentId: string;
  status: TaskStatus;          // pending/running/completed/failed/killed
  result?: AgentToolResult;
  pendingMessages: string[];   // 信箱：父 agent 扔进来的待处理消息
  messages?: Message[];
};
```

`pendingMessages` 就是信箱。

## 父 → 子：扔字条

父 agent 调 `SendMessage` 工具，往目标 subagent 的 `pendingMessages` 末尾追加消息后立刻返回，不等子处理。

子 agent 在自己 agentic loop 的每轮工具调用结束后，读取信箱中的新消息，作为"用户消息"注入对话历史，进入下一轮 LLM 调用。

**唤醒机制**：如果子 agent 已完成（`completed`），父 agent 发 `SendMessage` 会自动从磁盘 transcript 恢复完整对话历史，拼上新消息重新跑起来。

```typescript
// src/tools/SendMessageTool/SendMessageTool.ts:800
if (task.status === 'running') {
  queuePendingMessage(agentId, input.message, context.setAppStateForTasks)
  return { data: { success: true, message: 'Message queued...' } }
}
// 已停止 → 自动唤醒
const result = await resumeAgentBackground({ agentId, prompt: input.message, ... })
```

## 子 → 父：XML 伪装成用户消息

子 agent 完成后，不走"工具返回结果"事件，而是把完成通知拼成 XML，**伪装成一条用户消息**注入父 agent 对话历史：

```xml
<task-notification>
  <task-id>agent-a1b</task-id>
  <output-file>/tmp/xxx.txt</output-file>
  <status>completed</status>
  <summary>Agent "Investigate auth bug" completed</summary>
  <result>Found null pointer in src/auth/validate.ts:42...</result>
  <usage>
    <total_tokens>12345</total_tokens>
    <tool_uses>8</tool_uses>
    <duration_ms>34567</duration_ms>
  </usage>
</task-notification>
```

**为什么用 XML 而不是结构化对象？**
1. LLM 对 XML 天然友好，Anthropic 训练 Claude 时强化了这一点。
2. 纯文本可以直接塞进对话历史，无需额外的"工具结果"字段结构。
3. 伪装成用户消息，天然复用 agentic loop 的处理逻辑，父 agent 不需要额外状态机"等通知"。

## 自动后台化（auto-background）

subagent 启动后，若 30 秒内完成，父 agent 前台阻塞等待，像普通工具调用。若超过 **2 分钟**还未完成，Claude Code 自动将其转到后台，父 agent 可继续处理其他事情，最终通过 `task-notification` 拿到结果。

```typescript
// src/tools/AgentTool/AgentTool.tsx:72
function getAutoBackgroundMs(): number {
  if (isEnvTruthy(process.env.CLAUDE_AUTO_BACKGROUND_TASKS) ...) {
    return 120_000;  // 2 分钟
  }
  return 0;
}
```

# 三、Fork Subagent：缓存复用降低成本

## 问题背景

Claude Code 的 system prompt 超过 **1 万 token**（工具说明、规范约定、用户上下文）。每派一个有独立 system prompt 的 subagent，LLM API 都要重新算这一万多 token——既花钱又增加首 token 延迟。

Anthropic 的 prompt 缓存机制可以缓解：请求前缀与之前完全相同时，走缓存，成本降至原来的 **10%**，延迟大幅降低。但命中条件极严：**字节级完全相同**，一个字节不对就没命中。

## Fork 的核心思路

派一个子 agent，但它的 API 请求前缀与父 agent **字节级完全一致**，从而复用父 agent 已有的缓存。

必须与父 agent 严格对齐的五项：

1. 系统 prompt 内容
2. 用户上下文（动态拼接在消息前的部分）
3. 系统上下文（拼接在 system prompt 后的环境信息）
4. 工具池的顺序和定义（会被序列化进 API 请求）
5. 对话历史的前缀（决定从哪里"分叉"）

```typescript
// src/utils/forkedAgent.ts:57
export type CacheSafeParams = {
  systemPrompt: SystemPrompt       // 必须与父完全一致
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext    // 工具池等
  forkContextMessages: Message[]   // 父 agent 消息前缀
}
```

## 关键细节：system prompt 不重新生成

Fork subagent 的 `getSystemPrompt` 直接返回空字符串，而是直接使用父 agent **已渲染好的字节**：

```typescript
// src/tools/AgentTool/forkSubagent.ts:60
export const FORK_AGENT = {
  agentType: FORK_SUBAGENT_TYPE,
  tools: ['*'],           // 用父的完整工具池
  model: 'inherit',
  permissionMode: 'bubble',
  getSystemPrompt: () => '', // 不重新生成，直接复用父的已渲染字节
}
```

重新调生成函数可能因某个动态字段差异导致一字节不同，缓存即失效。最稳的办法是原样拿父 agent 已渲染的字节。

## 适用场景与互斥约束

- **适合**：需要完整继承父 agent 上下文、"派分身试另一条路"的场景（如生成 PR 描述、post-turn 总结）。
- **不适合**：有明确专业分工的 subagent（搜代码专用 agent、规划专用 agent），它们有定制 system prompt。
- **与 Coordinator 模式互斥**：Coordinator 下 worker 本就是异步的，不需要 Fork 的轻量分身机制。

```typescript
// src/tools/AgentTool/forkSubagent.ts:32
export function isForkSubagentEnabled(): boolean {
  if (feature('FORK_SUBAGENT')) {
    if (isCoordinatorMode()) return false  // 互斥
    if (getIsNonInteractiveSession()) return false
    return true
  }
  return false
}
```

# 四、Coordinator 模式：真正的并行协作

## 启用条件

需同时满足：编译时功能开关 + 运行时环境变量 `CLAUDE_CODE_COORDINATOR_MODE=1`。

## 主 agent 退化为纯协调者

Coordinator 模式下，主 agent 的 system prompt 明确约束其角色：

> You are a **coordinator**. Your job is to direct workers to research, implement and verify code changes, synthesize results and communicate with the user.

主 agent 只做三件事：**派 worker、收结果、合成答案**。

## 协调者专属工具箱

```typescript
// src/coordinator/coordinatorMode.ts:29
const INTERNAL_WORKER_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,       // 创建 worker 团队
  TEAM_DELETE_TOOL_NAME,       // 解散团队
  SEND_MESSAGE_TOOL_NAME,      // 给 worker 发消息
  SYNTHETIC_OUTPUT_TOOL_NAME,  // 合成最终输出给用户
])
```

Worker 无法使用这些工具——收回"派人权"，防止系统变成失控的递归树。

## 并行是超能力

Coordinator 模式的 prompt 明确写道：

> **Parallelism is your superpower.** Workers are async. Launch independent workers concurrently whenever possible, don't serialize work that can run simultaneously.

协调者在**同一条 assistant 消息**里生成多个派 worker 的工具调用，底层并发执行：

```
派 worker 调研 auth 模块
派 worker 调研 session 模块
派 worker 调研 token 模块
```

三个 worker 同时开工，协调者等通知陆续返回。对比串行方案，耗时从 3× 降至约 1×。

## 任务流水线

| 阶段 | 执行者 | 目的 |
|---|---|---|
| 调研 | Workers（并行） | 调查代码库、找文件、理解问题 |
| 合成 | 协调者本人 | 读完发现、理解问题、写实现规格 |
| 实现 | Workers | 按规格做具体修改 |
| 验证 | Workers（新 worker） | 测试改动是否真的工作 |

**合成阶段协调者必须亲自做**，不能转发给 worker "based on your findings, implement the fix"——协调者不是传话筒，必须理解中间结果再做决策。

## Continue vs Spawn：老 worker 还是新 worker

- 新任务与 worker 现有上下文高度相关 → 续命老 worker（沟通成本低，它已"知道"那些文件）。
- 新任务与现有上下文无关，或 worker 之前跑偏 → 派新 worker（避免旧上下文干扰）。
- 验证工作 → 永远派新 worker（需要"新鲜眼光"，不能让刚写完代码的 worker 自己验自己）。

## 与常规 subagent 对比

| 维度 | 常规 subagent | Coordinator 模式 |
|---|---|---|
| 主 agent 角色 | 全能选手 | 纯协调者 |
| subagent 执行 | 同步（2 分钟后转后台） | 默认异步 |
| 并发程度 | 偶尔并发 | 最大化并发 |
| 适合场景 | 单个任务 + 临时帮手 | 大任务 + 高并发拆解 |
| 系统形态 | 父子树 | 协调者 + worker 扁平层 |

# 五、Multi-Agent 设计原则总结

**原则 1：上下文隔离按字段粒度做**
对父 agent 每项状态问：子 agent 拿这个状态干啥？会不会影响父？克隆、关掉、保留、新建，每项单独决策。

**原则 2：通信走消息，不走函数调用**
父→子写消息队列，子→父用 XML 伪装成用户消息。天然异步、天然并发、天然兼容 agentic loop、天然可落盘。

**原则 3：工具权限分级管控**
全局黑名单（防递归）、类型黑名单（自定义 agent 加严）、异步白名单（后台 agent 最严）。

**原则 4：缓存友好是架构能力**
设计 subagent 时考虑 prompt 前缀能否复用父 agent 缓存。Fork 机制在缓存友好场景下可将 subagent 成本降至原来的 10%，成本优化本身就是能力边界的扩展。

**原则 5：并行优先 + 协调者合成**
异步消息队列做并发基础，协调者做合成而非转发。避免"大 agent 大循环自己扛一切"的窘境。
