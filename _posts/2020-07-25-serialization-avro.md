---
layout: post
title: "序列化 - Avro"
date: 2020-07-25 21:27:30 +0800
categories: avro serialization
tags: avro serialization
---

Avro结合Java使用，主要有：
- avsc编译为Java代码；
- 使用生成的代码序列化反序列化对象；

1. Table of Contents, ordered
{:toc}

# 编译avsc
可以使用avro-tools手动编译avsc生成Java代码，也可以使用avro-maven-plugin。

```
java -jar avro-tools-1.10.0.jar compile schema user.avsc .
```
会在当前目录下生成package目录，里面有生成的Java类。

# 创建对象

一般用builder，但也可以用constructor。

使用constructor创建对象可以只设置需要的属性，但是using a builder requires setting all fields, even if they are null。

# 序列化反序列化
avro序列化的时候，会先在文件里写当前对象的schema，再写对象。

反序列化的时候，文件里记录的有writer（DatumWriter）写时的schema，reader（DatumReader）会有读时的schema：
- writer的schema告诉avro writer当时写字段的时候是按照什么顺序写的；
- reader的schema告诉avro转成对象的时候都需要哪些字段，以及对于新增的writer写时还不存在的字段，使用哪些默认值；

如果两套schema不一样，按照[Schema Resolutin](http://avro.apache.org/docs/current/spec.html#Schema+Resolution)来搞。

## 使用生成的代码
```
// Serialize user1, user2 and user3 to disk
DatumWriter<User> userDatumWriter = new SpecificDatumWriter<User>(User.class);

DataFileWriter<User> dataFileWriter = new DataFileWriter<User>(userDatumWriter);

dataFileWriter.create(user1.getSchema(), new File("users.avro"));
dataFileWriter.append(user1);
dataFileWriter.append(user2);
dataFileWriter.append(user3);
dataFileWriter.close();
```
如果已经编译avsc生成了特定的类的代码，可以创建特定的类（这里指User）的writer，**特定的类的DatumWriter使用SpecificDatumWriter**。

接着创建一个DataFileWriter写入file。先写schema，再append对象。这个DataFileWriter封装了写时的内部细节，其实还是用DatumWriter往file里写的。

```
// Deserialize Users from disk
DatumReader<User> userDatumReader = new SpecificDatumReader<User>(User.class);

DataFileReader<User> dataFileReader = new DataFileReader<User>(file, userDatumReader);

User user = null;
while (dataFileReader.hasNext()) {
// Reuse user object by passing it to next(). This saves us from
// allocating and garbage collecting many objects for files with
// many items.
user = dataFileReader.next(user);
System.out.println(user);
}
```
读的时候类似，DatumReader使用的是SpecificDatumReader。使用迭代器读数据。

需要注意的是这里的标准读法：**传入一个User的引用，avro会始终复用这个对象，对这个对象的属性赋值，从而避免创建多个对象。** 如果数据量不大，则没有必要这么复用，可以直接使用：
```
for (User user :dataFileReader)
```
每次new一个新的User。

> Hadoop读对象的时候也是这么搞的，kafka貌似也是。处理大量数据的时候，基本都是这么复用对象。

同样，这个DataFileReader也是封装了读时的内部细节，实际肯定也是用DatumReader从file里反序列化的。

总结：
- DatumWriter -> SpecificDatumWriter
- DatumReader -> SpecificDatumReader
- DataFileReader/DataFileWriter

## 不使用生成的代码
也可以不使用生成的代码，直接用通用的方式写对象。

首先，因为没有编译avsc生成Java代码，所以没法用constructor或者builder创建对象：
```
Schema schema = new Schema.Parser().parse(new File("user.avsc"));

GenericRecord user1 = new GenericData.Record(schema);
user1.put("name", "Alyssa");
user1.put("favorite_number", 256);
// Leave favorite color null

GenericRecord user2 = new GenericData.Record(schema);
user2.put("name", "Ben");
user2.put("favorite_number", 7);
user2.put("favorite_color", "red");
```
只能使用GenericRecord，按照一个Schema（avsc）操作，以k-v的形式摄入数据，如果schema里没有这个属性，会抛出运行时错误AvroRuntimeException。

序列化的时候，也没法使用SpecificDatumWriter，而是GenericDatumWriter（就像GenericRecord一样），同时传入Schema（avsc）：
```
// Serialize user1 and user2 to disk
DatumWriter<GenericRecord> datumWriter = new GenericDatumWriter<GenericRecord>(schema);

DataFileWriter<GenericRecord> dataFileWriter = new DataFileWriter<GenericRecord>(datumWriter);

dataFileWriter.create(schema, new File("users.avro"));
dataFileWriter.append(user1);
dataFileWriter.append(user2);
dataFileWriter.close();
```
同样还是用DataFileWriter去写，这点没变，只不过封装的DatumWriter是GenericDatumWriter。

```
// Deserialize users from disk
DatumReader<GenericRecord> datumReader = new GenericDatumReader<GenericRecord>(schema);

DataFileReader<GenericRecord> dataFileReader = new DataFileReader<GenericRecord>(file, datumReader);

GenericRecord user = null;
while (dataFileReader.hasNext()) {
// Reuse user object by passing it to next(). This saves us from
// allocating and garbage collecting many objects for files with
// many items.
user = dataFileReader.next(user);
System.out.println(user);
```
读的时候类似，使用的是GenericDatumReader。

总结：
- DatumWriter -> GenericDatumWriter
- DatumReader -> GenericDatumWriter
- DataFileWriter/DataFileReader

# Ref
- Avro Java开发：http://avro.apache.org/docs/current/gettingstartedjava.html
- spec: http://avro.apache.org/docs/current/spec.html

