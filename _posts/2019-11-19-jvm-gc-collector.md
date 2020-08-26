---
layout: post
title: "JVM GC算法与实现"
date: 2019-11-19 02:30:19 +0800
categories: Java JVM GC
tags: Java JVM GC
---

垃圾回收（Garbage Collection，GC）是JVM的重要特性之一。既然JVM自己管理着一大堆线程，自然也要随时打扫线程留下的垃圾，维护JVM的生态平衡。对于小程序，不太需要考虑垃圾收集，但是在高并发、多线程、多处理器的场景下，GC造成的性能影响可能会成为程序的瓶颈。

主要参阅Oracle系列文章： https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/

1. Table of Contents, ordered                    
{:toc}

了解垃圾回收之前，需要先了解[JVM运行时数据区]({% post_url 2019-11-18-jvm-area %})。

# 什么是垃圾
那些不被引用的对象，将不会再被用到，称为JVM里的垃圾。

# 如何标记垃圾 - 可达性分析 Reachability Analysis
将一系列称为GC Roots的对象作为起点，进行遍历（可以理解为深度优先或广度优先遍历），一遍下来，没被遍历到的对象就是垃圾。

所以关键点在于选好GC Roots，一般是：
- 栈stack中引用的对象；
- native method stack中引用的对象；
- 方法区类静态属性引用的对象；
- 方法区中常量引用的对象；

> ~~引用计数法~~：标记一个对象被引用的次数，如果有其他对象引用该对象，就不认为它是垃圾，否则认为是可清理的垃圾。但是**JVM从没用这种方法**来进行过垃圾标记。因为它缺点很明显，如果一堆垃圾对象相互引用，那岂不是对他们没辙了！如果你认为JVM团队会使用这种不靠谱的方法进行垃圾标记，那只能说明不靠谱的人是你……

# 为什么要分代
标记垃圾最直观的做法就是JVM里的所有可达对象进行迭代。这种方法**所花的时间和存活对象的数目成正比（跟垃圾对象的数目并没有什么关系）**。对于一个充斥着大量存活对象的大型应用，这种朴素的方法显然耗时也比较严重。

> 当规模变大，一个朴素的思路往往需要被改进，引入的概念和各种机制也会越来越复杂。JVM GC算法就是一个很明显的例子。

二八定律在JVM里同样适用：大量的对象都是很快不被需要的（die young），比如迭代器对象，出了for循环就不被需要了，只有少数对象才会存活很长的时间。

所以JVM内存被分代（generation），当一个generation满了之后，只对该generation进行垃圾收集。

大量朝生夕死的对象都被放在新生代，只要满了就进行**minor collection**。因为标记所花的时间和存活对象成正比，所以minor gc很快。而如果某些新生代的对象经过好几次minor gc依然存在，就不用一次次遍历他（浪费时间），干脆把它扔到老年代。最终老年代里的对象也会越来越多，触发一次**major collection**，整个heap都进行一次垃圾回收。显然major gc会花费比minor gc大得多的时间：涉及到更多的对象。

所以分代的好处：
1. 拆分内存区域，每次只清理其中一块区域的垃圾，而不用考虑整个jvm内存；
2. 尝试将存活对象按照生命长短放在不同的代，清理新生代时防止标记太多无法被清理掉的存活对象浪费时间。

> 反过来想，如果不分代，jvm内存还是会很快就被大量朝生夕死的对象充斥，每次就要对整个jvm区域的对象进行可达性标记，gc频率并不会比minor gc低多少。如果不让对象晋升到老年代，每次minor gc都需要标记那些暂时不死的对象，浪费时间。

> https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/generations.html

# 大内存就好吗？
先定义两个指标：
- 吞吐量：程序不花在gc上的时间的百分比。显然gc占用时间越长，系统处理其他事的时间越短，吞吐量越低；
- 暂停时间：一次忙于gc导致系统不响应的时间；

