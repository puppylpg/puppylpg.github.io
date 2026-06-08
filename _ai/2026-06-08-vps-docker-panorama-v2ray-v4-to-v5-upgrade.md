---
title: "VPS Docker 服务全景与 V2Ray v4 到 v5 升级方案分析"
date: 2026-06-08 22:05:38 +0800
categories: [ai]
tags: [docker, v2ray, v2fly, nginx-proxy, acme-companion, reverse-proxy, vmess, aead, upgrade]
description: "梳理 VPS 上所有 Docker 容器的职责与连接方式，深入分析 V2Ray v4→v5 升级不能直接切换的原因及并行部署验证方案。"
---

1. Table of Contents, ordered
{:toc}

# 背景与目标

用户希望全面了解其 Debian VPS 上 Docker 容器的运行全景，并重点分析 V2Ray 从 v4 升级到 v5 的方案。服务器仅有 1GB 内存，运行着基于 `nginx-proxy` + `acme-companion` 的容器化反向代理架构。

# Docker 服务全景

## 整体架构

这台 VPS 上所有 Web 服务都通过 **nginx-proxy** 统一入口对外暴露，acme-companion 自动处理 SSL 证书。没有任何容器直接将端口映射到宿主机（`-p` 参数），所有流量都走 Docker 内部网络：

```mermaid
flowchart LR
    users[外部用户]

    subgraph host[VPS 宿主机]
        direction LR
        proxy[nginx-proxy<br/>80 / 443]

        subgraph docker[Docker bridge 网络]
            direction TB
            acme[acme-companion<br/>证书申请与续期]
            apps[业务容器<br/>wedding / ttq / memos / portainer / netdata / dailytxt / v2ray]
        end
    end

    users -->|HTTP 80 / HTTPS 443| proxy
    proxy -->|读取证书| acme
    proxy -->|按 VIRTUAL_HOST / path 转发| apps
    acme -. 共享 certs volume .-> proxy

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef docker fill:#f8f9fb,stroke:#b6beca,color:#1f2933;
    classDef cert fill:#efe3ff,stroke:#8b5fbf,color:#2d1b44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    class users user;
    class proxy gateway;
    class docker docker;
    class acme cert;
    class apps app;
```

当前运行的 10 个容器如下：

| 容器名 | 镜像 | 内部端口 | 职责 |
|--------|------|----------|------|
| `nginx-proxy` | `nginxproxy/nginx-proxy` | 80, 443 | 反向代理网关 |
| `nginx-proxy-acme` | `nginxproxy/acme-companion` | — | 自动申请/续期 Let's Encrypt 证书 |
| `wedding` | `nginx:alpine` | 80 | 静态站点（婚礼相册） |
| `ttq` | `nginx:alpine` | 80 | 静态站点 |
| `memos` | `neosmemo/memos:stable` | 5230 | 笔记服务 |
| `portainer` | `portainer/portainer-ce` | 8000, 9000, 9443 | Docker 可视化管理面板 |
| `netdata` | `netdata/netdata` | 19999 | 系统监控 |
| `dailytxt` | `phitux/dailytxt:1.0.13` | 80 | 日记服务 |
| `v2ray` | `v2fly/v2fly-core:v4.23.4` | 10087 | 代理服务（v4 稳定版） |
| `v2ray-new` | `v2fly/v2fly-core:latest` | 10087 | 代理服务（v5 测试版） |

## 各容器连接方式

### 1. nginx-proxy（反向代理网关）

```mermaid
flowchart LR
    user[外部用户]

    subgraph gateway[nginx-proxy]
        direction TB
        sock[/docker.sock/]
        scan[发现带 VIRTUAL_HOST 的容器]
        route[生成 nginx upstream]
    end

    apps[各业务容器]

    user -->|HTTP / HTTPS| route
    sock --> scan --> route
    route -->|Host / Path 分发| apps

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    class user user;
    class sock,scan,route gateway;
    class apps app;
```

`nginx-proxy` 通过挂载宿主机的 `/var/run/docker.sock` 实时感知容器状态。任何带有 `VIRTUAL_HOST` 环境变量的容器都会被自动注册为 upstream。

### 2. nginx-proxy-acme（SSL 证书自动管理）

```mermaid
flowchart LR
    containers[声明 LETS_ENCRYPT_HOST 的容器]

    subgraph certbot[nginx-proxy-acme]
        direction TB
        watch[监控证书需求]
        issue[申请 / 续期证书]
    end

    le[Let's Encrypt]
    volume[(certs 共享 volume)]
    proxy[nginx-proxy]
    user[外部用户]

    containers -.-> watch
    watch --> issue
    issue -->|ACME challenge| le
    le -->|签发证书| issue
    issue --> volume
    volume -->|挂载读取| proxy
    proxy -->|HTTPS| user

    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    classDef cert fill:#efe3ff,stroke:#8b5fbf,color:#2d1b44;
    classDef ca fill:#e3f7e7,stroke:#4b9b63,color:#183b22;
    classDef volume fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    class containers app;
    class watch,issue cert;
    class le ca;
    class volume volume;
    class proxy gateway;
```

