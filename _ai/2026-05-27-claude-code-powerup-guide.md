---
title: "Claude Code /powerup 教程速览"
date: 2026-05-27 11:20:00 +0800
categories: [ai, agent]
tags: [claude-code, tutorial]
---

> 本文整理自「小林coding」微信公众号文章《面试官："你 Claude Code 用得这么 6？" 我暗喜："我早把 /powerup 命令的流程都做了"，他：你牛逼》

`/powerup` 是 Claude Code v2.1.90 新增的**官方交互式教程**，提供 10 个课程 + 动画演示，覆盖从入门到进阶的完整学习路径。

## 前提条件

```bash
claude --version  # 确保版本 ≥ 2.1.90
npm update -g @anthropic-ai/claude-code  # 升级
```

启动方式：
```bash
claude
/powerup
```

---

## 课程 01：Talk to your codebase（与代码库对话）

### 核心问题

Claude Code 能看到整个项目，但**不说清楚让它看哪里，它会自己翻很多文件，吃满上下文**。

### 解决方案：用 `@` 引用文件

**用法示例**：
```
请帮我优化这个组件的样式。 @src/components/Timer.tsx
```

**引用方式**：
| 写法 | 含义 |
|------|------|
| `@./src/App.tsx` | 引用单个文件 |
| `@./src/components/` | 引用整个目录 |
| `@./src/App.tsx @./src/styles/global.css` | 引用多个文件（空格分隔） |

**精确定位**：如果只想看某几行，用自然语言说清楚：
```
请重点看 Timer.tsx 的第 10 行到第 20 行
```

### 为什么 @ 很重要？

**上下文窗口有上限**（Sonnet/Opus 约 200k token，部分 1M）。不指定文件，Claude 会自己搜索读取，每行代码都占上下文。

用 `@` 精准指定 → 只读取那几个文件 → 上下文占用小得多。

### 屏蔽敏感文件

在 `.claude/settings.json` 配置：
```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  }
}
```

---

## 课程 02：Steer with modes（用模式驾驭 Claude）

### Shift+Tab 切换 4 种模式

| 模式 | 文件编辑 | 命令执行 | 适合场景 |
|------|----------|----------|----------|
| **Normal（默认）** | 每步都问 | 每步都问 | 新手入门，心里踏实 |
| **accept edits** | 自动执行 | 会问一下 | **日常写代码推荐** |
| **Plan** | 只看不改 | 不执行 | 复杂任务先规划 |
| **auto** | 全自动 | 全自动 | 长任务、重复任务 |

### 各模式详解

**Normal 模式**：每做一步都征求同意，创建文件、执行命令都会问。

**accept edits 模式**：改文件不问，执行命令会问（如 `npm install` 或 `rm`）。

**Plan 模式**：只分析、不改动，给出详细执行方案等你确认。

**auto 模式**：文件编辑、命令执行全不问，Claude 自己用安全分类器判断。

### 推荐使用策略

1. 入门 → `default`（熟悉每一步）
2. 日常 → `accept edits`（高效但有把控）
3. 复杂任务 → 先 `plan` 后执行
4. 完全信任的长任务 → `auto`

---

## 课程 03：Undo anything（一键撤销）

### 两种回滚方式

**方式一：连按两次 Esc**
- 输入框为空时，快速按两次 Esc
- 打开回滚菜单，显示操作时间线
- 方向键选择，回车确认

**方式二：`/rewind` 命令**
- 效果同上，命令方式触发

### 回滚范围

**不仅回滚文件，对话上下文也一起回滚** → Claude 会「忘记」那次操作后的所有对话。

### 更靠谱的方式：Git

Claude 的回滚只能管它直接编辑的文件，**命令产生的文件（如 `npm install` 的 `node_modules`）管不了**。

大改动前先存档：
```bash
git add .
git commit -m "改动前的存档"
```

改坏了：
```bash
git checkout .
```

---

## 课程 04：Run in the background（后台运行任务）

### 让命令后台跑

**方法**：直接用自然语言说
```
请帮我在后台运行 npm run build，跑完了告诉我结果。
```

Claude 会自动用 Bash 工具的后台模式执行。

**查看后台任务**：
```
/tasks
```

列出所有后台任务状态：正在运行 / 已完成 / 出错了。

### 适合场景

- 项目构建 `npm run build`
- 跑测试 `npm run test`
- 安装依赖 `npm install`
- 数据库迁移

**效率翻倍**：不用傻等，继续和 Claude 聊别的。

---

## 课程 05：Teach Claude your rules（让 Claude 记住规则）

### CLAUDE.md 是什么？

放在项目根目录的文件，Claude Code 每次启动都会读取，当作「项目记忆」。

### 如何创建？

