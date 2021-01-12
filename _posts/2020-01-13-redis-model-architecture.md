---
layout: post
title: "Redis - 模型架构"
date: 2021-01-13 01:51:27 +0800
categories: Redis
tags: Redis
---

上篇写的redis DB是redis server的主要功能。本文梳理一下redis server的架构、事件处理逻辑。

1. Table of Contents, ordered
{:toc}

# 事件驱动程序
redis server的主进程就是一个大loop：
```
while true:
    processFileEvents();
    processTimeEvents();
    flushAOF();
```
**该loop是由redis主进程的主线程完成的。**

1. file events: 服务器通过socket与client进行连接，读写socket。Linux上，一切皆文件，所以socket也是文件，所以对socket的处理就是file event；
2. timer events：比如serverCron函数，执行之前类似于BGSAVE的后台子任务等；

> Linux一切皆文件：
> - （你在Windows层面上所认识到的）文件（file）是文件；
> - 目录也是文件，叫目录文件。打开目录其实就是打开目录文件。能读目录下的所有文件，其实就是对目录文件有读权限，所以能读目录文件包含的所有文件；
> - 进程是文件；
> - 硬件（键盘、显示器、硬盘、打印机）是文件。根据类型不同分为块设备文件和字符设备文件；
> - socket也是文件；
> - `/dev/zero`，`/dev/null`，pipe都是文件；
>
> 一切皆文件就是说：既然所有东西都是文件，那对所有东西都可以使用读写文件的read/write这一套API搞定，都可以用cat/pipe等处理文件的工具处理他们的内容。有什么意义？一套API搞定所有文件，能使用所有上述处理文件的工具，这意义还不大？

# file event - 单线程的魅力
redis的主进程是单线程的吗？不是！只能说上面的那个loop是主线程自己一个线程完成的，但是redis显然还有很多后台线程执行其他后台操作。所以redis只是使用单个线程完成了主要的服务处理流程而已。

主线程一个人完成client的连接、IO读写、命令执行。从开发Java服务器的角度来看，这是不现实的。但是别忘了**Redis和Java服务器的应用场景不同**：
- 在Java服务器开发中，为了处理一个请求，很可能要读写mysql数据库，请求一个其他服务，或者做一些其他很耗时的操作。这种情况下只用一个线程处理所有的client请求，一旦一个请求的处理时间过长，对其他client来说，相当于server失去了响应。所以Java会有多线程，并行+并发处理多个client请求；
- Redis的请求都是一些简单命令，所以执行非常快，也不存在一个请求把主线程block的情况。所以redis不用担心其被一个请求拖住不放，无法处理其他请求。既然如此，一个主线程就够了；

redis基于Reactor模式（NIO），**IO多路复用**，一个线程处理所有的事件，实现了并发。等等，一个线程怎么还能有并发？并发不是多线程的情况下才存在的吗？回归并发的定义：只要一段时间内，很多事情看起来像是同时被处理的，它就是并发。而redis一个线程能在短时间内快速处理大量请求（每秒处理小100w请求），所以从概念上来讲它就是并发。至于**Java的多线程并发，其实是并行与并发的结合**：并行体现在多个线程同时在多个核上执行，并发体现在单个核上不同线程经常切换，仿佛在同时处理多个线程。

> redis的单线程“并发”更像是概念上的并发，而Java多线程在一个核上不断切换的“并发”更符合我们一开始学习操作系统时所认知的并发行为。

关于redis单线程并发，参考：
- https://stackoverflow.com/questions/10489298/redis-is-single-threaded-then-how-does-it-do-concurrent-i-o

## 单线程的好处
很显然，**单线程不需要考虑多线程并发导致的内存共享问题，也就不需要加锁**。不加锁，这也是redis快的一大因素啊！

另一方面，在设计和实现上，单线程显然要比多线程简单。

## 单线程的不足
既然redis server的主要处理流程都是主线程一个人干的，那CPU实际上只用到了一个核。如今的CPU都是多核的，这不是浪费嘛！

> 那咋办？单机部署多个redis呗……哈哈哈，别笑，这是真的解决方案。

针对Redis对CPU利用不足，这篇文章提出了一种新并发思路：
- https://www.alibabacloud.com/blog/improving-redis-performance-through-multi-thread-processing_594150

读写IO的时候，使用**多个**thread，称为IO thread，当IO多路复用有新的事件到来时，这些IO thread负责读写socket、parse请求，然后请求的执行，都交由**一个**worker thread来做。相当于redis的主线程干的活，拆分给了一堆IO thread和一个worker thread。**因为就一个work thread，所以还是由它单独读写内存，还是不需要加锁**。同时用的还是NIO的多路复用模型，只不过处理IO的人变多了。

一般Java server NIO的思路是一个（或者几个）IO thread，一堆worker thread。**因为有一堆worker thread可能写内存，所以写内存的地方可能要加锁，导致Java代码比Redis看起来复杂了**。

同样是NIO，上述redis多线程的思路差不多和Java server多线程的思路是反过来的，主要是因为二者面对的问题不同：
- Java是worker thread干重活，比如读写mysql等，一个worker thread处理一堆请求不够用，只能用一堆worker thread。相比之下，读写socket，parse request就是小事儿了，一个IO thread差不多就够了；
- Redis是执行命令的时候任务量很小，简单读写一下内存，搞得也很快。相比较之下，读写socket，parse request算是一件大活儿了。这时候用一堆IO thread去处理IO干重活，单个worker thread干轻活。因为是单个worker thread，只有它读写内存，还不用加锁，简直太爽了！

