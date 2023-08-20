---
layout: post
title: "JVM垃圾收集"
date: 2019-11-19 02:30:19 +0800
categories: Java JVM GC
tags: Java JVM GC
---

垃圾回收（Garbage Collection，GC）是JVM的重要特性之一。既然JVM自己管理着一大堆线程，自然也要随时打扫线程留下的垃圾，维护JVM的生态平衡。对于小程序，不太需要考虑垃圾收集，但是在高并发、多线程、多处理器的场景下，GC造成的性能影响可能会成为程序的瓶颈。

> 主要参阅[Oracle系列文章](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/)

1. Table of Contents, ordered                    
{:toc}

了解垃圾回收之前，需要先了解[JVM运行时数据区]({% post_url 2019-11-18-jvm-area %})。

# 什么是垃圾
那些不被引用的对象，将不会再被用到，称为JVM里的垃圾。

# 标记垃圾
jvm里用到的垃圾标记算法主要是可达性分析 Reachability Analysis，以标记出所有在用的对象。其实就是找一些在用的对象作为起点，那么这些对象正在引用的对象也不是垃圾，一路标记对象（可以理解为深度优先或广度优先遍历），最终没有被标记到的对象就是垃圾。

> ~~引用计数法~~：标记一个对象被引用的次数，如果有其他对象引用该对象，就不认为它是垃圾，否则认为是可清理的垃圾。但是**JVM从没用这种方法**来进行过垃圾标记。因为它缺点很明显，如果一堆垃圾对象相互引用，那岂不是对他们没辙了！如果你认为JVM团队会使用这种不靠谱的方法进行垃圾标记，那只能说明不靠谱的人是你……

jvm的垃圾收集器不使用引用式垃圾收集（reference counting gc），全都是追踪式垃圾收集（tracing gc）。

## 从哪里开始（stop the world）
可以将一系列称为**GC Roots**的对象作为起点，一般是：
- **栈stack（包括native method stack）中引用的对象**；
- 方法区类静态属性引用的对象；
- 方法区中常量引用的对象；

GC Roots很好理解，**栈上的对象引用、方法区引用的常量和静态属性**，这些都是在用的对象。

> 但是根据实际处理方案，remembered set里的对象也会加入gc roots。见下文。

**迄今为止，所有的垃圾收集器在做gc roots枚举的时候都要暂停所有的用户线程，对用户来说，相当于Stop The World。唯一的安慰在于，gc roots的标记和heap大小是无关的，可以认为是O(1)操作，所以这个stop the world是可以接受的**。

## 如何遍历（并发）
**对象的引用关系相当于一个单向图**，所以直观来看遍历是比较简单的。但是**在遍历标记过程中，用户线程是可能改变现有对象的引用关系的，导致标记出错**。如果暂定用户线程，这种困难也就迎刃而解了。但是，**这样相当于又来了一次stop the world。更致命的是，整个jvm里对象的数量肯定是和heap大小相关的，相当于是O(n)操作，所以这里的标记时间肯定是偏长的**。

> 所花的时间和存活对象的数目成正比（跟垃圾对象的数目并没有什么关系）。

因此，前期的垃圾收集器会stop the world、串行收集。但是**随着jvm的heap越来越大，后来发展出的优秀的垃圾收集器会避免在标记的时候stop the world，且会采用并发标记**。

怎么做到并发标记垃圾（不暂停用户线程）？其实就是防止在标记过程中，用户线程修改对象引用，导致非垃圾被误标记为垃圾。有两种解决方案：
- 增量更新
- 原始快照SATB

# 垃圾收集理论
理论是设计算法的依据。

## 为什么要分代
**标记垃圾最直观的做法就是JVM里的所有可达对象进行迭代**，但上面已经说了它是O(n)操作。对于一个充斥着大量存活对象的大型应用，这种朴素的方法显然耗时也比较严重。

> 当规模变大，一个朴素的思路往往需要被改进，引入的概念和各种机制也会越来越复杂。JVM GC算法就是一个很明显的例子。

**二八定律**在JVM里同样适用：大量的对象都是很快不被需要的（die young），比如迭代器对象，出了for循环就不被需要了，只有少数对象才会存活很长的时间。

所以JVM内存被[分代（generation）](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/generations.html)，当一个generation满了之后，只对该generation进行垃圾收集。

