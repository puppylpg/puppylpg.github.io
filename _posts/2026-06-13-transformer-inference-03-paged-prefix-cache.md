---
title: "Transformer 推理系列（三）：从 PagedAttention 到 Prefix Caching"
date: 2026-06-13 14:15:35 +0800
categories: [tech, ai]
tags: [transformer, attention, kv-cache, prefix-caching, paged-attention, llm-inference]
description: "接着 KV Cache、Prefill 和 Decode，继续理解 PagedAttention 与 Prefix Caching：它们分别解决显存利用率和跨请求前缀复用问题，以及为什么生成阶段通常不能直接复用别人的 KV。"
---

前两篇文章已经把 Transformer 推理里最核心的链路走了一遍：

- [Transformer 推理系列（一）：从 Attention 到 KV Cache]({% post_url 2026-06-12-transformer-inference-01-attention-kv-cache %}) 讲了 Q/K/V、Multi-Head Attention、GQA/MQA 和原生 KV Cache。
- [Transformer 推理系列（二）：从 Prefill 到 Decode]({% post_url 2026-06-13-transformer-inference-02-prefill-decode %}) 讲了 prefill 和 decode 为什么是两种不同的计算阶段。

这篇文章继续往下走：既然 KV Cache 已经能让 decode 不重复计算历史 token 的 K/V，为什么还需要 PagedAttention 和 Prefix Caching？

一句话先给结论：

> 原生 KV Cache 主要减少 decode 阶段的重复计算；PagedAttention 让这些 KV 能被更高效地分块、映射和管理；Prefix Caching 再基于这些可复用的 KV 块，减少 prefill 阶段的重复计算。

1. Table of Contents, ordered
{:toc}

# 前置知识只保留三件事

这篇文章不再重新解释 Q/K/V、KV Cache 里存什么、prefill/decode 怎么分工。前两篇已经分别讲过：

| 前置问题 | 放在哪篇 |
| --- | --- |
| Q/K/V、GQA/MQA、Decoding KV Cache 的基本语义 | [Transformer 推理系列（一）：从 Attention 到 KV Cache]({% post_url 2026-06-12-transformer-inference-01-attention-kv-cache %}) |
| prefill 如何写入 prompt K/V，decode 如何读取并追加新 token K/V | [Transformer 推理系列（二）：从 Prefill 到 Decode]({% post_url 2026-06-13-transformer-inference-02-prefill-decode %}) |

本文只借用三个结论：

1. KV Cache 缓存的是每层历史 token 的 K/V 中间结果，不是模型权重，也不是最终答案。
2. 单次请求内，prompt token 和已生成 token 的 K/V 都会进入当前请求的 Decoding KV Cache。
3. KV Cache 的逻辑形状取决于层数、序列长度、KV head 数量、head dim 和存储精度。

在这个基础上，还剩两个系统层问题：

- KV Cache 在显存里怎么放，才不浪费空间？
- 如果两个请求有相同 prompt 前缀，能不能不要重复做 prefill？

这两个问题分别引出 PagedAttention 和 Prefix Caching。

# 先把两个 cache 分清楚

这里容易混淆的是：文章里反复说 KV Cache，但后面又会说 Prefix Caching。它们底层都可能涉及 K/V tensors，但生命周期和系统语义不同。

单次请求内 KV Cache 的基础机制，第一篇 [Transformer 推理系列（一）：从 Attention 到 KV Cache]({% post_url 2026-06-12-transformer-inference-01-attention-kv-cache %}) 已经讲过：prompt token 和已生成 token 的 K/V 都会进入当前请求的运行时 KV Cache。本文这里重点补上另一个边界：这份运行时 KV Cache 不等于跨请求的 Prefix Cache。

为了避免混在一起，可以先给它们起两个更具体的名字：

| 名字 | 作用范围 | 主要内容 | 什么时候用 |
| --- | --- | --- | --- |
| Decoding KV Cache | 单次请求内部 | 当前序列已经处理过的 prompt token 和已生成 token 的 K/V | decode 每一步生成下一个 token 时复用 |
| Prefix Cache / Prompt Cache | 多个请求之间 | 曾经作为 prompt/input 前缀被 prefill 过的 K/V | 新请求进来时，复用相同前缀，减少 prefill |

