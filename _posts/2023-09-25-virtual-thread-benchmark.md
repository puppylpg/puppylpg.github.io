---
layout: post
title: "Virtual Thread benchmark"
date: 2023-09-25 23:34:11 +0800
categories: java jmh
tags: java jmh
---

JDK21如期发布，[Virtual Thread]({% post_url 2023-08-21-virtual-thread %})的benckmark来了！

1. Table of Contents, ordered
{:toc}

# 使用
虚线程的意义在于：使用虚线程（可以是直接new，也可以是虚线程池，当然我们倾向于线程池）跑blocking任务更高效，所以不必使用reactive框架继续分解任务了。但因为依然使用（虚）线程池，所以仍然需要异步提交任务。

以sleep模拟blocking任务，分别使用os线程和虚线程执行。

## os线程
虽然是线程池，但是本质上，一个任务还是和一个线程强绑定的：
```java
    private static void thread(Runnable task) {
        long start = System.nanoTime();
        
        try (ExecutorService executorService = Executors.newCachedThreadPool()) {
            IntStream.range(0, ITERATION)
                    .forEach(number -> executorService.submit(task));
        }
        long end = System.nanoTime();
        System.out.println("Completed " + COUNTER.intValue() + " tasks in " + (end - start)/1000000 + "ms");
    }
```
这里使用了try with resource，它会在最后调用close方法，而**executor的close方法会在所有已提交任务结束后才关闭线程池，所以并不是提交完任务主程序就结束了**。

> Initiates an orderly shutdown in which previously submitted tasks are executed, but no new tasks will be accepted. **This method waits until all tasks have completed execution and the executor has terminated.**

所以调用close本身就有等待线程池结束的意思。

## 虚线程
一个任务和一个虚线程强绑定，和线程不强绑定：
```java
    private static void virtualThread(Runnable task) {
        long start = System.nanoTime();
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            IntStream.range(0, ITERATION)
                    .forEach(number -> executor.submit(task));
        }
        long end = System.nanoTime();
        System.out.println("Completed " + COUNTER.intValue() + " tasks in " + (end - start)/1000000 + "ms");
    }
```

简单运行一下，第一个方法需要2864ms，第二个只需要1516ms。

# jmh
想更科学精准地量化效果，还是得jmh！

