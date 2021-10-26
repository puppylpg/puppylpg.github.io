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

- `boolean isCancelled()`
- `boolean isDone()`
- `boolean cancel(boolean mayInterruptIfRunning)`
- `V get() throws InterruptedException, ExecutionException`
- `V get(long timeout, TimeUnit unit) throws InterruptedException, ExecutionException, TimeoutException`

所以一般不直接new一个Thread start Callable/Runnble，多是通过线程池提交Callable/Runnble，然后获取Future，再和Future打交道。

## RunnableFuture - 真正的任务表示
Runnable + Future，两个接口的结合。既有任务执行方法，又有任务结果表示，所以**这个类才是实际执行前创建的任务形态**。

## FutureTask - RunnableFuture的实现
FutureTask的模型也比较简单：
1. 内置一个变量叫outcome，一个int值state表示当前任务的状态；
2. 线程执行任务的时候，会改变state，如果有结果，会放入outcome；
3. 其他线程要获取结果，就检查state，如果是已完成，就获取outcome。否则就挂起（以该FutureTask对象作为锁，挂起到它的等待队列）。

# 任务的执行者
## Executor - 简单执行者
任务的执行者最简单的抽象是Executor。它只提供了execute方法，返回值是void。

任务不是execute了就立刻执行的，而是会在**将来某个时刻执行**，具体取决于线程池的线程什么时候有空，且抢到了CPU资源。

- `void execute(Runnable command)`

> **线程为什么能执行任务**？
> 
> 线程池之所以能执行任务，是因为里面的线程直接执行了任务的run()方法，由这个线程去运行task的那些干活的代码……主线程也可以这样去执行任务，不过我们一般都使用子线程这么干。

Executor接口的缺点是：
1. 对任务的执行没有暴露任何控制接口；
2. 它只能做到执行Runnable任务，无法返回任何结果。

## ExecutorService - 高级执行者
所以真正有用的接口是ExecutorService。正如Future对Callable/Runnable的拓展**给任务加上了状态判断**一样，ExecutorService也对Executor进行了拓展，**给执行者加上了状态控制和判断方法**。比如关闭executor的shutdown，和判断executor是否关闭的isShutdown等。

- `boolean isShutdown()`
- `boolean isTerminated()`
- `void shutdown()`
- `List<Runnable> shutdownNow()`

另外，ExecutorService还新增了提交Callable/Runnable的submit方法，返回任务的执行结果（Future）。当然，submit一个Runnable和execute一个Runnable没啥区别，反正submit的返回值也是null。同时，submit Runnable其实是先把Runnable转Callable，其实还是submit的Callable。

- `<T> Future<T> submit(Callable<T> task)`
- `Future<?> submit(Runnable task)`
- `<T> Future<T> submit(Runnable task, T result)`

### 关闭ExecutorService
关于关闭ExecutorService的方法：
- shutdown()：线程池不再接受新任务了，但不是立即关停，也不保证等待已有任务执行完；
- shutdownNow()：强关。正在执行的也别执行了。
- awaitTermination(long, TimeUnit)：**阻塞方法，要么任务执行完，要么超时，要么被interrupt，否则一直阻塞**。

