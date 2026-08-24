---
title: "树莓派 Homelab 全景"
date: 2026-08-24 16:45:37 +0800
categories: [wiki]
tags: [raspberry-pi, homelab, proxy, docker, jellyfin]
description: "树莓派上长期运行的服务、代理端口、家庭影院管线与排障入口的活页面。文章记录历史，本页记录现状。"
---

> 这是一页 **wiki 活页面**：它会随着树莓派上服务的变化持续更新，记录的是“当前状态”；而 `_life/` 里的相关文章是“折腾实录”，记录的是“当时发生了什么”。两者互相链接，但各司其职。

## 当前在跑的服务

### 代理（三套并存，端口两两错开）

| 代理 | SOCKS5 | HTTP | 出口 | 托管方式 |
|------|--------|------|------|---------|
| v2ray（自建老方案，VMess） | `127.0.0.1:10808` | `127.0.0.1:10809` | 自建 VPS | Docker 容器 `v2ray` |
| xray-client（自建主力，VLESS） | `127.0.0.1:10818` | `127.0.0.1:10819` | 自建 VPS | Docker 容器 `xray-client` |
| mihomo（PandaFan 付费机场） | `127.0.0.1:7891` | `127.0.0.1:7890` | 机场节点 | systemd 用户服务 `mihomo.service` |

要点：

- 下载境外资源慢时优先 `export https_proxy=http://127.0.0.1:10809 http_proxy=http://127.0.0.1:10809` 走自建代理。
- mihomo 是 Rule 分流模式，验证连通性要用 `https://www.google.com` 这类明确走代理的站点。
- mihomo 维护：`systemctl --user status|restart mihomo`；改完配置必须以端口监听（`ss -tlnp`）加实际请求验证为准，不能只看 `active (running)`。

### 家庭影院管线

Docker 容器化的自动化下载与播放链路：Radarr（电影管理）+ Jackett（索引器）+ qBittorrent（下载）+ Bazarr（字幕）→ Jellyfin（点播服务端）→ Kodi（电视端播放）。

### 其他

- AdGuard Home：DNS 过滤（Docker）。
- Hermes Agent：微信远程触发下载。
- Codex CLI：已配置 npm 镜像加速与代理。
- Hailo NPU：本地 AI 推理能力探索中。

## 折腾实录（按主题）

### 代理与网络

- [树莓派部署 PandaFan mihomo 代理：安装、systemd 托管与多代理并存](/life/2026/08/07/pandafan-mihomo-raspberry-pi-proxy/) — mihomo 当前方案的来源实录
- [VMess、VLESS 与 REALITY 对比：架构、理论与昼夜测速](/life/2026/08/05/vmess-vless-docker-nginx-benchmark/) — 自建协议选型依据
- [VPS Docker 服务全景与 V2Ray v4 到 v5 升级方案分析](/life/2026/06/08/vps-docker-panorama-v2ray-v4-to-v5-upgrade/) — v2ray 老方案与 VPS 侧全景
- [解剖家庭网络：MAC、BSSID、子网、NAT 与 Mesh 路由](/life/2026/07/05/anatomy-of-home-network/) — 树莓派所在网络环境的底层概念
- [【树莓派】AdGuard Home 部署与 DNS 过滤配置](/life/2026/06/05/adguard-home-raspberry-docker-dns-filter/) — 含 GitHub 被墙导致规则下载失败的解决

### 家庭影院

- [树莓派家庭影院（一）：Docker 自动化电影下载管线](/life/2026/06/17/raspberry-pi-docker-radarr-jackett-qbittorrent-bazarr/)
- [树莓派家庭影院（二）：点播、播放、密码管理与统一入口](/life/2026/07/20/raspberry-pi-homelab-mediacenter-and-entry/)
- [树莓派家庭影院（三）：Kodi 接入 Jellyfin 与字幕自动化](/life/2026/08/04/raspberry-pi-jellyfin-kodi-tv-guide/)
- [树莓派 + Hermes Agent + 微信 + Radarr：一句话远程下载电影](/life/2026/07/04/hermes-agent-wechat-radarr-remote-download/)

### 硬件与系统

- [树莓派服务清单：Homelab 全景登记](/life/2026/08/09/raspberry-pi-service-inventory/) — 更细粒度的服务登记
- [树莓派 5 主动散热器实测：风扇调速策略与满载温度](/life/2026/08/09/pi5-active-cooler-fan-test/)
- [树莓派安装 Codex CLI：网络探测、npm 镜像加速与代理配置实录](/life/2026/07/24/raspberry-pi-codex-cli-proxy/)

### AI 能力

- [树莓派 AI 是怎么回事：从 Hailo NPU 到本地 LLM 的能力边界](/life/2026/07/02/raspberry-pi-ai-hailo-npu-llm-capabilities/)

## 维护约定

新增或变更树莓派上的服务时，同步更新本页的“当前在跑的服务”部分，并在“折腾实录”里补充对应文章链接。事实性信息（端口、容器名、配置文件路径）以 `AGENTS.md` 的树莓派代理服务表为基准，两处应保持一致。
