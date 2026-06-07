---
title: "【Anthropic】Claude Code 在大型代码库中的工作原理：Harness 架构与部署模式"
date: 2026-06-07 18:31:51 +0800
categories: [ai, claude]
tags: [claude code, large codebase, harness, enterprise]
description: "Claude Code 不靠 RAG 而是用 agentic search 导航代码库，真正决定效果的是围绕模型构建的 harness——七个扩展点加三个部署模式"
---

1. Table of Contents, ordered
{:toc}

> 原文：[How Claude Code works in large codebases: Best practices and where to start](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)

本文是 Anthropic "Claude Code at scale" 系列的第一篇，覆盖的场景包括：百万行级 monorepo、几十年历史的遗留系统、跨数十个仓库的分布式架构，以及数千名开发者的组织。语言方面，C/C++/C#/Java/PHP 同样适用，尤其是最近几次模型发布之后效果超出多数团队预期。

# Claude Code 如何导航大型代码库

Claude Code 的导航方式和工程师一样：遍历文件系统、读文件、用 grep 精确查找、跟踪跨文件引用。它在开发者本地机器上运行，**不需要构建、维护或上传代码库索引**。

## Agentic search vs RAG

RAG 方案把整个代码库做 embedding，查询时检索相关片段。在大规模场景下 RAG 容易失败——embedding 管线跟不上活跃的工程团队，索引可能滞后数小时甚至数周。开发者查到的可能是两周前已重命名的函数或上个 sprint 删掉的模块，而且没有任何过时提示。

Agentic search 避免了这些问题：没有 embedding 管线，没有集中索引需要维护，每个开发者的实例直接在实时代码库上工作。

## 代价与应对

这种方式有一个 tradeoff：Claude 需要足够的起始上下文来知道"往哪里看"。如果你让它在十亿行代码库里搜索一个模糊模式，还没开始工作就会撞上上下文窗口限制。**在代码库配置（setup）上投入越多的团队，效果越好。**

# Harness 比模型本身更重要

关于 Claude Code 最常见的误解是：它的能力完全取决于所用模型。实际上，围绕模型构建的生态——**harness**——对 Claude Code 表现的决定性影响远超模型本身。

Harness 由五个扩展点构成——CLAUDE.md、hooks、skills、plugins、MCP servers——再加上两个额外能力：LSP 集成和 subagents。构建顺序有讲究，每一层都建立在前一层之上。

## CLAUDE.md：首先搭建

上下文文件（context file），每次会话自动加载：根目录文件提供全局概览，子目录文件提供局部约定。因为每次会话都会加载，所以要**保持精简**，只放普遍适用的内容，避免拖慢性能。

## Hooks：让配置自我进化

多数团队只把 hooks 理解为"防止 Claude 犯错的脚本"，但更有价值的用法是**持续改进**：

- **Stop hook**：会话结束时反思发生了什么，提议更新 CLAUDE.md（趁上下文还在）
- **Start hook**：动态加载团队特定上下文，让每个开发者自动获得正确配置
- 自动化检查（lint、format）：用 hooks 确定性地执行，比期望 Claude "记住一条指令"更稳定

## Skills：按需加载专业知识

大型代码库有几十种任务类型，不是所有知识都需要出现在每次会话中。Skills 通过**渐进式披露（progressive disclosure）**解决这个问题——把专业工作流和领域知识卸载到需要时才加载的包里。例如安全审查 skill 只在评估漏洞时加载，文档更新 skill 只在代码变更后加载。

Skills 还可以绑定到特定路径：支付团队的部署 skill 绑到对应目录，在 monorepo 其他位置工作时不会自动加载。

## Plugins：把好配置分发出去

大型代码库中好的配置容易停留在"部落知识"阶段。Plugin 把 skills、hooks、MCP 配置打包成一个可安装的单元——新工程师第一天安装 plugin，就能立刻拥有和老手一样的上下文与能力。Plugin 更新可通过组织的托管市场（managed marketplace）分发。

