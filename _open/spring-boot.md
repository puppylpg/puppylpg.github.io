---
title: spring-boot
date: 2023-12-28 16:12:48 +0800
order: 2
---

- [my issue](https://github.com/spring-projects/spring-boot/issues?q=is%3Aissue+author%3A%40me+)
- [my PR](https://github.com/spring-projects/spring-boot/pulls?q=is%3Apr+author%3A%40me+)

1. Table of Contents, ordered
{:toc}

## [#32051](https://github.com/spring-projects/spring-boot/pull/32051)
为springboot增加配置参数：`spring.elasticsearch.socket-keep-alive`，用于启用elasticsearch client和server之间的长连接。

springboot所有的自动配置，都和参数的初始值保持一致。所以即便这是个很有用的配置，自动配置出来的client，依然采用默认值false。

> 测试用例不错，展示了如何方便地在spring系统中增加一个property value。
{: .prompt-tip }
