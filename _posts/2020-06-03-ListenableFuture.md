---
layout: post
title: "ListenableFuture"
date: 2020-06-03 02:30:06 +0800
categories: Java Guava Future ListenableFuture
tags: Java Guava Future ListenableFuture
---

ListenableFuture是Guava里拓展了Future的接口，增加了回调行为。所以要比Future更强大。Guava建议使用ListenableFuture取代Future。而且，看ListenableFuture的实现过程，也能让人获益良多。

1. Table of Contents, ordered
{:toc}

# 约定
## Future &. ExecutorService
JDK里的Future在[ListenableFutureExplained](https://github.com/google/guava/wiki/ListenableFutureExplained)里有一段非常好的介绍：
> A traditional Future represents the result of an asynchronous computation: a computation that may or may not have finished producing a result yet. A Future can be a handle to an in-progress computation, a promise from a service to supply us with a result.

Future是一个约定：一个放置任务结果的地方。在任务结束后，任务的执行结果会放在Future里，供可访问Future的线程获取任务结果。

所以Future定的这个约定一定有人来执行，这个执行人就是ExecutorService。ExecutorService的submit方法提交一个Runnable/Callable任务，并创建一个Future。**最终，在任务完成之后，ExecutorService会遵照约定，将任务结果放入Future。**

## ListenableFuture &. ListeningExecutorService
Guava里的ListeableFuture拓展了JDK中的Future，新增了一个方法：
```
void addListener(Runnable listener, Executor executor);
```
可以给Future注册一些回调函数。这里ListenableFuture也做出了一个约定：当任务执行完毕时，会调用回调函数。

同样ListenableFuture的约定也得有人来执行。这个人不会是JDK里的ExecutorService，因为ExecutorService根本不知道有ListenableFuture这个东西，也无从执行这个约定。所以Guava还定义了ListenableFuture约定的执行者：ListeningExecutorService。

ListeningExecutorService拓展了ExecutorService接口，新增了返回ListenableFuture的submit方法。同时ListeningExecutorService的所有实现类也都会在任务完成后，调用注册到ListenableFuture里的回调函数。

# 兑现
想兑现约定需要两步：
1. 返回ListenableFuture；
2. 调用ListenableFuture的回调；

## 返回ListenableFuture
其实ListeningExecutorService和ExecutorService基本上差不太多，区别在于：
- 返回的必须是ListenableFuture而不是普通Future；
- 在任务执行完之后，调用所有ListenableFuture里注册的回调函数；

所以在实际实现上，Guava里的ListeningExecutorService的实现类继承了JDK里的ExecutorService的实现类，只是override了某些方法。

## 返回ListenableFuture
在JDK的ExecutorService抽象实现AbstractExecutorService里，创建Future对象是通过`protected newTaskFor()`方法来实现的，所以ListeningExecutorService的抽象实现AbstractListeningExecutorService只需要override newTaskFor方法，返回ListenableFuture就行了。

此时我不得不感慨JDK代码的精妙之处：
> 使用抽象类实现接口的通用架构，把具体需要执行的比如execute方法教给具体的ExecutorService的子类去实现。这样子类都可以复用抽象类的代码，像各种overload的submit方法就都不用写了（submit方法调用execute），而只需要关注自己真正的执行逻辑execute。

其实这一点也还好，毕竟写了这么多年代码之后这个思路已经很常见了。虽然不一定能设计好、写好，但是看到JDK这么写，还是很能理解的。

更让我感慨的是另一点：
> 将子任务使用函数封装。在JDK里，submit创建Future时，是通过newTaskFor方法实现的。

当然这么做的话三个submit方法可以复用newTaskFor实现创建Future的逻辑。但这只是显而易见的好处，另外一个深层的好处是看到Guava时才明白的：AbstractListeningExecutorService override AbstractExecutorService的三个submit方法时，其实只有创建Future不同：前者要创建一个ListenableFuture。由于AbstractExecutorService把创建Future的代码封装成了newTaskFor，所以AbstractListeningExecutorService也只需要override newTaskFor方法（生成ListenableFuture）就行了。三个submit方法的实现可以直接照抄AbstractExecutorService了：
```
  @Override
  public ListenableFuture<?> submit(Runnable task) {
    return (ListenableFuture<?>) super.submit(task);
  }

  @Override
  public <T> ListenableFuture<T> submit(Runnable task, @Nullable T result) {
    return (ListenableFuture<T>) super.submit(task, result);
  }

  @Override
  public <T> ListenableFuture<T> submit(Callable<T> task) {
    return (ListenableFuture<T>) super.submit(task);
  }
```
**所以将共有逻辑抽出来封装成函数，不仅让本类的代码可复用，日后改起来更简单（只改一处即可），也让继承类（子类）在修改这部分逻辑时更简单（只override这一处即可）。**

## 执行回调
这个其实比较简单，回调注册到ListenableFuture之后，一般回放在一个list里，需要调用回调的时候，遍历并执行这个list就好。

问题在于什么时候需要回调？任务完成（成功或者抛出异常）之后。但实际上ExecutorService只是执行了任务（的run方法），之后就不管了。没有所谓的afterDone逻辑。所以实际实现时，执行回调这一步骤是放在ListenableFuture的实现方法run()里的：
```
    @Override
    public void run() {
      if (owner.value != this) {
        // nothing to do, we must have been cancelled, don't bother inspecting the future.
        return;
      }
      Object valueToSet = getFutureValue(future);
      if (ATOMIC_HELPER.casValue(owner, this, valueToSet)) {
      
      // 这里调用了回调
        complete(owner);
      }
    }
```
也就是说，**执行完任务，就直接执行回调了。** 

> ListenableFuture实际上拓展的是RunnableFuture接口（所以也拓展了Future接口）。但是**RunnableFuture才是真正的任务（Runnable）+结果（Future）**。实际上JDK里Future的实现类FutureTask实现的就是RunnableFuture接口。有任务（Runnable），ExecutorService才能执行该任务嘛！

仔细想想，**将回调放在任务之后一起执行，又引入了一个新问题**：如果回调执行时间过长怎么办？岂不是相当于延长了任务执行时间，导致任务迟迟不能返回（Future.isDone()）？

所以在complete函数的实现里，执行这些回调是通过指定的Executor异步完成的。这样就不耽误执行任务的线程的结束。至于这个Executor是谁，看ListenableFuture的`addListener(Runnable, Executor)`方法，是可以给这些回调任务指定Executor的。

# FutureCallable - 更高级的回调形式
在ListenableFuture里，增加的回调是一个Runnable。Guava还提供了一个类：`CallbackListener implements Runnable`。也就是说CallbackListener是可以作为回调注册到ListenableFuture里的（因为它是Runnable）。

用CallbackListener而不是普通的Runnable有什么好处？看它的实现就知道了：
```
  private static final class CallbackListener<V> implements Runnable {
    final Future<V> future;
    final FutureCallback<? super V> callback;

    CallbackListener(Future<V> future, FutureCallback<? super V> callback) {
      this.future = future;
      this.callback = callback;
    }

    @Override
    public void run() {
      final V value;
      try {
        value = getDone(future);
      } catch (ExecutionException e) {
        callback.onFailure(e.getCause());
        return;
      } catch (RuntimeException | Error e) {
        callback.onFailure(e);
        return;
      }
      callback.onSuccess(value);
    }
  }
```
首先记住这个run()是在ListenableFuture的任务执行完之后紧接着执行的。这个run做了两个动作：
1. ListenableFuture的任务执行成功了：执行FutureCallback的onSuccess方法；
2. ListenableFuture的任务执行失败了：执行FutureCallback的onFailure方法；

所以CallbackListener作为一个回调函数，判断了任务执行的结果，并根据不同情况，委托给了FutureCallback去执行。这样，注册回调的时候虽然要new一个CallbackListener，并传入ListenableFuture和FutureCallback，但是指明了不同情况下的不同调用办法，就很清晰。

# 使用
实际使用时，Guava提倡使用`Futures.addCallback(ListenableFuture<V>, FutureCallback<V>, Executor)`给ListenableFuture注册回调。该方法封装了new CallbackListener的过程，简化了注册回调的逻辑：
```
  public static <V> void addCallback(
      final ListenableFuture<V> future,
      final FutureCallback<? super V> callback,
      Executor executor) {
    Preconditions.checkNotNull(callback);
    future.addListener(new CallbackListener<V>(future, callback), executor);
  }
```

在创建ListeningExecutorService上，Guava也提倡使用`MoreExecutors.listeningDecorator(ExecutorService)`，将一个已有的ExecutorService封装为ListeningExecutorService。封装的方式其实就是将ExecutorService包装为ListeningDecorator，又是一个Wrapper类：所有ExecutorService里有的方法都委托给封装的ExecutorService去实现，那些ListeningExecutorService里特有的方法（submit返回ListenableFuture）才由自己去实现。

> 感觉这个类是真的皮！明明`ListeningDecorator extends AbstractListeningExecutorService`，它已经有了ExecutorService里的所有方法，还非得委托给一个现成的ExecutorService去实现……

另外这个类是private static class，所以不能被实例化，只能通过`MoreExecutors.listeningDecorator(ExecutorService)`去创建。

> 看来Guava是真的喜欢让人用一些工具类的static方法去创建对象，而不是直接new一个对象。怪不得new HashMap也都是这么搞，之前我还一直很奇怪命名写个new HashMap并不费劲，为什么还要封装成方法。看来是Guava传统啊！

最后来个例子：
```
        // new a listening pool with current thread pool
        ListeningExecutorService service = MoreExecutors.listeningDecorator(Executors.newFixedThreadPool(10));
        
        // run task
        ListenableFuture<String> explosion = service.submit(
                () -> {
                    Thread.sleep(1 * 1000);
                    return "Hello world!";
                });
        
        // add callback for this task
        Futures.addCallback(
                // this task
                explosion,
                // callback for this task
                new FutureCallback<String>() {
                    @Override
                    public void onSuccess(String explosion) {
                        System.out.println(explosion);
                    }
                    @Override
                    public void onFailure(Throwable thrown) {
                        System.out.println(thrown.getMessage()); // escaped the explosion!
                    }
                },
                // use this pool to run callback
                service);
```
就很清晰了。但是由于这个线程池不是daemon，所以最终程序并不会退出。

所以最好改一下，使用不影响jvm退出的exiting线程池：
```
    public static void main(String... args) throws InterruptedException {
        // exiting thread pool
        ListeningExecutorService service = MoreExecutors.listeningDecorator(
                MoreExecutors.getExitingExecutorService(
                        (ThreadPoolExecutor) Executors.newFixedThreadPool(10),
                        10, TimeUnit.SECONDS
                )
        );

        // run task
        ListenableFuture<String> explosion = service.submit(
                () -> {
                    Thread.sleep(1 * 1000);
                    System.out.println("Task: I say hello world");
                    return "Hello world!";
                });

        // add callback for this task
        Futures.addCallback(
                // this task
                explosion,
                // callback for this task
                new FutureCallback<String>() {
                    @Override
                    public void onSuccess(String explosion) {
                        System.out.println("Call back: " + explosion);
                    }
                    @Override
                    public void onFailure(Throwable thrown) {
                        System.out.println(thrown.getMessage()); // escaped the explosion!
                    }
                },
                // use this pool to run callback
                service);

        // main thread wait at least 3s to exit
        Thread.currentThread().join(3000);
```
一个有趣的分析：这里之所以让main thread使用join()等一下，**不是为了等task（sleep 1s然后返回Hello world!）的完成，因为task是一定会完成的（exiting pool会最多等10s，让task去完成）。这里实际是为了等callback的完成**。

如果不等3s，main thread结束，但是task已经提交了，所以exiting pool会最多等10s（注册在shutdown hook里的awaitTermination()方法的作用），等任务完成。但是由于也在shutdown hook里注册了shutdown()方法，**所以线程池不再接收新的任务了（callback任务），所以callback不会被执行**。

# 参阅
- https://github.com/google/guava/wiki/ListenableFutureExplained

