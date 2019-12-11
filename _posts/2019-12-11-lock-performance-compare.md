---
layout: post
title: "锁性能比较"
date: 2019-12-11 22:14:21 +0800
categories: Java lock concurrency
tags: Java lock concurrency
---

之前在[锁]({% post_url 2019-12-10-lock %})和[CAS vs. 锁]({% post_url 2019-12-09-cas-vs-lock %})中，对Java中提供的各种锁以及CAS进行了比较。这里通过一个具体的例子，来简单验证一下之前的分析，加深一下对这些锁的理解。

大概介绍了这么多锁同步机制：
- 内置锁synchronized；
- Lock；
- Lock（公平锁）；
- ReadWriteLock；
- StampedLock（乐观读锁）；
- CAS：AtomicLong；

另外再补上：
- volatile + synchronized；
- Adder：LongAdder；
- dirty：无锁保护修改共享数据，显然是不正确的实现；

1. Table of Contents, ordered
{:toc}

# 场景
设置n个读线程，m个写线程，争用一个共享变量。读线程只是读一下，并记录一次读取；写线程将共享变量+1，并记录一次写入。当贡献变量达到target大小时，线程全部退出，输出总读取次数，总写入次数，以及整个过程的总时间。

> 主程序实现见[CounterDemo.java](https://github.com/puppylpg/java-examples/blob/master/src/main/java/example/concurrency/synchronization/lock/counters/CounterDemo.java)

# 读写具体实现
主程序调用的接口就两个行为：读、写。
```
package example.concurrency.synchronization.lock.counters;

public interface Counter {

    long getCount();

    void increment();
}
```

## Dirty
这是一种错误的实现。不加任何同步措施直接修改共享变量必然得不到正确的结果。放在这里只是用来作为一个基准：完全无锁情况下读写变量次数及总时间消耗。
```
package example.concurrency.synchronization.lock.counters.counter;

import example.concurrency.synchronization.lock.counters.Counter;

public class Dirty implements Counter {
    private long counter;

    public long getCount() {
        return counter;
    }

    public void increment() {
        ++counter;
    }
}

```

## synchronized
内置锁实现，也是提及锁时能想到的最基础的实现。
```
package example.concurrency.synchronization.lock.counters.counter;

import example.concurrency.synchronization.lock.counters.Counter;

public class Synchronized implements Counter {
    private final Object lock = new Object();

    private int counter;

    public long getCount() {
        synchronized (lock) {
            return counter;
        }
    }

    public void increment() {
        synchronized (lock) {
            ++counter;
        }
    }
}
```

## volatile + synchronized
+1这种非原子性操作是必须加锁完成的。能不能把读取的锁去掉？

如果读取行为不加锁，一个线程使用synchronized在写共享变量，与此同时另一个线程想读取该变量，因为读线程不加锁，读线程可能读取了一个还没来得及修改的变量。但是从逻辑上来讲，它是后于写线程到达的，理应读取写后的值。

但是volatile的happens-before机制（前者对后者有序，前者对后者可见）能保证先到的write一定优先于后到的read完成，这样就不用担心读取到的数据有错误。

> 另外对于64bit的数据，简单的写实现（non-volatile修饰）可以是先写32bit，再写32bit。Java没有规定是否必须分开写，这取决于jvm实现。所以**Java建议对共享的long和double变量使用volatile修饰**

使用volatile + synchronized的方式，消除了读取时的加锁过程，同时保证了读取的正确性，理应比读写都加锁的行为更高效一些。
```
package example.concurrency.synchronization.lock.counters.counter;

import example.concurrency.synchronization.lock.counters.Counter;

public class VolatileSynchronized implements Counter {
    private volatile long counter;

    public long getCount() {
        return counter;
    }

    public synchronized void increment() {
        // 如果不给写volatile变量的行为加锁，idea竟然会提醒：non-atomic operation on volatile value，强！
        ++counter;
    }
}
```

## Lock
显示锁。和内置锁在加锁语义上没什么区别。详见[锁]({% post_url 2019-12-09-cas-vs-lock %})。

这里使用Lock的默认实现，ReentrantLock：
```
package example.concurrency.synchronization.lock.counters.counter;


import example.concurrency.synchronization.lock.counters.Counter;

import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class ReadWriteLockDefault implements Counter {
    private java.util.concurrent.locks.ReadWriteLock rwlock = new ReentrantReadWriteLock();

    private Lock rlock = rwlock.readLock();
    private Lock wlock = rwlock.writeLock();

    private long counter;

    public long getCount() {
        rlock.lock();
        try {
            return counter;
        } finally {
            rlock.unlock();
        }
    }

    public void increment() {
        wlock.lock();
        try {
            ++counter;
        } finally {
            wlock.unlock();
        }
    }
}
```

## Lock + 公平策略
默认的ReentrantLock使用的是非公平策略（synchronized也是非公平策略），效率更高（原因同样见[锁]({% post_url 2019-12-10-lock %})）。

这里再加一个公平策略的ReentrantLock，看看性能是不是真的差很多：
```
package example.concurrency.synchronization.lock.counters.counter;


import example.concurrency.synchronization.lock.counters.Counter;

import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

public class LockFair implements Counter {
    private Lock lock = new ReentrantLock(true);


    private long counter;

    public long getCount() {
        lock.lock();
        try {
            return counter;
        } finally {
            lock.unlock();
        }
    }

    public void increment() {
        lock.lock();
        try {
            ++counter;
        } finally {
            lock.unlock();
        }
    }
}
```

## ReadWriteLock
ReadWriteLock和Lock比起来，有点儿像（volatile + synchronized） vs. synchronized，但又不完全是：
- volatile + synchronized是给读取行为去掉了锁，同时使用volatile这个轻量级同步来保证读取的正确性；
- ReadWriteLock和Lock比起来，则是划分出专门的Read lock，是的读与读不再互斥访问；

理论上在读远多于写的时候，ReadWriteLock应该会表现得比Lock好。
```
package example.concurrency.synchronization.lock.counters.counter;


import example.concurrency.synchronization.lock.counters.Counter;

import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class ReadWriteLockDefault implements Counter {
    private java.util.concurrent.locks.ReadWriteLock rwlock = new ReentrantReadWriteLock();

    private Lock rlock = rwlock.readLock();
    private Lock wlock = rwlock.writeLock();

    private long counter;

    public long getCount() {
        rlock.lock();
        try {
            return counter;
        } finally {
            rlock.unlock();
        }
    }

    public void increment() {
        wlock.lock();
        try {
            ++counter;
        } finally {
            wlock.unlock();
        }
    }
}
```

## StampedLock 乐观读锁
StampedLock其实更像volatile + synchronized，不过优化的更激进：
- ReadWriteLock使用单独的read lock防止读读互斥行为，但是还是有个读锁存在的；
- volatile + synchronized通过volatile保证读行为的正确性，已经在读上没有锁了；
- StampedLock的乐观读锁其实就是没锁；

StampedLock是无论如何先读再说，失败的话代价更高：一次普通读加上一次失败重新使用read lock读。但是如果不失败那就血赚。

而且StampedLock的乐观读完全不阻碍写线程获取write lock，在读多写少时，**使用非公平队列也不会造成写线程饥饿**。

所以在read特别多，远大于write的情况下，使用StampedLock应该是绝佳选择。
```
package example.concurrency.synchronization.lock.counters.counter;

import example.concurrency.synchronization.lock.counters.Counter;

import java.util.concurrent.locks.StampedLock;

public class ReadWriteLockOptimisticStamped implements Counter {

    private StampedLock rwlock = new StampedLock();

    private long counter;

    private long readTimes;
    private long successTimes;

    /**
     * 乐观锁用法：先去读，读完看看改了没（乐观：赌一把，我猜大概率没改），
     * 没改就幸灾乐祸。改了就重试。或者说，用read lock。
     */
    public long getCount() {
        long stamp = rwlock.tryOptimisticRead();

        readTimes++;

        if (rwlock.validate(stamp)) {
            successTimes++;
            return counter;
        } else {
            long readStamp = rwlock.readLock();
            try {
                return counter;
            } finally {
                rwlock.unlock(readStamp);
            }
        }

    }

    public void increment() {
        long stamp = rwlock.writeLock();

        try {
            ++counter;
        } finally {
            rwlock.unlockWrite(stamp);
        }
    }

    public long getSuccessTimes() {
        return successTimes;
    }


    public long getReadTimes() {
        return readTimes;
    }
}
```

## 普通StampedLock
既然StampedLock可以使用tryOptimisticRead乐观读，也可以不使用乐观读，而是当做一个普通的读写锁来用，那这里就再增加一种当做普通读写锁使用的情况。
```
package example.concurrency.synchronization.lock.counters.counter;

import example.concurrency.synchronization.lock.counters.Counter;

import java.util.concurrent.locks.StampedLock;

public class ReadWriteLockStamped implements Counter {

    private StampedLock rwlock = new StampedLock();

    private long counter;

    public long getCount() {
        long stamp = rwlock.readLock();

        try {
            return counter;
        } finally {
            rwlock.unlockRead(stamp);
        }
    }

    public void increment() {
        long stamp = rwlock.writeLock();

        try {
            ++counter;
        } finally {
            rwlock.unlockWrite(stamp);
        }
    }
}
```

## Atomic
CAS实现，和锁比起来，是一种乐观行为，类似于StampedLock里的乐观读，但是无论读写都是乐观的。是一种利用底层硬件的非阻塞乐观同步行为。详见[CAS vs. 锁]({% post_url 2019-12-10-lock %})。
```
package example.concurrency.synchronization.lock.counters.counter;

import example.concurrency.synchronization.lock.counters.Counter;

import java.util.concurrent.atomic.AtomicLong;

/**
 * AtomicReference = volatile + unsafe/(AtomicLongFieldUpdater) CAS
 */
public class Atomic implements Counter {
    private final AtomicLong atomic = new AtomicLong();

    public long getCount() {
        return atomic.get();
    }

    public void increment() {
        atomic.incrementAndGet();
    }
}
```

## Adder
Java 8引入的，一种在高竞争环境下比AtomicXxx更高效的实现。比如LongAdder内部使用了类似多个AtomicLong，这种实现很像分段锁，**将竞争分摊到不同的段上，从而提高了吞吐**。最后需要返回最终结果的时候，把所有的段加起来即可。

> 详情参考：https://stackoverflow.com/questions/30691083/how-longadder-performs-better-than-atomiclong

```
package example.concurrency.synchronization.lock.counters.counter;

import example.concurrency.synchronization.lock.counters.Counter;

import java.util.concurrent.atomic.LongAdder;

public class Adder implements Counter {
    private final LongAdder adder = new LongAdder();

    public long getCount() {
        return adder.longValue();
    }

    public void increment() {
        adder.increment();
    }
}
```

以上参阅：
- https://www.javaspecialists.eu/archive/Issue215.html

# 结果分析
目标counter定为100w，当写线程将数据修改到100w时结束读线程和写线程，所有线程结束则退出程序。同时，如果读线程已经读了超过1000w次，读线程也会退出。（防止读线程无限插队造成写线程饥饿，程序很久都没法结束）

- 5 read thread;
- 5 write thread;

结果如下：
```
Using read threads: 5, write threads: 5. Target number: 1000000.

Counter: example.concurrency.synchronization.lock.counters.counter.Dirty@17f052a3
Init ExecutorService successfully.
Writer: write 928107 times.
Reader: read 50882 times.
Reader: read 2970076 times.
Writer: write 115377 times.
Reader: read 477783 times.
Reader: read 1 times.
Reader: read 1 times.
Writer: write 0 times.
Writer: write 0 times.
Writer: write 0 times.
Time used: 22ms
Total read times: 3498743
Total write times: 1043484
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.Atomic@6433a2
Init ExecutorService successfully.
Reader: read 10000000 times.
Reader: read 5717955 times.
Reader: read 8713631 times.
Writer: write 778524 times.
Writer: write 0 times.
Reader: read 6417147 times.
Writer: write 221477 times.
Reader: read 1 times.
Writer: write 0 times.
Writer: write 0 times.
Time used: 77ms
Total read times: 30848734
Total write times: 1000001
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.Adder@306a30c7
Init ExecutorService successfully.
Writer: write 279624 times.
Reader: read 496116 times.
Reader: read 676852 times.
Reader: read 236108 times.
Reader: read 546706 times.
Reader: read 433436 times.
Writer: write 720377 times.
Writer: write 0 times.
Writer: write 0 times.
Writer: write 0 times.
Time used: 43ms
Total read times: 2389218
Total write times: 1000001
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.Synchronized@506c589e
Init ExecutorService successfully.
Writer: write 152466 times.
Reader: read 397590 times.
Reader: read 813497 times.
Writer: write 145396 times.
Reader: read 388306 times.
Reader: read 332813 times.
Writer: write 336784 times.
Reader: read 726612 times.
Writer: write 125779 times.
Writer: write 239577 times.
Time used: 142ms
Total read times: 2658818
Total write times: 1000002
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.VolatileSynchronized@22d8cfe0
Init ExecutorService successfully.
Reader: read 10000000 times.
Reader: read 10000000 times.
Reader: read 10000000 times.
Reader: read 10000000 times.
Reader: read 10000000 times.
Writer: write 154252 times.
Writer: write 289924 times.
Writer: write 165839 times.
Writer: write 194819 times.
Writer: write 195170 times.
Time used: 71ms
Total read times: 50000000
Total write times: 1000004
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.LockDefault@46fbb2c1
Init ExecutorService successfully.
Writer: write 167698 times.
Reader: read 512408 times.
Reader: read 375275 times.
Reader: read 341834 times.
Writer: write 185643 times.
Reader: read 388106 times.
Writer: write 215224 times.
Writer: write 235792 times.
Writer: write 195644 times.
Reader: read 431278 times.
Time used: 108ms
Total read times: 2048901
Total write times: 1000001
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.ReadWriteLockDefault@6659c656
Init ExecutorService successfully.
Reader: read 6527316 times.
Writer: write 205747 times.
Reader: read 6178062 times.
Reader: read 7321110 times.
Reader: read 6891603 times.
Reader: read 6493670 times.
Writer: write 200966 times.
Writer: write 195561 times.
Writer: write 197253 times.
Writer: write 200476 times.
Time used: 4745ms
Total read times: 33411761
Total write times: 1000003
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.ReadWriteLockStamped@6d21714c
Init ExecutorService successfully.
Reader: read 94448 times.
Reader: read 113801 times.
Writer: write 199279 times.
Writer: write 180211 times.
Reader: read 94558 times.
Writer: write 232495 times.
Reader: read 82081 times.
Reader: read 101350 times.
Writer: write 214171 times.
Writer: write 173844 times.
Time used: 415ms
Total read times: 486238
Total write times: 1000000
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.ReadWriteLockOptimisticStamped@4534b60d
Init ExecutorService successfully.
Writer: write 199689 times.
Writer: write 183263 times.
Writer: write 191685 times.
Writer: write 213364 times.
Writer: write 212002 times.
Reader: read 7557156 times.Fail times: 6253. Fail percentage: 0.000827
Reader: read 7050819 times.Fail times: 6253. Fail percentage: 0.000887
Reader: read 6088258 times.Fail times: 6253. Fail percentage: 0.001027
Reader: read 8088781 times.Fail times: 6253. Fail percentage: 0.000773
Reader: read 5907607 times.Fail times: 6253. Fail percentage: 0.001058
Time used: 450ms
Total read times: 34692621
Total write times: 1000003
ExecutorService shutdown successfully.
```
> 最终写了1000000或1000005才退出，是因为看到counter当前计数与+1操作不是原子的，存在两个线程都看到counter=999999，都+1，把counter变成了1000001的情况。这不是关键，所以这样也无所谓。

结果可以分以下几组来分析：
## Dirty是不准确的，同时也是最快的
两个写线程共计运行1301280次才将counter变成100w，看来没加锁发生了写数据时相互覆盖的行为。

同时dirty也是最快的，毕竟没加锁，跑的飞快，即使比别的情况多跑了好几十万次，总时间依然最少。

## Adder和Atomic是最高效的，Adder比Atomic更优化一些
Adder和Atomic本身都是非常高效的实现，在所有这些实现中，占据TOP2。CAS性能优于锁，名不虚传！

1.8引入的Adder的确比Atomic更高效。

> 只有volatile + synchronized还能勉强一战……

## volatile + synchronized 优于单独synchronized
其实一开始，volatile + synchronized 225ms竟然比读写都synchronized 130ms还要慢？？？

而且并不是特例，多跑几次依然这样。

看了一下二者在synchronized实现上的区别，volatile的写synchronized直接锁方法了，而synchronized实现是锁单独的object，难道这两者开销不同？

将volatile + synchronized的实现改了改，也将锁方法换成了锁object：
```
public class VolatileSynchronized implements Counter {
    private volatile long counter;

    private final Object lock = new Object();

    public long getCount() {
        return counter;
    }

    public void increment() {
        synchronized (lock) {
            ++counter;
        }
    }
}
```
果然volatile + synchronized和我们预期的相同，比synchronized要快不少（多运行几次也是这样）：
```
Counter: example.concurrency.synchronization.lock.counters.counter.Synchronized@246b179d
Init ExecutorService successfully.
Writer: write 469182 times.
Reader: read 590377 times.
Writer: write 530819 times.
Reader: read 610846 times.
Time used: 120ms
Total read times: 1201223
Total write times: 1000001
ExecutorService shutdown successfully.

Counter: example.concurrency.synchronization.lock.counters.counter.VolatileSynchronized@5a10411
Init ExecutorService successfully.
Reader: read 10000000 times.
Reader: read 10000000 times.
Writer: write 250688 times.
Writer: write 749313 times.
Time used: 70ms
Total read times: 20000000
Total write times: 1000001
ExecutorService shutdown successfully.
```
同时也说明**synchronized锁方法的实现不如锁object高效**。

## Lock和synchronized差不多
lock和synchronized的性能差别确实不大。

所以决定使用哪一种实现时，更应该考虑的是需不需要lock的高级功能：跨代码块使用、可实现公平队列、可中断、可定时`tryLock(timeout)`、非阻塞所以可轮询`while (true) { tryLock }`等等。

## 公平锁比非公平锁性能差很多
默认的ReentrantLock是非公平锁。当前测试场景，由于读写操作对锁的占用时间极小，能够在线程恢复之前执行完毕，很符合可插队的场景。所以插队显然会带来更高的效率。公平锁完败非公平锁。

从上面的数据（考虑到测试效率，后来新跑数据的时候，把公平锁删了，太费时间）可以看到公平锁花了足足17s+才完成非公平锁133ms就完成的工作……

## ReadWriteLock性能不咋滴
ReadWriteLock确实跑起来远不如普通的lock和synchronized，甚至Java8引入的StampedLock拿来当普通读写锁都比ReadWriteLock（的默认实现ReentrantReadWriteLock）强。

即使加大了读线程占比，情况依然不会好，而且几乎每次都是读线程达到上限1000w次退出后，写线程才把counter加上去，**貌似确实容易让写线程饥饿**。

## StampedLock拿来当普通锁使，性能比Lock略差
但也还可以。

## StampedLock的乐观读效果并不显著
在读写1:1的情况下，StampedLock的乐观读效果并不显著，和StampedLock的普通读写性能差不多。

后面我加大了读写占比，很遗憾也没观察到乐观锁飞奔的效果。

当然，我这是一个完全不严谨的测试，不过还好，只有这一个测试结果没达到预期。

# 总结
参阅：
- https://blog.overops.com/java-8-stampedlocks-vs-readwritelocks-and-synchronized/

结合上述应该比我更严谨一些的测试，总结一下最终的结论：
- Adder和Atomic的CAS的确比锁实现高效了不少；
- 后来的Adder比Atomic更胜一筹；
- volatile + synchronized的组合相当不错，的确胜过synchronized；
- synchronized和Lock不相上下，所以除了Lock新引入的那些非常有用的新场景用法，否则还是用synchronized吧；
- 除非业务需要，否则不要用锁的公平策略，性能比默认的非公平锁差太远了；
- ReadWriteLock的默认实现ReentrantReadWriteLock慎用，甚至拿StampedLock当做ReadWriteLock也比ReentrantReadWriteLock好很多；
- 最后是一个我没跑出来，但是别人都这么说且有测试实例的结论：高读写线程占比下，StampedLock的乐观读是当之无愧的王者。