Decoding KV Cache 是自回归生成的运行时状态。比如一个请求先 prefill 了 2048 个 prompt token，接着又生成了 2048 个 token，那么在这次请求还活着的时候，当前解码链路里的 KV Cache 会随着生成继续追加，逻辑上可以增长到 4096 个 token 的上下文状态。

这里的“追加进 KV Cache”，不是说另有一份神秘缓存。KV Cache 本身就是放在 GPU 显存里的 K/V 张量结构。生成 token 的 K/V 会留在这份运行时结构里，供后续 decode step 使用；请求结束后，这份运行时状态通常就可以释放。

Prefix Cache 则是另一层系统优化。它关注的是：下一次请求的 prompt/input 前缀，是否和系统最近处理过的某段前缀完全一样。如果一样，就可以跳过这段前缀的重复 prefill。像 OpenAI API 暴露的 `cached_tokens`，统计的也是当前请求里有多少 prompt/input token 命中了 prompt cache，而不是上一次 response 有多少 token 被直接复用。

这里还有一个重要原则：**Cache 是性能优化，不是生成语义的一部分**。在逻辑输入、模型和采样参数相同的前提下，用不用 Prefix Cache 不应该改变最终输出；它只是少算了一段已经算过的 request/prompt 前缀。换句话说，Prefix Cache 复用的是 request/input 的前缀 K/V，不是复用上一次 response 的文本或生成结果。response tokens 仍然会按当前请求继续自回归生成。

所以，一个很实用的判断方式是：

> 已生成 token 的 K/V 会进入本次请求的 Decoding KV Cache；但它不会因为“刚刚被生成过”，就自动变成下一次请求可命中的 Prefix Cache。

```mermaid
flowchart TD
  Req["单次请求"] --> P["Prefill prompt<br/>生成 prompt K/V"]
  P --> D["Decoding KV Cache<br/>当前请求运行时状态"]
  D --> G1["生成 token 1<br/>追加 token 1 的 K/V"]
  G1 --> G2["生成 token 2<br/>追加 token 2 的 K/V"]
  G2 --> End["请求结束<br/>运行时状态可释放"]

  P --> Maybe["系统策略<br/>可能保留 prompt 前缀 K/V"]
  Maybe --> PC["Prefix Cache / Prompt Cache<br/>供后续请求按前缀命中"]

  style D fill:#e8f5e9
  style PC fill:#e3f2fd
  style Maybe fill:#fff3bf
  style End fill:#ffe3e3
```

# 从逻辑 KV 到物理 block

LLM 推理时，KV Cache 通常放在 GPU 显存，也就是 HBM/VRAM 里。

前文已经讲过 KV Cache 的基本语义。这里换一个系统实现视角：推理服务要管理的不是抽象公式里的 K/V，而是一批真实占用显存、需要分配、共享和回收的 K/V 张量块。

这不是说“显存里的那份东西不是 KV Cache”。恰恰相反，KV Cache 通常就是显存里的运行时张量结构。区别只在于：它是单次请求内部的 Decoding KV Cache，还是被系统保留下来、供后续请求按前缀命中的 Prefix Cache。

原因不是“别的地方不能存”，而是速度。decode 每一步都要读历史 K/V，如果把 KV Cache 放在 CPU 内存、硬盘或者远端存储，搬运成本很容易超过节省下来的计算成本。对在线推理来说，KV Cache 通常必须离 GPU 计算单元足够近。

但“放在显存里”还不够具体。更重要的问题是：它到底存了什么，长成什么形状？

先用一个极小的模型做例子。假设：

- 模型有 2 层。
- 每层有 2 个 KV head。
- 每个 head 的维度是 4，也就是 `head_dim = 4`。
- 当前请求已经处理了 3 个 token：`我 / 喜欢 / AI`。

那么 KV Cache 里存的不是 token 文本，也不是 attention 分数，而是这些 token 在每一层、每个 KV head 下算出来的 K 向量和 V 向量。

## 一个 token 在一层里存什么

先只看第 1 层、第 1 个 KV head。

当 token “我”进入这一层后，会通过这一层的 $$W_K$$ 和 $$W_V$$ 投影出两个向量：

$$
k_{\text{我}}^{(1, h0)} = [0.12,\ -0.31,\ 0.44,\ 0.08]
$$

