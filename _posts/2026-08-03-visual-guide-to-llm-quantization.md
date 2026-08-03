---
title: "大模型量化可视化指南：从 FP32、INT8 到 GPTQ、GGUF 与 BitNet"
date: 2026-08-03 17:45:53 +0800
categories: [tech, llm]
tags: [llm, quantization, model-compression, gptq, gguf, bitnet]
description: "用 60 张图理解大模型量化：数值表示、线性映射、校准、PTQ、GPTQ、GGUF、QAT、BitNet 与 1.58-bit LLM。"
---

## 核心

**量化的本质，是用更少的离散数值近似模型原本的高精度权重和激活，在显存、带宽、计算速度与模型精度之间寻找平衡。** 位数越少，模型越容易部署，但可表示的数值越稀疏，因此量化技术的核心工作就是控制近似误差，并把误差留在模型不敏感的位置。

本文主要依据 Maarten Grootendorst 于 2024 年 7 月 22 日发布的 [A Visual Guide to Quantization](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-quantization) 翻译和整理，在保留原文直觉、例子与完整图解的同时，对 `GGUF`、动态量化和 GPTQ 等概念做了必要的准确化。除另有标注外，文中图片均来自原文。

![大模型量化可视化指南](/assets/img/tech/quantization-visual-guide/01-cover.png)
_图 1：大模型量化，就是把高精度数值压缩为更少的离散表示。_

1. Table of Contents, ordered
{:toc}

## 从“模型很大”追到每个数占多少位

大语言模型之所以“大”，首先是因为它包含数十亿乃至数千亿个参数，其中绝大部分是权重。推理时，输入与权重相乘还会产生激活值（activation，数据流过网络各层时生成的中间结果）。权重需要长期存储，激活则随输入不断产生；两者都要占用内存或显存，也都可能成为数据搬运和计算的负担。

![权重与激活共同占用内存](/assets/img/tech/quantization-visual-guide/02-weights-activations.png)
_图 2：模型文件主要保存权重；推理时还会生成激活。_

如果要压缩数十亿个数，第一步不是立刻讨论某种量化算法，而是理解计算机怎样表示一个数。

### 浮点数怎样保存范围与精度

神经网络通常使用浮点数。按照 IEEE 754 的基本思路，一个浮点数由三个部分组成：

- **符号位（sign）**决定正负；
- **指数位（exponent）**决定数量级，也就是数值范围；
- **尾数位（fraction / mantissa）**保存有效数字，决定精细程度。

![IEEE 754 浮点数的三个部分](/assets/img/tech/quantization-visual-guide/03-ieee754-fields.png)
_图 3：符号、指数和尾数共同编码一个浮点数。_

忽略非规格化数、无穷大和 `NaN` 等特殊情况，一个二进制浮点数可以直观地写成：

$$
x = (-1)^S \times 2^{E-\text{bias}} \times (1+F)
$$

其中 $S$ 是符号位，$E$ 是指数的编码值，$\text{bias}$ 是指数偏置，$F$ 是尾数表示的小数部分。

![由符号、指数和尾数还原数值](/assets/img/tech/quantization-visual-guide/04-ieee754-value.png)
_图 4：三个字段经过组合后得到实际数值。_

位数增加，通常意味着可以表达更多数值，并把相邻可表示数之间的距离压得更小。反过来，位数减少后，很多原本不同的数会落到同一个离散点上。

![位数越多，数值表示越精细](/assets/img/tech/quantization-visual-guide/05-bit-precision.png)
_图 5：更多比特带来更密集的可表示数值。_

### 动态范围、精度与内存

一个数值格式能够覆盖的最小值到最大值称为**动态范围（dynamic range）**；两个相邻可表示数之间的距离反映它的**精度（precision）**。指数位主要影响范围，尾数位主要影响精度，两者争用有限的总位数。

![更多位数可以覆盖更大范围](/assets/img/tech/quantization-visual-guide/06-bits-and-range.png)
_图 6：增加位数后，可表示数的范围与数量都会增长。_

![动态范围与精度是两个不同维度](/assets/img/tech/quantization-visual-guide/07-dynamic-range-precision.png)
_图 7：动态范围描述“能走多远”，精度描述“步子有多细”。_

模型权重的理论存储量可以用一个很朴素的公式估算：

$$
\text{memory(bytes)} = \frac{N_{\text{parameters}} \times b}{8}
$$

$N_{\text{parameters}}$ 是参数数量，$b$ 是每个参数使用的**比特数**。

![由参数量和位宽估算模型内存](/assets/img/tech/quantization-visual-guide/08-memory-formula.png)
_图 8：8 bit 等于 1 byte，因此参数量乘位宽后还要除以 8。_

以 700 亿参数模型为例，只计算权重，`FP32` 每个参数占 4 字节，总量就是约 280 GB；换成 16 bit 后约为 140 GB，8 bit 约为 70 GB，4 bit 则约为 35 GB。

![700 亿参数模型使用 FP32 时的权重内存](/assets/img/tech/quantization-visual-guide/09-llama70b-fp32-memory.png)
_图 9：700 亿个 FP32 权重，仅加载权重就约需 280 GB。_

这个估算只覆盖权重。真实推理还要为 KV cache、激活、临时工作区、运行时开销和可能存在的多份权重副本留出空间；上下文长度和模型架构也会显著改变最终显存需求。

