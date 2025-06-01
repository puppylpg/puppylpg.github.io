---

layout: post  
title: "ForkJoinPool"
date: 2025-06-02 00:55:55 +0800  
categories: Java Executor  
tags: Java Executor

---

`ForkJoinPool`和`ThreadPoolExecutor`不仅都是`ExecutorService`接口的实现，还都是`AbstractExecutorService`的子类。
从`ThreadPoolExecutor#execute`可以看出来，它是一个池化的实现，需要协调线程的创建，并从一个`BlockingQueue`里取任务。那么通过看`ForkJoinPool#execute`，就可以看到它的工作原理和线程池的区别。

1. Table of Contents, ordered
{:toc}

# 先从逻辑上理解`ForkJoinPool`
`ThreadPoolExecutor`和`ForkJoinPool`虽然都是用于并行执行任务的线程池，但它们的设计目标和适用场景有所不同。`ForkJoinPool`是Java 7引入的一种特殊线程池，主要解决**分治任务**的高效执行问题，特别是在处理递归分解的**计算密集型任务**时表现更为出色。


## **核心差异与设计目标**
### 工作窃取算法（Work-Stealing）
`ForkJoinPool`使用工作窃取算法来优化任务调度：每个工作线程维护自己的任务队列，当某个线程完成自己的任务后，可以从其他线程的队列末尾“窃取”任务执行。这种机制减少了线程间的竞争，提高了并行度。  

```java
    /**
     * Arranges for (asynchronous) execution of the given task.
     *
     * @param task the task
     * @throws NullPointerException if the task is null
     * @throws RejectedExecutionException if the task cannot be
     *         scheduled for execution
     */
    public void execute(ForkJoinTask<?> task) {
        poolSubmit(true, task);
    }
    
    /**
     * Pushes a submission to the pool, using internal queue if called
     * from ForkJoinWorkerThread, else external queue.
     */
    private <T> ForkJoinTask<T> poolSubmit(boolean signalIfEmpty,
                                           ForkJoinTask<T> task) {
        WorkQueue q; Thread t; ForkJoinWorkerThread wt;
        U.storeStoreFence();  // ensure safely publishable
        if (task == null) throw new NullPointerException();
        if (((t = Thread.currentThread()) instanceof ForkJoinWorkerThread) &&
            (wt = (ForkJoinWorkerThread)t).pool == this)
            
            // ForkJoinPool的线程自带一个双端队列
            q = wt.workQueue;
        else {
            task.markPoolSubmission();
            q = submissionQueue(true);
        }
        
        // 把任务放到队列里
        q.push(task, this, signalIfEmpty);
        return task;
    }
```

> `ForkJoinPool`还提供了一个独有的直接提交`ForkJoinTask`的方法：`execute(ForkJoinTask<?> task)`

**对比**：`ThreadPoolExecutor`使用共享队列，所有线程竞争同一个任务源，可能导致锁争用。

**所有线程从同一个`BlockingQueue`里取任务，会导致锁争用，因为所有线程都要竞争同一个锁**（一个独立的互斥锁，但是可以理解为给队列加锁）：
```java
    public E take() throws InterruptedException {
        final ReentrantLock lock = this.lock;
        lock.lockInterruptibly();
        try {
            while (count == 0)
                notEmpty.await();
            return dequeue();
        } finally {
            lock.unlock();
        }
    }
```
**所以`ForkJoinPool`使用双端队列是不是因为通过分治产生的子任务太多了，如果每个任务都要通过竞争去获取，最终性能也好不了？**

### 分治任务模型
`ForkJoinPool`专为递归分解的任务设计，通过`ForkJoinTask`（如`RecursiveTask`和`RecursiveAction`）将大任务拆分为小任务，并在结果需要时合并。  

**对比**：**`ThreadPoolExecutor`适用于独立、无依赖关系的任务，无法自动处理任务分解与合并。**

### 任务粒度控制 
**`ForkJoinPool`鼓励将任务分解为足够小的粒度（阈值），以充分利用多核CPU**；而**`ThreadPoolExecutor`通常处理相对独立且粒度较大的任务**。

# ForkJoinTask
**`ThreadPoolExecutor`处理并返回`FutureTask`，`ForkJoinPool`处理并返回`ForkJoinTask`**。二者也是对应的。

