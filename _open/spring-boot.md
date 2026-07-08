---
title: spring-boot
date: 2023-12-28 16:12:48 +0800
description: "Spring Boot Elasticsearch 自动配置 PR 复盘：为 socket keep alive 增加配置项，并理解自动配置不改变默认行为的原则。"
categories: [open-source, spring-boot]
tags: [spring-boot, elasticsearch, autoconfiguration, tcp, open-source]
---

- [my issue](https://github.com/spring-projects/spring-boot/issues?q=is%3Aissue+author%3A%40me+)
- [my PR](https://github.com/spring-projects/spring-boot/pulls?q=is%3Apr+author%3A%40me+)

1. Table of Contents, ordered
{:toc}

## [#32051](https://github.com/spring-projects/spring-boot/pull/32051)

这个 PR 为 Spring Boot 增加了配置参数：`spring.elasticsearch.socket-keep-alive`，用于启用 Elasticsearch client 和 server 之间的 socket keep alive。直觉上它像是一个很有用的开关，因为长连接场景里，连接是否能被及时探活直接影响客户端和服务端之间的稳定性。

不过 Spring Boot 的自动配置有一个很重要的原则：**自动配置不应该偷偷改变底层组件的默认行为**。所以即便这个配置很有用，自动配置出来的 client 依然要和底层参数初始值保持一致，默认值仍然是 `false`。

```mermaid
flowchart LR
    A["application.yml / properties"] --> B["spring.elasticsearch.socket-keep-alive"]
    B --> C["Spring Boot Elasticsearch 自动配置"]
    C --> D["Elasticsearch client builder"]
    D --> E["socket keep alive"]
    B --> F{"用户是否显式配置？"}
    F -->|是| G["使用用户配置值"]
    F -->|否| H["保持底层默认值 false"]

    style B fill:#e3f2fd,stroke:#1976d2
    style G fill:#e8f5e9,stroke:#2e7d32
    style H fill:#fff3bf,stroke:#f08c00
```

这次改动本身不大，但它把 Spring Boot 自动配置的边界讲得很清楚：**可以暴露开关，让用户更容易配置；但不能因为维护者觉得某个值“更合理”，就替用户改掉默认语义。**

> 测试用例不错，展示了如何方便地在spring系统中增加一个property value。
{: .prompt-tip }