## 量化把连续数值压进有限的格子

量化（quantization）把较高位宽的数值映射到较低位宽的表示，例如从 `FP32` 映射到 `INT8`。低位格式只有有限个格子，所以映射通常伴随信息损失。

![从高精度映射到低精度](/assets/img/tech/quantization-visual-guide/10-quantization-overview.png)
_图 10：多个高精度数值会被压到同一个低精度表示。_

可以把它想成给图片减少颜色。原图拥有连续而丰富的色彩；若只允许使用 8 种颜色，主体仍然可辨认，但局部会出现明显色阶和颗粒感。模型量化面对的是同一个问题：怎样显著减少“颜色”，同时尽可能保留原有信息。

![只用 8 种颜色近似原图](/assets/img/tech/quantization-visual-guide/11-eight-color-analogy.png)
_图 11：颜色数量减少后，整体内容得以保留，细节却变得粗糙。原图由 Maarten Grootendorst 基于 Slava Sidorov 的图片改编。_

### FP16、BF16 与 INT8 各自保留了什么

`FP16` 把 32 bit 浮点数缩短为 16 bit：1 个符号位、5 个指数位和 10 个尾数位。它拥有较多有效数字，但指数位较少，因此动态范围明显小于 `FP32`。

![FP32 与 FP16 的字段对比](/assets/img/tech/quantization-visual-guide/12-fp32-to-fp16.png)
_图 12：FP16 以更小内存换取更窄的动态范围和更低精度。_

`BF16` 同样使用 16 bit，却保留了与 `FP32` 相同的 8 个指数位，只留下 7 个尾数位。它可以覆盖接近 `FP32` 的数量级范围，但有效数字更少。这种取舍对深度学习很实用：训练和推理经常更需要避免上溢、下溢，而不是为每个数保留很多小数位。

![FP32 与 BF16 的字段对比](/assets/img/tech/quantization-visual-guide/13-fp32-to-bf16.png)
_图 13：BF16 像是截短尾数后的 FP32，范围大而精度较粗。_

继续压缩到 `INT8` 后，表示方式从浮点变成整数。一个有符号 8 bit 整数通常只有 256 个取值，即 `[-128, 127]`。它只占 `FP32` 四分之一的空间，但必须先建立浮点值与整数之间的映射。

![FP32 与 INT8 的位宽对比](/assets/img/tech/quantization-visual-guide/14-fp32-to-int8.png)
_图 14：INT8 的存储量只有 FP32 的四分之一。_

整数计算是否更快取决于硬件指令、内核实现、批大小和数据搬运成本。更少位数通常能降低内存带宽压力，但**模型变小并不自动等于端到端推理变快**。

## 线性量化：比例尺与零点

量化不需要把 `FP32` 的全部理论范围映射到 `INT8`。模型权重实际只占其中很小的一段，因此只需找到一个比例尺，把这段数据范围投射到低位整数范围。最常见的基础方案是对称和非对称线性量化。

### 对称量化以零为中心

对称量化把浮点范围映射到以零为中心的整数范围。浮点数 `0` 仍然对应量化后的 `0`，实现简单，也能让许多硬件高效处理。

![以零为中心的对称量化](/assets/img/tech/quantization-visual-guide/15-symmetric-zero-centered.png)
_图 15：量化前后的范围都围绕零对称。_

一种典型做法是绝对值最大量化（absolute maximum quantization，简称 `absmax`）。设输入中的最大绝对值为：

$$
\alpha = \max_i |x_i|
$$

为了让正负两端严格对称，下面使用 `[-127, 127]`，而不是完整的 `INT8` 范围 `[-128, 127]`。

![用最大绝对值确定映射范围](/assets/img/tech/quantization-visual-guide/16-absmax-range.png)
_图 16：最远离零的数决定整组数据的比例尺。_

若目标是有符号 $b$ bit 整数，令 $q_{\max}=2^{b-1}-1$，并采用“量化时乘比例”的记法：

$$
s = \frac{q_{\max}}{\alpha}, \qquad
x_q = \operatorname{clip}\left(\operatorname{round}(s x),-q_{\max},q_{\max}\right)
$$

这里 $s$ 是缩放因子，$x$ 是原始浮点值，$x_q$ 是量化后的整数。

![对称量化的缩放与映射公式](/assets/img/tech/quantization-visual-guide/17-symmetric-formulas.png)
_图 17：先由位宽与最大绝对值计算缩放因子，再把输入映射到整数。_

![代入具体范围计算量化值](/assets/img/tech/quantization-visual-guide/18-symmetric-example.png)
_图 18：同一比例尺应用于这一组数中的每个元素。_

计算时如果需要恢复到浮点域，可以反量化（dequantize）：

$$
\hat{x} = \frac{x_q}{s}
$$

$\hat{x}$ 只是原数 $x$ 的近似值，不可能恢复已经被舍入丢掉的信息。

![对称量化的反量化公式](/assets/img/tech/quantization-visual-guide/19-symmetric-dequantize.png)
_图 19：反量化把整数格子重新缩放到浮点域。_

![完整的量化与反量化过程](/assets/img/tech/quantization-visual-guide/20-quantize-dequantize.png)
_图 20：3.08 和 3.02 被映射为同一个整数后，反量化也无法再区分它们。_