`acme-companion` 不直接对外暴露端口，它通过 `--volumes-from nginx-proxy` 共享证书目录，并监控哪些容器声明了 `LETS_ENCRYPT_HOST`。

### 3. wedding / ttq（静态站点）

```mermaid
flowchart LR
    browser[用户浏览器]
    proxy[nginx-proxy]

    subgraph static[静态站点容器]
        direction TB
        wedding[wedding<br/>nginx:alpine<br/>80/tcp]
        ttq[ttq<br/>nginx:alpine<br/>80/tcp]
    end

    browser -->|HTTPS 443<br/>Host: wedding.puppylpg.top / ttq| proxy
    proxy -->|proxy_pass| wedding
    proxy -->|proxy_pass| ttq

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    class browser user;
    class proxy gateway;
    class wedding,ttq app;
```

两个静态站都是 `nginx:alpine` 容器，分别挂载不同的本地目录到 `/usr/share/nginx/html`。

### 4. memos（笔记服务）

```mermaid
flowchart LR
    browser[用户浏览器]
    proxy[nginx-proxy]

    subgraph memos_svc[memos 服务]
        direction TB
        app[memos<br/>5230/tcp]
        db[(SQLite 数据)]
        app --- db
    end

    browser -->|HTTPS 443<br/>Host: memos.puppylpg.top| proxy
    proxy -->|proxy_pass http://memos:5230| app

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    classDef data fill:#f4f4f5,stroke:#9ca3af,color:#1f2937;
    class browser user;
    class proxy gateway;
    class app app;
    class db data;
```

### 5. portainer（Docker 管理面板）

```mermaid
flowchart LR
    browser[用户浏览器]
    proxy[nginx-proxy]
    portainer[portainer<br/>9443/tcp<br/>仅 HTTPS]
    docker_sock[/docker.sock/]

    browser -->|HTTPS 443<br/>Host: portainer.puppylpg.top| proxy
    proxy -->|proxy_pass https://portainer:9443<br/>VIRTUAL_PROTO=https| portainer
    portainer -. 管理 Docker .-> docker_sock

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    classDef socket fill:#f4f4f5,stroke:#9ca3af,color:#1f2937;
    class browser user;
    class proxy gateway;
    class portainer app;
    class docker_sock socket;
```

portainer 的特殊之处在于它**只开 HTTPS**，因此 `VIRTUAL_PROTO=https` 告诉 nginx-proxy 使用 `proxy_pass https://...` 而非普通的 HTTP。

### 6. netdata（系统监控）

```mermaid
flowchart LR
    browser[用户浏览器]
    proxy[nginx-proxy]

    subgraph monitor[netdata 监控]
        direction TB
        netdata[netdata<br/>19999/tcp]
        proc[/宿主机 /proc/]
        sys[/宿主机 /sys/]
        netdata -. 采集 .-> proc
        netdata -. 采集 .-> sys
    end

    browser -->|HTTPS 443<br/>Host: netdata.puppylpg.top| proxy
    proxy -->|proxy_pass http://netdata:19999| netdata

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    classDef host fill:#f4f4f5,stroke:#9ca3af,color:#1f2937;
    class browser user;
    class proxy gateway;
    class netdata app;
    class proc,sys host;
```

netdata 容器挂载了宿主机的 `/proc`、`/sys` 等目录，用于采集系统级指标。

### 7. dailytxt（日记服务）

```mermaid
flowchart LR
    browser[用户浏览器]
    proxy[nginx-proxy]
    app[dailytxt<br/>gunicorn<br/>80/tcp]

    browser -->|HTTPS 443<br/>Host: memory.puppylpg.top| proxy
    proxy -->|proxy_pass http://dailytxt:80| app

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    class browser user;
    class proxy gateway;
    class app app;
```

### 8. v2ray（代理服务 v4）

```mermaid
flowchart LR
    client[用户 v2ray 客户端]
    proxy[nginx-proxy<br/>443/tcp]

    subgraph old[v4 老服务]
        direction TB
        path[/Path: /v2ray/]
        v4[v2ray<br/>v4.23.4<br/>10087/tcp]
        legacy[VMess legacy<br/>alterId: 64]
        path --> v4 --> legacy
    end

    client -->|WebSocket + TLS<br/>Host: puppylpg.top| proxy
    proxy -->|Upgrade: websocket| path

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    classDef warn fill:#fff0e6,stroke:#e07a2f,color:#4a2100;
    class client user;
    class proxy gateway;
    class path,v4 app;
    class legacy warn;
```

v2ray 使用 WebSocket 传输层，nginx-proxy 负责处理 WebSocket 的 `Upgrade` 和 `Connection` header 转发。

### 9. v2ray-new（代理服务 v5 测试）

