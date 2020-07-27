---
layout: post
title: "RDD vs. Dataset vs. DataFrame"
date: 2020-07-06 15:33:27 +0800
categories: spark
tags: spark
---

主要介绍RDD、Dataset/DataFrame三者之间的转换，和一些使用上的差异。

1. Table of Contents, ordered
{:toc}

# basic
## RDD[T]
出现的早，一般用于**非结构化的数据**。比如通过SparkContext的sequenceFile方法读取一个sequenceFile，或者parallelize通过一个Seq构建rdd。

**rdd没有schema，没有结构。一般rdd转成有结构的DataFrame后只有一列column，名为`value`。**

## DataFrame
适用于**结构化的数据**。比如通过SparkSession的read获得DataFrameReader，再用csv、json、parquet等方法读取相应的数据文件。或者使用format指定一个类型，再load文件，比如读取avro：
```scala
spark.read.format("com.databricks.spark.avro").load("xxx")
```
很显然，不管怎么搞，读的都是格式化的数据。要么自带schema（csv、json、avro），要么指定schema（通过一个schema方法`schema(schemaString: String)`，但目前还不太用到）。

另外，DataFrameReader还提供了一个text方法`text(paths: String*)`，返回DataFrame，它的schema以value为column前缀，拼上column名称。但是一般也是就一个value，比如读一个普通纯文本文件：
```
scala> spark.read.text("licenses/LICENSE-protobuf.txt")
res1: org.apache.spark.sql.DataFrame = [value: string]

scala> val df = spark.read.text("licenses/LICENSE-protobuf.txt")
df: org.apache.spark.sql.DataFrame = [value: string]

scala> df.printSchema
root
 |-- value: string (nullable = true)

scala> df.schema
res7: org.apache.spark.sql.types.StructType = StructType(StructField(value,StringType,true))

scala> df.show(3, false)
+---------------------------------------------------------------------------+
|value                                                                      |
+---------------------------------------------------------------------------+
|This license applies to all parts of Protocol Buffers except the following:|
|                                                                           |
|  - Atomicops support for generic gcc, located in                          |
+---------------------------------------------------------------------------+
only showing top 3 rows
```
**普通RDD转成的DataFrame也就这样。**

## DataSet[T]
同DataFrame基本一样，API都合并了。Dataset是所含内容为T的数据集，**一般和case class一起用，T就是class的类型。** 获取数据后可以直接用`T.xxx`获取其某个字段的内容。

## DataFrame vs. Dataset
DataFrame虽然是结构化的，但是其所含的值并没有对应一个class，所以spark就定义了一个class名为Row，作为DataFrame的数据的数据结构。**所以DataFrame等价于Dataset[Row]。**

**但是Row又没有定义field，具体包含哪些字段，没法直接取出来，所以只能通过Row的各种方法比如`getAs[Int](xxx)`来获取属性xxx的内容。而Dataset在自定义了case class之后可以很自由的获得每一行的信息。所以DataFrame在获取内部数据的时候，方法数据的属性没有Dataset方便。**

> DataFrame是Dataset这个泛型的一种具象化：T为Row。**类似于`List<String>`和`List<T>`的区别。**

## DataFrame取值
DataFrame获取字段示例：
```
scala> df.show
+----+-------+
| age|   name|
+----+-------+
|null|Michael|
|  30|   Andy|
|  19| Justin|
+----+-------+

scala> df.foreach(line => println(line.getAs[String]("name")))
Michael
Andy
Justin

scala> df.foreach(line => println(line.getAs[String]("age")))
null
30
19

scala> df.foreach(line => println(line.getAs[Int]("age")))
null
30
19

scala> df.foreach(line => println(line.getAs[Int]("name")))
Michael
Andy
Justin
```

- 取列：`$(xxx)`、`col(xxx)`、`your_df(xxx)`
- 取行的某一个字段：`getAs[T](xxx)`

# 相互转换
## Dataset -> DataFrame: `toDF`
这个很简单，因为只是把case class封装成Row，相当于抹掉class的属性了：
```scala
import spark.implicits._

val dataFrame = dataset.toDF
```

