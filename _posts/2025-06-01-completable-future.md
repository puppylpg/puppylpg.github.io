---

layout: post  
title: "CompletableFuture"
date: 2025-06-01 00:56:03 +0800  
categories: Java Executor  
tags: Java Executor

---

jdk的CompletableFuture和guava的ListenableFuture，在功能上基本是一致的。都允许对一个任务添加回调。但是二者的风格不同：
1. ListenableFuture是**回调注册风格**：通过addListener()或addCallback()注册回调函数，更接近传统的事件监听模式；
2. CompletableFuture是**函数式风格**：通过thenApply()、thenAccept()、thenCompose()等方法链式组合异步操作，类似 Stream API。

相比起来，回调风格的实现更容易理解，函数式风格相对难理解一些，但是写出来的代码更简洁，用起来也更方便。所以可以先类比ListenableFuture去理解CompletableFuture，而后再关注后者的内部实现。

1. Table of Contents, ordered
   {:toc}

# 先从逻辑上理解`CompletableFuture`
直接看一个例子：
```java
CompletableFuture<Void> future = CompletableFuture.supplyAsync(() -> "Hello")
    .thenApply(s -> s + " World")
    .thenAccept(System.out::println);
```
执行流程：
1. supplyAsync() 创建第一个 Future（f1），提交任务到线程池。
2. thenApply() 创建第二个 Future（f2），并注册回调 s -> s + " World" 到 f1 的链表。
3. thenAccept() 创建第三个 Future（f3），并注册回调 System.out::println 到 f2 的链表。
4. 当 f1 的任务完成时：
    5. f1 调用 postComplete() 遍历链表，触发 f2 的回调。
    6. 回调执行 s + " World"，并通过 completeValue() 完成 f2。
1. f2 完成后，调用自身的 postComplete()，触发 f3 的回调。
2. f3 的回调执行 System.out::println，完成整个链。

所以变量`future`其实是f3，而非f1。

逻辑上来讲，**supplyAsync只不过是一种快速submit异步任务的方式，和显式用一个线程池submit没什么区别。尤其是当看到还有一个supplyAsync方法支持显式传一个线程池的时候。**

**thenApply等方法不过是一种快速创建ListenableFuture的方式。cf完成之后要触发这些listener的调用，如果listen被注册为同步执行方式，整个cf的结束时间可能要大于本身任务的时间。**

# 再看`CompletableFuture`的内部实现
## 数据结构
和Future一样，CompletableFuture内部有一个结果变量 (Object result)，用来存储计算结果或异常（Throwable）。 若正常完成，result 为实际返回值；若异常完成，result 为抛出的异常。

更重要的是它还有一个Completion 链表（相当于ListenableFuture注册回调的list），每个 CompletableFuture 维护一个链表，存储待执行的回调（Completion 节点）。
当 Future 完成时，会触发链表中所有回调的执行。

## 回调注册
以thenApply为例，先通过javadoc查看它的作用：
**返回一个新的cf。当前一个cf结束时，它的result作为fn的参数，fn的执行结果就是这个新的cf的结果**
```java
    /**
     * Returns a new CompletionStage that, when this stage completes
     * normally, is executed with this stage's result as the argument
     * to the supplied function.
     *
     * <p>This method is analogous to
     * {@link java.util.Optional#map Optional.map} and
     * {@link java.util.stream.Stream#map Stream.map}.
     *
     * <p>See the {@link CompletionStage} documentation for rules
     * covering exceptional completion.
     *
     * @param fn the function to use to compute the value of the
     * returned CompletionStage
     * @param <U> the function's return type
     * @return the new CompletionStage
     */
    public <U> CompletionStage<U> thenApply(Function<? super T,? extends U> fn);
```

> 强烈建议多看CompletableFuture的javadoc，里面有很多很重要的信息。

同理还有`thenApplyAsync`，只是多了一个线程池参数（如果不传，就用默认线程池fork join pool）：
```java
public <U> CompletionStage<U> thenApplyAsync(Function<? super T,? extends U> fn);
public <U> CompletionStage<U> thenApplyAsync(Function<? super T,? extends U> fn, Executor executor);
```

