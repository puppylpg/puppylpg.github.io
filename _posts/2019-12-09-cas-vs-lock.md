---
layout: post
title: "CAS：也可以不用锁"
date: 2019-12-09 01:02:19 +0800
categories: Java CAS concurrency
tags: Java CAS concurrency
---

想访问共享变量，锁住就行了，通过锁，可以获取对变量的独占访问。那么CAS又是干嘛的？

1. Table of Contents, ordered
{:toc}

# 为什么使用CAS
## 锁的缺陷
虽然使用锁可以实现对共享变量的独占访问，但是使用锁有一些缺陷：

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
锁，也就是独占锁，本质上是一种**悲观**技术（悲观地认为，只要不加锁，共享区域就会被搞乱）。所有的操作都是排他的。

**乐观**的方法一般比悲观的高效：先操作，如果发现没有被干扰，成了。如果被干扰了，白搞了，try again（或者也可以不try，取决于策略）。

CAS是由底层CPU支持的操作：比较并交换。如果值和预期相同，则交换。它是乐观的技术，期望能成功执行更新操作。但是如果另一个线程在这之间抢先更新了该变量，CAS能检测到这个错误。

**CAS执行失败的时候，并不会挂起线程，而是被告知失败，由于未被挂起（不会阻塞），该线程可以决定是否重试**。

CAS既支持原子性，又类似于volatile变量的机制，可以理解为一种泛化的volatile变量。

# CAS
## CAS的语义
CAS的语义等同于下面的伪代码（只是语义上，真正实现上是CPU搞的，非常高效）：
```java
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

    public synchronized boolean compareAndSwap(int expectedValue, int newValue) {
        int oldValue = value;
        if (oldValue == expectedValue) {
            value = newValue;
            return true;
        } else {
            return false;
        }
    }
}
```

## 使用场景
读取A的值，计算得到B，在set回去之前，判断A是否变了，没变则将A设为B。

如果变了，则有不同的策略：
- 如果是对一个共享的计数器执行+1操作，则失败后要继续重试；
- 如果是比如“发生某件事情就从False改为True”，则失败后说明别的线程已经设为true了，就不用再重试了。

所以失败后的策略根据使用场景来决定。

## 使用CAS实现非阻塞功能
比如非阻塞计数器：
```java
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
        } while (!value.compareAndSwap(v, v + 1));
        return v + 1;
    }
}
```

可以看到CAS和加锁比，**主要缺陷**就是：**使用CAS要自己考虑处理竞争问题（是否要重试之类的），而使用锁，锁自己会处理这些问题，我们只需要假设拿到锁，考虑怎么用就行了**。

使用CAS将一些阻塞算法换成非阻塞实现，是需要好好考虑的事情（一般由专家完成）。

## 性能
> 在支持CAS的平台上，JVM会编译为相应的CAS指令，最坏情况，如果平台不支持CAS，JVM在底层会将其实现为**自旋锁**。现代处理器针对多处理器操作，一般都提供了这种指令。

所以也可以从逻辑上，将CAS理解为一种更高效的自旋。那么CAS和锁相比，一个无限重试，一个阻塞从而引入切换上下文开销，谁更快？

结论：
- 如果竞争程度特别高（极端情况，根本没有需要CPU计算的任务，就是在不停争用共享变量），锁的性能更好：

因为：
- **CAS的不断重试其实在本就激烈的竞争环境中引入了更多的竞争**；
- 锁机制挂起线程，减少了共享内存总线上的同步通信量；

这个理论在其他领域是共通的：
- 交通流量大，拥堵时，悲观的信号灯方式更高效，总能一次过一批车，而环岛就很堵，所有车都在慢慢挪动。但是低拥堵时期，环岛能实现更高吞吐（不用傻等），红绿灯就得傻等，很低效；
- 以太网中，当低通信流量时，竞争机制很好，但是高拥堵时，令牌环网络反而更好；

但是如果更多的时候是计算任务，这样对共享变量的访问频率变会降低，通常CAS更高效。