$$
v_{\text{我}}^{(1, h0)} = [0.27,\ 0.19,\ -0.05,\ 0.62]
$$

这两个向量就是 KV Cache 里真正要存的东西。

如果当前已经有 3 个 token，那么第 1 层、第 1 个 KV head 的缓存可以画成两张小表：

| Layer 1 / KV head 0 / K | dim 0 | dim 1 | dim 2 | dim 3 |
| --- | --- | --- | --- | --- |
| token 1：我 | 0.12 | -0.31 | 0.44 | 0.08 |
| token 2：喜欢 | 0.51 | 0.07 | -0.22 | 0.36 |
| token 3：AI | -0.18 | 0.40 | 0.29 | -0.11 |

| Layer 1 / KV head 0 / V | dim 0 | dim 1 | dim 2 | dim 3 |
| --- | --- | --- | --- | --- |
| token 1：我 | 0.27 | 0.19 | -0.05 | 0.62 |
| token 2：喜欢 | -0.14 | 0.33 | 0.48 | 0.09 |
| token 3：AI | 0.71 | -0.20 | 0.16 | 0.25 |

真实模型里的数值当然不是这么少，`head_dim` 常见是 64、128 或 256。这里用 4 维只是为了把表画出来。

这两张表的含义是：

- K 表负责“被当前 query 匹配”：新 token 的 $$q_t$$ 会和历史所有 K 做点积。
- V 表负责“被加权取信息”：softmax 权重算出来之后，会对历史所有 V 做加权求和。

decode 到下一个 token 时，比如来了 token 4 “很”，它会生成自己的 $$q_4$$，然后读这张 K 表：

$$
q_4 [k_{\text{我}}, k_{\text{喜欢}}, k_{\text{AI}}, k_{\text{很}}]^T
$$

得到权重后，再读 V 表：

$$
\alpha_1 v_{\text{我}} + \alpha_2 v_{\text{喜欢}} + \alpha_3 v_{\text{AI}} + \alpha_4 v_{\text{很}}
$$

所以 KV Cache 里的每一行，都对应一个历史 token；每一列，是这个 token 在某个 head 里的向量维度。

```mermaid
flowchart LR
  Q["当前 token 的 q4"] --> Dot["和历史 K 做点积"]
  K["K Cache<br/>k1, k2, k3, k4"] --> Dot
  Dot --> Softmax["softmax<br/>得到注意力权重"]
  Softmax --> Weighted["按权重读取 V Cache"]
  V["V Cache<br/>v1, v2, v3, v4"] --> Weighted
  Weighted --> Out["当前 token 的新表示"]

  style K fill:#e3f2fd
  style V fill:#e8f5e9
  style Softmax fill:#fff3bf
  style Out fill:#ffe3e3
```

## KV head 细节在这里怎么用

Query head 和 KV head 为什么可以不一样、GQA/MQA 为什么能减少 KV Cache 体积，第一篇已经讲过。本文只需要记住一个结论：

> Prefix Caching 复用的是已经算好的前缀 K/V；不管底层是 MHA、GQA 还是 MQA，只要 token 前缀和相关推理条件一致，能复用的对象都是这些 K/V 中间结果。

所以后面讨论 block、hash、Radix Tree 和 eviction 时，真正被管理的不是 Query，也不是最终输出，而是按层、按 KV head、按 token 存下来的 K/V。

## 多层模型怎么堆起来

KV Cache 还必须按层分开存。

原因是：第 1 层的 K/V 来自原始 embedding 或上一层输入；第 2 层的 K/V 来自第 1 层输出；第 3 层又来自第 2 层输出。每层看到的 hidden state 不一样，所以每层算出来的 K/V 也不一样。

同一个 token “AI”，在 Layer 1 和 Layer 2 里会有两份不同的 K/V：

| token：AI | 来源 | 存入哪里 |
| --- | --- | --- |
| $$k_{\text{AI}}^{(1)}, v_{\text{AI}}^{(1)}$$ | Layer 1 的输入投影 | Layer 1 KV Cache |
| $$k_{\text{AI}}^{(2)}, v_{\text{AI}}^{(2)}$$ | Layer 1 输出后的 hidden state 投影 | Layer 2 KV Cache |