JDK建议关闭一个线程池的方式：
```
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
但是还是太麻烦了，**推荐Guava的`MoreExecutors.getExitingExecutorService(ThreadPoolExecutor, long, TimeUnit)`。**

## ThreadPoolExecutor - ExecutorService实现者
Executor/ExecutorService的实现是ThreadPoolExecutor，以线程池的形式实现了ExecutorService。

ThreadPoolExecutor是一个典型的生产者消费者模型：
1. 用户提交任务进入线程池，实际是加入了BlockingQueue；
2. 线程池的线程从BlockingQueue取任务，执行；

详细可以参考：
- https://www.baeldung.com/thread-pool-java-and-guava

> 所以生产者消费者模型，也可以用现成的ThreadPoolExecutor去实现啊！

创建ThreadPoolExecutor时的几个必要参数：
- int corePoolSize：线程池线程不足corePoolSize时，继续创建；
- int maximumPoolSize：最多创建maximumPoolSize个线程；
- long keepAliveTime, TimeUnit unit：超出corePoolSize数的线程的最大闲置时间，超过就终止该线程；
- BlockingQueue<Runnable> workQueue：存放任务的队列，由任务消费者取出。实际上就是生产者-消费者模式中的缓冲区；
- ThreadFactory threadFactory：创建子线程的factory，设置了factory就可以自定义线程，比如线程名称、daemon；
- RejectedExecutionHandler handler：如果BlockingQueue放不下，应该怎么办；

所以ThreadPoolExecutor通过里面的BlockingQueue，实现了生产者消费者模式：
- 通过execute/submit方法，提交Runnable/Callable到BlockingQueue；
- 任务提交后，使用内部的Worker从BlockingQueue获取并执行任务；

### Worker
ThreadPoolExecutor的静态内部类。**线程池ThreadPoolExecutor里的工作线程持有者，内部持有Thread对象（由ThreadPoolExecutor的ThreadFactory创建，所以创建线程和使用线程也解耦了）**。线程池的大小其实就是Worker的多少。实际以`HashSet<Worker> workers`的形式存在。

> 所以线程池大小getPoolSize()实际就是返回workers.size()，当然要加锁获取其size，毕竟并发，数量不定。

当执行execute方法时，实际就是调用Worker的run方法：
- 如果是首次创建的Worker（因为没到达corePoolSize），创建时任务已经以firstTask传入Worker，直接执行firstTask；
- 如果是已有的Worker，从BlockingQueue里取一个任务，执行；

## BlockingQueue
生产者消费者同步资源（这里是待执行任务）的队列。

如下例子：
```
public class ThreadPoolDemo {

    private static final int TASK_NUM = 20;

    private static Callable<String> createCallableTask(String taskName) {
        return () -> {
            int time = RandomUtils.nextInt(500, 1000);
            TimeUnit.MILLISECONDS.sleep(time);
            print("Finished: " + taskName + " time=" + time);
            return taskName;
        };
    }