案例：一家大型零售企业构建了一个连接内部分析平台的 skill，让业务分析师不离开工作流就能拉取绩效数据，在全面推广前以 plugin 形式分发。

## LSP 集成：符号级精确导航

多数大型代码库的 IDE 已经有运行中的 LSP，提供 "go to definition" 和 "find all references"。把这些能力暴露给 Claude，它就能：跟踪函数调用到定义处、跨文件追溯引用、区分不同语言中同名函数。

没有 LSP 时，Claude 靠文本模式匹配，可能落到错误的符号上。一家企业软件公司在 Claude Code 大规模推广之前，专门在组织层面部署了 LSP 集成，就是为了让 C/C++ 导航在大规模下可靠工作。**对于多语言代码库，这是投资回报率最高的配置之一。**

设置方式：安装对应语言的 code intelligence plugin 和相应的 language server 二进制文件。Claude Code 文档涵盖了可用的插件和故障排查。

## MCP Servers：连接一切外部工具

MCP servers 是 Claude 连接内部工具、数据源和 API 的方式。最成熟的团队构建了暴露结构化搜索的 MCP server，让 Claude 可以直接调用。其他团队则把 Claude 连接到内部文档系统、工单系统或分析平台。

## Subagents：分离探索与编辑

Subagent 是拥有独立上下文窗口的隔离 Claude 实例——接受任务、完成工作、只把最终结果返回给父 agent。Harness 就位后，一些团队会先启动一个只读 subagent 去映射子系统并把发现写入文件，然后让主 agent 带着完整全景去编辑。

## 扩展点对照表

| 组件 | 定义 | 加载时机 | 最适合 | 常见误区 |
|------|------|---------|--------|---------|
| CLAUDE.md | 自动读取的上下文文件 | 每次会话 | 项目约定、代码库知识 | 把该放 skill 里的专业知识塞进来 |
| Hooks | 在关键时刻运行的脚本 | 事件触发 | 自动化一致行为、捕获会话收获 | 用 prompt 做应该自动执行的事 |
| Skills | 特定任务类型的打包指令 | 按需、相关时 | 跨会话跨项目的可复用专业知识 | 什么都往 CLAUDE.md 里塞 |
| Plugins | 捆绑 skills + hooks + MCP 配置 | 配置后始终可用 | 在组织内分发有效配置 | 让好配置停留在部落知识 |
| LSP* | 通过语言服务器的实时代码智能 | 配置后始终可用 | 强类型语言的符号导航和错误检测 | 以为它会自动启用 |
| MCP Servers | 连接外部工具和数据 | 配置后始终可用 | 让 Claude 访问无法触达的内部工具 | 在基础配置没做好前就搞 MCP |
| Subagents* | 独立的 Claude 实例处理特定任务 | 调用时 | 分离探索与编辑、并行工作 | 在同一个会话里混合探索和编辑 |

*LSP 通过 plugin 层访问。Subagents 是委托能力而非配置式扩展点。

# 成功部署的三个配置模式

## 模式一：让代码库在大规模下可导航

Claude 在大型代码库中的帮助能力，上限取决于它找到正确上下文的能力。每次会话加载太多上下文会拖慢性能，太少则让 Claude 盲目导航。最有效的部署在前期投入让代码库对 Claude "可读"：