所以，一个请求的完整 KV Cache 不是一张表，而是：

```text
请求 A 的 KV Cache
├── Layer 1
│   ├── K: [kv_head, seq_len, head_dim]
│   └── V: [kv_head, seq_len, head_dim]
├── Layer 2
│   ├── K: [kv_head, seq_len, head_dim]
│   └── V: [kv_head, seq_len, head_dim]
└── ...
```

如果把 batch 也加进来，逻辑形状就可以写成：

$$
[\mathrm{batch},\ \mathrm{layer},\ \mathrm{kv\_head},\ \mathrm{seq},\ \mathrm{head\_dim}]
$$

这里每个维度的含义是：

| 维度 | 含义 |
| --- | --- |
| batch | 同时服务多少个请求 |
| layer | 第几层 Transformer |
| kv_head | KV 头数量，GQA/MQA 下可能少于 Query 头数量 |
| seq | 当前请求已经缓存了多少 token |
| head_dim | 每个 attention head 的向量维度 |

如果还要把 K 和 V 也作为一个维度写进去，也可以写成：

$$
[\mathrm{batch},\ \mathrm{layer},\ 2,\ \mathrm{kv\_head},\ \mathrm{seq},\ \mathrm{head\_dim}]
$$

其中那个 `2` 就表示 K 和 V 两类缓存。

## 物理显存里不一定连续

上面的形状是逻辑视角，意思是“模型在计算时需要按这些维度取数据”。但物理显存里不一定真是一整块连续大数组。

最朴素的实现可以想象成这样：每个请求提前拿到一整段连续空间。

```text
请求 A 的连续 KV 空间：
[token 1][token 2][token 3][空][空][空][空][空]
```

这很好理解，但浪费严重。请求 A 如果只用了 3 个 token，后面的空位也被它占住了。

现代推理引擎更倾向于把 KV Cache 切成 block。逻辑上，请求 A 还是有 token 1 到 token 8；物理上，它们可以散落在不同 block 里：

```mermaid
flowchart LR
  Logical["请求 A 的逻辑序列<br/>token 1 ... token 8"] --> Table["block table"]
  Table --> B7["物理 block 7<br/>token 1-4"]
  Table --> B2["物理 block 2<br/>token 5-8"]

  style Table fill:#fff3bf
  style B7 fill:#e8f5e9
  style B2 fill:#e8f5e9
```

block 里存的仍然是每层、每个 KV head 的 K/V 向量，只是分配单位从“整个请求的一大段连续空间”变成了“若干个固定大小的小块”。

## 本文只关心物理 block 视角

KV Cache 的逻辑形状和显存公式，后面的 [Transformer 推理系列（四）：QwQ-32B 部署显存与低精度计算]({% post_url 2026-06-14-transformer-inference-04-qwq32b-vram-precision %}) 会专门使用；这篇不再展开算账。这里只抓住一个和 Prefix Caching 强相关的视角：

> KV Cache 逻辑上是一摞“按层、按 KV head、按 token 排列的 K 表和 V 表”；物理上通常会被推理系统切成 block，再用映射表把逻辑序列和物理 block 连起来。

# 原生 KV Cache 没解决什么

最朴素的 KV Cache 管理方式，是为每个请求预留一段连续空间。

比如系统认为一个请求最多会用到 2048 个 token，就提前给它分配 2048 个 token 的 KV Cache 空间。问题是，这个请求也许只生成 20 个 token 就结束了。

这样会带来两类浪费：

| 问题 | 含义 |
| --- | --- |
| 内部碎片 | 已经给某个请求预留了空间，但它实际没用完 |
| 外部碎片 | 显存里剩余空间很多，但被切成零散小块，放不下新的大请求 |

更关键的是，连续分配方式默认每个请求都有自己的一份 KV Cache。哪怕两个请求的前 10000 个 token 完全相同，也会各自存一份。

所以原生 KV Cache 解决了“同一个请求 decode 时不要重复算历史 K/V”，但没有自然解决：

- 显存空间利用率；
- 不同请求之间的相同前缀复用；
- 多个采样分支共享同一段 prompt KV。

# PagedAttention 解决的是显存利用率

PagedAttention 的直觉来自操作系统里的分页内存：逻辑上连续，物理上可以不连续。