原值与反量化值之间的差就是量化误差：

$$
e_i = x_i - \hat{x}_i
$$

![逐元素计算量化误差](/assets/img/tech/quantization-visual-guide/21-quantization-error.png)
_图 21：量化误差直接反映离散近似丢掉了多少信息。_

一般来说，位数越低，整数格子越少，量化误差越大。但最终模型精度还取决于误差落在哪些权重和激活上，而不只取决于平均误差大小。

### 非对称量化为零设置偏移

现实数据不一定围绕零对称。非对称量化直接把浮点最小值 $\beta$ 和最大值 $\alpha$ 映射到整数范围两端，因此能更充分地利用所有整数格子。

![非对称量化覆盖偏离零的数据范围](/assets/img/tech/quantization-visual-guide/22-asymmetric-range.png)
_图 22：当原始范围为 `[-7.59, 10.8]` 时，零不再位于区间正中。_

设目标整数范围为 $[q_{\min},q_{\max}]$，仍使用“量化时乘比例”的记法：

$$
s = \frac{q_{\max}-q_{\min}}{\alpha-\beta}
$$

$$
z = \operatorname{round}(q_{\min}-s\beta)
$$

$$
x_q = \operatorname{clip}\left(\operatorname{round}(sx+z),q_{\min},q_{\max}\right)
$$

$z$ 称为零点（zero-point），它表示浮点零在整数域中的位置。

![非对称量化需要缩放因子和零点](/assets/img/tech/quantization-visual-guide/23-asymmetric-formulas.png)
_图 23：比例尺负责拉伸范围，零点负责平移位置。_

![把具体范围代入非对称量化](/assets/img/tech/quantization-visual-guide/24-asymmetric-example.png)
_图 24：浮点范围两端被映射到 INT8 的最小值和最大值。_

反量化时同时撤销平移与缩放：

$$
\hat{x}=\frac{x_q-z}{s}
$$

![非对称量化的反量化公式](/assets/img/tech/quantization-visual-guide/25-asymmetric-dequantize.png)
_图 25：先减去零点，再除以缩放因子。_

![对称量化与非对称量化对比](/assets/img/tech/quantization-visual-guide/26-symmetric-vs-asymmetric.png)
_图 26：对称量化固定零点，非对称量化用偏移换取更充分的范围利用。_

非对称方案往往能更贴合偏斜分布，但多了零点运算与元数据。究竟选哪一种，要结合数据分布、硬件内核以及按张量、按通道还是按组量化等粒度判断。

## 离群值决定比例尺，校准决定舍弃什么

若一组数里存在极端离群值，简单的 `absmax` 会让它决定整个比例尺。其余大多数值因此挤在很窄的区间内，映射到低位整数后可能失去彼此差异。

![包含离群值的向量](/assets/img/tech/quantization-visual-guide/27-outlier-vector.png)
_图 27：一个极端值远大于向量里的其他元素。_

![不裁剪时多数小值挤在一起](/assets/img/tech/quantization-visual-guide/28-outlier-no-clipping.png)
_图 28：为了容纳离群值，整数格子被浪费在大多数数据不会出现的范围。_

解决办法之一是裁剪（clipping）：主动选取较窄的动态范围，把超出上下界的数截到边界。假设把范围设为 `[-5, 5]`，所有小于 `-5` 的数都映射到负端，所有大于 `5` 的数都映射到正端。

![裁剪离群值后的量化范围](/assets/img/tech/quantization-visual-guide/29-clipping-range.png)
_图 29：牺牲少数离群值的精度，换取多数普通值更细的量化步长。_

这不是免费午餐：非离群值的误差减小了，离群值的误差却会显著增加。**校准（calibration）**就是选择量化范围与参数的过程，目标是在保留数据覆盖率和降低总体误差之间找到合适平衡。

### 权重和偏置是模型保存下来的规则

权重 $W$ 和偏置 $b$ 是训练学到并写入模型文件的参数。模型加载完成后，它们在普通推理过程中保持不变，因此可以提前完整读取和分析。量化权重时，也就能够直接观察每层或每组权重的分布。

![模型文件中的静态权重与偏置](/assets/img/tech/quantization-visual-guide/30-static-weights.png)
_图 30：权重在推理前已经确定，适合离线校准。_

常见范围选择方法包括：

- 用某个百分位数裁掉分布尾部；
- 最小化原权重与反量化权重之间的均方误差（MSE）；
- 最小化原分布与量化分布之间的 KL 散度等统计距离。

![按百分位选择裁剪范围](/assets/img/tech/quantization-visual-guide/31-percentile-calibration.png)
_图 31：百分位法不会让极少数尾部数值无限拉宽比例尺。_

### 激活是当前输入经过规则计算出的结果

激活值不是模型里另一组固定参数，而是模型处理**当前输入**时临时算出的中间结果。以最简单的一层神经网络为例：

$$
z=Wx+b, \qquad a=f(z)
$$

$x$ 是当前层收到的输入，$W$ 是权重，$b$ 是偏置，$z$ 是线性计算结果；$f$ 是 ReLU 等激活函数，$a$ 是经过它处理后的激活值。

