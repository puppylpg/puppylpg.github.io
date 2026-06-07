---
title: "Claude Code LSP 能力演示与原理解析"
date: 2026-06-08 01:48:00 +0800
categories: [ai, tool]
tags: [claude-code, lsp, jdtls, java, code-navigation]
description: "通过 8 种 LSP 操作的实际演示，深入理解 Claude Code 如何利用 jdtls 实现精确的代码导航，以及背后的索引原理。"
---

LSP（Language Server Protocol）是 Claude Code 与代码库交互的核心能力之一。本文记录一次完整的演示过程：从铺开 8 种基础操作，到在真实业务类上做深度分析，再到追问"这一切背后怎么工作的"。理论讲解穿插在每次实际操作之后，因为看到结果再理解原理比纯讲理论更自然。

---

## 第一步：用一个简单接口铺开 8 种操作

选 `IndexOperations`——Elasticsearch 索引管理接口，方法清晰，方便聚焦在操作本身上。

**先摸清文件结构**

```plain
LSP documentSymbol — IndexOperations.java
→ 接口 IndexOperations
   ├─ create(): boolean
   ├─ create(Map): boolean
   ├─ createWithMapping(): boolean
   ├─ delete(): boolean
   ├─ exists(): boolean
   ├─ refresh(): void
   ├─ createMapping(): Document
   ├─ putMapping(Document): boolean
   ├─ getMapping(): Map
   └─ alias(AliasActions): boolean  等共 15+ 个方法
```

`documentSymbol` 相当于给文件做 X 光：返回所有类、方法、字段的完整符号树，不需要打开文件逐行阅读。

**跳到外部类型的定义**

```plain
LSP goToDefinition — IndexOperations.java:23（Document 符号处）
→ 跳转到 Document.java（org.springframework.data.elasticsearch.core.document 包）
```

`goToDefinition` 直接跳到符号的定义位置，无论它在当前模块还是二方包里。

**找出所有实现类**

```plain
LSP goToImplementation — IndexOperations.java:39
→ IndicesTemplate（client/elc 包）
→ IndexOperationsAdapter（core 包）
```

2 个实现类，一次返回。这是继承/实现图的反向查询——jdtls 启动时已经扫描过整个项目，知道谁实现了这个接口。

**追踪接口被引用的位置**

```plain
LSP findReferences — IndexOperations.java:39
→ ElasticsearchOperations.java（indexOps() 方法返回类型声明处）
→ SimpleElasticsearchRepository.java:71（字段类型声明）
→ IndexOperationsAdapter.java:37（父接口）等
```

**查看实现类的向下调用链**

实现方法 `IndicesTemplate.createWithMapping()` 负责按实体类注解创建索引：

```plain
LSP outgoingCalls — IndicesTemplate.java:134（createWithMapping）
→ doCreate(IndexCoordinates, Map, Document)
→ createSettings()
→ createMapping()
```

**查看 createWithMapping 被谁调用**

```plain
LSP incomingCalls — IndicesTemplate.java:134（createWithMapping）
→ SimpleElasticsearchRepository.init() Line 94
→ SimpleReactiveElasticsearchRepository.init() Line 76
→ IndexOperationsAdapter.blocking() Line 60
```

Repository 初始化时会自动调用 `createWithMapping()`，按实体类的注解定义创建索引结构和字段映射。

**另外两种操作**

```plain
LSP hover — IndexOperations.java:73
→ 显示 createWithMapping() 完整签名与 Javadoc：
  boolean createWithMapping() — Create an index with the settings and
  mapping defined for the entity this IndexOperations is bound to.

LSP prepareCallHierarchy — IndicesTemplate.java:134
→ 为 incomingCalls/outgoingCalls 初始化调用链查询上下文
```

---

## 第二步：换到真实业务类，看规模

`IndexOperations` 是接口，换 `AbstractElasticsearchTemplate`（875 行，核心操作抽象基类）看看 LSP 在真实代码上能做什么。

**先摸清规模**

```plain
LSP documentSymbol — AbstractElasticsearchTemplate.java
→ 5 个字段 + 2 个构造器 + 30+ 个方法（875 行）
  含 save()、index()、get()、multiGet()、exists()、delete()、
  update()、search()、searchForStream()、openPointInTime() 等
```

**核心方法 save(T entity) 被谁调用**

```plain
LSP incomingCalls — AbstractElasticsearchTemplate.java:213（save(T entity)）
→ 生产调用方：SimpleElasticsearchRepository.save(S entity) Line 190
→ SimpleElasticsearchRepository.saveAll(Iterable<S>) Line 221（多处）
```