`ForkJoinTask` 是所有分治任务的基类，它继承自 `Future` 接口，表示一个可异步执行的任务。主要有两个抽象子类：
- **`RecursiveTask<V>`**：有返回值的递归任务（需实现 `compute()` 方法）。
- **`RecursiveAction`**：无返回值的递归任务（需实现 `compute()` 方法）。

## 核心方法
- **`fork()`**：将任务放入工作队列，并安排异步执行。
- **`join()`**：等待任务完成并返回结果。
- **`compute()`**：任务的核心逻辑，需由子类实现，定义任务拆分或计算的逻辑。

## 执行流程
`ForkJoinTask` 在 `ForkJoinPool` 中的执行流程图：
```
提交任务到 ForkJoinPool
│
├─ 任务由提交线程直接执行，或分配给工作线程
│
└─ 任务执行 compute() 方法
   │
   ├─ 如果任务足够小：
   │   └─ 直接计算并返回结果
   │
   └─ 如果任务需要拆分：
       │
       ├─ 创建子任务（RecursiveTask/RecursiveAction）
       │
       ├─ 调用 fork() 将子任务放入当前线程队列
       │
       ├─ 调用 join() 获取子任务结果（可能触发工作窃取）
       │
       └─ 合并子任务结果并返回
```

代码示例：
```java
/**
 * @author puppylpg on 2019/11/25
 */
public class ParallelCalculator {

    /**
     * 叠加到100*1亿：
     * sum=-5340232226128654848, time used=6291 ms.
     * 叠加到1000*1亿：
     * sum=932355974711512064, time used=44028 ms.
     * 叠加到10000*1亿：
     * sum=1001881602603448320, time used=611418 ms.
     *
     * （以100为threshold）都不比直接单线程叠加快，估计是fork太多了。
     *
     * 同样叠加到10000*1亿，threshold = 1亿：
     * sum=1001881602603448320, time used=152406 ms.
     *
     * 比threshold=100少用了80%的时间，只占用直接单线程叠加时间的35%不到
     */
    public static void main(String... args) throws ExecutionException, InterruptedException {
        long size = 100000000 * 10000L;

        long start = System.currentTimeMillis();
        ForkJoinPool pool = new ForkJoinPool();
        Future<Long> result = pool.submit(new Calculator(0, size));

        long sum = result.get();
        long end = System.currentTimeMillis();
        System.out.printf("sum=%d, time used=%d ms.", sum, end - start);
    }

    private static class Calculator extends RecursiveTask<Long> {

        private static final long THRESHOLD = 100000000 * 100L;
        private long start;
        private long end;

        Calculator(long start, long end) {
            this.start = start;
            this.end = end;
        }

        @Override
        protected Long compute() {
            long sum = 0;
            if ((end - start) < THRESHOLD) {
                for (long i = start; i < end; i++) {
                    sum += i;
                }
            } else {
                long middle = (start + end) / 2;
                Calculator left = new Calculator(start, middle);
                Calculator right = new Calculator(middle, end);

                // 子任务提交到队列
                left.fork();
                right.fork();

                // 阻塞等待子任务执行完并返回结果
                sum = left.join() + right.join();
            }
            return sum;
        }
    }
}
```
**所以任务的拆分粒度要合适，不能太大也不能太小。太小的话，fork创建任务/提交任务的开销就超过计算开销了。**

# 总结
`ForkJoinPool`不是替代`ThreadPoolExecutor`，而是补充了处理分治任务的能力，通过工作窃取算法和递归分解模型，在特定场景下提供更高的并行效率。如果你需要处理可分解的计算密集型任务，`ForkJoinPool`是更优选择；否则，`ThreadPoolExecutor`或其他线程池实现（如`Executors`工厂方法创建的线程池）更适合常规任务。

- **适合`ForkJoinPool`的场景**：
    - 计算密集型任务（如并行排序、矩阵运算、大数据处理）。
    - 任务可递归分解为子任务（如分治算法）。
    - 需要高效利用多核CPU资源。

- **适合`ThreadPoolExecutor`的场景**：
    - **I/O密集型任务（如网络请求、文件操作）**。
    - **独立任务**（如异步回调、定时任务）。
    - 简单的并行执行需求。

# 感想
所以其实工作中很少能用到`ForkJoinPool`，大多是io任务、独立任务，还是适合用`ThreadPoolExecutor`。

> 但是`ForkJoinPool`的理念还是不错的。