| 对象 | 在计算中的作用 | 普通推理时是否变化 |
|---|---|---|
| 输入 $x$ | 当前层正在处理的数据 | 随提示词、token 和上一层结果变化 |
| 权重 $W$ | 决定怎样组合输入 | 固定 |
| 偏置 $b$ | 对组合结果做整体平移 | 固定 |
| 激活 $z$ 或 $a$ | 这套规则处理当前输入后得到的中间状态 | 随输入和所在层变化 |

假设一个神经元的参数是：

$$
W=[0.6,-0.4], \qquad b=0.1
$$

当输入为 $x=[2,-1]$ 时：

$$
z=0.6\times2+(-0.4)\times(-1)+0.1=1.7
$$

$$
a=\operatorname{ReLU}(1.7)=1.7
$$

如果换成输入 $x'=[0.2,3]$，仍然使用同一组 $W$ 和 $b$：

$$
z'=0.6\times0.2+(-0.4)\times3+0.1=-0.98
$$

$$
a'=\operatorname{ReLU}(-0.98)=0
$$

权重和偏置没有变化，激活却从 `1.7` 变成了 `0`。因此可以把 **$W$ 和 $b$ 理解成固定的加工规则，把激活理解成这套规则处理当前输入后产生的中间产品**。一层的激活会成为下一层的输入，于是中间状态沿网络逐层流动。

![输入经过网络各层产生激活](/assets/img/tech/quantization-visual-guide/32-activations.png)
_图 32：激活沿网络逐层生成，并继续作为下一层的输入。_

在 Transformer 量化语境里，“激活”通常是一个宽泛称呼，不一定只指紧跟 ReLU、SiLU 等函数之后的数值。各层的输入与输出、隐藏状态以及 Q、K、V 等运行时中间张量，经常都被统称为激活。

![激活分布随输入和层而变化](/assets/img/tech/quantization-visual-guide/33-changing-activations.png)
_图 33：推理前无法像读取权重一样穷举所有可能的激活。_

### 激活为什么也值得量化

激活虽然不像权重那样长期驻留，但计算当前层时，GPU 仍要同时容纳输入激活、输出激活和若干临时张量。单个激活张量的大小可以粗略估算为：

$$
\text{activation memory}
=B\times T\times H\times \text{bytes per value}
$$

$B$ 是 batch size，$T$ 是序列长度，$H$ 是隐藏维度。把激活从 `FP16` 的 16 bit 量化到 `INT8`，这部分张量的理论内存占用与搬运数据量都会减半。

量化激活通常有三个目的：

1. **降低运行时峰值显存。** 激活用完后可以释放或复用，但当前计算所需的中间张量仍会占显存；训练时还要为反向传播保留许多激活。
2. **减少显存带宽压力。** GPU 计算 $Y=XW$ 时，必须把激活 $X$ 和权重 $W$ 搬进计算单元。低位数据更小，同一时间可以传输更多元素。
3. **使用低精度矩阵乘法。** 例如 `W8A8` 同时使用 INT8 权重和 INT8 激活，在有对应指令与高效内核的硬件上，可以直接执行低精度计算。

不同推理阶段的收益并不相同。大 batch 或长序列的 prefill 会同时处理许多 token，激活可能形成可观的峰值显存；逐 token 解码时，普通临时激活相对较小，长期驻留的权重和随上下文增长的 KV cache 往往更加突出。

KV cache 保存的是由激活计算出来的 K、V 张量，但它会跨生成步骤长期保留，因此通常把 **KV cache 量化**作为一个独立问题讨论。激活量化主要处理当前层正在流动的中间数据，KV cache 量化主要压缩需要随上下文一起保存的数据。

因此，讨论“一个 4 bit 模型”时还不够明确。需要继续问：只量化权重，还是同时量化激活？缩放因子是每个张量一个、每个通道一个，还是每个小组一个？例如 `W4A16` 表示 4 bit 权重配 16 bit 激活，主要压缩模型权重；`W8A8` 则让权重与激活都进入 8 bit 计算。二者的显存收益、精度风险与硬件要求完全不同。

## 训练后量化：动态和静态处理激活的方式

训练后量化（Post-Training Quantization，`PTQ`）在模型训练完成后执行，不要求从头训练模型。权重是已知的，可以直接用对称或非对称方式量化；激活范围未知，则通常分为动态与静态两条路线。

### 动态量化在运行时观察当前数据

动态量化（dynamic quantization）在推理过程中，根据当前输入或当前激活张量的实际分布计算缩放因子和零点。

![动态量化先收集当前激活](/assets/img/tech/quantization-visual-guide/34-dynamic-quantization-collect.png)
_图 34：数据通过一层后，运行时得到这一层的激活分布。_

![由当前激活计算量化参数](/assets/img/tech/quantization-visual-guide/35-dynamic-quantization-parameters.png)
_图 35：当前张量的范围决定本次量化使用的 $s$ 与 $z$。_

这种方式更能适应输入变化，通常比一套固定参数稳健，但计算最小值、最大值、缩放因子以及执行量化本身都会增加运行时开销。具体实现可能按张量、token 或其他粒度更新参数，并不只是笼统地“每个隐藏层一个参数”。

### 静态量化提前用代表性数据校准

静态量化（static quantization）先准备一份有代表性的校准数据集，让样本通过模型，收集各处激活的典型分布，再提前确定量化参数。

![用校准集提前估计激活范围](/assets/img/tech/quantization-visual-guide/36-static-quantization.png)
_图 36：部署前收集分布，部署时直接复用已经确定的量化参数。_

