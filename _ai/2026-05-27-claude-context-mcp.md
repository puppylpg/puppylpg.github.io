---
title: Claude Context — 给 Claude Code 加上 RAG 检索，减少 40% Token 消耗
date: 2026-05-27 01:31:00 +0800
---

1. Table of Contents, ordered
{:toc}

> 原文：[主流AI IDE的token成本爆炸？试试登上GitHub日榜的Claude Context！](https://mp.weixin.qq.com/s/tUzyz4qH2KaBz1GMgjE3-A)

# 背景：纯 grep 方案的三大问题

Claude Code 使用 grep 检索代码，但存在三大问题：

| 问题 | 说明 |
|------|------|
| **信息过载** | grep 搜索结果中 99% 为无关噪音，AI 易被洪流淹没 |
| **语义盲目** | 仅匹配字符组合，无法理解代码功能，找不到 `compute_final_cost()` 与 `calculate_total_price()` 的语义关联 |
| **上下文失忆** | 仅返回匹配行，缺失函数所属类、依赖关系等关键上下文 |

**实际案例**：让 Claude Code 帮找 bug，反复使用 grep + read，5 分钟后才定位到问题文件，但读取的代码中只有 10 行相关，99% 都是无关代码。

---

# Claude Context 解决方案

Claude Context 是一个开源的 MCP 工具，集成了向量数据库和 embedding 模型，让 Claude Code 获得更精准的代码检索能力。

**GitHub**：https://github.com/zilliztech/claude-context

## 核心突破

| 痛点 | 解决方案 |
|------|----------|
| 信息过载 | 向量相似度排序，最相关的代码片段置顶 |
| 语义盲目 | 基于 embedding 理解代码语义，函数名不同但功能相似也能匹配 |
| 上下文失忆 | 每个搜索结果包含完整的代码上下文（类、函数、依赖） |

---

# 技术架构

## 技术选型

| 组件 | 选择 | 原因 |
|------|------|------|
| **接口** | MCP | LLM 与外界交互的 USB，可被 Claude Code、Gemini CLI 等复用 |
| **向量数据库** | Zilliz Cloud | 全托管 Milvus，高性能、低延迟、弹性扩展 |
| **Embedding** | OpenAI / Voyage / Ollama | 多种选择，Voyage 在 Code 领域效果更好 |
| **编程语言** | TypeScript | 兼容 VSCode 插件等上层应用，生态友好 |

## 架构设计

两层架构：
- **核心模块**：代码解析、向量化索引、语义检索、同步更新
- **上层模块**：MCP 集成、VSCode 插件等应用层逻辑

---

# 核心问题解决

## 问题一：代码怎么切？

### 主策略：AST 抽象语法树切分

通过解析器理解代码语法结构，按照语义单元切分：

- **语法完整性**：每个 chunk 都是完整的语法单元，不会函数被切成两半
- **逻辑连贯性**：相关代码逻辑保持在同一个 chunk
- **多语言支持**：不同语言使用不同的 tree-sitter parser

### 兜底策略：LangChain 文本切分

对于 AST 无法处理的语言，用 RecursiveCharacterTextSplitter：

```javascript
const splitter = RecursiveCharacterTextSplitter.fromLanguage(language, {
  chunkSize: 1000,
  chunkOverlap: 200,
});
```

## 问题二：代码变动怎么办？

### Merkle Tree：变化感知的核心

像「指纹」系统一样：
- 每个文件有自己的哈希指纹
- 文件夹有基于内容的指纹
- 最终汇聚成整个代码库的根节点指纹

**只要文件变动，上层哈希就会层层变化，从根节点往下对比即可快速定位变动。**

### 同步机制三阶段

| 阶段 | 动作 | 耗时 |
|------|------|------|
| 🏃‍♂️ **快速检测** | 计算根哈希，对比上次快照 | 几毫秒 |
| 🔍 **精确对比** | 文件级别对比，找出新增/删除/修改的文件 | 按需 |
| 🔄 **增量更新** | 只对变化的文件重新计算向量并更新 | 最小化 |

---

# 效果展示

## 使用方式

一行命令安装：

```bash
claude mcp add claude-context \
  -e OPENAI_API_KEY=your-openai-api-key \
  -e MILVUS_TOKEN=your-zilliz-cloud-api-key \
  -- npx @zilliz/claude-context-mcp@latest
```

## Benchmark 数据

在同等召回率的情况下：
- **Token 消耗减少 40%+**
- **时间节省 40%+**
- **金钱节省 40%+**

---

# 案例对比

## 案例一：Django YearLookup Bug

**问题**：`YearLookup` 查询优化破坏了 `__iso_year` 过滤功能

| 方案 | 工具调用 | Token 消耗 | 命中率 | Token 节省 |
|------|----------|-----------|--------|-----------|
| Baseline grep | 8 次 | 130,819 | 0% | - |
| Claude Context | 3 次 | 9,036 | 50% | **93%** |

**grep 方案问题**：文本搜索专注于错误的组件（ExtractIsoYear 注册），而不是实际的优化逻辑（YearLookup 类）。

**Claude Context 关键**：语义搜索立即理解了「YearLookup」作为核心概念，找到需要修改的确切类。

## 案例二：Xarray swap_dims Bug

**问题**：`.swap_dims()` 方法意外修改了原始对象，违反了不可变性

| 方案 | 工具调用 | Token 消耗 | 命中率 | Token 节省 |
|------|----------|-----------|--------|-----------|
| Baseline grep | 11 次 | 41,999 | 50% | - |
| Claude Context | 3 次 | 15,826 | 50% | **62%** |

**grep 方案问题**：使用了大量 list_directory 和 read_file 操作，而不是专注于相关方法。

**Claude Context 关键**：语义搜索立即定位了实际的 swap_dims() 实现并理解了功能上下文。

---

# 总结

Claude Context 的核心价值：

1. **精准检索**：语义理解比纯文本匹配更准确
2. **Token 节省**：减少 40%+ 的无效 Token 消耗
3. **时间节省**：更快定位问题代码
4. **跨平台**：适用于 Claude Code、Codex、Gemini CLI、Cline 等所有 AI coding 产品

**适用场景**：大型代码库、需要语义检索、希望降低 Token 成本的 AI coding 用户。