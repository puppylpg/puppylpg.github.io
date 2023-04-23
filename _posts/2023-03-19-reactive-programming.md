---
layout: post
title: "Reactive Programming"
date: 2023-03-19 21:33:11 +0800
categories: reactive
tags: reactive
---

webflux，之前留下的未尽事宜，终于又碰上了。Reactive Programming，RP，震惊我100年。

1. Table of Contents, ordered
{:toc}

# Reactive Programming
为什么要RP？看了半天，只有[《Reactor 3 Reference Guide》](https://projectreactor.io/docs/core/release/reference/index.html#intro-reactive)介绍的最清楚。



阻塞式编程效率太低（Blocking Can Be Wasteful），为了服务于大量的并发用户，server端只能寻求两种方法：
1. 并行化：使用更多线程，使用更多资源；
2. 高效化：更进一步提高对资源的利用率；

## 多线程
Java后端的代码经常是阻塞式的，所以多线程并行是Java后端经常使用的办法。比如传统的Java web编程，一个连接使用一个线程处理。或者读取数据库，也会使用线程池，阻塞式等待数据响应。

> Usually, Java developers write programs by using blocking code. **This practice is fine until there is a performance bottleneck. Then it is time to introduce additional threads, running similar blocking code**. But this scaling in resource utilization can quickly introduce contention and concurrency problems.
>
> Worse still, blocking wastes resources. If you look closely, as soon as a program involves some latency (notably I/O, such as a database request or a network call), **resources are wasted because threads (possibly many threads) now sit idle, waiting for data**.

**但这些阻塞等待都是对资源的浪费，线程不可能一直加下去，想办法更充分利用资源才是处理更大规模并发的正解。**

> So **the parallelization approach is not a silver bullet**. It is necessary to access the full power of the hardware

## 异步
使用异步方式写非阻塞的代码才是更加合理利用资源的方式。

> The second approach mentioned earlier, seeking more efficiency, can be a solution to the resource wasting problem. **By writing asynchronous, non-blocking code, you let the execution switch to another active task that uses the same underlying resources and later comes back to the current process when the asynchronous processing has finished.**

jvm提供了两种方式实现异步：
1. callback：这种异步方法不返回值，而是接收一个callback参数，在结果可用时调用回调函数处理数据。比如各种listener、`CompletableFuture`等；
2. `Future`/`CompletableFuture`：这种异步方法立刻返回一个`Future<T>`，可以轮询访问直到它里面的结果可用。比如`ExecutorService`在执行`Callable<T>`方法时会返回`Future`。Java8强化了`Future`，引入了`CompletableFuture`，可以进行异步结果的结合。

> [CompletableFuture]({% post_url 2020-06-05-CompletableFuture %})

但是这两种方式**在面对多层复杂组合（orchestrate）情况时**并不好用。

### callback: not readable
**callback在面对简单结果处理时会非常方便，在只做一层回调处理时很好用**，写个onSuccess和onError就行了。但是如果对结果的处理逻辑非常复杂，需要形成callable逻辑的堆叠，callback就需要内嵌callback，形成**callback地狱（Callback Hell）**：

比如异步获取用户的top5收藏进行展示，如果没有的话就展示建议：
```java
userService.getFavorites(userId, new Callback<List<String>>() { 
  public void onSuccess(List<String> list) { 
    if (list.isEmpty()) { 
      suggestionService.getSuggestions(new Callback<List<Favorite>>() {
        public void onSuccess(List<Favorite> list) { 
          UiUtils.submitOnUiThread(() -> { 
            list.stream()
                .limit(5)
                .forEach(uiList::show); 
            });
        }

        public void onError(Throwable error) { 
          UiUtils.errorPopup(error);
        }
      });
    } else {
      list.stream() 
          .limit(5)
          .forEach(favId -> favoriteService.getDetails(favId, 
            new Callback<Favorite>() {
              public void onSuccess(Favorite details) {
                UiUtils.submitOnUiThread(() -> uiList.show(details));
              }

              public void onError(Throwable error) {
                UiUtils.errorPopup(error);
              }
            }
          ));
    }
  }

  public void onError(Throwable error) {
    UiUtils.errorPopup(error);
  }
});
```

> **因为需要展示在ui上，所以使用ui线程调用show方法**，这样主线程就能干其他事儿了。

显然，**callback处理逻辑一旦超过一层，堆叠起来就很难看懂了。**

同样逻辑的Reactor代码：
```java
userService.getFavorites(userId) 
           .flatMap(favoriteService::getDetails) 
           .switchIfEmpty(suggestionService.getSuggestions()) 
           .take(5) 
           .publishOn(UiUtils.uiThreadScheduler()) 
           .subscribe(uiList::show, UiUtils::errorPopup); 
```

**reactor的代码写出来几乎和逻辑描述是一样的，所以非常好读。**

### `CompletableFuture`: easy to block, hard to compose
java8的`CompletableFuture`在**异步结果的组合**上要比callback好一些。

比如，异步获取一些id，然后异步获取这些id的name和statistic，组合起来：
```java
CompletableFuture<List<String>> ids = ifhIds(); 

CompletableFuture<List<String>> result = ids.thenComposeAsync(l -> { 
	Stream<CompletableFuture<String>> zip =
			l.stream().map(i -> { 
				CompletableFuture<String> nameTask = ifhName(i); 
				CompletableFuture<Integer> statTask = ifhStat(i); 

				return nameTask.thenCombineAsync(statTask, (name, stat) -> "Name " + name + " has stats " + stat); 
			});
	List<CompletableFuture<String>> combinationList = zip.collect(Collectors.toList()); 
	CompletableFuture<String>[] combinationArray = combinationList.toArray(new CompletableFuture[combinationList.size()]);

	CompletableFuture<Void> allDone = CompletableFuture.allOf(combinationArray); 
	return allDone.thenApply(v -> combinationList.stream()
			.map(CompletableFuture::join) 
			.collect(Collectors.toList()));
});



List<String> results = result.join(); 
assertThat(results).contains(
		"Name NameJoe has stats 103",
		"Name NameBart has stats 104",
		"Name NameHenry has stats 105",
		"Name NameNicole has stats 106",
		"Name NameABSLAJNFOAJNFOANFANSF has stats 121");
```
可看到`CompletableFuture`虽然可以进行组合，但还是挺麻烦的。而且依然有其他问题：
- It is easy to end up with another blocking situation with `Future` objects by calling the `get()` method.
- They do not support lazy computation.
- They **lack support for multiple values and advanced error handling**.

同样逻辑的Reactor代码：
```java
Flux<String> ids = ifhrIds(); 

Flux<String> combinations =
		ids.flatMap(id -> { 
			Mono<String> nameTask = ifhrName(id); 
			Mono<Integer> statTask = ifhrStat(id); 

			return nameTask.zipWith(statTask, 
					(name, stat) -> "Name " + name + " has stats " + stat);
		});

Mono<List<String>> result = combinations.collectList();



List<String> results = result.block(); 
assertThat(results).containsExactly( 
		"Name NameJoe has stats 103",
		"Name NameBart has stats 104",
		"Name NameHenry has stats 105",
		"Name NameNicole has stats 106",
		"Name NameABSLAJNFOAJNFOANFANSF has stats 121"
);
```

## 所以什么是RP？
reactive programming和callback思想类似（并不是出现了比callback更高效的东西），但写出来的代码就很流畅。**它的目标是解决jvm里传统异步（callback、future）的缺陷，实现[Composability and readability](https://projectreactor.io/docs/core/release/reference/index.html#_composability_and_readability)**：
+ By “composability”, we mean **the ability to orchestrate multiple asynchronous tasks**
+ The ability to orchestrate tasks is tightly coupled to **the readability and maintainability of code**
+ As we saw, the callback model is simple, but one of its main drawbacks is that, for complex processes, you need to have a callback executed from a callback, itself nested inside another callback, and so on. That mess is known as `Callback Hell`.
+ Reactor offers rich composition options, wherein **code mirrors the organization of the abstract process, and everything is generally kept at the same level (nesting is minimized)**. 

之所以写起来很流畅，主要就是**Reactive Programming的代码直接对应了逻辑上的抽象层级，所以和callback比起来，用reactor写代码更贴近于直接思考问题的逻辑**。

> Reactive libraries, such as Reactor, aim to address these drawbacks of “classic” asynchronous approaches on the JVM while also focusing on a few additional aspects

[Reactive Streams](http://www.reactive-streams.org/)是对RP模型的规定。主要是：
- 发布订阅模式
- backpressure：publisher根据consumer的反馈，决定自己push多少数据给consumer，以此来实现一定程度的速度控制，防止consumer处理不过来；

在[reactive streams的规范](https://github.com/reactive-streams/reactive-streams-jvm/blob/v1.0.4/README.md)里有更详细的行为定义。包括onSubscribe()调用时机、request()调用等。

因此reactive这个词虽然听起来稍微抽象一些，但实际上**它主要想表达的是[对产生的数据做出反应](https://projectreactor.io/docs/core/release/reference/index.html#_from_imperative_to_reactive_programming)**，所以是reactive。

## 设计
[reactive streams的规范](https://github.com/reactive-streams/reactive-streams-jvm/blob/v1.0.4/README.md)有以下比较重要的信息：

A Subscription is shared by exactly one Publisher and one Subscriber for the purpose of mediating the data exchange between this pair. This is the reason why the subscribe() method does not return the created Subscription, but instead returns void; the Subscription is only passed to the Subscriber via the onSubscribe callback.


# reactive/reactor/reactivex
查reactive programming的时候发现几个其他的词，发现Google的结果总结比较烂，查了好久才明白。后来心血来潮问了问ChatGPT（3.5），发现回答异常出色，就直接作为答案贴在这里了。（格式稍加修改）

> 搜索引擎不存在了:D

## reactive/reactor/reactivex这几个词分别代表什么
Reactive、Reactor 和 ReactiveX 都是和响应式编程相关的概念。

Reactive 是一种面向数据流和变化传播的**编程范式**，它可以帮助我们更方便地处理异步事件和并发任务。在 Reactive 编程中，我们将数据视为不断变化的流，使用一组操作符来描述数据流之间的转换和操作，从而实现响应式的数据处理。

Reactor 是一个基于 Java 语言实现的反应式**编程框架**，它提供了一组核心 API 来支持开发人员构建可响应的系统。Reactor 提供了许多有用的操作符和工具类，使得开发人员可以轻松地处理异步数据流和事件。

ReactiveX 是一个跨平台的反应式**编程库**，它支持多种编程语言和平台，包括 Java、JavaScript、C#、Python 等。ReactiveX 封装了 Reactive 所需的一系列操作符和工具类，提供了统一的编程接口和语义，使得开发人员可以更加方便地进行跨平台开发和代码共享。

## reactive-stream/reactive extension/rxjava/reactor/java9出现的时间线
按照时间先后排序，以下是 Reactive Stream、Reactive Extension、RxJava、Reactor 和 Java 9 的出现时间线：
- Reactive Extension（Rx）：2009 年，由微软公司的架构师 Erik Meijer 领导的团队开发的响应式编程库，最早支持 .NET 平台。
- Reactive Stream：2013 年，由一批领先的响应式编程框架提供商和开发者共同制定的异步数据流处理标准规范。
- RxJava：2013 年，由 Netflix 公司基于 Rx 开源项目开发的 Java 版本的响应式编程库，以实现异步事件驱动的数据流处理。
- Reactor：2015 年，由 Pivotal 公司开源的响应式编程库，以实现基于 Reactive Stream 规范的异步数据流处理。
- Java 9：2017 年，由 Oracle 公司发布的 JDK 版本，引入了 Reactive Stream API 和 Flow 接口，以支持基于 Reactive Stream 规范的异步数据流处理。

总之，**Reactive Extension 是最早出现的响应式编程库，而 Reactive Stream 则是在该领域制定的第一个标准规范**。RxJava 和 Reactor 则分别是基于 Reactive Extension 和 Reactive Stream 规范的**具体实现**，Java 9 引入了 Reactive Stream API 和 Flow 接口，以原生支持 Reactive Stream 的能力。

## java9为什么要自定义flow，而不是直接用reactive-streams的

这个问题我感觉ChatGPT回答的不在点儿上，就抛弃它的答案了。

从包名来看：
- `Publisher`是reactive-streams的接口，包名是`org.reactivestreams`；
    + reactor的`Flux`是它的一个实现，包名是`reactor.core`；
    + reactive extension的`Flowable`是它的另一个实现，rxjava是reactive extension的一种，包名是`io.reactivex.rxjava3.core`；
    + jdk9也有一种实现，而且没实现标准的`Publisher`，而是`Flow.Publisher`。所以肯定还需要有adapter做转换。
- **reactive-streams在`org.reactivestreams`里除了定义了RP标准的接口`Publisher`/`Subscriber`/`Subscription`/`Processor`，里面还有一个`FlowAdapters.java`，用于和jdk9的`Flow.Publisher`等互转。**

根据[Why Flow API?](https://www.baeldung.com/rxjava-vs-java-flow-api#why-flow-api)的解释：

> the purpose of Flow API: **It was created to be a group of reactive specification interfaces in JDK without relay on third parties.** Moreover, Java expects Flow API to be accepted as standard interfaces for reactive specification and to be used in JDK or other Java-based libraries that implement the reactive specification for middlewares and utilities.

# reactive vs. callback
所谓push，我越听越觉得是由另一方执行回调。他们把数据搞出来给你（或者说他们输出到stdout），就是push给你。而不是你去轮询结果并自己处理（自己输出到stdout），那叫pull。

干脆再问问ChatGPT——

## 响应式编程和使用回调有什么区别

**响应式编程和回调都是处理异步事件的编程模型**，但它们有一些区别。

回调通常是指一个函数或方法被传递到另一个函数或方法中，以在某个时间点或事件发生时被调用。通常情况下，回调函数被视为异步操作的一部分，因此当异步操作完成时，回调函数将被调用来处理结果。因此，**回调通常用于处理单个异步操作**。

响应式编程则更**侧重于处理数据流和多个异步操作之间的交互**。它使用观察者模式，其中一个可观察对象（通常是数据流）发送事件并将其传递给所有已注册的观察者。每个观察者可以根据需要处理这些事件，并可能产生其他事件。因此，**响应式编程用于处理多个异步操作和数据流之间的交互，而不仅仅是单个异步操作的结果**。

## 响应式编程本质上是不是使用了回调

**在响应式编程中，回调确实被用来处理异步事件。但是，响应式编程不仅仅是使用回调的简单集合。它采用了更高级别的抽象概念，例如可观察对象和观察者模式，以处理数据流和异步事件之间的交互。尽管每个观察者都有一个回调函数来处理事件，但这些回调函数通常被封装在响应式编程框架中，使得编程模型更加清晰和易于管理。**

**此外，在响应式编程中，观察者可以订阅多个可观察对象，并且可以将它们的事件组合起来，产生新的事件，而这种组合可能会涉及到更复杂的逻辑，例如过滤、映射、合并、聚合等等，这些是传统回调模式所不具备的。**

**因此，虽然响应式编程使用了回调，但它不仅仅是回调的简单集合，而是一种更高级别的编程模型，专门用于处理数据流和异步事件之间的交互**。

## 通过回调可以达到响应式编程的效果吗

是的，通过回调可以实现**一定程度上的**响应式编程效果。在回调机制中，当某个事件发生时，会触发预先定义好的回调函数，从而完成相应的操作。这种方式能够使程序对外部事件做出快速反应，从而实现响应式编程的效果。

举个例子，当用户点击页面上的按钮时，可以使用回调函数来处理这个事件。当按钮被点击时，系统会触发绑定在按钮上的回调函数，从而执行相应的操作。这种方式能够使程序对用户交互做出即时反应，提升用户体验。

不过需要注意的是，**回调函数的嵌套和耦合可能会导致代码难以维护。因此，在使用回调时，应该尽量避免回调嵌套和过多的耦合**。

## 怎么理解响应式编程提到的push的概念？可以理解为就是回调吗

响应式编程中的“push”概念是指数据的推送。**在传统的编程模型中，通常是由程序员主动查询某个数据并获取其最新值。而在响应式编程中，数据会被异步地推送给程序，这意味着程序员无需频繁地查询数据，而是可以通过订阅数据流来接收数据**。

**与回调不同，响应式编程中的推送是以流的形式持续不断地发送数据**。当数据发生变化时，程序会自动向已经订阅该数据流的订阅者推送新的数据，这种数据推送的过程也被称为“事件流”。

因此，**从这个角度来看，“push”可以理解为一种更高级别的回调机制**，它能够更方便地处理异步数据流，并且避免了频繁手动查询数据的麻烦。

## reactive是怎么实现异步推送的

在响应式编程中，异步推送通常是通过流（stream）来实现的。流可以被看作是一系列时间上连续的事件，每个事件都包含了一个值。程序可以监听某个流，并在流中有新事件加入时自动收到通知。

在具体实现中，响应式编程库通常会提供类似于Observable（RxJava）、Flowable（RxJava2）、Flux（Reactor）、Stream（Java8）等用于表示数据流的类或接口。使用这些工具，程序员可以创建和操作各种不同类型的数据流，并定义订阅该流的行为。

**当某个数据流产生了新事件时，响应式编程库会自动通知已经订阅该流的程序**，以便其能够及时处理数据的变化。整个过程是异步的，因此***程序员无需关心具体的线程管理和同步机制，而是可以专注于描述数据流的行为和对流的操作***。

总之，响应式编程利用数据流和相关工具实现了高效的异步推送机制，使得程序员可以更方便地处理异步数据流，并且***以声明式的方式描述数据流的行为***。

## 总结
所以虽然目前暂时不清楚框架是怎么实现数据的异步推送的，但对于程序员来讲，一开始学习的时候只需要考虑怎么用框架就行了：怎么以声明式的方式描述数据流的行为。

比如那个常举的例子：excel的表格计算就是一种RP。定义好sum函数（行为），每当修改表格产生新数据（数据流），最终的和就会发生改变。

# Reactor
下面就来简单学一下如何使用reactor框架进行RP编程（如何描述数据流的行为）。

> 主要参考[《Reactor Core Features》](https://projectreactor.io/docs/core/release/reference/index.html#core-features)

学习reactor的api用法，使用[
lite-rx-api-hands-on](https://github.com/reactor/lite-rx-api-hands-on)非常不错！

## 基础对象
### [Flux](https://projectreactor.io/docs/core/release/reference/index.html#flux)

Note that all events, even terminating ones, are optional: no `onNext` event but an `onComplete` event represents an empty finite sequence, but remove the onComplete and you have an infinite empty sequence (not particularly useful, except for tests around cancellation).


Mono.never() is an outlier: it doesn’t emit any signal, which is not technically forbidden although not terribly useful outside of tests. 

Note that you can use a Mono to represent no-value asynchronous processes that only have the concept of completion (similar to a Runnable). To create one, you can use an empty `Mono<Void>`. **因此mono有fromCallable/fromRunnable方法**

### [subscribe](https://projectreactor.io/docs/core/release/reference/index.html#_simple_ways_to_create_a_flux_or_mono_and_subscribe_to_it)

subscrbe会返回Disposable：These variants return a reference to the subscription that you can use to cancel the subscription when no more data is needed. Upon cancellation, the source should stop producing values and clean up any resources it created. This cancel-and-clean-up behavior is represented in Reactor by the general-purpose Disposable interface.

**想让谁消费数据，就把谁注册为subscribe的consumer。想让哪个线程执行这个消费动作，就把哪个线程作为publishOn的对象。**

下面这个就是有消费者，但是没有地方输出，所以看不见:D
```
Flux<Integer> ints = Flux.range(1, 3); 
ints.subscribe(); 
```

因为publisher会出现error（RuntimeException），所以可能在消费的时候需要onError。subscribe方法可以直接提供一个lambda用于onError。同理可以再提供一个lambda用于onCompletion。

reactor提供了一个`BaseSubscriber`（extends BaseSubscriber, which is the recommended abstract class for user-defined Subscribers in Reactor），可以通过它方便实现一个subscriber而不是通过一堆lambda。从这个BaseSubscriber的实现里，也可以看到调用onNext如果出错了，也应该调用onError。

**还可以看到subscriber默认在onSubscribe之后会request无穷无尽的数据。所以publisher会把数据一下子都push过来**：
```
	protected void hookOnSubscribe(Subscription subscription){
		subscription.request(Long.MAX_VALUE);
	}
```

> By default, it triggers an unbounded request and behaves exactly as subscribe(). However, extending BaseSubscriber is much more useful when you want a custom request amount.

有以下这么多hook可override：
- hookOnSubscribe
- hookOnNext
- hookOnError
- hookOnComplete
- hookOnCancel
- 还有一个所有人都会调用的hookOnFinally

如果使用了backpressure，一开始onSubscribe时request的不是无穷个数据，那么onNext里必须继续request，否则就收不到数据了：
```
public class SampleSubscriber<T> extends BaseSubscriber<T> {

	public void hookOnSubscribe(Subscription subscription) {
		System.out.println("Subscribed");
		request(1);
	}

	public void hookOnNext(T value) {
		System.out.println(value);
		request(1);
	}
}
```

> `SampleSubscriber` is the absolute minimum implementation of a Subscriber that performs **bounded requests**.

但是注意千万别用它同时subscribe两个流：Instances of BaseSubscriber (or subclasses of it) are single-use, meaning that a BaseSubscriber cancels its subscription to the first Publisher if it is subscribed to a second Publisher. That is because using an instance twice would violate the Reactive Streams rule that the onNext method of a Subscriber must not be called in parallel. As a result, anonymous implementations are fine only if they are declared directly within the call to Publisher#subscribe(Subscriber).


Demand is capped at Long.MAX_VALUE, representing an unbounded request (meaning “produce as fast as you can”-basically disabling backpressure).

[Intro To Reactor Core](https://www.baeldung.com/reactor-core)里可以看到一个纯匿名Subscriber。


- https://projectreactor.io/docs/core/release/reference/index.html#producing.generate

generate有点儿意思。同步产生流。

- https://projectreactor.io/docs/core/release/reference/index.html#_handle
- https://github.com/reactor/reactor-core#custom-sources--fluxcreate-and-fluxsink-monocreate-and-monosink

SynchronousSink还可以起到filter的作用，因为你可以不调用next，不让这个元素传递给producer。

## [Thread & Scheduler](https://projectreactor.io/docs/core/release/reference/index.html#schedulers)

Reactor, like RxJava, can be considered to be concurrency-agnostic. That is, it does not enforce a concurrency model. **Rather, it leaves you, the developer, in command.** However, that does not prevent the library from helping you with concurrency.

Obtaining a Flux or a Mono does not necessarily mean that it runs in a dedicated Thread. Instead, **most operators continue working in the Thread on which the previous operator executed. Unless specified, the topmost operator (the source) itself runs on the Thread in which the `subscribe()` call was made**. The following example runs a Mono in a new thread:

```
	public static void main(String... args) throws InterruptedException {
		final Mono<String> mono = Mono.just("hello ")
				.map(v -> v + "world ")
				.log();

		Thread t = new Thread(() -> mono
				.map(msg -> msg + "! ")
				.subscribe(v ->
						System.out.println(Thread.currentThread().getName() + ": " + v)
				)
		);
		t.start();
		t.join();
	}
```
**哪个线程调用的`subscribe()`，在哪个线程里跑**：
```
15:10:15.555 [Thread-0] INFO reactor.Mono.MapFuseable.1 - | onSubscribe([Fuseable] FluxMapFuseable.MapFuseableSubscriber)
15:10:15.557 [Thread-0] INFO reactor.Mono.MapFuseable.1 - | request(unbounded)
15:10:15.557 [Thread-0] INFO reactor.Mono.MapFuseable.1 - | onNext(hello world )
Thread-0: hello world ! 
15:10:15.558 [Thread-0] INFO reactor.Mono.MapFuseable.1 - | onComplete()
```

In Reactor, the execution model and where the execution happens is determined by the Scheduler that is used.

Scheduler和ExecutorService理解起来非常像！


[在reactive中，使用Schedulers#boundedElastic()处理遗留的blocking code](https://projectreactor.io/docs/core/release/reference/index.html#faq.wrap-blocking)，其实就是多线程。

	
**While boundedElastic is made to help with legacy blocking code if it cannot be avoided, single and parallel are not**. As a consequence, the use of Reactor blocking APIs (block(), blockFirst(), blockLast() (as well as iterating over toIterable() or toStream()) inside the default single and parallel schedulers) results in an IllegalStateException being thrown.

Custom Schedulers can also be marked as "non blocking only" by creating instances of Thread that implement the `NonBlocking` marker interface.

所以reactor的大部分异步操作不能引入blocking代码。

Reactor offers two means of switching the execution context (or Scheduler) in a reactive chain: publishOn and subscribeOn. Both take a Scheduler and let you switch the execution context to that scheduler. But the placement of publishOn in the chain matters, while the placement of subscribeOn does not. To understand that difference, you first have to remember that nothing happens until you subscribe.

- https://projectreactor.io/docs/core/release/reference/index.html#_the_publishon_method

publishOn影响的是消费动作onNext/onComplete/onError，所以从publishOn开始，执行动作的线程就切换了，直到出现新的publishOn。
> Run onNext, onComplete and onError on a supplied Scheduler Worker.
This operator influences the threading context where the rest of the operators in the chain below it will execute, up to a new occurrence of publishOn.


subscribeOn影响的是subscribe/onScuscribe/request，所以放在哪里都无所谓。它决定了一开始的执行线程，直到碰到了publishOn。
> Run subscribe, onSubscribe and request on a specified Scheduler's Scheduler.Worker. As such, placing this operator anywhere in the chain will also impact the execution context of onNext/onError/onComplete signals from the beginning of the chain up to the next occurrence of a publishOn.

这个例子比较有意思：
```
Scheduler s = Schedulers.newParallel("parallel-scheduler", 4); 

final Flux<String> flux = Flux
    .range(1, 2)
    .map(i -> 10 + i)  
    .subscribeOn(s)  
    .map(i -> "value " + i);  

new Thread(() -> flux.subscribe(System.out::println));  
```
最后一个线程（subscribe发生的线程）只进行了subscribe，接下来的执行就被切换到线程池了：
> This anonymous Thread is the one where the subscription initially happens, but subscribeOn immediately shifts it to one of the four scheduler threads.


[Handling Errors](https://projectreactor.io/docs/core/release/reference/index.html#error.handling)

Before you learn about error-handling operators, you must keep in mind that any error in a reactive sequence is a terminal event. Even if an error-handling operator is used, it does not let the original sequence continue. Rather, it converts the onError signal into the start of a new sequence (the fallback one). In other words, it replaces the terminated sequence upstream of it.

TODO

## spring & reactor
- https://www.infoq.com/articles/reactor-by-example/

## webflux - `WebClient`
- https://dzone.com/articles/callback-hell-and-reactive-patterns

# WebFlux
- https://docs.spring.io/spring-framework/docs/current/reference/html/web-reactive.html

# 异步JDBC
既然想实现异步、非阻塞，那一定是端到端的，全链路的实现，某个点的阻塞调用都会导致整体出问题。
- https://mp.weixin.qq.com/s?__biz=MzAxOTc0NzExNg==&mid=2665515772&idx=1&sn=205b10cfb2241cfe1b16c7f832b48197&chksm=80d672bfb7a1fba99cbbbc423984da5c9034fffd8ca12f6fc7098fe5d69c6d1e39152de45cbd&token=1358435034&lang=zh_CN#rd
- [R2DBC](https://r2dbc.io/)

# 总结
交汇了！之前一直想看没看的前端、reactive、webflux，甚至kotlin。包括已看的ListenableFuture、CompletableFuture。


