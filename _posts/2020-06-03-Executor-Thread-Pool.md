---
layout: post
title: "Executor - Thread Pool"
date: 2020-06-03 02:38:49 +0800
categories: Java Guava Future Executor
tags: Java Guava Future Executor
---

JDK中任务和任务的执行者是一套设计的比较好的相互解耦的框架。之前在[Java并发编程：并发任务执行及结果获取](https://blog.csdn.net/puppylpg/article/details/80683101)描述过jdk中关于Executor的基本逻辑，这次从更加宏观的角度重新全面梳理一下，并补充一点Guava对Executor和Future的拓展。

1. Table of Contents, ordered
{:toc}

# 任务
## Runnable/Callable - 简单任务表示
任务由Callable/Runnble表示。

> Runnable在Java 1.0就有了，Callable是Java 1.5才有的。

### Runnable转Callable
Runnable和Callable相比，缺少返回值。所以Runnable是可以转Callable的，只要返回null就行了。Runnable转Callable主要是因为有些方法只接受Callable不接受Runnable，所以把Runnable转成Callable：
> This can be useful when applying methods requiring a Callable to an otherwise resultless action. 当将需要Callable的方法应用到其他无结果的操作时，这会很有用。

在Executors工具类方法里，提供了Runnable转Callable的方法：
```
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
RunnableAdapter就是简单的封装一下Runnable，并**返回传入的result**（这个传入值基本是null，因为Runnable本身就不返回值）：
```
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
            task.run();
            return result;
        }
    }
