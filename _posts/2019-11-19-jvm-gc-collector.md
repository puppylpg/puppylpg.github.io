---
layout: post
title: "JVM GC算法与实现"
date: 2019-11-19 02:30:19 +0800
categories: Java JVM GC
tags: Java JVM GC
---

垃圾回收（Garbage Collection，GC）是JVM的重要特性之一。既然JVM自己管理者一大堆线程，自然也要随时打扫线程留下的垃圾，维护JVM的生态平衡。

1. Table of Contents, ordered                    
{:toc}

了解垃圾回收之前，需要先了解[JVM运行时数据区]({% post_url 2019-11-18-jvm-area %})。

# 垃圾清理思路
gc的工作方式就两步：
- mark：标记垃圾；
- sweep：清理垃圾；

## 标记垃圾
### ~~引用计数法~~
也就是标记一个对象被引用的次数，如果有人引用，就不认为它是垃圾，否则认为是可清理的垃圾。

但是JVM**从没用这种方法**来进行过垃圾标记。

缺点很明显，如果一堆垃圾对象相互循环引用，那岂不是对他们没辙了！

### 可达性分析 - Reachability Analysis
将一系列称为GC Roots的对象作为起点，进行遍历（可以理解为深度优先或广度优先遍历），一遍下来，没被遍历到的对象就是垃圾。

所以关键点在于选好GC Roots，一般是：
- 栈stack中引用的对象；
- native method stack中引用的对象；
- 方法区类静态属性引用的对象；
- 方法区中常量引用的对象；

# 垃圾收集算法
## Mark-Sweep 标记-清除
1. 标记垃圾；
2. 清除垃圾；

最基础的算法，后续算法都是在这个思路上进行的改进。

缺点：
- 内存碎片：清理之后产生大量不连续空间；

## Mark-Compact 标记-压缩
Mark-Compact和Mark-Sweep类似，先标记所有垃圾，接下来是把存活对象往一头挪。这样另一头就是垃圾空间，直接清空就行了。

## Copying 复制
内存分两半，一次用一半，这一半快满了，就把有用的对象拷贝到另一半，然后用另一半。这一半就算是清空了。然后另一半也快满了，就再复制到这一半，一直循环。

优点：
- 简单，不会有内存碎片；

缺点：
- 可用内存直接减半……

虽然这个算法听起来很蠢，但是用这种思路搞新生代的垃圾回收非常奏效。

### 新生代
把内存中“朝生夕死”的对象统一放到叫做**新生代**的地方。不需要把新生代分成两等份，因为新生代的对象死得快，基本一次能回收98%的空间，所以考虑把新生代按照`8:1:1`的比例分成一大两小三块，分别称为**Eden**，**Survivor-1**，**Survivor-2**。一次回收，把Eden+一块Survivor的活下来的对象放到另一块Survivor。

绝大多数情况下，因为新生代剩不下几个对象，所以另一小块Survivor够用。这么看来，只有10%（也就是一个Survivor）的空间没有被用上。内存使用效率上可以接受了。

但是，除非按照1:1的比例分成两块，按照Copying算法做，否则总有Eden+Survivor活下来的对象另一块Survivor装不下的情况。怎么解决？

需要另一块内存，作为担保：如果这个Survivor放不下，就先放到他那里去。这个担保就是**老年代**。

### 老年代
老年代不可能用Copying算法，因为一次清理剩下来的对象还有很多，拷贝太多对象效率显然不会高。

而且Copying算法如果不想1:1浪费50%的空间，就要有额外的担保空间，总不能给老年代再来一块担保空间吧？

老年代一般使用Mark-Sweep或者Mark-Compact：
- 显然Copying不适合存活率高的老年代；
- 而且另Mark-xxx算法不需要额外的分配担保；

## 分代收集算法 Generational Collection
就是利用上述思想，将Heap分为新生代和老年代，新生代Copying算法，老年代Mark-Sweep/Compact算法。

# 垃圾收集器
基于上述思想和算法，实践中产生了多种垃圾收集器。
## Serial GC （新生代）
最简单最基本的collector。单线程gc，会冻结应用里的所有线程（Stop the world）。
> 你妈妈打扫卫生的时候，肯定让你出去，不太可能边打扫边让你扔垃圾。

### 特点
缺点：
- 不适用于server，server肯定无法忍受长时间停顿；
- 而且server内存大，要收集的内存越大，停顿的时间也就越长，

优点：
- 简单高效，就单线程效率来讲，其他垃圾收集器（线程交互等的开销）的单线程效率都没它高；

所以Serial GC很适合client模式的应用。而且client应用的内存都不会很大（远小于server动辄十来G的内存），如果只收集几百兆的新生代，速度也就几十毫秒。

**所以它依然是client模式JVM的默认新生代收集器。**

### 参数
- `-XX:+UseSerialGC`

## ParNew GC （新生代）
Serial的多线程版本。

### 参数
- `-XX:+UseParNewGC`
- `-XX:SurvivorRatio`

## Parallel GC （新生代） 吞吐量收集器
Java8/7的默认GC Collector。多线程，但是也会在gc的时候冻结线程。可以指定gc线程数和暂停时间。**主要专注的是吞吐量**（运行用户代码的时间/总时间），不让垃圾收集时间占比过高。

### 特点
**交互程序**停顿时间要短（STW时间短），**计算型任务**则需要更高效的利用CPU时间，专注吞吐量。所以它更适合后台计算型任务。

> GC停顿时间是以牺牲吞吐量和新生代空间换取的：为了减小GC停顿时间 ，新生代要调小，就能更快收集完。但是新生代小，收集的频率就会变高。在总GC时间占比上反而更多。所以吞吐量低。

