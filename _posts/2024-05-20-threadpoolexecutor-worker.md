[toc]

---
layout: post
title: "ThreadPoolExecutor - Worker"
date: 2024-05-20 01:00:05 +0800
categories: Java Executor
tags: Java Executor
---

之前通过[Executor - Thread Pool]({% post_url 2020-06-03-Executor-Thread-Pool %})介绍了`ThreadPoolExecutor`，这次详细介绍一下`ThreadPoolExecutor#Worker`。

1. Table of Contents, ordered
{:toc}

# `ThreadPoolExecutor`

线程池线程创建的流程：
1. 任务提交，如果worker不到core pool size，增加worker。如果是首次创建的`Worker`（因为没到达corePoolSize），创建时任务已经以`firstTask`传入`Worker`，直接执行`firstTask`，而不是从queue里取任务
2. 如果线程数够corePoolSize了，新任务放到队列`BlockingQueue`里
3. 如果queue放不下，考虑继续增加worker到max pool size
4. 如果已经到max pool size，没法增加worker了，调用reject策略，决定task的命运

所以它是生产者消费者模型。

> 至于怎么记住是先放进队列再增加到max pool size？可以理解为不到万不得已，不继续增加线程。所以如果是个无界队列，就永远不会创建超过core pool size的线程。而且之前犯过这个错误，确实用过无界队列，导致线程数一直是core pool size，没增长。

这些逻辑通过`submit`（调用`execute`）的实现可以很清楚地看出来：
```java
    public void execute(Runnable command) {
        if (command == null)
            throw new NullPointerException();
        /*
         * Proceed in 3 steps:
         *
         * 1. If fewer than corePoolSize threads are running, try to
         * start a new thread with the given command as its first
         * task.  The call to addWorker atomically checks runState and
         * workerCount, and so prevents false alarms that would add
         * threads when it shouldn't, by returning false.
         *
         * 2. If a task can be successfully queued, then we still need
         * to double-check whether we should have added a thread
         * (because existing ones died since last checking) or that
         * the pool shut down since entry into this method. So we
         * recheck state and if necessary roll back the enqueuing if
         * stopped, or start a new thread if there are none.
         *
         * 3. If we cannot queue task, then we try to add a new
         * thread.  If it fails, we know we are shut down or saturated
         * and so reject the task.
         */
        int c = ctl.get();
        if (workerCountOf(c) < corePoolSize) {
            if (addWorker(command, true))
                return;
            c = ctl.get();
        }
        if (isRunning(c) && workQueue.offer(command)) {
            int recheck = ctl.get();
            if (! isRunning(recheck) && remove(command))
                reject(command);
            else if (workerCountOf(recheck) == 0)
                addWorker(null, false);
        }
        else if (!addWorker(command, false))
            reject(command);
    }
```
分别对应：
1. `if (workerCountOf(c) < corePoolSize)`，`addWorker(command, true)`，add worker时候的参数true指的是core worker。**`addWorker`方法会创建一个worker（会创建一个thread），然后启动这个thread，执行worker的run方法，run方法其实就是从`BlockingQueue`里取一个任务，然后执行**。具体的调用链路见下文对worker的介绍；
2. `workQueue.offer(command)`，注意放到队列用的是offer，而不是put，因为放不进去的时候不需要阻塞；
3. `else if (!addWorker(command, false))`，放不进queue就尝试继续增加worker，这里参数里的false指的是非core worker；
4. `reject(command)`，如果worker也没法增加，调用reject策略；

## `BlockingQueue`的`add`/`offer`/`put`
如果放任务的时候，`BlockingQueue`用的不是put而是offer，那么挂起的worker是怎么被唤醒的？**其实是我理解错了。我之前一直以为只有put是会唤醒的，offer不会，实际上都会，他们的区别仅在于放不进去的时候会不会阻塞，其他地方是没区别的**。

