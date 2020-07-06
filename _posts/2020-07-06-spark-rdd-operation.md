---
layout: post
title: "Spark RDD"
date: 2020-07-06 16:11:30 +0800
categories: spark RDD
tags: spark RDD
---

RDD操作大体上和Dataset是一致的，比如以下存储创建RDD、transformation、action等。但是还是有区别的，比如groupByKey在RDD中是应用于Tuple2类型，在Dataset中则可以按照任意指定column group by。另外二者的序列化方式貌似也是不同的，RDD使用Java或Kryo，Dataset使用具体的Encoder，支持在不反序列化的情况下进行filter等操作。

1. Table of Contents, ordered
{:toc}

# RDD操作
## 创建RDD
创建RDD多使用SparkContext（Spark 2.0之前，SparkContext + RDD是标配）：
- parallelize(Seq);
- textFile;
- wholeTextFiles;
- sequenceFile;

等SparkContext的方法都可以。

## 存储RDD
RDD有以下直接存储数据的方法，当然不如avro等效率高：
- saveAsObjectFile: Save this RDD as a SequenceFile of serialized objects.使用的是Java对象序列化方式；
- saveAsTextFile: Save this RDD as a text file, using string representations of elements.

RDD中也有一个sparkContext变量……和SparkSession一样。

## transformation
操作Tuple2的RDD，PairRDDFunctions[K, V]：
- `reduceByKey(func: (V, V) ⇒ V): RDD[(K, V)]`：(T, T) => T；
- `foldByKey(zeroValue: V)(func: (V, V) ⇒ V): RDD[(K, V)]`：相比于reduceByKey还要有个初始zero value；
- `aggregateByKey[U](zeroValue: U)(seqOp: (U, V) ⇒ U, combOp: (U, U) ⇒ U)(implicit arg0: ClassTag[U]): RDD[(K, U)]`：类似于foldByKey，但是能改变返回值类型：
    + 参数1：新的返回类型的零值；
    + 参数2：同partition内的原有类型V怎么吸收进类型U；
    + 参数3：不同partition之间的U怎么合并；

比如有一个pair rdd：
```
val pairs: RDD[(String, Int)] = sc.parallelize(Array(("a", 3), ("a", 1), ("b", 7), ("a", 5)))
```
把它按key聚合，值收集为set：
```
val sums: RDD[(String, HashSet[Int])] = pairs.aggregateByKey(new HashSet[Int])(_+=_, _++=_)
```

> **RDD里的reduceByKey和Dataset里的reduceByKey是两回事。**

那些不带byKey的版本：
- reduce
- fold
- aggregate

其实就是把整个rdd（没有key）当做同一个key去聚合，最终的结果就是**整个RDD[T]被转换为了一个单值T或U**。


## action

## 常见误操作
RDD是Tuple2时，经常有一个误操作：
```
scala> val rdd = sc.wholeTextFiles("licenses")
rdd: org.apache.spark.rdd.RDD[(String, String)] = licenses MapPartitionsRDD[1] at wholeTextFiles at <console>:24

scala> rdd.map((k, v) => k).foreach(println)
<console>:26: error: missing parameter type
Note: The expected type requires a one-argument function accepting a 2-Tuple.
      Consider a pattern matching anonymous function, `{ case (k, v) =>  ... }`
       rdd.map((k, v) => k).foreach(println)
                ^
<console>:26: error: missing parameter type
       rdd.map((k, v) => k).foreach(println)
```
原因很简单，map的函数是个单参数函数，传入T，map为U。这里T指代的是Tuple2：
```
scala> rdd.map(t => t._1).foreach(println)
file:/home/win-pichu/Utils/spark/spark-2.4.6-bin-hadoop2.7/licenses/LICENSE-join.txt
file:/home/win-pichu/Utils/spark/spark-2.4.6-bin-hadoop2.7/licenses/LICENSE-AnchorJS.txt
file:/home/win-pichu/Utils/spark/spark-2.4.6-bin-hadoop2.7/licenses/LICENSE-CC0.txt
```