显然，内存大，垃圾填满jvm所需的时间就更长，会降低gc的频率，从而提升程序的吞吐量（throughput）。然而，内存区域过大就会导致一次gc遍历的对象变多，暂停时间变长。

所以即使系统资源冲突，盲目增加jvm内存也是不科学的。

> 分代其实就是在将大的内存区域拆分成小块。所以除非内存不够用，否则为什么要“逆势而为”呢？

# 垃圾收集算法
gc的工作方式就两步：
- mark：标记垃圾；
- sweep：清理垃圾；

## Mark-Sweep 标记-清除 算法
1. 标记垃圾；
2. 清除垃圾；

最基础的算法，后续算法都是在这个思路上进行的改进。

缺点：
- 内存碎片：清理之后产生大量不连续空间；

## Mark-Compact 标记-压缩 算法
Mark-Compact和Mark-Sweep类似，先标记所有垃圾，接下来是把存活对象往一头挪。这样另一头就是垃圾空间，直接清空就行了。

## Copying 复制 算法
内存分两半，一次用一半，这一半快满了，就把有用的对象拷贝到另一半，然后用另一半。这一半就算是清空了。然后另一半也快满了，就再复制到这一半，一直循环。

优点：
- 简单，不会有内存碎片；

缺点：
- 可用内存直接减半……

虽然这个算法听起来很蠢，但是用这种思路搞新生代的垃圾回收非常奏效。

## Generational Collection 分代收集 算法
将Heap分为新生代和老年代，新生代Copying算法，老年代Mark-Sweep/Compact算法。

### 新生代
把内存中“朝生夕死”的对象统一放到叫做**新生代**的地方。

以下是**CMS对新生代的划分**：

不需要把新生代分成两等份，因为新生代的对象死得快，基本一次能回收98%的空间，所以考虑把新生代按照`8:1:1`的比例分成一大两小三块，分别称为**Eden**，**Survivor-1**，**Survivor-2**。一次回收，把Eden+一块Survivor的活下来的对象放到另一块Survivor。

绝大多数情况下，因为新生代剩不下几个对象，所以另一小块Survivor够用。这么看来，只有10%（也就是一个Survivor）的空间没有被用上。内存使用效率上可以接受了。

但是，除非按照1:1的比例分成两块，按照Copying算法做，否则总有Eden+Survivor活下来的对象另一块Survivor装不下的情况。怎么解决？

需要另一块内存，作为担保：如果这个Survivor放不下，就先放到他那里去。这个担保就是**老年代**。

### 老年代
老年代不可能用Copying算法，因为一次清理剩下来的对象还有很多，拷贝太多对象效率显然不会高。

而且Copying算法如果不想1:1浪费50%的空间，就要有额外的担保空间，总不能给老年代再来一块担保空间吧？

老年代一般使用Mark-Sweep或者Mark-Compact：
- 显然Copying不适合存活率高的老年代；
- 而且另Mark-xxx算法不需要额外的分配担保；

# 垃圾收集器
基于上述思想和算法，实践中产生了多种垃圾收集器。

垃圾收集器主要可分成三大类：
1. serial collector
    - 单线程收集器
2. parallel collector
    - **并行**收集器。注意并不“并发”。和单线程收集器相比只是线程变多了。
3. concurrent collector
    - CMS/G1。**并发**收集器。**和程序的业务逻辑线程“并发”执行，所以程序不会失去响应**。
    - 但是并发就会涉及到线程之间的抢占、通信，导致gc线程的效率不如并行收集器里的gc线程。可以理解为并行收集器的线程更专注于清垃圾（不用线程间考虑并发），所用总时间更短。

**所以parallel collector吞吐量更高，但是concurrent collector不会让程序停顿时间过长。**

> 这正是并发的意义所在啊：对于多线程系统，及时将时间片交给每一个线程，从而保证每一个线程都有不错的响应性。

> https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/collectors.html