看`BlockingQueue`里offer和put的实现，会发现区别在于是`return false`还是`Condition#await`，其他都一样，都是用`enqueue`方法入队的：
```java
    /**
     * Inserts the specified element at the tail of this queue if it is
     * possible to do so immediately without exceeding the queue's capacity,
     * returning {@code true} upon success and {@code false} if this queue
     * is full.  This method is generally preferable to method {@link #add},
     * which can fail to insert an element only by throwing an exception.
     *
     * @throws NullPointerException if the specified element is null
     */
    public boolean offer(E e) {
        Objects.requireNonNull(e);
        final ReentrantLock lock = this.lock;
        lock.lock();
        try {
            if (count == items.length)
                return false;
            else {
                enqueue(e);
                return true;
            }
        } finally {
            lock.unlock();
        }
    }
    
    

    /**
     * Inserts the specified element at the tail of this queue, waiting
     * for space to become available if the queue is full.
     *
     * @throws InterruptedException {@inheritDoc}
     * @throws NullPointerException {@inheritDoc}
     */
    public void put(E e) throws InterruptedException {
        Objects.requireNonNull(e);
        final ReentrantLock lock = this.lock;
        lock.lockInterruptibly();
        try {
            while (count == items.length)
                notFull.await();
            enqueue(e);
        } finally {
            lock.unlock();
        }
    }
```
`enqueue`方法会唤醒挂起的消费者：
```java
    /**
     * Inserts element at current put position, advances, and signals.
     * Call only when holding lock.
     */
    private void enqueue(E e) {
        // assert lock.isHeldByCurrentThread();
        // assert lock.getHoldCount() == 1;
        // assert items[putIndex] == null;
        final Object[] items = this.items;
        items[putIndex] = e;
        if (++putIndex == items.length) putIndex = 0;
        count++;
        notEmpty.signal();
    }
```
所以`add`/`offer`/`put`，区别不大，仅在于最终是抛异常还是返回false还是阻塞。

# worker是什么
是基于aqs的实现类，同时实现了`Runnable`方法。

## 关联线程
**worker肯定是一个单独的thread，用来异步执行任务**。它是怎么和thread关联的？worker里封装了一个Thread：
```java
        /**
         * Creates with given first task and thread from ThreadFactory.
         * @param firstTask the first task (null if none)
         */
        Worker(Runnable firstTask) {
            setState(-1); // inhibit interrupts until runWorker
            this.firstTask = firstTask;
            this.thread = getThreadFactory().newThread(this);
        }
```
thread是由`ThreadFactory`创建的，thread factory就一个接口，负责**创建一个接口并执行runnable任务**：
```java
public interface ThreadFactory {

    /**
     * Constructs a new unstarted {@code Thread} to run the given runnable.
     *
     * @param r a runnable to be executed by new thread instance
     * @return constructed thread, or {@code null} if the request to
     *         create a thread is rejected
     *
     * @see <a href="../../lang/Thread.html#inheritance">Inheritance when
     * creating threads</a>
     */
    Thread newThread(Runnable r);
}
```
最简单的thread factory可以这么实现：
```java
class SimplestThreadFactory implements ThreadFactory {

    @Override
    public Thread newThread(Runnable r) {
        return new Thread(r);
    }
}
```
`ThreadPoolExecutor`里默认的`ThreadFactory`是`Executors.defaultThreadFactory()`，它其实跟上面实现的最简单的factory差不多：
```java
    /**
     * The default thread factory.
     */
    private static class DefaultThreadFactory implements ThreadFactory {
        private static final AtomicInteger poolNumber = new AtomicInteger(1);
        private final ThreadGroup group;
        private final AtomicInteger threadNumber = new AtomicInteger(1);
        private final String namePrefix;

        DefaultThreadFactory() {
            @SuppressWarnings("removal")
            SecurityManager s = System.getSecurityManager();
            group = (s != null) ? s.getThreadGroup() :
                                  Thread.currentThread().getThreadGroup();
            namePrefix = "pool-" +
                          poolNumber.getAndIncrement() +
                         "-thread-";
        }

        public Thread newThread(Runnable r) {
            Thread t = new Thread(group, r,
                                  namePrefix + threadNumber.getAndIncrement(),
                                  0);
            if (t.isDaemon())
                t.setDaemon(false);
            if (t.getPriority() != Thread.NORM_PRIORITY)
                t.setPriority(Thread.NORM_PRIORITY);
            return t;
        }
    }
```
**它以`pool-x-thread-y`这个经典的jdk里线程的命名方式给thread命名**，并设置thread为非daemon。

