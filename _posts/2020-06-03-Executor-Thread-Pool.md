[toc]

---
layout: post
title: "Executor - Thread Pool"
date: 2020-06-03 02:38:49 +0800
categories: Java Guava Future Executor
tags: Java Guava Future Executor
---

JDK中任务和任务的执行者是一套设计的比较好的相互解耦的框架。之前在[Java并发编程：并发任务执行及结果获取](https://blog.csdn.net/puppylpg/article/details/80683101)描述过jdk中关于`Executor`的基本逻辑，这次从更加宏观的角度重新全面梳理一下，并补充一点Guava对`Executor`和`Future`的拓展。

1. Table of Contents, ordered
{:toc}

# 任务
## `Runnable`/`Callable` - 简单任务表示
任务由`Callable`/`Runnble`表示。

> `Runnable`在Java 1.0就有了，`Callable`是Java 1.5才有的。

### `Runnable`转`Callable`
`Runnable`和`Callable`相比，缺少返回值。**所以`Runnable`是可以转为`Callable`的，只要返回null就行了。或者说`Runnable`就是返回值为null的`Callable`**。`Runnable`转`Callable`主要是因为有些方法只接受`Callable`不接受`Runnable`，所以把`Runnable`转成`Callable`：

> This can be useful when applying methods requiring a Callable to an otherwise resultless action. 当将需要Callable的方法应用到其他无结果的操作时，这会很有用。

在`Executors`工具类方法里，提供了`Runnable`转`Callable`的方法：
```java
    /**
     * Returns a {@link Callable} object that, when
     * called, runs the given task and returns the given result.  This
     * can be useful when applying methods requiring a
     * {@code Callable} to an otherwise resultless action.
     * @param task the task to run
     * @param result the result to return
     * @param <T> the type of the result
     * @return a callable object
     * @throws NullPointerException if task null
     */
    public static <T> Callable<T> callable(Runnable task, T result) {
        if (task == null)
            throw new NullPointerException();
        return new RunnableAdapter<T>(task, result);
    }
    
    /**
     * Returns a {@link Callable} object that, when
     * called, runs the given task and returns {@code null}.
     * @param task the task to run
     * @return a callable object
     * @throws NullPointerException if task null
     */
    public static Callable<Object> callable(Runnable task) {
        if (task == null)
            throw new NullPointerException();
        return new RunnableAdapter<Object>(task, null);
    }
```
`RunnableAdapter`接收两个参数：`Runnable`和result（泛型T）。这个result必然是null，有一种未卜先知的感觉，还没执行就知道结果了，因为`Runnable`本身就不返回值：
```java
    /**
     * A callable that runs given task and returns given result
     */
    static final class RunnableAdapter<T> implements Callable<T> {
        final Runnable task;
        final T result;
        RunnableAdapter(Runnable task, T result) {
            this.task = task;
            this.result = result;
        }
        public T call() {
            // 你尽管执行
            task.run();
            // 最终一定return null
            return result;
        }
    }
```

## `Future` - 高级任务表示
更高级的方式是用`Future<T>`表示结果。这么做主要是**引入了对任务生命周期的控制**：通过`Future`可以判断任务是否完成`isDone`/`isCancelled`、获取任务结果`get`，或者取消任务`cancel`。

- `boolean isCancelled()`
- `boolean isDone()`
- `boolean cancel(boolean mayInterruptIfRunning)`
- `V get() throws InterruptedException, ExecutionException`
- `V get(long timeout, TimeUnit unit) throws InterruptedException, ExecutionException, TimeoutException`

**所以一般不直接`new Thread(Runnable)#start()`，多是通过线程池提交`Callable`/`Runnble`，然后获取`Future`，再和`Future`打交道。**

## `RunnableFuture` - 真正的任务表示
`Runnable` + `Future`，两个接口的结合。既有任务执行方法，又有任务结果表示，所以**这个类才是实际执行前创建的任务形态**。

`RunnableFuture`的实现类是`FutureTask`，它的模型也比较简单：
1. **内置一个变量outcome**，一个int值state表示当前任务的状态；
2. 线程执行任务的时候，会改变state，如果有结果，会放入outcome；
3. 其他线程要获取结果，就检查state，**如果是已完成，就获取outcome。否则就挂起（以该`FutureTask`对象作为锁，挂起到它的等待队列）**。

# 任务的执行者
## `Executor` - 简单执行者
任务的执行者最简单的抽象是`Executor`。它只提供了`execute`方法，返回值是void。

任务不是`execute`了就立刻执行的，而是会在**将来某个时刻执行**，具体取决于线程池的线程什么时候有空，且抢到了CPU资源。

- `void execute(Runnable command)`

> **线程为什么能执行任务**？
> 
> 线程池之所以能执行任务，是因为里面的线程直接执行了任务的`run()`方法（由这个线程去运行task的那些干活的代码，而非主线程，所以是异步执行的）。

`Executor`接口的缺点是：
1. 对任务的执行没有暴露任何控制接口；
2. 它只能做到执行`Runnable`任务，无法返回任何结果。

## `ExecutorService` - 高级执行者
所以真正有用的接口是`ExecutorService`。正如`Future`对`Callable`/`Runnable`的拓展**给任务加上了状态判断**一样，`ExecutorService`也对`Executor`进行了拓展，**给执行者加上了状态控制和判断方法**。比如关闭executor的`shutdown`，和判断executor是否关闭的`isShutdown`等。

- `boolean isShutdown()`
- `boolean isTerminated()`
- `void shutdown()`
- `List<Runnable> shutdownNow()`

`Executor#execute`提交`Runnable`无返回值，相对应的`ExecutorService`新增了提交`Callable`/`Runnable`的`submit`方法，返回任务的执行结果`Future`。

- `<T> Future<T> submit(Callable<T> task)`
- `Future<?> submit(Runnable task)`：`submit`一个`Runnable`和`execute`一个`Runnable`没啥区别，即使通过`submit`提交，返回值也依然是null，和使用`RunnableAdapter`类似
- `<T> Future<T> submit(Runnable task, T result)`：也不一定非得返回null，也可以返回其他指定的result。但无论是什么result，都属于“未卜先知”了


### 关闭`ExecutorService`
关于关闭`ExecutorService`的方法：
- `shutdown()`：线程池不再接受新任务了，但不是立即关停，也不保证等待已有任务执行完；
- `shutdownNow()`：强关。正在执行的也别执行了。**其实就是调用worker thread的interrupt方法，给worker thread发送中断信号**；
- `awaitTermination(long, TimeUnit)`：**阻塞方法，要么任务执行完，要么超时，要么被interrupt，否则一直阻塞**。

JDK建议关闭一个线程池的方式：
```java
void shutdownAndAwaitTermination(ExecutorService pool) {
    // 告知关闭，先不接收新任务了
    pool.shutdown();
    try {
        // 等待已有任务结束
        if (!pool.awaitTermination(60, TimeUnit.SECONDS)) {
            // 关闭当前执行任务
            pool.shutdownNow();
            // Wait a while for tasks to respond to being cancelled
            if (!pool.awaitTermination(60, TimeUnit.SECONDS)) {
                System.err.println("Pool did not terminate");
            }
        }
    } catch (InterruptedException ie) {
        // (Re-)Cancel if current thread also interrupted
        pool.shutdownNow();
        // Preserve interrupt status
        Thread.currentThread().interrupt();
    }
}
```
1. 先关闭线程池，结束idle线程；
2. 等60s，等待已有任务结束；
    1. 如果60s后还没结束，强行终止在执行的任务（这就要求worker在执行任务的时候，要响应中断）；
    2. 如果在这一过程中，本线程也收到了interrupt信号（“别等60s了”），那就不再坚持60s的等待，直接调用shutdownNow，给worker发送中断信号；

但是用起来还是太麻烦了，**推荐Guava的`MoreExecutors.getExitingExecutorService(ThreadPoolExecutor, long, TimeUnit)`**。它的作用是把`ExecutorService`转换成一个exit executor service（当jvm退出时会自动关闭的线程池）。详情见后面对exiting executor service的介绍。

## `ThreadPoolExecutor` - `ExecutorService`实现者
`Executor`/`ExecutorService`的实现是`ThreadPoolExecutor`，以线程池的形式实现了`ExecutorService`。

`ThreadPoolExecutor`是一个典型的生产者消费者模型：
1. 用户提交任务进入线程池，实际是加入了`BlockingQueue`；
2. 线程池的线程从`BlockingQueue`取任务，执行；

详情可以参考[`ThreadPoolExecutor`](https://www.baeldung.com/thread-pool-java-and-guava)。

> 所以生产者消费者模型，也可以用现成的`ThreadPoolExecutor`去实现啊！

创建`ThreadPoolExecutor时`的几个必要参数：
- `int corePoolSize`：线程池线程不足corePoolSize时，如果有任务到来，就通过创建新的线程来处理；
- `BlockingQueue<Runnable> workQueue`：存放任务的队列，**当线程池线程数达到core pool size时**，新的任务会放到queue里，由消费者（worker）取出并执行。实际上就是生产者-消费者模式中的缓冲区；
- `int maximumPoolSize`：**当queue满了之后，再添加新任务会导致继续创建非core线程**，最多创建到maximumPoolSize个线程；
- `long keepAliveTime, TimeUnit unit`：超出corePoolSize数的线程的最大闲置时间，超过就终止该线程；
- `ThreadFactory threadFactory`：创建子线程的factory，设置了factory就可以自定义线程，比如线程名称、daemon；
- `RejectedExecutionHandler handler`：如果`BlockingQueue`放不下，应该怎么办；

所以`ThreadPoolExecutor`通过里面的`BlockingQueue`，实现了生产者消费者模式：
- 通过`execute`/`submit`方法，提交`Runnable`/`Callable`到`BlockingQueue`；
- 任务提交后，使用内部的`Worker`从`BlockingQueue`获取并执行任务；

### `Worker`
`ThreadPoolExecutor`的内部类。**线程池`ThreadPoolExecutor`里的工作线程持有者，内部持有`Thread`对象（由`ThreadPoolExecutor`的`ThreadFactory`创建，所以创建线程和使用线程也解耦了）**。线程池的大小其实就是`Worker`的多少。实际以`HashSet<Worker> workers`的形式存在。

> 所以线程池大小getPoolSize()实际就是返回workers.size()，当然要加锁获取其size，毕竟并发，数量不定。

当执行execute方法时，实际就是调用`Worker#run`方法：
- 如果是首次创建的`Worker`（因为没到达corePoolSize），创建时任务已经以`firstTask`传入`Worker`，直接执行`firstTask`；
- 如果是已有的`Worker`，从`BlockingQueue`里取一个任务，执行；

具体参考[ThreadPoolExecutor#Worker]({% post_url 2024-05-20-threadpoolexecutor-worker %})。

## `BlockingQueue`
生产者消费者同步资源（这里是待执行任务）的队列。

具体参考[生产者 - 消费者]({% post_url 2020-05-17-producer-consumer %})。

### `SynchronousQueue` - 长度为0的阻塞队列
如果`BlockingQueue`使用大小为0的队列，会出现什么情况？对于上述线程池，如果设置size=0，会出错，因为`ArrayBlockingQueue`不允许大小<=0，最小得是1。

如果大小为1，那么在任一任务执行完之前，最多提交n+1个任务（n1个core线程+queue里放一个+n2个非core线程）。之后提交的任务会根据`RejectedExecutionHandler`的行为处理。

**`SynchronousQueue`则能够保证任务提交者和任务执行者（或者说生产者和消费者）做手递手传递：即只在有人接手任务的情况下，任务的提交才能成功，否则就只能等着（同样只有有人在等着提交任务，任务的获取才能成功，否则也只能等着）。**

所以如果使用`SynchronousQueue`，**相当于在使用size=0的queue**。

`SynchronousQueue`常用来处理一些 **两个（或多个）线程之间通过状态位进行协同阻塞唤醒** 的场景。比如一个线程执行到一种状态后，另外一个线程才能开始执行。可以使用`CountDownLatch`，也可以使用`SynchronousQueue`，会更简单。
- https://www.baeldung.com/java-synchronous-queue

### ~~用于生产者消费者模型~~
生产者消费者模型中，二者通过`BlockingQueue`协同。而`ThreadPoolExecutor`中本身就带有一个`BlockingQueue`。所以如果我们直接定义一个`CallerBlocksPolicy`，同时把线程池的`RejectedExecutionHandler`设置为`CallerBlocksPolicy`，是不是就可以直接用线程池替代生产者消费者模型中的“BlockingQueue+消费者”这两部分了？
```java
        RejectedExecutionHandler callerBlocksPolicy = (r, executor) -> {
            try {
                // 不建议直接操作这个内部queue：Access to the task queue is intended primarily for debugging and monitoring.
                executor.getQueue().put(r);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        };
```
**理论上是的，但是不建议这么做！`ThreadPoolExecutor`的确提供了`getQueue()`方法来获取线程池内部的queue，但是它是一个内部queue，不应该被这么使用。而且该接口的doc也说了，仅应该用作debug或监控**：
> Access to the task queue is intended primarily for debugging and monitoring.

## `ThreadFactory`
`ThreadFactory`接口，只有一个`newThread(Runnable)`方法用于创建`Thread`，**并执行任务（别忘了`Runnable`参数）**，可以使得创建线程和使用线程解耦。

1. `DefaultThreadFactory`：`Executors`工具类里有内部类`DefaultThreadFactory`。可通过`Executors.defaultThreadFactory()`创建一个`DefaultThreadFactory`。它给创建的线程设置了name和group，**以非daemon的形式存在**，优先级为`Thread.NORM_PRIORITY`。
    > `Executors`里还有一个`PrivilegedThreadFactory`继承自`DefaultThreadFactory`，不过暂时应该还用不上。
2. `BasicThreadFactory`：JDK里的`DefaultThreadFactory`不能配置线程优先级、daemon等，apache commons提供了`BasicThreadFactory`，可以手动配置这些。

一般创建周期性任务的时候都用`BasicThreadFactory`，创建的线程就可以全设为daemon了。

```java
        ExecutorService executor = new ThreadPoolExecutor(
                2,
                4,
                20L,
                TimeUnit.MILLISECONDS,
                new LinkedBlockingDeque<>(),
                new ThreadFactoryBuilder().setNameFormat("sub process" + "-%d").setDaemon(true).build()
        );
```

## `RejectedExecutionHandler`
当core线程满了，放置任务的`BlockingQueue`也满了，非core线程也满了，那当前要提交的任务应该何去何从？

`RejectedExecutionHandler`就是对这一行为的定义。该接口比较简单，就一个方法：
- `void rejectedExecution(Runnable r, ThreadPoolExecutor executor)`

该方法在`ThreadPoolExecutor`无法提交任务时调用，r代表要提交的方法，executor是大年线程池。

- `AbortPolicy`：默认使用`AbortPolicy`，即提交不了直接`throw new RejectedExecutionException`。这就是`CompletionService#submit`会抛`RejectedExecutionException`的原因；
    ```java
            public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
                throw new RejectedExecutionException("Task " + r.toString() +
                                                     " rejected from " +
                                                     e.toString());
            }
    ```

- `DiscardPolicy`：提交不了拉倒，啥也不做。啥也不做其实就是扔了。但这个一定要注意，**不要获取它的`Future`**。因为任务已经扔了，不会再被执行了，提交时创建的`Future`的任务执行状态永远不会被改变，所以想要获取其值无异于等待戈多——永远也不可能等到；
    ```java
            public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
            }
    ```

- `DiscardOldestPolicy`：提交不了，就把队头的拉出来扔了，把新的任务放进去；
    ```java
            public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
                if (!e.isShutdown()) {
                    // 把队头的任务取出来，直接扔了
                    e.getQueue().poll();
                    // 再次尝试提交新任务
                    e.execute(r);
                }
            }
    ```

- `CallerRunsPolicy`：提交任务的线程自己跑。其实就是提交任务的当前线程直接调用`Runnable#run`。**但这样可能会带来性能问题，因为会妨碍当前线程提交任务**。类似于领导自己亲自干活，等到小弟闲下来了，却发现没有领导给他们安排活了，导致工作线程空闲下来。
    ```java
            public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
                if (!e.isShutdown()) {
                    r.run();
                }
            }
    ```

- ~~自定义一个`CallerBlocksPolicy`：如果提交任务的线程发现交不了了，就卡着（线程挂起），直到队列有了新的位置，可以提交进去位置~~。
    ```java
            RejectedExecutionHandler callerBlocksPolicy = (r, executor) -> {
                // 不建议直接操作这个内部queue：Access to the task queue is intended primarily for debugging and monitoring.
                executor.getQueue().put(r);
            };
    ```

[`CallerBlocksPolicy`](https://stackoverflow.com/a/10353250/7676237)这种自定义的方式不是很合适，不过可以在这里列出来用作头脑风暴，以加深对线程池额理解。目前可能用到的场景就是大量数据从数据库读取时，如果直接读全部会OOM。所以采用流式读取。读数据的线程发现worker线程满负载运转，且`BlockingQueue`队列堆满时，就直接卡住，不再继续从数据库流式加载数据了。

**不推荐这种策略的主要原因是`ExecutorService`里的`BlockingQueue`本质上是由线程池管理的。如果手动操作这个`BlockingQueue`，[会影响线程池的状态](https://stackoverflow.com/a/3518588/7676237)**。

而且，**`ExecutorService`接口本身没有`getQueue()`方法，该方法是`ThreadPoolExecutor`独有的。说明接口没想暴露queue给使用者**。同时，该方法的javadoc也做了如下说明：
> Returns the task queue used by this executor. **Access to the task queue is intended primarily for debugging and monitoring**. This queue may be in active use. Retrieving the task queue does not prevent queued tasks from executing.

## `ScheduledExecutorService` - 定时、周期执行者
拓展了`ExecutorService`接口，加上了：
- 定时、只执行一次方法：`schedule`；
- 周期执行方法：`scheduleAtFixedRate和scheduleWithFixedDelay`；

`ScheduledThreadPoolExecutor`是其实现，和它的接口拓展了`ExecutorService`一样，它拓展了`ThreadPoolExecutor`。

# `Executors`工具类
在`Executors`工具类中，提供了多种简单创建线程池（`ThreadPoolExecutor`和`ScheduledThreadPoolExecutor`）的方法，但是[不建议使用`Executors`创建thread pool](https://www.baeldung.com/java-executors-cached-fixed-threadpool)。

此外还提供了：
- `RunnableAdapter`：`Runnable`转`Callable`用；
- `DefaultThreadFactory`：创建线程用。

## `newCachedThreadPool`
`BlockingQueue`使用的是`SynchronousQueue`，这个队列只在有消费者消费时才能put。所以这其实是个0大小的队列，**实际上就是让生产者和消费者手递手（hand-off）交付任务。**

**所以它的名字叫`CachedThread`，其实它相当于cache了一堆thread，当有任务出现时，直接把已有的cache好的thread拿来用。**

同时**它的thread数没设上限**，如果线程不够就会一直创建线程。**短时间内如果有大量任务，且执行时间不定**，不要用这个（否则会创建巨多线程）。

关于`SynchronousQueue`和`LinkedBlockingQueue(1)`的区别：
- https://stackoverflow.com/questions/8591610/when-should-i-use-synchronousqueue

## `newFixedThreadPool`
固定线程数的线程池。但是**它使用的是一个无限大小的`LinkedBlockingQueue`**，可能会消耗大量内存资源，**甚至会导致oom**。而且，对于大多数场景无限排队没什么意义，client超时就不等待了，server把任务排下来也没什么意义。还有一个缺点是线程数固定，没什么弹性。

所以建议自己创建一个有线程限制、有排队大小限制、有弹性的`ThreadPoolExecutor`：
```java
new ThreadPoolExecutor(10, 20, 60, SECONDS, new ArrayBlockingQueue<Runnable>(1000), new AbortPolicy());
```

## `newWorkStealingPool`
@since 1.8

# `MoreExecutors` - Guava
Guava也提供了一些方便的`Executor`/`ExecutorService`，但是都只能通过`MoreExecutors`这个工具类创建实例。

## `DirectExecutor`
使用本线程执行任务的`Executor`。实现起来很简单——不通过`Thread` start任务，直接调用run即可：
```java
  @Override
  public void execute(Runnable command) {
    command.run();
  }
```
毕竟这也是一种特殊的`Executor`。

值得注意的是，这是我第一次见到一个enum类实现接口：
```java
/**
 * An {@link Executor} that runs each task in the thread that invokes {@link Executor#execute
 * execute}.
 */
@GwtCompatible
enum DirectExecutor implements Executor {
  INSTANCE;

  @Override
  public void execute(Runnable command) {
    command.run();
  }

  @Override
  public String toString() {
    return "MoreExecutors.directExecutor()";
  }
}
```
需要用的时候，直接获取该实例即可：
```java
  public static Executor directExecutor() {
    return DirectExecutor.INSTANCE;
  }
```
**如果有什么工具类，又不想全static，也不想new一个全局唯一的工具类实例，使用enum这种真的很方便啊！**

## exiting executor service
非daemon线程是会阻止JVM退出的。所以在创建执行不重要任务的线程池的时候，应该给它设置一个创建daemon线程的`ThreadFactory`，所有创建出来的线程都是daemon。

Guava提供的`MoreExecutors.getExitingExecutorService()`可以帮助**把一个会阻挠JVM退出的刁民`ExecutorService`转成良民，把`ExecutorService`转换成一个exit executor service（当jvm退出时会自动关闭的线程池）**，这样我们也不需要操心线程池的关闭问题了。

具体实现就是：
1. 修改`ExecutorService`的`ThreadFactory`设置，线程属性全都设置为daemon（jdk默认的`Executors.defaultThreadFactory()`创建的线程都不是daemon）。这一步很关键，如果没有显式调用exit，在有非daemon线程的情况下，jvm不会退出；
2. 给jvm添加一个shutdown hook：分别调用`service.shutdown()`和`service.awaitTermination(terminationTimeout, timeUnit)`关闭这个线程池。即在jvm退出时，关闭该`ExecutorService`；
    ```java
        final void addDelayedShutdownHook(
            final ExecutorService service, final long terminationTimeout, final TimeUnit timeUnit) {
          checkNotNull(service);
          checkNotNull(timeUnit);
          addShutdownHook(
              MoreExecutors.newThread(
                  "DelayedShutdownHook-for-" + service,
                  new Runnable() {
                    @Override
                    public void run() {
                      try {
                        // We'd like to log progress and failures that may arise in the
                        // following code, but unfortunately the behavior of logging
                        // is undefined in shutdown hooks.
                        // This is because the logging code installs a shutdown hook of its
                        // own. See Cleaner class inside {@link LogManager}.
                        service.shutdown();
                        service.awaitTermination(terminationTimeout, timeUnit);
                      } catch (InterruptedException ignored) {
                        // We're shutting down anyway, so just ignore.
                      }
                    }
                  }));
        }
        
        void addShutdownHook(Thread hook) {
          Runtime.getRuntime().addShutdownHook(hook);
        }
    ```

这样我们只需要操心创建线程池就行了，不需要操心关闭线程池。

### shutdown hook
**所谓[shutdown hook](https://www.baeldung.com/jvm-shutdown-hooks)，就是一个thread。当jvm退出时，会执行该thread**。shutdown hook的设计就是为了在关闭前释放资源，很符合线程池关闭的场景。

用jshell来演示一下shutdown hook：在退出（Ctrl + D或者`System.exit()`）的时候，会调用shutdown hook：
```bash
~> jshell
|  Welcome to JShell -- Version 17.0.9
|  For an introduction type: /help intro

jshell> Thread printingHook = new Thread(() -> System.out.println("In the middle of a shutdown"));
   ...> Runtime.getRuntime().addShutdownHook(printingHook);
printingHook ==> Thread[Thread-0,5,main]

jshell> （使用Ctrl + D）
In the middle of a shutdown
~>  
```

不过shutdown hook仅限于正常退出的场景：
- The last non-daemon thread terminates. For example, when the main thread exits, the JVM starts its shutdown process
- Sending an interrupt signal from the OS. For instance, by pressing Ctrl + C or logging off the OS
- Calling System.exit() from Java code

如果进程被突然kill了（kill -9），或者os崩了，jvm是没有机会调用shutdown hook的。

## `ListenableFuture`
[`ListenableFuture`]({% post_url 2020-06-03-ListenableFuture %})

- https://www.baeldung.com/thread-pool-java-and-guava

# 感想
写四年了都……