## Serial GC （新生代）
最简单最基本的collector。单线程gc，会冻结应用里的所有线程（Stop the world）。
> 你妈妈打扫卫生的时候，肯定让你出去，不太可能边打扫边让你“扔”垃圾。注意这里的“扔”其实不是很符合jvm产生垃圾的场景，因为jvm在gc时产生垃圾实际是因为某些gc开始时还在被需要的对象，在gc过程中不再被需要了。相当于你妈妈在打扫卫生，清除地面上的垃圾时，地上一些原本有用的玩具“突然被你指定为垃圾”了。

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

> https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/collectors.html

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

> https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/parallel.html

## Serial Old （老年代）
给client模式JVM用的。

## Parallel Old （老年代）
之前Parallel只能和Serial Old组cp，白瞎了Parallel的性能。

干不过ParNew + CMS（Parallel不能和CMS组cp）。

Parallel + Parallel Old，一套，奥利给~

# Concurrent Collector
如前所述，并发收集器牺牲了处理器资源（一部分时间浪费在线程并发上）用来交换更短的major collection pause。但是如果cpu核数更多，因为并发导致的cpu资源减少的影响会变小，并发gc的好处（pause时间小）就更凸显了。

另外需要注意的是，**减少停顿时间主要是减少major gc的停顿时间，minor gc本身就挺短的，应用线程虽然会在minor gc的时候停止（STW），但是影响不大。**

> STOP THE WORLD：仅指应用线程暂停了。

> https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/concurrent.html

## CMS （老年代） 并发低停顿收集器
Concurrent Mark Sweep，专注于**最短回收停顿时间**。

有了上面的经验，一听就是给server使用的。

CMS是分代的收集器（上面说的eden/survivor/old gen其实描述的就是CMS的内存划分）。通过让标记可达对象的gc线程和应用线程并发执行，实现了不停顿的major gc。

它基于Mark-Sweep算法，尝试减少major gc的暂停时间，分为四个步骤：
- （STW） 初始标记：
    - 标记GC Roots对象；
- **并发**标记：
    - 根据GC Roots对象trace reachable object，和应用线程并发执行，所以不会STW；
- （STW） 重新标记：
    - 上一步由于应用线程也在执行，有些对象也许不可达了，需要重新标一下。**类似于非并发标记的STW流程，但由于不需要全部标记，只需要调整一些标记，所以肯定比非并发的STW短多了**；
- **并发**清除：
    - sweep unreachable object，也是和应用线程并发执行，不会STW。**但是类似于并发标记会产生浮动垃圾，并发清除也会，而且后续没有类似“重新标记给并发标记擦屁股”的步骤**。

> 你妈妈打扫卫生的时候终于不用把你赶出去了：耗时最长的并发标记和并发清除期间，终于也可以继续边玩边“扔”垃圾了~

**remark pause是主要的STW阶段，initial pause很短。**

有趣的是，young gc和old gen gc不会同时重叠发生，但是可能会连续发生。上文提到young gc会STW（但是会很快，所以不用特别在意），如果和CMS连起来，young gc的STW接上CMS的STW，就会显得pause很长，所以CMS会尝试在两次young gc的中间执行remark步骤，将remark pause放在这里发生。但是initial mark pause暂时不用这么搞，因为它比remark pause短得多：

> The pauses for the young generation collection and the tenured generation collection occur independently. They do not overlap, but may occur in quick succession such that the pause from one collection, immediately followed by one from the other collection, can appear to be a single, longer pause. To avoid this, the CMS collector attempts to schedule the remark pause roughly midway between the previous and next young generation pauses. This scheduling is currently not done for the initial mark pause, which is usually much shorter than the remark pause.

### 特点
优点：
- 低停顿；

缺点：
- 并发耗费额外CPU，导致吞吐量降低；
- 浮动垃圾无法处理：并发清理的时候，还会产生新垃圾（**原本标记的可达的对象现在不被需要了，不可达了**），这些垃圾到下次清理的时候才能处理掉。所以CMS不能等老年代快满了才收集，必须预留一部分空间，没满就得开始收集；
- Mark-Sweep会产生碎片，得过一段执行一次Compact；
- 如果CMS运行期间浮动垃圾塞满预留内存了，会发生**Concurrent Mode Failure**，临时启动Serial Old收集器，停顿时间反而更长了。