```mermaid
flowchart LR
    client[用户 v2ray 客户端]
    proxy[nginx-proxy<br/>443/tcp]

    subgraph new[v5 测试服务]
        direction TB
        path[/Path: /v2ray5/]
        v5[v2ray-new<br/>v5.41.0<br/>10087/tcp]
        aead[VMess AEAD<br/>alterId: 0]
        path --> v5 --> aead
    end

    client -->|WebSocket + TLS<br/>Host: puppylpg.top| proxy
    proxy -->|Upgrade: websocket| path

    classDef user fill:#fff7cc,stroke:#d6a500,color:#222;
    classDef gateway fill:#dff1ff,stroke:#4a90c2,color:#0f2f44;
    classDef app fill:#ffe5ec,stroke:#d85a7f,color:#3b1723;
    classDef ok fill:#e3f7e7,stroke:#4b9b63,color:#183b22;
    class client user;
    class proxy gateway;
    class path,v5 app;
    class aead ok;
```

v2ray-new 与 v2ray 的唯一外部差异是 WebSocket 路径不同（`/v2ray5` vs `/v2ray`），内部差异是 alterId（0 vs 64）和版本（v5 vs v4）。

# V2Ray v4→v5 升级分析

## 为什么不能直接升级

直接从 `v4.23.4` 升级到 `v5.41.0` 会遇到两个**硬性不兼容**：

### 1. 启动命令格式变更

v5 的 Docker 镜像 ENTRYPOINT 已改为 `/usr/bin/v2ray`，但 CMD 为空，要求显式传入子命令：

| 版本 | 正确启动命令 |
|------|-------------|
| v4.x | `v2ray -config=/etc/v2ray/config.json` |
| v5.x | `v2ray run -config=/etc/v2ray/config.json` |

如果沿用 v4 的 `docker run` 命令（包含 `v2ray -config=...`），最终执行的命令会变成：

```
/usr/bin/v2ray v2ray -config=/etc/v2ray/config.json
```

这导致 v5 报错 `v2ray v2ray: unknown command`，容器启动即崩溃。

### 2. VMess 协议安全模型变更

| 版本 | alterId | 校验方式 |
|------|---------|----------|
| v4.23.4 | `64` | MD5 时间戳校验（旧协议） |
| v5.41.0 | `0` | AEAD（AES-GCM，新协议） |

v5 移除了对非零 `alterId` 的支持。如果强行在 v5 配置里写 `alterId: 64`，服务端无法正常处理旧客户端的握手请求。

## 做了哪些操作

为了验证升级可行性，采取了**并行部署**策略：

1. **保留老服务**：`v2ray` 容器（v4.23.4）保持运行，路径 `/v2ray`，确保现有用户不断线。
2. **部署新实例**：创建 `v2ray-new` 容器（v5.41.0），使用新路径 `/v2ray5` 避免冲突。
3. **修正启动命令**：使用 `run -config=...` 而非 `-config=...`。
4. **修改配置**：将 `alterId` 从 `64` 改为 `0`，其余参数（UUID、端口、WebSocket 路径等）保持一致。
5. **验证连接**：用户通过客户端连接 `/v2ray5` 路径，确认 v5 服务可用。

## 为什么要并行部署

直接替换老容器的风险在于：**一旦升级失败或配置有误，所有用户会立即断网**。并行部署的好处：

- **灰度验证**：可以先测试 v5 是否正常工作，再决定是否迁移用户。
- **快速回滚**：如果 v5 有问题，用户立刻切回 `/v2ray` 即可恢复。
- **不影响现有业务**：老 v4 用户全程无感知。

## 破坏性改动与旧服务无法关停的原因

旧服务（v4）**暂时不能关**，核心原因是 **alterId 协议不兼容**：

- 所有老用户的客户端配置里是 `alterId: 64`。
- v5 服务端只认 `alterId: 0`（AEAD）。
- 如果关掉 v4，所有未更新配置的老用户会立即连不上服务器。

这意味着 **"零改动无缝升级"是不可能的**。必须经历一个过渡期：

1. 并行运行 v4 + v5。
2. 通知所有用户把客户端配置里的 `alterId: 64` 改成 `0`，其他参数不变。
3. 确认大部分用户迁移后，再关闭 v4。

另一个细节是内部端口：v4 和 v5 容器内部都使用 `10087`，但由于 Docker 网络隔离（各自独立的 IP 地址），不会冲突。对外暴露的差异仅体现在 nginx-proxy 的 path 路由上（`/v2ray` vs `/v2ray5`）。

# 核心结论

- **v5 不会加速**：延迟取决于物理网络路径，软件版本升级不改变路由。
- **v5 的优势在安全性和可维护性**：AEAD 替代 MD5，且 v4 已停止维护。
- **升级不能一刀切**：`alterId: 64→0` 是协议分水岭，必须通知用户同步修改客户端配置。
- **并行部署是最佳策略**：保留 v4 运行，用不同 path 部署 v5，等用户迁移后再下线老版本。