或者使用中括号和case，至于为啥之后再看： TODO
```
scala> rdd.map({ case (k, v) => k }).foreach(println)
```

我们自己转换成的Tuple2的RDD也一样：
```
scala> val file = sc.textFile("licenses/LICENSE-protobuf.txt")
file: org.apache.spark.rdd.RDD[String] = licenses/LICENSE-protobuf.txt MapPartitionsRDD[5] at textFile at <console>:24

scala> val filePair = file.map(line => (line, 1))
filePair: org.apache.spark.rdd.RDD[(String, Int)] = MapPartitionsRDD[7] at map at <console>:25

scala> filePair.map(t => t._1).foreach(println)
```

## 输出所有数据
另外想按序数据rdd所有元素，必须都collect到driver里（注意driver可能会OOM）：
```
scala> rdd.sortByKey(true).map(t => t._1).collect.foreach(println)
```
否则：
- 对于local运行模式，会无序输出。因为那个executor先输出不一定；
- 对于cluster运行模式，不输出，因为executor的输出并不能显示在driver端；

## 重新分区
关于coalesce和repartition：
```
scala> filePair.saveAsTextFile("tmp-data/protobuf")

scala> filePair.coalesce(1).saveAsTextFile("tmp-data/protobuf-coalesce")

scala> filePair.repartition(4).saveAsTextFile("tmp-data/protobuf-repartition")
```
结果：
```
win-pichu@DESKTOP-T467619:~/Utils/spark/spark-2.4.6-bin-hadoop2.7/tmp-data
% tree                                                                                              20-06-17 - 22:41:21
.
├ protobuf
│   ├ part-00000
│   ├ part-00001
│   └ _SUCCESS
├ protobuf-coalesce
│   ├ part-00000
│   └ _SUCCESS
└ protobuf-repartition
    ├ part-00000
    ├ part-00001
    ├ part-00002
    ├ part-00003
    └ _SUCCESS

3 directories, 10 files
```

# shuffle
To organize all the data for a single reduceByKey reduce task to execute, Spark needs to perform an all-to-all operation. It must read from all partitions to find all the values for all keys, and then bring together values across partitions to compute the final result for each key - **this is called the shuffle**.

以下操作会发生shuffle：
- repartition
    + repartition
    + coalesce
- XBykey
    - groupByKey
    - reduceByKey
- join
    - join
    - cogroup

Spark使用了类似MapReduce里的map和reduce的操作。map的数据存储在内存中，供reduce用。在shuffle时，因为要使用内存里的数据结构来组织数据记录，会消耗大量内存。如果内存不够用，会先溢出到硬盘上，reduce再从硬盘上读。临时文件会存储在`spark.local.dir`指定的地方。

# 共享变量
因为可读写的共享变量在不同任务间同步其实很费劲，也不高效，所以spark只提供了两种共享变量，一种只读，一种只可累加。
## Broadcast
只读。把一个变量创建为Broadcast的好处是，只向各个executor发送一次，就会被executor缓存下来，供以后使用。适用于一些大的只读查询表。

而常规变量作为函数的一部分，每次发送函数到executor的时候都要重新发一遍这些变量。
```
scala> val broadcastVar = sc.broadcast(Array(1, 2, 3))
broadcastVar: org.apache.spark.broadcast.Broadcast[Array[Int]] = Broadcast(0)

scala> broadcastVar.value
res0: Array[Int] = Array(1, 2, 3)
```

## Accumulator
累加器（可以+1，也可以加其他值，并不是只能+1）由driver发给executor，执行完毕后driver还能汇集累加器的最终值。

# persist
- MEMORY_ONLY
- MEMORY_ONLY_SER：先序列化再存入内存，而不是直接将Java对象存入内存。相当于用CPU换RAM；
- MEMORY_AND_DISK
- MEMORY_AND_DISK_SER
- DISK_ONLY
- MEMORY_ONLY_2, MEMORY_AND_DISK_2：存2份，防止一份丢了还要重算缓存。适用于土豪集群；
- OFF_HEAP




