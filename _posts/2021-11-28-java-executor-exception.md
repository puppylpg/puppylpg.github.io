---
layout: post
title: "线程池异常处理"
date: 2021-11-28 18:24:42 +0800
categories: Java Executor
tags: Java Executor
---

前一段碰到一个很迷惑的问题，大致模型为：
- 一个主线程从mysql加载数据扔到blocking queue（ArrayBlockingQueue，size=1000）；
- 40个工作任务从blocking queue取数据，执行任务。使用死循环让任务循环往复，永不停止；
- 工作任务由线程池ExecutorService执行，线程池的blocking queue用的是LinkedBlockingQueue；

结果：CPU消耗逐渐为0，内存使用逐渐不变。用jstack观察线程状态，主线程和工作线程全都是WAITING状态。主线程卡在blocking queue的put上，线程池的worker卡在blocking queue的get上。

1. Table of Contents, ordered
{:toc}

当时就感觉很纳闷，为什么两类线程，一个放不进去，一个取不出来呢？后来仔细观察才发现get和put针对的不是同一个blocking queue——

主线程是往ArrayBlockingQueue里put，放满了，放不进去了：
```
名称: http-nio-8022-exec-2
状态: java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject@5d2234ff上的WAITING
总阻止数: 3,000, 总等待数: 78,807

堆栈跟踪: 
sun.misc.Unsafe.park(Native Method)
java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:2039)
java.util.concurrent.ArrayBlockingQueue.put(ArrayBlockingQueue.java:353)
```
线程池的worker是从LinkedBlockingQueue取任务，take不出来：
```
名称: stream process kol extractions executor-16
状态: java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject@4464a11a上的WAITING
总阻止数: 623, 总等待数: 48,046

堆栈跟踪: 
sun.misc.Unsafe.park(Native Method)
java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:2039)
java.util.concurrent.LinkedBlockingQueue.take(LinkedBlockingQueue.java:442)
java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1067)
java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1127)
java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:617)
java.lang.Thread.run(Thread.java:745)
```

仔细研究了一下：40个永久性任务，遇到了runtime exception，而我并没有catch住所有exception，所以崩掉了。线程池在任务异常终止时，工作线程并不会凉凉，而是继续从队列里取任务。

下面模拟一下线程池在任务异常终止后的行为。

# 线程池处理异常
线程池两个线程，执行6个任务，每个人物有50%的概率抛出异常，50%的概率正常结束并返回线程id作为结果：
```
    public static void main(String... args) throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(2);

        List<Future<Long>> futures = new ArrayList<>();

        for (int i = 0; i < 6; i++) {
            int finalI = i;
            Future<Long> future = executor.submit(() -> {
                System.out.println(Thread.currentThread().getName() + " : " + Thread.currentThread().getId() + " : " + finalI);
                if (ThreadLocalRandom.current().nextBoolean()) {
                    throw new Exception("what happened");
                }
                return Thread.currentThread().getId();
            });
            futures.add(future);
        }

        for (Future<Long> future : futures) {
            try {
                System.out.println("outcome: " + future.get());
            } catch (ExecutionException e) {
                System.out.println("exception: " + e.getMessage());
            }
        }
    }
```
查看最终六个任务的结果，输出如下：
```
pool-1-thread-1 : 12 : 0
pool-1-thread-2 : 13 : 1
pool-1-thread-1 : 12 : 2
pool-1-thread-2 : 13 : 3
pool-1-thread-1 : 12 : 4
pool-1-thread-2 : 13 : 5
exception: java.lang.Exception: what happened
outcome: 13
outcome: 12
exception: java.lang.Exception: what happened
outcome: 12
exception: java.lang.Exception: what happened
```
可以看到，3个任务抛出异常，另外三个成功返回。而根据结果，可以得出两个结论：
1. **任务抛出异常，线程池的线程并不会终止，而是继续从任务队列取任务执行**；
2. **任务出异常之后，从future取结果，使用get的时候，会抛出一个ExecutionException异常，而这个异常实际包裹的，就是任务执行时的异常**：

