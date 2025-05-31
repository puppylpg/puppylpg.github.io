---

layout: post  
title: "汇总：线程执行器"  
date: 2025-05-30 01:00:05 +0800  
categories: Java Executor  
tags: Java Executor

---

supplyAsync只不过是一种快速sumbit异步任务的方式。和显式用一个线程池submit没什么区别。尤其是当看到supplyAsync支持显式传一个线程池的时候。

thenApply等方法不过是一种快速创建ListenableFuture的方式。cf完成之后要触发这些listener的调用，所以整个cf的结束时间要大于本身任务的时间，尤其是listener也要执行很久的时候。


学习路线：
1. 介绍`Executor`：[线程执行器（Executor）和线程池]({% post_url 2025-05-31-executor %})
3. 介绍`Future`和`ExecutorService`（主要是submit），因为它执行任务用的还是`Executor#execute`：[线程执行服务：`ExecutorService`]({% post_url 2025-05-31-executor-service %})
4. 介绍`ListenableFuture`，因为它依托于`FutureTask`在执行完任务后的回调机制，回调其他listener：[guava ListenableFuture]({% post_url 2025-05-31-listenable-future %})
5. 介绍`CompletableFuture`，因为它就是封装后带listener的任务，只不过任务不再显示提交：[CompletableFuture]({% post_url 2025-05-31-completable-future %})
6. 介绍`ForkJoinPool`
