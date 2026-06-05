---
title: "Windows 与 WSL 免密登录差异排查及 Git Bash 原理澄清"
date: 2026-06-05 13:52:39 +0800
categories: [ai, tools]
tags: [ssh, wsl, git-bash, msys2, raspberry-pi, passphrase, ssh-keygen, kimi-cli, skill]
description: "排查 Windows 可免密 SSH 树莓派但 WSL 需输入密码的问题，发现同一对密钥私钥加密状态不同；同时深入澄清了 Git Bash 与 WSL 的本质区别、wsl 命令的路径解析陷阱等。"
---

1. Table of Contents, ordered
{:toc}

# 背景与目标

用户发现：在 Windows（Git Bash / PowerShell）中可以直接无密码 SSH 到局域网树莓派（`pi@192.168.1.7`），但在 WSL（Windows Subsystem for Linux）中执行同样的 `ssh pi@192.168.1.7` 时，却被要求输入密码。用户对此感到困惑，希望排查原因并解决 WSL 侧的免密登录问题。

# 主要步骤

## 步骤一：排查 Windows 侧的 SSH 认证机制

首先检查 Windows 上的 `~/.ssh` 配置：

- `~/.ssh/config` 中没有专门配置树莓派
- `~/.ssh/id_ed25519` 存在且**未设置 passphrase**（通过 `ssh-keygen -y -P '' -f ~/.ssh/id_ed25519` 验证成功）
- `ssh-agent` 未运行

结论：Windows 侧通过未加密的 `id_ed25519` 私钥自动完成了密钥认证，无需输入任何密码。

## 步骤二：WSL 侧的误判与纠正

最初执行 `wsl ls -la ~/.ssh/` 时返回空目录，误判为 WSL 没有私钥。但用户截图显示 WSL 中执行 `ssh pi@192.168.1.7` 时提示：

```
Enter passphrase for key '/home/win-pichu/.ssh/id_ed25519':
```

这说明 WSL 里**有私钥，但被 passphrase 加密了**。

对比两边的公钥后发现：**两把是同一对密钥**（公钥指纹完全一致）：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBAq8uh7g/Gf/S7rpKJCpVw+VplzTzR4uXmM3viFlmgW pichu@Archer
```

| 环境 | 私钥路径 | 加密状态 | 登录表现 |
|------|----------|----------|----------|
| Windows | `C:/Users/puppylpg/.ssh/id_ed25519` | 未加密 | 直接免密登录 |
| WSL | `/home/win-pichu/.ssh/id_ed25519` | 有 passphrase | 要求输入解锁口令 |

## 步骤三：修复 WSL 私钥

由于两把是同一对密钥，直接用 Windows 上未加密的私钥覆盖 WSL 中加密的私钥：

```bash
wsl bash -c "cp /mnt/c/Users/puppylpg/.ssh/id_ed25519 ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519"
```

修复后 WSL 也能无密码 SSH 到树莓派。

## 步骤四：深入澄清底层原理

### `wsl` 命令的路径解析陷阱与执行层次

`wsl` 命令的执行链条分为四层，理解这个层次才能明白为什么 `~` 会被"截胡"：

```
Windows Git Bash
    ↓ 解析命令（展开 ~ 等 shell 特殊字符）
调用 wsl.exe（Windows 原生程序）
    ↓ 进入 WSL 子系统
启动 WSL 内部的 /bin/bash
    ↓ 把 -c "xxx" 传给这个 bash
WSL bash 执行 xxx（此时才展开 WSL 侧的 ~）
```

**错误命令的执行路径**：

```bash
wsl ls -la ~/.ssh/
```

这里 `~` 在**第一层（Windows Git Bash）**就被展开成了 `C:/Users/puppylpg/.ssh/`，wsl.exe 拿到的是 Windows 路径格式。WSL 里的 `ls` 看到 `C:/...` 要么找不到，要么解析异常，所以报了空。

**正确命令的执行路径**：

```bash
wsl bash -c "cat ~/.ssh/id_ed25519.pub"
```

双引号把整串内容保护了起来，Windows Git Bash **不会展开引号里的 `~`**。它把参数原样传给 `wsl.exe`，再由 WSL 内部的 bash 去展开 `~`，自然就指向了 `/home/win-pichu/.ssh/`。

这个陷阱的根源在于：**Git Bash 太"热心"了，把本该留给 WSL 的 `~` 先吃掉了**。

### Git Bash vs WSL 的本质区别

| 特性 | Git Bash | WSL |
|------|----------|-----|
| 本质 | MSYS2 移植的 Unix 工具 + bash shell | 真正的 Linux 子系统（WSL2 是轻量 VM） |
| 底层 | Windows API（`.exe` 程序） | Linux 内核 + 原生 ELF 二进制文件 |
| `ls` | 实际是 `ls.exe`，调用 Windows API | 就是 Linux 的 `ls` |
| `ssh` | Windows 版 OpenSSH | Linux 版 OpenSSH |

**Git Bash 不是 Linux，它只是让 Windows 有了 Unix 的"外壳"和命令风格**；`wsl.exe` 是 Windows 系统自带的程序，Git Bash 只是作为启动器调用它。

# 关键指令与输出

| 用户指令 | AI 操作 | 关键输出 |
|---|---|---|
| "为什么可以直接 ssh 到树莓派不需要密码" | 检查 Windows `~/.ssh` 配置 | `id_ed25519` 未加密，`ssh-agent` 未运行 |
| "WSL 里 ssh 需要输入密码" | 检查 WSL 配置，最初误判为空 | 后续用户截图证明 WSL 私钥有 passphrase |
| "把 WSL 私钥的密码去掉" | 用 Windows 未加密私钥覆盖 WSL 加密私钥 | WSL 恢复免密登录 |
| "为什么一开始说 WSL 没有私钥" | 解释 `wsl` 命令的路径解析层次 | Git Bash 先展开 `~` 导致路径错误 |
| "Git Bash 是在执行 Windows exe 吗" | 澄清 Git Bash 与 WSL 的本质区别 | Git Bash = MSYS2 `.exe` 工具集；WSL = 真正 Linux |

# 核心结论

1. **同一对 SSH 密钥在不同环境中私钥加密状态可能不同**。Windows 和 WSL 的 `id_ed25519` 公钥相同，但 Windows 的私钥未加密，WSL 的私钥有 passphrase，导致登录体验差异。
2. **`wsl` 命令中的特殊字符会被 Windows 侧 shell 先解析**。使用 `wsl bash -c "..."` 可以保护命令串，让 WSL 内部正确展开路径。
3. **Git Bash 是 Windows 上的 Unix 风格外壳 + 重编译的 `.exe` 工具集**，它不是 Linux，也不实现 WSL 功能；WSL 才是真正的 Linux 兼容层（WSL2 基于轻量虚拟机）。

# 参考

- `ssh-keygen -y -P '' -f ~/.ssh/id_ed25519` — 验证私钥是否未加密
- `wsl bash -c "cp /mnt/c/.../.ssh/id_ed25519 ~/.ssh/id_ed25519"` — 跨系统复制并修复私钥
- Git for Windows / MSYS2 文档
- [WSL 官方文档](https://docs.microsoft.com/zh-cn/windows/wsl/)