# 线程池线程不会因异常终止
首先分析第一个结论，为什么任务出异常线程不会终止。这就要看看谁调用的`Callable#call()`。

`Future`的实现类`FutureTask`调用了`Callable#call`，相关代码片段：
```
            Callable<V> c = callable;
            if (c != null && state == NEW) {
                V result;
                boolean ran;
                try {
                    # 调用call
                    result = c.call();
                    ran = true;
                } catch (Throwable ex) {
                    result = null;
                    ran = false;
                    # 出异常，设置exception
                    setException(ex);
                }
                if (ran)
                    # 没出异常，设置结果
                    set(result);
            }
            
            
            
    protected void setException(Throwable t) {
        if (UNSAFE.compareAndSwapInt(this, stateOffset, NEW, COMPLETING)) {
            outcome = t;
            UNSAFE.putOrderedInt(this, stateOffset, EXCEPTIONAL); // final state
            finishCompletion();
        }
    }
    
    protected void set(V v) {
        if (UNSAFE.compareAndSwapInt(this, stateOffset, NEW, COMPLETING)) {
            outcome = v;
            UNSAFE.putOrderedInt(this, stateOffset, NORMAL); // final state
            finishCompletion();
        }
    }
```
可见：
- 任务如果正常执行，就把结果放到Future的`outcome`变量中；
- 如果任务出了异常，就catch住异常，并把异常放到`outcome`变量中；
- **无论如何，线程池的工作线程依然不停止，继续从任务队列取任务执行**。

**所以线程池的工作线程并不会在遇到exception的时候直接throw出去，而是把它catch住，放到outcome里，视为任务结束了，接着继续执行取任务、执行任务的流程**。这样的话，线程就不会“崩掉”了，而是正常执行。

# 异步任务异常传递
异常放到output里是什么操作？其实有点儿像是future实现时候的一个trick。看从future取结果时候的操作`get()`：
```
    public V get() throws InterruptedException, ExecutionException {
        int s = state;
        if (s <= COMPLETING)
            s = awaitDone(false, 0L);
        return report(s);
    }
    


    private V report(int s) throws ExecutionException {
        Object x = outcome;
        if (s == NORMAL)
            return (V)x;
        if (s >= CANCELLED)
            throw new CancellationException();
        throw new ExecutionException((Throwable)x);
    }
```
取结果时，先判断任务状态：
- 如果是正常结束，就从outcome取结果返回；
- 如果是异常终止，就从outcome取结果，用ExecutionException包装一下，再把异常抛出去；

所以相当于把outcome当做了临时存放异常的地方，在异步取结果的时候，再感知任务异常，而这个异常，就是任务运行时候的异常。**既然任务执行的时候被抛了出来，说明任务本身不想处理这类异常，既然如此，异常就会在异步任务结果获取的时候，被重新拿到**。

所以任务处理异常有以下两种方式：
1. 任务本身catch住异常，处理掉（然后可以返回空之类的）；
2. 任务本身不想处理，由取任务结果的线程处理异常：在get的时候，catch住异常，并处理异常；

而如果想让任务永不停止，需要在while true里catch住所有异常：
```
    /**
     * 启动处理线程
     */
    protected void startWorkers() {
        for (int i = 0; i < executorSize(); i++) {
            String taskName = "infinite loop task " + i;
            getExecutorService().submit(
                () -> {
                    while (true) {
                        // 无限循环任务不能因异常而退出，除非服务要关闭了
                        try {
                            // 处理任务
                            ...
                        } catch (InterruptedException e) {
                            // 这个是给任务的退出做准备的，使用interrupt机制
                            log.info("Thread is interrupted, {} exit.", taskName);
                            break;
                        } catch (Exception e) {
                            // 这里处理所有catch住的异常
                        }
                    }
                }
            );
        }
    }
```
以上算是一个比较标准的处理流程：
1. catch住所有异常，不抛出去；
2. 最好能单独响应InterruptedException，给无限重复任务增加一个退出的机制。参考：[java-interrupt]({% post_url 2020-05-17-java-interrupt %})；