能够GC自适应调节，（`-XX:+UseAdaptiveSizePolicy`），设置个堆大小`-Xmx`，再选个停顿优先（`-XX:ParallelGCThreads=<N>`）或者吞吐优先（`-XX:MaxGCPauseMillis=<N>`）就完事儿了。比ParNew方便。

### 参数
- `-XX:ParallelGCThreads=<N>`：gc线程数；
- `-XX:MaxGCPauseMillis=<N>`：最大垃圾收集停顿时间；
- `-XX:GCTimeRatio`：吞吐大小，1-99，设置为99代表垃圾收集时间为1% = （1/(1+99)）；
- `-XX:+UseAdaptiveSizePolicy`：自动设定新生代大小（`-Xmn`）等细节，自动设定Edam与Survivor的比例（`-XX:SurvivorRatio`），自动设定晋升老年代对象大小（`-XX:PretenureSizeThreshold`）；

## Serial Old （老年代）
给client模式JVM用的。

## Parallel Old （老年代）
之前Parallel只能和Serial Old组cp，白瞎了Parallel的性能。

干不过ParNew + CMS（Parallel不能和CMS组cp）。

Parallel + Parallel Old，一套，奥利给~

## CMS （老年代） 并发低停顿收集器
Concurrent Mark Sweep，专注于**最短回收停顿时间**。

有了上面的经验，一听就是给server使用的。

它基于Mark-Sweep算法，分为四个步骤：
- （STW） 初始标记；
- **并发**标记；
- （STW） 重新标记；
- **并发**清除；

1和3依然需要STW，但是初始标记很快，标记一下GC Roots能直接关联到的对象就行。

并发标记是（深度/广度优先）遍历的过程。

重新标记是修正并发标记期间新产生的垃圾。

> 你妈妈打扫卫生的时候终于不用把你赶出去了：耗时最长的并发标记和并发清除期间，终于也可以继续边玩边扔垃圾了~

### 特点
优点：
- 低停顿；

缺点：
- GC耗费CPU太多，导致吞吐量降低；
- 浮动垃圾无法处理：并发清理的时候，还会产生新垃圾，这些垃圾到下次清理的时候才能处理掉。所以CMS不能等老年代快满了才收集，必须预留一部分空间，没满就得开始收集；
- Mark-Sweep会产生碎片，随意得过一段执行一次Compact；

如果CMS运行期间浮动垃圾塞满预留内存了，“Concurrent Mode Failure”，临时启动Serial Old收集器，停顿时间反而更长了。

### 参数
- `-XX:+UseConcMarkSweepGC`
- `-XX:CMSInitiatingOccupancyFraction=<90>`：什么时候开始CMS GC（得预留空间给浮动垃圾）；
- `-XXCMSFullGCsBeforeCompaction=<N>`：多少次不压缩的Full GC后，来一次带压缩的；

## G1 （~~新生代/老年代~~ Region） Garbage First
面向server，CMS终结者。所以CMS的**低停顿**、高并发，它都有。它还能空间整合，不产生碎片，建立**可预测的GC停顿**。

G1保留了新生代老年代的概念，但**不再在物理上隔离新生代老年代**，而是将Heap分成许多大小相当的区域（Region），Mark的时候记录下所有Region的回收价值，哪个能回收最多垃圾就先回收哪个（**所以叫Garbage First**）。所以G1能够在指定时间内最高效回收垃圾，建立**可预测的停顿时间**模型。

参阅：
- https://www.baeldung.com/jvm-garbage-collectors

# 其他
## Minor GC vs. Major GC
- Minor GC：新生代GC，很频繁，也很快；
- Major GC / Full GC：老年代GC，一般伴随Minor GC，一般比Minor GC慢十倍以上；

**Full GC触发条件**：

只要老年代的连续空间大于新生代对象总大小，或者大于历次晋升到老年代的平均大小，就继续Minor GC，**否则Full GC**（担保人也没钱了，担不起风险了，所以处理一下担保人的垃圾，以留出足够的担保金）。

## 大对象直接晋升到老年代
是为了**避免大对象（很长的字符串、数组等）在Eden、Survivor之间大量内存复制**。所以放入老年代。但是如果是朝生夕死的大对象……JVM自闭了……

## JVM GC详细日志
> -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution

参阅：
- https://www.baeldung.com/java-verbose-gc

## 禁用GC Rotation log
Rolling log的弊端：

假设使用`-XX:GCLogFileSize=200M`参数，则每个log200M，`-XX:NumberOfGCLogFiles=3`，写满0,1,2之后又开始回写0，原来的0被覆盖了。即使文件名带时间戳，3个文件用的是同一个文件名仅仅后缀1,2,3不同。所以还是会覆盖。
1. 写一圈之后覆盖开始的gc log，log丢了；
2. jdk重启会覆盖同名gc log……；
3. 太碎了，相分析日志得dump多个日志文件；

综上，不如：使用单个带时间戳的log，别rotation了。
> `-Xloggc:logs/gc.log.%t`

参阅：
- https://dzone.com/articles/try-to-avoid-xxusegclogfilerotation

## OutOfMemory Dump

> -XX:+HeapDumpOnOutOfMemoryError 
>
> -XX:HeapDumpPath=./java_pid<pid>.hprof
>
> -XX:OnOutOfMemoryError="< cmd args >;< cmd args >"
>
> -XX:+UseGCOverheadLimit

参阅：
- https://www.baeldung.com/jvm-parameters#handling-out-of-memory

# TODO
Z collector

