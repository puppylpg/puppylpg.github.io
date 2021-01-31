---
layout: post
title: "Redis - misc"
date: 2021-01-31 18:48:32 +0800
categories: Redis
tags: Redis
---

redis其他值得一提的小功能。

1. Table of Contents, ordered
{:toc}

# runtime config
可以用 **`CONFIG SET <key> <value>`**进行runtime配置。

也可以 **`CONFIG GET <key>`**。

# slowlog
redis和mysql一样，也有慢查询日志。

在redis.conf里配置`slowlog-log-slower-than <number>`，记录大于number毫秒的命令，`slowlog-max-len <number>`记录了最多保存多少条。

实际redis在redisServer里用链表保存了所有符合条件的command，**并没有持久化**。使用**SLOWLOG LEN**/**SLOTLOG RESET**可以查看log。

# monitor
**MONITOR**：client可以把自己变成一个当前server的monitor，实时打印server收到的命令。

实现也很简单，和pub-sub，listener一样，都是在server里保存要接收命令的client，收到命令的时候遍历该list，发给他们就行了。