大量朝生夕死的对象都被放在新生代，只要满了就进行**minor collection**。因为标记所花的时间和存活对象成正比，所以minor gc很快。而如果某些新生代的对象经过好几次minor gc依然存在，就不用一次次遍历他（浪费时间），干脆把它扔到老年代。最终老年代里的对象也会越来越多，触发一次**major collection**，整个heap都进行一次垃圾回收。显然major gc会花费比minor gc大得多的时间：涉及到更多的对象。

所以分代的好处：
1. 拆分内存区域，每次只清理其中一块区域的垃圾，而不用考虑整个jvm内存；
2. 尝试将存活对象按照生命长短放在不同的代，清理新生代时防止标记太多无法被清理掉的存活对象浪费时间。

最终，**以较低的代价回收到了大量的空间**。

> 反过来想，如果不分代，jvm内存还是会很快就被大量朝生夕死的对象充斥，每次就要对整个jvm区域的对象进行可达性标记，gc频率并不会比minor gc低多少。如果不让对象晋升到老年代，每次minor gc都需要标记那些暂时不死的对象，浪费时间。

**那么新生代和老年代谁更大呢**？新生代由`-Xmn`控制大小，sun建议配置为整个堆大小的3/8，所以显然老年代更大。因为它还要为新生代做担保。

## 跨代引用
分代说起来简单，但实际上对象并不是孤立的，老年代的对象就不会引用新生代的对象了吗？这么一来，想收集新生代，依然需要遍历老年代，以确定新生代的哪些对象是有用的。**这不相当于还是要遍历整个heap**？

但是根据经验，**跨代引用相当于本代引用来说是少数**。所以**没必要为了少量的跨代引用扫描整个老年代**，只需要在新生代上建立一个remembered set，**记录老年代的哪一小块区域存在跨代引用，在收集这个新生代的时候，把它的remembered set里记录的那些小块老年代里的对象加入到gc roots就行了**。

### 大内存就好吗？
先定义两个指标：
- 吞吐量：程序不花在gc上的时间的百分比。显然gc占用时间越长，系统处理其他事的时间越短，吞吐量越低；
- 暂停时间：一次忙于gc导致系统不响应的时间；

显然，内存大，垃圾填满jvm所需的时间就更长，会降低gc的频率，从而提升程序的吞吐量（throughput）。然而，内存区域过大就会导致一次gc遍历的对象变多，暂停时间变长。

所以即使系统资源充足，盲目增加jvm内存也是不科学的。

> 分代其实就是在将大的内存区域拆分成小块。所以除非内存不够用，否则为什么要“逆势而为”呢？

## 不同类型的gc
- partial gc：不收集整个jvm
    + minor gc/young gc：收集新生代
    + major gc/old gc：收集老年代。目前只有CMS会只收集老年代
    + mixed gc：收集整个新生代以及部分老年代。目前只有G1会mixed gc
- full gc：收集整个heap和方法区

**Full GC触发条件**：

只要老年代的连续空间大于新生代对象总大小，或者大于历次晋升到老年代的平均大小，就继续Minor GC，**否则Full GC**（担保人也没钱了，担不起风险了，所以处理一下担保人的垃圾，以留出足够的担保金）。

# 垃圾收集算法

gc的工作方式就两步：
- mark：标记垃圾；
- sweep：清理垃圾；

## Mark-Sweep

> 标记-清除 算法

1. 标记垃圾；
2. 清除垃圾；

最基础的算法，后续算法都是在这个思路上进行的改进。

缺点：
- 内存碎片：清理之后产生大量不连续空间；

## Mark-Copying

> 标记-复制 算法

内存分两半，一次用一半，这一半快满了，就把有用的对象拷贝到另一半，然后用另一半。这一半就算是清空了。然后另一半也快满了，就再复制到这一半，一直循环。

优点：
- 简单，不会有内存碎片；

缺点：
- 可用内存直接减半……

虽然这个算法听起来很蠢，但是用这种思路搞新生代的垃圾回收非常奏效。以下是**CMS对新生代的划分**：