生产链路通过 `SimpleElasticsearchRepository` 统一进入，可以快速评估改动影响范围。

**另一个方法 save(T, IndexCoordinates) 的依赖广度**

```plain
LSP outgoingCalls — AbstractElasticsearchTemplate.java:221（save(T entity, IndexCoordinates)）
→ 4 个调用：maybeCallbackBeforeConvert(entity, index)、
  getIndexQuery(entityAfterBeforeConvert)、doIndex(query, index)、
  maybeCallbackAfterSave(query.getObject(), index)
```

清晰展示了保存一个实体的完整生命周期：before-callback → 构建查询 → 写入 ES → after-callback。

**AbstractElasticsearchTemplate 类型的使用范围**

```plain
LSP findReferences — AbstractElasticsearchTemplate.java:83
→ 12 处引用，分布在 ElasticsearchTemplate、ElasticsearchConfiguration、
  ReactiveElasticsearchTemplate 等文件
```

12 处——LSP 返回的是类型系统层面的引用，精确到每一个真正使用了这个类型的位置。

---

## 第三步：追问原理——LSP 怎么知道这一切？

看完演示，自然会问：这些查询为什么这么快？它怎么知道 `AbstractElasticsearchTemplate` 在 12 个文件里被引用了多少次？

答案是：**jdtls 启动时做了一次全量静态分析，把结果存在内存索引里，后续查询直接读索引，不重新解析源码。**

分析管线：

```plain
源文件
  │ 解析
  ▼
AST（抽象语法树）
  │ 类型推断（底层是 ECJ，Eclipse Compiler for Java）
  ▼
符号表（类/方法/字段 → 完整类型信息）
  │
  ├─▶ 继承/实现图：interface → impl class，class → subclass
  ├─▶ 引用图（双向）：符号 ↔ 所有引用位置
  └─▶ 调用图（双向）：caller ↔ callee
```

8 种 LSP 操作各自对应哪张索引：

| 操作 | 查的索引 |
| --- | --- |
| `documentSymbol` | AST + 符号表 |
| `goToDefinition` | 符号表（定义位置） |
| `goToImplementation` | 继承/实现图（反向） |
| `findReferences` | 引用图（反向） |
| `hover` | 符号表 + Javadoc |
| `prepareCallHierarchy` | 调用图（初始化查询） |
| `incomingCalls` | 调用图（反向） |
| `outgoingCalls` | 调用图（正向） |

**为什么比 grep 准**：grep 是文本匹配，搜 `save` 会命中所有含该字符串的行，无法区分同名方法。LSP 工作在类型系统层面，`findReferences` 找的是"同一个符号"，不会误匹配。

文件变更时，jdtls 只重新分析改动文件及其依赖方（增量更新），不会重跑全量分析。

---

## 第四步：再追问——这个进程谁启动的？什么时候？

**实测进程归属**

```plain
$ ps aux | grep -i "jdt"
24617  PPID=23335(claude)  启动于 15:58:46  /opt/homebrew/Cellar/jdtls/1.57.0/
28798  PPID=28200(Cursor)  启动于 16:01:15  ~/.cursor/extensions/redhat.java/
```

两个完全独立的 jdtls 进程：

+ Claude Code 的（homebrew 安装，stdio 通信）：会话初始化时检测到 `pom.xml`，自动 fork
+ Cursor 的（redhat.java 扩展，Unix socket 通信）：打开 Java 项目时由 extension-host 启动

**验证生命周期：关掉 Cursor 的 Java 项目**

```plain
$ ps aux | grep -i "jdt"
24617  PPID=23335(claude)  启动于 15:58:46  /opt/homebrew/Cellar/jdtls/1.57.0/
（PID 28798 消失）
```

Cursor 的 jdtls 随项目关闭而销毁，Claude Code 的保持不变。两套索引完全独立，互不干扰——这也意味着在 Claude Code 里做的 LSP 查询和 Cursor 的智能提示是各自独立计算的。

---

## 结论

+ jdtls 启动时全量静态分析，建立 AST → 符号表 → 引用图 → 调用图，后续查询直接读内存索引
+ 8 种操作覆盖代码导航核心场景：每种操作背后对应不同的索引查询，理解这一点才能用对工具
+ Claude Code 与 Cursor 各自维护独立的 jdtls 进程和索引，生命周期与各自客户端绑定
+ LSP 相比 grep 的本质优势：工作在类型系统层面，精确追踪同一符号，不受文本相似性干扰