**自动生成**：
```
/init
```

**手动创建示例**：
```markdown
# 项目名称
一句话说清楚这个项目是做什么的。

## 技术栈
- React 18 + TypeScript + Tailwind CSS

## 代码规范
- 使用函数式组件，不用 class 组件
- 变量命名用驼峰命名法
- 组件文件名用 PascalCase

## 项目结构
- src/components/ - UI 组件
- src/hooks/ - 自定义 Hook
- src/utils/ - 工具函数
```

### 写什么、不写什么？

**应该写**：项目简介、技术栈、代码规范、目录结构  
**不应该写**：详细 API 文档、临时需求、过于泛泛的描述

**原则**：越精准越好，不是越长越好。太长会占用上下文，降低效率。

### /memory 管理个人偏好

```
/memory
```
打开管理界面，可以查看、修改、开关 auto memory。

**自然语言记录**：
```
请记住：我这个项目统一用 pnpm，不用 npm。
```

### CLAUDE.md 的三个层级

| 层级 | 路径 | 适用范围 | 团队共享？ |
|------|------|----------|-----------|
| **项目级** | `./CLAUDE.md` 或 `./.claude/CLAUDE.md` | 仅当前项目 | ✅ 可提交 Git |
| **个人项目级** | `./CLAUDE.local.md` | 仅当前项目，但只给自己 | ❌ 加 .gitignore |
| **用户级** | `~/.claude/CLAUDE.md` | 所有项目 | ❌ 仅自己 |

**优先级**：项目级 > 个人项目级 > 用户级

---

## 课程 06：Extend with tools（用 MCP 装外挂）

### MCP 是什么？

**Model Context Protocol（模型上下文协议）** = Claude Code 的「外挂接口」。

通过 MCP 可以接入外部工具：
- 搜索网页
- 操作数据库
- 调用第三方 API

**类比**：Claude Code 是电脑，MCP 是 USB 接口，外设是 MCP server。

### 如何管理 MCP？

```
/mcp
```

### 如何添加 MCP server？

**方式一：命令行（推荐）**
```bash
claude mcp add <名字> -- <启动命令>
```

**方式二：手动改配置文件**  
`.claude/settings.json` 或 `~/.claude/settings.json`：
```json
{
  "mcpServers": {
    "你给这个 server 起的名字": {
      "command": "npx",
      "args": ["-y", "对应的 MCP server 包名"],
      "env": {
        "需要的API密钥": "你的值"
      }
    }
  }
}
```

### 实战：安装 12306-mcp 查火车票

**安装**：
```bash
claude mcp add 12306 -s user -- npx -y 12306-mcp
```

**确认安装**：
```bash
claude mcp list
```

**使用**：
```
帮我查 5 月 1 日北京到上海的高铁票，要二等座。
```

**卸载**：
```bash
claude mcp remove 12306 -s user
```

---

## 课程 07：Automate your workflow（自动化工作流）

### Skills：给 Claude 装技能包

Claude Code 的插件机制，让 Claude 在特定领域表现更好。

**安装位置**：
- `~/.claude/skills/<技能名>/SKILL.md` — 用户全局
- `.claude/skills/<技能名>/SKILL.md` — 当前项目

**示例：安装 frontend-design**
```
/plugin install frontend-design@claude-plugins-official
```

安装后让新 skill 生效：
```
/reload-plugins
```

**卸载**：
```
/plugin uninstall frontend-design@claude-plugins-official
```

### Hooks：给操作加钩子

在工具执行「之前」或「之后」挂一个自定义脚本，自动触发。

**钩子类型**：
| 类型 | 触发时机 | 用途 |
|------|----------|------|
| **PreToolUse** | 工具执行前 | 输入校验、拦截不安全操作 |
| **PostToolUse** | 工具执行后 | 自动格式化、自动测试 |

