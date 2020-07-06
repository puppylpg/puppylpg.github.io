---
layout: post
title: "Spark MISC"
date: 2020-07-06 16:35:30 +0800
categories: spark
tags: spark
---

在能独立成章之前，把一些其他关于spark需要记录的东西先写在这里。

1. Table of Contents, ordered
{:toc}

# SparkContext vs. SparkSession
## SparkContext - RDD
SparkContext用于spark2之前，用于读一些非结构化数据，构造出RDD，比如sequenceFile方法。

SparkContext通过SparkConf来构建，比如：
```
val conf = new SparkConf().setAppName(“RetailDataAnalysis”).setMaster(“spark://master:7077”).set(“spark.executor.memory”, “2g”)

creation of sparkContext:
val sc = new SparkContext(conf)
```

## SparkSession - Dataset
SparkSession在spark2引入，用于读一些结构化数据，构造出Dataset。SparkSession中保存有SparkContext变量sparkContext。
```
Creating Spark session:
val spark = SparkSession
.builder
.appName(“WorldBankIndex”)
.getOrCreate()

Configuring properties:
spark.conf.set(“spark.sql.shuffle.partitions”, 6)
spark.conf.set(“spark.executor.memory”, “2g”)
```

Ref：
- https://data-flair.training/forums/topic/sparksession-vs-sparkcontext-in-apache-spark/

# spark-shell
使用spark-shell本地验证程序的正确性似乎是个不错的方案。

- `--master "local[4]"`
- `--packages com.databricks:spark-avro_2.11:4.0.0,mysql:mysql-connector-java:5.1.42`
- `--repositories http://nexus.corp.youdao.com/nexus/content/groups/public/`

## 本地读文件
```
scala> val file = sc.textFile("~/order_detail_json")
file: org.apache.spark.rdd.RDD[String] = ~/order_detail_json MapPartitionsRDD[7] at textFile at <console>:24

scala> file.foreach(println(_))
org.apache.hadoop.mapred.InvalidInputException: Input path does not exist: file:/home/pichu/Utils/spark/spark-2.3.0-bin-hadoop2.7/~/order_detail_json
  at org.apache.hadoop.mapred.FileInputFormat.singleThreadedListStatus(FileInputFormat.java:287)
  at org.apache.hadoop.mapred.FileInputFormat.listStatus(FileInputFormat.java:229)
  at org.apache.hadoop.mapred.FileInputFormat.getSplits(FileInputFormat.java:315)
  at org.apache.spark.rdd.HadoopRDD.getPartitions(HadoopRDD.scala:200)
  at org.apache.spark.rdd.RDD$$anonfun$partitions$2.apply(RDD.scala:253)
  at org.apache.spark.rdd.RDD$$anonfun$partitions$2.apply(RDD.scala:251)
  at scala.Option.getOrElse(Option.scala:121)
  at org.apache.spark.rdd.RDD.partitions(RDD.scala:251)
  at org.apache.spark.rdd.MapPartitionsRDD.getPartitions(MapPartitionsRDD.scala:35)
  at org.apache.spark.rdd.RDD$$anonfun$partitions$2.apply(RDD.scala:253)
  at org.apache.spark.rdd.RDD$$anonfun$partitions$2.apply(RDD.scala:251)
  at scala.Option.getOrElse(Option.scala:121)
  at org.apache.spark.rdd.RDD.partitions(RDD.scala:251)
  at org.apache.spark.SparkContext.runJob(SparkContext.scala:2092)
  at org.apache.spark.rdd.RDD$$anonfun$foreach$1.apply(RDD.scala:921)
  at org.apache.spark.rdd.RDD$$anonfun$foreach$1.apply(RDD.scala:919)
  at org.apache.spark.rdd.RDDOperationScope$.withScope(RDDOperationScope.scala:151)
  at org.apache.spark.rdd.RDDOperationScope$.withScope(RDDOperationScope.scala:112)
  at org.apache.spark.rdd.RDD.withScope(RDD.scala:363)
  at org.apache.spark.rdd.RDD.foreach(RDD.scala:919)
  ... 49 elided
```
如果使用相对路径，**相对的是当前working directory**。

## 本地读avro（读为Dataset）
```
scala> val avroRdd = spark.read.format("com.databricks.spark.avro").load("/home/pichu/data/tmp/*.avro")
org.apache.spark.sql.AnalysisException: Failed to find data source: com.databricks.spark.avro. Please find an Avro package at http://spark.apache.org/third-party-projects.html;
  at org.apache.spark.sql.execution.datasources.DataSource$.lookupDataSource(DataSource.scala:630)
  at org.apache.spark.sql.DataFrameReader.load(DataFrameReader.scala:190)
  at org.apache.spark.sql.DataFrameReader.load(DataFrameReader.scala:174)
  ... 49 elided
```
使用avro需要加额外依赖：
```
bin/spark-shell --master "local[4]" --packages com.databricks:spark-avro_2.11:4.0.0,mysql:mysql-connector-java:5.1.42 --repositories http://nexus.corp.youdao.com/nexus/content/groups/public/
```
启动的时候会去central里找依赖，但是貌似是用ivy resolve的依赖……
```
scala> val avrodf = spark.read.format("com.databricks.spark.avro").load("/home/pichu/data/tmp/*.avro")
avrodf: org.apache.spark.sql.DataFrame = [guid: string, abtest: string ... 50 more fields]
```

# Configuration
spark如果要读hdfs，一定要有：
- hdfs-site.xml：hdfs的配置，client需要用，比如namenode、datanode的位置，replicas=3等；
- core-site.xml：hdfs的name。比如fs.defaultFs；

如果spark运行在yarn上，一定要有：
- yarn-site.xml

spark默认配置地址conf/spark-env.sh

可以设置SPARK_CONF_DIR修改默认配置地址。

spark的配置里可以设置HADOOP_CONF_DIR。相当于给spark指定了上述配置文件。

# 测试

- MRUnit;
- hadoop-minicluster;