静态方案省去了运行时估计范围的成本，更容易获得稳定吞吐；代价是它依赖校准数据的代表性。如果真实输入与校准集偏差很大，固定范围就可能频繁裁剪数据，或者浪费大量整数格子。

动态与静态并不是绝对的“精度高/速度慢”和“精度低/速度快”二分。最终表现仍取决于算子、量化粒度、后端内核、数据分布和部署硬件。

## 进入 4 bit：GPTQ 与 GGUF 生态

从 8 bit 继续降低到 4 bit 时，每组数可用的离散格子急剧减少，朴素舍入带来的误差更难控制。实践中常见两类名字是 `GPTQ` 与 `GGUF`，但它们不处于同一个概念层级：**GPTQ 是量化方法，GGUF 是承载模型张量与元数据的文件格式。**

### GPTQ 用二阶信息补偿误差

[GPTQ](https://arxiv.org/abs/2210.17323) 是一种一次性的训练后权重量化方法。它逐层处理模型，并利用少量校准数据近似损失函数的二阶信息，估计某个权重发生变化时，对这一层输出会有多大影响。

![GPTQ 逐层执行权重量化](/assets/img/tech/quantization-visual-guide/37-gptq-layerwise.png)
_图 37：一层完成量化后，再继续处理下一层。_

二阶敏感度由 Hessian（损失对权重的二阶导数矩阵）及其逆矩阵近似表达。直觉上，模型对不同方向的权重扰动敏感程度不同，因此同样大小的舍入误差，造成的损失增长也不同。

![逆 Hessian 表示权重敏感度](/assets/img/tech/quantization-visual-guide/38-gptq-inverse-hessian.png)
_图 38：图中用逆 Hessian 的数值帮助判断哪些权重更不能随意改变。_

GPTQ 先量化一个权重，得到它与反量化近似值之间的误差。

![量化当前权重并计算误差](/assets/img/tech/quantization-visual-guide/39-gptq-quantize-first-weight.png)
_图 39：当前权重被固定到低位格点后，会留下无法消除的局部误差。_

![按敏感度对量化误差加权](/assets/img/tech/quantization-visual-guide/40-gptq-weighted-error.png)
_图 40：同样大小的数值误差，对高敏感度权重和低敏感度权重影响不同。_

关键步骤不是孤立地接受这个误差，而是依据逆 Hessian 中的相关关系，更新尚未量化的其余权重，让它们共同补偿当前误差，尽量维持这一层原来的输出。

![把误差补偿到后续权重](/assets/img/tech/quantization-visual-guide/41-gptq-redistribute-second.png)
_图 41：第二个权重根据相关性吸收一部分误差。_

![继续量化并重新分配误差](/assets/img/tech/quantization-visual-guide/42-gptq-redistribute-third.png)
_图 42：重复量化与补偿，直到当前块或当前层处理完成。_

论文实现还通过阻尼、批量更新、Cholesky 分解和缓存计算结果降低成本。GPTQ 能把大模型权重压到 3 或 4 bit，并在论文实验中保持很小的精度损失。不过，压缩后的权重能否真正加速推理，仍取决于是否存在匹配量化布局的高效 GPU 内核。

### GGUF 是容器，Q4_K 才是量化编码

`GGUF` 来自 GGML / llama.cpp 生态。按照 [GGUF 官方规范](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md)，它是一种面向推理的二进制模型文件格式，负责把运行模型所需的信息装进一个可快速读取的文件：

```text
GGUF 文件
├── 模型元数据
│   ├── 模型架构、层数、隐藏维度
│   ├── tokenizer 与上下文长度
│   └── 量化版本等信息
├── 张量目录
│   ├── 张量名称与形状
│   ├── 数据类型：F16、Q4_K、Q6_K……
│   └── 张量数据在文件中的位置
└── 真正的张量数据
```

因此，**GGUF 本身不是量化算法**。同一个 GGUF 文件里可以同时保存 `F16`、`Q4_K`、`Q6_K` 等不同类型的张量；真正决定每组权重怎样压缩的是 `Q4_K`、`Q6_K` 等张量编码。

典型处理流程是先把 Hugging Face 等格式的模型转换成高精度 GGUF，再用 [`llama-quantize`](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md) 量化其中的权重：

```text
FP16 / BF16 原模型
        ↓ 转换格式
高精度 GGUF
        ↓ llama-quantize，例如选择 Q4_K_M
量化后的 GGUF
        ↓ llama.cpp
在 CPU / GPU 上加载并推理
```

GGUF 文件保存的是模型参数，不会预先保存尚未产生的运行时激活。激活量化和 KV cache 量化由推理运行时另行处理。

#### 为什么 Q4_K 要把权重分块

假设一行权重中有两组分布相差很大的数：

```text
[-0.9, -0.8, 0.1, 0.2 | 4.8, 5.0, 5.1, 5.2]
```

如果八个权重共用一个比例尺，它必须覆盖 `-0.9～5.2`。前半组会被挤在很窄的范围内，多个不同数值很容易落进同一个低位格子。

将它们拆成两个局部块后，每块可以使用自己的最小值和比例尺：

```text
块 1：[-0.9, -0.8, 0.1, 0.2] → scale₁、min₁
块 2：[ 4.8,  5.0, 5.1, 5.2] → scale₂、min₂
```

对某个块，可以用非对称线性量化的形式把权重映射为 4 bit 整数：

$$
q=\operatorname{clip}\left(
\operatorname{round}\left(\frac{w-\text{min}}{\text{scale}}\right),
0,15
\right)
$$

反量化近似为：

$$
\hat w=q\times\text{scale}+\text{min}
$$

不同实现对最小值的符号和公式写法有所不同，但共同思想不变：**权重只保存低位整数，每个局部块再保存恢复数值所需的缩放与偏移信息。**

![GGUF 生态中的超块与子块](/assets/img/tech/quantization-visual-guide/43-gguf-blocks.png)
_图 43：分块让每一小组权重都能使用更贴近自身分布的比例尺。_

#### Q4_K 使用两级分块

根据 llama.cpp 的 [张量编码说明](https://github.com/ggml-org/llama.cpp/wiki/Tensor-Encoding-Schemes)，一个 `Q4_K` 超块包含 256 个权重，并沿矩阵乘法的累加维度拆成 8 个子块，每个子块包含 32 个权重：

```text
一个 Q4_K 超块：256 个权重
│
├── 子块 1：32 个权重 → 局部 scale₁、min₁
├── 子块 2：32 个权重 → 局部 scale₂、min₂
├── ……
└── 子块 8：32 个权重 → 局部 scale₈、min₈
```

每个权重被编码为 `0～15` 之间的 4 bit 整数。计算时，它和所在子块的局部比例尺、偏移共同近似原权重：

$$
\hat w_i=q_i\times\text{scale}_j+\text{offset}_j
$$

$j$ 是权重 $i$ 所在的子块。相比让 256 个数共用一套参数，32 个一组的局部映射更能贴合每段权重的实际分布。

![对子块权重执行量化](/assets/img/tech/quantization-visual-guide/44-gguf-subblock.png)
_图 44：子块缩放因子把 32 个局部权重映射到低位整数。_

#### 比例尺本身也会被量化

小块改善了精度，却引入了新的存储开销：8 个子块各自需要保存 `scale` 和 `min`。如果这些参数全用 FP16，元数据会吃掉相当一部分压缩收益。

`Q4_K` 因此继续量化这 8 组局部参数：

- 每个权重使用 4 bit；
- 每个子块的局部 `scale` 和 `min` 被量化成 6 bit；
- 整个超块再保存两个 FP16 参数 `d` 与 `dmin`，用于恢复这些局部 `scale` 和 `min`。

也就是说，它形成了两层比例关系：

```text
超块 FP16 参数 d、dmin
        ↓ 恢复
8 个子块的 6-bit scale、min
        ↓ 恢复
256 个权重的 4-bit q
```

![用超块比例尺量化子块比例尺](/assets/img/tech/quantization-visual-guide/45-gguf-scale-quantization.png)
_图 45：权重被量化，描述权重比例尺的元数据也被继续量化。_

这正是图中 `s_super` 和 `s_sub` 的关系：`s_sub` 负责恢复一个小块里的权重，`s_super` 负责恢复已经被低位化的 `s_sub`。在 [llama.cpp 的 `block_q4_K` 数据结构](https://github.com/ggml-org/llama.cpp/blob/master/ggml/src/ggml-common.h)中，256 个权重的存储组成是：

| 内容 | 大小 |
|---|---:|
| 256 个 4-bit 权重 | 128 字节 |
| 8 组 6-bit scale 与 min | 12 字节 |
| FP16 的 `d` 与 `dmin` | 4 字节 |
| **总计** | **144 字节** |

平均每个权重占用：

$$
\frac{144\times8}{256}=4.5\text{ bit/weight}
$$

所以 `Q4_K` 名称里的“4”表示每个权重主体使用 4 bit；算上恢复权重所需的分块元数据，实际平均约为 **4.5 bit/weight**。

![不同位宽的分块量化布局](/assets/img/tech/quantization-visual-guide/46-gguf-levels.png)
_图 46：2 bit、4 bit、6 bit 方案会为权重、缩放因子和最小值分配不同位宽。_

更小的块通常更贴合局部分布、降低量化误差，但每个块都要保存比例尺等元数据；块过小又会让元数据占比升高。`Q2_K`、`Q4_K`、`Q6_K` 等编码正是在局部精度、文件体积和解码效率之间选择不同平衡。

#### Q4_K_M 是模型级混合预设

`Q4_K_M.gguf` 也不能简单理解成“文件中所有张量都是 Q4_K”：

- `Q4_K` 是一种具体的张量分块编码；
- `Q4_K_M` 是模型级量化预设，可以让不同张量使用不同精度；
- `M`、`S` 表示不同的混合方案，而不是给每个权重再增加一个字段；
- `llama-quantize --pure` 才会关闭默认的 K-quant 混合策略，尽量把可量化张量统一为指定类型。

这种混合安排允许模型把大量普通权重压得更低，同时为敏感张量保留较高精度。因此，文件名描述的是主要量化档位，而不是每一个张量的绝对类型。

#### 推理时按块解码，不会展开整个模型

加载 GGUF 时，运行时从张量目录知道每个张量的形状、位置和 `Q4_K` 等编码类型。量化权重通常继续以紧凑形式保存在内存或显存中；矩阵乘法内核读取一个块后，解析其中的 4-bit 权重和比例尺，并在点积过程中解码或反量化，不需要先把整个模型完整展开为 FP16。

```text
读取 Q4_K 权重块
      ↓
取出 q、局部 scale/min、超块 d/dmin
      ↓
在计算内核中恢复当前块的近似权重
      ↓
立即参与当前点积
```

因此，模型的内存与显存压缩收益可以一直保留到推理阶段。至于哪些层放在 CPU、哪些层卸载到 GPU，是 `llama.cpp` 等运行时根据参数和设备能力执行的策略；GGUF 提供可快速读取和映射的文件布局，但不自动决定设备放置。

**Q4_K 的关键取舍可以归结为两句话：用 32 个权重一组的局部比例尺换取精度，再用 256 个权重一组的超块比例尺压缩这些局部比例尺的开销。GGUF 则负责把量化结果、张量类型和完整模型信息稳定地装进同一个文件。**

## 量化感知训练：让模型在训练时适应格子

PTQ 面对的是已经训练完成的高精度模型，只能在事后尽量减少压缩损失。量化感知训练（Quantization-Aware Training，`QAT`）把量化影响直接放进训练或微调过程，让模型学会在低精度约束下找到更合适的参数。

![PTQ 与 QAT 的发生时机](/assets/img/tech/quantization-visual-guide/47-ptq-vs-qat.png)
_图 47：PTQ 在训练后压缩，QAT 在训练过程中模拟量化。_

QAT 通常使用伪量化（fake quantization）：前向传播时把高精度权重或激活量化到例如 `INT4`，随后再反量化回浮点数参与普通算子计算。这样既能让前向结果包含量化误差，又能继续使用成熟的浮点训练基础设施。

![QAT 中的伪量化](/assets/img/tech/quantization-visual-guide/48-qat-fake-quant.png)
_图 48：量化后立即反量化，数值仍是浮点格式，但已经落在低位格点上。_

舍入函数几乎处处不可导，反向传播通常借助直通估计器（Straight-Through Estimator，`STE`），用近似梯度穿过量化操作。模型因此能更新参数，主动降低未来部署到低精度后产生的损失。

一个有用的几何直觉是寻找更宽的极小值。高精度下，一个狭窄谷底可能拥有最低损失，却对轻微权重扰动极其敏感；量化把权重推到附近格点后，损失会快速升高。更宽的谷底在高精度下未必最低，但对离散化扰动更稳健。

![狭窄极小值和宽阔极小值](/assets/img/tech/quantization-visual-guide/49-narrow-wide-minima.png)
_图 49：同样大小的量化位移，在狭窄谷底会造成更大损失。_

![QAT 倾向选择量化后损失更低的位置](/assets/img/tech/quantization-visual-guide/50-qat-wide-minimum.png)
_图 50：QAT 优化的是低精度部署后的效果，而不只是高精度权重的最低训练损失。_

QAT 往往比 PTQ 更能保持低位精度，但代价也更高：需要训练数据、训练算力、可修改的模型流程和更复杂的工程验证。

## BitNet：把低位约束写进 Transformer

[BitNet](https://arxiv.org/abs/2310.11453) 不再从一个训练完成的普通 Transformer 出发，而是直接设计适合 1 bit 权重的网络。Transformer 中绝大多数参数位于线性层，线性层也承担大量矩阵乘法，因此 BitNet 首先改造这里。

![Transformer 中的线性层](/assets/img/tech/quantization-visual-guide/51-transformer-linear-layers.png)
_图 51：注意力和前馈网络都大量依赖线性层。_

BitNet 用 `BitLinear` 替代普通线性层。接口仍然接收激活、执行权重与激活的线性变换，但前向计算使用二值权重，并对激活做低位量化。

![用 BitLinear 替换普通线性层](/assets/img/tech/quantization-visual-guide/52-bitlinear-replacement.png)
_图 52：Transformer 的整体结构不变，主要替换内部线性层。_

![BitLinear 使用 1 bit 权重和 8 bit 激活](/assets/img/tech/quantization-visual-guide/53-bitlinear-precisions.png)
_图 53：权重约束为两个值，激活保留更高的 INT8 精度。_

训练时仍保留用于优化的高精度潜在参数和优化器状态，在前向传播中执行伪量化；不能简单理解为整个训练过程只保存 1 bit 权重。

![BitLinear 训练时模拟权重和激活量化](/assets/img/tech/quantization-visual-guide/54-bitlinear-fake-quant.png)
_图 54：权重与激活分别量化，矩阵乘法后再按记录的尺度恢复输出。_

### 权重量化

二值权重量化先让权重分布围绕零居中，再用符号函数把负数映射为 `-1`、非负数映射为 `1`。同时记录权重绝对值的平均值 $\beta$，用于恢复输出尺度。

![BitNet 的二值权重量化](/assets/img/tech/quantization-visual-guide/55-bitnet-weight-quantization.png)
_图 55：连续权重被压到 `{-1, 1}` 两个取值。_

### 激活量化

激活需要保留更多信息，因此使用 `absmax` 从较高精度映射到 `INT8`，并记录最大绝对值 $\alpha$。

![BitNet 的 INT8 激活量化](/assets/img/tech/quantization-visual-guide/56-bitnet-activation-quantization.png)
_图 56：激活量化保留 8 bit，并记录恢复尺度所需的最大绝对值。_

### 输出反量化

矩阵乘法结束后，利用权重尺度 $\beta$ 与激活尺度 $\alpha$ 对输出重新缩放，得到高精度激活并传给后续计算。

![BitNet 输出的反量化](/assets/img/tech/quantization-visual-guide/57-bitnet-dequantization.png)
_图 57：前向路径虽然使用低位权重和激活，层输出仍可恢复到高精度域。_

原始 BitNet 实验显示，模型规模增大后，1 bit 模型与 FP16 基线的差距会缩小；但小模型的差距仍然明显，而且论文结果不等于任意既有模型都能在训练后直接变成等价的 1 bit 模型。

## BitNet b1.58：零把乘法变成选择

[BitNet b1.58](https://arxiv.org/abs/2402.17764) 在 `-1` 和 `1` 之外加入 `0`，把权重变成三值 `{-1, 0, 1}`。三个等概率状态所需的信息量是 $\log_2 3 \approx 1.58$ bit，这就是名称的来源。

普通矩阵乘法需要把每个输入乘以对应权重，再把结果相加。

![普通线性层中的乘法与加法](/assets/img/tech/quantization-visual-guide/58-matrix-multiplication.png)
_图 58：每个权重都参与乘法，乘积随后求和。_

三值权重则可以解释成三种操作：

- `1`：把这个输入加进结果；
- `0`：忽略这个输入；
- `-1`：从结果中减去这个输入。

在专门优化的内核或硬件上，这种表示有机会用加减与跳过代替通用乘法，同时让 `0` 承担稀疏选择作用。

![三值权重只需加、减或跳过](/assets/img/tech/quantization-visual-guide/59-ternary-addition.png)
_图 59：权重本身直接决定对输入执行加法、减法还是忽略。_

BitNet b1.58 的权重量化使用绝对均值量化（`absmean`）。它以权重绝对值的均值确定尺度，再把归一化结果舍入和裁剪到 `-1`、`0`、`1`。

![BitNet b1.58 的 absmean 量化](/assets/img/tech/quantization-visual-guide/60-bitnet-absmean.png)
_图 60：加入零后，小权重可以直接被映射为“不参与计算”。_

激活量化仍沿用类似 `absmax` 的思路，但使用围绕零对称的整数范围。论文报告称，在其模型、训练规模和测量设置下，13B 的 BitNet b1.58 在延迟、内存与能耗方面可以优于 3B 的 FP16 模型。这个结果展示了从头训练低位模型的潜力，但真正获得理论上的乘法削减，仍需要匹配的数据布局、算子内核和硬件支持。

## 评价

### 写得好的地方

原文最出色的地方是**用同一套视觉语言把抽象数值表示、线性映射和实际算法连成一条理解链**。它没有一上来堆砌 GPTQ、GGUF、QAT 等名词，而是先从比特、动态范围、精度与内存讲起，再用颜色减少、数轴映射和离群值逐步建立直觉。60 张教学图并非装饰，而是在公式第一次出现时承担了解释任务，尤其是对称/非对称量化、误差补偿和三值矩阵乘法几组图，显著降低了理解门槛。

文章选择的贯穿矛盾也很清楚：**位数越少，存储和计算潜力越好；格子越少，近似误差越难控制。** 从裁剪、校准到 GPTQ 的误差重分配，再到 QAT 让训练主动适应误差，后续方法都能回到这个矛盾上，因此读者容易形成整体框架，而不是只记住一串算法名。

### 可以改进的地方

原文为了可视化直觉做了一些过度简化，阅读时需要补上边界：

- **GGUF 不是一种量化算法。** 它是模型文件格式，可以承载多种量化数据类型；CPU/GPU 分层卸载主要是 `llama.cpp` 等运行时的能力。原文展示的超块、子块和嵌套比例尺更接近具体的 K-quant 方案，不能推广为所有 GGUF 文件的统一量化流程。
- **动态量化不只是“每个隐藏层计算一次参数”。** 参数可能按张量、通道、token 或其他粒度计算，精度与开销也不能仅凭“动态/静态”标签判断。
- **低位并不天然加速。** 模型文件更小、显存占用更低通常成立，但实际延迟还受反量化、内存带宽、批大小、算子融合和专用内核影响。没有匹配硬件时，理论上更少的乘法也未必兑现为端到端速度。
- **GPTQ 与 BitNet 的适用阶段不同。** GPTQ 面向已有高精度模型的训练后权重量化；BitNet 则从训练阶段就改变线性层和数值约束。把两者只按“4 bit”和“1 bit”排列，容易忽略部署压缩与从头训练新架构之间的成本差异。
- **部分实现性描述不够严谨。** 公式里的 $b$ 应是比特数而不是字节数；BitNet 训练也不能理解为只保存二值权重，训练所需的潜在参数、梯度和优化器状态通常仍使用更高精度。

把这些边界补齐后，这篇文章仍然是一份非常优秀的量化入门地图：它最适合帮助读者建立直觉，再以 [GPTQ 论文](https://arxiv.org/abs/2210.17323)、[BitNet 论文](https://arxiv.org/abs/2310.11453)、[BitNet b1.58 论文](https://arxiv.org/abs/2402.17764) 和具体推理框架文档继续深入实现细节。