不需要把新生代分成两等份，因为新生代的对象死得快，基本一次能回收98%的空间，所以考虑把新生代按照`8:1:1`的比例分成一大两小三块，分别称为**Eden**，**Survivor-1**，**Survivor-2**。一次回收，把Eden+一块Survivor的活下来的对象放到另一块Survivor。

绝大多数情况下，因为新生代剩不下几个对象，所以另一小块Survivor够用。这么看来，只有10%（也就是一个Survivor）的空间没有被用上。内存使用效率上可以接受了。

但是，除非按照1:1的比例分成两块，按照Copying算法做，否则总有Eden+Survivor活下来的对象另一块Survivor装不下的情况。怎么解决？

需要另一块内存，作为担保：如果这个Survivor放不下，就先放到他那里去。这个担保就是**老年代**。

## Mark-Compact

> 标记-整理（压缩） 算法

Mark-Compact和Mark-Sweep类似，先标记所有垃圾，接下来是把存活对象往一头挪。这样另一头就是垃圾空间，直接清空就行了。

老年代不可能用Copying算法，因为一次清理剩下来的对象还有很多，拷贝太多对象效率显然不会高。

而且Copying算法如果不想1:1浪费50%的空间，就要有额外的担保空间，总不能给老年代再来一块担保空间吧？

老年代一般使用Mark-Sweep或者Mark-Compact：
- 显然Copying不适合存活率高的老年代；
- 而且另Mark-xxx算法不需要额外的分配担保；

# 垃圾收集器
基于上述思想和算法，实践中产生了[多种垃圾收集器](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/collectors.html)。

垃圾收集器目前主要可分成三大类：
1. 简单垃圾收集器：只要stop the world，一切都变得简单了
    1. serial collector
        - 单线程收集器
    2. parallel collector
        - **并行**收集器。注意并不“并发”。和单线程收集器相比只是线程变多了。
2. concurrent collector：**尽量减少STW**
    - CMS/G1。**并发**收集器。**和程序的业务逻辑线程“并发”执行，所以程序不会失去响应**。
3. 低延迟垃圾收集器
    - 极致的优化，极力避免STW

之前说过，**标记gc roots时候的stop the world是不可避免的。但是对象tracing的过程是可以不stop the world的**，这就是并发收集器的长处——对用户线程来说，并发收集器拥有着更短暂的停顿时间，不会让程序停顿时间过长。虽然parallel collector的吞吐量更高，但是**用户一般更关注自己的业务线程不会被卡太久**。

> 这正是并发的意义所在啊：对于多线程系统，及时将时间片交给每一个线程，从而保证每一个线程都有不错的响应性。

## 早期垃圾收集器
### Serial GC （新生代）
最简单最基本的collector。单线程gc，会冻结应用里的所有线程（Stop the world）。
> 你妈妈打扫卫生的时候，肯定让你出去，不太可能边打扫边让你“扔”垃圾。注意这里的“扔”其实不是很符合jvm产生垃圾的场景，因为jvm在gc时产生垃圾实际是因为某些gc开始时还在被需要的对象，在gc过程中不再被需要了。相当于你妈妈在打扫卫生，清除地面上的垃圾时，地上一些原本有用的玩具“突然被你指定为垃圾”了。

缺点：
- 不适用于server，server肯定无法忍受长时间停顿；
- 而且server内存大，要收集的内存越大，停顿的时间也就越长，

优点：
- 简单高效，就单线程效率来讲，其他垃圾收集器（线程交互等的开销）的单线程效率都没它高；

所以Serial GC很适合client模式的应用。而且client应用的内存都不会很大（远小于server动辄十来G的内存），如果只收集几百兆的新生代，速度也就几十毫秒。

**所以它依然是client模式JVM的默认新生代收集器。**

参数：
- `-XX:+UseSerialGC`

> https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/collectors.html

### ParNew GC （新生代）
Serial的多线程版本。

参数：
- `-XX:+UseParNewGC`
- `-XX:SurvivorRatio`

### Parallel GC （新生代）

> [吞吐量收集器](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/parallel.html)。因为不并发，所以收集的更快，自然gc用时最少，留给用户线程的cpu时间更多。

**Java8/7的默认GC Collector**。多线程，但是也会在gc的时候冻结线程。可以指定gc线程数和暂停时间。**主要专注的是吞吐量**（运行用户代码的时间/总时间），不让垃圾收集时间占比过高。

