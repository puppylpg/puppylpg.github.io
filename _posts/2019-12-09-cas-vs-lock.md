---
layout: post
title: "CAS vs. 锁"
date: 2019-12-09 01:02:19 +0800
categories: Java CAS concurrency
tags: Java CAS concurrency
---

想访问共享变量，锁住就行了，通过锁，可以获取对变量的独占访问。那么CAS又是干嘛的？

1. Table of Contents, ordered
{:toc}

# 为什么使用CAS
## 锁的缺陷
虽然使用锁可以实现对贡献变量的争取访问，但是使用锁有一些缺陷：

- 线程切换开销：未获得锁的线程将会被挂起，被唤醒后将等待可用时间片，然后在被调度时恢复上下文。这存在着比较大的开销；
- 优先级反转（Priority Inversion）：当一个线程等待锁时，什么都做不了。如果拿到锁的线程被延迟执行（缺页等），所有等待锁的线程都要延迟执行。如果拿到锁的线程优先级比较低，那么等待锁的高优先级线程相当于比它更低；
- 如果拿到锁的线程永久阻塞（无限循环、死锁、活锁、或者其他活跃性故障），所有等待这个锁的线程都凉了；

总而言之就是：拿到锁的人如果出了问题（运行延迟、无限循环不交出锁、死锁等），对于等待同一个锁的人来说都会产生影响，甚至因为那个人的错误而永远无法继续执行。

无论如何，在效率上，都被影响了。

## volatile好在哪儿
volatile和锁比起来，是一种更轻量级的同步机制：
- 强制数据写回内存，保证可见性；
- 保证有序性，如果先写后读，读一定发生在写完之后；

volatile**不会发生线程上下文切换**，所以说是一种**更轻量的同步机制**。但是volatile的缺陷也很明显，不能用于构建复合操作，因为不能保证原子性。

## CAS - Compare And Swap
锁，也就是独占锁，本质上是一种**悲观**技术（只要不加锁，共享区域就会被搞乱）。所有的操作都是排他的。

**乐观**的方法一般比悲观的高效：先操作，如果发现没有被干扰，成了。如果被干扰了，白搞了，try again（或者也可以不try，取决于策略）。

CAS是由底层CPU支持的操作：比较并交换。如果值和预期相同，则交换。它是乐观的技术，期望能成功执行更新操作。但是如果另一个线程在这之间抢先更新了该变量，CAS能检测到这个错误。

**CAS执行失败的时候，并不会挂起线程，而是被告知失败，由于未被挂起（不会阻塞），该线程可以决定是否重试**。

CAS既支持原子性，有类似于volatile变量的机制，可以理解为一种泛化的volatile变量。

# CAS
## CAS的语义
CAS的语义等同于下面的伪代码（只是语义上，真正实现上是CPU搞的，非常高效）：
```
/**
 * SimulatedCAS
 * <p/>
 * Simulated CAS operation
 *
 * @author Brian Goetz and Tim Peierls
 */

@ThreadSafe
public class SimulatedCAS {
    @GuardedBy("this") private int value;

    public synchronized int get() {
        return value;
    }

    public synchronized int compareAndSwap(int expectedValue, int newValue) {
        int oldValue = value;
        if (oldValue == expectedValue)
            value = newValue;
        return oldValue;
    }

    public synchronized boolean compareAndSet(int expectedValue, int newValue) {
        return (expectedValue == compareAndSwap(expectedValue, newValue));
    }
}
```
> - CompareAndSwap无论成功与否，均返回旧值；
> - CompareAndSet返回boolean，可以辨别是否执行成功了；

## 使用场景
读取A，根据A，计算得到B，判断A是否变了，没变则将A设为B。

如果变了，则有不同的策略：
- 如果是对一个共享的计数器执行+1操作，则失败后要继续重试；
- 如果是比如“发生某件事情就从False改为True”，则失败后说明别的线程已经设为true了，就不用再重试了。

所以失败后的策略根据使用场景来决定。

## 使用CAS实现非阻塞功能
比如非阻塞计数器：
```
/**
 * CasCounter
 * <p/>
 * Nonblocking counter using CAS
 *
 * @author Brian Goetz and Tim Peierls
 */
@ThreadSafe
public class CasCounter {
    private SimulatedCAS value;

    public int getValue() {
        return value.get();
    }

    public int increment() {
        int v;
        do {
            v = value.get();
        } while (v != value.compareAndSwap(v, v + 1));
        return v + 1;
    }
}
```

可以看到CAS和加锁比，**主要缺陷**就是：使用CAS要自己考虑处理竞争问题（是否要重试之类的），而使用锁，锁自己会处理这些问题，我们只需要假设拿到锁，考虑怎么办就行了。

使用CAS将一些阻塞算法换成非阻塞实现，是需要好好考虑的事情（一般由专家完成）。

## 性能
> 在支持CAS的平台上，JVM会编译为相应的CAS指令，最坏情况，如果平台不支持CAS，JVM在底层会将其实现为**自旋锁**。现代处理器针对多处理器操作，一般都提供了这种指令。

所以也可以从逻辑上，将CAS理解为一种更高效的自旋。那么CAS和锁一个无限重试，一个阻塞从而引入切换上下文开销，谁更快？

结论：
- 如果竞争程度特别高（极端情况，根本没有需要CPU计算的任务，就是在不停争用共享变量），锁的性能更好：
- 在更真实的环境中，CAS比锁要高效；

因为：
- **CAS的不断重试其实在本就激烈的竞争环境中引入了更多的竞争**；
- 锁机制挂起线程，减少了共享内存总线上的同步通信量；

这个理论在其他领域是共通的：
- 交通流量大，拥堵时，悲观的信号灯方式更高效，总能一次过一批车，而环岛就很堵，所有车都在慢慢挪动。但是低拥堵时期，环岛能实现更高吞吐（不用傻等），红绿灯就得傻等，很低效；
- 以太网中，当低通信流量时，竞争机制很好，但是高拥堵时，令牌环网络反而更好；

但是真实情况是，更多的时候还有计算任务，这样对共享变量的访问频率变会降低，通常CAS更高效。

# JVM里的CAS - 原子变量类 AtomicXxx
直接利用了硬件对并发的支持。

另外虽然比如AtomicInteger extends Number，但是并没有extends Integer，因为Integer是基本类型的包装类，不可变。而AtomicInteger是可修改的。所以没有在AtomicInteger等类中override hashCode和equals等，也不应该拿它们做散列容器的key。

# 可伸缩性
程序除了运行快慢，还有“处理能力”的衡量标准，即在资源一定时，能完成的工作量。可伸缩性指当增加资源时，程序的处理能力能相应增加。

但是**竞争与可伸缩性是背道而驰的**，**CAS能提高竞争的效率，从而提高程序的可伸缩性**。但是只有完全消除竞争，才能实现真正的可伸缩性。比如如果不是都必须使用同一个全局变量（eg：计数器）每个线程使用ThreadLocal保存原本争用的变量才是最高效的（有一种用空间换效率的感觉）。

> 共享资源是线程增加时影响更大的处理能力的瓶颈。