- **CLAUDE.md 精简分层**：根文件只放指针和关键 gotcha，其他内容会变成噪音。Claude 在代码库中移动时会叠加加载路径上所有 CLAUDE.md。
- **从子目录初始化，而非仓库根目录**：Claude 在作用域限定到任务相关部分时效果最好。Monorepo 中这可能反直觉（工具通常假设从 root 访问），但 Claude 会自动向上遍历目录树加载沿途的 CLAUDE.md，根级上下文不会丢失。
- **按子目录限定 test 和 lint 命令**：修改一个 service 却跑全量测试会导致超时，浪费上下文在无关输出上。子目录 CLAUDE.md 应指定适用于该部分代码的命令。这对 service-oriented（服务化）代码库效果最好，每个目录有独立的测试和构建命令；在编译型语言 monorepo 中跨目录依赖较深时，按子目录限定较难实现，可能需要项目特定的构建配置。
- **用 `.claudeignore` 和 `permissions.deny` 排除生成文件、构建产物、第三方代码**：把排除规则提交到 `.claude/settings.json` 意味着版本控制，团队每个人自动获得相同的降噪配置。需要在生成代码上开发的人可在本地 settings 中覆盖，不影响团队。
- **构建 codebase map**：当目录结构本身不够说明问题时，在仓库根放一个轻量 markdown 文件，列出每个顶层文件夹和一行描述。对于数百个顶层文件夹的代码库，最好分层：根文件只描述最高层结构，子目录 CLAUDE.md 提供下一级细节，按需加载。对于更简单的场景，`@-mentioning`（@ 提及）Claude 应该引用的特定文件或目录可以达到同样目的。
- **运行 LSP server，让 Claude 按符号搜索而非字符串搜索**：grep 常见函数名在大代码库里返回数千结果，Claude 会烧掉上下文去逐个打开文件判断哪个重要。LSP 只返回指向同一符号的引用，过滤在 Claude 读任何东西之前就已完成。

**注意**：存在层级式 CLAUDE.md 方案也失效的边缘场景，比如数十万文件夹、数百万文件的代码库，或使用非 git 版本控制的遗留系统。系列后续文章会专门讨论。

## 模式二：随模型演进主动维护 CLAUDE.md

模型在进化，为当前模型写的指令可能在未来模型上适得其反。比如一条规则要求 Claude 把每次重构拆成单文件修改——这对早期模型有帮助，但会阻止新模型执行它已经能处理好的协调性跨文件编辑。

为补偿特定模型局限而构建的 skills 和 hooks，一旦局限不再存在就变成了开销。例如一个在 Perforce 代码库中拦截文件写入强制执行 `p4 edit` 的 hook，在 Claude Code 原生支持 Perforce 后就多余了。

**建议**：每 3-6 个月做一次有意义的配置审查，在重大模型发布后如果感觉性能停滞也应该做一次。

## 模式三：为 Claude Code 管理和采纳分配所有权

技术配置不能单独驱动采纳。做得好的组织也投入了组织层面的建设。

传播最快的 rollout 在大面积开放前先有了**专门的基础设施投入**：一个小团队（有时只有一个人）提前搭好工具，让 Claude 在开发者第一次接触时就已经适配了他们的工作流。一家公司由两名工程师构建了一套 day-one 可用的 plugins 和 MCPs；另一家有专门的 AI coding tools 团队在推广开始前就把基础设施就位。两种情况下开发者的第一次体验都是高效而非沮丧的，采纳从那里自然扩散。

*Claude Code 推广的阶段。*

**新兴角色：Agent Manager**——一种混合 PM/工程师的职能，专门管理 Claude Code 生态。对于没有专职团队的组织，最小可行版本是一个 DRI（directly responsible individual）：一个人对 Claude Code 配置有所有权，有权拍板 settings、权限策略、plugin 市场和 CLAUDE.md 约定，并负责保持其更新。

自下而上的采纳会产生热情，但没有人集中化有效做法就会碎片化。需要有人组装并推广正确的 Claude Code 约定（标准化的 CLAUDE.md 层级、精选的 skills 和 plugins 集合）。否则知识停留在部落阶段，采纳将见顶。

对于大型组织特别是受监管行业，治理问题会很早出现：谁控制哪些 skills/plugins 可用、如何防止数千工程师各自重复构建同一东西、如何确保 AI 生成的代码走和人写代码一样的 review 流程。建议从有限初始访问、定义好的审批 skills 集合、必需的 code review 流程开始，随信心增长而扩大。

最顺畅的部署来自早期建立跨职能工作组——把工程、信息安全和治理代表拉到一起，共同定义需求并制定 rollout 路线图。

---