## worker执行方式
在`addWorker`之后，start了这个thread，但是没有start worker，所以worker的run方法是怎么启动的呢？看thread的创建方式：`ThreadFactory`在创建线程的时候，就把`Runnable`传给了新创建的thread，所以线程已经持有了这个`Runnable`。当`Thread#start`的时候，就执行了这个`Runnable`。仔细看worker创建thread时候的代码`this.thread = getThreadFactory().newThread(this)`，**worker把自己作为`Runnable`传给了这个新的thread。所以执行thread的时候，就是在执行worker**。具体流程：
1. `addWorker`
2. start `thread` in `Worker`
3. `thread` run `Worker#run`（具体见下文对worker的介绍）
4. `Worker#run` == `runWorker`
5. get task from `BlockingQueue` and `task.run`

thread启动了之后一直存在，并从`BlockingQueue`里取任务并执行。执行的时候其实就是直接调用了任务的run方法。由于它已经是一个额外的线程了，所以它执行任务只需要直接调用`Runnable#run`就行了。

再来看对应的实现——它自己是`Runnable`，它的`run`方法调用了`runWorker`：
```java
    final void runWorker(Worker w) {
        Thread wt = Thread.currentThread();
        Runnable task = w.firstTask;
        w.firstTask = null;
        w.unlock(); // allow interrupts
        boolean completedAbruptly = true;
        try {
            while (task != null || (task = getTask()) != null) {
                w.lock();
                // If pool is stopping, ensure thread is interrupted;
                // if not, ensure thread is not interrupted.  This
                // requires a recheck in second case to deal with
                // shutdownNow race while clearing interrupt
                if ((runStateAtLeast(ctl.get(), STOP) ||
                     (Thread.interrupted() &&
                      runStateAtLeast(ctl.get(), STOP))) &&
                    !wt.isInterrupted())
                    wt.interrupt();
                try {
                    beforeExecute(wt, task);
                    try {
                        task.run();
                        afterExecute(task, null);
                    } catch (Throwable ex) {
                        afterExecute(task, ex);
                        throw ex;
                    }
                } finally {
                    task = null;
                    w.completedTasks++;
                    w.unlock();
                }
            }
            completedAbruptly = false;
        } finally {
            processWorkerExit(w, completedAbruptly);
        }
    }
```
1. `getTask`方法就是`Runnable r = timed ? workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) : workQueue.take()`，取任务用了take，没任务会挂起；
2. `task.run()`，取到任务之后，直接调用任务的run方法执行；

## worker和aqs
那么worker和aqs有什么关系呢？worker是一个基于aqs实现的互斥锁，所以实现了`tryAcquire`/`tryRelease`。state有两种状态，为0代表未锁定，为1代表已占用。

`runWorker`的时候，从`BlockingQueue`取到task之后，要执行任务，执行前后要先`Worker#lock`和`Worker#unlock`：
```java
        public void lock()        { acquire(1); }
        public void unlock()      { release(1); }
```
所以这里worker基于aqs实现的作用就是：**确保任务的执行流程是互斥的，不存在一个worker同时执行两个任务的情况**。

## 响应中断
`ExecutorService#shutdownNow()`会强行关闭线程池，抛弃那些还未执行的任务。**其实就是调用worker thread的interrupt方法，给worker thread发送中断信号**。这就要求worker在执行任务的时候，要响应中断。

`runWorker`是一个不断从`BlockingQueue`取任务的循环，退出方式就是在任务执行前校验是否收到interrupt中断，如果收到就退出。这一行为就是对interrupt的响应。

# 感想
`ThreadPoolExecutor`就此翻篇~