> toDF(): DataFrame
>
> Converts this strongly typed collection of data to generic Dataframe. In contrast to the strongly typed objects that Dataset operations work on, a Dataframe returns generic Row objects that allow fields to be accessed by ordinal or name.

## DataFrame -> Dataset: `as[T]`
```
import spark.implicits._

// 定义类的字段名和类型
case class Person(age : Int, name : String) extends Serializable
val ds = df.as[Person]
```
这就要定义一个case class，为每一列对应一个具体类型的属性。然后使用as方法（`org.apache.spark.sql.Encoder`里的）转换。

> as[U](implicit arg0: Encoder[U]): Dataset[U]
>
> Returns a new Dataset where each record has been mapped on to the specified type. The method used to map columns depend on the type of U:
>
> - When U is a class, fields for the class will be mapped to columns of the same name (case sensitivity is determined by spark.sql.caseSensitive).
> - When U is a tuple, the columns will be mapped by ordinal (i.e. the first column will be assigned to _1).
> - When U is a primitive type (i.e. String, Int, etc), then the first column of the DataFrame will be used.

一定要导入spark对象（SparkSession实例）的implicits里的隐式转换：`import spark.implicits._`，因为用了里面的Encoder来进行对象的转换操作。

## RDD -> DataFrame
**DataFrame转为RDD后的类型是`org.apache.spark.rdd.RDD[org.apache.spark.sql.Row]`。但有趣的地方在于，想把该类型再转为DataFrame是不行的：`error: value toDF is not a member of org.apache.spark.rdd.RDD[org.apache.spark.sql.Row]`**

RDD转DataFrame，**必须要有schema**。可通过两种方式搞定schema，两种方法**说白了就是要么spark自己推断schema，要么程序员手动指定schema。**

### 方法一：使用反射推断schema
定义一个case class：
> The case class defines the schema of the table. The names of the arguments to the case class are read using reflection and become the names of the columns.

- https://spark.apache.org/docs/latest/sql-getting-started.html#inferring-the-schema-using-reflection

步骤：
1. 一般读到的rdd是一个RDD[String]，要先转为RDD[T]，T是一个case class；
2. toDF；

```
// For implicit conversions from RDDs to DataFrames
import spark.implicits._

// Create an RDD of Person objects from a text file, convert it to a Dataframe
val peopleDF = spark.sparkContext
  .textFile("examples/src/main/resources/people.txt")
  .map(_.split(","))
  .map(attributes => Person(attributes(0), attributes(1).trim.toInt))
  .toDF()
```

一个自己的例子：
```
scala> case class DummyAvro(s: String)
defined class DummyAvro

scala> avrodf.rdd.map(x => DummyAvro(x.toString)).toDF.show(2, false)
+--------------------------+
|s                         |
+--------------------------+
```
**此时的column name是case class的属性。**

当然，把Row搞成基本类型，比如String（使用Row的toString方法）也是可以的：
```
scala> avrodf.rdd.map(x => x.toString).toDF.show(2, false)
+--------------------------+
|value                     |
+--------------------------+
```
此时df的column只有一个：value。

或者直接搞一个Tuple：
```
val whodf = whoami.map{
    map => (map.getOrElse("guid", ""), map.getOrElse("action", ""), map.getOrElse("unit", ""), map.getOrElse("type", ""), map.getOrElse("date", ""), map.getOrElse("keyfrom", ""))
}.toDF("guid", "action", "unit", "type", "date", "keyfrom")
```

另外，如果将一个df转为另一个df，后者也是需要Encoder的。比如这里给Dataset[Map[K, V]]定义了一个Encoder：
```
// No pre-defined encoders for Dataset[Map[K,V]], define explicitly
implicit val mapEncoder = org.apache.spark.sql.Encoders.kryo[Map[String, Any]]
// Primitive types and case classes can be also defined as
// implicit val stringIntMapEncoder: Encoder[Map[String, Any]] = ExpressionEncoder()

// row.getValuesMap[T] retrieves multiple columns at once into a Map[String, T]
teenagersDF.map(teenager => teenager.getValuesMap[Any](List("name", "age"))).collect()
// Array(Map("name" -> "Justin", "age" -> 19))
```
Dataset对map的定义：
```
def map[U](func: MapFunction[T, U], encoder: Encoder[U]): Dataset[U]
(Java-specific) Returns a new Dataset that contains the result of applying func to each element.

def map[U](func: (T) ⇒ U)(implicit arg0: Encoder[U]): Dataset[U]
(Scala-specific) Returns a new Dataset that contains the result of applying func to each element.
```
**Encoder是必须的，只不过是显式还是implicit调用的问题。**

