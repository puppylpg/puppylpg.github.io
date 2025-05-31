---

layout: post  
title: "线程执行服务：ExecutorService"  
date: 2025-05-31 14:50:41 +0800  
categories: Java Executor  
tags: Java Executor

---

有了线程执行器`Executor`，为什么还要有`ExecutorService`？
**因为executor作为任务执行者最简单的抽象，实在是太简单了，以至于功能有限，无法控制任务的执行，感知任务的状态**。它只提供了`execute`方法，返回值是void，对任务的执行没有暴露任何控制接口。、

1. Table of Contents, ordered
{:toc}

# 任务
先看一下任务的表示方式：

## `Runnable`/`Callable` - 简单任务表示
任务由`Callable`/`Runnble`表示。`Runnable`和`Callable`相比，缺少返回值。

> `Runnable`在Java 1.0就有了，`Callable`是Java 1.5才有的。

## `Future` - 高级任务表示
更高级的方式是用`Future<T>`表示结果。

JDK里的Future在[ListenableFutureExplained](https://github.com/google/guava/wiki/ListenableFutureExplained)里有一段非常好的介绍：

> A traditional Future represents the result of an asynchronous computation: a computation that may or may not have finished producing a result yet. A Future can be a handle to an in-progress computation, a promise from a service to supply us with a result.
>

Future是一个约定：一个放置任务结果的地方。在任务结束后，任务的执行结果会放在Future里。
一个runnable/callable在提交给ExecutorService之后，会生成一个Future。这一流程本质上就是：

1. 创建一个stub，也就是Future这个符号引用所指向的东西；
2. 无论成功或失败，都把结果/exception放到这个stub里；
3. 然后唤醒等待这个结果的线程（**也就是因为调用`Future#get`而被挂起的线程**）；

有了Future，就可以**引入对任务生命周期的控制**：通过`Future`可以判断任务是否完成`isDone`/`isCancelled`、获取任务结果`get`，或者取消任务`cancel`。

- `boolean isCancelled()`
- `boolean isDone()`
- `boolean cancel(boolean mayInterruptIfRunning)`
- `V get() throws InterruptedException, ExecutionException`
- `V get(long timeout, TimeUnit unit) throws InterruptedException, ExecutionException, TimeoutException`

所以一般不直接`new Thread(Runnable).start()`，多是通过线程池提交`Callable`/`Runnable`，然后获取`Future`，再和`Future`打交道。

### `RunnableFuture` - future的实现
future必然是和一个任务关联的。所以在`Future`的实现类`FutureTask`中，必然有一个`Callable`/`Runnable`的变量。jdk创建了一个新接口`RunnableFuture`， = `Runnable` + `Future`。既有任务执行方法，又有任务结果表示，用来实现future。

`RunnableFuture`的实现类是`FutureTask`，它的实现跟上面说的类似：
1. **内置一个变量outcome**，一个int值state表示当前任务的状态；
2. 线程执行任务的时候，会改变state，如果有结果，会放入outcome；
3. 其他线程要获取结果，就检查state，**如果是已完成，就获取outcome。否则就挂起（以该`FutureTask`对象作为锁，挂起到它的等待队列）**。

### `get`
`FutureTask#get`的实现，就是判断任务状态，然后返回结果/exception。如果任务还没结束，就挂起线程，等待任务结束。

**这里挂起的是当前尝试取任务结果的线程，挂起到的地方是future对象自身的等待队列。**

有wait就有notify，**`FutureTask`在任务结束的时候，会调用`finishCompletion`方法，唤醒等待队列里的线程。**

# `ExecutorService` - 任务的高级执行者
`ExecutorService`相比`Executor`，核心是增加了`submit`方法：提交一个`Callable`/`Runnable`，返回任务的`Future`。
- `<T> Future<T> submit(Callable<T> task)`
- `Future<?> submit(Runnable task)`：`submit`一个`Runnable`和`execute`一个`Runnable`没啥区别，即使通过`submit`提交，返回值也依然是null
- `<T> Future<T> submit(Runnable task, T result)`：也不一定非得返回null，也可以返回其他指定的result。但无论是什么result，都属于“未卜先知”了

正如`Future`对`Callable`/`Runnable`的拓展**给任务加上了状态判断**一样，`ExecutorService`也对`Executor`进行了拓展，**给执行者加上了状态控制和判断方法**。比如关闭executor的`shutdown`，和判断executor是否关闭的`isShutdown`等。

- `boolean isShutdown()`
- `boolean isTerminated()`
- `void shutdown()`
- `List<Runnable> shutdownNow()`

`ExecutorService`最常见的实现者是`ThreadPoolExecutor`。

## submit实现
**`ExecutorService`的`submit`方法，其实是委托给`execute`方法来实现的**。毕竟线程池的逻辑已经够复杂了，`execute`已经实现一遍了，直接复用就行了。

`submit`方法，会把`Callable`/`Runnable`封装成`RunnableFuture`（任务+future），然后调用`execute`方法执行任务：
```java
    /**
     * @throws RejectedExecutionException {@inheritDoc}
     * @throws NullPointerException       {@inheritDoc}
     */
    public <T> Future<T> submit(Callable<T> task) {
        if (task == null) throw new NullPointerException();
        RunnableFuture<T> ftask = newTaskFor(task);
        execute(ftask);
        return ftask;
    }
```
所以execute方法才需要关注任务的执行，submit方法的关注点只在于把任务封装为future。封装过程也很简单：只需要记录下原始任务callable
```java
    /**
     * Returns a {@code RunnableFuture} for the given callable task.
     *
     * @param callable the callable task being wrapped
     * @param <T> the type of the callable's result
     * @return a {@code RunnableFuture} which, when run, will call the
     * underlying callable and which, as a {@code Future}, will yield
     * the callable's result as its result and provide for
     * cancellation of the underlying task
     * @since 1.6
     */
    protected <T> RunnableFuture<T> newTaskFor(Callable<T> callable) {
        return new FutureTask<T>(callable);
    }
    
    /**
     * Creates a {@code FutureTask} that will, upon running, execute the
     * given {@code Callable}.
     *
     * @param  callable the callable task
     * @throws NullPointerException if the callable is null
     */
    public FutureTask(Callable<V> callable) {
        if (callable == null)
            throw new NullPointerException();
        this.callable = callable;
        this.state = NEW;       // ensure visibility of callable
    }
```
**然后考虑在原始callable任务执行的过程中，怎么同步更新future的状态**。这就是`FutureTask#run`所做的事情：
```java
    public void run() {
        if (state != NEW ||
            !RUNNER.compareAndSet(this, null, Thread.currentThread()))
            return;
        try {
            Callable<V> c = callable;
            if (c != null && state == NEW) {
                V result;
                boolean ran;
                try {
                    result = c.call();
                    ran = true;
                } catch (Throwable ex) {
                    result = null;
                    ran = false;
                    setException(ex);
                }
                if (ran)
                    set(result);
            }
        } finally {
            // runner must be non-null until state is settled to
            // prevent concurrent calls to run()
            runner = null;
            // state must be re-read after nulling runner to prevent
            // leaked interrupts
            int s = state;
            if (s >= INTERRUPTING)
                handlePossibleCancellationInterrupt(s);
        }
    }
```
判断任务的执行状态，成功了就设置结果到outcome（`set(result)`），失败了就设置异常到outcome（`setException(ex)`）。同时设置future的执行状态。

> **很好的分离关注点的例子：`Executor#execute`关注的是如何池化线程并执行任务；`ExecutorService#submit`关注的是如何封装任务，同步future状态。**

# `ThreadPoolExecutor`的其他组件
介绍了`ThreadPoolExecutor`的两块核心思路execute和submit，再来看看它关联到的其他的一些组件。

## `BlockingQueue`
生产者消费者同步资源（这里是待执行任务）的队列。

具体参考[生产者 - 消费者]({% post_url 2020-05-17-producer-consumer %})。

### `SynchronousQueue` - 长度为0的阻塞队列
如果`BlockingQueue`使用大小为0的`ArrayBlockingQueue`作为任务提交队列，会出现什么情况？会出错，因为`ArrayBlockingQueue`不允许大小<=0，最小得是1。

如果大小为1，那么在任一任务执行完之前，最多提交n+1个任务（n1个core线程+queue里放一个+n2个非core线程）。之后提交的任务会根据`RejectedExecutionHandler`的行为处理。

**`SynchronousQueue`则能够保证任务提交者和任务执行者（或者说生产者和消费者）做手递手传递：即只在有人接手任务的情况下，任务的提交才能成功，否则就只能等着（同样只有有人在等着提交任务，任务的获取才能成功，否则也只能等着）。**

所以如果使用`SynchronousQueue`，**相当于在使用size=0的queue**。

`SynchronousQueue`常用来处理一些 **两个（或多个）线程之间通过状态位进行协同阻塞唤醒** 的场景。比如一个线程执行到一种状态后，另外一个线程才能开始执行。可以使用`CountDownLatch`，也可以使用`SynchronousQueue`，会更简单。
- https://www.baeldung.com/java-synchronous-queue

### 一个骚操作：用线程池内部的阻塞队列
生产者消费者模型中，二者通过`BlockingQueue`协同，所以我们要传入一个BlockingQueue作为任务队列。
但是，`ThreadPoolExecutor`中本身就带有一个`BlockingQueue`，我们能不能直接操作这个队列来控制我们任务的执行逻辑：
```java
    /**
     * The queue used for holding tasks and handing off to worker
     * threads.  We do not require that workQueue.poll() returning
     * null necessarily means that workQueue.isEmpty(), so rely
     * solely on isEmpty to see if the queue is empty (which we must
     * do for example when deciding whether to transition from
     * SHUTDOWN to TIDYING).  This accommodates special-purpose
     * queues such as DelayQueues for which poll() is allowed to
     * return null even if it may later return non-null when delays
     * expire.
     */
    private final BlockingQueue<Runnable> workQueue;
```
这个队列是线程池内部提交/获取任务用的，用于任务的协同控制（await/signal）。正常的任务提交流程是：我们提交（execute/submit）任务给线程池 -> 线程池提交任务（offer）到线程池。如果我们直接手动把任务扔到这个队列里呢？

> 没有线程池这个中间商赚差价:D

我们定义一个`CallerBlocksPolicy`，同时把线程池的`RejectedExecutionHandler`设置为`CallerBlocksPolicy`：
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
这样任务不是直接就到队列里了？**理论上是的，但是不建议这么做！`ThreadPoolExecutor`的确提供了`getQueue()`方法来获取线程池内部的queue，但是它是一个内部queue，不应该被这么使用。而且该接口的doc也说了，该方法仅应用作debug或监控**：
> Access to the task queue is intended primarily for debugging and monitoring.

**毕竟线程池要通过任务的offer（非阻塞）/take（阻塞）行为来设置线程池内部状态，如果我们手动越过线程池直接操作这个内部队列，可能会导致线程池状态混乱，引起未知异常。**

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

# 其他的实现类
`ThreadPoolExecutor`只是最常用的`ExecutorService`实现类，还有一些其他的可以了解一下。

## `ScheduledExecutorService` - 定时、周期执行者
拓展了`ExecutorService`接口，加上了：
- 定时、只执行一次方法：`schedule`；
- 周期执行方法：`scheduleAtFixedRate和scheduleWithFixedDelay`；

`ScheduledThreadPoolExecutor`是其实现，和它的接口拓展了`ExecutorService`一样，它拓展了`ThreadPoolExecutor`。

## `Executors`工具类
在`Executors`工具类中，提供了多种简单创建线程池（`ThreadPoolExecutor`和`ScheduledThreadPoolExecutor`）的方法，但是[不建议使用`Executors`创建thread pool](https://www.baeldung.com/java-executors-cached-fixed-threadpool)。

此外还提供了：
- `RunnableAdapter`：`Runnable`转`Callable`用；
- `DefaultThreadFactory`：创建线程用。

### `newCachedThreadPool`
`BlockingQueue`使用的是`SynchronousQueue`，这个队列只在有消费者消费时才能put。所以这其实是个0大小的队列，**实际上就是让生产者和消费者手递手（hand-off）交付任务。**

**所以它的名字叫`CachedThread`，其实它相当于cache了一堆thread，当有任务出现时，直接把已有的cache好的thread拿来用。**

同时**它的thread数没设上限**，如果线程不够就会一直创建线程。**短时间内如果有大量任务，且执行时间不定**，不要用这个（否则会创建巨多线程）。

关于`SynchronousQueue`和`LinkedBlockingQueue(1)`的区别：
- https://stackoverflow.com/questions/8591610/when-should-i-use-synchronousqueue

### `newFixedThreadPool`
固定线程数的线程池。但是**它使用的是一个无限大小的`LinkedBlockingQueue`**，可能会消耗大量内存资源，**甚至会导致oom**。而且，对于大多数场景无限排队没什么意义，client超时就不等待了，server把任务排下来也没什么意义。还有一个缺点是线程数固定，没什么弹性。

所以建议自己创建一个有线程限制、有排队大小限制、有弹性的`ThreadPoolExecutor`：
```java
new ThreadPoolExecutor(10, 20, 60, SECONDS, new ArrayBlockingQueue<Runnable>(1000), new AbortPolicy());
```

## `newWorkStealingPool`
```java
    /**
     * Creates a thread pool that maintains enough threads to support
     * the given parallelism level, and may use multiple queues to
     * reduce contention. The parallelism level corresponds to the
     * maximum number of threads actively engaged in, or available to
     * engage in, task processing. The actual number of threads may
     * grow and shrink dynamically. A work-stealing pool makes no
     * guarantees about the order in which submitted tasks are
     * executed.
     *
     * @param parallelism the targeted parallelism level
     * @return the newly created thread pool
     * @throws IllegalArgumentException if {@code parallelism <= 0}
     * @since 1.8
     */
    public static ExecutorService newWorkStealingPool(int parallelism) {
        return new ForkJoinPool
            (parallelism,
             ForkJoinPool.defaultForkJoinWorkerThreadFactory,
             null, true);
    }
```

`ForkJoinPool`的实现，**可以提高任务执行的并行度**。

## `MoreExecutors` - Guava
Guava也提供了一些方便的`Executor`/`ExecutorService`，但是都只能通过`MoreExecutors`这个工具类创建实例。

### `DirectExecutor`
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

### exiting executor service
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

#### shutdown hook
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

### `ListenableFuture`
[`ListenableFuture`]({% post_url 2020-06-03-ListenableFuture %})

- https://www.baeldung.com/thread-pool-java-and-guava

# 感想
还是强调一下“关注点分离”吧，理解到每一块的关注点，就能理解到其中的设计逻辑，这才是真正理解了，一点儿也不会混乱。
