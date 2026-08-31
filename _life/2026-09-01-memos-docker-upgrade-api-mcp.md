---
layout: post
title: "Memos 0.30 自托管：Docker 升级、SQLite 备份与 MCP 调用链"
date: 2026-09-01 00:27:07 +0800
categories: [life, vps, docker, memos]
tags: [memos, docker, sqlite, backup, api, mcp, self-hosted]
description: "从一次 Memos 0.29.1 到 0.30.0 的 Docker 升级出发，梳理 SQLite 数据卷与备份方式，并结合源码解释 REST API、MCP 工具生成及客户端调用时序。"
mermaid: true
---

把 Memos 跑进 Docker 之后，日常使用几乎感受不到容器、数据库和接口的存在：浏览器打开网页，写下一条 memo，内容就留在时间线上。直到需要升级版本，几个原本藏在界面后面的问题才会同时出现：容器删掉后数据还在不在，SQLite 应该怎样备份，`/api/v1` 和 `/mcp` 又为什么能操作同一批 memo？

这些问题对应 Memos 的三层边界：**容器负责运行，数据卷负责持久化，API 与 MCP 负责把能力开放给不同客户端**。沿着这三层向下梳理，升级过程和 AI 接入方式就能落在同一套系统结构里。

1. Table of Contents, ordered
{:toc}

## 一个容器背后的运行、数据与接口

