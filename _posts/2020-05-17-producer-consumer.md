---
layout: post
title: "生产者 - 消费者"
date: 2020-05-17 00:39:16 +0800
categories: Java producer-consumer concurrency Condition lock BlockingQueue
tags: Java producer-consumer concurrency Condition lock BlockingQueue
---

生产者消费者模式是并发编程的一个经典入门场景。假设多个生产者生产一定数量的东西到队列，多个消费者从队列中取走这些东西。如果队列为空，消费者阻塞；如果队列已满，生产者阻塞。如何不出现访问错误，同时尽可能优化性能？

1. Table of Contents, ordered
{:toc}

# 支持并发put/get的有界队列
生产者-消费者使用的队列一般都是有界的。生产满之后生产者要等消费者消耗掉一些对象才能继续生产。消费者同理。

先考虑一个有界队列：
```
public interface BoundedBuffer<V> {

    /**
     * 往循环队列的末尾加入一个值。
     *
     * @param v 需要放入队列的值
     * @throws Exception 数据放入队列时出现异常
     */
    void put(V v) throws Exception;

    /**
     * 从循环队列的队首里取出一个值。
     *
     * @return 队首的值
     * @throws Exception 从队列取数据出现异常
     */
    V take() throws Exception;
}

```
如何让对列自己支持安全地并发访问？

最简单的方式就是给put/get方法加锁：
```
abstract class BasedBoundedBuffer<V> implements BoundedBuffer<V> {

    private final V[] buffer;
    private int tail, head, count;

    @SuppressWarnings("unchecked")
    protected BasedBoundedBuffer(int capacity) {
        buffer = (V[]) new Object[capacity];
    }

    protected synchronized final void doPut(V v) {
        buffer[tail] = v;
        if (++tail == buffer.length) {
            tail = 0;
        }
        ++count;
    }

    protected final V doTake() {
        V v = buffer[head];
        buffer[head] = null;
        if (++head == buffer.length) {
            head = 0;
        }
        --count;
        return v;
    }

    public final boolean isFull() {
        return count == buffer.length;
    }

    public synchronized final boolean isEmpty() {
        return count == 0;
    }
}
```
先实现一下抽象的基类，使用head和tail从逻辑上将数组变为循环数组。doPut/doTake方法只是封装了逻辑上的put和get操作，显然在并发条件下是不安全的。

比如两个线程都在doPut，线程1放置对象`buffer[tail] = v;`，之后CPU切换，线程2也放置对象`buffer[tail] = v;`，那线程1放置的对象就被覆盖了。

## 自旋等待
考虑最简单的实现：忙等待（自旋等待），实际就是无限重试。
```
public class SpinningBoundedBuffer<V> extends BasedBoundedBuffer<V> {

    protected SpinningBoundedBuffer(int capacity) {
        super(capacity);
    }

    /**
     * {@inheritDoc}。
     * <p>如果队列已满，直接重试。
     *
     * @throws InterruptedException 重试时被中断
     */
    @Override
    public void put(V v) throws InterruptedException {
        while (!Thread.currentThread().isInterrupted()) {
            synchronized (this) {
                if (!isFull()) {
                    doPut(v);
                    return;
                }
            }
        }
        throw new InterruptedException();
    }

    /**
     * {@inheritDoc}。
     * <p>如果队列已满，直接重试。
     *
     * @return 队首的值
     * @throws InterruptedException 重试时被中断
     */
    @Override
    public V take() throws InterruptedException {
        while (!Thread.currentThread().isInterrupted()) {
            synchronized (this) {
                if (!isEmpty()) {
                    return doTake();
                }
            }
        }
        throw new InterruptedException();
    }
}
```
先加锁，再判断条件是否成立，如果满了肯定是不能再调用doPut的，锁释放，继续尝试加锁，询问队列是否满了，没满就成功放进去了，满了就继续询问……直到成功。消费者同理。

> 关于中断，参考[Java中断 - 处理InterruptedException]({% post_url 2020-05-17-java-interrupt %})。

### 优缺点
优点：
- 响应快：一旦队列的对象被消费掉，处于不满的状态，立刻就能成功put。

缺点：
- 如果短期内队列状态没有变化，会消耗大量的cpu时间。

所以如果选择在条件不成立时让出cpu（比如休眠）而不是消耗完整个cpu时间片，整体会更高效。