它把 KV Cache 拆成固定大小的 block。一个 block 通常存若干个 token 的 K/V，比如 16 个 token。请求看到的是一段连续上下文，但底层物理显存可以是多个不连续 block，再通过 block table 串起来。

```mermaid
flowchart LR
  Req["请求的逻辑 KV 序列<br/>token 1 ... token 64"] --> Table["block table<br/>逻辑块到物理块的映射"]
  Table --> B1["物理 block A<br/>token 1-16"]
  Table --> B2["物理 block K<br/>token 17-32"]
  Table --> B3["物理 block C<br/>token 33-48"]
  Table --> B4["物理 block Z<br/>token 49-64"]

  style Table fill:#fff3bf
  style B1 fill:#e8f5e9
  style B2 fill:#e8f5e9
  style B3 fill:#e8f5e9
  style B4 fill:#e8f5e9
```

这样做的收益是：

| 能力 | 解释 |
| --- | --- |
| 按需分配 | 请求长到哪里，就分配到哪里 |
| 降低碎片 | 不要求一整段连续显存 |
| 提高 batch size | 同样显存能容纳更多并发请求 |
| 支持共享 | 多个逻辑序列可以指向同一个物理 block |

这里要分清楚：PagedAttention 本身重点解决的是 KV Cache 的内存管理和利用率问题。它让“共享 block”这件事变得可行，但“跨请求发现相同前缀并复用”还需要上层策略。

这个上层策略就是 Prefix Caching。

# Prefix Caching 解决的是跨请求前缀复用

Prefix Caching，也就是前缀缓存，关注的问题是：

> 如果两个请求的开头完全一样，前面这段 prompt 的 KV 能不能只算一次、只存一份？

比如两个请求都是：

```text
system prompt + 长文档 + 用户问题
```

如果 `system prompt + 长文档` 完全相同，只有最后的用户问题不同，那么这段公共前缀在 prefill 阶段会产生完全相同的 K/V。

没有 Prefix Caching 时，每个请求都要重新 prefill 这段长文档：

```text
请求 A：prefill(system + doc) + prefill(question A)
请求 B：prefill(system + doc) + prefill(question B)
请求 C：prefill(system + doc) + prefill(question C)
```

有了 Prefix Caching 后，可以变成：

```text
公共前缀：prefill(system + doc) 一次
请求 A：复用公共前缀 KV + 只 prefill question A
请求 B：复用公共前缀 KV + 只 prefill question B
请求 C：复用公共前缀 KV + 只 prefill question C
```

这就是 Prefix Caching 和原生 KV Cache 的关键差异：

| 技术 | 主要复用对象 | 主要减少哪个阶段的成本 |
| --- | --- | --- |
| 原生 KV Cache | 同一个请求里已经生成或已经读过的历史 token K/V | decode |
| Prefix Caching | 不同请求之间相同前缀的 prompt K/V | prefill |

所以可以把两者看成接力关系：

1. Prefix Caching 先让请求不用从 0 开始 prefill，直接复用已有前缀 KV。
2. 请求进入生成后，再用普通 KV Cache 继续逐 token decode。

# 为什么 PagedAttention 是 Prefix Caching 的基础设施

如果 KV Cache 是一整段连续大数组，想共享前缀会很别扭。因为共享的单位太大，拷贝、切分、生命周期管理都麻烦。

PagedAttention 把 KV Cache 变成 block 后，Prefix Caching 就可以以 block 为单位做复用：

1. 每个 block 对应一段 token 的 K/V。
2. 系统给 block 或 token 前缀计算 hash。
3. 新请求进来时，先查已有缓存里是否有相同前缀。
4. 命中后，新请求的 block table 直接指向已有物理 block。
5. 分叉后的新内容再分配新 block。

```mermaid
flowchart TD
  A["请求 A<br/>prefix + question A"] --> P["公共 prefix blocks"]
  B["请求 B<br/>prefix + question B"] --> P
  C["请求 C<br/>prefix + question C"] --> P
  P --> PA["A 的差异 block"]
  P --> PB["B 的差异 block"]
  P --> PC["C 的差异 block"]

  style P fill:#e8f5e9
  style PA fill:#e3f2fd
  style PB fill:#fff3bf
  style PC fill:#ffe3e3
```

