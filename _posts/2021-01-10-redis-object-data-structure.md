---
layout: post
title: "Redis - 对象及底层数据结构实现"
date: 2021-01-10 23:28:51 +0800
categories: Redis
tags: Redis
---

redis存储的kv都是object。object有五种，k永远都是string，v是string/list/set/zset/hash，其实就是string和list、set、map再加个sorted set。

1. Table of Contents, ordered
{:toc}

# 数据结构
这五种object由以下底层数据结构实现：

## sds
redis的string不是简单地c string，而是自定义的一个数据结构Simple Dynamic String（SDS），其实就是一个string的wrapper类，包含：
- char buf[]：保存string；
- len：string长度；
- free：记录buf中未使用的字节数；

现在分析一下s、d、s的含义：
- simple：的确很simple，和c string相比没多太多东西；
- dynamic：申请空间时候预申请，后续再用到空间可能就不用再malloc了；释放空间时先留着，毕竟后续可能又用上了。总之就是减少申请空间和回收空间的频次；
- string：兼容c的string；

优点：
- 获取string长度时间复杂度为O(1)，直接返回len即可；
- sds里的char buff[]兼容c（**兼容方式为，不管存的是什么，总会在最后放一个`'\0'`，不计入len，也不计入free**），所以可以直接使用c处理字符串的函数，省事儿；（比如`char *strcat(char *dest, const char * src);`）
- 拓展了c string。c string只能在末尾包含`'\0'`，所以**只能保存文本，不能保存二进制**。redis的**sds判断字符串是否结束，使用的是len属性**。所以char buf[]本质上**可以保存**二进制数据，所以buf可以是**字节数组**；
- dynamic；

### 字符 vs. 字节
关于sds的buf保存字节，需要说明的是：
- sds因为有len属性，所以拥有保存二进制字节数组的能力，但未必要往里面放字节；
- sds也可以往里存字符数组；
- **只有存字符数组时（中间不会出现`'\0'`），才能直接用c的str函数**，比如`strcat(sds -> buf, "hello")`，能用是因为sds的buf最后总会放一个`'\0'`；

比如：
```java
        Jedis jedis = new Jedis();
        String id = "hello";
        byte[] hello = id.getBytes(StandardCharsets.UTF_16);
        byte[] world = "world".getBytes(StandardCharsets.UTF_8);
        byte[] exclamation = "!".getBytes(StandardCharsets.UTF_8);

        jedis.del(hello);
        jedis.rpush(hello, world);
        jedis.rpush(hello, exclamation);
        for (byte[] array : jedis.lrange(hello, 0, -1)) {
            System.out.println(new String(array, StandardCharsets.UTF_8));
        }
```
关键是，自己存的二进制要自己去反序列化。

但是上面的demo比较魔幻的是，一开始key和value用的全是UTF8 byte，MONITOR redis server，会发现，输出的是：
```
1610277272.280990 [0 127.0.0.1:59642] "RPUSH" "hello" "world"
1610277273.820139 [0 127.0.0.1:59642] "RPUSH" "hello" "!"
```
redis把utf8默认反序列化了为string了，就好像我们在cli里使用string存储的一样：
```
127.0.0.1:6379> lrange hello 0 -1
1) "world"
2) "!"
```
所以后来我把key改成了UTF16，这下redis识别不出来了。输出的是：
```
1610278078.609975 [0 127.0.0.1:60773] "RPUSH" "\xfe\xff\x00h\x00e\x00l\x00l\x00o" "world"
1610278080.057863 [0 127.0.0.1:60773] "RPUSH" "\xfe\xff\x00h\x00e\x00l\x00l\x00o" "!"
```
查看key：
```
127.0.0.1:6379> keys *
1) "a"
2) "\xfe\xff\x00h\x00e\x00l\x00l\x00o"
```
**难道redis默认会自动把UTF8的byte转为string？**

## list
c没有list，所以redis自己定义了listNode struct和list struct来实现双端链表。

所以，redis有了list这一数据结构。

## dict
同理，redis定义了dict struct来实现map，或者说字典也行。

这个结构和Java的HashMap如出一辙。dictEntry（二维）数组是桶，每个桶是一个一维dictEntry数组，当节点hash冲突时，依次放在同一个桶（数组）里。

### 渐进式rehash
dict有两个哈希表，用只含两个元素的哈希表数组表示。平时用第一个，rehash的时候用到第二个。

rehash的时候先给ht[1]分配空间，根据扩容或者收缩，变成ht[0]的2倍或一半。将0的节点挪到1。挪完之后0的指针指向1，1释放掉。所以接下来还是用的ht[0]。

> Java用了更高效的将就bin拆为high/low两个新bin的操作，但因为扩容/收缩都是按照倍增/折半的方式进行的，所以本质上rehash就是一个桶拆为两个桶，或者两个桶合为一个桶。

什么时候hash？Java是负载因子达到0.75的时候，而redis没执行BGSAVE时是1，执行的时候是5。

最后，rehash是渐进式的：如果是增，增到1里。同时每次对dict执行增删改查之后，都把一个桶里的节点从0挪到1，直到全搞完。
- 优点：毕竟redis是单线程的，将rehash的负担分摊到每一个操作里，放置一次请求卡太久；
- 缺点：增删改查先在0里进行，再在1里进行，要进行两次；