**交互程序**停顿时间要短（STW时间短），**计算型任务**则需要更高效的利用CPU时间，专注吞吐量。所以它更适合后台计算型任务。

> GC停顿时间是以牺牲吞吐量和新生代空间换取的：为了减小GC停顿时间 ，新生代要调小，就能更快收集完。但是新生代小，收集的频率就会变高。在总GC时间占比上反而更多。所以吞吐量低。

能够GC自适应调节，（`-XX:+UseAdaptiveSizePolicy`），设置个堆大小`-Xmx`，再选个停顿优先（`-XX:ParallelGCThreads=<N>`）或者吞吐优先（`-XX:MaxGCPauseMillis=<N>`）就完事儿了。比ParNew方便。

参数：
- `-XX:ParallelGCThreads=<N>`：gc线程数；
- `-XX:MaxGCPauseMillis=<N>`：最大垃圾收集停顿时间；
- `-XX:GCTimeRatio`：吞吐大小，1-99，设置为99代表垃圾收集时间为1% = （1/(1+99)）；
- `-XX:+UseAdaptiveSizePolicy`：自动设定新生代大小（`-Xmn`）等细节，自动设定Edam与Survivor的比例（`-XX:SurvivorRatio`），自动设定晋升老年代对象大小（`-XX:PretenureSizeThreshold`）；

### Serial Old （老年代）
给client模式JVM用的。

### Parallel Old （老年代）
之前Parallel只能和Serial Old组cp，白瞎了Parallel的性能。

干不过ParNew + CMS（Parallel不能和CMS组cp）。

Parallel + Parallel Old，一套。

## Concurrent Collector
如前所述，[并发收集器](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/concurrent.html)牺牲了处理器资源（一部分时间浪费在线程并发上）用来交换**更短的major collection pause**。但是如果cpu核数更多，因为并发导致的cpu资源减少的影响会变小，并发gc的好处（pause时间小）就更凸显了。

### CMS （老年代） 并发低停顿收集器
Concurrent Mark Sweep，专注于**最短回收停顿时间**。

> 有了上面的经验，一听就是给server使用的。

[CMS](https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/cms.html)是分代的收集器（上面说的eden/survivor/old gen其实描述的就是CMS的内存划分）。通过让标记可达对象的gc线程和应用线程并发执行，实现了不停顿的major gc。

它基于Mark-Sweep算法，尝试减少major gc的暂停时间，分为四个步骤：
- **（STW） 初始标记**：
    - 标记GC Roots对象；
- **并发**标记：
    - **根据GC Roots对象trace reachable object，和应用线程并发执行，所以不会STW**；
- （STW） 重新标记：
    - 上一步由于应用线程也在执行，有些对象也许不可达了，需要重新标一下。**类似于非并发标记的STW流程，但由于不需要全部标记，只需要调整一些标记，所以肯定比非并发的STW短多了**；
- **并发**清除：
    - sweep unreachable object，也是和应用线程并发执行，不会STW。**但是类似于并发标记会产生浮动垃圾，并发清除也会，而且后续没有类似“重新标记给并发标记擦屁股”的步骤**。

> 你妈妈打扫卫生的时候终于不用把你赶出去了：耗时最长的并发标记和并发清除期间，终于也可以继续边玩边“扔”垃圾了~

**remark pause是主要的STW阶段，initial pause很短。**

有趣的是，young gc和old gen gc不会同时重叠发生，但是可能会连续发生。上文提到young gc会STW（但是会很快，所以不用特别在意），如果和CMS连起来，young gc的STW接上CMS的STW，就会显得pause很长，所以CMS会尝试在两次young gc的中间执行remark步骤，将remark pause放在这里发生。但是initial mark pause暂时不用这么搞，因为它比remark pause短得多：

> The pauses for the young generation collection and the tenured generation collection occur independently. They do not overlap, but may occur in quick succession such that the pause from one collection, immediately followed by one from the other collection, can appear to be a single, longer pause. To avoid this, the CMS collector attempts to schedule the remark pause roughly midway between the previous and next young generation pauses. This scheduling is currently not done for the initial mark pause, which is usually much shorter than the remark pause.

优点：
- 低停顿；