## 休眠轮询
针对自旋等待在条件不满足是仍然不让出CPU，不断空跑循环的浪费CPU行为，休眠是个不错的节省CPU的方式：我先歇会儿，CPU你们用吧，我一会儿再看条件是否成立。
```
public class SleepyBoundedBuffer<V> extends BasedBoundedBuffer<V> {

    private int interval = 100;

    protected SleepyBoundedBuffer(int capacity) {
        super(capacity);
    }

    protected SleepyBoundedBuffer(int capacity, int interval) {
        super(capacity);
        this.interval = interval;
    }

    /**
     * {@inheritDoc}
     * <p>如果队列已满，线程休眠一段时间，并重试。
     *
     * @throws InterruptedException 休眠中断
     */
    @Override
    public void put(V v) throws InterruptedException {
        while (true) {
            synchronized (this) {
                if (!isFull()) {
                    doPut(v);
                    return;
                }
            }
            Thread.sleep(interval);
        }
    }

    /**
     * {@inheritDoc}。
     * <p>如果队列已满，线程休眠一段时间，并重试。
     *
     * @throws InterruptedException 休眠中断
     */
    @Override
    public V take() throws InterruptedException {
        while (true) {
            synchronized (this) {
                if (!isEmpty()) {
                    return doTake();
                }
            }
            Thread.sleep(interval);
        }
    }
}
```
需要注意的是sleep的时候，**一定要先释放锁再sleep**，或者说sleep方法在锁代码块外面调用，否则该线程带锁sleep了，如果其他线程需要操作队列的线程即使抢到了CPU，还是不能得到锁，无法执行。

### 优缺点
优点：
- 和自旋等待相比，CPU利用率很高。

缺点：
- 响应性降低：在sleep期间，即使队列腾出了空间，doPut依然不会被调用。这一点不如自旋等待。

所以自旋等待和休眠轮询是两种折中的处理方式，**一个浪费了CPU但是增加了响应性，另一个节省了CPU但是牺牲了响应性**。

那么有没有既不浪费CPU又不降低响应性的方式？想做到这一点，最简单的方式就是：条件不满足的时候释放cpu挂起线程，等条件满足的时候有人通知你，这个时候立刻醒来重新抢cpu去执行。

> 很像异步通知：让妈妈做好饭了喊你（通知），而不是你不停地隔几分钟就去问妈妈饭做好了没（轮询）。

# 条件队列
条件队列：在队列中的放置的是一个个等待相关条件的线程，而不是普通元素。所以叫条件队列，以示和普通队列的区别。

**Java中每个对象都可以作为一个锁，也是一个条件队列**。Object的wait/notify/notifyAll方法构成了条件队列的API。

> 想调用某个对象的条件队列的任何一个方法（wait/notify/notifyAll），必须先持有该对象的锁，否则会抛出`java.lang.IllegalMonitorStateException`。对象的内置锁与其条件队列是相互关联的，想调用它的条件队列的方法，必须先持有该对象的锁。**只有能检查状态（必须获取该对象锁），才能调用wait等待某条件发生；只有能修改状态（必须获取该对象锁），才能调用signal从条件等待中释放另一个线程。**

> wait/notify实际上应该属于一个“条件变量”（condition variable）比如mutex，**先获取该锁，再互斥操作临界资源**。Java则把这个condition variable的功能放到了Object里，所以所有的对象都可以成为锁。**一般在Java里，让临界资源充当锁。所以锁和临界资源合为一体了。** C++则是有一个单独的condition variable实现：https://en.cppreference.com/w/cpp/thread/condition_variable

> 如果世界上没有条件变量机制，cpu就只能轮询等待某条件成立。

## wait
释放锁，并等待被唤醒。

当前线程必须拥有此对象的monitor（即锁），才能调用某个对象的wait()方法能让当前线程阻塞，这种阻塞是通过提前释放synchronized锁，重新去请求锁导致的阻塞，这种请求必须有其他线程通过notify()或者notifyAll（）唤醒重新竞争获得锁。

> 即：歇会儿，锁给你们，搞完了叫我，但是我醒了（且抢到锁之后）就从这里继续执行。

##  notify()/notifyAll()：
唤醒那些等待的线程。

notify()或者notifyAll()方法并不释放锁，必须等到synchronized方法或者语法块执行完才真正释放锁。

> 即：快醒醒，临界区的条件满足了，你们可以用了（只要你能竞争到锁），但是我还没释放锁，等我释放了大家（包括我自己）再一起抢。

## 使用条件队列的标准姿势
```
synchronized (sharedObject) {
    while (!condition) {
        // (Releases lock, and reacquires on wakeup)
        sharedObject.wait(); // 获取该对象的锁的线程进入该对象的条件队列
    }
    // do action based upon condition e.g. take or put into queue

    // notify other threads
    notifyAll(); // 通知该对象的条件队列里的所有的线程醒醒，看看条件是否满足了。所以要用while进行判断
}
```
1. 搞清临界资源是什么（比如队列），wait和notify是在等临界资源和通知临界资源；
2. 使用临界资源要加锁，锁的就是临界资源；
3. 判断临界资源是否可用，使用while而非if：
    + 先判断一次是否可用，不可用就wait，但是**再醒过来的时候未必就是可用的**。比如消费者压根没消费，却恶意唤醒生产者，生产者不再次检查是否满足条件就直接生产，gg；
