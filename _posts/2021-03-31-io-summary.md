---
title: "汇总：IO"
date: 2021-03-31 00:38:53 +0800
categories: [io, nio, aio]
tags: [io, nio, aio]
description: "汇总 IO/NIO/AIO、IO 多路复用、异步 Servlet、零拷贝与字符编码等相关文章。"
---

汇总一下总结过的IO/NIO/AIO相关。

1. Table of Contents, ordered
{:toc}

看一篇就够了[从阻塞IO到IO多路复用到异步IO]({% post_url 2022-02-24-io-nio-aio %})，其他篇都成了补充。

IO模型：
- Blocking IO: [Java IO]({% post_url 2020-10-28-java-io %})；
- BIO服务器实现: [（一）How Tomcat Works - 原始Web服务器]({% post_url 2020-10-07-tomcat-web-server %})；
- Non-Blocking IO: [Java NIO]({% post_url 2020-10-29-java-nio %})；
- BIO和NIO的形象类比: [Http Server线程模型：NIO vs. BIO]({% post_url 2019-11-25-http-server-nio-bio %})；
- Java NIO所使用的os的底层机制：[epoll]({% post_url 2021-04-01-epoll %})；
- NIO和异步Servlet，其实这个异步和异步IO思想都是类似的，毕竟都是异步: [Servlet - NIO & Async]({% post_url 2021-03-24-servlet-nio-async %})；
- Asynchronous IO: [AIO]({% post_url 2021-03-31-aio %})；
- 文件原样传输的性能优化：[零拷贝：read/write、mmap 与 sendfile 的数据路径]({% post_url 2021-03-31-zero-copy %})；

读写时的编码问题：
- 字符集：[Unicode & UTF-n]({% post_url 2019-12-15-unicode-and-utf %})；

后续如果还有关于IO的，继续更新到这里。
