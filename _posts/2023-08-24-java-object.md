---
layout: post
title: "Java Object"
date: 2023-08-24 22:01:04 +0800
categories: Java
tags: Java
---

就像http协议有header一样，java对象也是有header的（而且对Java使用者不可见）。我们在对象里设置的东西，实际上是java对象的body。**之所以要有header，是为了保存一些内部使用的信息**。

> 把metadata保存在header里是常用手段。ZGC就更猛了，直接把信息记录到了指向对象的指针上——染色指针。

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

# header
了解完指针压缩再看具体的header，指针压缩技术会影响header里的指针。

header和body里都有指向别的对象的指针，叫**Ordinary Object Pointer（OOP）**。在32bit jvm里，oop占32bit：
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

> 不只是oop，所有的pointer都是32bit，class word也是一个pointer。

此时对象头长度为：**32bit mark word + 32bit oop** = 64bit

> https://gist.github.com/arturmkrtchyan/43d6135e8a15798cc46c

在64bit jvm里，oop占64bit：
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

此时对象头长度为：**64bit mark word + 64bit oop** = 128bit，是原来的两倍。

**开启指针压缩之后，oop也是32bit**：
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

此时对象头长度为：**64bit mark word + 32bit oop** = 96bit

header由两部分组成：
- mark word：一些标志位。但是它的含义是动态的，一切取决于State的值（lock字段的值对应了state），不同的值会使得mark word翻译成不同的意思；
- klass word：**指向Class对象**，该对象表述了这个类new出来的对象一切信息（describes the layout and behavior of the original object）；

> 参考：[HotSpot Glossary of Terms](https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html)

**之所以mark word的定义这么复杂，都是为了省空间**。简单的协议往往费空间，复杂的协议往往在各种复用空间。

即便如此，Java还在酝酿进一步缩减header的大小，[JEP 450](https://openjdk.org/jeps/450)打算把它缩减为64bit，再小一半，以减少Java对象的内存占用。

## lock
参考[synchronized和Monitor]({% post_url 2021-04-07-monitor %})。


# instance data
实例数据就是我们在对象里定义的字段，相当于http的body部分。但是jvm并不是按照字段定义的顺序布局body里的数据的，可能会调整字段顺序以让结构更紧凑，俗称**field packing**。packing的时候也会存在padding。见下面的实例。

> header和body里都有指向别的对象的指针，压缩指针会减少对象地址的体积。


# 实例
参考：
- [深入理解Java的对象头mark word](https://blog.csdn.net/qq_36434742/article/details/106854061)；
- [Memory Layout of Objects in Java](https://www.baeldung.com/java-memory-layout)

TBD

