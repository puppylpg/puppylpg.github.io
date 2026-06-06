---
title: "【树莓派】AdGuard Home 部署与 DNS 过滤配置：解决 GitHub 被墙导致的规则下载失败"
date: 2026-06-05 23:24:00 +0800
categories: tech docker network raspberry
tags: [adguard, dns, docker, raspberry-pi, github, cdn, network]
description: "在树莓派上通过 Docker 部署 AdGuard Home，解决 adguardteam.github.io 被墙导致的 DNS 过滤规则下载失败，并配置设备使用自定义 DNS 实现广告拦截。"
---

1. Table of Contents, ordered
{:toc}

# 背景与目标

在树莓派上通过 Docker Compose 部署了 AdGuard Home，用于家庭网络的 DNS 过滤和广告拦截。使用过程中遇到 AdGuard 无法从官方地址下载 DNS 过滤规则的问题，错误信息为：

```bash
Couldn't fetch filter from URL "https://adguardteam.github.io/HostlistsRegistry/assets/filter_29.txt"
read tcp 172.18.0.2:41240->185.199.108.153:443: read: connection reset by peer
```dockerfile

根本原因是 `adguardteam.github.io`（GitHub Pages）被墙，容器内直连会触发连接重置。本文记录诊断和解决过程，以及 AdGuard Home 的部署和使用配置。

# AdGuard Home 是什么

AdGuard Home 是一个**网络级别的 DNS 过滤服务器**。它的核心作用是在 DNS 解析阶段拦截广告、跟踪脚本和恶意域名，而不是等浏览器加载了广告内容再去屏蔽。

**和浏览器插件的区别**：

| 对比项 | AdGuard Home | 浏览器插件 |
|--------|-------------|-----------|
| 拦截层级 | DNS 层（网络层） | 应用层（浏览器内） |
| 覆盖范围 | 全网设备（手机、电脑、电视、IoT） | 仅当前浏览器 |
| 是否需要安装 | 不需要在设备上装任何东西，改 DNS 即可 | 每台设备都要装插件 |
| 能否去网页元素 | 不能（只能阻止域名解析） | 能（可以隐藏广告位） |

**工作原理**：当设备请求解析 `doubleclick.net` 时，AdGuard Home 发现这个域名在黑名单里，直接返回 `0.0.0.0` 或 `NXDOMAIN`，设备就无法连接到广告服务器，广告自然也就加载不出来。这种方式对所有 App 和浏览器都生效，包括那些不支持插件的设备和应用。

# 当前部署架构

AdGuard Home 部署在树莓派上，通过 Docker Compose 统一管理。当前的网络拓扑如下：

```bash
互联网
   │
   ▼
路由器 (192.168.1.1)
   │ DHCP 下发 DNS: 192.168.1.7
   ├─ 树莓派 (192.168.1.7)
   │   └── Docker Compose
   │       ├── adguardhome (DNS 过滤)
   │       ├── jellyfin (媒体服务器)
   │       └── portainer (Docker 管理)
   ├─ 电脑 / 手机 / 电视 / IoT 设备
```

## Docker Compose 配置

```yaml
services:
  adguardhome:
    image: adguard/adguardhome:latest
    container_name: adguardhome
    volumes:
      - /home/pi/docker/adguardhome/work:/opt/adguardhome/work
      - /home/pi/docker/adguardhome/conf:/opt/adguardhome/conf
    ports:
      - "53:53/tcp"     # DNS 查询（TCP）
      - "53:53/udp"     # DNS 查询（UDP）
      - "3000:3000/tcp" # 初始安装向导
      - "80:80/tcp"     # Web 管理面板
    restart: unless-stopped
```bash

**关键端口说明**：

| 端口 | 协议 | 用途 |
|------|------|------|
| 53 | TCP/UDP | DNS 服务，所有设备通过此端口查询域名 |
| 80 | TCP | Web 管理面板，日常查看统计和配置 |
| 3000 | TCP | 初次安装向导，首次配置时使用 |

**数据持久化**：

| 宿主机路径 | 容器内路径 | 内容 |
|-----------|-----------|------|
| `/home/pi/docker/adguardhome/work` | `/opt/adguardhome/work` | 运行时数据：filter 规则缓存、查询日志、统计数据库 |
| `/home/pi/docker/adguardhome/conf` | `/opt/adguardhome/conf` | 配置文件：`AdGuardHome.yaml` |

## DNS 上游配置

AdGuard Home 本身也是一个 DNS 递归解析器，它收到查询请求后：
1. 先检查是否在黑名单里（本地 filter 规则）
2. 如果不在黑名单，转发给**上游 DNS** 解析
3. 缓存结果，下次直接返回

当前配置的上游 DNS 是国内 DoH（DNS over HTTPS）服务，兼顾速度和隐私：

