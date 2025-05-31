---

layout: post  
title: "guava ListenableFuture"
date: 2025-05-31 16:07:39 +0800  
categories: Java Executor  
tags: Java Executor

---

ListenableFuture是Guava里拓展了Future的接口，增加了回调行为，所以要比Future更强大。Guava建议在任何使用Future的场合都使用ListenableFuture取代Future，也是比较有道理的。

1. Table of Contents, ordered
   {:toc}

# 任务执行后的回调
`ExecutorService#submit`执行任务，执行任务的是`Executor#execute`，负责按照任务执行状态维护`Future`状态的是`ExecutorService#submit`，更确切的说是`FutureTask#run`。

所以有两个地方可以执行回调：
1. FutureTask的run方法里，任务执行完了，会执行`afterExecute`方法。这里会执行两部分逻辑：
    1. 执行任务完成的通知，唤醒等待这个结果的线程（**也就是因为调用`Future#get`而被挂起的线程**）；
    2. **执行回调**，即`done()`方法；
    ```java
       /**
     * Removes and signals all waiting threads, invokes done(), and
     * nulls out callable.
     */
    private void finishCompletion() {
        // assert state > COMPLETING;
        for (WaitNode q; (q = waiters) != null;) {
            if (WAITERS.weakCompareAndSet(this, q, null)) {
                for (;;) {
                    Thread t = q.thread;
                    if (t != null) {
                        q.thread = null;
                        LockSupport.unpark(t);
                    }
                    WaitNode next = q.next;
                    if (next == null)
                        break;
                    q.next = null; // unlink to help gc
                    q = next;
                }
                break;
            }
        }

        done();

        callable = null;        // to reduce footprint
    }
    ```
1. 另一个地方就是`Executor#execute`，在任务执行完之后，会调用**`afterExecute`**方法。

不过jdk的`Future`不支持回调，所以`FutureTask#done()`什么也没做。
**guava的`FutureTask`作为`Future`的子类，支持添加回调`addListener(Runnable listener, Executor executor)`，所以它的实现类`ListenableFutureTask`（作为`FutureTask`的子类），实现了done方法，支持对回调进行调用。**

# `ListenableFuture`
`ListenableFutureTask`的实现相当简单！

注册回调，就是登记一下回调函数（以及执行回调函数的executor）：
```java
  // The execution list to hold our listeners.
  private final ExecutionList executionList = new ExecutionList();
  
  @Override
  public void addListener(Runnable listener, Executor exec) {
    executionList.add(listener, exec);
  }
```

触发回调就是在done方法里，用回调对应的executor执行这个回调函数：
```java
  @Override
  protected void done() {
    executionList.execute();
  }
```

**`ListenableFuture`注册回调函数时必须指定executor，这样就不会因为执行回调而影响原始任务的返回时间了！**

# `ListeningExecutorService`
因为jdk的`ExecutorService`会把任务封装为`FutureTask`，并执行回调，这个框架已经完成了。所以`ListeningExecutorService`只需要override“`ExecutorService`把任务封装为`FutureTask`”的逻辑，把任务封装为`ListenableFutureTask`就行了：
```java
  @Override
  protected final <T> RunnableFuture<T> newTaskFor(Callable<T> callable) {
    return TrustedListenableFutureTask.create(callable);
  }
```
另外`ListeningExecutorService`还额外提供了一个新的submit方法，其实和`ExecutorService#submit`相比啥也没干，只是把底层任务作为`ListenableFuture`暴露出来，让大家在上面注册回调罢了：
```java
  @Override
  public <T> ListenableFuture<T> submit(Callable<T> task) {
    return (ListenableFuture<T>) super.submit(task);
  }
```

# `FutureCallable` - 更高级的回调形式
在ListenableFuture里，增加的回调是一个Runnable。Guava还提供了一个类：`CallbackListener implements Runnable`。也就是说CallbackListener是可以作为回调注册到ListenableFuture里的（因为它是Runnable）。

用CallbackListener而不是普通的Runnable有什么好处？看它的实现就知道了：