再来看thenApply的实现：
```java
    public <U> CompletableFuture<U> thenApply(
        Function<? super T,? extends U> fn) {
        
        // 同步的apply，不使用额外线程池执行fn，直接由执行任务的当前线程执行
        return uniApplyStage(null, fn);
    }

    private <V> CompletableFuture<V> uniApplyStage(
        Executor e, Function<? super T,? extends V> f) {
        if (f == null) throw new NullPointerException();
        Object r;
        
        // 如果当前cf已经完成，直接执行fn，也不用注册回调了
        if ((r = result) != null)
            return uniApplyNow(r, e, f);
            
        // 否则，创建一个新的cf，用于返回。fn和新的cf则会注册到当前cf的链表上
        CompletableFuture<V> d = newIncompleteFuture();
        unipush(new UniApply<T,V>(e, d, this, f));
        return d;
    }
```

## 回调触发
有很多方法可以创建cf，但是无论哪一种，在它执行完毕之后，都会调用postComplete()方法。这个方法负责触发所有注册的回调：
```java
    /**
     * Pops and tries to trigger all reachable dependents.  Call only
     * when known to be done.
     */
    final void postComplete() {
        /*
         * On each step, variable f holds current dependents to pop
         * and run.  It is extended along only one path at a time,
         * pushing others to avoid unbounded recursion.
         */
        CompletableFuture<?> f = this; Completion h;
        while ((h = f.stack) != null ||
               (f != this && (h = (f = this).stack) != null)) {
            CompletableFuture<?> d; Completion t;
            if (STACK.compareAndSet(f, h, t = h.next)) {
                if (t != null) {
                    if (f != this) {
                        pushStack(h);
                        continue;
                    }
                    NEXT.compareAndSet(h, t, null); // try to detach
                }
                
                // 触发回调
                f = (d = h.tryFire(NESTED)) == null ? this : d;
            }
        }
    }
```
`tryFire()`是每一种Completion的任务执行方法，不同的Completion有不同的实现，但是每一种在执行的最后都有类似`d.postComplete()`的操作（d是当前Completion的下一个Completion），**也就是说，上一个任务完成后，会触发下一个任务的所有回调**。

# 创建`CompletableFuture`
## **1. 创建已完成的 CompletableFuture**
### **`completedFuture(value)`**
- **作用**：创建一个已完成的 `CompletableFuture`，直接返回指定值。
- **示例**：
  ```java
  CompletableFuture<String> future = CompletableFuture.completedFuture("Hello");
  // future.get() 立即返回 "Hello"
  ```


## **2. 创建异步任务**
### **无返回值的异步任务**
- **`runAsync(Runnable runnable)`**  
  使用 `ForkJoinPool.commonPool()` 执行任务：
  ```java
  CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
      System.out.println("异步任务执行中");
  });
  ```

- **`runAsync(Runnable runnable, Executor executor)`**  
  使用自定义线程池执行任务：
  ```java
  ExecutorService executor = Executors.newSingleThreadExecutor();
  CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
      // 自定义线程池执行的任务
  }, executor);
  ```

### **有返回值的异步任务**
- **`supplyAsync(Supplier<U> supplier)`**  
  使用公共线程池执行带返回值的任务：
  ```java
  CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
      return "计算结果";
  });
  ```

- **`supplyAsync(Supplier<U> supplier, Executor executor)`**  
  使用自定义线程池执行带返回值的任务：
  ```java
  ExecutorService executor = Executors.newFixedThreadPool(4);
  CompletableFuture<Integer> future = CompletableFuture.supplyAsync(() -> {
      return 42;
  }, executor);
  ```


## **3. 组合多个 CompletableFuture**
### **合并两个 Future 的结果**
- **`thenCombine(CompletionStage<? extends U> other, BiFunction<? super T,? super U,? extends V> fn)`**  
  等待两个 Future 都完成后，将结果合并：
  ```java
  CompletableFuture<Integer> future1 = CompletableFuture.supplyAsync(() -> 10);
  CompletableFuture<Integer> future2 = CompletableFuture.supplyAsync(() -> 20);
  
  CompletableFuture<Integer> combined = future1.thenCombine(future2, (a, b) -> a + b);
  // combined.get() 返回 30
  ```

### **任意一个 Future 完成时执行**
- **`acceptEither(CompletionStage<? extends T> other, Consumer<? super T> action)`**  
  当两个 Future 中任意一个完成时，执行指定操作：
  ```java
  CompletableFuture<String> future1 = CompletableFuture.supplyAsync(() -> "结果1");
  CompletableFuture<String> future2 = CompletableFuture.supplyAsync(() -> "结果2");
  
  future1.acceptEither(future2, result -> System.out.println("接收到: " + result));
  ```