### 参数
- `-XX:+UseConcMarkSweepGC`
- `-XX:CMSInitiatingOccupancyFraction=<90>`：什么时候开始CMS GC（得预留空间给浮动垃圾）；
- `-XXCMSFullGCsBeforeCompaction=<N>`：多少次不压缩的Full GC后，来一次带压缩的；

> https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/cms.html

## G1 - Garbage First
虽然CMS能够并发（with应用线程）清理垃圾，让并发标记和并发清理两个大的耗时阶段不再STW，但是如果应用内存越来越大，要清理的代的空间变大了，整个CMS的垃圾清理时间和其中STW阶段的时间也还是会被拉长。

所以G1的主要目的是为大内存应用、面向server、多处理器场景提供更有的GC解决方案。

G1又被称为CMS终结者。CMS的**低停顿**、高并发，它都有。它还能空间整合，不产生碎片，建立**可预测的GC停顿**。

### 怎么解决大内存的清理 - Region
CMS在大内存场景下（heap > 6GB），要清理的区域变大，时间延长，这是必然的。假设回收速度不能变得更快，想缩减时间只能是将内存区域减小，且每次只回收其中的一些区域。

G1就是将heap分为一堆大小相等的region（大概不超过2048个，每块1-32MB），在逻辑上，每个region都是一块内存连续的区域。并发标记阶段完成后，G1可以统计每个region的垃圾数，先挑垃圾最多的区域回收（Garbage First）。G1会根据暂停预测模型（基于之前收集的结果，预测这次在目标时间内能收集多少region）尽量满足用户定义的暂停目标，根据目标决定要收集的region的数量。

> 如果时间来不及，只要把垃圾最多的几块收集完，就能腾出大部分空间了。又是一个二八定律的应用。

### compact
G1将多个region的存活对象拷贝到另一个region里，既收集了region里的垃圾，又把对象区域变得紧凑（compact），防止出现太多的内存碎片，一举两得。

> CMS不能compact，Parallel collector必须一次清理整个heap，pause太久。G1则能解决以上问题。

### G1的分代
G1的分代不同于CMS（两个survivor，一个Eden，一个Old Gen）。G1保留了新生代老年代的概念，但**不再在物理上指定新生代老年代**，而是将一些region指定为逻辑上的新生代老年代，所以survivor/eden/老年代都不再连续了。垃圾收集时会将新生代region的存活对象拷贝到survivor或者old region区域（根据对象的存活年龄）。还有一部分region作为H（humongous），专门存放大槻响。

### 浮动垃圾 - SATB
类似CMS。**罪魁祸首是并发标记**：gc线程和应用线程并发执行，gc线程标记存活对象的时候，应用线程将某些对象的引用关系改变了。

比如Root为对象A，指向B和C，C还指向D。gc线程标记完B为存活对象，开始标记C，此时应用线程将C指向D的引用改为B指向D，gc线程标记完C之后发现标记流程结束了。此时D未被标记，被认为是垃圾。但此时D是被B引用的，是有用的对象，如果把D回收了，程序就出错了。

> 漏标存活对象，会导致存活对象被当成垃圾回收，程序出错。

jvm用三种颜色标识对象：
- black：标记完了该对象以及该对象的引用；
- grey：只标记了该对象，还没标记完其引用；
- white：未标记该对象。

显然标记完后如果对象还为white，就是垃圾。

漏标的充要条件是：删除所有grey对象到某white对象的引用，并将其插入到black对象上。直接剥夺了white对象被标记的机会。

上述场景将gery对象（C）到white对象（D）的引用删除了，并插入到了black对象（B）上，导致D始终是white。