    public static void main(String... args) throws InterruptedException {
        RejectedExecutionHandler callerBlocksPolicy = (r, executor) -> {
            try {
                executor.getQueue().put(r);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        };

        // 此时，这个线程池就等于生产者消费者模型里的：阻塞队列 + 消费者
        ExecutorService executor = new ThreadPoolExecutor(
                2,
                4,
                20L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(10),
                new ThreadFactoryBuilder().setNameFormat("sub process" + "-%d").setDaemon(false).build(),
                callerBlocksPolicy
        );

        // 提交一堆并行任务，最好是和CPU无关的，比如I/O密集型的下载任务
        for (int i = 1; i <= TASK_NUM; i++) {
            String taskName = "Hello => " + i;
            print("try to submit task: " + taskName);
            executor.submit(createCallableTask(taskName));
            print("submit task: " + taskName);
        }

        print(executor.toString());
    }

    private static void print(String str) {
        System.out.println(Thread.currentThread().getName() + ": " + str);
    }
}
```
线程池大小为2~4，队列大小为10，如果一次性提交20个任务，在子线程运行完任意一个任务之前，最多能提交成功多少个任务？14个。先提交的任务直接由4个创建的线程执行，后续还能再提交10个任务进入BlockingQueue排队：
```
main: try to submit task: Hello => 1
main: submit task: Hello => 1
main: try to submit task: Hello => 2
main: submit task: Hello => 2
main: try to submit task: Hello => 3
main: submit task: Hello => 3
main: try to submit task: Hello => 4
main: submit task: Hello => 4
main: try to submit task: Hello => 5
main: submit task: Hello => 5
main: try to submit task: Hello => 6
main: submit task: Hello => 6
main: try to submit task: Hello => 7
main: submit task: Hello => 7
main: try to submit task: Hello => 8
main: submit task: Hello => 8
main: try to submit task: Hello => 9
main: submit task: Hello => 9
main: try to submit task: Hello => 10
main: submit task: Hello => 10
main: try to submit task: Hello => 11
main: submit task: Hello => 11
main: try to submit task: Hello => 12
main: submit task: Hello => 12
main: try to submit task: Hello => 13
main: submit task: Hello => 13
main: try to submit task: Hello => 14
main: submit task: Hello => 14


// 注意这里，只有结束一个任务之后，第15个任务才能提交成功
main: try to submit task: Hello => 15
sub process-1: Finished: Hello => 2 time=568
// 主线程提交第15个任务成功了
main: submit task: Hello => 15


main: try to submit task: Hello => 16
sub process-2: Finished: Hello => 13 time=594
main: submit task: Hello => 16
main: try to submit task: Hello => 17
sub process-0: Finished: Hello => 1 time=767
main: submit task: Hello => 17
main: try to submit task: Hello => 18
sub process-3: Finished: Hello => 14 time=964
main: submit task: Hello => 18
main: try to submit task: Hello => 19
sub process-1: Finished: Hello => 3 time=780
main: submit task: Hello => 19
main: try to submit task: Hello => 20
sub process-2: Finished: Hello => 4 time=874
main: submit task: Hello => 20
main: java.util.concurrent.ThreadPoolExecutor@1b9e1916[Running, pool size = 4, active threads = 4, queued tasks = 10, completed tasks = 6]
sub process-0: Finished: Hello => 5 time=747
sub process-3: Finished: Hello => 6 time=568
sub process-3: Finished: Hello => 10 time=570
sub process-1: Finished: Hello => 7 time=813
sub process-0: Finished: Hello => 9 time=891
sub process-2: Finished: Hello => 8 time=948
sub process-3: Finished: Hello => 11 time=530
sub process-1: Finished: Hello => 12 time=519
sub process-2: Finished: Hello => 16 time=758
sub process-0: Finished: Hello => 15 time=913
sub process-3: Finished: Hello => 17 time=776
sub process-1: Finished: Hello => 18 time=844
sub process-2: Finished: Hello => 19 time=712
sub process-0: Finished: Hello => 20 time=975
```

### SynchronousQueue - 长度为0的阻塞队列
如果BlockingQueue使用大小为0的队列，会出现什么情况？对于上述线程池，如果设置size=0，会出错，因为ArrayBlockingQueue不允许大小<=0。所以最小是1。

如果大小为1，那么在任一任务执行完之前，最多提交5个任务（4个线程+queue里放一个）。之后提交的任务会根据RejectedExecutionHandler的行为处理。

SynchronousQueue则能够保证任务提交者和任务执行者（或者说生产者和消费者）做手递手传递：即只有有人接手任务，任务的提交才能成功，否则就只能等着；同样只有有人在等着提交任务，任务的获取才能成功，否则也只能等着。

所以如果使用SynchronousQueue，相当于在使用size=0的queue：最多提交4个任务，因为只有四个线程。提交第五个任务会按照RejectedExecutionHandler的行为处理。

SynchronousQueue常用来处理一些 **两个（或多个）线程之间通过状态位进行协同阻塞唤醒** 的场景。比如一个线程执行到一种状态后，另外一个线程才能开始执行。可以使用CountDownLatch，也可以使用SynchronousQueue，会更简单。
- https://www.baeldung.com/java-synchronous-queue

### 用于生产者消费者模型
生产者消费者模型中，二者通过BlockingQueue协同。而ThreadPoolExecutor中本身就带有一个BlockingQueue。所以只要把RejectedExecutionHandler设置为CallerBlocksPolicy，就可以直接用线程池替代生产者消费者模型中的“BlockingQueue+消费者”这两部分。

## ThreadFactory
ThreadFactory接口，只有一个newThread(Runnable)方法用于创建Thread。可以做到创建线程和使用线程的解耦。

1. `DefaultThreadFactory`：Executors工具类里有内部类DefaultThreadFactory。可通过Executors.defaultThreadFactory()创建一个DefaultThreadFactory。它给创建的线程设置了name和group，**以非daemon的形式存在**，优先级为Thread.NORM_PRIORITY。

> Executors里还有一个PrivilegedThreadFactory继承自DefaultThreadFactory，不过暂时应该还用不上。

2. `BasicThreadFactory`：JDK里的DefaultThreadFactory不能配置线程优先级、daemon等，apache commons提供了BasicThreadFactory，可以手动配置这些。

一般创建周期性任务的时候都用BasicThreadFactory，创建的线程就可以全设为daemon了。

```
        ExecutorService executor = new ThreadPoolExecutor(
                2,
                4,
                20L,
                TimeUnit.MILLISECONDS,
                new LinkedBlockingDeque<>(),
                new ThreadFactoryBuilder().setNameFormat("sub process" + "-%d").setDaemon(true).build()
        );
```

## RejectedExecutionHandler
当线程数满了，放置任务的BlockingQueue也满了，那当前要提交的任务应该何去何从？

RejectedExecutionHandler就是对这一行为的定义。该接口比较简单，就一个方法：
- `void rejectedExecution(Runnable r, ThreadPoolExecutor executor)`

该方法在ThreadPoolExecutor无法提交任务时调用，r代表要提交的方法，executor是大年线程池。

- `AbortPolicy`：默认使用AbortPolicy，即提交不了直接throw new RejectedExecutionException。这就是CompletionService#submit会抛RejectedExecutionException的原因；

```
        public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
            throw new RejectedExecutionException("Task " + r.toString() +
                                                 " rejected from " +
                                                 e.toString());
        }