```
**这个转后的Callable的result是提前传入的，不像真正的Callable一样是执行后的结果。**

## Future - 高级任务表示
更高级的方式是用`Future<T>`表示。这么做主要是引入了对任务生命周期的控制。通过Future可以判断任务是否完成isDone/isCancelled、获取任务结果get，或者取消任务cancel。

所以一般不直接new一个Thread start Callable/Runnble。（当然更不会调用Callable/Runnable的run方法，那样就是串行执行了）

## RunnableFuture - 真正的任务表示
Runnable + Future，两个接口的结合。任务run()后才会产生Future，又有任务执行方法，又有任务结果表示，所以**这个类才是实际执行前创建的任务形态**。

## FutureTask
RunnableFuture的实现。创建时传入Runnable或者Callable，二者都会转换为Callable（如前所述：Runnable转Callable），因为其Future语义要求必须有返回值。对于Runnable，返回值自定义，一般定义为null。

FutureTask实现的任务执行方法run()，主要是调用Callable任务的call方法，并将返回值set到outcome变量里，等待get方法获取。对于Runnable转成的Callable，这个Callable的实现实际是RunnableAdapter，它的call方法返回用户将Runnable转Callable时提前设置的返回值。

**其实Runnable（任务执行方法） + Future（任务返回值），相当于解构了Callable（任务执行+返回值）。** 从此任务无论是Callable还是Runnable，都可以用RunnableFuture表示了。**又因为RunnableFuture继承了Runnable接口，所以接口声明常仅声明一个Runnable，既然它可以传RunnableFuture，自然也可以是Callable。**

**Runnable -> Callable -> RunnableFuture(FutureTask)，Runnable先赋个dummy返回值变成Callable，Callable再被解构为RunnableFuture=Runnable+Future，有趣啊！**

get方法怎么知道任务是否完成？FutureTask有几个状态变量，在run执行的过程中，根据不同阶段给state set不同的值即可。

# 任务的执行者
## Executor - 简单执行者
任务的执行者最简单的抽象是Executor。它只提供了execute方法，返回值是void。所以它只能做到执行Runnable任务，但是对任务的执行没有暴露任何控制接口，也无法返回任何结果。

## ExecutorService - 高级执行者
所以真正有用的接口是ExecutorService。像Future对Callable/Runnable的拓展**给任务加上了状态判断**一样，ExecutorService也对Executor进行了拓展，**给执行者加上了状态控制和判断方法**。比如关闭executor的shutdown，和判断executor是否关闭的isShutdown等。

另外，ExecutorService还新增了提交Callable/Runnable的submit方法，返回任务的执行结果（Future）。当然，submit一个Runnable和execute一个Runnable没啥区别，反正submit的返回值也是null。同时，submit Runnable其实是先把Runnable转Callable，其实还是submit的Callable。

### 关闭ExecutorService
关于关闭ExecutorService的方法：
- shutdown()：线程池不再接受新任务了，但不是立即关停，也不保证等待已有任务执行完；
- shutdownNow()：强关。正在执行的也别执行了。
- awaitTermination(long, TimeUnit)：**阻塞方法，要么任务执行完，要么超时，要么被interrupt，否则一直阻塞**。

JDK建议关闭一个线程池的方式：
```
void shutdownAndAwaitTermination(ExecutorService pool) {
    pool.shutdown(); // Disable new tasks from being submitted
    try {
        // Wait a while for existing tasks to terminate
        if (!pool.awaitTermination(60, TimeUnit.SECONDS)) {
            pool.shutdownNow(); // Cancel currently executing tasks
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
但是还是太麻烦了，**推荐Guava的`MoreExecutors.getExitingExecutorService(ThreadPoolExecutor, long, TimeUnit)`。**

## ThreadPoolExecutor
Executor/ExecutorService的实现是ThreadPoolExecutor，以线程池的形式实现了Executor。

创建ThreadPoolExecutor时的几个必要参数：
- int corePoolSize：线程池线程不足corePoolSize时，继续创建；
- int maximumPoolSize：最多创建maximumPoolSize个线程；
- long keepAliveTime, TimeUnit unit：超出corePoolSize数的线程的最大闲置时间，超过就终止该线程；
- BlockingQueue<Runnable> workQueue：存放任务的队列，由任务消费者取出。实际上就是生产者-消费者模式中的缓冲区；
- ThreadFactory threadFactory,
- RejectedExecutionHandler handler

所以ThreadPoolExecutor通过里面的BlockingQueue，实现了生产者消费者模式：
- 通过execute/submit方法，提交Runnable/Callable到BlockingQueue；
- 任务提交后，使用内部的Worker从BlockingQueue获取并执行任务；

### Worker
ThreadPoolExecutor的静态内部类。**线程池ThreadPoolExecutor里的工作线程持有者，内部持有Thread对象（由ThreadPoolExecutor的ThreadFactory创建，所以创建线程和使用线程也解耦了）**。线程池的大小其实就是Worker的多少。实际以`HashSet<Worker> workers`的形式存在。

> 所以线程池大小getPoolSize()实际就是返回workers.size()，当然要加锁获取其size，毕竟并发，数量不定。

当执行execute方法时，实际就是调用Worker的run方法：
- 如果是首次创建的Worker（因为没到达corePoolSize），创建时任务已经以firstTask传入Worker，直接执行firstTask；
- 如果是已有的Worker，从BlockingQueue里取一个任务，执行；

### BlockingQueue
生产者消费者的资源缓冲区。

注意这个BlockingQueue是只存放Runnable任务的。上文提到，任务的实际表述是RunnableFuture，所以这里BlockingQueue虽然声明里面放的是Runnable，实际上也可以是Callable。

### ThreadFactory
只有一个newThread(Runnable)方法用于创建Thread。可以做到创建线程和使用线程的解耦。在创建

#### DefaultThreadFactory
Executors工具类里有内部类DefaultThreadFactory。可通过Executors.defaultThreadFactory()创建一个DefaultThreadFactory。它给创建的线程设置了name和group，**以非daemon的形式存在**，优先级为Thread.NORM_PRIORITY。

> Executors里还有一个PrivilegedThreadFactory继承自DefaultThreadFactory，不过暂时应该还用不上。

#### BasicThreadFactory
JDK里的DefaultThreadFactory不能配置线程优先级、daemon等，apache commons提供了BasicThreadFactory，可以手动配置这些。

一般创建周期性任务的时候都用BasicThreadFactory，创建的线程就可以全设为daemon了。

### RejectedExecutionHandler
当线程数满了，放置任务的BlockingQueue也满了，对任务执行的策略。

默认使用AbortPolicy，即抛出RejectedExecutionException。

## submit和execute
execute是Executor的方法，submit是ExecutorService。submit返回Future，但是execute返回void。

实际上根据ThreadPoolExecutor实现的submit和execute方法，很容易就能看出来，submit实际上先把任务封装为RunnableFuture，执行（execute）该任务，再返回RunnableFuture：
```
    public Future<?> submit(Runnable task) {
        if (task == null) throw new NullPointerException();
        RunnableFuture<Void> ftask = newTaskFor(task, null);
        execute(ftask);
        return ftask;
    }

    public <T> Future<T> submit(Runnable task, T result) {
        if (task == null) throw new NullPointerException();
        RunnableFuture<T> ftask = newTaskFor(task, result);
        execute(ftask);
        return ftask;
    }

    public <T> Future<T> submit(Callable<T> task) {
        if (task == null) throw new NullPointerException();
        RunnableFuture<T> ftask = newTaskFor(task);
        execute(ftask);
        return ftask;
    }
```
所以如果execute执行的对象本身就是RunnableFuture类型的，既可以通过submit提交执行并根据返回的Future（其实还是它自己啦）获取结果：
```
    RunnableFuture<T> ftask = new FutureTask(callable);
    // future == ftask, 233
    Future future = exector.submit(ftask);
    future.get()
```
也可以使用execute执行，反正我们已经有了这个RunnableFuture的引用了，直接操作它就行了：
```
    RunnableFuture<T> ftask = new FutureTask(callable);
    exector.execute(ftask);
    ftask.get()
```

区别在于execute只能执行Runnable，而submit Runnable/Callable都可以执行。

## ScheduledExecutorService - 定时、周期执行者
拓展了ExecutorService接口，加上了：
- 定时、只执行一次方法：schedule；
- 周期执行方法：scheduleAtFixedRate和scheduleWithFixedDelay；

ScheduledThreadPoolExecutor是其实现，和它的接口拓展了ExecutorService一样，它拓展了ThreadPoolExecutor。

# 解耦
- 提交任务和执行任务解耦；
- 创建线程和使用线程解耦；

# Executors工具类
在Executors工具类中，提供了多种简单创建线程池（ThreadPoolExecutor和ScheduledThreadPoolExecutor）的方法，但是都不建议用……

此外还提供了：
- RunnableAdapter：Runnable转Callable用；
- DefaultThreadFactory：创建线程用。

## 不使用Executors创建thread pool
- https://www.baeldung.com/java-executors-cached-fixed-threadpool

### newCachedThreadPool
BlockingQueue使用的是SynchronousQueue，这个队列只在有消费者消费时才能put。所以这其实是个0大小的队列，**实际上就是让生产者和消费者手递手（hand-off）交付任务。**

**所以它的名字叫CachedThread，其实它相当于cache了一堆thread，当有任务出现时，直接把已有的cache好的thread拿来用。**

同时它的thread数没设上线，如果线程不够就会一直创建线程。**短时间内如果有大量任务，且执行时间不定**，不要用这个（否则会创建巨多线程）。

关于SynchronousQueue和LinkedBlockingQueue(1)的区别：
- https://stackoverflow.com/questions/8591610/when-should-i-use-synchronousqueue

### newFixedThreadPool
固定线程数的线程池。但是它使用的是一个无限大小的LinkedBlockingQueue。无限排队比newCachedThreadPool好一些，但也会消耗内存资源。而且，对于大多数场景无限排队没什么意义，client超时就不等待了，server把任务排下来也没什么意义。还有一个缺点是线程数固定，没什么弹性。

所以建议自己创建一个有线程限制、有排队大小限制、有弹性的ThreadPoolExecutor：
```
new ThreadPoolExecutor(10, 20, 60, SECONDS, new ArrayBlockingQueue<Runnable>(1000), new AbortPolicy());
```

## newWorkStealingPool
@since 1.8

# MoreExecutors - Guava
Guava也提供了一些方便的Executor/ExecutorService，但是都只能通过MoreExecutors这个工具类创建实例。

## DirectExecutor
使用本线程执行任务的Executor。实现起来很简单——不通过Thread start任务，直接调用run即可：
```
  @Override
  public void execute(Runnable command) {
    command.run();
  }
```
毕竟这也是一种特殊的Executor。

值得注意的是，这是我第一次见到一个enum类实现接口：
```
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
```
  public static Executor directExecutor() {
    return DirectExecutor.INSTANCE;
  }
```
**如果有什么工具类，又不想全static，也不想new一个全局唯一的工具类实例，使用enum这种真的很方便啊！**

## Exiting Executor Service
非daemon线程是会阻止JVM退出的。所以在创建执行不重要任务的线程池的时候，会给它设置一个创建daemon线程的ThreadFactory，所有创建出来的线程都是daemon。

Guava提供的`MoreExecutors.getExitingExecutorService()`可以帮助**把一个会阻挠JVM退出的刁民ExecutorService转成良民**：
1. 将一个现有的ThreadPoolExecutor（无论是啥样的）搞成只能创建daemon的；
2. 并且给jvm注册上shutdown hook：在JVM退出时关闭此ThreadPoolExecutor（**想想自己创建的那些线程池是不是没有关闭……没有调用shutdown**），并能设置等待此ThreadPoolExecutor关闭的时间。

### 设为daemon - ThreadFactoryBuilder
主要是把现有ThreadPoolExecutor的ThreadFactory给改了。**利用Guava的ThreadFactoryBuilder，可以copy一个已有的ThreadFactory，构建出一个新的修改了部分属性的ThreadFactory**：
```
  private static void useDaemonThreadFactory(ThreadPoolExecutor executor) {
    executor.setThreadFactory(
        new ThreadFactoryBuilder()
            .setDaemon(true)
            .setThreadFactory(executor.getThreadFactory())
            .build());
  }
```

### 固化ExecutorService - DelegatedExecutorService
```
ExecutorService service = Executors.unconfigurableExecutorService(executor);
```
这一步是JDK Executors里的操作，把当前的ExecutorService“固化”，所谓固化是我自己起的，其实就是把已有的ExecutorService封装为DelegatedExecutorService。这个类把所有的ExecutorService里的方法都委托给自己封装的ExecutorService。这样一来，如果原来的ExecutorService是个ExecutorService的子类（比如ScheduledThreadPoolExecutor），现在它所有的ExecutorService接口之外的方法都被禁用了：
```
    public static ExecutorService unconfigurableExecutorService(ExecutorService executor) {
        if (executor == null)
            throw new NullPointerException();
        return new DelegatedExecutorService(executor);
    }
```
暂时不知道啥场景要这么用，反正知道有这么一种封装方式就行了。

### 为ExecutorService注册shutdown hook，关闭前等待一段
```
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
异步注册（派一个新的线程注册）shutdown hook，**在JVM关闭时调用线程池的shutdown方法，这样就不用写什么@PreDestory方法了**。并使用awaitTermination等待一段时间：**MIN(all task finished, timeout)**（awaitTermination的语义）。

## ListenableFuture
[ListenableFuture]({% post_url 2020-06-03-ListenableFuture %})

- https://www.baeldung.com/thread-pool-java-and-guava