防止漏标的方式也很简单：记录下这些更改即可。G1使用SATB（snapshot at the beginning），记录删掉所有grey对象到white对象的引用的情况，所有这些被删掉的引用指向的white对象，不再认为是垃圾。从而达到了“**并发标记开始阶段不是垃圾的对象，就不认为是垃圾**”的效果。

> 这些white对象被重新标记，是在重新标记阶段做的事情，这个阶段需要STW，要不然还会出现上述情况，没有终结了。

但这么搞明显是“宁愿放过垃圾，不能错杀对象”：如果C到D的引用被删了之后，并没有插到B上，那D的确应该是垃圾。但是按照STAB的处理方式，D一开始不是垃圾，所以D在并发标记阶段结束后，也不被认为是垃圾。相当于在并发标记阶段产生的垃圾（**浮动垃圾**）可能被错误地保留下来，本次gc就回收不了这种垃圾了。

> https://www.jianshu.com/p/cc6b98b1640e

### RSet
如果垃圾回收一次不清理整个heap，垃圾回收器需要知道不回收的部分有没有指向回收部分的指针。在分代的heap里，一次垃圾回收，不回收的部分一般是老年代，回收的部分是新生代。

如果不事先**标记老年代是否指向新生代**，就要遍历扫描整个老年代，太耗时间。G1使用Rset（remembered set）来做这个记录，典型的以空间换时间。**RSet记录了哪些老年代有指向该新生代的指针**，通过RSet，只需要扫描该老年代区域，就能知道新生代里哪些对象能被清理，哪些不能被清理。

**RSet避免了对整个老年代的扫描**。

### 阶段
根据oracle的描述：
- https://docs.oracle.com/javase/9/gctuning/garbage-first-garbage-collector.htm#JSGCT-GUID-ED3AB6D3-FD9B-4447-9EDF-983ED2F7A573
- https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc_tuning.html