## skiplist：实现sorted set
带索引的链表。层层索引，类似于词典里的一级二级目录。知道找到所在区间，再遍历该区间。总体上是空间换时间的思路，查找元素的时间复杂度从O(N)降为O(logN)。

redis定义了zskiplistNode struct和zskiplist struct。每个node都包含：
- double score：**排序依据**；
- robj *obj：成员对象；

和backword指针、一些代表层的forward指针。

## intset：实现set
其实就是一个int array的wrapper。类似sds，也有length属性。

升级：struct里的encoding标记了数组的数据的类型，8bit/16bit等。如果新加入了类型更大的数据，所有数据都要升级为该类型。这么做无非是穷人的无奈——如果都是8bit的数据，那该intset就能省点儿空间了。

## ziplist：实现list和hash
也是为了节约内存，如果list的每个数都很小，或者长度比较短的字符串，就用ziplist实现list。

**ziplist本质上是`v1v2v3...vN`这样将所有值紧凑排列**。为了快速获取存了多少个value，在开头还记录了len、总bytes等等。

# object
object是由以上底层数据结构实现的，它的数据结构是redisObject struct：
- unsigned type：标记object的类型，一共五种，其实就是string加上list/set/map：
    + REDIS_STRING;
    + REDIS_LIST;
    + REDIS_SET;
    + REDIS_ZSET;
    + REDIS_HASH;
- void *prt：指向底层实现数据结构；
- unsigned encoding：标志着底层使用的数据类型。比如list根据实现不同，encoding有ziplist和linkedlist两种；

redis里key一定是string，使用`TYPE key`查看key对应的value的类型，输出分别为string/list/set/zset/hash。

## REDIS_STRING
string未必就是sds实现的：
- int：纯数字用int；
- sds：字符串用sds；
- embstr：专门保存短字符串的优化实现，类似sds，具体不想了解了；

## REDIS_LIST
- ziplist：类似ArrayList，只在小list用该结构，大list增删数据会比较麻烦；
- list：双端列链表，类似LinkedList，非常适合增删数据；

小列表用ziplist，超过512个会升级为list。

> 所有list的命令都以L或者R开头，分左右。

## REDIS_HASH
- ziplist：小字典，k1k2v1v2紧凑存放；
- dict：大字典；

小字典用ziplist，超过512个会升级为dict。

> 所有hash的命令都以H开头。

## REDIS_SET
- intset：小集合；
- hash：大集合。很像Java的HashSet，是用HashMap实现的，只用map的key，value为一个固定的Object。redis里，一毛一样，只不过value是NULL；

小集合用intset，超过512个用hash。

> 所有set的命令都以S开头。

## REDIS_ZSET
**zset和set相比，要多存一个分值，用于排序。所以zet的实现应该和hash差不多，只是在hash的基础上多了个“有序”的要求**。

zset至少要求两种功能：
1. 获取某一区间的有序数据；
2. 获取某节点的score；

实现方式：
- ziplist：和小hash对象一样，用ziplist保存。k1v1k2v2紧凑存放，v是他们的分值。kv都是按照分值从小到大存放的；
- dict + skiplist：和大hash对象一样，用dict保存。**但是只有dict并不能保证有序，所以还用了skiplist**；

使用dict+skiplist，dict和skiplist都会指向节点。可以让zset的两个功能都以很快的速度完成：
- 因为dict，可以以O(1)复杂度获取score。如果只有skiplist，最快也是O(logN)；
- 因为skiplist，可以保证有序，能够使用ZRANGE获取有序集合的某一区间，大概也就O(logN)到O(N)之间的复杂度。如果只有dict，每次都要先给dict的所有节点排序。众所周知，排序的时间复杂度最快为O(NlogN)；

小有序集合用ziplist，超过128个用hash+skiplist。

> 所有zset的命令都以Z开头。

## 共享object
类似Java常量池，这些常量用于共享，比如多个key对应同一个value，或者hash等object的对象用到了这个value，value就可能是被共享的。

之所以说可能，因为**redis的共享对象只能是纯数值字符串**。这么做主要是为了性能。当需要创建一个对象时，要先和共享对象进行比对：
- 纯数值字符串比对速度是O(1)；
- 字符串对象是O(N)；
- 更复杂的对象由多个值构成，需要全部比对，复杂度更高；

> 共享对象最多1w个。

## 回收object
c不能自动回收内存垃圾对象。redis自己实现了**引用计数（reference counting）**机制，即如果对象没有再被引用，就可以被删掉了。

Java不使用引用计数，因为会产生循环引用的垃圾，导致清理不掉。redis之所以能这么用，是**因为redis不会产生循环引用**。毕竟Java更底层一些，是一门语言，程序猿可以手动new对象，对象之间互相引用。redis更上一层，是编译出来的一个工具，只能通过redis提供的有限api创建一些对象，并不能更细粒度让对象之间产生关联。

## 最后访问时间
redisObject struct里有lru属性，标记对象最后一次被访问的时间。使用OBJECT IDLETIME可以查看（该命令访问对象不会刷新对象的最后一次访问时间）。

如果服务器开启了maxmemory，且内存回收算法是volatile-lru/allkeys-lru，内存不足时，优先释放lru靠前的对象。

其实相当于把redis当cache用了，使用lru算法清除超过cache大小的对象。