**配置示例（自动格式化）**：  
在 `.claude/settings.json`：
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs -I {} npx prettier --write {}"
          }
        ]
      }
    ]
  }
}
```

**应用场景**：
- 自动格式化
- 自动测试
- 安全检查
- 自动提交

---

## 课程 08：Multiply yourself（子代理分身）

### 什么是子代理？

Claude 的「分身」：后台创建独立 Claude 实例，**有自己的上下文窗口，与主对话隔离**。干完活只汇报结果给主对话。

### 为什么需要子代理？

**原因一：独立视角**  
自己写的代码自己审查会「手下留情」，子代理是全新实例，客观公正。

**原因二：保护主会话上下文**  
复杂任务会读取大量文件，吃满上下文。子代理独立上下文，结束后只返回精炼摘要。

### 如何创建子代理？

```
/agents
```

按向导配置：
1. 选择作用域（Project 或 User）
2. 用自然语言描述职责
3. 配置可用工具
4. 选择模型
5. 选择标识颜色

**使用**：
```
用 code-quality-reviewer agents 帮我审核这个项目的代码
```

### 适合场景

- 代码审查
- 写测试
- 查文档总结要点
- 多文件批量修改

---

## 课程 09：Code from anywhere（跨设备协作）

### 两个命令（方向相反）

| 命令 | 作用 | 简写 |
|------|------|------|
| `/remote-control` | 把本地会话「暴露」给网页，从浏览器遥控 | `/rc` |
| `/teleport` | 把网页会话「传送」到本地终端 | `/tp` |

### /remote-control（向外暴露）

**场景**：在公司终端开发，下班路上想用手机看看进展。

```
/remote-control
```

终端会话进入可远程控制状态，在 claude.ai 网页连接，从浏览器发指令。

**本质**：Claude Code 还在本地跑，只是多了一条「遥控线」。

### /teleport（向内传送）

**场景**：在 claude.ai 网页上开了会话，想拉到本地终端继续。

```
/teleport
```

选择网页上的会话，分支 + 对话历史一起传送过来。

**注意**：需要 claude.ai 订阅。

---

## 课程 10：Dial the model（调节大脑）

### /model 切换模型

```
/model
```

**可选模型**：
| 模型 | 特点 | 适用场景 |
|------|------|----------|
| **Sonnet** | 速度与智能平衡 | 日常任务 |
| **Opus** | 最强推理 | 复杂架构设计、难缠 bug |
| **Haiku** | 速度最快 | 简单问答、格式转换 |

### /effort 调节思考深度

```
/effort
```

**5 个档位**：
| 档位 | 特点 | 适用场景 |
|------|------|----------|
| **low** | 思考最少、响应最快 | 重命名变量、改格式、简单问句 |
| **medium** | 成本敏感折中 | 日常修小 bug、已有模式下的功能 |
| **high** | 智能敏感底线（默认） | 复杂推理、难度编码、Agentic 任务 |
| **xhigh** | 甜点档 | 长跑编码、多工具调用、子代理协作 **推荐** |
| **max** | 能力上限，token 不设限 | 最复杂任务，但可能「过度思考」 |

**注意**：`low`、`medium`、`high`、`xhigh` 会跨 session 记住，**只有 `max` 是一次性的**（会话结束自动失效）。

### ultrathink：临时顶到最高挡

在提示词里加 `ultrathink`：
```
请帮我分析这个性能瓶颈的根因。ultrathink
```

**效果**：这一轮临时顶到 high，用完自动恢复原档位。

**老版本注意**：老版本有 think、think hard、think harder、ultrathink 四个关键词。**新版本只有 ultrathink 真正生效**。

### 模型 + 思考深度组合建议

| 场景 | 模型 | 思考档位 |
|------|------|----------|
| 简单代码修改 | Sonnet | medium |
| 日常编码、Agentic 任务 | Opus / Sonnet | **xhigh（推荐默认）** |
| 复杂 bug 排查 | Opus | xhigh，必要时切 max |
| 架构设计 | Opus | xhigh 或 max（先小范围验证） |
| 快速格式转换 | Haiku | low |
| 代码审查 | Sonnet | medium |

---

## 补充：高频维护命令

| 命令 | 效果 | 什么时候用 |
|------|------|-----------|
| `/context` | 查看上下文占用 | Claude 开始犯迷糊时 |
| `/compact` | 压缩对话，保留关键信息 | 继续做同一个任务时 |
| `/clear` | 彻底清空对话 | 切换到完全不同的任务时 |
| `claude --resume` | 恢复历史对话 | 关掉终端后想接着干时 |
| `claude -c` | 快速恢复最近一次对话 | 同上，省去选择步骤 |

---

## 核心要点总结

1. **`@` 引用文件** → 精准定位，节省上下文
2. **Shift+Tab 切换模式** → 四种信任级别，日常用 `accept edits`
3. **Esc+Esc 或 `/rewind`** → 一键撤销，大改动前先 git commit
4. **自然语言让命令后台跑** → 不用傻等
5. **CLAUDE.md** → 项目记忆，写一次永远记得
6. **MCP** → 装外挂，能力无限扩展
7. **Skills + Hooks** → 技能包 + 自动化钩子
8. **`/agents`** → 子代理分身，独立上下文做审查
9. **`/rc` 和 `/tp`** → 跨设备协作
10. **`/model` + `/effort`** → 模型 + 思考深度，日常推荐 xhigh

---

**一句话**：`/powerup` 是 Claude Code 官方最佳入门教程，新手必过，老手也能学到隐藏技巧。赶紧打开终端输入 `/powerup` 开始学习！