# 核心

这篇文章最值得记住的洞察不是任何技术细节，而是一个认知框架的转变：**决定 Claude Code 表现的不是模型能力上限，而是 harness 的完善程度**。模型是引擎，harness 是底盘、变速箱和方向盘——没有后者，引擎再强也跑不好。

具体到执行层面的关键点：
1. Agentic search 的优势（永远在实时代码库上工作）同时是它的约束（需要良好的起始上下文）。这意味着"配置代码库"不是锦上添花，而是必要条件。
2. 七个扩展点有明确的建设顺序和分工，不能跳步。先把 CLAUDE.md 做好，再用 hooks 自动维护，再用 skills 卸载按需知识，再用 plugins 分发——MCP 和 LSP 是在基础就位后才该碰的。
3. 组织层面的 DRI/agent manager 角色不是可选项。没有集中化力量，好配置会部落化，采纳会天花板化。

# 评价

**做得好的方面：**

- 明确区分了 agentic search vs RAG 的架构选择及其 tradeoff，没有回避 agentic search 的限制
- 七个扩展点的介绍有递进逻辑（加载时机、职责边界、常见误区），对照表一目了然
- "Harness > Model" 这个命题对读者的认知纠偏价值很高——多数人仍在纠结"用哪个模型"
- 组织模式部分不停留在技术层面，给出了具体的角色（DRI、agent manager）和流程建议

**有问题或不足的方面：**

1. **Skills 和 Plugins 的边界模糊**。文章说 plugin 是 "bundled skills + hooks + MCP configs"，但没解释一个团队什么时候该写 skill、什么时候该打包成 plugin。实际决策点是什么？
2. **LSP 的配置复杂度被低估**。只说了"安装 code intelligence plugin 和 language server binary"，但大规模 monorepo 中跨语言 LSP 配置的实际痛点（启动时间、内存占用、cross-repo 符号解析）完全没提。
3. **缺少量化指标**。"投入越多效果越好"——多好？有没有哪个节点的 ROI 拐点？对照表里的"常见误区"暗示有失败模式，但没给出具体后果。
4. **三个配置模式之间的优先级关系不清晰**。模式一是前提、模式二是维护、模式三是组织——但文章没有说如果只能做一件事该做哪个。
5. **对非标准环境一笔带过**。承认"game engines with large binary assets""unconventional version control"需要额外配置，但除了"联系我们的 Applied AI team"没有给任何方向。
6. **配置审查周期缺乏诊断信号**。文章建议"每 3-6 个月做一次审查"，但没说明什么时候说明 performance plateau 了——是任务完成时间变长、错误率上升、上下文窗口占用增加、还是开发者满意度下降？也没有举例一次有效审查长什么样（移除过时技能、更新与模型演进冲突的 CLAUDE.md 规范、补充新能力对应的规范），这让"应该审查"变成了口号而非可执行清单。
7. **缺少成本/ROI 讨论**。文章完全没有提及在大型组织中部署 Claude Code 的"专用基础设施"（plugin 市场、MCP 构建团队、跨职能工作组、agent manager 角色）的成本是多少，以及如何衡量 ROI——是 PR review 时间缩短、bug 率下降、新工程师上手时间减少、还是开发者 NPS 提升？对于需要有成本决策支持的组织来说，这个缺失会让论证变得困难。

**隐含假设：**

- 假设组织有能力和意愿做前期基础设施投入。但很多团队试用 Claude Code 恰恰是因为缺人手，让他们先投入一个小团队搭建 harness 是鸡生蛋问题。
- 假设代码库用 Git。文章明确说了这个假设，但考虑到目标读者包含"decades-old legacy systems"，这个限制可能排除了一大部分最需要 AI 辅助的代码库。
- 本文是 "Claude Code at scale" 系列的第一篇，明显在为 enterprise 销售铺路（文末 CTA 指向 Claude Code for Enterprise）。这不影响技术内容的正确性，但读者应意识到选材和强调点服务于这个商业语境。