4. 优先使用notifyAll()而非notify()，多唤醒几个，不满足的话让他们再wait就行了。虽然如果大家等待的条件相同，notify()随机唤醒一个等待的线程，是正确且高效的，但是使用notifyAll可以唤醒某些可能被恶意等待的线程，所以优先选用。

# 使用条件队列实现生产者消费者
## 生产者
```
public class Producer extends Thread {

    // 锁对象最好定义成final，要不然如果一个线程正在调用锁，
    // 另一个通过setQueue把queue给换了，gg，这时候另一个线程
    // 会发现拿到了新的queue的锁，然后两个线程就同时执行本来应该锁住的代码块了
    private final Queue<Integer> queue;
    private int maxSize;
    private String name;
    private int producerNum;

    Producer(Queue<Integer> queue, int maxSize, String name, int producerNum) {
        this.queue = queue;
        this.maxSize = maxSize;
        this.name = name;
        this.producerNum = producerNum;
        super.setName(name);
    }

    @Override
    public void run() {
        System.out.println(name + " start at " + System.currentTimeMillis());
        int i = 0;
        while (i++ < producerNum) {
            synchronized (queue) {
                System.out.println("I get the lock~(" + name + ")");
                while (queue.size() >= maxSize) {
                    try {
                        System.out.println("No space to produce, release lock, waiting(" + name + ")");
                        queue.wait();
                        System.out.println("I am awake and get the lock(" + name + ")");
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }
                }
                System.out.println("=> push => " + name + ": " + i);
                queue.add(i);
                System.out.println("Hey, get up!(" + name + ")");
                queue.notifyAll();
                System.out.println("I am gonna release the lock~(" + name + ")");
                // 只要不释放锁，被唤醒的线程就不会执行。不用担心notify到释放锁的时间太长，其他线程得不到锁又wait了。。。
                // 这不是“醒来”，“醒来”更适合表述sleep
            }
        }
        System.out.println("EXIT!(" + name + ")");
    }
}
```
按照上述使用条件队列的标准姿势写的，不再赘述。

## 消费者
```
public class Consumer extends Thread {

    // 锁对象最好定义成final，要不然如果一个线程正在调用锁，
    // 另一个通过setQueue把queue给换了，gg，这时候另一个线程
    // 会发现拿到了新的queue的锁，然后两个线程就同时执行本来应该被锁住的代码块了
    private final Queue<Integer> queue;
    private String name;

    Consumer(Queue<Integer> queue, String name) {
        this.queue = queue;
        this.name = name;
        super.setName(name);
    }

    @Override
    public void run() {
        long start = System.currentTimeMillis();
        System.out.println(name + " start at " + start);

        // exit when getting interrupted
        while (!Thread.currentThread().isInterrupted()) {
            System.out.println("Try to get the lock(" + name + ")");
            synchronized (queue) {
                System.out.println("I get the lock~(" + name + ")");
                while (queue.isEmpty()) {
                    try {
                        System.out.println("No elements to consume, release lock, waiting(" + name + ")");
                        queue.wait();
                        // 被唤醒之后，如果能拿到锁，是从这里接着继续执行的
                        System.out.println("I am awake and get the lock(" + name + ")");
                    } catch (InterruptedException e) {
                        // restore interruption status
                        Thread.currentThread().interrupt();
                        System.out.println("Being interrupted, give up now: " + name);
                        break;
                    }
                }
                if (!queue.isEmpty()) {
                    System.out.println("<= pop  <= " + name + ": " + queue.remove());
                    System.out.println("Hey, get up!(" + name + ")");
                    queue.notifyAll();
                    System.out.println("I am gonna release the lock~(" + name + ")");
                }
            }
        }
    }
}
```
也不再赘述。

# 条件队列优化 - Condition
> @since java 1.5

原有的条件队列wait/notify太笼统，比如生产者生产完一个对象，notify/notifyAll的时候也会通知到在该锁上wait的其他生产者，但其实通知消费者就够了。

Condition可以对条件队列进行细分，使用起来更高效，逻辑也更清晰。

## 使用Condition的正确姿势
- 使用自定义锁对象java.util.concurrent.locks.Lock代替synchronized对象；
- 使用Condition代替锁对象上的monitor方法（wait/notify）。

> 关于Lock，参考[Lock]({% post_url 2019-12-10-lock %})。

这样就能将原来的synchronized锁对象的monitor方法分解到不同的对象上：
- 产生了多对阻塞队列（条件队列）的效果；
- 而且，这样通知的时候就可以只通知特定线程了。

