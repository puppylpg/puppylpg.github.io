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

## load
```
sparkSession.read.format("xxx").load(path)
```
spark load file的时候必须指定类型，比如全限定名`org.apache.spark.sql.parquet`，但是对于内置的格式，使用简写也可以，比如json/parquest/csv/text/avro等。

load之前还能指定一些option选项，比如：
```
spark.read.format("csv")
    .option("header", "true")
    .option("seq", ";")
    .load(path)
```
告诉spark读的时候有header，分隔符不是逗号而是分号。

所有的csv的option可参考：
- https://docs.databricks.com/data/data-sources/read-avro.html

spark的源代码中也可以窥见对这些option的使用：
- https://github.com/apache/spark/blob/v2.1.0/sql/core/src/main/scala/org/apache/spark/sql/execution/datasources/csv/CSVOptions.scala#L74

所有的datasource文档见：
- https://docs.databricks.com/data/data-sources/index.html

读的时候支持filter和递归读取模式
```
val testGlobFilterDF = spark.read.format("parquet")
  .option("recursiveFileLookup", "true")
  .option("pathGlobFilter", "*.parquet") // json file should be filtered out
  .load("examples/src/main/resources/dir1")
```

## save
```
dataset.write.format("xxx").save(path)
```

一般存储的时候会指定模式，可以用Enum类也可以直接用plain text：
- SaveMode.Overwrite/"overwrite"：文件已存在则覆盖，一般用这个；
- SaveMode.Append/"append"
- SaveMode.ErrorIfExists/"error"/"errorifexists"：**默认情况**，如果文件已存在，报错；
- SaveMode.Ignore/"ignore"：如果文件已存在，忽略。既不overwrite也不error。

# DataFrameWriter: partitionBy/bucketBy/sortBy
都是DataFrameWriter里的方法。

```
val df = Seq((2012, 8, "Batman", 9.8),
    (2012, 8, "Hero", 8.7),
    (2012, 7, "Robot", 5.5),
    (2011, 7, "Git", 2.0))
    .toDF("year", "month", "title", "rating")

df.write.mode("overwrite").partitionBy("year", "month").format("avro").save("/tmp/test_dataset")
```
文件会以如下形式存放：
```
dbfs:/tmp/test_dataset/year=2011/
dbfs:/tmp/test_dataset/year=2012/
```
读的时候**指定到根目录就行了**：
```
val data = spark.read.format("avro").load("/tmp/test_dataset")
```
这样存放和直接存Dataset，在读取后没啥区别，不过看起来在hdfs上更“条理化”了。

# 时间（格式）转换
- https://spark.apache.org/docs/latest/sql-ref-datetime-pattern.html
- https://spark.apache.org/docs/latest/sql-ref-functions-builtin.html#date-and-timestamp-functions

# UDF
- https://docs.databricks.com/spark/latest/spark-sql/udf-scala.html
- https://spark.apache.org/docs/latest/api/scala/org/apache/spark/sql/functions$.html#udf[RT](f:()=%3ERT)(implicitevidence$3:reflect.runtime.universe.TypeTag[RT]):org.apache.spark.sql.expressions.UserDefinedFunction
- https://spark.apache.org/docs/latest/api/scala/org/apache/spark/sql/expressions/UserDefinedFunction.html

**应用于DataFrame的column的函数（column-based function）**，除了spark定义的那些以外，用户还能根据自己的需求自定义一些操作DataFrame的函数。

定义一个udf很简单：
1. 定义一个普通函数；
2. 使用udf()包装一下这个函数；

这个udf就能应用于Column了。

注意udf不支持可变参数，即普通函数的参数个数不能是无限个。在spark里内置了零参数udf一直到10参数udf。这种定义方式有点儿暴力啊……

```
import org.apache.spark.sql.functions.{col, udf}
val squared = udf((s: Long) => s * s)
display(spark.range(1, 20).select(squared(col("id")) as "id_squared"))
```


