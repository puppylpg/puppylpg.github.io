---
layout: post
title: "Git 加速：为 SSH 和 HTTPS 配置本地代理"
date: 2026-06-11 02:13:18 +0800
categories: [life, git, proxy, network, tools]
tags: [git, ssh, proxy, github, network]
description: "通过配置 SSH ProxyCommand 和 Git HTTP/HTTPS 全局代理，让 git clone 和 git push 在国内网络环境下也能高速访问远程仓库。"
math: true
mermaid: true
---

1. Table of Contents, ordered
{:toc}

## 问题背景

在国内网络环境下，直接通过 `git clone git@github.com:...` 拉取代码往往速度极慢，甚至频繁超时。很多人已经部署了本地代理工具（如 Clash、V2Ray），但 Git 默认并不会自动走这些代理，需要手动配置。

Git 访问远程仓库主要有两种协议：

- **SSH 协议**（`git@github.com:user/repo.git`）：默认走 22 端口，不走系统的 HTTP 代理设置
- **HTTPS 协议**（`https://github.com/user/repo.git`）：走 HTTP/HTTPS 流量，可通过 Git 的 `http.proxy` 配置

要让两种协议都能利用本地代理加速，需要分别处理。

## SSH 协议配置 SOCKS5 代理

SSH 代理的核心思路是在 `~/.ssh/config` 中为特定主机添加 `ProxyCommand`，让 SSH 流量先经过本地 SOCKS5 代理，再转发到目标服务器。

假设本地 SOCKS5 代理端口为 `10808`（常见于 Clash、V2Ray 等工具），在 `~/.ssh/config` 中添加：

```ssh
Host github.com
    HostName ssh.github.com
    Port 443
    IdentityFile ~/.ssh/id_rsa.github.com
    IdentitiesOnly yes
    ProxyCommand connect -S 127.0.0.1:10808 %h %p
```

### 关键点说明

- **`HostName ssh.github.com` + `Port 443`**：部分网络环境会封锁 22 端口，将 GitHub SSH 入口改为 443 端口可以提高连通性
- **`connect -S 127.0.0.1:10808`**：使用 `connect` 工具（Git for Windows 自带）通过 SOCKS5 代理建立连接；`%h` 和 `%p` 会被替换为实际的目标主机和端口
- **`-S`**：指定 SOCKS5 代理；如果代理是 HTTP 类型，应改为 `-H`

配置完成后，验证连通性：

```bash
ssh -vT git@github.com
```

如果输出中出现 `connect -S 127.0.0.1:10808 ssh.github.com 443`，并最终显示 `Hi xxx! You've successfully authenticated...`，说明代理生效。

### HTTP 代理的写法

如果本地代理只提供 HTTP 代理（端口假设为 `10809`），则 `ProxyCommand` 应改为：

```ssh
Host github.com
    ProxyCommand connect -H 127.0.0.1:10809 %h %p
```

## HTTPS 协议配置全局代理

对于使用 HTTPS 地址克隆的仓库，可以直接通过 Git 的全局配置让 HTTP/HTTPS 流量走代理：

```bash
git config --global http.proxy http://127.0.0.1:10809
git config --global https.proxy http://127.0.0.1:10809
```

这样所有 `git clone https://...`、`git fetch`、`git push` 都会自动经过代理。

查看已配置的代理：

```bash
git config --global http.proxy
git config --global https.proxy
```

如果某个仓库临时不需要代理，可以在该仓库目录下单独取消：

```bash
git config --local --unset http.proxy
git config --local --unset https.proxy
```

## 两种方案的选择与配合

| 场景 | 推荐方案 |
|---|---|
| 仓库地址是 `git@github.com:...` | 配置 `~/.ssh/config` + SOCKS5/HTTP 代理 |
| 仓库地址是 `https://github.com/...` | 配置 `git config --global http.proxy` |
| 不确定用哪种地址 | 两种都配置，互为补充 |

实际操作中，建议同时配置 SSH 代理和 Git HTTPS 代理，这样无论克隆时复制的是 SSH 地址还是 HTTPS 地址，都能获得加速效果。

## 验证效果

配置完成后，可以从 GitHub 克隆一个中等大小的仓库测试速度：

```bash
# 测试 SSH 协议
git clone git@github.com:torvalds/linux.git --depth 1

# 测试 HTTPS 协议
git clone https://github.com/torvalds/linux.git --depth 1
```

速度从几 KB/s 提升到几 MB/s 是常见现象。

## 总结

- **SSH 不走系统代理**，必须通过 `~/.ssh/config` 的 `ProxyCommand` 显式指定
- **HTTPS 走 Git 自身的代理配置**，通过 `http.proxy` 和 `https.proxy` 控制
- `connect` 工具在 Git for Windows 中自带，无需额外安装
- 将 GitHub SSH 端口改为 443 可以进一步规避部分网络环境的端口封锁

完成以上配置后，日常的 `git clone`、`git fetch`、`git push` 基本都能满速运行。