```java
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

这个run()是一个回调，在ListenableFuture的任务执行完之后执行。这个run做了两个动作：

1. ListenableFuture的任务执行成功了：执行FutureCallback的onSuccess方法；
2. ListenableFuture的任务执行失败了：执行FutureCallback的onFailure方法；

所以CallbackListener作为一个回调函数，判断了任务执行的结果，并根据不同情况，委托给了FutureCallback去执行。这样，注册回调的时候虽然要new一个CallbackListener，并传入ListenableFuture和FutureCallback，但是指明了不同情况下的不同调用办法，就很清晰。

怎么确定任务是成功了还是失败了？也很简单，看`getDone(Future<V>)`方法，如果失败了会抛异常……catch住，然后执行onFailure就行了……

# 使用
实际使用时，Guava提倡使用`Futures.addCallback(ListenableFuture<V>, FutureCallback<V>, Executor)`给ListenableFuture注册回调。该方法封装了new CallbackListener的过程，简化了注册回调的逻辑：

```java
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
>

另外这个类是private static class，所以不能被实例化，只能通过`MoreExecutors.listeningDecorator(ExecutorService)`去创建。

> 看来Guava是真的喜欢让人用一些工具类的static方法去创建对象，而不是直接new一个对象。怪不得new HashMap也都是这么搞，之前我还一直很奇怪命名写个new HashMap并不费劲，为什么还要封装成方法。看来是Guava传统啊！
>

最后来个例子：

```java
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

```java
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

# 创建ListenableFuture
## ListenableFutureTask
上面提到了这是继承了JDK FutureTask的ListenableFuture的实现类。该类提供了创建它的方法工具类方法：

```java
  public static <V> ListenableFutureTask<V> create(Callable<V> callable) {
    return new ListenableFutureTask<V>(callable);
  }

  public static <V> ListenableFutureTask<V> create(Runnable runnable, @Nullable V result) {
    return new ListenableFutureTask<V>(runnable, result);
  }
```

同样，该类的构造函数不是public的，Guava不让直接new。

> 但是这样新建的ListenableFuture得想办法执行啊，要不然直接调用get是会block的。不执行怎么会有结果……
>

## Futures.immediateFuture(V)
直接返回一个ListenableFuture。感觉写Demo的时候用这个生成ListenableFuture会比较方便。

该方法实际上一个ImmediateSuccessfulFuture。**它只实现了ListenableFuture接口，没有实现RunnableFuture或者实现Runnable接口，因为它不需要发起一个异步任务，去异步完成task并设置value。**

所以它的实现很简单：

+ get方法直接return创建时指定的value就行了（再次印证：**不需要执行任务，所以不需要实现Runnable接口**）；
+ addListener：在listener add进来的时候直接执行就行了。因为没有task要执行，所以task肯定是已完成状态。

# Future转ListenableFuture
Guava建议从源码层面，修改旧的返回Future的代码，让它返回ListenableFuture。但是如果万不得已，不能修改原来的代码，又想将一个返回Future的API返回的Future转成ListenableFuture，Guava还提供了一个重量级转换方式：

```java
JdkFutureAdapters.listenInPoolThread(Future)
```

它实际上将Future转成了另一个ListenableFuture的实现类：ListenableFutureAdapter。

看名字就知道，它是一个封装了Future的Wrapper，所有有关Future的方法都交给了底层的Future处理。自己只实现了ListenableFuture接口中新增的addListener方法。

那么问题来了：之前的ListenableFuture的实现类除了要实现addListener接口之外，还要做一件事：override done()方法，这样任务完成时，就能执行回调接口了。ListenableFutureAdapter既然把方法原封不动委托给了底层的Future，自然并没有新增的调用回调这一步骤。那回调是什么时候被调用的？

看它的addListener的实现：

```java
    @Override
    public void addListener(Runnable listener, Executor exec) {
      executionList.add(listener, exec);

      // When a listener is first added, we run a task that will wait for the delegate to finish,
      // and when it is done will run the listeners.
      if (hasListeners.compareAndSet(false, true)) {
        if (delegate.isDone()) {
          // If the delegate is already done, run the execution list immediately on the current
          // thread.
          executionList.execute();
          return;
        }

        // TODO(lukes): handle RejectedExecutionException
        adapterExecutor.execute(
            new Runnable() {
              @Override
              public void run() {
                try {
                  /*
                   * Threads from our private pool are never interrupted. Threads from a
                   * user-supplied executor might be, but... what can we do? This is another reason
                   * to return a proper ListenableFuture instead of using listenInPoolThread.
                   */
                  getUninterruptibly(delegate);
                } catch (Throwable e) {
                  // ExecutionException / CancellationException / RuntimeException / Error
                  // The task is presumably done, run the listeners.
                }
                executionList.execute();
              }
            });
      }
    }
```

