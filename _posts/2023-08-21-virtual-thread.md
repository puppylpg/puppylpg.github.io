---
layout: post
title: "Virtual Thread"
date: 2023-08-21 00:07:01 +0800
categories: java
tags: java
---

[JDK 21](https://openjdk.org/projects/jdk/21/)下个月就要发布了，[Virtual Threads](https://openjdk.org/jeps/444)也正式成为发布特性。虚线程的引入，大概从此会改变Java项目的架构。

1. Table of Contents, ordered
{:toc}

# 语言中线程的实现
操作系统提供了线程实现，各个编程语言也基于操作系统的线程实现了自己的线程。实现方式大体有三种：
- 线程实现在用户空间，也称绿色线程。和操作系统线程是N：1的映射关系；
- 线程实现在内核空间。和操作系统线程一一映射；
- 用户空间也可以实现线程；

Java线程的实现是Thread类，里面全是native方法，说明它的实现无法做到平台无关。实际上，在jdk21之前，Java的线程都是和操作系统的内核线程一一对应的。

## 基于内核线程实现：1:1
基于os内核线程实现自己的线程有很大的好处，因为os对线程已经有了丰富的支持，语言层面只需要调用内核的支持就行了。

优点：
- 不需要关心自己调度线程，有os控制；

缺点：
- 效率低：所有现成的操作（创建、同步、销毁）都需要进行系统调用；

之所以基于内核实现线程比较重量级：
1. 由内核进行线程调度成本比较高：因为线程的切换需要保护和恢复现场，涉及到寄存器、缓存的保存等；
2. 每一个线程都是一个内核线程，都要在内核里开辟空间（16KB）。所以线程不能开太多，容易耗尽内核的内存资源；

> 64bit linux上，HotSpot创建一个线程，还要默认分配1MB的栈容量。

## 实现在用户空间：N:1
既然基于内核的线程不能开太多，且系统调用开销太大，那实现在用户空间不就得了？

实现在用户空间则优缺点正好反过来了。

优点：
- 线程切换很快，无需经过操作系统；
- 不管操作系统支不支持线程，都可以这么搞；
- 支持更大的线程数量；

缺点：
- 没有操作系统支持。所有的线程操作都要在用户空间实现。对于一门语言来说，实现起来比较复杂；

比如，os只把资源分配给进程，jvm如何控制进程资源在线程上的进一步分配？怎么把一个进程内的不同线程映射到不同的处理器上？操作系统不这么分配cpu资源，仅在用户空间很难办。

> 突然想起了操作系统上的一句话：**线程是CPU调度的基本单位，进程是资源分配的基本单位**。

另外，进程中的一个线程阻塞，进行系统调用（比如缺页中断），整个进程都会被操作系统阻塞。因为对操作系统来说，是进程在向它申请系统调用。

所以，虽然用户空间的线程被称为[green thread](https://en.wikipedia.org/wiki/Green_thread)，但是未必高效。Java1.1就基于用户空间实现了线程，但是和os线程比，上面说的使用资源的限制是无法被突破的，所以**后来被抛弃了，主要原因就是[在多核处理器上表现不行](https://www.sco.com/developers/java/j2sdk122-001/ReleaseNotes.html#THREADS)**：

> The first advantage is performance on multiprocessor (MP) machines. In green threads all Java threads execute within one operating system lightweight process (LWP), and thus UnixWare has no ability to distribute the execution of Java threads among the extra processors in an MP machine. But in the native threads model, each Java thread is mapped to a UnixWare threads library multiplexed thread, and the threads library will indeed map those threads to different LWPs as they are available. Furthermore, under native threads the Java virtual machine will expand the number of LWPs available to the threads library, one for each additional processor in the MP configuration.

## 混合模式：N:M
那不如均衡一下：**非阻塞的线程切换由进程内部负责，阻塞的线程切换由内核负责，别把整个进程都卡了。**

同时，用户态线程数量多，内核态线程数量少，每个内核态线程负责多个用户态线程（多路复用）。

# 虚线程
为什么Java要实现虚线程？显然，每个线程就是一个os线程，一个应用就不能创建太多线程。

这里直接拿[JEP 444](https://openjdk.org/jeps/444)来介绍了，上面的motivation写的非常漂亮！

## Java的最小并发单元
Java的最小并发单元是线程：
> Every statement in every method is executed inside a thread and, since Java is multithreaded, multiple threads of execution happen at once. The thread is Java's unit of concurrency: a piece of sequential code that runs concurrently with — and largely independently of — other such units. Each thread provides a stack to store local variables and coordinate method calls, as well as context when things go wrong: Exceptions are thrown and caught by methods in the same thread, so developers can use a thread's stack trace to find out what happened. Threads are also a central concept for tools: Debuggers step through the statements in a thread's methods, and profilers visualize the behavior of multiple threads to help understand their performance.

一段代码运行在一个线程上，和其他线程并发执行。

## thread per request
如果写个server服务，因为用户之前的请求也是独立的，所以一个请求一个thread是符合逻辑的：
> Server applications generally handle concurrent user requests that are independent of each other, so it makes sense for an application to handle a request by dedicating a thread to that request for its entire duration. This thread-per-request style is easy to understand, easy to program, and easy to debug and profile because it uses the platform's unit of concurrency to represent the application's unit of concurrency.

唯一不理想的就是Java的thread不能随请求的增加而多创建一些，因此，服务器的一些资源可能还很充足，线程却不能创建了：
> Unfortunately, the number of available threads is limited because the JDK implements threads as wrappers around operating system (OS) threads. OS threads are costly, so we cannot have too many of them, which makes the implementation ill-suited to the thread-per-request style. If each request consumes a thread, and thus an OS thread, for its duration, then the number of threads often becomes the limiting factor long before other resources, such as CPU or network connections, are exhausted.

怪谁？怪JDK！
> **The JDK's current implementation of threads caps the application's throughput to a level well below what the hardware can support**.
>
> 嗯，我很喜欢Java团队的这种精神……

## 异步
**开发者被逼无奈**，为了充分利用硬件资源，只得放弃了thread per request的编程风格，开始搞线程池，试图共享线程——在计算的时候使用线程，在等待io的时候释放线程：
> Some developers wishing to utilize hardware to its fullest have given up the thread-per-request style in favor of a thread-sharing style. Instead of handling a request on one thread from start to finish, request-handling code returns its thread to a pool when it waits for another I/O operation to complete so that the thread can service other requests. This fine-grained sharing of threads — in which code holds on to a thread only while it performs calculations, not while it waits for I/O — allows a high number of concurrent operations without consuming a high number of threads.

资源利用率确实上来了，血压也上来了，写代码必须用异步风格了，还要引入一套non blocking io方法，最后还要用callback来处理结果：
> While it removes the limitation on throughput imposed by the scarcity of OS threads, it comes at a high price: It requires what is known as an asynchronous programming style, employing a separate set of I/O methods that do not wait for I/O operations to complete but rather, later on, signal their completion to a callback.
>
> 当然除了jdk层面的nio，还要让os提供一套nio相关的支持：[从阻塞IO到IO多路复用到异步IO]({% post_url 2022-02-24-io-nio-aio %})。

**因为没有一个专用的线程，程序猿写出来的代码块都散乱了，本来一个完整的处理请求的逻辑，现在要拆成好几部分，再使用异步api比如`CompletableFuture`，或者reactive风格组合起来**。为此，甚至连语言层面基本的顺序操作比如for循环、try/catch都得抛弃了：
> Without a dedicated thread, developers must break down their request-handling logic into small stages, typically written as lambda expressions, and then compose them into a sequential pipeline with an API (see CompletableFuture, for example, or so-called "reactive" frameworks). They thus forsake the language's basic sequential composition operators, such as loops and try/catch blocks.

这么写代码，大家都疯了！
> In the asynchronous style, each stage of a request might execute on a different thread, and every thread runs stages belonging to different requests in an interleaved fashion. This has deep implications for understanding program behavior: Stack traces provide no usable context, debuggers cannot step through request-handling logic, and profilers cannot associate an operation's cost with its caller. Composing lambda expressions is manageable when using Java's stream API to process data in a short pipeline but problematic when all of the request-handling code in an application must be written in this way. 

这一切的罪魁祸首，都是因为程序的并发单元（异步pipeline）和java的并发单元（线程）不一致：
> This programming style is at odds with the Java Platform because the application's unit of concurrency — the asynchronous pipeline — is no longer the platform's unit of concurrency.

### 异步框架的本质
> [Java 21 new feature: Virtual Threads #RoadTo21](https://www.youtube.com/watch?v=5E0LU85EnTI&ab_channel=Java)

异步框架如jdk里的CompletableFuture，或者Reactive programming。

为了避免阻塞代码block cpu，程序猿将代码分割成小块，每一块代码都有输入和输出，每一块代码都被写成了lambda，然后使用异步框架组装他们。异步框架的功能就是
1. **使用正确的输入调用lambda**；
1. **得到输出**；
1. **把输出作为下一个lambda的输入**；

以上，就创造出了处理数据的pipeline，**异步框架的责任就是帮你以正确的顺序执行每一个lambda，把他们分配给不同的线程，以便充分利用CPU**。一旦lambda有了返回，**会有一个handler触发信号**，把返回结果进行下一个lambda处理。

异步编程能够极大提高CPU使用率，缺点就是到处都是lambda，到处都在调用lambda，并把结果转发给另一个lambda。如果看代码的stack trace，几乎看不到业务代码，只能看到框架在调用lambda。

这种风格会导致debug、异常处理、测试、维护特别蛋疼。如果错误不在业务代码内，而是因为业务返回了一个null，并在框架代码里出发了一个NPE，炸了……stack trace啥也看不出来，不知道null来自哪儿。

## 虚线程：继续thread per request
要解决问题，还是得让程序员写thread per request风格的代码！而这一切也很简单，只要jdk实现的thread能高效一些就行了！
> To enable applications to scale while remaining harmonious with the platform, we should strive to preserve the thread-per-request style. We can do this by implementing threads more efficiently, so they can be more plentiful. 

Java线程和os线程是一对一的，想让os线程高效些是没辙了，但是java可以把线程实现的更高效啊！**正如操作系统把虚拟地址空间映射到RAM上，给进程造成一种有大量可用空间的假象一样，Java也可以把大量线程映射到一小批os线程上，让程序以为它也有充足的线程可用**：
> Operating systems cannot implement OS threads more efficiently because different languages and runtimes use the thread stack in different ways. It is possible, however, for a Java runtime to implement Java threads in a way that severs their one-to-one correspondence to OS threads. Just as operating systems give the illusion of plentiful memory by mapping a large virtual address space to a limited amount of physical RAM, a Java runtime can give the illusion of plentiful threads by mapping a large number of virtual threads to a small number of OS threads.

无论虚线程还是原来的线程，都是Thread类，只不过他们的实现方式不同，不一定一一绑定到os的线程上了：
> A virtual thread is an instance of java.lang.Thread that is not tied to a particular OS thread. A platform thread, by contrast, is an instance of java.lang.Thread implemented in the traditional way, as a thin wrapper around an OS thread.

**thread per request风格的程序可以跑在虚线程上（每个请求绑定一个虚线程），但是虚线程只在计算的时候才消耗cpu。其结果就是这样的代跑起来，性能和异步风格的代码一样**！这里面的差异只有jdk知道：**当程序使用blocking io的时候，jdk自动给它映射为os层面的non blocking操作，并自动挂起虚线程**：
> Application code in the thread-per-request style can run in a virtual thread for the entire duration of a request, but the virtual thread consumes an OS thread only while it performs calculations on the CPU. The result is the same scalability as the asynchronous style, except it is achieved transparently: When code running in a virtual thread calls a blocking I/O operation in the java.* API, the runtime performs a non-blocking OS call and automatically suspends the virtual thread until it can be resumed later. 

对于Java开发者，就当线程是无限的，可劲儿造就完事儿了，这样就可以把硬件性能最大化，达到最大的吞吐，同时，这样写代码和Java的多线程风格一致：
> To Java developers, virtual threads are simply threads that are cheap to create and almost infinitely plentiful. Hardware utilization is close to optimal, allowing a high level of concurrency and, as a result, high throughput, while the application remains harmonious with the multithreaded design of the Java Platform and its tooling.

虚线程不需要池化！
> Virtual threads are cheap and plentiful, and thus should never be pooled: A new virtual thread should be created for every application task. Most virtual threads will thus be short-lived and have shallow call stacks, performing as little as a single HTTP client call or a single JDBC query. Platform threads, by contrast, are heavyweight and expensive, and thus often must be pooled. They tend to be long-lived, have deep call stacks, and be shared among many tasks.

看到这的时候我已经激动了！我在学校里刚学server的时候每来一个request就new一个thread的代码就是最终归宿了！最初版非nio的Tomcat也可以回归了！对程序猿的要求大大降低，这什么神仙jdk团队！

### 虚线程的底层实现
> [Java 21 new feature: Virtual Threads #RoadTo21](https://www.youtube.com/watch?v=5E0LU85EnTI&ab_channel=Java)

**本质上还是需要os线程执行任务**，所以jdk维护了一个修改过的fork join pool，里面都os线程，作为虚线程的执行者。**虚拟线程就像mount到线程池里的os线程上一样，任务还是通过虚拟线程，最终由这些os线程执行的**。如果让虚线程打印`Thread.currentThread()`，会得到ForkJoinPool-1-worker-1，说明虚线程mount到了fork join pool 1的worker1上。这个pool创建的并不大，线程数和CPU核数一致。

> 就像docker的内核，本质还是os的内核。

**当碰到blocking操作，虚线程会从os线程上把自己unmount下来（`Contination#yield`），把自己的stack保存到heap里。JDK里所有的blocking代码现在都会在block的时候调用`Contination#yield`**。当取到数据之后，jdk也有一个handler会监视这些数据，并触发一个信号，调用`Continuation#run`，重新恢复虚线程的上下文，并把虚线程放到fork join pool里的os线程的wait列表里。

> monitor handler是框架里的核心调度者。

但是此时mount虚线程的os线程并不一定还是之前的那一个。

**为了支持虚线程自动从os线程上umount自己，jdk重写了所有的blocking操作**。比如最常见的`Thread#sleep`：
```java
    public static void sleep(long millis) throws InterruptedException {
        if (millis < 0) {
            throw new IllegalArgumentException("timeout value is negative");
        }

        long nanos = MILLISECONDS.toNanos(millis);
        ThreadSleepEvent event = beforeSleep(nanos);
        try {
            if (currentThread() instanceof VirtualThread vthread) {
                vthread.sleepNanos(nanos);
            } else {
                sleep0(nanos);
            }
        } finally {
            afterSleep(event);
        }
    }
```
会对当前线程做判断：
- 如果是虚线程，则jvm自己控制虚线程“挂起”，也就是umount；
- 如果是os线程，则像之前的jdk一样调用native代码（`sleep0`）由操作系统挂起os线程；

## 返祖
**使用虚线程不需要学习新的理念，唯一不适的就是对于已经学过异步编程的人，需要忘掉那些所学的技能。不仅程序开发者受益，框架设计者也可以提供简单易用的api了，不用为了考虑扩展性搞nio了**：
> Using virtual threads does not require learning new concepts, though it may require unlearning habits developed to cope with today's high cost of threads. Virtual threads will not only help application developers — they will also help framework designers provide easy-to-use APIs that are compatible with the platform's design without compromising on scalability.

## 性能
只要并发任务多，又不全是纯计算型的，虚线程都能大幅提升程序性能！
> To put it another way, virtual threads can significantly improve application throughput when
> - The number of concurrent tasks is high (more than a few thousand), and
> - The workload is not CPU-bound, since having many more threads than processor cores cannot improve throughput in that case.

线程能跑的，虚线程都能跑，还能支持thread local变量：
> A virtual thread can run any code that a platform thread can run. In particular, virtual threads support thread-local variables and thread interruption, just like platform threads. This means that existing Java code that processes requests will easily run in a virtual thread. Many server frameworks will choose to do this automatically, starting a new virtual thread for every incoming request and running the application's business logic in it.

### 什么时候不应该用虚线程
虚线程执行代码，会比os线程执行代码带来更多的开销，因为代码最终还是要在os线程上执行的，所以虚线程的执行代价等于os线程的开销加上虚线程自己的开销。

但是，正如docker之于os一样，这点儿开销是值得的，能够提升并发度进而提升CPU利用率。什么时候不值得？当不需要并发度的时候。比如纯计算任务，使用虚线程性能只会下降。

# 感想
我哭了！就等下个月19号[java 21](https://openjdk.org/projects/jdk/21/)发布了！发了我就测性能！

> lei le~ [Virtual Thread benchmark]({% post_url 2023-09-25-virtual-thread-benchmark %})

