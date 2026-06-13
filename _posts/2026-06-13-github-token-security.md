---
title: "如何安全地把 GitHub Token 告诉 AI"
date: 2026-06-13 11:10:16 +0800
categories: [tech, tools]
tags: [github, security, ai, claude]
description: "让 AI 帮你调 GitHub API 时，Token 很容易不小心出现在对话记录里。关键不是 AI 能不能拿到 Token，而是 Token 有没有出现在对话文本里。"
---

1. Table of Contents, ordered
{:toc}

## 背景

让 Claude Code 帮你向上游开源项目提 PR，需要调用 GitHub REST API（fork 仓库、创建 PR 等）。这些操作需要 GitHub Personal Access Token（PAT），于是就产生了一个问题：怎么把 Token 告诉 AI？

## 当前做法：`! GITHUB_TOKEN=xxx`

一个直觉上"安全"的做法是：在 Claude Code 的输入框里执行本地命令：

```
! GITHUB_TOKEN=ghp_...
```

想法是：Token 只是设置了一个环境变量，没有直接"发给" AI，比把 Token 粘贴进对话框安全。

这个出发点是对的，但实际上有两个问题。

### 问题一：Token 仍然出现在了对话里

`! 命令` 本身会出现在 Claude Code 的对话上下文里。设置环境变量没有输出，但命令本身（含 Token 明文）出现在了消息流里——和直接把 Token 粘贴进对话框没有本质区别。

Claude Code 的对话会被保存在本地（`~/.claude/` 下的会话文件）。如果用 `archive-chat` 整理成博客、或者对话记录被他人读到，Token 就直接暴露了。

### 问题二：AI 的 Bash 工具根本读不到这个变量

Claude Code 的 Bash 工具每次调用都是独立的 shell 进程，不继承用户终端设置的环境变量。`! GITHUB_TOKEN=xxx` 在用户侧的 shell 里设置了变量，但 AI 用 Bash 工具执行 `printenv GITHUB_TOKEN` 时，得到的是空。

这次就发生了这件事：Token 进了对话记录，AI 用 `$GITHUB_TOKEN` 调 API 却报了 `Bad credentials`，最终只能从对话文本里直接读出来用。两件坏事同时发生。

## 一个关键的误解

看到这里可能会想：既然 `gh auth login` 也是把 Token 存在本地，AI 也能用 `gh auth token` 读到，那有什么本质区别？AI 不是一样"拿到了" Token 吗？

区别在于 Token **有没有出现在对话文本里**，而不是 AI 能不能访问它。

用 `gh auth login` 的正确姿势是，让 AI 在 Bash 工具里这样调 API：

```bash
curl -H "Authorization: token $(gh auth token)" https://api.github.com/repos/.../forks
```

`$(gh auth token)` 是 shell 展开的：Token 的值直接塞进命令，不会出现在任何输出里。AI 看到的只是 curl 的返回结果，Token 本身从头到尾没有出现在对话文本里。

而 `! GITHUB_TOKEN=ghp_xxx` 是你把 Token **打在了对话输入框里**，它天然就是对话记录的一部分。

**关键不是 AI 能不能拿到 Token，而是让 shell 替你传递 Token，而不是让你自己打进对话框。**

## 更妥当的做法

### 方案 A：`gh auth login`（推荐）

事先在终端做一次 `gh auth login`，Token 存入系统安全位置。AI 在 Bash 工具里用 `$(gh auth token)` 内联展开，Token 不落入任何对话文本：

```bash
# AI 在 Bash 工具里这样用，Token 不会出现在输出里
curl -H "Authorization: token $(gh auth token)" https://api.github.com/repos/.../forks
```

### 方案 B：在 shell profile 里预设

在 `~/.zshrc` 或 `~/.bashrc` 里提前写好：

```bash
export GITHUB_TOKEN="ghp_..."
```

Claude Code 启动时，Bash 工具运行的 shell 会继承这个变量，AI 可以直接用 `$GITHUB_TOKEN`，Token 不需要出现在对话里。

缺点是 Token 明文存在了 shell profile 文件里，确保文件权限为 `600`（`chmod 600 ~/.zshrc`）。

### 两种方案对比

| 做法 | Token 是否进入对话 | AI 能正常调 API |
|------|-----------------|----------------|
| `! GITHUB_TOKEN=xxx` | **是** | **否**（进程隔离） |
| 直接粘贴进对话框 | **是** | 是 |
| `gh auth login` + `$(gh auth token)` | 否 | 是 |
| shell profile 预设 | 否 | 是 |

## 如果 Token 已经出现在对话里

立即撤销：GitHub Settings → Developer settings → Personal access tokens → 找到对应 Token → Revoke。

撤销后即使对话记录被人读到，该 Token 也已失效。
