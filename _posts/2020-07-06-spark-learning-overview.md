---
layout: post
title: "Spark Learning Overview"
date: 2020-07-06 14:17:30 +0800
categories: spark
tags: spark
---

Spark学习可以看一些书获取一些基本知识。不过spark官网已经提供了足量的涵盖各个方面的学习资料，更重要的是这些内容都非常新，这一点是书本没法比的。大致汇总、概述一下官网上要看的资料，方便学习：

1. Table of Contents, ordered
{:toc}

# 官网
## docs下的链接
- overview：也是其他各类文档的汇集处
    + [x] overview：https://spark.apache.org/docs/latest/index.html，
- programming guides：主要就三篇和spark、rdd、spark sql、DataFrame、Dataset相关的
    + [x] quick start：https://spark.apache.org/docs/latest/quick-start.html
    + [x] rdd：https://spark.apache.org/docs/latest/rdd-programming-guide.html
    + [x] spark SQL + DataFrame + Dataset：https://spark.apache.org/docs/latest/sql-programming-guide.html
    + spark streaming，kafka通过spark streaming落地到hdfs等，需要的时候可以看：https://spark.apache.org/docs/latest/streaming-programming-guide.html  
- api：主要是scala的，pyspark用的不多
    + scala：http://spark.apache.org/docs/latest/api/scala/org/apache/spark/index.html
    + pyspark：https://spark.apache.org/docs/latest/api/python/pyspark.html
- Deploying：任务提交、spark运行模式等。这个下面的文章都挺重要的，基本都要看。给个入口，其他的不一一列举了
    + [x] cluster：https://spark.apache.org/docs/latest/cluster-overview.html
    + [x] submitting applications: http://spark.apache.org/docs/latest/submitting-applications.html
    + [x] standalone mode: http://spark.apache.org/docs/latest/spark-standalone.html
    + [x] yarn: http://spark.apache.org/docs/latest/running-on-yarn.html
- More：拓展阅读，关于spark的配置、调优、监控、安全等，也都应该看一下。同样只给个入口
    + [x] spark configuration：https://spark.apache.org/docs/latest/configuration.html

## 非docs下的有用链接
- example：https://spark.apache.org/examples.html
- 有用的开发工具等：https://spark.apache.org/developer-tools.html

# spark的论文、分享：
- spark架构分享：https://www.slideshare.net/AGrishchenko/apache-spark-architecture
- MapReduce和Spark分享：https://cs.stanford.edu/~matei/courses/2015/6.S897/slides/mr-and-spark.pdf
- rdd论文：https://cs.stanford.edu/~matei/papers/2012/nsdi_spark.pdf

# 其他
- 一套看起来貌似还可以的spark教程：https://data-flair.training/blogs/spark-tutorial/

# 总结
spark的学习主要分以下几部分：
- spark SQL，即RDD/DataFrame/Dataset的操作：
    + groupBy，聚合等，主要结合api学习；
    + RDD/DataFrame/Dataset之间的转换；
    + spark的IO，读写各种格式的文件：`input file -> SparkSession -> (DataFrameReader) -> DataFrame -> (DataFrameWriter) -> output file`；
- spark任务的部署：
    + 使用的cluster，cluster manager，主要是yarn；
    + 任务提交spark-submit的一些参数；
- 关于spark的配置、安全认证等，深入了解之后才能进行spark调优；

这应该是第二次比较多的接触spark。上次接触应该是一年多之前，就像新接触一个复杂的东西一样，有点儿忙乱，总感觉没深入进去，也对整体没有把握，一种“这不是我要/能用到的技术”的感觉。最近一个月才算是真正地了解了spark，包括系统学习spark等。当然也只能算是应用层次的深入。spark的确复杂，之后应该就可以逐渐深入了解其内部原理了。期待！

