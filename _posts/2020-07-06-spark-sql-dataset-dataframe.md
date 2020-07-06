---
layout: post
title: "Spark SQL(Dataset DataFrame)"
date: 2020-07-06 16:27:30 +0800
categories: spark Dataset DataFrame
tags: spark Dataset DataFrame
---

Spark SQL is a Spark module for structured data processing. Unlike the basic Spark RDD API, the interfaces provided by Spark SQL provide Spark with more information about the structure of both the data and the computation being performed. Internally, Spark SQL uses this extra information to perform extra optimizations. 

和RDD相比，上面的描述反映了一些关键信息：结构化数据处理、api提供了数据的结构信息、使用结构信息做出的额外优化。

1. Table of Contents, ordered
{:toc}

# sql
sql查询原来是这么操作的：
```
// Register the DataFrame as a SQL temporary view
df.createOrReplaceTempView("people")

val sqlDF = spark.sql("SELECT * FROM people")
sqlDF.show()
// +----+-------+
// | age|   name|
// +----+-------+
// |null|Michael|
// |  30|   Andy|
// |  19| Justin|
// +----+-------+
```

TempView是session-scoped，session结束就消失。GlobalTempView是跨session的，spark应用结束才消失。

Global temporary view is tied to a system preserved database `global_temp`, and we must use the qualified name to refer it, e.g. `SELECT * FROM global_temp.view1`.
```
// Register the DataFrame as a global temporary view
df.createGlobalTempView("people")

// Global temporary view is tied to a system preserved database `global_temp`
spark.sql("SELECT * FROM global_temp.people").show()
// +----+-------+
// | age|   name|
// +----+-------+
// |null|Michael|
// |  30|   Andy|
// |  19| Justin|
// +----+-------+

// Global temporary view is cross-session
spark.newSession().sql("SELECT * FROM global_temp.people").show()
// +----+-------+
// | age|   name|
// +----+-------+
// |null|Michael|
// |  30|   Andy|
// |  19| Justin|
// +----+-------+
```

# Dataset
Datasets are similar to RDDs, however, **instead of using Java serialization or Kryo they use a specialized Encoder to serialize the objects for processing or transmitting over the network**. While both encoders and standard serialization are responsible for turning an object into bytes, **encoders are code generated dynamically and use a format that allows Spark to perform many operations like filtering, sorting and hashing without deserializing the bytes back into an object**.

所以说Encoder和standard serialization相比，可以做到额外的优化：在不反序列化的情况下进行数据过滤、排序、hash。

> 这一点像Hadoop中额外提供的`RowComparator<T> extends Comparator<T>`接口，它新增的compare接口需要实现一种直接进行序列化后的字节比较的方式，从而做到在不反序列化的情况下比较对象。方法需要指定序列化后的字节数组、开始比较的字节位置、需要比较的字节长度三个参数。

```
case class Person(name: String, age: Long)

// Encoders are created for case classes
val caseClassDS = Seq(Person("Andy", 32)).toDS()
caseClassDS.show()
// +----+---+
// |name|age|
// +----+---+
// |Andy| 32|
// +----+---+

// Encoders for most common types are automatically provided by importing spark.implicits._
val primitiveDS = Seq(1, 2, 3).toDS()
primitiveDS.map(_ + 1).collect() // Returns: Array(2, 3, 4)

// DataFrames can be converted to a Dataset by providing a class. Mapping will be done by name
val path = "examples/src/main/resources/people.json"
val peopleDS = spark.read.json(path).as[Person]
peopleDS.show()
// +----+-------+
// | age|   name|
// +----+-------+
// |null|Michael|
// |  30|   Andy|
// |  19| Justin|
// +----+-------+
```

Seq有toDS方法，又是通过implicits来搞的，肯定也是DatasetHolder里的toDS。

这么看来，除了基本类型有Encoder之外，case class也会自动创建Encoder。这个自动生成的Encoder甚至还能做到在不反序列化的情况下完成过滤、排序、哈希等操作。

突然想起来Hadoop的那个什么方法来着，可以做到这一点。

# Interoperating with RDDS
rdd想转df，map之类的都得自定义一个Encoder！！！

- https://spark.apache.org/docs/latest/sql-getting-started.html#interoperating-with-rdds

## Inferring the Schema Using Reflection
The Scala interface for Spark SQL supports automatically converting an RDD containing case classes to a DataFrame.

看到没看到没

The case class defines the schema of the table. The names of the arguments to the case class are read using reflection and become the names of the columns.

## Programmatically Specifying the Schema
没有case class时，recores的类型就是string，也没有schema信息：
1. 创建RDD[Row]；
2. 创建schema：StructType；
3. 应用schema，将rdd创建为一个DataFrame；

Row可以直接`Row(attributes(0), attributes(1).trim)`这样创建对象。

RDD[String]转RDD[Row]的时候和RDD[String]转RDD[T]（T是一个case class）其实是一样的。不同的是case class能使用反射自动获取属性名创建schema，Row得自己配上schema。

# IO
- https://spark.apache.org/docs/latest/sql-data-sources.html


