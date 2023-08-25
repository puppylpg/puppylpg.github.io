---
layout: post
title: "Java Object"
date: 2023-08-24 22:01:04 +0800
categories: Java
tags: Java
---

就像http协议有header一样，java对象也是有header的（而且对Java使用者不可见）。我们在对象里设置的东西，实际上是java对象的body。**之所以要有header，是为了保存一些内部使用的信息**。

> **把metadata保存在header里是常用手段**。ZGC就更猛了，直接把信息记录到了指向对象的指针上——染色指针。

object由三部分组成
- header
- instance data
- padding

jvm的很多技术都用到了object header，比如指针压缩、synchronized锁优化、记录对象的代、hashCode等。

1. Table of Contents, ordered
{:toc}

# padding
先说最简单的padding，它也是理解指针压缩的关键。

之所以对象要增加一些padding，是为了让下一个对象的起始地址正好是8byte的整数倍，也就是**地址对齐**。地址对齐是计算机底层经常会做的一件事，主要是保证读取的效率，在对齐的位置，对象可以更快地被访问。虽然会浪费一些空间，但是这些浪费是值得的。

可以使用参数修改默认的8byte对齐：`-XX:ObjectAlignmentInBytes=n`

## 指针压缩
padding带来的地址对齐的效果，使得指针压缩成为了可能。

> `-XX:+UseCompressedOops`

### CPU最小寻址单元——byte
32bit的地址能表示多大内存？

`2^3 * 2^30 = 4G`，单位是什么？**byte，而非bit**，所以能表示4GB空间。**为什么单位是byte？因为CPU寻址的最小单位是"字节"（Byte）**。内存被划分为连续的字节单元，每个字节单元都有一个唯一的地址（注意**是每个“byte”都有地址，而非每个“bit”都有地址**）。CPU 通过指定的地址来读取或写入特定的字节。。

因此可以理解为，内存本身也做了地址对齐。

> 如果最小单位不是byte，32bit地址最多能表示4G bit空间，而非4G Byte。

### 地址膨胀
对于32bit计算机，为了表示内存里任意一处（指字节！）的地址，地址长度需要为32bit。地址就是指针，所以指针长度为32bit。同理，对于64bit计算机，地址长度需要为64bit。因此，使用64bit jvm的时候，消耗的内存会天然变大，因为每一个指针的大小都比32bit jvm膨胀了一倍。

> CPU一次最少读取的数据量是由计算机体系结构中的**数据总线宽度**确定的。通常情况下，现代计算机的数据总线宽度为 8 字节（64 位）或 4 字节（32 位）。这意味着在一次读取操作中，CPU 至少会读取 8 字节或 4 字节的数据。这也被称为 **CPU 的数据字长**或数据操纵单元的宽度。当 CPU 需要读取更少的数据时，仍然会读取整个数据字长，并将不需要的部分忽略掉。

和CPU有最小寻址单元类似的是，**Java对象是8字节对齐的，也就是说，Java对象也有最小寻址单元，jvm里实际上不需要为每个byte编码一个地址，只需要为每8byte编码一个地址即可**。这样的话，同样是32bit的地址，可表示的寻址空间为`4G * 8byte = 32GB`，而非4GB！既然如此，在64bit jvm上，当heap内存小于32GB时，没必要使用64bit地址，使用32bit地址也是可以的，这样的话能节省一些指针所占用的空间。

> Instead of pointing at exact byte locations in memory, the pointers reference object offsets.（或者说pointing at every 8 bytes）

把64bit指针替换为32bit指针，就是**指针压缩**。

由于padding使得Java对象每8byte对齐，现在使用32bit地址，和35bit（32 + 2^3）地址能引用的堆内存空间是一样的。