```yaml
upstream_dns:
  - https://dns.alidns.com/dns-query      # 阿里 DNS
  - https://doh.pub/dns-query              # 腾讯 DNSPod
  - https://doh.360.cn/dns-query           # 360 DNS
```dockerfile

**Bootstrap DNS** 用于解析上游 DoH 服务器的域名（比如 `dns.alidns.com`），已优化为国内 DNS：

```yaml
bootstrap_dns:
  - 223.5.5.5        # 阿里 DNS
  - 119.29.29.29     # 腾讯 DNSPod
  - 2400:3200::1     # 阿里 IPv6
  - 2402:4e00::1     # 腾讯 IPv6
```bash

> 之前用的是 Quad9（国外），在国内经常连不上，导致 AdGuard 自己都解析不了上游 DNS，出现各种奇怪问题。

# 主要步骤

## 步骤一：诊断网络问题

首先确认问题范围：

1. **宿主机测试**：树莓派上直接 `curl` 访问 `adguardteam.github.io` 的 filter URL，同样返回 `Connection reset by peer`。
2. **容器内测试**：进入 AdGuard 容器执行 `wget`，结果一致，确认是网络层面的阻断。
3. **镜像地址测试**：尝试 `cdn.jsdelivr.net` 镜像（`https://cdn.jsdelivr.net/gh/AdguardTeam/HostlistsRegistry@main/assets/filter_29.txt`），可以正常访问。
4. **AdGuard 官方 CDN 测试**：`filters.adtidy.org/extension/chromium/filters/15.txt` 也可正常访问。

结论：GitHub Pages 被墙，但 jsdelivr CDN 和 AdGuard 官方 CDN 在国内可访问。

## 步骤二：修改配置文件并添加规则

AdGuard Home 的配置文件位于 `/opt/adguardhome/conf/AdGuardHome.yaml`（通过 Docker volume 映射到宿主机的 `/home/pi/docker/adguardhome/conf/`）。

**关键修改**：

1. **替换 filter URL**：将所有 `adguardteam.github.io` 替换为 `cdn.jsdelivr.net` 镜像地址。
2. **添加 filter_29（AdRules DNS List）**：中国区综合广告拦截规则，约 18 万条。
3. **添加 filter_21（anti-AD）**：国内精准广告/跟踪拦截规则，约 10 万条。

修改后的 `filters` 配置片段：

```yaml
filters:
  - enabled: true
    url: https://cdn.jsdelivr.net/gh/AdguardTeam/HostlistsRegistry@main/assets/filter_1.txt
    name: AdGuard DNS filter
    id: 1
  - enabled: false
    url: https://cdn.jsdelivr.net/gh/AdguardTeam/HostlistsRegistry@main/assets/filter_2.txt
    name: AdAway Default Blocklist
    id: 2
  - enabled: true
    url: https://cdn.jsdelivr.net/gh/AdguardTeam/HostlistsRegistry@main/assets/filter_29.txt
    name: AdRules DNS List
    id: 29
  - enabled: true
    url: https://cdn.jsdelivr.net/gh/AdguardTeam/HostlistsRegistry@main/assets/filter_21.txt
    name: anti-AD
    id: 21
```

重启容器后，AdGuard Home 自动从 jsdelivr 下载规则，日志确认成功：

```bash
filter updated id=1 rules_count=160884
filter updated id=21 rules_count=104772
filter updated id=29 rules_count=180586
```dockerfile

**Filter 组合说明**：

| Filter | 定位 | 规则数 | 状态 |
|--------|------|--------|------|
| AdGuard DNS filter | 国际通用广告/跟踪拦截 | 160,884 | ✅ 启用 |
| anti-AD | 国内精准广告/隐私保护 | 104,772 | ✅ 启用 |
| AdRules DNS List | 国内综合拦截 | 180,586 | ✅ 启用 |
| AdAway Default Blocklist | 国际通用（和 AdGuard 重复度高） | 6,540 | ❌ 关闭 |

三个启用的列表互补覆盖，总计约 45 万条规则。AdAway 因为和 AdGuard DNS filter 重复度很高，所以关闭以减少内存和查询开销。

## 步骤三：优化 DNS 配置

**Bootstrap DNS 优化**：

原配置使用 Quad9（`9.9.9.10`、`149.112.112.10`）作为 Bootstrap DNS。Quad9 在国内连接不稳定，可能导致 AdGuard 自己都解析不了上游 DNS。

已将其替换为国内 DNS（见上文部署架构部分）。

# 配置设备使用 AdGuard

AdGuard Home 部署在树莓派上，监听 `192.168.1.7:53`（DNS 标准端口）。要让网络中的设备通过 AdGuard 解析 DNS，需要把设备的 DNS 服务器地址指向 `192.168.1.7`。

## 方式一：路由器 DHCP 配置（强烈推荐）

