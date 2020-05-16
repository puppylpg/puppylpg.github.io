---
layout: post
title: "Java中断 - 处理InterruptedException"
date: 2020-05-17 00:00:16 +0800
categories: Java interrupt
tags: Java interrupt
---

在Java中，一个线程是不能终止另一个线程的，除非那个线程自己想退出，或者JVM退出了。

比如：
```java
new Thread(
  new Runnable() {
    @Override
    public void run() {
      while (true) {
      }
    }
  }
).start();
```
这个线程在开启之后一直在做无意义的空循环，且这个线程本身没有退出的设定，因此除非退出JVM，否则别的线程奈何不了它，它将会一直欢快地空转下去。

1. Table of Contents, ordered
{:toc}

# 中断信号
每个线程都拥有一个flag，标志着这个线程的中断位。如果一个线程A想让线程B退出，则A将B的中断位(interrupt flag)置为true，我们说“线程A向线程B发了中断信号”。此时如果B检查到了中断位为true，说明有线程想让它中断。**如果B愿意的话**，可以**自愿地**中断自己的线程。（如果B不愿意，仍然可以欢快地跑下去……你尽管让我中断，我就是不听，你奈我何？）

线程B **检查自己的interrupt状态为true，并自愿地退出线程**，是Java中唯一的一个线程让另一个线程终止的方法！
> 为什么要设计成这样？
> 因为服务或线程不能被立即停止，立即停止会使共享的数据结构不一致，相反，应该在停止前做一些清理工作，然后再结束。所以说，不能你让我停我就停，我自己执行的任务，我比你更能清楚在停止前如何进行清理工作。因此，最终的设计就变成了：线程A给B发interrupt信号，B收到信号后，自己决定先做些什么，然后再退出。
> 这是一种**协作机制**，需要B配合。


即：
```java
new Thread(
  new Runnable() {
    @Override
    public void run() {
      while (true) {
        // 有人想让我退出？行吧我退了
        if (Thread.interrupted()) {
          break;
        }
        // Continue to do nothing
      }
    }
  }
).start();
```
因此**当执行很耗时的操作时，需要经常check interrupt的状态，并且一旦发现为true，就应该立即退出，这样才能及时取消那些非常耗时的操作**。

# 阻塞方法
在Thread中，有一些耗时操作，比如`sleep()`、`join()`、`wait()`等，都会在执行的时候check interrupt的状态，一旦检测到为true，立刻抛出`InterruptedException`。

**Java中凡是抛出InterruptedException的方法（再加上`Thread.interrupted()`），都会在抛异常的时候，将interrupt flag重新置为false**。

这也就是说，当一个线程B被中断的时候（比如正在`sleep()`），它会结束sleep状态，抛出InterruptedException，并将interrupt flag置为false。这也就意味着，**此时再去检查线程B的interrupt flag的状态，它是false，不能证明它被中断了，现在唯一能证明当前线程B被中断的证据就是我们现在catch到的InterruptedException**。如果我们不负责任地直接把这个InterruptedException扔掉了，那么没有人知道刚刚发生了中断，没有人知道刚刚有另一个线程想要让线程B停下来，这是不符合程序的目的的：别的线程想让它停下来，而它直接忽略了这个操作。

# 处理方式
有两种方式处理InterruptedException。
## 传递InterruptedException
避开这个异常是最简单明智的做法：直接将异常传递给调用者。这有两种实现方式：
1. 不捕获该异常，在该方法上声明会`throws InterruptedException`；
2. 捕获该异常，做一些操作，然后再**原封不动地**抛出该异常。

做个错误示范：
```java
try {
	Thread.sleep(100);
} catch (InterruptedException e) {
	e.printStackTrace();
	throw new RuntimeException(e);
}
```
这一通操作之后，线程还活着，并且只给上层调用者一个`RuntimeException`，这是不对的。我们必须告诉上层调用者有人想中断这个线程，至于上层怎么做，就不归我们管了。如果一个caller调用的方法可能会抛出InterruptedException异常，那么这个caller需要考虑怎么处理这个异常。