当前实例运行在 VPS 上，由 `nginx-proxy` 提供域名和 HTTPS 入口，Memos 容器只监听内部的 `5230` 端口。完整的单容器命令仍记录在[Docker 服务汇总](/life/2023/03/13/dockerize-nginx/#memos)中；从系统边界看，这条命令实际建立了三组关系。

```mermaid
flowchart LR
    browser[浏览器] -->|HTTPS| proxy[nginx-proxy]
    agent[AI Agent / MCP 客户端] -->|Streamable HTTP| proxy
    script[脚本 / 普通应用] -->|REST HTTP| proxy

    proxy --> memos[Memos 容器<br/>5230]
    memos -->|/var/opt/memos| volume[(memos_data)]
    volume --> db[(memos_prod.db)]
    volume --> local[附件与缩略图缓存]

    memos --> api["/api/v1/*"]
    memos --> mcp["/mcp"]
    mcp -->|进程内转换| api
```

运行层是可以替换的容器。`docker rm memos` 删除的是进程、镜像配置和容器可写层，不会自动删除独立的 named volume。持久化层来自下面这段挂载：

```bash
-v memos_data:/var/opt/memos
```

`memos_data` 是 Docker 管理的命名卷，`/var/opt/memos` 是 Memos 在容器内看到的数据目录。当前宿主机上的实际目录为：

```text
/var/lib/docker/volumes/memos_data/_data
```

升级前实测整个 volume 约 `233 MiB`，主要包括：

| 内容 | 实测大小 | 作用 |
|---|---:|---|
| `memos_prod.db` | 约 `138 MiB` | SQLite 主数据库，保存 memo 和实例数据 |
| `memos_prod.db-wal`、`memos_prod.db-shm` | 随运行状态变化 | SQLite WAL 模式的辅助文件 |
| `.thumbnail_cache` | 约 `95 MiB` | 图片缩略图缓存 |
| `assets/` | 当前未出现，后续可能存在 | 使用本地附件存储时保存上传文件 |

因此，**volume 不是另一种数据库，而是承载 SQLite 数据库及本地文件的持久化目录**。Memos 的[备份文档](https://usememos.com/docs/operations/backup-restore)也把数据库、附件存储和部署配置列为完整恢复所需的三类内容。

## 升级必须先围绕数据设计

Memos 会在新版本启动时自动迁移数据库。迁移让升级变得省事，也意味着旧程序未必还能理解迁移后的结构；[官方升级说明](https://usememos.com/docs/operations/upgrade)明确把升级流程概括为“备份、替换版本、启动、验证”，并要求回退时恢复升级前备份，而不是让旧版直接读取新版数据库。

### 先拉取并核对目标版本

这次升级前，容器使用可变的 `neosmemo/memos:stable` tag，但容器内实际版本仍为 `0.29.1`。拉取新 tag 不会影响正在运行的旧容器，因此可以先完成下载并检查版本，缩短后面的停机时间：

```bash
docker pull neosmemo/memos:0.30.0

docker run --rm \
  --entrypoint /usr/local/memos/memos \
  neosmemo/memos:0.30.0 version
# 0.30.0
```

生产部署改用明确的 `0.30.0`，避免下一次拉取 `stable` 时在不知情的情况下跨版本。

### 停机打包整个 volume

SQLite 正在 WAL 模式下写入时，单独复制 `memos_prod.db` 可能得到不一致的文件。手动升级频率不高，最稳妥的方案是让 Memos 短暂停机，再通过临时 BusyBox 容器只读挂载并打包整个 volume：

```bash
memos_backup_dir=/home/pichu/backups/memos
memos_backup_stamp=$(date '+%Y%m%d-%H%M%S')
memos_backup_file="memos-data-pre-0.30.0-${memos_backup_stamp}.tar.gz"

mkdir -p "$memos_backup_dir"
docker stop --time 30 memos

docker run --rm \
  -v memos_data:/data:ro \
  -v "$memos_backup_dir":/backup \
  busybox:latest \
  tar -czf "/backup/$memos_backup_file" -C /data .

# 压缩包至少要能完整读取，并记录校验值。
tar -tzf "$memos_backup_dir/$memos_backup_file" >/dev/null
sha256sum "$memos_backup_dir/$memos_backup_file"
```

这次实际生成的备份是：

```text
/home/pichu/backups/memos/memos-data-pre-0.30.0-20260831-211147.tar.gz
```

压缩后约 `231 MiB`。它能处理版本迁移失败和误操作，但仍与原数据位于同一块 VPS 磁盘；要防范磁盘损坏或整机丢失，还要把备份复制到另一台机器或对象存储。日常不停机备份则应使用 SQLite 的 `.backup` 命令获取 WAL 一致快照，并另行备份本地附件，不能定时生硬地 `cp memos_prod.db`。

### 用原 volume 重建容器

备份通过检查后，删除旧容器并用同一个 `memos_data` 创建 `0.30.0` 容器：

```bash
docker rm memos

docker run --detach --name memos \
  --restart=always \
  -v memos_data:/var/opt/memos \
  --env VIRTUAL_HOST=memos.puppylpg.top \
  --env VIRTUAL_PORT=5230 \
  --env LETSENCRYPT_HOST=memos.puppylpg.top \
  --env MEMOS_PORT=5230 \
  neosmemo/memos:0.30.0
```

Memos `0.30.0` 在没有设置 `MEMOS_INSTANCE_URL` 时会进入 private mode。当前实例保留这个行为：匿名用户不能读取 memo，登录用户和携带有效 token 的客户端仍能按账号权限访问。如果需要公开时间线、RSS 等匿名能力，应把 `MEMOS_INSTANCE_URL` 设置为实例的规范外部地址。

升级是否完成不能只看容器处于 `Up` 状态，还要验证版本、迁移日志、HTTPS 入口和访问边界：

```bash
docker exec memos /usr/local/memos/memos version
docker logs --tail 100 memos
curl -I https://memos.puppylpg.top/
curl -i 'https://memos.puppylpg.top/api/v1/memos?pageSize=1'
```

本次验收结果为版本 `0.30.0`、日志显示 `Access mode: private`、HTTPS 返回 `200`，匿名读取 memo API 返回 `401 authentication required`。

## API 是能力底座，MCP 是 Agent 适配层

服务恢复后，浏览器、脚本和 AI Agent 最终都在读写同一个 SQLite 数据库，但它们面对的接口并不相同。普通集成使用 `/api/v1` 下的 REST API；MCP 客户端连接单一的 `/mcp` 入口，通过 `tools/list` 发现工具，再通过 `tools/call` 调用工具。

| 维度 | REST API | MCP |
|---|---|---|
| 入口 | `/api/v1/...` 多个资源路径 | `/mcp` 单一协议入口 |
| 调用者 | 脚本、CLI、普通应用 | Claude、Codex 等 AI Host 内的 MCP 客户端 |
| 表达方式 | HTTP method、path、query、JSON body | 工具名、描述、JSON Schema、arguments |
| 能力范围 | 完整公开 API | 从 API 中挑选出的工具白名单 |
| 鉴权 | Bearer token | 转发同一个 Bearer token |
| 业务实现 | API service、store、SQLite | 不拥有独立 store，复用 API |

这不是两套平行实现，更不是相互依赖。**依赖方向只有 MCP → API**：REST API 可以独立工作，MCP 是建立在 API 描述和 API 路由之上的 Agent 适配层。

### OpenAPI 描述 API，但不负责注册 API

OpenAPI 只是 **REST API 的机器可读说明书**。`/api/v1` 是真正接收请求并执行读写的接口；OpenAPI 文档则记录每项接口的 HTTP method、path、参数、请求体、返回值和 `operationId`。它不监听端口、不处理请求，也不访问数据库。

Memos 也不是先写 OpenAPI，再让 OpenAPI 在运行时“注册”REST API。`v0.30.0` 以 protobuf API 定义为源头，[`buf.gen.yaml`](https://github.com/usememos/memos/blob/v0.30.0/proto/buf.gen.yaml) 在构建阶段分别生成 gRPC-Gateway 路由代码和 OpenAPI 文档。两者是从同一份定义生成的兄弟产物：前者参与实现 `/api/v1`，后者负责描述 `/api/v1`。

普通开发者可以阅读 API 文档后手写 `curl`；代码生成器可以读取 OpenAPI 生成客户端；Memos 的 MCP 实现则读取同一份 OpenAPI，把其中一部分 API 操作转换成模型能理解的工具。因此三者的关系是：

```text
REST API：真正执行业务能力
OpenAPI：对 REST API 的结构化描述
MCP：把部分 API 描述转换成工具，执行时仍复用 REST API
```

### 工具生成横跨构建、启动和请求三个阶段

“根据 OpenAPI 生成 MCP Tools”听起来像编译，但在 Memos 中实际分成三个生命周期。只有第一段属于构建产物；容器重启和每次工具调用走的是另外两段。

```mermaid
flowchart LR
    subgraph build["① 构建镜像"]
        proto[protobuf API 定义]
        gateway[gRPC-Gateway 路由代码]
        yaml[openapi.yaml]
        binary[Memos 二进制]

        proto --> gateway --> binary
        proto --> yaml -->|go:embed| binary
    end

    subgraph startup["② 每次进程启动"]
        parse[解析内嵌 OpenAPI]
        registry[按 operationId 建立 registry]
        allowlist[筛选 MCP 工具白名单]
        tools[在内存中注册 Tools]

        parse --> registry --> allowlist --> tools
    end

    subgraph request["③ 每次 tools/call"]
        lookup[查询内存映射]
        adapter[API Adapter 构造请求]
        route[进程内调用 /api/v1]
        sqlite[(SQLite)]

        lookup --> adapter --> route --> sqlite
    end

    binary --> parse
    tools --> lookup
```

在**构建阶段**，生成的 `openapi.yaml` 会通过 `go:embed` 打进 Memos 二进制，所以部署 `neosmemo/memos:0.30.0` 时，不需要在 volume 里另外保存一份 OpenAPI 文件，也不需要容器启动后再联网下载它。

在**每次进程启动时**，[`service.go`](https://github.com/usememos/memos/blob/v0.30.0/server/router/mcp/service.go) 会解析二进制里内嵌的 OpenAPI，建立 operation registry，筛选白名单，再把工具名、说明、输入输出 JSON Schema 和 handler 注册到内存。容器或 Memos 进程重启后，这段初始化会自动再执行一次；它只是读取和整理已有描述，并不是重新运行代码生成器、重新编译程序或重新构建镜像。

在**每次请求时**，MCP handler 不会重新解析 OpenAPI。它直接查询启动时建立的内存映射，把 `tools/call` 的工具名和 arguments 对应到具体 API operation。由此可以得到一个更精确的结论：**接口不变时，OpenAPI 不参与单次请求的执行；但 Memos 当前实现仍需要它在每次启动时重建内存中的工具目录。**

如果一个项目选择提前把工具定义和 handler 生成为静态代码，确实可以让运行时完全不再读取 OpenAPI；但 Memos `v0.30.0` 没有采用这种“提前编译完 Tools”的实现。

例如，同一项能力在几层中的名字依次为：

| OpenAPI operation | MCP tool | 内部 REST 请求 |
|---|---|---|
| `MemoService_ListMemos` | `memo_list_memos` | `GET /api/v1/memos` |
| `MemoService_CreateMemo` | `memo_create_memo` | `POST /api/v1/memos` |
| `MemoService_UpdateMemo` | `memo_update_memo` | `PATCH /api/v1/memos/{id}` |
| `AttachmentService_CreateAttachment` | `attachment_create_attachment` | `POST /api/v1/attachments` |
| `AuthService_GetCurrentUser` | `auth_get_current_user` | `GET /api/v1/auth/me` |

`v0.30.0` 的工具白名单共有 20 项，覆盖 memo、评论、附件、reaction、relation、shortcut 和当前用户识别，但没有把全部管理 API 都交给 Agent。具体 operation 列表集中在 [`catalog.go`](https://github.com/usememos/memos/blob/v0.30.0/server/router/mcp/catalog.go)；工具名称、输入 schema、输出 schema 以及只读、幂等、破坏性提示也都从 OpenAPI operation 和少量覆盖规则生成。

### MCP 接住协议请求，业务仍由 API 执行

客户端调用 `memo_list_memos` 后，[`adapter.go`](https://github.com/usememos/memos/blob/v0.30.0/server/router/mcp/adapter.go) 会把 arguments 分解成 path 参数、query 参数和 JSON body，构造对应的 `/api/v1/...` HTTP 请求，并原样转发 `Authorization` header。

这条请求没有从 VPS 发到公网域名再绕回来。Adapter 使用同一个 Echo server 的 `ServeHTTP` 在进程内派发请求，因此 API 原有的路由、认证、授权、错误处理和 service/store 逻辑都会照常执行。成功的 API JSON 被包装成 MCP `structuredContent`；非 `2xx` 响应则被转换为 `isError: true` 的工具结果，让模型能够看到错误并调整下一步。

因此，“MCP 可以独立承接请求”要分两层理解：`/mcp` 可以作为独立的网络入口接收 MCP 协议请求；但生成出来的 Tool 只是 schema、operation 映射和通用 handler，并没有复制 memo 的 CRUD 业务逻辑。Memos MCP 仍依赖同一进程中的 `/api/v1` 路由、认证、service、store 和 SQLite，不能把 OpenAPI 用完后就脱离 API 单独提供等价服务。

OpenAPI 在这里承担“单一事实源”的作用：API 字段发生变化时，MCP 工具 schema 也从同一份描述生成，避免手写两套参数定义逐渐分叉。

### OpenAPI 转 MCP 是实现选择，不是 MCP 标准要求

MCP 标准规定的是服务器向客户端暴露 `tools/list`、响应 `tools/call`，以及每个 Tool 应怎样提供名称、描述和 JSON Schema；它没有规定这些工具必须来自 OpenAPI。服务器完全可以手写并注册工具，让 handler 直接调用内部 service，也可以像 Memos 一样用 OpenAPI 包装已有 REST API。

对已经拥有大量 REST API 的服务，OpenAPI 转 MCP 能复用现有接口描述、鉴权和业务实现，是一种实用的工程路径；但它不是 MCP Server 的唯一形式，也不是协议要求的“标准编译步骤”。Memos 还在自动转换之上增加了 20 项工具白名单和少量 schema 覆盖规则，因此也不是把整份 OpenAPI 不加选择地一键变成 MCP。

## MCP 客户端的一次完整调用

MCP 把 REST 操作改写成模型理解的工具，但工具不会凭空执行。一次完整调用同时涉及用户、AI Host、Host 内的 MCP Client、Memos MCP handler、API 路由和数据库。

调用的起点是 Host 中的一条 MCP server 配置。当前实例处于 private mode，因此客户端连接 `/mcp` 时要随请求携带单独创建的 PAT：

```json
{
  "mcpServers": {
    "memos": {
      "type": "http",
      "url": "https://memos.puppylpg.top/mcp",
      "headers": {
        "Authorization": "Bearer memos_pat_xxx"
      }
    }
  }
}
```

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant H as AI Host<br/>Claude / Codex 应用
    participant L as LLM
    participant C as MCP Client
    participant M as Memos /mcp
    participant A as MCP API Adapter
    participant R as Echo /api/v1
    participant D as SQLite

    Note over H,C: Host 保存 MCP URL 与独立 PAT
    C->>M: POST /mcp · initialize<br/>协议版本、clientInfo、capabilities
    M-->>C: serverInfo、tools capability
    C->>M: notifications/initialized
    C->>M: POST /mcp · tools/list
    M-->>C: 工具名、描述、input/output schema、annotations
    C-->>H: 返回工具定义

    U->>H: “找出最近的 Memos 并总结”
    H->>L: 对话 + 可用工具定义
    L-->>H: 选择 memo_list_memos<br/>生成 arguments
    H->>C: 调用工具，传入 filter、pageSize 等 arguments
    C->>M: POST /mcp · tools/call<br/>Authorization: Bearer PAT
    M->>M: Origin 检查、解析参数、JSON Schema 校验
    M->>A: operation 映射与 arguments
    A->>R: 进程内 GET /api/v1/memos?...<br/>转发 Authorization
    R->>R: 验证 PAT，恢复用户与权限
    R->>D: 查询当前用户可见的 memo
    D-->>R: 查询结果
    R-->>A: HTTP status + JSON

    alt API 返回 2xx
        A-->>M: structuredContent
        M-->>C: tools/call result
        C-->>H: 工具结果
        H->>L: 对话 + 工具结果
        L-->>H: 基于 memo 内容生成回答
        H-->>U: 返回自然语言回答
    else API 返回非 2xx
        A-->>M: isError: true + 错误文本
        M-->>C: 工具错误结果
        C-->>H: 返回错误结果
        H->>L: 对话 + 工具错误
        L-->>H: 决定重试、解释或请求补充信息
        H-->>U: 返回失败原因或补充问题
    end
```

这段时序可以拆成两个阶段。

**连接与发现阶段**先执行 `initialize`，协商协议版本和 capability。Memos `0.30.0` 只声明 tools，不提供旧版 MCP 的 prompts 和 resources；随后 `tools/list` 把工具名称、说明和 JSON Schema 交给 Host。Memos 使用 Streamable HTTP，但服务端配置为 stateless 和 JSON response：协议握手仍然存在，服务端不依赖跨请求 session 保存调用状态。

**对话与执行阶段**由 Host 把用户消息和工具定义一起交给模型。模型输出工具名和 arguments 后，Host 内的 MCP Client 才真正发送 `tools/call`。也就是说，Memos MCP server 不会自动看到整段聊天记录；它只收到这次工具调用所需的参数和认证信息。这个边界与 MCP 的[Host—Client—Server 架构](https://modelcontextprotocol.io/specification/2025-06-18/architecture)一致：对话编排和用户确认属于 Host，Memos server 只负责聚焦的数据能力。

## 接入 Agent 后仍要守住权限边界

REST API 和 MCP 复用同一种 token 与用户权限，因此 MCP 并不会天然获得额外权限，也不会天然更安全。当前实例处于 private mode，读取私有 memo 和任何写操作都需要有效 token；PAT 能做什么，取决于它所属用户能做什么。

接入时应遵循几条边界：

- **每个客户端使用独立 PAT**，便于查看使用情况和单独吊销，不要让多个自动化共享一个长期 token；
- **把 PAT 当密码保存**，只写入客户端的 secret 配置，不能提交到博客或公开仓库；
- **关注工具的破坏性提示**，`memo_delete_memo`、附件删除以及可能覆盖字段的更新都应由 Host 请求用户确认；
- **白名单不是权限系统**，MCP 的 20 个工具和 annotations 只是暴露面与客户端提示，最终授权仍由 `/api/v1` 的认证链决定；
- **浏览器客户端还受 Origin 检查**，跨域来源不符合实例 Host 或配置的 Instance URL 时会收到 `403`，桌面客户端通常不发送 Origin。

脚本需要精确控制 HTTP method、批量处理数据或调用 MCP 白名单之外的能力时，直接使用 `/api/v1` 更合适；希望模型根据自然语言选择操作、读取结果再继续推理时，使用 `/mcp` 更自然。二者最终汇入同一条 API service、store 和 SQLite 链路，所以备份保护的数据、账号限制的权限以及升级迁移的数据库始终只有一套。