这时候，多个请求逻辑上各自有完整上下文，但物理上公共前缀只存一份。

# Radix Tree：把公共前缀组织成树

工程上，Prefix Caching 往往需要一个索引结构来管理“哪些前缀已经存在”。一种常见思路是使用 Radix Tree，也就是基数树。

基数树适合管理前缀，因为它天然把公共开头合并成同一条路径：

```mermaid
flowchart TD
  Root["root"] --> S["system prompt"]
  S --> D["公共文档 doc"]
  D --> Q1["question A"]
  D --> Q2["question B"]
  D --> Q3["question C"]

  style S fill:#e8f5e9
  style D fill:#e8f5e9
  style Q1 fill:#e3f2fd
  style Q2 fill:#fff3bf
  style Q3 fill:#ffe3e3
```

这张图里的 `system prompt + 公共文档 doc` 只需要保存一份 KV。不同问题从公共文档之后分叉。

为了让这套机制能在推理服务里稳定运行，还需要配套几个机制：

| 机制 | 作用 |
| --- | --- |
| hash / token 匹配 | 判断新请求的前缀是否和已有缓存一致 |
| 引用计数 | 有请求正在使用某段 KV 时，不能释放 |
| LRU / eviction | 显存不够时，清理长期不用的缓存块 |
| block table | 让不同请求逻辑上拥有自己的序列，物理上共享部分 block |

所以 Prefix Caching 不是“把 prompt 字符串存起来”这么简单。它复用的是 prompt 在每层产生的 K/V 中间结果，而且要和底层 KV 内存管理配合。

# 为什么它对 RAG 和搜索特别重要

普通聊天场景里，用户 prompt 可能很短，输出可能很长。这时 decode 会占据大量时间，原生 KV Cache、continuous batching、speculative decoding 这些优化会很重要。

但在 RAG、AI 搜索、相关性打分、rerank 这类场景里，经常是另一种形态：

| 场景特点 | 结果 |
| --- | --- |
| 输入很长 | 文档、候选结果、上下文可能有几千到几十万 token |
| 输出很短 | 只输出分数、标签、True/False 或几句解释 |
| 公共前缀多 | system prompt、任务说明、文档模板经常重复 |
| 首 token 延迟敏感 | 用户等的是“什么时候开始出结果” |

这时最重的部分往往不是 decode，而是 prefill。

如果 99% 的计算都花在读长文档上，那么 Prefix Caching 的价值就非常直接：已经读过的长文档不要再读一遍，直接复用它的 KV。

可以这样理解：

> 原生 KV Cache 让模型在生成时不反复读自己已经写过的历史；Prefix Caching 让模型在处理新请求时不反复读大家都见过的长前缀。

# 完全相同的 prompt，能不能复用别人生成的 token KV

还有一个容易混淆的问题：

> 如果另一个用户的 prompt 和我完全一样，那么 Prefix Caching 能不能不只复用 prompt 的 KV，也复用对方后面生成出来的 token KV？

通常答案是：生产系统里主要复用到 prompt 前缀，生成阶段一般各走各的自回归路径。

更准确地说，这不是数学上完全做不到，而是系统通常不会把“上一次请求在 decode 阶段生成出来的运行时 KV”直接当成“下一次请求可命中的 prompt cache”。

看一个具体例子：

```text
请求 A：
input  = P 2048 tokens
output = R 2048 tokens

请求 B：
input  = P + R 4096 tokens
```

请求 B 里的 `R` 虽然刚刚由请求 A 生成过，但在请求 A 里，`R` 的 K/V 属于 A 的 Decoding KV Cache。它服务的是 A 后续继续生成，而不是自动进入跨请求 Prefix Cache。

所以请求 B 更合理的预期是：

```text
A: input P       -> 可能缓存 P 这段 prompt 前缀
B: input P + R   -> 可能先命中 P；处理完后，系统才可能缓存 P + R
C: input P + R   -> 如果路由、缓存生命周期等条件满足，才有机会命中完整 P + R
```

如果某段 `P + R` 已经真的作为某次请求的 prompt/input 被 prefill 过，那么后续请求当然可以把它当成普通前缀来命中。关键区别在于：**R 是不是已经以 prompt/input 前缀的身份被处理过**。