另外Row的getValuesMap方法定义如下：
```
def getValuesMap[T](fieldNames: Seq[String]): Map[String, T]
Returns a Map consisting of names and values for the requested fieldNames For primitive types if value is null it returns 'zero value' specific for primitive ie. 0 for Int - use isNullAt to ensure that value is not null
```

### 方法二：指定一个自定义的schema
1. 一般读到的rdd是一个RDD[String]，要先转为RDD[Row]；
2. 创建一个匹配Row结构的（StructType的）schema；
3. 转换的时候指定该schema。

```
import org.apache.spark.sql.Row

import org.apache.spark.sql.types._

// RDD
val peopleRDD = spark.sparkContext.textFile("examples/src/main/resources/people.txt")

// The schema is encoded in a string
val schemaString = "name age"

// Generate the schema based on the string of schema
val fields = schemaString.split(" ")
  .map(fieldName => StructField(fieldName, StringType, nullable = true))
// 创建schema
val schema = StructType(fields)

// RDD[String]转换为RDD[Row]：Convert records of the RDD (people) to Rows
val rowRDD = peopleRDD
  .map(_.split(","))
  .map(attributes => Row(attributes(0), attributes(1).trim))

// 应用schema，RDD[ROW]转为DF
val peopleDF = spark.createDataFrame(rowRDD, schema)
```

- https://spark.apache.org/docs/latest/sql-getting-started.html#programmatically-specifying-the-schema

### 方法总结
结合以上两种转换方法，可总结如下：
- RDD[String]转RDD[T]或RDD[Row]；
- 如果是case class RDD，直接toDF就好了，会自动推断schema。如果是RDD[Row]，Row又不是基本类型，使用`SparkSession#createDataFrame(RDD, StructType)`手动指定个schema；

**`DataFrame#schema`和它的`Row#schema`是同一个schema。**

#### 原因分析 TODO
因为对scala的implicit暂时还不是很了解，所以先盲猜一下：
1. RDD toDF实际是使用DatasetHolder的toDF。
2. DatasetHolder本身就hold一个Dataset。也就是说，RDD调用toDF之前其实已经可以转为Dataset了。
3. 使用的是SparkSession的implicits，它继承了SQLImplicits类：**A collection of implicit methods for converting common Scala objects into [[Dataset]]s.**。所以它就是将scala对象转为Dataset的！它里面有一堆Encoder，比如StringEncoder。rddToDatasetHolder方法使用相应的Encoder将RDD转为Dataset。

在这些Encode的接口`org.apache.spark.sql.Encoder`的doc中，有这样的描述：
```
 * == Scala ==
 * Encoders are generally created automatically through implicits from a `SparkSession`, or can be
 * explicitly created by calling static methods on [[Encoders]].
 *
 * 
 *   import spark.implicits._
 *
 *   val ds = Seq(1, 2, 3).toDS() // implicitly provided (spark.implicits.newIntEncoder)
 * 
```
Java不能用隐式转化，所以就很清晰：
```
 * == Java ==
 * Encoders are specified by calling static methods on [[Encoders]].
 *
 * 
 *   List<String> data = Arrays.asList("abc", "abc", "xyz");
 *   Dataset<String> ds = context.createDataset(data, Encoders.STRING());
 * 
```
当然，熟悉之后你也可以说比scala更麻烦……

## DataFrame -> RDD: `rdd`
直接调用rdd方法即可，返回`RDD[T]`。
```
scala> avrodf.rdd
res6: org.apache.spark.rdd.RDD[org.apache.spark.sql.Row] = MapPartitionsRDD[15] at rdd at <console>:26
```

> rdd: RDD[T]
>
> Represents the content of the Dataset as an RDD of T.

DataFrame转为RDD后的类型是`org.apache.spark.rdd.RDD[org.apache.spark.sql.Row]`。