## Elasticsearch与指针压缩
在Elasticsearch的[Heap: Sizing and Swapping](https://www.elastic.co/guide/en/elasticsearch/guide/current/heap-sizing.html#compressed_oops)里，特意提到JVM heap不要超过32GB，否则指针膨胀会消耗额外内存，导致40-50GB的heap才和指针压缩时32GB heap效果差不多。

> In fact, it takes until around 40–50 GB of allocated heap before you have the same effective memory of a heap just under 32 GB using compressed oops.

## ZGC与指针压缩
zgc因为用了染色指针，用到了指针里的高位，所以不支持指针压缩。后续可能会解决这个问题。所以使用ZGC的场景下，地址都是64bit，需要开更大的内存。

# header
header里的信息都是给jvm用的。

header和body里都有指向别的对象的指针：
- 前者叫klass pointer，指向**类文件对应的Class对象**，该对象表述了这个类new出来的对象一切信息（describes the layout and behavior of the original object）；
- 后者叫**Ordinary Object Pointer（OOP）**，指向类new出来的普通对象。

**一般说的指针压缩，并没有指明是在压缩klass指针还是oop指针，因为在JDK 15之前，[开启oop指针压缩（`XX:+UseCompressedOops`）一定会开启klass pointer压缩（`XX:+UseCompressedClassPointers`）](https://stackoverflow.com/a/74349384/7676237)**，所以导致大家印象中的指针压缩就是`XX:+UseCompressedOops`，忽略了`XX:+UseCompressedClassPointers`。

[在JDK 15之后，二者是独立的](https://bugs.openjdk.org/browse/JDK-8241825)，可以选择单独压缩oop指针或klass指针。

在[32bit jvm](https://gist.github.com/arturmkrtchyan/43d6135e8a15798cc46c)里，kp占32bit：
```
|----------------------------------------------------------------------------------------|--------------------|
|                                    Object Header (64 bits)                             |        State       |
|-------------------------------------------------------|--------------------------------|--------------------|
|                  Mark Word (32 bits)                  |      Klass Word (32 bits)      |                    |
|-------------------------------------------------------|--------------------------------|--------------------|
| identity_hashcode:25 | age:4 | biased_lock:1 | lock:2 |      OOP to metadata object    |       Normal       |
|-------------------------------------------------------|--------------------------------|--------------------|
|  thread:23 | epoch:2 | age:4 | biased_lock:1 | lock:2 |      OOP to metadata object    |       Biased       |
|-------------------------------------------------------|--------------------------------|--------------------|
|               ptr_to_lock_record:30          | lock:2 |      OOP to metadata object    | Lightweight Locked |
|-------------------------------------------------------|--------------------------------|--------------------|
|               ptr_to_heavyweight_monitor:30  | lock:2 |      OOP to metadata object    | Heavyweight Locked |
|-------------------------------------------------------|--------------------------------|--------------------|
|                                              | lock:2 |      OOP to metadata object    |    Marked for GC   |
|-------------------------------------------------------|--------------------------------|--------------------|
```
此时对象头长度为：**32bit mark word + 32bit klass pointer** = 64bit

在64bit jvm里，kp占64bit：
```
|------------------------------------------------------------------------------------------------------------|--------------------|
|                                            Object Header (128 bits)                                        |        State       |
|------------------------------------------------------------------------------|-----------------------------|--------------------|
|                                  Mark Word (64 bits)                         |    Klass Word (64 bits)     |                    |
|------------------------------------------------------------------------------|-----------------------------|--------------------|
| unused:25 | identity_hashcode:31 | unused:1 | age:4 | biased_lock:1 | lock:2 |    OOP to metadata object   |       Normal       |
|------------------------------------------------------------------------------|-----------------------------|--------------------|
| thread:54 |       epoch:2        | unused:1 | age:4 | biased_lock:1 | lock:2 |    OOP to metadata object   |       Biased       |
|------------------------------------------------------------------------------|-----------------------------|--------------------|
|                       ptr_to_lock_record:62                         | lock:2 |    OOP to metadata object   | Lightweight Locked |
|------------------------------------------------------------------------------|-----------------------------|--------------------|
|                     ptr_to_heavyweight_monitor:62                   | lock:2 |    OOP to metadata object   | Heavyweight Locked |
|------------------------------------------------------------------------------|-----------------------------|--------------------|
|                                                                     | lock:2 |    OOP to metadata object   |    Marked for GC   |
|------------------------------------------------------------------------------|-----------------------------|--------------------|
```
此时对象头长度为：**64bit mark word + 64bit klass pointer** = 128bit，是原来的两倍。

## header里的指针压缩
**开启指针压缩之后，kp被压缩为32bit**：
```
|--------------------------------------------------------------------------------------------------------------|--------------------|
|                                            Object Header (96 bits)                                           |        State       |
|--------------------------------------------------------------------------------|-----------------------------|--------------------|
|                                  Mark Word (64 bits)                           |    Klass Word (32 bits)     |                    |
|--------------------------------------------------------------------------------|-----------------------------|--------------------|
| unused:25 | identity_hashcode:31 | cms_free:1 | age:4 | biased_lock:1 | lock:2 |    OOP to metadata object   |       Normal       |
|--------------------------------------------------------------------------------|-----------------------------|--------------------|
| thread:54 |       epoch:2        | cms_free:1 | age:4 | biased_lock:1 | lock:2 |    OOP to metadata object   |       Biased       |
|--------------------------------------------------------------------------------|-----------------------------|--------------------|
|                         ptr_to_lock_record                            | lock:2 |    OOP to metadata object   | Lightweight Locked |
|--------------------------------------------------------------------------------|-----------------------------|--------------------|
|                     ptr_to_heavyweight_monitor                        | lock:2 |    OOP to metadata object   | Heavyweight Locked |
|--------------------------------------------------------------------------------|-----------------------------|--------------------|
|                                                                       | lock:2 |    OOP to metadata object   |    Marked for GC   |
|--------------------------------------------------------------------------------|-----------------------------|--------------------|
```
此时对象头长度为：**64bit mark word + 32bit klass pointer** = 96bit

## header的结构
从上面的可以看到，header由两部分组成：
- mark word：一些标志位。但是它的含义是动态的，一切取决于State的值（lock字段的值对应了state），不同的值会使得mark word翻译成不同的意思；
- klass word：**指向Class对象**；

> 参考：[HotSpot Glossary of Terms](https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html)

**之所以mark word的定义这么复杂，都是为了省空间**。简单的协议往往费空间，复杂的协议往往在各种复用空间。即便如此，Java还在酝酿进一步缩减header的大小，[JEP 450](https://openjdk.org/jeps/450)打算把它缩减为64bit，再小一半，以减少Java对象的内存占用。

## 不断变化
不过时过境迁，[**从JDK 15起，偏向锁被废除了**](https://openjdk.org/jeps/374)，所以header的结构不完全是上面的样子了。

在当前openjdk/jdk的项目里（jdk20），[markWord.hpp](https://github.com/openjdk/jdk/blob/82749901b1497f524e53e47c45708c8e4a63c8b9/src/hotspot/share/oops/markWord.hpp#L37)这样定义mark word：
```
//  32 bits:
//  --------
//             hash:25 ------------>| age:4  unused_gap:1  lock:2 (normal object)
//
//  64 bits:
//  --------
//  unused:25 hash:31 -->| unused_gap:1  age:4  unused_gap:1  lock:2 (normal object)
//
//  - hash contains the identity hash value: largest value is
//    31 bits, see os::random().  Also, 64-bit vm's require
//    a hash value no bigger than 32 bits because they will not
//    properly generate a mask larger than that: see library_call.cpp
//
//  - the two lock bits are used to describe three states: locked/unlocked and monitor.
//
//    [ptr             | 00]  locked             ptr points to real header on stack
//    [header          | 01]  unlocked           regular object header
//    [ptr             | 10]  monitor            inflated lock (header is wapped out)
//    [ptr             | 11]  marked             used to mark an object
//    [0 ............ 0| 00]  inflating          inflation in progress
```
之前的biased_lock bit现在变成了unused_gap。

## lock
在mark word里记录锁的信息，参考[synchronized和Monitor]({% post_url 2021-04-07-monitor %})。

# instance data
实例数据就是我们在对象里定义的字段，相当于http的body部分。

## field packing
但是jvm并不是按照字段定义的顺序布局body里的数据的，可能会调整字段顺序以让结构更紧凑，俗称**field packing**。packing的时候也会存在padding。见下面的实例。

## body里的指针压缩
压缩instance data里的oop。

# 实例
使用JDK20来观察内存布局。

先定义一个类，接下来观察这个类new出的对象的内存分布：
```java
public class A {

    boolean _1byte;

    int _4byte;

    // Ordinary Object Pointers
    Object _oop = new Object();

    // 会被packing到_4byte后面，而非按照declare顺序摆放
    char _2byte;

    Object _oop2 = new Object();
}
```
同时使用jol展示Java对象的布局：
```xml
        <dependency>
            <groupId>org.openjdk.jol</groupId>
            <artifactId>jol-core</artifactId>
            <version>0.17</version>
        </dependency>
```

## 开启指针压缩
默认情况下，指针压缩是开启的：
```java
public class ObjectHeaderCompressedOops {

    static A a = new A();

    public static void main(String... args) {
        System.out.println(VM.current().details());
        System.out.println(ClassLayout.parseInstance(a).toPrintable());
    }
}
```
从vm detail能看出很多有用信息：
```
# VM mode: 64 bits
# Compressed references (oops): 3-bit shift
# Compressed class pointers: 0-bit shift and 0x7F9357000000 base
# Object alignment: 8 bytes
#                       ref, bool, byte, char, shrt,  int,  flt,  lng,  dbl
# Field sizes:            4,    1,    1,    2,    2,    4,    4,    8,    8
# Array element sizes:    4,    1,    1,    2,    2,    4,    4,    8,    8
# Array base offsets:    16,   16,   16,   16,   16,   16,   16,   16,   16
```
每一行的信息都很重要：
- 这是一个64bit jvm；
- 开启了oop指针压缩`XX:+UseCompressedOops`；
- 开启了kp指针压缩`XX:+UseCompressedClassPointers`；
- 对象8字节对齐`-XX:ObjectAlignmentInBytes=8`；
    + 对齐后，地址（ref）的大小变成了4byte，占用32bit而非64bit；

此时A类型的对象的内存布局如下：
```
jvm.object.header.A object internals:
OFF  SZ               TYPE DESCRIPTION               VALUE
  0   8                    (object header: mark)     0x0000000000000001 (non-biasable; age: 0)
  8   4                    (object header: class)    0x010031f8
 12   4                int A._4byte                  0
 16   2               char A._2byte                   
 18   1            boolean A._1byte                  false
 19   1                    (alignment/padding gap)   
 20   4   java.lang.Object A._oop                    (object)
 24   4   java.lang.Object A._oop2                   (object)
 28   4                    (object alignment gap)    
Instance size: 32 bytes
Space losses: 1 bytes internal + 4 bytes external = 5 bytes total
```
header：
- mark word：8byte
- klass pointer：4byte（**kp指针压缩**）

body：
- **普通类型的属性做了field compact**
    + int
    + char
    + boolean
    + padding：**变量和oop之间也padding**了1byte，为了让oop也字节对齐（对齐的单位为oop的大小）。
- oop对象地址：4byte（**oop指针压缩**）
- **padding**：最后整个对象要补全到8的倍数，需要补齐4byte，整个对象一共32byte

两次padding，共浪费1 bytes internal + 4 bytes external = 5 bytes total

## 关闭oop指针压缩
添加JVM参数：`-XX:-UseCompressedOops`。

vm detail：
```
# VM mode: 64 bits
# Compressed references (oops): disabled
# Compressed class pointers: 0-bit shift and 0x7FAF13000000 base
# Object alignment: 8 bytes
#                       ref, bool, byte, char, shrt,  int,  flt,  lng,  dbl
# Field sizes:            8,    1,    1,    2,    2,    4,    4,    8,    8
# Array element sizes:    8,    1,    1,    2,    2,    4,    4,    8,    8
# Array base offsets:    16,   16,   16,   16,   16,   16,   16,   16,   16
```
可以看到oop指针压缩disabled，**但是klass pointer指针压缩依然正常开启**。

此时地址（ref）的大小为8byte，64bit。

A类型的对象的内存布局如下：
```
jvm.object.header.A object internals:
OFF  SZ               TYPE DESCRIPTION               VALUE
  0   8                    (object header: mark)     0x0000000000000001 (non-biasable; age: 0)
  8   4                    (object header: class)    0x010031f8
 12   4                int A._4byte                  0
 16   2               char A._2byte                   
 18   1            boolean A._1byte                  false
 19   5                    (alignment/padding gap)   
 24   8   java.lang.Object A._oop                    (object)
 32   8   java.lang.Object A._oop2                   (object)
Instance size: 40 bytes
Space losses: 5 bytes internal + 0 bytes external = 5 bytes total
```
**header依然开启kp指针压缩，所以没变化，依然是4byte**。

body关闭了oop指针压缩，oop变成了8byte，此时普通变量和oop之间padding了5byte，才能让oop地址按照oop的大小（8byte）做地址对齐。

**最后整个对象正好是8的倍数，没有做对象的padding**。

一次padding，共浪费5 bytes internal + 0 bytes external = 5 bytes total

## 关闭oop和kp指针压缩
添加JVM参数：`-XX:-UseCompressedOops`和`-XX:-UseCompressedClassPointers`。

vm detail：
```
# VM mode: 64 bits
# Compressed references (oops): disabled
# Compressed class pointers: disabled
# Object alignment: 8 bytes
#                       ref, bool, byte, char, shrt,  int,  flt,  lng,  dbl
# Field sizes:            8,    1,    1,    2,    2,    4,    4,    8,    8
# Array element sizes:    8,    1,    1,    2,    2,    4,    4,    8,    8
# Array base offsets:    24,   24,   24,   24,   24,   24,   24,   24,   24
```
可以看到oop指针压缩disabled，**klass pointer指针也disabled**。

此时地址（ref）的大小为8byte，64bit。

A类型的对象的内存布局如下：
```
jvm.object.header.A object internals:
OFF  SZ               TYPE DESCRIPTION               VALUE
  0   8                    (object header: mark)     0x0000000000000001 (non-biasable; age: 0)
  8   8                    (object header: class)    0x00007fd060707230
 16   4                int A._4byte                  0
 20   2               char A._2byte                   
 22   1            boolean A._1byte                  false
 23   1                    (alignment/padding gap)   
 24   8   java.lang.Object A._oop                    (object)
 32   8   java.lang.Object A._oop2                   (object)
Instance size: 40 bytes
Space losses: 1 bytes internal + 0 bytes external = 1 bytes total
```
**header关闭了kp指针压缩，所以klass pointer从4byte变成了8byte**。

body关闭了oop指针压缩，oop变成了8byte，此时普通变量和oop之间padding了1byte，和上一个例子相比，因为header里的klass pointer占了额外的4byte，所以这里少padding了4byte。

最后整个对象正好是8的倍数，没有做对象的padding。

一次padding，共浪费1 bytes internal + 0 bytes external = 1 bytes total

参考：
- [深入理解Java的对象头mark word](https://blog.csdn.net/qq_36434742/article/details/106854061)；
- [Memory Layout of Objects in Java](https://www.baeldung.com/java-memory-layout)