在路由器的 DHCP 服务器设置中，将 DNS 服务器地址改为 `192.168.1.7`。这样所有接入该路由器的设备自动生效，无需逐台配置，连手机 App、智能电视、IoT 设备都能拦截广告。

**常见路由器设置路径**：

| 路由器品牌 | 设置路径 |
|-----------|---------|
| 小米/红米 | 常用设置 → 局域网设置 → DNS |
| TP-Link | DHCP 服务器 → 主 DNS 服务器 |
| 华硕 | 内部网络 → DHCP 服务器 → DNS 服务器 |
| 华为 | 更多功能 → 网络设置 → 局域网 → DNS |

> ⚠️ 注意：部分运营商定制路由器（如创维）可能不允许修改 DHCP DNS，这种情况只能采用方式二。

## 方式二：单设备手动设置

如果路由器改不了，或者只想让某几台设备先用上，可以单独配置：

**Windows**：
```bash
设置 → 网络和 Internet → 高级网络设置 → 更多网络适配器选项
→ 右键你的网卡 → 属性 → IPv4 → 属性
→ 使用下面的 DNS：192.168.1.7
```

**Android**：
```bash
设置 → WLAN → 长按你的 WiFi → 修改网络 → 高级/展开
→ IP 设置改为"静态" → DNS 1: 192.168.1.7
```bash

**iPhone/iPad**：
```bash
设置 → Wi-Fi → 点击你 WiFi 右边的 ⓘ → 配置 DNS → 手动
→ 删除原来的，添加：192.168.1.7
```

## 验证是否生效

打开这个网址测试：

```bash
https://adguard.com/en/test.html
```

如果显示 **"AdGuard is installed and running"**（或中文类似提示），就说明生效了。

或者命令行测试：
```bash
nslookup doubleclick.net 192.168.1.7
```bash

如果返回 `0.0.0.0` 或 `NXDOMAIN`，说明广告域名被成功拦截。

# Web 管理面板功能

AdGuard Web 面板地址：`http://192.168.1.7`（默认是 80 端口，直接输 IP 就行）

| 功能 | 位置 | 用途 |
|------|------|------|
| 仪表盘 | 首页 | 实时查看拦截了多少请求、拦截率、热门被拦截域名 |
| 查询日志 | 查询日志 | 查看每台设备访问了什么域名，可按客户端筛选 |
| DNS 黑名单 | 过滤器 → DNS 黑名单 | 添加/更新/禁用过滤规则列表 |
| 自定义过滤规则 | 过滤器 → 自定义过滤规则 | 手动加黑白名单，如 `||baidu.com^` 屏蔽百度 |
| DNS 重写 | 过滤器 → DNS 重写 | 局域网域名指向，如 `nas.local → 192.168.1.7` |
| 客户端设置 | 设置 → 客户端设置 | 给特定设备单独配置规则、上游 DNS 等 |

# 关键指令与输出

| 用户指令/需求 | AI 操作 | 关键输出 |
|---|---|---|
| AdGuard 下载 filter 失败，排查原因 | 测试宿主机和容器网络连通性，确认 GitHub Pages 被墙 | `Connection reset by peer` 一致复现 |
| 添加 filter_29 和 filter_21 | 修改 `AdGuardHome.yaml`，替换 URL 为 jsdelivr 镜像 | filter_29: 180,586 条规则；filter_21: 104,772 条规则 |
| 优化 AdGuard 配置 | 替换 Bootstrap DNS 为阿里/腾讯；关闭重复的 AdAway | Bootstrap DNS 国内化，filter 组合精简为 3 个 |
| 介绍 AdGuard 部署和使用方式 | 解释 Docker 部署结构、端口映射、客户端 DNS 配置 | 路由器 DHCP 改 DNS 或单设备手动设置 |

# 核心结论

1. **问题根因**：`adguardteam.github.io` 被墙导致 AdGuard Home 容器内无法下载 filter 规则。
2. **解决方案**：将所有 GitHub Pages 的 filter URL 替换为 `cdn.jsdelivr.net` 镜像，AdGuard 官方 CDN（`filters.adtidy.org`）也是可行替代。
3. **配置优化**：Bootstrap DNS 使用国内服务商（阿里/腾讯），避免国外 DNS 解析失败导致上游 DoH 不可用。
4. **使用方式**：将设备或路由器的 DNS 指向树莓派 IP（`192.168.1.7:53`），即可实现全网络的广告和跟踪拦截。
5. **长期维护**：后续添加任何 AdGuard HostlistsRegistry 的 filter，统一使用 `cdn.jsdelivr.net` 镜像地址。

# 参考

- [AdGuard Home 官方文档](https://adguard.com/adguard-home/overview.html)
- [AdGuard HostlistsRegistry](https://github.com/AdguardTeam/HostlistsRegistry)
- [jsdelivr GitHub CDN](https://www.jsdelivr.com/?docs=gh)
- 当前部署的 Docker Compose 文件：`/home/pi/docker/compose.yml`
