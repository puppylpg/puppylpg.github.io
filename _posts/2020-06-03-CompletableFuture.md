---
layout: post
title: "CompletableFuture"
date: 2020-06-05 01:11:55 +0800
categories: Java Future ListenableFuture CompletableFuture async
tags: Java Future ListenableFuture CompletableFuture async
---

没想到在了解并大致看了Guava提供的[ListenableFuture]({% post_url 2020-06-03-ListenableFuture %})的源码实现后，再看JDK的CompletableFuture，竟然如此简单与清晰。实际上二者做的事情、实现思路差不太多。果然还是那个道理：越强的人学东西越快，速度大的人往往加速度还大，越有钱的人越容易赚钱……气不气……

1. Table of Contents, ordered
{:toc}

# 思路
CompletableFuture首先是个Future。Future就是一个约定：异步线程打算在执行完后，把结果放到Future里。任务发起者可以通过Future.get在想要的时候获取结果，如果还没有结果，可以一直等，也可以选择最多等待时间。

CompletableFuture比Future多了一些链式动作。而链式动作的调用方式直接按照ListenableFuture的callback调用的方式去理解就行了……虽然二者实现上还是有些区别，反正效果都一样的。

和ListenableFuture相同的是，这些追加动作可以是同步调用也可以是异步调用。如果是异步，可以用自己指定的Executor执行，也可以用默认的Executor执行。如果是多核，就是异步Executor。否则是那个智障同步Executor：
```
    static final class ThreadPerTaskExecutor implements Executor {
        public void execute(Runnable r) { new Thread(r).start(); }
    }
```

# 具体方法
```
        CompletableFuture<String> hello = CompletableFuture.supplyAsync(() -> "Hello");
        CompletableFuture<String> world = CompletableFuture.completedFuture("World");
        CompletableFuture<String> helloWorld1 = hello.thenApplyAsync(old -> old + "World");
        CompletableFuture<String> helloWorld2 = hello.thenComposeAsync(old -> CompletableFuture.supplyAsync(() -> old + "World"));
        CompletableFuture<String> helloWorld3 = hello.thenCombineAsync(world, (old, newValue) -> old + newValue);

        helloWorld1.thenAccept(value -> System.out.println("HelloWorld1 then accept: " + value));
        helloWorld2.thenAcceptAsync(value -> System.out.println("HelloWorld2 then accept async: " + value));
        helloWorld3.thenAcceptAsync(value -> System.out.println("HelloWorld3 then accept async: " + value))
                .thenRunAsync(() -> System.out.println("HelloWorld3 then run async"));

        // ???
        CompletableFuture<Void> allResult = CompletableFuture.allOf(hello, world);
        // null
        System.out.println(allResult.get());
        CompletableFuture<Object> anyResult = CompletableFuture.anyOf(hello, world);
        System.out.println(anyResult.get());

        CompletableFuture<String> handleResult = hello.handle((value, exception) -> value == null ? exception.getMessage() : value);
        System.out.println(handleResult.get());
```
上面一个例子基本涵盖所有主要方法了。

总结起来大致如下：
## 创建
- supplyAsync(Supplier)

创建基本上是用supplyAsync，提供一个Supplier就行了（其实跟Callable没啥区别……其实俩接口的作用几乎一模一样）。只有supplyAsync，不存在supply不带async的方法，因为一个同步方法有毛好用Future的……

## 链式
### 追加动作
- thenApply(Function)
- thenAccept(Consumer)
- thenRun(Runnable)

这三个函数直接对原有CompletableFuture的返回值追加了一个动作。apply是使用一个Function改变结果；accept是consume结果；run其实没有搭理结果，它没有入参，所以也没有用到之前CompletableFuture的value。

这三个函数还有Async的版本，代表异步追加动作。

### 结合
- thenCompose(Function)
- thenCombine(CompletableFuture, BiFunction)

compose和apply的区别在于，传入的Function return的是一个CompletableFuture，即**把上一个CompletableFuture的值追加动作，并包装成了一个CompletableFuture**。不过thenCompose最终返回的还是CompletableFuture，和thenApply没区别。

**所以二者就是使用场合不同：有了这两种方法，不关你的追加动作是value to value，还是value to CompletableFuture，都可以用来生成CompletableFuture。跟map和flatMap一个意思。**

thenCombine是为了结合两个CompletableFuture的值，所以需要传入另一个CompletableFuture和一个BiFunction。

### 聚合
- allOf
- anyOf

这个allOf很迷幻，不像Guava的Futures.allAsList返回`ListenableFuture<List<V>>`，**CompletableFuture.allOf返回的是`CompletableFuture<Void>`**，也就是说，这个方法成功了，只代表所有传入allOf的CompletableFuture都执行成功了，但是结果还得自己去一一手动获取。这就很迷幻……

具体可以参考这个答案，自行merge结果：https://stackoverflow.com/questions/35809827/java-8-completablefuture-allof-with-collection-or-list

anyOf倒是挺正常的，返回`CompletableFuture<Object>`，哪个CompletableFuture先返回，就返回那个CompletableFuture的结果。

## 处理异常
- handle(BiFunction)

可以在CompletableFuture后面拼接handle处理异常。BiFunction的两个入参分别是上一个CompletableFuture的结果和异常。可以自行检查到底是有结果还是有异常，并返回最终的处理结果。比如上面的示例：
```
CompletableFuture<String> handleResult = hello.handle((value, exception) -> value == null ? exception.getMessage() : value);
System.out.println(handleResult.get());
```

个人感觉这点不如ListenableFuture注册一个FutureCallback，通过onSuccess和onFailure分别处理成功失败清晰易懂。

## 其他
CompletableFuture还提供了其他的方法：
- completedFuture(Value)：和Guava的Futures.immediateFuture异曲同工；
- complete(Value)：这个就比较迷幻了。感觉这个应该是一个内部方法，不应该暴露出来的。（实际上CompletableStage接口就没有定义这个方法）

complete的一种使用方式：
```
    CompletableFuture<String> completableFuture 
      = new CompletableFuture<>();
 
    Executors.newCachedThreadPool().submit(() -> {
        Thread.sleep(500);
        completableFuture.complete("Hello");
        return null;
    });
```
异步线程处理完任务之后把结果放到Future里。但是暴露出来是几个意思……**complete(Value)的作用应该和FutureTask extends RunnableFuture里面的内部方法set(Value)一样**。任务执行完异步线程自行set一下不就行了……

[Listenablefuture vs. Completablefuture](https://stackoverflow.com/questions/38744943/listenablefuture-vs-completablefuture)对二者做出了讨论，其中说到complete的一个用处：**it can be completed from any thread that wants it to complete.**
```
CompletableFuture completableFuture = new CompletableFuture();
    completableFuture.whenComplete(new BiConsumer() {
        @Override
        public void accept(Object o, Object o2) {
            //handle complete
        }
    }); // complete the task
    completableFuture.complete(new Object())
```
只要调用方想让CompletableFuture结束，它也可以结束。相当于调用发不想等了，直接设置了个默认值。Emmm......

# Listenablefuture vs. Completablefuture
感觉Guava的ListenableFuture更清晰，不过JDK的CompletableFuture如果不考虑那个complete方法，链式调用的选择其实挺多的，写起来貌似更顺手。

无论怎么说，从ListenableFuture入手读了源码，再看CompletableFuture的实现，简直不要太清晰！

# 参阅
- https://www.baeldung.com/java-completablefuture