DataFrame虽然转成了RDD，但是取出后的对象T还是Row类型，所以它依然有结构：
```
scala> avrodf.rdd.first.schema
res27: org.apache.spark.sql.types.StructType = StructType(StructField(guid,StringType,true), StructField(abtest,StringType,true), StructField(advertising,StringType,true), StructField(alg_id,LongType,true), StructField(apps,ArrayType(StringType,true),true), StructField(course_category_id,StringType,true), StructField(course_sub_category_ids,StringType,true), StructField(date,StringType,true), StructField(dict_role,StringType,true), StructField(dict_state,StringType,true), StructField(dict_state_pred,StringType,true), StructField(dict_tags,ArrayType(StringType,true),true), StructField(end,StringType,true), StructField(flTag,StringType,true), StructField(image,StringType,true), StructField(imei,StringType,true), StructField(infoid,StringType,true), StructField(ip,StringType,true), StructF...
```
依然可以用`getAs[T](xx)`取字段。

也就是说**RDD也可以存储结构化数据**！甚至存有case class的对象也可以。如果把数据取出来，就是case class对应的对象了。**使用RDD存储结构化数据不方便的地方大概是RDD中没有Dataset中的select、show等可以直接操作结构化对象的方法，因为它没有为结构化数据设计这些方法。**

# RDD和Dataset/DataFrame在一些方法上的区别
RDD除了不具备select等结构化数据DataFrame才有的方法，其他一些名称相同的方法其实也是有差异的。

比如groupByKey：
- rdd中，groupByKey操作的是类型为Tuple2的PairRDD，没有参数，直接将同key的value聚合起来，返回`RDD[(K, Iterable[V])]`；
- Dataset中，数据都是表，一列一列的，而非Tuple2。`groupByKey[K](func: (T) ⇒ K)(implicit arg0: Encoder[K]): KeyValueGroupedDataset[K, T]`，方法传入一个map函数，根据Dataset的数据类型T产生一个K类型的key（**自造一个key**），然后返回一个K,T pair的Dataset。这个Dataset的类型是`KeyValueGroupedDataset[K, T]`。**接下来才可以对它做一些按key操作的行为（而PairRDD一开始就可以根据key作出group by的行为），但是鉴于这个grouped dataset已经是按照key group过的，所以不再有类似groupByKey的操作**，有一些其他的比如`mapGroups[U](f: (K, Iterator[V]) ⇒ U)(implicit arg0: Encoder[U]): Dataset[U]`，将(K, Iterator V)映射为U。。

一个例子：
```
my_df.groupByKey(x => x.getAs[String]("pv_device_id"))
    .mapGroups(
        (k, iter) => (k, iter.map(x => x.getAs[String]("package_name")).toSeq.toSet.toSeq)
    )
    .toDF("deviceId", "packageNames")
    .sort(size($"packageNames").desc)
    .show(1000, false)
```
- 先自造一个key：pv_device_id；
- 再将pv_device_id和T的pair映射为pv_device_id和package_name的pair。

# Ref
- databricks的文章：https://databricks.com/blog/2016/07/14/a-tale-of-three-apache-spark-apis-rdds-dataframes-and-datasets.html
- 中文翻译版：https://zhuanlan.zhihu.com/p/35440915
- spark SQL的介绍：https://spark.apache.org/docs/latest/sql-getting-started.html#interoperating-with-rdds

总体来说，**从RDD到DataFrame到Dataset，数据越来越结构化，类型越来越强**。强类型需要严格的语法，同时会带来非常大的好处：编译时错误检查。

举例而言：
- RDD基本不存在操作列的方法，这是结构化的数据抽象DataFrame/Dataset才有的。RDD通过map去操作value，具体操作的对不对得运行时才知道；
- 如果在DataFrame中调用了API之外的函数时，编译器就可以发现这个错。不过，如果你使用了一个不存在的字段名字，那就要到运行时才能发现错误了；
- Dataset API都是用lambda函数和JVM类型对象表示的，所有不匹配的类型参数都可以在编译时发现。而且在使用Dataset时，分析错误也会在编译时被发现，这样就节省了开发者的时间和代价。


