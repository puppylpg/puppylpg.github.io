---

layout: post  
title: "汇总：线程执行器"  
date: 2025-05-30 01:00:05 +0800  
categories: Java Executor  
tags: Java Executor

---

supplyAsync只不过是一种快速sumbit异步任务的方式。和显式用一个线程池submit没什么区别。尤其是当看到supplyAsync支持显式传一个线程池的时候。

thenApply等方法不过是一种快速创建ListenableFuture的方式。cf完成之后要触发这些listener的调用，所以整个cf的结束时间要大于本身任务的时间，尤其是listener也要执行很久的时候。


行文路线：
1. 最老的那版介绍线程池概念的文章
2. 介绍Executor - ThreadPoolExecutor
3. 介绍Future和ExecutorService（主要是submit）：因为它执行任务用到了Executor#execute
4. 介绍ListenableFuture，因为它依托于FutureTask在执行完任务后的线程notify机制，回调其他listener
5. 介绍CompletableFuture，因为它就是封装后带带listener的任务
6. 介绍ForkJoinPool