+ 如果添加listener的时候任务已完成，执行所有的回调；
+ 如果添加listener的时候任务还没完成，使用一个新的线程池，发起一个异步任务，专门等future完成，如果future完成，再发起执行所有的listener的流程（但是这个线程池不执行listener。实际listener由哪个线程池来执行，取决于注册listener的时候，指定让哪个线程池来执行该listener）：

```java
  public static <V> V getUninterruptibly(Future<V> future) throws ExecutionException {
    boolean interrupted = false;
    try {
      while (true) {
        try {
          return future.get();
        } catch (InterruptedException e) {
          interrupted = true;
        }
      }
    } finally {
      if (interrupted) {
        Thread.currentThread().interrupt();
      }
    }
  }
```

这个发起新的监视Future是否完成、完成就执行listener的线程池可以在构建ListenableFutureAdapter时传入：

```java
    ListenableFutureAdapter(Future<V> delegate, Executor adapterExecutor) {
      this.delegate = checkNotNull(delegate);
      this.adapterExecutor = checkNotNull(adapterExecutor);
    }
```

否则使用默认的线程池：

```java
    private static final ThreadFactory threadFactory =
        new ThreadFactoryBuilder()
            .setDaemon(true)
            .setNameFormat("ListenableFutureAdapter-thread-%d")
            .build();
    private static final Executor defaultAdapterExecutor =
        Executors.newCachedThreadPool(threadFactory);
```

所以现在知道Guava认为这种转换方式heavyweight的原因了：ListenableFutureAdapter内部是用了一个新的线程池，每当有新的回调注册到ListenableFutureAdapter上的时候，这个线程池都要提交一个新的任务：监视Future是否完成、完成则发起回调流程（由注册每个回调时指定的线程池实际执行回调任务）。

# 链式调用ListenableFuture
ListenableFuture由于可以注册listener，可以做到JDK的Future不能做到的行为：

+ 一个ListenableFuture结束后，触发另一些回调行为；
+ 一堆ListenableFuture结束后，触发一个ListenableFuture的执行；

## 把ListenableFuture作为回调，构成链式调用的ListenableFuture
之所以能这么做，因为ListenableFuture的某些实现（比如ListenableFutureTask）本身可能就是一个实现了Runnable的类，所以可以把ListenableFuture当做回调注册到另一个ListenableFuture上：

```java
        // run task
        ListenableFuture<String> hello = service.submit(
                () -> {
                    Thread.sleep(1 * 1000);
                    System.out.println("Task: I say hello");
                    return "Hello";
                });

        // Task
        ListenableFutureTask<String> world = ListenableFutureTask.create(
                () -> {
                    Thread.sleep(1 * 1000);
                    System.out.println("ListenableFuture as a callback: I say world");
                    return "World";
                });

        hello.addListener(world, service);
```

## 给ListenableFuture的结果添加动作，修改其结果 - `Futures.transform(ListenableFuture, Function, Executor)`/`Futures.transformAsync(Listenable, AsyncFunction, Executor)`
上面的情况只是在ListenableFuture结束后触发回调，但是回调并不能改变原始ListenableFuture的值。想想如果要改变原来的值，返回一个新的值，应该怎么做？

很显然，要在初始结果上执行动作，必须先获取初始结果，再用动作改变初始结果（或返回新的值）。

ListenableFuture触发callback这一要求，使得它的实现只需要override done()方法，调用一下callback就可以了。done()方法标志了task的结束，但是done方法并没有将task的结果作为传进来。不过这也好办：override done()，并get到task的结果，再使用动作修改该结果就行了。

Futures提供的transForm/transFormAsync正是一种简便的方式。其实它的底层就是返回一个新的ListenableFuture实现，该实现在任务完成后获取future结果，并执行响应同步/异步动作。