```

- `DiscardPolicy`：提交不了拉倒，啥也不做。啥也不做其实就是扔了。但这个一定要注意，**不要获取它的Future**。因为任务已经扔了，不会再被执行了，提交时创建的Future的任务执行状态永远不会被改变，所以想要获取其值无异于等待戈多——永远也不可能等到；

```
        public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
        }
```

- `DiscardOldestPolicy`：提交不了，就把队头的拉出来扔了，把新的任务放进去；

```
        public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
            if (!e.isShutdown()) {
                // 把队头的任务取出来，直接扔了
                e.getQueue().poll();
                // 再次尝试提交新任务
                e.execute(r);
            }
        }
```

- `CallerRunsPolicy`：提交任务的线程自己跑。其实就是提交任务的当前线程直接调用Runnable#run。**但这样不好，因为会妨碍当前线程提交任务**。类似于领导自己亲自干活，等到小弟闲下来了，却发现没有领导给他们安排活了，导致工作线程空闲下来。

```
        public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
            if (!e.isShutdown()) {
                r.run();
            }
        }
```

- ~~自定义一个`CallerBlocksPolicy`~~：如果提交任务的线程发现交不了了，就卡着（线程挂起），直到有队列有了新的位置，可以提交进去位置。
```
        RejectedExecutionHandler callerBlocksPolicy = (r, executor) -> {
            executor.getQueue().put(r);
        };
```
> 目前碰到的场景就是大量数据从数据库读取时，如果直接读全部会OOM。所以采用流式读取。读数据的线程发现worker线程满负载运转，且BlockingQueue队列堆满时，就直接卡住，不再继续从数据库流式加载数据了。

参考：
- https://stackoverflow.com/a/10353250/7676237

**不推荐这种策略**：主要原因是ExecutorService里的BlockingQueue本质上是由线程池管理的。如果手动操作这个BlockingQueue，会影响线程池的状态。比如：如果此时线程池里的线程为0，我们put一个任务进去，线程池并不会创建线程消费它，最终主线程卡在put上，而线程池也不知道去消费它。所以这里的手动放置破坏了线程池本身“优先创建线程，线程数够了才放入queue”的行为。

- https://stackoverflow.com/a/3518588/7676237

而且，ExecutorService接口本身没有`getQueue()`方法，该方法是ThreadPoolExecutor独有的。说明接口没想保留queue给使用者。同时，该方法的javadoc也做了如下说明：
> Returns the task queue used by this executor. **Access to the task queue is intended primarily for debugging and monitoring**. This queue may be in active use. Retrieving the task queue does not prevent queued tasks from executing.

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