这和一些商业 API 的语义也一致。例如 OpenAI 的 [Prompt caching 文档](https://developers.openai.com/api/docs/guides/prompt-caching) 里，`cached_tokens` 统计的是请求的 prompt/input tokens 里命中的数量；文档也说明 prompt caching 不改变输出 token 的生成，最终 response 仍会重新计算。

为什么生产系统通常不直接复用别人生成阶段的 KV？原因有三个。

## 生成路径可能分叉

只要采样不是完全确定性的，同一个 prompt 也可能生成不同 token。

比如用户 A 的第一个生成 token 是：

```text
具有
```

用户 B 的第一个生成 token 可能是：

```text
存在
```

第一个 token 一旦不同，后续上下文就不同。KV Cache 对应的是“具体 token 序列”的中间结果，序列不同，后面的 KV 就不能混用。

## 用户隔离和安全边界

KV Cache 是模型对上下文的中间表示。生成阶段的 KV 里包含某个用户已经生成的具体内容路径。

跨用户直接复用生成阶段 KV，会让缓存生命周期、权限边界和数据隔离变复杂。线上系统通常会保守处理：公共输入前缀可以按策略共享，用户自己的生成路径属于自己的请求状态。

## 完全确定时，Response Cache 更直接

如果 prompt 完全一致，采样参数也完全确定，比如 temperature 为 0，那么理论上输出也会一样。

但这时候更简单的做法通常不是复用生成阶段 KV，而是在应用层做 Response Cache：

```text
hash(prompt + sampling_config) -> final answer
```

命中后直接返回字符串，连 GPU 都不用进。它比“加载别人生成阶段 KV 再继续 decode”更直接。

# 例外：同一请求内的分支可以共享公共前缀

虽然跨用户复用生成阶段 KV 通常不作为主要路径，但同一个请求内部的分支共享是合理的。

典型例子是 parallel sampling：同一个 prompt 同时生成多个候选答案。

这些候选答案在分叉之前共享同一段 prompt KV；分叉之后，各自维护自己的生成 KV。

```mermaid
flowchart TD
  P["共同 prompt KV"] --> A1["候选 A<br/>token a1"]
  P --> B1["候选 B<br/>token b1"]
  P --> C1["候选 C<br/>token c1"]
  A1 --> A2["候选 A 后续 KV"]
  B1 --> B2["候选 B 后续 KV"]
  C1 --> C2["候选 C 后续 KV"]

  style P fill:#e8f5e9
  style A1 fill:#e3f2fd
  style B1 fill:#fff3bf
  style C1 fill:#ffe3e3
```

这和 Prefix Caching 的思想一致：公共部分只存一份，分叉部分各自维护。

区别在于：

- Prefix Caching 更常讨论跨请求的 prompt 前缀复用；
- parallel sampling 更像同一请求内部的多分支复用。

# 最后用一张表串起来

到这里，几个概念的边界就清楚了：

| 技术 | 解决的问题 | 复用粒度 | 主要收益 |
| --- | --- | --- | --- |
| KV Cache | decode 不重复计算历史 K/V | 同一请求的历史 token | 降低逐 token 生成成本 |
| PagedAttention | KV Cache 连续分配浪费显存 | 固定大小 block | 提高显存利用率和并发 |
| Prefix Caching | 多个请求重复 prefill 相同前缀 | prompt 前缀 block / tree path | 降低 TTFT 和 prefill 成本 |
| Radix Tree | 如何快速管理公共前缀 | 前缀路径 | 支持查找、共享、分叉和回收 |
| Response Cache | 完全相同请求直接返回结果 | 最终答案字符串 | 命中时绕过模型推理 |

如果只记一个主线，可以这样记：

1. Attention 让当前 token 从历史 token 里取信息。
2. KV Cache 把历史 token 的 K/V 存起来，让 decode 不重复算。
3. PagedAttention 把 KV Cache 切成 block，让显存管理不再依赖连续大块。
4. Prefix Caching 利用这些 block 复用公共 prompt 前缀，让 prefill 不重复算。
5. 进入生成阶段后，每个分支还是要按自己的 token 序列继续自回归。

所以最关键的区别是：

> KV Cache 加速的是“这个请求接下来怎么继续生成”；Prefix Caching 加速的是“这个请求开始时能不能站在别人已经读过的前缀上”。