缺点：
- 并发耗费额外CPU，导致吞吐量降低；
- 浮动垃圾无法处理：并发清理的时候，还会产生新垃圾（**原本标记的可达的对象现在不被需要了，不可达了**），这些垃圾到下次清理的时候才能处理掉。所以CMS不能等老年代快满了才收集，必须预留一部分空间，没满就得开始收集；
- Mark-Sweep会产生碎片，得过一段执行一次Compact；
- 如果CMS运行期间浮动垃圾塞满预留内存了，会发生**Concurrent Mode Failure**，临时启动Serial Old收集器，停顿时间反而更长了。

参数：
- `-XX:+UseConcMarkSweepGC`
- `-XX:CMSInitiatingOccupancyFraction=<90>`：什么时候开始CMS GC（得预留空间给浮动垃圾）；
- `-XXCMSFullGCsBeforeCompaction=<N>`：多少次不压缩的Full GC后，来一次带压缩的；

### G1 - Garbage First
虽然CMS能够并发（with应用线程）清理垃圾，让并发标记和并发清理两个大的耗时阶段不再STW，但是如果应用内存越来越大，要清理的代的空间变大了，整个CMS的垃圾清理时间和其中STW阶段的时间也还是会被拉长。

所以G1的主要目的是为大内存应用、面向server、多处理器场景提供更有的GC解决方案。

G1又被称为CMS终结者。CMS的**低停顿**、高并发，它都有。它还能空间整合，不产生碎片，建立**可预测的GC停顿**。

#### 怎么解决大内存的清理 - Region
CMS在大内存场景下（heap > 6GB），要清理的区域变大，时间延长，这是必然的。假设回收速度不能变得更快，想缩减时间只能是将内存区域减小，且每次只回收其中的一些区域。

G1就是将heap分为一堆大小相等的region（大概不超过2048个，每块1-32MB），在逻辑上，每个region都是一块内存连续的区域。并发标记阶段完成后，G1可以统计每个region的垃圾数，先挑垃圾最多的区域回收（Garbage First）。G1会根据暂停预测模型（基于之前收集的结果，预测这次在目标时间内能收集多少region）尽量满足用户定义的暂停目标，根据目标决定要收集的region的数量。

> 如果时间来不及，只要把垃圾最多的几块收集完，就能腾出大部分空间了。又是一个二八定律的应用。

G1将多个region的存活对象拷贝到另一个region里，既收集了region里的垃圾，又把对象区域变得紧凑（compact），防止出现太多的内存碎片，一举两得。

> CMS不能compact，Parallel collector必须一次清理整个heap，pause太久。G1则能解决以上问题。

G1的分代不同于CMS（两个survivor，一个Eden，一个Old Gen）。G1保留了新生代老年代的概念，但**不再在物理上指定新生代老年代**，而是将一些region指定为逻辑上的新生代老年代，所以survivor/eden/老年代都不再连续了。垃圾收集时会将新生代region的存活对象拷贝到survivor或者old region区域（根据对象的存活年龄）。还有一部分region作为H（humongous），专门存放大对象。

#### 浮动垃圾 - SATB
类似CMS。**罪魁祸首是并发标记**：gc线程和应用线程并发执行，gc线程标记存活对象的时候，应用线程将某些对象的引用关系改变了。

比如Root为对象A，指向B和C，C还指向D。gc线程标记完B为存活对象，开始标记C，此时应用线程将C指向D的引用改为B指向D，gc线程标记完C之后发现标记流程结束了。**此时D未被标记，被误认为是垃圾**。但此时D是被B引用的，是有用的对象，如果把D回收了，程序就出错了。

> 漏标存活对象，会导致存活对象被当成垃圾回收，程序出错。

jvm用三种颜色标识对象：
- black：标记完了该对象以及该对象的引用；
- grey：只标记了该对象，还没标记完其引用；
- white：未标记该对象。

显然标记完后如果对象还为white，就是垃圾。

漏标的充要条件是：**删除所有grey对象到某white对象的引用，并将其插入到black对象上**。直接剥夺了white对象被标记的机会。

上述场景将gery对象（C）到white对象（D）的引用删除了，并插入到了black对象（B）上，导致D始终是white。

