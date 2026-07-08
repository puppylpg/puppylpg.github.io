---
layout: post
title: "汇总：代理"
date: 2022-06-03 19:17:25 +0800
categories: [life, network, proxy]
tags: [network, proxy, shadowsocks, v2ray, ios]
description: "代理折腾系列索引：从 Shadowsocks 初体验，到 V2Ray 流量伪装，再到 iOS 设备上的代理配置。"
math: true
mermaid: true
---

代理——从入门到装逼。其实也没多装，更多是被现实按着学网络：端口、PAC、VMess、WebSocket、TLS、Nginx、iOS 美区账号，一套组合拳下来，人都精神了。

```mermaid
timeline
    title 代理折腾路线
    2021-11 : Shadowsocks 初体验
            : 买 VPS，自建代理服务
            : 先解决“能不能用”
    2022-01 : V2Ray + WebSocket + TLS
            : Shadowsocks 端口异常
            : 开始关注流量伪装和 Nginx 反代
    2022-06 : iOS 代理折腾
            : Shadowrocket、美区账号、换 IP
            : 终于承认生态限制也属于技术问题
```

| 文章 | 主要问题 | 关键词 |
|------|----------|--------|
| [代理 - shadowsocks](/life/2021/11/09/proxy/) | 代理是什么，怎么买 VPS 并自建 Shadowsocks | SOCKS、PAC、VPS、Shadowsocks |
| [代理 - v2ray](/life/2022/01/03/proxy-v2ray/) | Shadowsocks 端口异常后，如何用 V2Ray 做流量伪装 | VMess、WebSocket、TLS、Nginx |
| [RIP shadowsocks](/life/2022/06/03/proxy-rip-ss/) | 给 macOS/iPhone 配代理，以及被 iOS 和 GFW 双重教育 | Shadowrocket、iOS、美区账号、换 IP |