> 架构之间的差异，都是业务场景决定的！多对比一下不同的架构，他们瞬间都变得更合理了！

加了一堆IO thread让redis的并发量提高了。如果redis的worker thread也变成一堆，会不会有更高的并发量呢？诚然，干活的线程多了，但是由于共享内存，锁是必然跑不掉的了。加了锁，性能就会损失。而且多线程必然涉及到线程切换，想想redis worker thread干的活儿，基本就是简单读写一下内存，这些活的开销加起来也许还不如一个锁、一次线程切换带来的开销大。所以worker thread肯定是不可能多线程了。

> 假设未来redis真的搞了多个worker thread，应该还是只有一个worker thread像现在一样用来处理请求，其他的也许会拿来搞一搞特别blocking的请求。

## Redis 6
redis 6的时候，上述**IO多线程**（说IO多线程比较严谨，毕竟worker还是单线程）模型发布了！！！

> 现在可以自信地说，redis绝对不是单线程的了。

在6.0.0+版本的redis.conf里，可以看到关于多IO thread的配置：
```
################################ THREADED I/O #################################

# Redis is mostly single threaded, however there are certain threaded
# operations such as UNLINK, slow I/O accesses and other things that are
# performed on side threads.
#
# Now it is also possible to handle Redis clients socket reads and writes
# in different I/O threads. Since especially writing is so slow, normally
# Redis users use pipelining in order to speed up the Redis performances per
# core, and spawn multiple instances in order to scale more. Using I/O
# threads it is possible to easily speedup two times Redis without resorting
# to pipelining nor sharding of the instance.
#
# By default threading is disabled, we suggest enabling it only in machines
# that have at least 4 or more cores, leaving at least one spare core.
# Using more than 8 threads is unlikely to help much. We also recommend using
# threaded I/O only if you actually have performance problems, with Redis
# instances being able to use a quite big percentage of CPU time, otherwise
# there is no point in using this feature.
#
# So for instance if you have a four cores boxes, try to use 2 or 3 I/O
# threads, if you have a 8 cores, try to use 6 threads. In order to
# enable I/O threads use the following configuration directive:
#
# io-threads 4
#
# Setting io-threads to 1 will just use the main thread as usual.
# When I/O threads are enabled, we only use threads for writes, that is
# to thread the write(2) syscall and transfer the client buffers to the
# socket. However it is also possible to enable threading of reads and
# protocol parsing using the following configuration directive, by setting
# it to yes:
#
# io-threads-do-reads no
#
# Usually threading reads doesn't help much.
#
# NOTE 1: This configuration directive cannot be changed at runtime via
# CONFIG SET. Aso this feature currently does not work when SSL is
# enabled.
#
# NOTE 2: If you want to test the Redis speedup using redis-benchmark, make
# sure you also run the benchmark itself in threaded mode, using the
# --threads option to match the number of Redis threads, otherwise you'll not
# be able to notice the improvements.
```
默认IO thread还是单线程，官方建议除非redis真的遇到了IO瓶颈，想继续再提一提单机redis的并发量，否则尽量别用多IO thread。

用redis提供的`redis-benchmark`，测试qps差不多翻倍：
- https://blog.csdn.net/weixin_45583158/article/details/100143587

# timer event
执行完file event，紧接着就执行timer event了。主要了解一下其实现：
- redisServer struct里有一个`time_events`链表；
- 所有的timer event都作为一个节点放入链表。节点内容：
    + id；
    + when：执行时间unix timestamp；
    + timeProc handler，也就是一个函数，执行的时候其实就是回调这个函数；

执行timer event就是遍历链表，判断when有没有超过当前timestamp，超过了就执行它：
- 如果是一次性的定时任务，做完把这个节点删了；
- 如果是周期任务，做完之后更新一下when；

忍不住类比一下Java：Java也有一个类似的链表，就是ScheduledThreadPoolExecutor内部的一个DelayQueue，任务作为一个Delayed任务放到DelayQueue里。但是任务的执行逻辑和redis截然不同：Java是起一个线程，不断尝试从DelayQueue中take（阻塞方法）任务，拿到就执行，如果DelayQueue中第一个任务（离执行时间最近的任务）还没到点儿，算一下还要多久，然后调用Condition的await（类似Object的wait），线程休眠。醒来继续拿，拿到就执行。

所以：
- Java是单独的线程负责取任务、时间到了就能取到并执行任务；
- Redis是在每次loop中顺便检查一下所有的任务时间到没，到了就执行；

之所以Redis更简单，是因为它一直在loop啊，而且loop很快。所以只要把检查任务执行的代码放在loop里就行了。

但还有一个问题：redis的loop是执行完file event之后才执行timer event，如果redis server没有命令要处理怎么办？岂不是一直卡在file event那一步了？这个阻塞其实有最大值，默认100ms，也就是redis周期任务的默认执行时间间隔。超过100ms主线程也不等file event了，该看看有没有周期任务要执行了。

# 总结
- 因为redis的使用场景，搞了个单线程不断loop的架构，所以执行定时任务只需要扔到loop里就行了；
- 还是因为场景，同样是NIO，后来加入的multi thread和Java的multi thread完全是反着的。而**这导致Java必须用锁来控制worker threads对内存的访问，redis却不需要考虑锁**；

场景决定架构，架构决定实现。