[](https://docs.oracle.com/javase/9/gctuning/img/jsgct_dt_001_grbgcltncyl.png)

1. **young**：正常情况下，只标记回收新生代；
2. **mixed**：老年代达到`-XX:InitiatingHeapOccupancyPercent`指定的比例之后，标记阶段也会标记老年代。回收完新生代之后，就会回收老年代；
3. **full**：如果内存耗尽了，会进行一次Full GC，整个heap都要清理一遍，包括H区；
mixed collection会同时回收young gen和old gen。**收集old gen时不再需要RSet，而是对整个old gen进行标记**。默认heap使用45%时开始一次mixed collection：

也就是说，一开始犯不着搞老年代，只需要搞搞新生代就腾出足够的空间了。如果老年代占用比例过高，清完新生代之后再清清老年代。如果清老年代也不能腾出足够的空间，就要整个heap全部筛选一遍。

> 不知怎么的想到了外卖：很多新来的骑手不到一周就离职了。所以如果要回收装备给新来的骑手用，只需要从最近一周入职的骑手里排查，回收这些人中离职的那些人的装备就行了——排查最少的人，回收最多的装备，性价比很高。（虽然排查入职大于一周以上的那些人，还能再回收一部分装备，但是没必要这么折腾，反正收收新生代的就够用了。）如果待了一周以上的人达到一定比例，再去从他们离职的人中回收装备。（已经有一段时间不从他们手里回收了，现在回收一次应该也能收不少。）如果都回收了，收上来的装备还不够用，只能全体排查一遍，把所有离职的人的装备都收上来——能回收最多的装备，但是性价比要比从新生代回收低得多。

> As mentioned previously, both young and old regions are garbage collected in a mixed collection. To collect old regions, G1 does a complete marking of the live objects in the heap. Such a marking is done by a concurrent marking phase.

> A concurrent marking phase is started when the occupancy of the entire Java heap reaches the value of the parameter InitiatingHeapOccupancyPercent. Set the value of this parameter with the command-line option -XX:InitiatingHeapOccupancyPercent=<NN>. The default value of InitiatingHeapOccupancyPercent is 45.

### 参数
- `-XX:G1HeapRegionSize=n`
- `-XX:MaxGCPauseMillis=200`
- `-XX:G1NewSizePercent=5`/`-XX:G1MaxNewSizePercent=60`：young gen占heap的比例；
- `-XX:G1MaxNewSizePercent=60`：STW worker thread。核数不超过8，n为核数，超过8，n=5/16的核数；
- `-XX:ConcGCThreads=n`：并发标记线程数；
- `-XX:InitiatingHeapOccupancyPercent=45`：heap用45%时触发一次mixed collection；
- 

参阅：
- https://www.baeldung.com/jvm-garbage-collectors
- https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc.html
- https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc_tuning.html
- https://mp.weixin.qq.com/s/vmnBlrM7pTtVuyQU-GTcPw

# G1 logs
- https://blogs.oracle.com/poonam/understanding-g1-gc-logs
- https://www.jianshu.com/p/ab37844d0e9e

# Z collector
- https://wiki.openjdk.java.net/display/zgc/Main

# 垃圾收集器总结
学一个东西，如果能知道它是怎么来的，一定更能注意到这项技术的特点，印象深刻，学的时候也会轻松许多。

垃圾收集最朴素的思想就是标记存活对象，留下这些对象，其他对象所在的内存区域直接覆盖掉即可。如果单线程stop the world的方式去搞，便不会有什么问题，垃圾收集就是一件很简单的事情。唯一的缺陷，就是这么做相对较慢。程序停一下？高并发服务端并不能接受。

怎么优化？先把单线程搞成多线程的，分而治之，清理起来速度就快了。但是这个时候只是gc垃圾收集线程之间的并行（parallel），并不是gc垃圾收集线程和应用程序线程之间的并发（concurrency），程序还是要停一下。

CMS相较于之前的并行收集器，真正迈入了并发：gc垃圾收集线程收集的时候，应用程序线程也可以继续工作。但是后者会干扰前者，导致个别对象标记不准确：要么漏标存活对象，要么错误将垃圾对象标记为存活对象。后者无伤大雅，前者一定要解决掉，所以在并发标记之后再stop the world一下，理一理并发标记期间被应用程序线程修改的对象。虽然还是要STW，但是相对于并行收集器从到到尾都在STW，并发收集器只是最大限度地进行了并发，只不得不停了一小段时间。

G1类似CMS，但是随着硬件的发展，server程序的内存也越来越大，房子大了东西多了打扫起来也就更慢了。怎么缩短收集的时间？除了动作麻利点儿以外，提出了新的策略：大房子分成小块，如果给的时间不够清理完整个heap，那就优先清理垃圾最多的块。这样在有限的时间内，也能尽最大可能腾出较多的空间。

**另外分代是个很二八的理念，和Garbge First的思想类似：用最少的努力，排查最少的区域，回收最多的空间**。实在排查不出来，再去老年代。如果还不行，就full gc。

# 其他
## Minor GC vs. Major GC （该理论更适合CMS）
- Minor GC：新生代GC，很频繁，也很快；
- Major GC / Full GC：老年代GC，一般伴随Minor GC，一般比Minor GC慢十倍以上；

**Full GC触发条件**：

只要老年代的连续空间大于新生代对象总大小，或者大于历次晋升到老年代的平均大小，就继续Minor GC，**否则Full GC**（担保人也没钱了，担不起风险了，所以处理一下担保人的垃圾，以留出足够的担保金）。

## 大对象直接晋升到老年代
是为了**避免大对象（很长的字符串、数组等）在Eden、Survivor之间大量内存复制**。所以放入老年代。但是如果是朝生夕死的大对象……JVM自闭了……

## JVM打印GC详细日志
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

比如：
> -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution
                        -Xloggc:logs/gc.log.%t

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

## 命令行使用jvm参数
eg: 
```
java -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=10 -XX:G1MaxNewSizePercent=75 G1test.jar
```