## 恢复中断状态
这里的恢复中断状态指的是，既然该线程的interrupt flag在抛出InterruptedException的时候被置为了false，那么们再重新置为true就好了，告诉后面需要check flag的人，该线程被中断了。**这样中断信息不会丢失**。通过`Thread.currentThread().interrupt()`方法，将该线程的interrupt flag重新置为true。

比如：
```java
try {
	Thread.sleep(100);
} catch (InterruptedException e) {
	e.printStackTrace();
	Thread.currentThread().interrupt();
}
```

# Demos
看三个Demo——

## 传递InterruptedException，不捕获异常，直接抛给调用者
```java
package example.thread.interrupt;

/**
 * 当主线程发出interrupt信号的时候，子线程的sleep()被中断，抛出InterruptedException。
 *
 * sleepBabySleep()不处理sleep()抛出的该异常，直接交到上级caller。上级caller，即doAPseudoHeavyWeightJob()也不处理，继续交给上级caller，最后直接整个线程挂了。也相当于成功退出了线程。
 * 
 * @author liuhaibo on 2018/06/14
 */
public class InterruptDemo1 extends Thread {

    @Override
    public void run() {
        try {
            doAPseudoHeavyWeightJob();
        } catch (InterruptedException e) {
            System.out.println("=.= I(a thread) am dying...");
            e.printStackTrace();
        }
    }

    private void doAPseudoHeavyWeightJob() throws InterruptedException {

        for (int i = 0; i < Integer.MAX_VALUE; i++) {
            System.out.println(i);
            if (i > 10) {
                Thread.currentThread().interrupt();
            }
            // quit if another thread let me interrupt
            if (Thread.currentThread().isInterrupted()) {
                System.out.println("Thread interrupted. Exiting...");
                break;
            } else {
                sleepBabySleep();
            }
        }
    }

    private void sleepBabySleep() throws InterruptedException {
            Thread.sleep(1000);
            System.out.println("Slept for a while!");
    }

    public static void main(String[] args) throws InterruptedException {
        InterruptDemo1 thread = new InterruptDemo1();
        thread.start();
        Thread.sleep(5000);
        // let me interrupt
        thread.interrupt();
        System.out.println("IN MAIN:" + thread.isInterrupted());
    }

    /* Output:
    0
    Slept for a while!
    1
    Slept for a while!
    2
    Slept for a while!
    3
    Slept for a while!
    4
    =.= I(a thread) am dying...
    java.lang.InterruptedException: sleep interrupted
    IN MAIN:false
        at java.lang.Thread.sleep(Native Method)
        at example.thread.interrupt.InterruptDemo1.sleepBabySleep(InterruptDemo1.java:36)
        at example.thread.interrupt.InterruptDemo1.doAPseudoHeavyWeightJob(InterruptDemo1.java:30)
        at example.thread.interrupt.InterruptDemo1.run(InterruptDemo1.java:11)
    */
}
```

## 恢复中断状态
```java
package example.thread.interrupt;

/**
 * 当主线程发出interrupt信号的时候，子线程的sleep()被中断，抛出InterruptedException。
 * 
 * sleepBabySleep()在处理该异常的时候，重新设置interrupt flag为true，则子线程在检测中断flag的时候，成功退出线程。
 * （当然，如果子线程始终不检查是否被中断了，也永远不会退出。所以我们在做一个很耗时的操作时，应该有觉悟检查中断状态，以便收到中断信号时退出。）
 *
 * @author liuhaibo on 2018/06/13
 */
public class InterruptDemo2 extends Thread {

    @Override
    public void run() {
        doAPseudoHeavyWeightJob();
    }

    private void doAPseudoHeavyWeightJob() {

        for (int i = 0; i < Integer.MAX_VALUE; i++) {
            System.out.println(i);
            if (i > 10) {
                Thread.currentThread().interrupt();
            }
            // quit if another thread let me interrupt
            if (Thread.currentThread().isInterrupted()) {
                System.out.println("Thread interrupted. Exiting...");
                break;
            } else {
                sleepBabySleep();
            }
        }
    }

    private void sleepBabySleep() {
        try {
            Thread.sleep(1000);
            System.out.println("Slept for a while!");
        } catch (InterruptedException e) {
            System.out.println("Interruption happens...");
            Thread.currentThread().interrupt();
        }
    }

    public static void main(String[] args) throws InterruptedException {
        InterruptDemo2 thread = new InterruptDemo2();
        thread.start();
        Thread.sleep(5000);
        // let me interrupt
        thread.interrupt();
        System.out.println("IN MAIN:" + thread.isInterrupted());
    }

    /* Output:
    0
    Slept for a while!
    1
    Slept for a while!
    2
    Slept for a while!
    3
    Slept for a while!
    4
    Interruption happens...
    5
    IN MAIN:false
    Thread interrupted. Exiting...
    */
}
```
**当然，如果子线程在耗时操作`doAPseudoHeavyWeightJob()`里始终不检查是否被中断了，也永远不会退出。所以我们在做一个很耗时的操作时，应该有觉悟检查中断状态，以便收到中断信号时退出。**