下面的例子，原始ListenableFuture返回了Hello，同步动作拼接一个World，返回一个新的ListenableFuture。异步动作再在新返回的ListenableFuture上添加一个新动作：拼接感叹号。

```java
        // exiting thread pool
        ListeningExecutorService service = MoreExecutors.listeningDecorator(
                MoreExecutors.getExitingExecutorService(
                        (ThreadPoolExecutor) Executors.newFixedThreadPool(10),
                        10, TimeUnit.SECONDS
                )
        );

        // run task
        ListenableFuture<String> hello = service.submit(
                () -> {
                    Thread.sleep(1 * 1000);
                    System.out.println("Task: I say hello");
                    return "Hello";
                });

        ListenableFuture<String> helloWorld = Futures.transform(hello, new Function<String, String>() {
            @Nullable
            @Override
            public String apply(@Nullable String input) {
                return input + "World";
            }
        }, service);

        AsyncFunction<String, String> f = input -> Futures.immediateFuture(input + "!!!!!");

        ListenableFuture<String> helloWorld2 = Futures.transformAsync(helloWorld, f, service);


        // add callback for this task
        Futures.addCallback(
                // this task
                helloWorld2,
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
```

当然，这个AsyncFunction实现的并没有异步的味道，换成下面的实现也许更合适：

```java
        AsyncFunction<String, String> f = input -> service.submit(
                () -> {
                    Thread.sleep(1 * 1000);
                    return input + "!!!!!";
                });
```

## 在一系列ListenableFuture完成后，触发新的ListenableFuture，使用他们的结果
适用场景：**在一堆异步动作全部完成后，再执行某一动作。**

创建了三个异步ListenableFuture，拼接起来为新的ListenableFuture（返回值为三个ListenableFuture的返回值组成的List，按序）。最后给这个汇总的ListenableFuture注册个callback，输出这个list join起来的值：

```java
        // exiting thread pool
        ListeningExecutorService service = MoreExecutors.listeningDecorator(
                MoreExecutors.getExitingExecutorService(
                        (ThreadPoolExecutor) Executors.newFixedThreadPool(10),
                        10, TimeUnit.SECONDS
                )
        );

        ListenableFuture<String> hello = Futures.immediateFuture("Hello");
        // ListenableFutureTask.create创建出来的ListenableFuture必须想办法调用.....要不然不会执行啊
        // 不能跟人家immediate future比，人家又不需要执行......
        ListenableFutureTask<String> world = ListenableFutureTask.create(() -> "World");
        hello.addListener(world, service);

        ListenableFuture<String> symbol = service.submit(() -> {
            Thread.sleep(1000);
            return "!!!!!";
        });

        ListenableFuture<List<String>> allResults = Futures.allAsList(hello, world, symbol);

        // add callback for this task
        Futures.addCallback(
                // this task
                allResults,
                // callback for this task
                new FutureCallback<List<String>>() {
                    @Override
                    public void onSuccess(List<String> results) {
                        System.out.println("Use callback to collect the result: " + String.join("-", results));
                    }
                    @Override
                    public void onFailure(Throwable thrown) {
                        System.out.println(thrown.getMessage()); // escaped the explosion!
                    }
                },
                // use this pool to run callback
                service);

        // main thread wait at least 3s to exit
        // mainly to wait callback to be added into exiting thread pool
        Thread.currentThread().join(3000);
    }
```

# Futures
差不过也把Futures工具类里的方法说完了，再全面总结一下吧。

注册回调：

+ addCallback：方便地注册callback到ListenableFuture上的方法，可以注册个FutureCallback，而不是一个简单的Runnable；

汇总（异步）执行结果：

+ allAsList：汇总ListenableFuture们的执行结果；
+ successfulAsList

快速生成demoListenableFuture：

+ immediateCancelledFuture/immediateFailedFuture/immediateFuture：目前觉得这些是适合写demo时生成ListenableFuture的好方式；

转换ListenableFuture的结果（链式增加执行动作）：

+ transform
+ transFormAsync

其他的需要用或者用到了再说吧。

# 总结
回过头再看，轻舟已过万重山~

# 参阅
+ [https://github.com/google/guava/wiki/ListenableFutureExplained](https://github.com/google/guava/wiki/ListenableFutureExplained)