## ABA问题
**CAS虽然compare and swap整个过程是原子操作，但是和它之前的操作不是原子的**，在做这个操作之前，可能休眠了，原值先被其他线程改成了其他值，又被改了回去。这一来一回的改动，该线程是不知道的。

**对于数值类场景，一般没什么关系**。比如：
1. 查到原来的余额是50；
2. 现在又存50，所以想compareAndSet(50, 100)；

即使在1和2之前忽然先执行了两笔操作+1000再-1000，再去执行2，也没什么毛病。

**但对于引用类的场景，这种“只要值不变就没事儿”的情况就不成立了**。比如链表为A -> B -> A，一开始有三个，如果删掉开头的A，再删掉B，此时链表开头还是A，不能说开头还是A所以链表没变。

想解决ABA问题：
1. 使用锁。检查、set（此时没必要使用compareAndSet了）两个动作变成原子操作；
2. 加个版本号，得以感知是否发生了变动。

**Java提供了`AtomicStampedReference<V>`，它的compareAndSet就比`AtomicReference<V>`多了校验版本的功能。它的stamp参数就是版本号**：
```java
    public boolean compareAndSet(V   expectedReference,
                                 V   newReference,
                                 int expectedStamp,
                                 int newStamp) {
        Pair<V> current = pair;
        return
            expectedReference == current.reference &&
            expectedStamp == current.stamp &&
            ((newReference == current.reference &&
              newStamp == current.stamp) ||
             casPair(current, Pair.of(newReference, newStamp)));
    }
```
的set和compareAndSet都要提供一个新的stamp，般设置为`AtomicStampedReference#getStamp() + 1`。

参考：
- https://www.cnblogs.com/549294286/p/3766717.html

## 使用`AtomicStampedReference`的坑
jdk有一堆AtomicXXX，AtomicReference是最通用的那一个。比如AtomicInteger可以算是AtomicReference的特例。但是AtomicStampedXXX只有AtomicStampedReference一个，如果想存带stamp的int，应该使用`AtomicStampedReference<Integer>`。

> 类似泛型集合，没有IntList，只好用`List<Integer>`。

但是，**如果要获取其当前存储的值，必须用Integer而非int**：
```java
Integer now = xxx.getReference()
```
如果用int接收，则**发生了拆箱**。如果拆箱之后再调用compareAndSet：
```java
xxx.compareAndSet(now, now * 2, expectedStamp, newStamp)
```
此时由于该函数接收的第一个参数类型为Integer，所以**又会发生装箱**。

装箱：
```java
    public static Integer valueOf(int i) {
        if (i >= IntegerCache.low && i <= IntegerCache.high)
            return IntegerCache.cache[i + (-IntegerCache.low)];
        return new Integer(i);
    }
```
-128~127的Integer是被IntegerCache这个东西cache好的：
```java
    private static class IntegerCache {
        static final int low = -128;
        static final int high;
        static final Integer cache[];

        static {
            // high value may be configured by property
            int h = 127;
            String integerCacheHighPropValue =
                sun.misc.VM.getSavedProperty("java.lang.Integer.IntegerCache.high");
            if (integerCacheHighPropValue != null) {
                try {
                    int i = parseInt(integerCacheHighPropValue);
                    i = Math.max(i, 127);
                    // Maximum array size is Integer.MAX_VALUE
                    h = Math.min(i, Integer.MAX_VALUE - (-low) -1);
                } catch( NumberFormatException nfe) {
                    // If the property cannot be parsed into an int, ignore it.
                }
            }
            high = h;

            cache = new Integer[(high - low) + 1];
            int j = low;
            for(int k = 0; k < cache.length; k++)
                cache[k] = new Integer(j++);

            // range [-128, 127] must be interned (JLS7 5.1.7)
            assert IntegerCache.high >= 127;
        }

        private IntegerCache() {}
    }
```
所以jdk里的-127~127的Integer，除非自己手动创建，否则装箱后都是同一个Integer对象。但是超出这个范围，每个装箱后的Integer都是一个全新的Integer。**`AtomicStampedReference#compareAndSet`是使用`==`来进行引用比较的，不是值比较**。

