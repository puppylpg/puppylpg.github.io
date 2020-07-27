---
layout: post
title: "Spark Tuning & Configuration"
date: 2020-07-25 21:13:27 +0800
categories: spark
tags: spark
---

Spark调优主要是调整spark的配置和调整spark代码的执行逻辑，不过主要还是调配置，所以这里将配置和调优放在一起。当然由于spark过于庞大（hadoop、kafka也都这样）一次性梳理配置是很让人懵逼的一件事，况且一开始显然也不能理解spark的所有配置。根据平时的需求，将需要用到的学到的配置总结在这里，长期更新。

1. Table of Contents, ordered
{:toc}

# partition
`spark.sql.shuffle.partitions`：spark SQL shuffle后的分区数，仅对spark SQL有效（DataFrame）。默认200。

`spark.default.parallelism`：仅处理RDD时生效，RDD转换（shuffle、parallelize）之后的分区数。默认在不同情况下取值条件不同，对于shuffle（reduceByKey、join）操作，是shuffle前的父RDD的最大partition值。

所以RDD shuffle之后，partition只多不少呗。如果导致partition过多、task过多，建议设个更小的值。官方建议2-3倍的cpu cores。

- https://spark.apache.org/docs/latest/tuning.html#level-of-parallelism
- https://www.cnblogs.com/wrencai/p/4231966.html
- https://www.cnblogs.com/itboys/p/10960614.html
- https://stackoverflow.com/questions/45704156/what-is-the-difference-between-spark-sql-shuffle-partitions-and-spark-default-pa

另外，由于一个partition一个task，如果cores大于partitions，会有很多cores闲置下来。
- https://stackoverflow.com/a/52414244/7676237

# memory
Java对象在内存中占得空间大概是raw data field内容的2-5倍，因为：
- object header：16 bytes左右，包含指向对象的class的指针；
- String在jvm里使用UTF-16编码，所以一个char就是2 byte；
- 指针，比如对象里对其他对象的引用，一个指针8byte。像HashMap、LinkedList等有很多指针；
- primitive类型经常被存储为boxed类型，比如Integer；

spark的memory用于两处：执行代码、存储（cache）。二者共享一块内存区域。

spark的内存首先分为两部分：Execution + Storage，默认占60%（`spark.memory.fraction`=0.6），剩下的用于user data structure、internal metadata in spark等等。

Storage默认占用该区域的一半（`spark.memory.storageFraction`=0.5），且如果Execution不需要那么多内存，Storage最多能全占了。当Execution需要内存的时候，可以evict Storage，但Storage不能低于0.5。所以Storage站0.5-1.0，Execution最多占0.5。

`spark.memory.fraction`

`spark.memory.storageFraction`

如果cache rdd需要的内存过大，但又不想放在磁盘上，建议使用`MEMORY_ONLY_SER`，使用Kryo序列化，体积会比Java序列化小很多，速度也快很多。

- http://spark.apache.org/docs/latest/tuning.html

# scheduling

## data locality
当数据和处理数据的代码不在同一个node上，要么将data发到code所在的node，要么将code发到data所在的node。由于spark从hdfs读的都是大数据，所以将代码发到数据所在的节点更好一些。

按照数据的本地化级别，分为五类：
- PROCESS_LOCAL：数据和task在同一个进程（同一个jvm）中。比如数据已经cache在了该node中；
- NODE_LOCAL：数据就在启动task的node上。**可以是在该node的磁盘上，也可以是cache在该node的另一个process中**；
- NO_PREF：数据从哪里访问都一样，不需要位置优先。**比如数据库的数据**；
- RACK_LOCAL：数据和启动task的node在同一机架上；
- ANY：不在同一机架上；

spark默认用满足最高级别的data locality的node去启动task，但是如果有需要处理的数据的executor都在忙，此时没法直接在该executor上启动task。spark会等一下这个executor，如果还不空闲，再使用次级data locality在其他executor上启动task。

`spark.locality.wait`：启动一个数据本地化的任务时，在退而求其次，在一个不那么本地的节点上启动任务之前，所等待的时间。默认是3s。

spark启动任务时会先按照最高级别数据本地化分配node，以求获得最高的数据读取速度，如果等待`spark.locality.wait`还没有等到可用的node，降为下一级别请求node发起任务，分别用`spark.locality.wait.process`、`spark.locality.wait.node`、`spark.locality.wait.rack`作为超时时间，他们默认都是`spark.locality.wait`。

存在的问题：如果一个executor执行了远多于其他executor的任务，该executor的task的Locality Level都是PROCESS_LOCAL级别，且其他executor闲置、该executor的结束时间影响了整体的时间，说明`spark.locality.wait`设置的不太合理（是不是手动调大了），过于强调数据本地化，导致task分布不均。这时候可以调小`spark.locality.wait`（甚至为0）。
- https://stackoverflow.com/a/27019275/7676237


