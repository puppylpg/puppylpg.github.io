---
title: micrometer
date: 2023-12-28 16:45:43 +0800
description: "Micrometer 开源贡献复盘：为 Tomcat 连接相关状态补充指标，让容器层连接情况进入监控体系。"
categories: [open-source, micrometer]
tags: [micrometer, tomcat, metrics, monitoring, open-source]
---

- [my issue](https://github.com/micrometer-metrics/micrometer/issues?q=is%3Aissue+author%3A%40me+)
- [my PR](https://github.com/micrometer-metrics/micrometer/pulls?q=is%3Apr+author%3A%40me+)

1. Table of Contents, ordered
{:toc}

## [#2248](https://github.com/micrometer-metrics/micrometer/pull/2248)

这个 PR 为 Micrometer 增加了一些有关 Tomcat 连接的 metric。

Micrometer 的价值在这里很直接：Tomcat 自己掌握连接状态，业务系统平时又通过 Micrometer 把指标交给后端监控系统。中间缺少连接相关指标时，排查连接耗尽、连接波动、吞吐异常这类问题就会少一块视野。

```mermaid
flowchart LR
    A["Tomcat connector"] --> B["连接相关状态"]
    B --> C["Micrometer binder"]
    C --> D["MeterRegistry"]
    D --> E["Prometheus / 其他监控后端"]
    E --> F["告警与排障"]

    style B fill:#e3f2fd,stroke:#1976d2
    style D fill:#fff3bf,stroke:#f08c00
    style F fill:#e8f5e9,stroke:#2e7d32
```

这类指标不是业务指标，但它很适合用来回答“是不是容器层已经不太对劲了”。如果只看接口耗时和错误率，问题往往已经晚了一步；连接层指标能把排查位置往前推。
