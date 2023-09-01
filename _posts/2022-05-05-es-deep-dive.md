---
layout: post
title: "Elasticsearch：分片读写"
date: 2022-05-05 02:06:38 +0800
categories: elasticsearch pagecache
tags: elasticsearch pagecache
---

集群和分片内部细节。

> [集群内的原理](https://www.elastic.co/guide/cn/elasticsearch/guide/current/distributed-cluster.html)

1. Table of Contents, ordered
{:toc}

# 协调节点
可以发送请求到集群中的任一节点，每个节点都有能力处理任意请求。收到请求的节点被称为[协调节点(coordinating node)](https://www.elastic.co/guide/cn/elasticsearch/guide/current/how-primary-and-replica-shards-interact.html)。

协调节点上有各种队列，称为**协调队列（coordinating queue）**：当客户端发送请求到协调节点时，协调节点会将请求放入对应的协调队列中，等待所有相关分片节点返回结果后再将结果汇总返回给客户端。**这些协调队列可以确保请求的有序处理，避免请求的重复执行和竞争条件，并且可以控制请求的并发数量，防止请求过载导致性能下降。**

比如：Search Queue可以确保查询请求按照先后顺序执行，每个查询请求只有在相关分片节点返回结果后才能执行下一个查询请求，从而避免查询请求之间的竞争条件。同样，Index Queue可以确保索引请求的有序执行，保证每个分片节点都按照正确的顺序执行索引请求。

1. Search Queue
2. Indexing Queue
3. Bulk Queue
4. Percolate Queue
5. Get Queue
6. Enrich Queue

**这些queue其实就是[Java相关线程池的queue](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-threadpool.html)**。

coordinating queue在满了之后，会报错。比如enrich coordinating queue：
> Could not perform enrichment, enrich coordination queue at capacity [1024/1024]'

所以虽然协调节点在做比如search时会轮询所有拥有相关数据分片的节点，但一次search请求中干活最多的还是协调节点。**因此，当发送请求的时候， 为了扩展负载，更好的做法是轮询集群中所有的节点。即，把所有协调节点都用上**。

# 分布式查询 - 任何一个shard都可以
[在处理读取请求时](https://www.elastic.co/guide/cn/elasticsearch/guide/current/distrib-read.html)，协调结点在每次请求的时候都会**通过轮询所有的副本分片来达到负载均衡**。

> 所以增加副本数可以增加读的并发度。
>
> 但是也有翻车的风险：在文档被检索时，已经被索引的文档可能已经存在于主分片上但是还没有复制到副本分片。 在这种情况下，副本分片可能会报告文档不存在，但是主分片可能成功返回文档。

## query then fetch - 两阶段检索

> 参考：[分布式检索](https://www.elastic.co/guide/cn/elasticsearch/guide/current/distributed-search.html)

es的查询是按照得分给结果排序的。如果返回top10，有两个master shard，那每个节点都要返回10个文档，最后由协调节点把这20个文档统一排序，返回top10。曾经，es的搜索方式`search_type`有两大类可选：
- ~~`query_and_fetch`~~：一次请求，每个shard都返回10个文档；
    + 缺点：每次传输数据太多；
- `query_then_fetch`：请求要分两次。第一次只获取每个shard的10个文档的metadata，排完序后，协调节点再取最终的10篇文档；
    + 缺点：总传输数据变少了，但是要分两次传输；

**除非搜索只命中一个shard，`query_and_fetch`才会比`query_then_fetch`快，所以默认就是`query_then_fetch`**。后来`query_and_fetch`干脆没了。

> 还有一种`search_type`是`dfs_query_then_fetch`，用于精确计算搜索关键词在整个索引的IDF：https://www.elastic.co/guide/en/elasticsearch/reference/current/search-search.html

## `_routing` - 缩小查询的shard范围
存储时使用hash的方式，查询时就有了回报：指定_routing，瞬间可以把查询定位到一个shard：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/_search_options.html

**所以整个es index其实就是一个大号hash map**：
- ~~桶的个数就是分片的个数~~（其实先分配到虚拟分片，再映射到实体分片。参考[Elasticsearch：数据重分配]({% post_url 2023-02-09-es-rehash %})）；
- 同一分片的文档都算是hash冲突的文档；

# 分布式写入 - 写请求必须给到master shard
[协调节点收到写请求后](https://www.elastic.co/guide/cn/elasticsearch/guide/current/distrib-write.html)：
1. 按照`_routing`确定请求应该写的分片；
2. **把请求发给拥有该分片master shard的节点**；
3. master shard写成功后，要不要返回写成功给协调节点，需要看情况：
    - **按照默认配置，只要master shard可用，就会执行写入，并告诉协调节点写成功了**；
    - 如果想稳妥一些，~~可以设置replica shard写成功才返回，相应的写请求就变慢了：**master shard写成功后，把请求转发给replica shard，replica写成功，才返回给协调节点“写成功”，协调节点再返回200给客户端**~~；

现在的es使用`wait_for_active_shards`控制~~最小写入shard成功个数~~ **“至少存活x个shard，才会执行写入操作，否则就一直等待，直到超时”**，**默认是1（只要primary shard活着，就可以写）**，all代表1+n（master + 所有的replica）：
- `wait_for_active_shards`：https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-index_.html#index-wait-for-active-shards
- update和index一样，也有`wait_for_active_shards`，默认也是1：https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-update.html

`wait_for_active_shards`不是“至少写成功x个shard才返回”，而是“至少有x个shard活着才会写”，**它只是写之前的一个对shard可用性的check，也并不能保证“一定会至少写入x个shard”**。一旦check之后，开始执行写操作了，replica再挂掉就与是否写入成功无关了：
> It is important to note that **this setting greatly reduces the chances of the write operation not writing to the requisite number of shard copies, but it does not completely eliminate the possibility, because this check occurs before the write operation commences**. Once the write operation is underway, it is still possible for replication to fail on any number of shard copies but still succeed on the primary. The _shards section of the write operation’s response reveals the number of shard copies on which replication succeeded/failed.

## vs. `consistency`
以前用的是`consistency`，和`wait_for_active_shards`不一样：
- https://www.elastic.co/guide/en/elasticsearch/reference/2.4/docs-index_.html#index-consistency
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/distrib-write.html

**`consistency`指的是“至少x个shard写成功才返回”**：
> The index operation only returns after **all active shards within the replication group** have indexed the document (sync replication).

**但后来的es用`wait_for_active_shards`取代了它，可能是`consistency`导致写操作太慢了？毕竟“写之前check一下active shard够不够数”，和“等待足够的active shard都写入成功”相比，代价要小得多**。当然代价就是上面说的，有一种很巧的情况：刚检查完，replica挂了。不过为了这种小概率事件，`consistency`付出的代价太大了。**所以使用`wait_for_active_shards`取代`consistency`，也可以看作是es在风险和性能上的一个权衡**。

# 分片内部 - 还有segment
- index：es索引，多个shard组成；
- shard：一个Lucene索引，多个segment和一个commit point组成；
- segment：一个倒排索引；

Ref：
- https://stackoverflow.com/a/15429578/7676237

## 段segment - 一个倒排索引
逻辑上，分片是最小的工作单元。在分片内部，是一个个的segment，**每个segment存放的是一个倒排索引**。

- 分片内部原理：https://www.elastic.co/guide/cn/elasticsearch/guide/current/inside-a-shard.html

es的倒排索引是不可变的，不可变有很多好处：
1. 利用内存缓存数据：从磁盘读取之后，可以充分os的page cache，因为不可变，所以可以一直待在内存里，除非内存不够了；
2. 对一些查询做缓存，比如filter查询；

**不可变的倒排索引怎么更新新的数据？添加新的倒排索引，也就是说添加新的segment**！但不修改旧的segment。

es是基于Lucene，Lucene就是按段搜索的。一个Lucene索引包含：
1. 几个segment：每个segment就是一个倒排索引；
2. **一个commit point提交点**：记录所有已知的segment的文件；

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/dynamic-indices.html
- 英文版介绍的更清晰：https://www.elastic.co/guide/en/elasticsearch/guide/current/dynamic-indices.html

> 一个es index包含好几个shard；**一个shard就是一个Lucene index**；一个Lucene index包含好几个segment和一个commit point。
>
> a Lucene index is what we call a shard in Elasticsearch, while an index in Elasticsearch is a collection of shards.

### 创建段 - 增加数据
段是写在磁盘上的，但一开始为了速度，是写在内存里的：
1. 一个新的segment（一个新的倒排索引）先写入内存里的buffer（in memory buffer）；
2. 段提交commit：
    1. segment写入磁盘；
    2. commit point写入磁盘；
    3. fsync后，才算真正地物理写入完毕；
3. **新的段被打开，变成可搜索状态（实际上fsync之前，已经算写入了，已经是可搜索了）**；
4. in memory buffer清空；

### 逐段搜索 per-segment search
搜索请求实际是逐段搜索的：
1. 搜索某个index，会把query发给所有的分片（对于同一个分片，primary和replica是一样的）；
2. **分片内，遍历所有的倒排索引（segment）**；
3. 所有segment的结果合并，就是shard的结果；
4. 所有shard的结果合并，就是整个index的搜索结果；

**段是一个接一个搜索的，所以如果段的个数太多，是会影响到搜索速度的。**

### 删改数据
段不可变，那删改数据怎么办？
- 删：**使用的是标记删除，每个commit point都包含一个`.del`文件，记录着哪个段里的哪个文档被删了**；
- 改：先删后加。在旧segment标记删除 + 在新segment添加；

> commit point相当于记录着所有已打开的segment的metadata文件，所以也会记录哪个segment的哪个文档被删了。

## `refresh`：不写回磁盘
创建segment的时候，理论上完全写入磁盘（fsync）才算写入完毕。**但是使用fsync完全写回磁盘太慢了。同时为了让segment能更快被打开、被搜索，Lucene调用sync把segment写入了page cache，此时segment就可以被打开被搜索。相当于把page cache当做innodb的buffer pool使用了。**

> Sitting between Elasticsearch and the disk is the filesystem cache.

写入page cache（sync）和写入磁盘（fsync），唯一的区别是：不写入磁盘，断电数据就丢了。**除此之外，在page cache里的文件和在磁盘上的文件没什么区别，都可以被打开、都可以读写**。

> But the new segment is written to the filesystem cache first—​which is cheap—​and only later is it flushed to disk—​which is expensive. **But once a file is in the cache, it can be opened and read, just like any other file**.

所以Lucene为了速度，只要sync写入page cache就算写入完成了！

> **Lucene allows new segments to be written and opened—​making the documents they contain visible to search—​without performing a full commit**. This is a much lighter process than a commit, and can be done frequently without ruining performance.

因为完全写入fsync磁盘才算commit完毕，所以这里sync不如取名叫“伪提交”？

> 关于page cache，可以参考：[Innodb - Buffer Pool]({% post_url 2022-01-23-innodb-buffer-pool %})

**把数据写入page cache的动作，叫做[`refresh`](https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html)**：把数据从内存中refresh到page cache里，使得数据可搜索。

> **In Elasticsearch, this lightweight process of writing and opening a new segment is called a refresh.**

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/near-real-time.html
- https://www.elastic.co/guide/en/elasticsearch/guide/current/near-real-time.html

**默认情况下，refresh的频率是1s一次，所以1s后新的倒排索引才是可见的。因此es被称为近实时搜索（near real-time search）**。

因此，刚索引进es的数据无法被立刻搜索到。但如果每索引一条数据就手动调一次refresh api，在索引量比较大的时候，对性能影响非常大。

> 虽然`sync`很轻量，但也不能一直调用啊！

可以修改全局[`refresh_interval`](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules.html#index-refresh-interval-setting)设置，也可以修改单个索引的`refresh_interval`：
```json
PUT /<index>/_settings
{ "refresh_interval": "1s" }
```

## `flush`：translog - es的redo log
虽然refresh可以写到page cache，但终究不是长久之计，如果写到page cache就算commit了，那服务崩溃了怎么办？这些还没来得及fsync的数据岂不是丢了？

这就是和mysql碰到的一模一样的问题了：修改buffer pool里的数据的时候，不想使用fsync完全写回磁盘，但是不写是不行的，崩了修改就没了。mysql使用redo log解决这个问题：把修改写入redo log，顺序io，写得更快。

> [Innodb - 有关事务的一切]({% post_url 2022-01-27-innodb-transaction %})，“redo log：为了提升性能的同时保证一致性”。

es也用了和redo log差不多的log，叫translog（事务日志）：
1. **每次新文档写入in-memory buffer，也同时写入translog**；
    1. refresh相当于“半提交” sync segment到page cache，所以会把in memory buffer清空，segment可被搜索。
    2. **translog里也写了数据，所以此时就算程序崩溃了也不怕，恢复的时候依然可以从translog找到这些尚未写入disk的变更**（这不就是redo log嘛）；

> 这不就是redo log嘛：**When starting up, Elasticsearch will use the last commit point（innodb的checkpoint） to recover known segments from disk, and will then replay all operations in the translog to add the changes that happened after the last commit**. 
> 
> innodb也是一样的，buffer pool的脏页刷盘了，对应的redo log就不需要了。**在innodb里，这叫一个checkpoint（在es里，这叫commit point）**。恢复的时候直接从checkpoint开始按照redo log恢复就行了

二者使用redo log/translog的理由一模一样，但在其他地方的写行为有所区别：
- **innodb不使用sync**：innodb数据写入redo log，使用的是fsync。**但是innodb不写page cache，毕竟它有buffer pool，mysql的数据都是要加载到buffer pool然后再进行增删改查的**；
- **es会使用sync**：es写translog，用的也是fsync。es写translog之前会把自己的in memory buffer写（sync）到page cache，**因为es自己没有维护一个类似于innodb的buffer pool，直接使用了os的page cache，从page cache读数据**。既然内存（in memory buffer）里现在有现成的数据，不如直接写到page cache，速度更快一些，省得再从磁盘读到page cache了；

### 刷盘时机
理论上来讲，无论translog还是redo log，都应该是立即写入磁盘的。

> redo log就是为了数据能先写回buffer pool不写回磁盘而存在的，如果redo log不立即写入磁盘，岂不是还需要redo redo log，来防止断电时数据没有写入redo log的问题！

实际上也差不多，不过准确来说**innodb写入磁盘的时机是事务提交时**，不提交的事物反正可以回滚掉，不急着写入磁盘。当然，默认情况下MySQL开启了autocommit，**一条写入语句就是一个事务**，所以差不多也相当于每条语句的redo log都会立即刷入磁盘。

translog的时机和redo log也一样，在每次写请求完成之后执行(e.g. index, delete, update, bulk)刷入硬盘，或者默认每5秒被fsync刷新到硬盘。**之后才会给client返回200**。

同样，redo log或translog空间有限，**终归要写入数据库，同时清除掉translog里已入库的数据**。redo log有checkpoint，translog有commit point。

每次[flush](https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-flush.html)就会产生一次commit point，**也可以对es手动flush，就和对innodb手动checkpoint一样**。

清空translog的时间点大概是：
- 手动调用`flush`；
- translog快满了；
- 一定时间定期flush：5s；

和mysql redo log的flush时间点其实类似。

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/translog.html

### refresh vs. flush
refresh和flush是两个概念：
- **数据写入buffer pool，就写入translog了，证明它不会丢了，只是此时还不可见**；
- **refresh操作的是buffer pool**: buffer pool -> page cache。**数据可见了**，会清空in memory buffer，但和translog无关;
- **flush操作的是translog**: fsync to disk，此时会清空translog；

所以es refresh之后，文档就可见了，可搜索。es flush之后，数据持久化了，translog可以删掉了。

> refresh和flush操作的是两个东西。**refresh默认1s一次，flush默认5s一次，二者没什么关联**。

### 异步translog - 只要胆子大，速度唰唰唰
写translog（fsync）的行为发生在一次写请求（增删改：index/delete/update/bulk）之后，**translog写入了，这次写操作才会给client返回200**。这和innodb写入redo log是一样的：**translog/redo log必须fsync，不敢用sync，不然程序崩溃了数据可就是真丢了，没有redo redo log为redo log做担保**。

但是translog还提供一个选项：写操作不触发fsync，而是每5s触发一次fsync到trans的行为。
- 优点：**这样的写操作性能更高，es给客户端返回更快，因为translog不fsync了，所以写操作完成的更快**；
- 缺点：如果程序崩了，5s内的写数据没有持久化，会全都丢掉

所以如果对数据丢失有一定容忍度，可以这么搞（只要胆子大，丢数据都不怕）。

> 所以es还是挺刺激的，没把自己当唯一数据库使用啊！估计es觉得一般情况下大家都是有mysql做主库，es做辅助查询库。要不然一般人谁敢对自己的唯一数据库这么搞……
> 
> **相比之下，innodb绝不使用sync写redo log的行为看起来“怂”了不少哈哈哈**：[Innodb - Buffer Pool]({% post_url 2022-01-23-innodb-buffer-pool %})

两个配置设置这个行为：
- `index.translog.durability`：
    + 默认是`request`，每个增删改请求都会写translog；
    + 设置成`async`，就只在`index.translog.sync_interval`到了才fsync到translog。默认是5s；
- `index.translog.sync_interval`

分清楚三个interval：
1. refresh interval：1s，是segment可用的时间。**开的越大，数据可见速度越慢**；
2. translog sync interval：5s，是胆子大的情况下，允许写操作不fsync到translog的时间。**开的越大，es崩了之后丢的数据越多**；
3. flush interval：30min，是数据从translog持久化到磁盘的时间。**开的越大，es崩了之后恢复数据的时间越长**；

Ref：
- translog设置：https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-translog.html#_translog_settings
- translog有多安全：https://www.elastic.co/guide/cn/elasticsearch/guide/current/translog.html

## `_forcemerge`：段合并
每次新建一个segment确实避免了段的修改，但1s refresh一次，这得创建多少个segment？每次shard内搜索都要遍历所有的segment，搜索速度岂不是变慢了？

> 由于自动刷新流程每秒会创建一个新的段 ，这样会导致短时间内的段数量暴增。

而段数目太多会带来较大的麻烦：
1. 每一个段都会消耗文件句柄、内存和cpu运行周期；
2. 更重要的是，每个搜索请求都必须轮流检查每个段。所以段越多，搜索也就越慢。

- 段合并：https://www.elastic.co/guide/cn/elasticsearch/guide/current/merge-process.html

Elasticsearch通过在后台进行段合并来解决这个问题。小的段被合并到大的段，然后这些大的段再被合并到更大的段。

权衡“段合并”和“索引”二者之间的资源消耗：
- 段合并：https://www.elastic.co/guide/cn/elasticsearch/guide/current/indexing-performance.html#segments-and-merging

api：
- 现在好像用force merge api：https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-forcemerge.html

但是正常情况下，es自己做段合并就够了。