## 错误的处理方式
错误的处理方式 - 直接吞掉了该异常，也不上报给caller，也不继续重置interrupt flag为true：
```java
package example.thread.interrupt;

/**
 * 当主线程发出interrupt信号的时候，子线程的sleep()被中断，抛出InterruptedException。
 *
 * sleepBabySleep()在处理该异常的时候，直接把该异常吞了。此时interrupt flag为false，在子线程中检测中断flag的时候，不能成功退出线程，
 * 直到i=11的时候，该子线程将自己的interrupt flag设为true，才再次在检查中断的时候，成功退出子线程。
 *
 * @author liuhaibo on 2018/06/13
 */
public class InterruptDemo3 extends Thread {

    @Override
    public void run() {
        doAPseudoHeavyWeightJob();
    }

    private void doAPseudoHeavyWeightJob() {

        for (int i = 0; i < Integer.MAX_VALUE; i++) {
            System.out.println(i);
            // 当大于10时，直接自我了断
            if (i > 10) {
                Thread.currentThread().interrupt();
            }
            // quit if another thread let me interrupt
            if (Thread.currentThread().isInterrupted()) {
                System.out.println("Thread interrupted. Exiting...");
                break;
            } else {
                sleepBabySleep();
            }
        }
    }

    private void sleepBabySleep() {
        try {
            Thread.sleep(1000);
            System.out.println("Slept for a while!");
        } catch (InterruptedException e) {
            System.out.println("Interruption happens... But I do nothing.");
        }
    }

    public static void main(String[] args) throws InterruptedException {
        InterruptDemo3 thread = new InterruptDemo3();
        thread.start();
        Thread.sleep(5000);
        // let me interrupt
        thread.interrupt();
        System.out.println("IN MAIN:" + thread.isInterrupted());
    }

    /* Output:
    0
    Slept for a while!
    1
    Slept for a while!
    2
    Slept for a while!
    3
    Slept for a while!
    4
    Interruption happens... But I do nothing.
    5
    IN MAIN:false
    Slept for a while!
    6
    Slept for a while!
    7
    Slept for a while!
    8
    Slept for a while!
    9
    Slept for a while!
    10
    Slept for a while!
    11
    Thread interrupted. Exiting...
     */
}
```
对于最后一种情况，如果不是当i>10时，线程自己给自己置flag为true，然后进行了自我了断，那么i将一直增长到Integer.MAX_VALUE，才会结束for循环，线程才会退出。这也就是说，另一个线程（main thread）想要打断该线程的操作被该线程忽略了。

# 参阅
1. https://www.yegor256.com/2015/10/20/interrupted-exception.html
2. https://stackoverflow.com/questions/4906799/why-invoke-thread-currentthread-interrupt-in-a-catch-interruptexception-block
3. https://stackoverflow.com/questions/10401947/methods-that-clear-the-thread-interrupt-flag
4. https://stackoverflow.com/questions/2523721/why-do-interruptedexceptions-clear-a-threads-interrupted-status

