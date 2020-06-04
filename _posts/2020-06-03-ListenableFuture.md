---
layout: post
title: "ListenableFuture"
date: 2020-06-03 02:30:06 +0800
categories: Java Guava Future ListenableFuture async
tags: Java Guava Future ListenableFuture async
---

ListenableFuture是Guava里拓展了Future的接口，增加了回调行为。所以要比Future更强大。Guava建议使用ListenableFuture取代Future。而且，看ListenableFuture的实现过程，也能让人获益良多。

1. Table of Contents, ordered
{:toc}

# 约定
## Future &. ExecutorService
JDK里的Future在[ListenableFutureExplained](https://github.com/google/guava/wiki/ListenableFutureExplained)里有一段非常好的介绍：
> A traditional Future represents the result of an asynchronous computation: a computation that may or may not have finished producing a result yet. A Future can be a handle to an in-progress computation, a promise from a service to supply us with a result.

Future是一个约定：一个放置任务结果的地方。在任务结束后，任务的执行结果会放在Future里，供可访问Future的线程获取任务结果。

Future定下的这个约定在Future的实现类（RunnableFuture的实现类）FutureTask里达成的：**FutureTask的run方法封装了任务的run/call方法！** 当任务执行结束时（无论成功还是异常），其结果或异常都会被set到FutureTask的Object outcome里。当对该Future调用get方法时，get的就是这个outcome。**这就是为什么FutureTask一定是一个Runnable子类，它必须能异步执行任务，该任务会先搞定原有task，再做一些后处理（set结果到某个地方等）。**

> 所以当我们异步执行任务时，执行的并不是原有的Runnable/Callable，而是FutureTask的run，这个run是异步执行的，并且会去调用Runnable/Callable task的任务执行方法。

最终执行FutureTask的执行者是ExecutorService。ExecutorService的submit方法提交一个Runnable/Callable任务（**FutureTask的run任务**），由于FutureTask的run任务会将原有task的结果放入outcome，该契约达成。

## ListenableFuture &. ListeningExecutorService
Guava里的ListeableFuture拓展了JDK中的Future，新增了一个方法：
```
void addListener(Runnable listener, Executor executor);
```
可以给Future注册一些回调函数。这里ListenableFuture也做出了一个约定：当任务执行完毕时，会调用回调函数。

类比Future的实现类FutureTask，ListenableFuture执行完Runnable/Callable task会调用回调这一约定，也是在ListenableFuture的实现类的run()方法里搞定的。（不过Guava实现的比较复杂，使用了多个类，但大意就是这样）

返回ListenableFuture这种事情，JDK里的ExecutorService肯定做不到（因为ExecutorService根本不知道有ListenableFuture这个东西）。所以Guava还定义了返回ListenableFuture的执行者：ListeningExecutorService。

ListeningExecutorService拓展了ExecutorService接口，新增了返回ListenableFuture的submit方法。

# 兑现
想兑现约定需要两步：
1. 对于ListeningExecutorService：返回ListenableFuture；
2. 对于ListenableFuture：调用注册在自己里面的回调；

## 返回ListenableFuture
其实ListeningExecutorService和ExecutorService基本上差不太多，主要是要实现一个返回ListenableFuture的submit方法。所以在实际实现上，Guava里的ListeningExecutorService的实现类继承了JDK里的ExecutorService的实现类，只是override了某些方法。

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

## ListenableFuture执行回调
这个其实比较简单，回调注册到ListenableFuture之后，一般会放在一个list里，需要调用回调的时候，遍历并执行这个list就好。

问题在于什么时候需要回调？Runnable/Callable任务完成（成功或者抛出异常）之后。**和FutureTask的run类似（执行原有task任务，set结果到outcome），ListenableFuture在此基础上多做了一步：执行回调**：
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

其实还有一种更简单的方式：ListenableFuture不就是比RunnableFuture多了一个调用回调嘛，在RunnableFuture的实现类FutureTask的run里，它执行了任务，设置了结果，并调用了done()方法（当然done方法对于FutureTask来说啥也没干，是空的），Guava也搞了个`ListenableFutureTask extends FutureTask`，除了实现addListener接口（把callback放入list），还override了done()方法（调用回调）。简简单单就搞定了。（但是为啥通过MoreExecutors.listeningDecorator获取的ListeningExecutorService返回的是另一个ListenableFuture的实现，而不是简简单单的ListenableFutureTask，我也不知道。可能另一种实现更健壮吧）

仔细想想，**将回调放在原有的Runnable/Callable任务之后一起执行，又引入了一个新问题**：如果回调执行时间过长怎么办？岂不是相当于延长了任务执行时间，导致任务迟迟不能返回（Future.isDone()）？

所以在complete函数的实现里，**执行这些回调是通过（指定的）Executor异步完成的**。这样就不耽误执行任务的线程结束，及时返回任务执行结果。至于这个Executor是谁，看ListenableFuture的`addListener(Runnable, Executor)`方法，是可以给这些回调任务指定Executor的。

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

# 创建ListenableFuture
## ListenableFutureTask
上面提到了这是继承了JDK FutureTask的ListenableFuture的实现类。该类提供了创建它的方法工具类方法：
```
  public static <V> ListenableFutureTask<V> create(Callable<V> callable) {
    return new ListenableFutureTask<V>(callable);
  }

  public static <V> ListenableFutureTask<V> create(Runnable runnable, @Nullable V result) {
    return new ListenableFutureTask<V>(runnable, result);
  }
```
同样，该类的构造函数不是public的，Guava不让直接new。

> 但是这样新建的ListenableFuture得想办法执行啊，要不然直接调用get是会block的。不执行怎么会有结果……

## Futures.immediateFuture(V)
直接返回一个ListenableFuture。感觉写Demo的时候用这个生成ListenableFuture会比较方便。

该方法实际上一个ImmediateSuccessfulFuture。**它只实现了ListenableFuture接口，没有实现RunnableFuture或者实现Runnable接口，因为它不需要发起一个异步任务，去异步完成task并设置value。**

所以它的实现很简单：
- get方法直接return创建时指定的value就行了（再次印证：**不需要执行任务，所以不需要实现Runnable接口**）；
- addListener：在listener add进来的时候直接执行就行了。因为没有task要执行，所以task肯定是已完成状态。

# Future转ListenableFuture
Guava建议从源码层面，修改旧的返回Future的代码，让它返回ListenableFuture。但是如果万不得已，不能修改原来的代码，又想将一个返回Future的API返回的Future转成ListenableFuture，Guava还提供了一个重量级转换方式：
```
JdkFutureAdapters.listenInPoolThread(Future)
```
它实际上将Future转成了另一个ListenableFuture的实现类：ListenableFutureAdapter。

看名字就知道，它是一个封装了Future的Wrapper，所有有关Future的方法都交给了底层的Future处理。自己只实现了ListenableFuture接口中新增的addListener方法。

那么问题来了：之前的ListenableFuture的实现类除了要实现addListener接口之外，还要做一件事：override done()方法，这样任务完成时，就能执行回调接口了。ListenableFutureAdapter既然把方法原封不动委托给了底层的Future，自然并没有新增的调用回调这一步骤。那回调是什么时候被调用的？

看它的addListener的实现：
```
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
- 如果添加listener的时候任务已完成，执行所有的回调；
- 如果添加listener的时候任务还没完成，使用一个新的线程池，发起一个异步任务，专门等future完成，如果future完成，再发起执行所有的listener的流程（但是这个线程池不执行listener。实际listener由哪个线程池来执行，取决于注册listener的时候，指定让哪个线程池来执行该listener）：
```
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
```
    ListenableFutureAdapter(Future<V> delegate, Executor adapterExecutor) {
      this.delegate = checkNotNull(delegate);
      this.adapterExecutor = checkNotNull(adapterExecutor);
    }
```
否则使用默认的线程池：
```
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
- 一个ListenableFuture结束后，触发另一些回调行为；
- 一堆ListenableFuture结束后，触发一个ListenableFuture的执行；

## 把ListenableFuture作为回调，构成链式调用的ListenableFuture
之所以能这么做，因为ListenableFuture的某些实现（比如ListenableFutureTask）本身可能就是一个实现了Runnable的类，所以可以把ListenableFuture当做回调注册到另一个ListenableFuture上：
```
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
```
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
```
        AsyncFunction<String, String> f = input -> service.submit(
                () -> {
                    Thread.sleep(1 * 1000);
                    return input + "!!!!!";
                });
```

## 在一系列ListenableFuture完成后，触发新的ListenableFuture，使用他们的结果
适用场景：**在一堆异步动作全部完成后，再执行某一动作。**

创建了三个异步ListenableFuture，拼接起来为新的ListenableFuture（返回值为三个ListenableFuture的返回值组成的List，按序）。最后给这个汇总的ListenableFuture注册个callback，输出这个list join起来的值：
```
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
- addCallback：方便地注册callback到ListenableFuture上的方法，可以注册个FutureCallback，而不是一个简单的Runnable；

汇总（异步）执行结果：
- allAsList：汇总ListenableFuture们的执行结果；
- successfulAsList

快速生成demoListenableFuture：
- immediateCancelledFuture/immediateFailedFuture/immediateFuture：目前觉得这些是适合写demo时生成ListenableFuture的好方式；

转换ListenableFuture的结果（链式增加执行动作）：
- transform
- transFormAsync

其他的需要用或者用到了再说吧。

# 总结
通过对ListenableFuture的学习和对源码的阅读，感觉异步这一块儿变得相当通透了！Guava牛逼（破音）~

# 参阅
- https://github.com/google/guava/wiki/ListenableFutureExplained