**所以如果用int承接`AtomicStampedReference<Integer>`的值，再比较Integer还是不是之前的Integer，只要不在这个范围，都会因为用的是引用比较返回false，拒绝更新**。


# 原子变量类：AtomicXxx
JVM里的CAS原子变量类直接利用了硬件对并发的支持。

## 底层CAS支持
以AtomicInteger为例，它提供的compareAndSet复合操作：
```java
    /**
     * Atomically sets the value to the given updated value
     * if the current value {@code ==} the expected value.
     *
     * @param expect the expected value
     * @param update the new value
     * @return {@code true} if successful. False return indicates that
     * the actual value was not equal to the expected value.
     */
    public final boolean compareAndSet(int expect, int update) {
        return unsafe.compareAndSwapInt(this, valueOffset, expect, update);
    }
```
该操作使用了unsafe的compareAndSwapInt，这是一个native方法：
```java
public final native boolean compareAndSwapInt(Object var1, long var2, int var4, int var5);
```
> Unsafe是位于sun.misc包下的一个类，主要提供一些用于执行低级别、不安全操作的方法，如直接访问系统内存资源、自主管理内存资源等，这些方法在提升Java运行效率、增强Java语言底层资源操作能力方面起到了很大的作用。
> 
> 具体可参考[Java魔法类：Unsafe应用解析](https://tech.meituan.com/2019/02/14/talk-about-java-magic-class-unsafe.html)

Unsafe提供的CAS操作有：
- compareAndSwapObject(Object o, long offset, Object expected, Object update);
- compareAndSwapInt(Object o, long offset, int expected, int update);
- compareAndSwapLong(Object o, long offset, long expected, long update);

**offset指的是AtomicInteger的value字段在AtomicInteger对象中的内存偏移地址**：
```java
    static {
        try {
            valueOffset = unsafe.objectFieldOffset
                (AtomicInteger.class.getDeclaredField("value"));
        } catch (Exception ex) { throw new Error(ex); }
    }
```
在使用的时候，通过object和valueOffset可以定位value这个字段的内存地址，然后取该内存的值判断是否和expected相同，相同则将其更新为update。

## 拓展原子复合操作
有了基础的CAS操作，可以利用其搞一些原子的复合操作。

比如AtomicInteger的getAndAdd，就是一个原子复合操作：
```java
    /**
     * Atomically adds the given value to the current value.
     *
     * @param delta the value to add
     * @return the previous value
     */
    public final int getAndAdd(int delta) {
        return unsafe.getAndAddInt(this, valueOffset, delta);
    }
```
它使用的是unsafe的getAndAddInt，而这个方法就是使用unsafe自身的CAS操作compareAndSwapInt实现的：
```java
    public final int getAndAddInt(Object object, long valueOffset, int delta) {
        int oldValue;
        do {
            oldValue = this.getIntVolatile(object, valueOffset);
        } while(!this.compareAndSwapInt(object, valueOffset, oldValue, oldValue + delta));

        return oldValue;
    }
```
其他原子复合操作例如getAndIncrement、getAndSet等都是使用底层CAS实现的**非阻塞算法**。

另外虽然AtomicInteger extends Number，但是并没有extends Integer，因为Integer是基本类型的包装类，不可变。而AtomicInteger是可修改的。所以没有在AtomicInteger等类中override hashCode和equals等，也不应该拿它们做散列容器的key。

# 可伸缩性
程序除了运行快慢，还有“处理能力”的衡量标准，即在资源一定时，能完成的工作量。可伸缩性指当增加资源时，程序的处理能力能相应增加。

但是**竞争与可伸缩性是背道而驰的**，**CAS能提高竞争的效率，从而提高程序的可伸缩性**。但是只有完全消除竞争，才能实现真正的可伸缩性。eg：如果不是所有线程都必须使用同一个全局变量（eg：计数器），那么每个线程使用ThreadLocal保存原本争用的变量，使之不再需要争用，才是最高效的实现（有一种用空间换效率的感觉）。

> 共享资源是线程增加时影响更大的处理能力的瓶颈。
