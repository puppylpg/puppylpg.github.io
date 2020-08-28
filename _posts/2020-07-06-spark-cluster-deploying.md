---
layout: post
title: "Spark Cluster & Deploying"
date: 2020-07-06 16:31:30 +0800
categories: spark cluster deploy
tags: spark cluster deploy
---

关于spark跑任务使用的集群以及任务的提交方式。

1. Table of Contents, ordered
{:toc}

# 组件
spark提交任务流程：
1. SparkContext连上cluster manager（集群模式的yarn、standalone模式的spark自己的cluster manager）；
2. 索取executor（用于跑任务，存数据）；
3. 发送application code（JAR）给executor；
4. 发送task给executor；

- job：spark action（save、collect等）所产生的并行计算任务，包含多个task；
- stage：比job更小的task集合，互相依赖，类似于MapReduce的map和reduce stage；
- task：发送给executor的任务单元；

# 任务提交 - spark-submit
使用的是spark-submit脚本。一般是将自己的程序打成一个胖包（uber jar），maven就是用assembly或者shade插件。

## 提交参数
```
./bin/spark-submit \
  --class <main-class> \
  --master <master-url> \
  --deploy-mode <deploy-mode> \
  --conf <key>=<value> \
  --verbose \
  ... # other options
  <application-jar> \
  [application-arguments]
```
**主类、集群、部署方式、配置；jar、主类参数。**

### `--master`
- 本地模式
    + local：单线程；
    + local[N]：N线程；
    + local[*]：核数相同的线程；
- standalone独立模式（**本地集群**）：
    + spark://HOST:PORT：spark://localhost:7077；
    + spark://HOST1:PORT1,HOST2:PORT2：带standby master的集群；
- 其他真正的集群：
    + `--master yarn`：yarn集群，值是`yarn`，至于地址无需多言，直接根据`HADOOP_CONF_DIR`或者`YARN_CONF_DIR`去找；
    + `--master mesos://HOST:PORT`
    + `--master K8S://HOST:PORT`

> 当集群用yarn的时候，只需填`yarn`就行，无需指定yarn的地址，因为spark要用hdfs，需要Hadoop的配置。Hadoop的配置自然有yarn的配置。

### `--deploy-mode`
部署方式：driver在cluster上启动，还是在提交任务的机器上启动，因为看起来是作为cluster的一个client存在的，所以是client模式。默认是client mode。

- client mode：
    + 优点：程序的输入输出都会和console相关。所以尤其适合REPL，比如spark-shell；
    + 缺点：如果启动服务的机器和集群不在同一个局域网，driver和executor之间的网络开销就会很大；
- cluster mode：
    + 优点：减小driver和executor之间的网络开销；
    + 缺点：各个executor的输出看不到了；

## 配置优先级
1. 程序里`SparkConf`的配置；
2. spark-submit指定的参数；
3. 默认参数：`conf/spark-defaults.conf`；

比如：
```
spark.master            spark://5.6.7.8:7077
spark.executor.memory   4g
spark.eventLog.enabled  true
spark.serializer        org.apache.spark.serializer.KryoSerializer
```

**spark-submit指定`--verbose`可看出配置到底来自哪里。**

spark-submit的`--conf, -c PROP=VALUE`是一种比较特殊的配置，可以指定任意的spark configuration，这些configuration可能太过常用，直接挑出来单独搞个配置项了，比如：
```
    --conf spark.driver.extraJavaOptions="-Djava.io.tmpdir=/disk1/liuhaibo/tmp" \
    --driver-java-options '-Djava.io.tmpdir=/disk1/liuhaibo/tmp' \
```
效果是一样的。

可以使用`spark-submit.sh --help`来查看：
```
  --conf, -c PROP=VALUE       Arbitrary Spark configuration property.
  
  --driver-java-options       Extra Java options to pass to the driver.
```

## 依赖
### `--jars`：说实话没必要
指定jar包，逗号分隔。jar包会被发送到cluster。
- `file:`：driver的绝对路径；
- `hdfs:`/`http:`/`ftp:`：jar的路径，大家都去下载；
- `local:`：从每个executor的本地加载。**打jar包用这个省时间**；

### `--packages` & `--repositories`：正确姿势
也都是逗号分隔，这些依赖（指定maven坐标）都会从maven repo里下载。



# cluster manager类型
- standalone：spark自带的简单cluster manager；
- yarn：Hadoop2提供的resourse manager；
- mesos：Apache提供的；
- 其他：Kubernetes，或者第三方的Nomad等；

> **注意是cluster manager，所以他们都是运行在集群上的。** 本地模式是不运行在集群上的。standalone模式是运行在集群上的。

## standalone
standalone模式是spark额外提供的一个简单的部署方式，用于在集群上跑spark。而不是跑在现成的yarn或者Mesos上。

**所以standalone也是一个基于集群的cluster manager，而不是本地模式。**

### 启动
使用spark提供的`sbin`下的脚本启动。比如启动一个master，就可以在http://localhost:8080查看spark集群信息。比如
```
Spark Master at spark://DESKTOP-T467619.localdomain:7077

URL: spark://DESKTOP-T467619.localdomain:7077
Alive Workers: 0
Cores in use: 0 Total, 0 Used
Memory in use: 0.0 B Total, 0.0 B Used
Applications: 0 Running, 0 Completed
Drivers: 0 Running, 0 Completed
Status: ALIVE
```
> 这是spark的cluster manager，有自己的管理界面，而不是Hadoop的那个yarn的管理界面。

## yarn

> Unlike other cluster managers supported by Spark in which the master’s address is specified in the --master parameter, in YARN mode the ResourceManager’s address is picked up from the Hadoop configuration. Thus, the --master parameter is yarn.