防止漏标的方式也很简单：记录下这些更改即可。G1使用SATB（snapshot at the beginning），记录删掉所有grey对象到white对象的引用的情况，所有这些被删掉的引用指向的white对象，不再认为是垃圾。从而达到了“**并发标记开始阶段不是垃圾的对象，就不认为是垃圾**”的效果。

这些white对象被重新标记，**是在最终标记阶段做的事情，这个阶段也需要STW**，要不然还会出现上述情况，没有终结了。

> 但这么搞明显是“宁愿放过垃圾，不能错杀对象”：如果C到D的引用被删了之后，并没有插到B上，那D的确应该是垃圾。但是按照STAB的处理方式，D一开始不是垃圾，所以D在并发标记阶段结束后，也不被认为是垃圾。相当于在并发标记阶段产生的垃圾（**浮动垃圾**）可能被错误地保留下来，本次gc就回收不了这种垃圾了。
>
> 漏删垃圾是可以接受的，错删对象程序就错了。https://www.jianshu.com/p/cc6b98b1640e

所以G1的流程里有两个阶段会STW：
- **STW1**：初始标记（根据gc roots）；
- **并发**标记；
- **STW2**：最终标记，处理SATB里的记录；

但其实，最后清理垃圾的阶段也会STW：
- **STW3**：筛选回收。根据用户的期望，选择回收效益最高的几个region，清理对象；

清理对象涉及到对象的移动，之所以要STW，是因为简单。考虑到G1只回收一部分region，所以stw的时间是可控的，因此这里简单处理了，使用了stw。**ZGC则避免了这一点**。

#### Remembered Set
如果垃圾回收一次不清理整个heap，垃圾回收器需要知道不回收的部分有没有指向回收部分的指针。在分代的heap里，一次垃圾回收，不回收的部分一般是老年代，回收的部分是新生代。

**如果不事先标记老年代是否指向新生代，就要遍历扫描整个老年代，太耗时间**。G1使用Rset（remembered set）来做这个记录，典型的以空间换时间。**RSet记录了哪些老年代有指向该新生代的指针**，通过RSet，只需要扫描该老年代区域，就能知道新生代里哪些对象能被清理，哪些不能被清理。

**RSet避免了对整个老年代的扫描。况且，老年代比新生代大得多**。

参数：
- `-XX:G1HeapRegionSize=n`
- `-XX:MaxGCPauseMillis=200`
- `-XX:G1NewSizePercent=5`/`-XX:G1MaxNewSizePercent=60`：young gen占heap的比例；
- `-XX:G1MaxNewSizePercent=60`：STW worker thread。核数不超过8，n为核数，超过8，n=5/16的核数；
- `-XX:ConcGCThreads=n`：并发标记线程数；
- `-XX:InitiatingHeapOccupancyPercent=45`：heap用45%时触发一次mixed collection；

参阅：
- https://www.baeldung.com/jvm-garbage-collectors
- https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc.html
- https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/g1_gc_tuning.html
- https://mp.weixin.qq.com/s/vmnBlrM7pTtVuyQU-GTcPw

### 总结
**在标记垃圾的方式是，并发垃圾处理器使用了并发标记，能有效避免STW**。但是并发就会涉及到线程之间的抢占、通信，导致gc线程的效率不如并行收集器里的gc线程。可以理解为并行收集器的线程更专注于清垃圾（不用线程间考虑并发），所用总时间更短。

另外**在标记之后的垃圾清理阶段**：
- **CMS使用标记清除算法，虽然不会导致STW，但会产生空间碎片**。如果碎片过多，最后依然要STW处理一下；
- **G1使用标记复制算法，能避免产生空间碎片，但就会涉及到存活对象移动，所以这一阶段也使用STW的方式清理**。全靠它使用了二八定律，所以能让停顿时间符合用户预期；

## 低延迟垃圾收集器
低延迟垃圾收集器（Low Latency Garbage Collector）几乎整个工作过程都是并发的，只有初始标记、最终标记会STW，且是O(1)时间。所以即使在大内存的情况下，也能达到非常低的延迟，所以被命名为low latency garbage collector，也叫low pause time garbage collector。

和并发垃圾收集器最大的差别，**在于他们在清理垃圾的阶段，既能避免内存碎片，又能避免STW**！当前（jdk20）ZGC能做到1ms以内的STW时间。

