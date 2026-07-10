---
title: "OpenAI、Anthropic 与国产旗舰模型 API 价格对比"
date: 2026-07-10 17:09:02 +0800
categories: [tech, ai]
tags: [model-pricing, openai, anthropic, deepseek, kimi, glm, visualization]
description: "对比 OpenAI、Anthropic 与国产旗舰模型的 API 价格，并用三种坐标尺度解释价格分布。"
---

1. Table of Contents, ordered
{:toc}

比较大模型 API 价格时，表格能给出精确数字，却很难建立直觉：Claude Fable 5 的 `$10 / $50` 到底比 GPT-5.6 Sol 的 `$5 / $30` 贵多少？DeepSeek V4 Flash 的 `$0.14 / $0.28` 又处在什么位置？

更麻烦的是，图表也会“说不同的话”。同一批价格放进不同坐标系，读者感受到的差距可能完全不同。下面用三张图依次观察同一组数据，看看坐标尺度怎样影响价格判断。

# 数据口径

价格统一采用 **标准按量 API 基础价**，单位为美元/百万 token；横轴是输入价，纵轴是输出价。数据取自 [OpenAI 模型文档](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[Anthropic 定价页](https://platform.claude.com/docs/en/about-claude/pricing)、[Z.AI 定价页](https://docs.z.ai/guides/overview/pricing)、[DeepSeek API 定价页](https://api-docs.deepseek.com/quick_start/pricing)和 [Kimi API 平台](https://platform.kimi.ai/)。

| 厂商 | 模型 | 输入价 | 输出价 |
|---|---|---:|---:|
| OpenAI | GPT-5.6 Sol | $5 | $30 |
| OpenAI | GPT-5.6 Terra | $2.5 | $15 |
| OpenAI | GPT-5.6 Luna | $1 | $6 |
| Anthropic | Claude Fable 5 | $10 | $50 |
| Anthropic | Claude Opus 4.8 | $5 | $25 |
| Anthropic | Claude Sonnet 5 | $2 | $10 |
| Anthropic | Claude Haiku 4.5 | $1 | $5 |
| Z.AI | GLM-5.2 | $1.4 | $4.4 |
| DeepSeek | DeepSeek V4 Pro | $0.435 | $0.87 |
| DeepSeek | DeepSeek V4 Flash | $0.14 | $0.28 |
| Moonshot AI | Kimi K2.7 Code | $0.95 | $4 |

Claude Sonnet 5 使用截至 2026 年 8 月 31 日的推广价；之后标准价为 `$3 / $15`。

# 第一张图：对数坐标看清价格层级

![主流大模型 API 价格分布：对数坐标](/assets/img/ai/model-pricing/model-pricing-log.svg)

对数坐标让相同的**倍数变化**占据相同距离。它把 `$0.14` 到 `$10` 这一大段范围压进一张图，同时把 DeepSeek、Kimi、GLM 等低价模型之间的差别展开。

这张图最适合观察价格层级：Fable 5 位于最高价区，Sol 与 Opus 4.8 接近，Terra 与 Sonnet 5 居中，国内模型总体集中在左下。但它不适合建立绝对金额直觉，因为图上相同长度并不表示相同的美元差额。

# 第二张图：普通坐标，但横纵尺度不同

![主流大模型 API 价格分布：普通线性坐标](/assets/img/ai/model-pricing/model-pricing-linear.svg)

第二张图把两个轴都改成普通线性坐标。Fable 5 的高价位置立刻变得醒目，DeepSeek、Kimi、GLM、Luna 和 Haiku 则明显挤在左下角。这比对数图更接近人们对“贵”和“便宜”的日常感受。

不过，它仍然有一个容易忽略的问题：横轴大约覆盖 `$0–$10`，纵轴覆盖 `$0–$50`。因此横向移动 1 美元和纵向移动 1 美元的屏幕长度并不相同。它能展示数据分布，却不能把点与点之间的几何距离直接解释为真实价格距离。

# 第三张图：横纵轴使用完全相同的尺度

![主流大模型 API 价格分布：横纵轴等比例](/assets/img/ai/model-pricing/model-pricing-equal-scale.svg)

第三张图把横纵轴都设为 `$0–$55`，绘图区保持正方形。此时 **1 美元在两个方向上对应完全相同的长度**，虚线表示“输出价等于输入价”。

这张图给出的绝对直觉最强：所有模型都位于虚线上方，说明输出 token 普遍比输入 token 贵；大多数模型的输入价都被压缩在最左侧的 `$0–$10` 区间，而输出价才真正拉开纵向差距。Fable 5 的价格向量是 `$10 / $50`，Sol 是 `$5 / $30`，两者的输出价差距比输入价差距更值得关注。

低价模型挤成一团不是画坏了，而是同尺度下的真实结果。DeepSeek V4 Flash 和 Pro 确实比头部闭源旗舰便宜一个数量级；Kimi K2.7 Code、GLM-5.2、Haiku 4.5 和 Luna 虽然彼此仍有差别，但相对于 `$50` 的输出价上限，这些差别在绝对尺度中很小。

# 三张图分别回答什么问题

- **对数坐标图**回答：不同价格档位之间的倍数关系是什么？
- **普通线性图**回答：在尽量利用画布的前提下，模型大致分布在哪里？
- **横纵等比例图**回答：如果 1 美元始终画成同样长，真实价格距离是什么样？

所以不存在唯一正确的图。想看低价模型内部差异，用对数坐标；想快速扫一眼全局分布，用普通线性坐标；想获得最直接的绝对价格感受，就必须让横纵轴单位尺度一致。

# 单价不等于最终账单

这些图没有纳入缓存读写、Batch、长上下文、区域路由、Fast 或 Pro 模式等附加规则。不同厂商的 tokenizer 也会把同一段文字切成不同数量的 token，推理强度还会改变实际输出量。

因此，图中的点表示的是“每百万 token 的挂牌单价”，不是完成同一个任务的最终成本。真正选型时，应在代表性任务上同时记录成功率、输入与输出 token、延迟、重试次数和总账单。价格图提供直觉，最终决定仍然要由实际工作负载完成。
