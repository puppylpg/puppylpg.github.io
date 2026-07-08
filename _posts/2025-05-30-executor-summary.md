---
title: "汇总：线程执行器"
date: 2025-05-30 01:00:05 +0800
categories: [java, executor]
tags: [java, executor]
description: "汇总 Executor、ExecutorService、Future、ListenableFuture、CompletableFuture 与 ForkJoinPool 的异步执行文章。"
---

关于异步执行的所有：

```mermaid
flowchart LR
    Executor["Executor<br/>execute(Runnable)"] --> ExecutorService["ExecutorService<br/>submit + shutdown"]
    ExecutorService --> Future["Future<br/>状态 + 结果占位"]
    Future --> ListenableFuture["ListenableFuture<br/>完成后 listener"]
    Future --> CompletableFuture["CompletableFuture<br/>链式 Completion"]
    ExecutorService --> ForkJoinPool["ForkJoinPool<br/>分治 + work stealing"]

    style Executor fill:#e3f2fd,stroke:#1976d2
    style Future fill:#fff3bf,stroke:#f59f00
    style CompletableFuture fill:#e8f5e9,stroke:#2e7d32
    style ForkJoinPool fill:#f3e5f5,stroke:#8e24aa
```

1. 介绍`Executor`：[线程执行器（Executor）和线程池]({% post_url 2025-05-31-executor %})
2. 介绍`Future`和`ExecutorService`（主要是submit），因为它执行任务用的还是`Executor#execute`：[线程执行服务：`ExecutorService`]({% post_url 2025-05-31-executor-service %})
3. 介绍`ListenableFuture`，因为它依托于`FutureTask`在执行完任务后的回调机制，回调其他listener：[guava ListenableFuture]({% post_url 2025-05-31-listenable-future %})
4. 介绍`CompletableFuture`，因为它就是封装后带listener的任务，只不过任务不再显式提交：[CompletableFuture]({% post_url 2025-06-01-completable-future %})
5. 介绍`ForkJoinPool`：[ForkJoinPool]({% post_url 2025-06-02-fork-join-pool %})