### Z collector
为什么G1在清理垃圾的阶段需要STW？因为需要移动对象。虽然移动对象比较简单，但所有引用该对象的地址还都是旧对象地址，没法在一瞬间同时更新到新地址。如果此时旧地址被另一个对象用了，别的对象里还未更新的旧地址就会访问到错误的对象，出错了。

ZGC使用染色指针标记对象是否被移动：64bit虚拟机，虽然使用64bit地址（如果不压缩指针），**但64bit并没有全都用完**，因为64bit理论上虽然能支持16EB地址空间，但os都不支持这么大，linux只支持128TB的进程虚拟地址空间，windows更是只支持到16TB，也就是说高位还有不少没用到。zgc就用了其中4bit来标记对象的状态（比如是否被移动）。

> **一般要存储内部使用的数据（metadata），都会使用object header。比如用mark word标记对象到了第几代。（当然，也可以使用额外的空间，比如bitmap。）但是，实际上一个对象是不是垃圾，本身是和对象无关的，因此zgc直接把这些信息标记到了指向对象的指针上！只看地址就知道对象处于什么状态！**

**使用了指针的zgc在做并发标记时，标记不再打到对象身上，而是直接打到了指针上。根据指针，可以知道哪些对象是垃圾哪些不是。哪些被移动了哪些没有**。

> 此时的可达性分析，与其说是在遍历对象图来标记对象，不如说是在遍历引用图来标记指针。

所以zgc在使用标记复制算法移动对象的时候，可以使用转发表记录把对象从哪里移动到哪里了（hash表），**在通过地址访问对象的时候，直接就可以通过对象地址看出该对象是否被移动了**。如果移动了，就去转发表里找对象的新地址，并更新地址的值。

> 因为移动对象会破坏别的对象引用里的地址，所以zgc的这一步也被形象地称为自愈能力self-healing。

使用染色指针为zgc带来了诸多优点，主要是快。当然也有缺点：
- 不再支持指针压缩；
- 最大只能支持4TB内存；

但这些后期都可以优化。

