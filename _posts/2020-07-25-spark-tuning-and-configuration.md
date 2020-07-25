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
`spark.memory.fraction`

`spark.memory.storageFraction`