引入依赖：
```xml
        <dependency>
            <groupId>org.openjdk.jmh</groupId>
            <artifactId>jmh-core</artifactId>
            <version>1.37</version>
        </dependency>
        <dependency>
            <groupId>org.openjdk.jmh</groupId>
            <artifactId>jmh-generator-annprocess</artifactId>
            <version>1.37</version>
            <scope>provided</scope>
        </dependency>
```
参考[这个项目](https://github.com/deepu105/java-loom-benchmarks)对三种线程池进行测试：
- `Executors.newCachedThreadPool()`：无限创建os线程，但是如果之前创建的线程有空闲，会复用之前线程池里的线程；
- `Executors.newVirtualThreadPerTaskExecutor()`：无限创建虚线程，每个task一个虚线程，不池化虚线程；
- `Executors.newThreadPerTaskExecutor(Thread.ofPlatform().factory())`：os线程也可以无限创建且不复用，因此可以推测它的性能是最差的。因为它的行为和`Executors.newVirtualThreadPerTaskExecutor()`类似，特意拉出来跑一跑；

> 其实`Executors.newVirtualThreadPerTaskExecutor()`就是`Executors.newThreadPerTaskExecutor(Thread.ofVirtual().factory())`。

代码如下：
```java
@Fork(value = 1, jvmArgs = {"-Xms512m", "-Xmx1024m"})
@BenchmarkMode({Mode.Throughput, Mode.AverageTime})
@Warmup(time = 2)
@State(Scope.Benchmark)
@Timeout(time = 60)
@Threads(2)
public class ThreadsBenchmark {

    public static void main(String[] args) throws RunnerException {
        Options opt = new OptionsBuilder()
                .include(ThreadsBenchmark.class.getSimpleName())
                .forks(1)
                .build();

        new Runner(opt).run();
    }

    @Benchmark
    public void platformThreadPool() {
        try (var executor = Executors.newCachedThreadPool()) {
            IntStream.range(0, 10_000).forEach(i -> executor.submit(() -> {
                Thread.sleep(Duration.ofMillis(200));
                return i;
            }));
        }
    }

    @Benchmark
    public void platformThreadPerTask() {
        try (var executor = Executors.newThreadPerTaskExecutor(Thread.ofPlatform().factory())) {
            IntStream.range(0, 10_000).forEach(i -> executor.submit(() -> {
                Thread.sleep(Duration.ofMillis(200));
                return i;
            }));
        }
    }

    @Benchmark
    public void virtualThreadPerTask() {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            IntStream.range(0, 10_000).forEach(i -> executor.submit(() -> {
                Thread.sleep(Duration.ofMillis(200));
                return i;
            }));
        }
    }

}
```
总共进行了两类benchmark：Mode.Throughput和Mode.AverageTime，前者是算每秒能跑多少次，后者是每次需要跑多少秒。

每次跑之前都会warmup，可以看出来还是很必要的：
```
# JMH version: 1.37
# VM version: JDK 21, OpenJDK 64-Bit Server VM, 21+35-2513
# VM invoker: C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe
# VM options: -Xms512m -Xmx1024m
# Blackhole mode: compiler (auto-detected, use -Djmh.blackhole.autoDetect=false to disable)
# Warmup: 5 iterations, 2 s each
# Measurement: 5 iterations, 10 s each
# Timeout: 60 s per iteration
# Threads: 2 threads, will synchronize iterations
# Benchmark mode: Throughput, ops/time
# Benchmark: xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPerTask

# Run progress: 0.00% complete, ETA 00:06:00
# Fork: 1 of 1
# Warmup Iteration   1: 0.336 ops/s
# Warmup Iteration   2: 0.846 ops/s
# Warmup Iteration   3: 0.841 ops/s
# Warmup Iteration   4: 0.851 ops/s
# Warmup Iteration   5: 0.851 ops/s
Iteration   1: 0.856 ops/s
Iteration   2: 0.871 ops/s
Iteration   3: 0.861 ops/s
Iteration   4: 0.856 ops/s
Iteration   5: 0.841 ops/s
```
第一轮warmup明显不在正常水平。

最终结果如下：
```
Benchmark                                Mode  Cnt  Score   Error  Units
ThreadsBenchmark.platformThreadPerTask  thrpt    5  0.857 ± 0.042  ops/s
ThreadsBenchmark.platformThreadPool     thrpt    5  1.494 ± 0.279  ops/s
ThreadsBenchmark.virtualThreadPerTask   thrpt    5  9.038 ± 0.268  ops/s
ThreadsBenchmark.platformThreadPerTask   avgt    5  2.322 ± 0.081   s/op
ThreadsBenchmark.platformThreadPool      avgt    5  1.426 ± 0.386   s/op
ThreadsBenchmark.virtualThreadPerTask    avgt    5  0.220 ± 0.005   s/op
```
不出意外，newThreadPerTaskExecutor最差（0.857 ± 0.042  ops/s），池化的会好不少（1.494 ± 0.279  ops/s），但都远远比不上虚线程池（9.038 ± 0.268  ops/s），在该场景下，虚线程池的执行效率大概是os线程池的6倍。

完整日志如下：
```
C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe "-javaagent:C:\Users\puppylpg\AppData\Local\Programs\IntelliJ IDEA Ultimate\lib\idea_rt.jar=2906:C:\Users\puppylpg\AppData\Local\Programs\IntelliJ IDEA Ultimate\bin" -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -classpath C:\Users\puppylpg\Documents\GitHub\java-examples\8-plus\normal\target\classes;C:\Users\puppylpg\.m2\repository\org\apache\tomcat\embed\tomcat-embed-core\11.0.0-M7\tomcat-embed-core-11.0.0-M7.jar;C:\Users\puppylpg\.m2\repository\org\apache\tomcat\tomcat-annotations-api\11.0.0-M7\tomcat-annotations-api-11.0.0-M7.jar;C:\Users\puppylpg\.m2\repository\org\openjdk\jmh\jmh-core\1.37\jmh-core-1.37.jar;C:\Users\puppylpg\.m2\repository\net\sf\jopt-simple\jopt-simple\5.0.4\jopt-simple-5.0.4.jar;C:\Users\puppylpg\.m2\repository\org\apache\commons\commons-math3\3.6.1\commons-math3-3.6.1.jar xyz.puppylpg.vthread.benchmark.ThreadsBenchmark
# JMH version: 1.37
# VM version: JDK 21, OpenJDK 64-Bit Server VM, 21+35-2513
# VM invoker: C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe
# VM options: -Xms512m -Xmx1024m
# Blackhole mode: compiler (auto-detected, use -Djmh.blackhole.autoDetect=false to disable)
# Warmup: 5 iterations, 2 s each
# Measurement: 5 iterations, 10 s each
# Timeout: 60 s per iteration
# Threads: 2 threads, will synchronize iterations
# Benchmark mode: Throughput, ops/time
# Benchmark: xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPerTask

# Run progress: 0.00% complete, ETA 00:06:00
# Fork: 1 of 1
# Warmup Iteration   1: 0.336 ops/s
# Warmup Iteration   2: 0.846 ops/s
# Warmup Iteration   3: 0.841 ops/s
# Warmup Iteration   4: 0.851 ops/s
# Warmup Iteration   5: 0.851 ops/s
Iteration   1: 0.856 ops/s
Iteration   2: 0.871 ops/s
Iteration   3: 0.861 ops/s
Iteration   4: 0.856 ops/s
Iteration   5: 0.841 ops/s


Result "xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPerTask":
0.857 ±(99.9%) 0.042 ops/s [Average]
(min, avg, max) = (0.841, 0.857, 0.871), stdev = 0.011
CI (99.9%): [0.815, 0.899] (assumes normal distribution)


# JMH version: 1.37
# VM version: JDK 21, OpenJDK 64-Bit Server VM, 21+35-2513
# VM invoker: C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe
# VM options: -Xms512m -Xmx1024m
# Blackhole mode: compiler (auto-detected, use -Djmh.blackhole.autoDetect=false to disable)
# Warmup: 5 iterations, 2 s each
# Measurement: 5 iterations, 10 s each
# Timeout: 60 s per iteration
# Threads: 2 threads, will synchronize iterations
# Benchmark mode: Throughput, ops/time
# Benchmark: xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPool

# Run progress: 16.67% complete, ETA 00:07:51
# Fork: 1 of 1
# Warmup Iteration   1: 1.494 ops/s
# Warmup Iteration   2: 1.330 ops/s
# Warmup Iteration   3: 1.301 ops/s
# Warmup Iteration   4: 1.341 ops/s
# Warmup Iteration   5: 1.181 ops/s
Iteration   1: 1.430 ops/s
Iteration   2: 1.510 ops/s
Iteration   3: 1.421 ops/s
Iteration   4: 1.513 ops/s
Iteration   5: 1.599 ops/s


Result "xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPool":
1.494 ±(99.9%) 0.279 ops/s [Average]
(min, avg, max) = (1.421, 1.494, 1.599), stdev = 0.072
CI (99.9%): [1.215, 1.774] (assumes normal distribution)


# JMH version: 1.37
# VM version: JDK 21, OpenJDK 64-Bit Server VM, 21+35-2513
# VM invoker: C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe
# VM options: -Xms512m -Xmx1024m
# Blackhole mode: compiler (auto-detected, use -Djmh.blackhole.autoDetect=false to disable)
# Warmup: 5 iterations, 2 s each
# Measurement: 5 iterations, 10 s each
# Timeout: 60 s per iteration
# Threads: 2 threads, will synchronize iterations
# Benchmark mode: Throughput, ops/time
# Benchmark: xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.virtualThreadPerTask

# Run progress: 33.33% complete, ETA 00:05:45
# Fork: 1 of 1
# Warmup Iteration   1: 5.175 ops/s
# Warmup Iteration   2: 8.754 ops/s
# Warmup Iteration   3: 8.863 ops/s
# Warmup Iteration   4: 9.138 ops/s
# Warmup Iteration   5: 8.983 ops/s
Iteration   1: 8.981 ops/s
Iteration   2: 9.124 ops/s
Iteration   3: 9.078 ops/s
Iteration   4: 9.050 ops/s
Iteration   5: 8.954 ops/s


Result "xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.virtualThreadPerTask":
9.038 ±(99.9%) 0.268 ops/s [Average]
(min, avg, max) = (8.954, 9.038, 9.124), stdev = 0.070
CI (99.9%): [8.770, 9.305] (assumes normal distribution)


# JMH version: 1.37
# VM version: JDK 21, OpenJDK 64-Bit Server VM, 21+35-2513
# VM invoker: C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe
# VM options: -Xms512m -Xmx1024m
# Blackhole mode: compiler (auto-detected, use -Djmh.blackhole.autoDetect=false to disable)
# Warmup: 5 iterations, 2 s each
# Measurement: 5 iterations, 10 s each
# Timeout: 60 s per iteration
# Threads: 2 threads, will synchronize iterations
# Benchmark mode: Average time, time/op
# Benchmark: xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPerTask

# Run progress: 50.00% complete, ETA 00:03:56
# Fork: 1 of 1
# Warmup Iteration   1: 2.577 s/op
# Warmup Iteration   2: 2.357 s/op
# Warmup Iteration   3: 2.371 s/op
# Warmup Iteration   4: 2.357 s/op
# Warmup Iteration   5: 2.382 s/op
Iteration   1: 2.313 s/op
Iteration   2: 2.317 s/op
Iteration   3: 2.356 s/op
Iteration   4: 2.301 s/op
Iteration   5: 2.323 s/op


Result "xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPerTask":
2.322 ±(99.9%) 0.081 s/op [Average]
(min, avg, max) = (2.301, 2.322, 2.356), stdev = 0.021
CI (99.9%): [2.241, 2.402] (assumes normal distribution)


# JMH version: 1.37
# VM version: JDK 21, OpenJDK 64-Bit Server VM, 21+35-2513
# VM invoker: C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe
# VM options: -Xms512m -Xmx1024m
# Blackhole mode: compiler (auto-detected, use -Djmh.blackhole.autoDetect=false to disable)
# Warmup: 5 iterations, 2 s each
# Measurement: 5 iterations, 10 s each
# Timeout: 60 s per iteration
# Threads: 2 threads, will synchronize iterations
# Benchmark mode: Average time, time/op
# Benchmark: xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPool

# Run progress: 66.67% complete, ETA 00:02:42
# Fork: 1 of 1
# Warmup Iteration   1: 1.378 s/op
# Warmup Iteration   2: 1.417 s/op
# Warmup Iteration   3: 1.357 s/op
# Warmup Iteration   4: 1.402 s/op
# Warmup Iteration   5: 1.372 s/op
Iteration   1: 1.300 s/op
Iteration   2: 1.509 s/op
Iteration   3: 1.540 s/op
Iteration   4: 1.424 s/op
Iteration   5: 1.360 s/op


Result "xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.platformThreadPool":
1.426 ±(99.9%) 0.386 s/op [Average]
(min, avg, max) = (1.300, 1.426, 1.540), stdev = 0.100
CI (99.9%): [1.040, 1.813] (assumes normal distribution)


# JMH version: 1.37
# VM version: JDK 21, OpenJDK 64-Bit Server VM, 21+35-2513
# VM invoker: C:\Users\puppylpg\.jdks\openjdk-21\bin\java.exe
# VM options: -Xms512m -Xmx1024m
# Blackhole mode: compiler (auto-detected, use -Djmh.blackhole.autoDetect=false to disable)
# Warmup: 5 iterations, 2 s each
# Measurement: 5 iterations, 10 s each
# Timeout: 60 s per iteration
# Threads: 2 threads, will synchronize iterations
# Benchmark mode: Average time, time/op
# Benchmark: xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.virtualThreadPerTask

# Run progress: 83.33% complete, ETA 00:01:20
# Fork: 1 of 1
# Warmup Iteration   1: 0.382 s/op
# Warmup Iteration   2: 0.223 s/op
# Warmup Iteration   3: 0.220 s/op
# Warmup Iteration   4: 0.220 s/op
# Warmup Iteration   5: 0.218 s/op
Iteration   1: 0.219 s/op
Iteration   2: 0.219 s/op
Iteration   3: 0.222 s/op
Iteration   4: 0.219 s/op
Iteration   5: 0.219 s/op


Result "xyz.puppylpg.vthread.benchmark.ThreadsBenchmark.virtualThreadPerTask":
0.220 ±(99.9%) 0.005 s/op [Average]
(min, avg, max) = (0.219, 0.220, 0.222), stdev = 0.001
CI (99.9%): [0.215, 0.224] (assumes normal distribution)


# Run complete. Total time: 00:07:46

REMEMBER: The numbers below are just data. To gain reusable insights, you need to follow up on
why the numbers are the way they are. Use profilers (see -prof, -lprof), design factorial
experiments, perform baseline and negative tests that provide experimental control, make sure
the benchmarking environment is safe on JVM/OS/HW level, ask for reviews from the domain experts.
Do not assume the numbers tell you what you want them to tell.

NOTE: Current JVM experimentally supports Compiler Blackholes, and they are in use. Please exercise
extra caution when trusting the results, look into the generated code to check the benchmark still
works, and factor in a small probability of new VM bugs. Additionally, while comparisons between
different JVMs are already problematic, the performance difference caused by different Blackhole
modes can be very significant. Please make sure you use the consistent Blackhole mode for comparisons.

Benchmark                                Mode  Cnt  Score   Error  Units
ThreadsBenchmark.platformThreadPerTask  thrpt    5  0.857 ± 0.042  ops/s
ThreadsBenchmark.platformThreadPool     thrpt    5  1.494 ± 0.279  ops/s
ThreadsBenchmark.virtualThreadPerTask   thrpt    5  9.038 ± 0.268  ops/s
ThreadsBenchmark.platformThreadPerTask   avgt    5  2.322 ± 0.081   s/op
ThreadsBenchmark.platformThreadPool      avgt    5  1.426 ± 0.386   s/op
ThreadsBenchmark.virtualThreadPerTask    avgt    5  0.220 ± 0.005   s/op

Process finished with exit code 0

```

# 感想
说JDK21是革命性的确实不为过。**虚线程可以在维持原有编程风格的前提下，对blocking code的执行效率提升这么多**，那么reactive式的异步编程框架真的还有用吗？谁的效率更高？退一万步说，即使reactive仍有优势，这些优势还足以让程序猿不惜以碎片化代码、高难度的组装代码、高难度的debug为代价吗？