## **4. 异常处理与默认值**
### **处理异常并返回默认值**
- **`exceptionally(Function<Throwable, ? extends T> fn)`**  
  当 Future 异常完成时，返回默认值：
  ```java
  CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
      throw new RuntimeException("模拟异常");
  }).exceptionally(ex -> "默认值");
  
  // future.get() 返回 "默认值"
  ```

### **无论是否异常都执行操作**
- **`whenComplete(BiConsumer<? super T, ? super Throwable> action)`**  
  当 Future 完成（正常或异常）时，执行回调：
  ```java
  CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> "结果");
  
  future.whenComplete((result, ex) -> {
      if (ex != null) {
          System.out.println("异常: " + ex);
      } else {
          System.out.println("结果: " + result);
      }
  });
  ```


## **5. 多任务并行与聚合**
### **等待所有 Future 完成**
- **`allOf(CompletableFuture<?>... cfs)`**  
  等待所有 Future 完成（无返回值）：
  ```java
  CompletableFuture<Void> allFutures = CompletableFuture.allOf(
      CompletableFuture.runAsync(() -> System.out.println("任务1")),
      CompletableFuture.runAsync(() -> System.out.println("任务2"))
  );
  
  allFutures.join(); // 等待所有任务完成
  ```

### **任意一个 Future 完成即返回**
- **`anyOf(CompletableFuture<?>... cfs)`**  
  只要有一个 Future 完成，就返回该 Future 的结果：
  ```java
  CompletableFuture<String> future1 = CompletableFuture.supplyAsync(() -> {
      Thread.sleep(1000);
      return "结果1";
  });
  
  CompletableFuture<String> future2 = CompletableFuture.supplyAsync(() -> {
      Thread.sleep(500);
      return "结果2";
  });
  
  CompletableFuture<Object> any = CompletableFuture.anyOf(future1, future2);
  // any.get() 返回 "结果2"（因为 future2 更快完成）
  ```


## **6. 手动控制完成状态**
### **创建空的 CompletableFuture 并手动完成**
- **构造函数 `new CompletableFuture()`**  
  创建一个未完成的 Future，手动控制其完成：
  ```java
  CompletableFuture<String> future = new CompletableFuture<>();
  
  // 另一个线程中完成该 Future
  new Thread(() -> {
      try {
          Thread.sleep(1000);
          future.complete("手动完成");
      } catch (InterruptedException e) {
          future.completeExceptionally(e);
      }
  }).start();
  
  // future.get() 将阻塞直到手动完成
  ```


## **总结：创建方法对比表**
| 方法                          | 返回值类型         | 异步执行 | 适用场景                          |
|-------------------------------|--------------------|----------|-----------------------------------|
| `completedFuture(value)`      | `CompletableFuture<T>` | 否       | 直接返回预计算的值                |
| `runAsync(runnable)`          | `CompletableFuture<Void>` | 是       | 无返回值的异步任务                |
| `supplyAsync(supplier)`       | `CompletableFuture<T>` | 是       | 有返回值的异步任务                |
| `thenCombine(future, function)` | `CompletableFuture<V>` | 否       | 合并两个 Future 的结果            |
| `exceptionally(function)`     | `CompletableFuture<T>` | 否       | 处理异常并返回默认值              |
| `allOf(futures)`              | `CompletableFuture<Void>` | 否       | 等待所有 Future 完成              |
| `anyOf(futures)`              | `CompletableFuture<Object>` | 否      | 任意一个 Future 完成即返回        |
| `new CompletableFuture()`     | `CompletableFuture<T>` | 否       | 手动控制 Future 的完成状态        |

还有两个比较有用的方法
- 返回一个cf，当最快的那个cf结束（正常/异常）时，它结束，且结果和那个cf一致：`anyOf`
  > Returns a new CompletableFuture that is completed when any of the given CompletableFutures complete, with the same result. Otherwise, if it completed exceptionally, the returned CompletableFuture also does so, with a CompletionException holding this exception as its cause. If no CompletableFutures are provided, returns an incomplete CompletableFuture.
- 返回一个cf，当所有cf结束时，它就结束：`allOf`
  > Returns a new CompletableFuture that is completed when all of the given CompletableFutures complete. If any of the given CompletableFutures complete exceptionally, then the returned CompletableFuture also does so, with a CompletionException holding this exception as its cause. Otherwise, the results, if any, of the given CompletableFutures are not reflected in the returned CompletableFuture, but may be obtained by inspecting them individually. If no CompletableFutures are provided, returns a CompletableFuture completed with the value null.
  >
  > Among the applications of this method is to await completion of a set of independent CompletableFutures before continuing a program, as in: CompletableFuture.allOf(c1, c2, c3).join();.

