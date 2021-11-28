---
layout: post
title: "Java Memory"
date: 2021-11-28 15:04:01 +0800
categories: Java JVM
tags: Java JVM
---

在linux上使用htop查看进程内存占用情况，发现系统显示的jvm内存占用已经达到了8G。但是使用jconsole查看，实际used只有3G左右，而committed是8G。那么linux观察到的jvm内存占用和实际内存占用有什么关系呢？

1. Table of Contents, ordered
{:toc}

# memory模型
JDK的[MemoryUsage](https://docs.oracle.com/javase/9/docs/api/java/lang/management/MemoryUsage.html)展示了内存监控的几种指标：
- init：比较好理解，就是`-Xms`指定的内存大小。jvm启动的时候就会向linux申请这么多内存；
- used：实际使用的大小。就是jvm里所有存活object占用的内存大小；
- committed：**实际占用的系统内存大小**，也就是在linux上观察到的jvm内存占用大小。比如jvm需要使用5g，就会向jvm申请这么多。之后jvm垃圾回收，只需要使用3g了，但jvm可能并没有从系统撤回内存占用，所以实际还是占用系统5g内存。
- max：`-Xmx`，jvm再怎么向os申请内存，也不会申请超过`-Xmx`设定的最大内存值。

所以used肯定一直小于等于committed，而他们的上限就是max。但是used和committed未必大于init。**当系统闲置占用的内存一段时间后，会释放一部分committed内存量**。

> java memory很像virtualbox的动态分配的虚拟磁盘，二者都是逐渐申请更多资源，且不超过最大值。不同的是，committed是动态调整大小的，会缩小，而virtualbox申请的磁盘不会减少：逐渐占用物理硬盘的空间，直至达到分配的大小，**不过当其内部空间不用时不会自动缩减占用的物理硬盘空间**。
>
> ArrayList会随着元素的添加而增长，但不会随着元素的删除而缩短，除非手动调用`trimToSize()`。

Ref:
- https://stackoverflow.com/a/69495373/7676237
- https://stackoverflow.com/a/23831296/7676237

# 默认内存参数
如果jvm启动的时候不设置内存参数（`-Xms`/`-Xmx`），jvm只能自己决定内存占用了。具体设置多少是根据系统的实际内存来决定的：
- https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/parallel.html#default_heap_size

所以归根结底还是设置了的，不如我们亲自设置好。

如果有gc log，可以看到一开始设置的initialHeapSize和maxHeapSize：
```
Memory: 4k page, physical 131494708k(22189688k free), swap 8388604k(393376k free)
CommandLine flags: -XX:-BytecodeVerificationLocal -XX:-BytecodeVerificationRemote -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=./java_pid<pid>.hprof -XX:InitialHeapSize=2103915328 -XX:+ManagementServer -XX:MaxGCPauseMillis=10 -XX:MaxHeapSize=32178700288 -XX:+PrintAdaptiveSizePolicy -XX:+PrintGC -XX:+PrintGCDateStamps -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -XX:+PrintTenuringDistribution -XX:TieredStopAtLevel=1 -XX:+UseCompressedClassPointers -XX:+UseCompressedOops -XX:+UseG1GC 
 0.225: [G1Ergonomics (Heap Sizing) expand the heap, requested expansion amount: 2105540608 bytes, attempted expansion amount: 2105540608 bytes]
```

# OOM
如果已经申请到最大了，jvm内存还是不够放下object，那就是out of memory了。常见的oom类型：
- heap oom：**最常见的oom类型**。创建的object实在是太多了，jvm申请的内存不够用；
    + `java.lang.OutofMemoryError:Java heap space`
- stack oom：栈用来存储线程的局部变量表、操作数栈、动态链接、方法出口等信息，一般栈爆了就是递归写得出问题了，**或者递归层级实在是太深了**，比如动态规划的问题。另外因为每个线程的栈都是线程私有的，**如果线程创建的太多**，对栈空间的占用就会很多；
    + `java.lang.StackOverflowError`
    + `java.lang.OutofMemoryError: unable to create new native thread`
- 永久代oom：常量、加载的类信息，如类名、访问修饰符、常量池、字段描述、方法描述等。如果这些信息太多了，也会OOM。一般发生在会动态生成代理类的应用中。
    + `java.lang.OutofMemoryError: PermGen space`

**jvm使用`-Xss`设置一个线程能占用栈的最大值**，用于线程内部使用，比如保存局部变量、运行状态。**linux默认是1M大。如果线程内有递归等操作，超出1M，栈就会oom**。
- https://www.ibm.com/docs/en/ztpf/1.1.0.15?topic=options-xss-option
- https://docs.oracle.com/cd/E13150_01/jrockit_jvm/jrockit/jrdocs/refman/optionX.html
- https://stackoverflow.com/a/4967914/7676237
- https://stackoverflow.com/a/27324590/7676237

# OS OOM
如果linux系统内存不够用了，相当于linux系统OOM了，为了活下去，它会挑一个占用内存最大的应用kill掉。

如果jvm不幸被系统选中，kill掉，和jvm OOM是完全不同的：OOM指的是jvm申请的内存到最大了，还是放不下已有的object，被kill是jvm跑着跑着突然被系统干掉了。

jvm由于是突然去世，来不及记录日志，所以从日志看不出任何端倪，此时只能看linux系统的日志，看看是不是把jvm给kill了。

一般用dmesg查看系统log：
```
$ dmesg -T | grep -i "out of memory"
$ dmesg -T | grep -i "killed process"
```

详见：[linux-dmesg]({% post_url 2021-11-28-linux-dmesg %})

