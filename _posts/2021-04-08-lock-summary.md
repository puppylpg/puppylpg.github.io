---
layout: post
title: "汇总：锁"
date: 2021-04-08 01:24:09 +0800
categories: Java concurrency
tags: Java concurrency
---

汇总一下总结过的锁相关文章。

1. Table of Contents, ordered
{:toc}

**Java锁相关的知识，其实就是围绕着内置锁、显式锁、不用锁（CAS）展开**：
1. 锁是如何使用的：[生产者 - 消费者]({% post_url 2020-05-17-producer-consumer %})；
2. 内置锁是如何实现的: [synchronized和Monitor]({% post_url 2021-04-07-monitor %})；
3. 也可以用显式锁: [显式锁]({% post_url 2019-12-10-lock %})；
4. 也未必非得用锁: [CAS：也可以不用锁]({% post_url 2019-12-09-cas-vs-lock %})；
5. 内置锁、显式锁、不用锁，pk一下：[锁性能比较]({% post_url 2019-12-11-lock-performance-compare %})；
6. 显式锁的实现原理：[AQS：显式锁的深层原理]({% post_url 2021-04-08-aqs %})；

其他和锁等效的东西：
- 用redis和zookeeper实现分布式锁：[Reids - 分布式锁 vs. zookeeper]({% post_url 2021-02-06-redis-zookeeper-dlock %})；

后续如果还有关于锁的，继续更新到这里。