不过allOf返回的是`CompletableFuture<Void>`，所以通过这个cf只能知道任务结束了，具体每一个任务是什么值，还得通过原有的cf获取。

## 处理异常
相比ListenableFuture的回调编程，异常处理更能体现CompletableFuture函数流式编程的特点。

### `exceptionally(Function<Throwable, ? extends T> fn)`
> Returns a new CompletionStage that, when this stage completes exceptionally, is executed with this stage's exception as the argument to the supplied function.（相当于一个专门处理异常的thenApply） **Otherwise, if this stage completes normally, then the returned stage also completes normally with the same value.**

比如：
```java
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    if (Math.random() < 0.5) {
        throw new RuntimeException("模拟异常");
    }
    return "正常结果";
}).thenApply(xxx)
}).thenApply(xxx)
}).thenAccept(xxx)
...
}).exceptionally(ex -> {
    System.out.println("处理异常: " + ex.getMessage());
    return "默认值"; // 异常时返回的默认值
});

// future.get() 可能返回 "正常结果" 或 "默认值"
```
**若链中的某个阶段抛出异常且未被处理，异常会传播到后续所有阶段，直到遇到 exceptionally、handle 或被 get() 捕获**。
也就是说，**cf如果出现异常，后面的thenApply、thenAccept等回调函数都不会触发function/supplier/consumer等的执行，而是直接返回一个outcome为exception的cf。因此，无论中间哪一个cf产生异常，异常都会被一直传递下去**。

通过看比如thenApply的实现可以看到这一点：**出异常时fn不会被调用**
```java
    @SuppressWarnings("serial")
    static final class UniApply<T,V> extends UniCompletion<T,V> {
        Function<? super T,? extends V> fn;
        UniApply(Executor executor, CompletableFuture<V> dep,
                 CompletableFuture<T> src,
                 Function<? super T,? extends V> fn) {
            super(executor, dep, src); this.fn = fn;
        }
        final CompletableFuture<V> tryFire(int mode) {
            CompletableFuture<V> d; CompletableFuture<T> a;
            Object r; Throwable x; Function<? super T,? extends V> f;
            if ((a = src) == null || (r = a.result) == null
                || (d = dep) == null || (f = fn) == null)
                return null;
            tryComplete: if (d.result == null) {
            
                // 如果r是exception，直接返回一个exception的cf
                if (r instanceof AltResult) {
                    if ((x = ((AltResult)r).ex) != null) {
                        d.completeThrowable(x, r);
                        break tryComplete;
                    }
                    r = null;
                }
                try {
                    if (mode <= 0 && !claim())
                        return null;
                    else {
                    
                        // 只有非异常时，参会执行fn，返回一个新的cf
                        @SuppressWarnings("unchecked") T t = (T) r;
                        d.completeValue(f.apply(t));
                    }
                } catch (Throwable ex) {
                    d.completeThrowable(ex);
                }
            }
            src = null; dep = null; fn = null;
            return d.postFire(a, mode);
        }
    }
```

**因此在执行过程中抛出的异常，一定会被最后的exceptionally捕获**，我们可以通过exceptionally处理异常，返回一个默认值。**这样，异常处理就被集中到exceptionally中，而不是分散在各个回调函数中。**

### `handle(BiFunction<? super T, Throwable, ? extends U> fn)`
```java
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    if (Math.random() < 0.5) {
        throw new RuntimeException("模拟异常");
    }
    return "正常结果";
}).handle((result, ex) -> {
    if (ex != null) {
        System.out.println("处理异常: " + ex.getMessage());
        return "默认值";
    } else {
        return result.toUpperCase(); // 正常结果转换为大写
    }
});
```
相当于ListenableFuture的FutureCallback，通过onSuccess和onFailure分别处理成功/失败。

### `whenComplete(BiConsumer<? super T, ? super Throwable> action)`
```java
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    return "正常结果";
}).whenComplete((result, ex) -> {
    if (ex != null) {
        System.out.println("异常: " + ex.getMessage());
    } else {
        System.out.println("结果: " + result);
    }
});
```
和`handle`的区别在于，`whenComplete`的action是一个`BiConsumer`，而`handle`的action是一个`BiFunction`。所以`whenComplete`仅用于副作用（如日志记录），不影响最终结果；而`handle`则可以为cf return一个新的结果。

# 感想
越学越明白……

# 参阅
- https://www.baeldung.com/java-completablefuture