#### 分代
当前zgc是不分代的，所以不涉及跨代引用（G1的RSet）的问题。但是，下个月要发布的jdk21要支持[分代的zgc](https://openjdk.org/jeps/439)了！

ZGC does the majority of its work while application threads are running, pausing those threads only briefly. ZGC's pause times are consistently measured in microseconds; by contrast the pause times of the default garbage collector, G1, range from milliseconds to seconds. ZGC's low pause times are **independent of heap size**: Workloads can use heap sizes from a few hundred megabytes all the way up to multiple terabytes and still enjoy low pause times.

For many workloads, simply using ZGC is enough to solve all latency problems related to garbage collection. This works well as long as there are sufficient resources (i.e., memory and CPU) available to ensure that ZGC can reclaim memory faster than the concurrently-running application threads consume it. **However, ZGC currently stores all objects together, regardless of age, so it must collect all objects every time it runs.**

The weak generational hypothesis states that young objects tend to die young, while old objects tend to stick around. Thus collecting young objects requires fewer resources and yields more memory, while collecting old objects requires more resources and yields less memory. **We can thus improve the performance of applications that use ZGC by collecting young objects more frequently.**

ZGC也要通过二八定律让自己变得更高效。

## 垃圾收集器总结
垃圾收集说难也难，但是如果搞清了来龙去脉，仅作为吃瓜群众，理解起gc来是很简单的。

- 怎么判断垃圾？
    + 用不到的就是垃圾。所以需要从一个起点开始标记，这个起点就是gc roots。
- 怎么标记和清理？
    + stop the world，不然会出错。
- STW太慢了啊，能不能快点儿？
    + 可以，搞出了并发标记。
- 能不能再快点儿？
    + 二八定律，所以不如分代吧，优先收集young。
- 分代以后会有跨代引用，怎么办？
    + G1的remembered set就是一个解决方案。只遍历跨代引用该新生代的老年代，其他老年代不遍历了。
- 标记完了，怎么清理？
    + STW，可以但太慢了。
    + 于是zgc发明了染色指针和转发表，能够支持和用户线程并发。通过地址直接看出对象是否被移动了，然后去转发表找新地址。

这些理念是递进的，实现起来也是越来越复杂的，但都是很合理的。一个垃圾收集器未必会实现所有的方面，比如G1支持二八定律但清理垃圾的时候用的是STW，很先进但又不完全先进。zgc当前还不支持分代，jdk21版本才支持。等等。

# 统一的gc日志
jdk9之前，gc日志并不统一，不仅日志开关参数不统一，日志格式也不统一。从jdk9开始，这一切都统一了！`-Xlog`！

Xlog是所有log的控制参数，并非仅仅是gc log。它的格式是冒号分隔的kv对，kv对之间用等号。比如：
```bash
java -Xlog:gc*=info -version
```
`gc*`指的是包含gc的日志，比如[gc,heap]或者[gc,cpu]，刻画了gc的方方面面：
```
[0.005s][info][gc] Using G1
[0.007s][info][gc,init] Version: 17.0.7+7-Debian-1deb11u1 (release)
[0.007s][info][gc,init] CPUs: 4 total, 4 available
[0.007s][info][gc,init] Memory: 7946M
[0.007s][info][gc,init] Large Page Support: Disabled
[0.007s][info][gc,init] NUMA Support: Disabled
[0.007s][info][gc,init] Compressed Oops: Enabled (32-bit)
[0.007s][info][gc,init] Heap Region Size: 1M
[0.007s][info][gc,init] Heap Min Capacity: 8M
[0.007s][info][gc,init] Heap Initial Capacity: 126M
[0.007s][info][gc,init] Heap Max Capacity: 1988M
[0.007s][info][gc,init] Pre-touch: Disabled
[0.007s][info][gc,init] Parallel Workers: 4
[0.007s][info][gc,init] Concurrent Workers: 1
[0.007s][info][gc,init] Concurrent Refinement Workers: 4
[0.007s][info][gc,init] Periodic GC: Disabled
[0.007s][info][gc,metaspace] CDS archive(s) mapped at: [0x0000000800000000-0x0000000800be2000-0x0000000800be2000), size 12460032, SharedBaseAddress: 0x0000000800000000, ArchiveRelocationMode: 0.
[0.007s][info][gc,metaspace] Compressed class space mapped at: 0x0000000801000000-0x0000000841000000, reserved size: 1073741824
[0.007s][info][gc,metaspace] Narrow klass base: 0x0000000800000000, Narrow klass shift: 0, Narrow klass range: 0x100000000
openjdk version "17.0.7" 2023-04-18
OpenJDK Runtime Environment (build 17.0.7+7-Debian-1deb11u1)
OpenJDK 64-Bit Server VM (build 17.0.7+7-Debian-1deb11u1, mixed mode, sharing)
[0.022s][info][gc,heap,exit] Heap
[0.022s][info][gc,heap,exit]  garbage-first heap   total 131072K, used 1791K [0x0000000083c00000, 0x0000000100000000)
[0.022s][info][gc,heap,exit]   region size 1024K, 1 young (1024K), 0 survivors (0K)
[0.022s][info][gc,heap,exit]  Metaspace       used 52K, committed 128K, reserved 1114112K
[0.022s][info][gc,heap,exit]   class space    used 1K, committed 64K, reserved 1048576K
```

如果只想看纯gc tag的日志：
```bash
java -Xlog:gc=info -version
```
结果就会简化很多：
```
[0.005s][info][gc] Using G1
openjdk version "17.0.7" 2023-04-18
OpenJDK Runtime Environment (build 17.0.7+7-Debian-1deb11u1)
OpenJDK 64-Bit Server VM (build 17.0.7+7-Debian-1deb11u1, mixed mode, sharing)
```

还可以添加更多的控制选项，比如控制gc log的输出。这里第一个参数控制输出到stdout，第二个控制输出到file：
```bash
-Xlog:gc*=info:stdout -Xlog:gc*=info:file=logs/gc.log.%t
```

而在9之前，可能要通过如下参数来控制gc信息，比较混乱：
```bash
-verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution
```
参阅：
- https://www.baeldung.com/java-verbose-gc
- https://www.baeldung.com/java-gc-logging-to-file
- https://www.cnblogs.com/flydean/p/jdk9-jvm-xlog.html

## 禁用GC Rotation log

> jdk9之前。

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

# 其他jvm参数
一些非标准jvm参数（`-XX`）：
- https://www.oracle.com/java/technologies/javase/vmoptions-jsp.html

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



