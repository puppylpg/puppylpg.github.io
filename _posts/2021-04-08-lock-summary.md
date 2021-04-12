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

Java相关的锁：
- 内置锁wait/notify，“独立waitset”Condition的使用方法：[生产者 - 消费者]({% post_url 2020-05-17-producer-consumer %})；
- 显式锁和内置锁的比较，显式锁介绍: [锁]({% post_url 2019-12-10-lock %})；
- CAS、ABA问题、AtomicStampedReference、CAS和锁的区别: [CAS vs. 锁]({% post_url 2019-12-09-cas-vs-lock %})；
- [锁性能比较]({% post_url 2019-12-11-lock-performance-compare %})；
- 内置锁synchronized的底层原理: [Java Monitor]({% post_url 2021-04-07-monitor %})；
- 显式锁、Condition的实现原理：[AQS：显式锁的深层原理]({% post_url 2021-04-08-aqs %})；


分布式锁：
- 用redis和zookeeper实现分布式锁：[Reids - 分布式锁 vs. zookeeper]({% post_url 2021-02-06-redis-zookeeper-dlock %})；

后续如果还有关于锁的，继续更新到这里。