比如原有的wait，当前队列满了，100个生产者线程都在wait。当消费者取出一个元素时，通知生产者可以继续生产了。然后一个生产者生产完毕，本来应该notify消费者可以取了。**结果这个notify会同时通知到生产者，生产者醒来发现还是不能生产，继续wait**。这就产生了不必要的通知。

**本质上是因为生产者消费者都在等待“同一个唤醒信号”**，所以一唤都醒了，然后才发现不是自己，继续wait。

但是Condition就不一样了。对于生产者来说，**只要没满**，就可以醒来生产；对于消费者来说，**只要没空**，就可以醒来消费。所以可以搞出来两个Condition（或者说两个频道），一个叫做“notFull”条件，一个叫做“notEmpty”条件。

对于生产者来说，当队列满了，没有空间的时候，notFull条件不满足，那就调用await方法，使当前线程等待。如果有空间，那么生产者放一个元素进去，notEmpty条件满足，调用notEmpty条件的signal/signalAll，**仅唤醒等待消费的消费者线程（因为只有消费者线程在notEmpty这个频道等着）**。

同理，消费者也一样。这样一来，**生产者只唤醒消费者，消费者只唤醒生产者**。因为他们是两个条件队列。

```
   class BoundedBuffer {
     final Lock lock = new ReentrantLock();
     final Condition notFull  = lock.newCondition(); 
     final Condition notEmpty = lock.newCondition(); 
  
     final Object[] items = new Object[100];
     int putptr, takeptr, count;
  
     public void put(Object x) throws InterruptedException {
       lock.lock();
       try {
         while (count == items.length)
           notFull.await();
         items[putptr] = x;
         if (++putptr == items.length) putptr = 0;
         ++count;
         notEmpty.signal();
       } finally {
         lock.unlock();
       }
     }
  
     public Object take() throws InterruptedException {
       lock.lock();
       try {
         while (count == 0)
           notEmpty.await();
         Object x = items[takeptr];
         if (++takeptr == items.length) takeptr = 0;
         --count;
         notFull.signal();
         return x;
       } finally {
         lock.unlock();
       }
     }
   }
```
用这种方式实现支持并发put/get的有界队列，比自旋等待和休眠轮询要高效很多。

# 阻塞队列 - BlockingQueue
上述使用条件队列实现的支持并发put/get的有界队列，其实就是阻塞队列BlockingQueue。在ArrayBlockingQueue的实现中，take和put方法就是使用了Condition，做到高效并发访问队列。

所以我们平时在构建生产者消费者的时候，使用阻塞队列：
1. 不需要考虑对临界资源加锁解锁；
2. 不需要考虑临界条件是否满足；
3. 不需要考虑wait()/notifyAll()；

只需要直接调用BlockingQueue的put和take方法即可。条件不满足时会阻塞，此时按照Java处理InterruptException的方式处理阻塞时可能发生的异常即可。

> 使用并发包，就是这么简单。学的学多，越容易生活 :D

# 易混淆的概念
## Condition本身也是Object
java.util.concurrent.locks.Condition也继承自object，所以它本身也有wait/notify方法，本身就可以作为synchronized的锁对象。但是这和**Condition + lock + await/signal**这一套体系没有任何关联。

**为了避免混淆，Condition只和Lock搭配，不和synchronized搭配**，即永远别使用它的wait/notify那一套方法了。

> java.util.concurrent.ArrayBlockingQueue的put和take就是通过Condition实现的。（不是用的wait/notify）

> **Lock和Condition相关联，正如内置锁synchronized和wait/notify相关联。**

## Thread本身也是Object
同样，Thread类也继承自object，除了Thread自己的sleep/yeild等方法，它也有wait/notify/notifyAll方法。

Thread的wait/notify方法基本也用不到，毕竟我们去锁一个对象的时候，锁的都是临界资源，还没见过给线程对象加锁的。

Thread自己的sleep/yeild等方法和阻塞队列无关，和锁无关。所以线程在sleep或者yeild的时候，**如果持有锁，都是只交出CPU，不交出锁**（因为他们压根就跟锁的操作无关，所以不影响“持有锁”这一状态）！

> 调用Thread.sleep之前别忘了先释放锁。不要让线程带着锁去休眠。

> 我不知道我以前为什么会混淆Thread的sleep和wait。他们之间的相似性，大概就是wait的时候是无法继续执行的，sleep的时候也是无法执行的。都休眠了。（yield是不休眠的）wait方法调用了native的wait(0)方法，代表永久休眠，除非被唤醒。但是wait(n)在休眠方面有点儿像sleep(n)。

既然说到这儿了，再提一下Thread.sleep(xxx) vs. yield()：
- sleep(xxx)：自己歇了，cpu有可能被低级线程抢到；
- yield()：交出cpu，同时立刻和大家一起竞争。所以yield不可能把cpu交给更低级的线程；

