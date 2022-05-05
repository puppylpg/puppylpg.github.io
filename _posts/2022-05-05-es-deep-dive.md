---
layout: post
title: "Elasticsearch：deep dive"
date: 2022-05-05 02:06:38 +0800
categories: elasticsearch pagecache
tags: elasticsearch pagecache
---

集群和分片内部细节。

1. Table of Contents, ordered
{:toc}

# 集群
- 集群内的原理：https://www.elastic.co/guide/cn/elasticsearch/guide/current/distributed-cluster.html

状态：
- green：shard全都分配了；
- yellow：有没分配的replica shard；
- red：有宕机的master shard；

Ref：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/cluster-health.html
- 分片：https://www.elastic.co/guide/cn/elasticsearch/guide/current/_add-an-index.html

## 配置

- 集群配置：https://www.elastic.co/guide/en/elasticsearch/reference/current/settings.html
- **集群dynamic/static setting**：https://www.elastic.co/guide/en/elasticsearch/reference/current/settings.html#cluster-setting-types

## node

- node：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html

### 节点发现
- 单播：**按图索骥**——只寻找配置文件里写了的小伙伴。大家认识的小伙伴的并集就是整个集群；
- 多播：**河东狮吼**——有木有name=xxx的集群，有的话带我一个。很方便，但是生产环境一般不用；

设置`cluster.name`：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#cluster-name

> A node can only join a cluster when it shares its `cluster.name` with all the other nodes in the cluster. The default name is `elasticsearch`.

因为大家都叫`elasticsearch`，**所以在生产环境使用默认配置，且使用广播发现节点，可能别人起的node会不小心加入集群，这就比较离谱**。

设置`node.anme`，有名字才好认：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#node-name

**默认只绑定到localhost，所以想节点发现必须绑到公有ip上**：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#network.host

> When you provide a value for `network.host`, Elasticsearch assumes that you are moving from development mode to production mode：https://www.elastic.co/guide/en/elasticsearch/reference/current/system-config.html#dev-vs-prod

节点发现相关的配置：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-discovery-settings.html

单播节点`discovery.seed_hosts`：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#unicast.hosts

> 有趣的是，虽然已经[弃用`unicast.hosts`](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/breaking-changes-7.0.html#_discovery_configuration_is_required_in_production)了，但是看上面的url，`discovery.seed_hosts`的url还是`unicast.hosts`。

而且还能从第三方数据源读取单播名单（类似于从zk读取）：
- 多种node指定方式：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-discovery-hosts-providers.html#built-in-hosts-providers

### master选举

设置`minimum_master_nodes`大于半数，可以防止脑裂（split brain），两个集群各自独立运行。

### 停用节点decommission
如果没有副本，又要重启节点，为了数据不停机，可以手动停用节点，让它的shard数据分配到别的节点。

- `cluster.routing.allocation`
    - `exclude`:
        - `_ip`：逗号分隔
        - `_name`

相关配置：
- cluster routing：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-cluster.html#cluster-routing-settings

### 重启节点
如果只是重启节点，没必要先停用节点，这样会导致分片先分配出去，再分配回来，在集群数据比较大的情况下，非常耗时。

**如果数据存在副本**，那么就可以先设置不要在集群宕机之后重新分配shard，因为马上就重启回来了。

> 但是如果不存在副本，为了数据不宕机，还是需要先通过decommission的方式重启节点。

- cluster.routing.allocation
    - enable
        + none：停止shard分配。**如果master凉了，replica就会变成master。如果replica凉了，也不会重新分配replica，只是整个集群变成yellow**；
        + all：启用shard分配；

> 升级集群其实相当于轮流重启节点。

- shard allocation：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-cluster.html#cluster-shard-allocation-settings

### role
- https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html

### data
es存放数据的位置`path.data`：
- linux包管理器安装：`/var/data/elasticsearch`；
- .zip安装：`$ES_HOME/data`；

> 不要试图动data文件夹。不要备份data文件夹，没法直接恢复，需要使用es的snapshot和resotre功能。

- 设置data path：https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#path-settings

设置多个data path位置：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#_multiple_data_paths

## 高可用
- https://www.elastic.co/guide/en/elasticsearch/reference/current/high-availability-cluster-design.html

# 分布式存储 - 必须给master shard
可以发送请求到集群中的任一节点，每个节点都有能力处理任意请求。收到请求的节点被称为协调节点(coordinating node)。

协调节点收到写请求后：
1. 按照`_routing`确定请求应该写的分片；
2. **把请求发给拥有该分片master shard的节点**；
3. master shard写成功后，要不要返回写成功给协调节点，需要看情况：
    - **按照默认配置，master shard写成功，可以告诉协调节点写成功了**；
    - 如果想稳妥一些，可以设置replica shard写成功才返回，相应的写请求就变慢了：**master shard写成功后，把请求转发给replica shard，replica写成功，才返回给协调节点“写成功”，协调节点再返回200给客户端**；

现在的es使用`wait_for_active_shards`控制最小写入shard成功个数，**默认是1（master），all代表1+n（master + 所有的replica）**：
- `wait_for_active_shards`：https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-index_.html#index-wait-for-active-shards
- update和index一样，也有`wait_for_active_shards`，默认也是1：https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-update.html

以前用的是`consistency`，但是理念和上述参数是一致的：
- https://www.elastic.co/guide/en/elasticsearch/reference/2.4/docs-index_.html#index-consistency
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/distrib-write.html

# 分布式查询 - 任何一个shard都可以
**在处理读取请求时，协调结点在每次请求的时候都会通过轮询所有的副本分片来达到负载均衡**。

> 所以增加副本数可以增加读的并发度。
>
> 但是也有翻车的风险：在文档被检索时，已经被索引的文档可能已经存在于主分片上但是还没有复制到副本分片。 在这种情况下，副本分片可能会报告文档不存在，但是主分片可能成功返回文档。

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/distrib-read.html
- 分布式检索：https://www.elastic.co/guide/cn/elasticsearch/guide/current/distributed-search.html

## query then fetch - 两阶段检索
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
- 桶的个数就是分片的个数；
- 同一分片的文档都算是hash冲突的文档；

## deep pagination - 性能炸裂
TODO：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/_fetch_phase.html
- scroll：https://www.elastic.co/guide/cn/elasticsearch/guide/current/scroll.html

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

段是一个接一个搜索的，所以如果段的个数太多，是会影响到搜索速度的。

### 删改数据
段不可变，那删改数据怎么办？
- 删：**使用的是标记删除，每个commit point都包含一个`.del`文件，记录着哪个段里的哪个文档被删了**；
- 改：先删后加。在旧segment标记删除 + 在新segment添加；

> commit point相当于记录着所有已打开的segment的metadata文件，所以也会记录哪个segment的哪个文档被删了。

## `refresh`：半提交？ - Lucene等不及
创建segment的时候，理论上完全写入磁盘（fsync）才算写入完毕。**但是fsync太慢了，为了让segment能更快被打开、被搜索，Lucene调用sync写入page cache就算写入完毕了，segment就可以被打开被搜索**。

> Sitting between Elasticsearch and the disk is the filesystem cache.

写入page cache（sync）和写入磁盘（fsync），唯一的区别是：不写入磁盘，断电数据就丢了。**除此之外，在page cache里的文件和在磁盘上的文件没什么区别，都可以被打开、都可以读写**。

> But the new segment is written to the filesystem cache first—​which is cheap—​and only later is it flushed to disk—​which is expensive. **But once a file is in the cache, it can be opened and read, just like any other file**.

所以Lucene为了速度，只要sync写入page cache就算写入完成了！

> **Lucene allows new segments to be written and opened—​making the documents they contain visible to search—​without performing a full commit**. This is a much lighter process than a commit, and can be done frequently without ruining performance.

因为完全写入fsync磁盘才算commit完毕，所以这里sync不如取名叫“半提交”？

> 关于page cache，可以参考：[Innodb - Buffer Pool]({% post_url 2022-01-23-innodb-buffer-pool %})

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/near-real-time.html
- https://www.elastic.co/guide/en/elasticsearch/guide/current/near-real-time.html

刷新的page cache使用的是`refresh` api：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-refresh.html

默认1s刷新一次，所以1s后新的倒排索引才是可见的。因此es被称为近实时搜索（near real-time search）。

所以刚索引进去的数据无法被立刻搜索到。但如果每索引一条数据就手动调一次refresh api，在索引量比较大的时候，对性能影响非常大。

可以修改全局`refresh_interval`设置：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules.html#index-refresh-interval-setting

也可以修改单个索引的`refresh_interval`：
```
PUT /<index>/_settings
{ "refresh_interval": "1s" }
```

## `flush`：translog - es的redo log
虽然refresh可以写到page cache，但终究不是长久之计，总是要写回磁盘的。而且很重要的一个问题在于：如果写到page cache就算commit了，那服务崩溃了怎么办？这些还没来得及fsync的数据岂不是丢了？

这就是和mysql碰到的一模一样的问题了：buffer pool刷脏页到磁盘的时候，不想使用fsync完全写回磁盘，但是不写是不行的，崩了修改就没了。mysql使用redo log解决这个问题：把修改写入redo log，顺序io，写得更快。

> [Innodb - 有关事务的一切]({% post_url 2022-01-27-innodb-transaction %})，“redo log：一切为了性能”。

es也用了和redo log差不多的log，叫translog（事务日志）：
1. **每次新文档写入in-memory buffer，也同时写入translog**；
2. refresh相当于“半提交” sync segment到page cache，所以会把in memory buffer清空，segment可被搜索。**translog里的数据还在，所以此时就算程序崩溃了也不怕，恢复的时候依然可以从translog找到这些尚未写入disk的变更**（这不就是redo log嘛）；
3. 总有一个时间点，translog里的数据要被fsync到磁盘，之后translog就可以被清空了；

> 这不就是redo log嘛：**When starting up, Elasticsearch will use the last commit point（innodb的checkpoint） to recover known segments from disk, and will then replay all operations in the translog to add the changes that happened after the last commit**. 
> 
> innodb也是一样的，buffer pool的脏页刷盘了，对应的redo log就不需要了。**在innodb里，这叫一个checkpoint（在es里，这叫commit point）**。恢复的时候直接从checkpoint开始按照redo log恢复就行了

**可以对es手动flush，就和对innodb手动checkpoint一样**。`flush` api：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-flush.html

清空translog的时间点大概是：
- 手动调用`flush`；
- translog快满了；
- 一定时间定期flush：30min；

>  Shards are flushed automatically every 30 minutes.

和mysql redo log的flush时间点其实类似。

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/translog.html

### refresh vs. flush
refresh和flush是两个概念：
- **数据写入pool，就写入translog了，证明它不会丢了，只是此时还不可见**；
- **refresh操作的是buffer pool**: buffer pool -> disk cache。**数据可见了**，会清空in memory buffer，但不会清空translog;
- **flush操作的是translog**: fsync to disk，此时会清空translog；

所以es refresh之后，文档就可见了，可搜索。es flush之后，数据持久化了，translog可以删掉了。

> refresh和flush操作的是两个东西。**refresh默认1s一次，flush默认30min一次，二者没什么关联**。

### translog和redo log的区别
innodb的redo log作用于内存里的buffer pool。效果：“数据从buffer pool flush到磁盘，就相当于写到了磁盘上”，虽然实际可能只写到了page cache。

> 不保证未完成的事务一定写到磁盘上，因为redo log也有个pool，而不是直接写到磁盘上。**但如果一个语句就是一个事务**，相当于每个语句对应的redo log都写到磁盘上了（fsync），和es translog的fsync一样。

二者使用redo log/translog的理由一模一样，但在其他地方的写行为有所区别：
- **innodb不使用sync**：innodb数据写入redo log，使用的是fsync。**但是innodb不写page cache，毕竟它有buffer pool，mysql的数据都是要加载到buffer pool然后再进行增删改查的**；
- **es会使用sync**：es写translog，用的也是fsync。es写translog之前会把自己的in memory buffer写（sync）到page cache，**因为它是磁盘型数据库，数据不从in memory buffer查（不像buffer pool一样），所以es的数据要从磁盘读入**。既然内存（in memory buffer）里现在有现成的数据，不如直接写到page cache，速度更快一些，省得再从磁盘读到page cache了；

之所以不同，因为二者的pool不同：
- idb的pool是磁盘文件的cache。读写磁盘文件必须先加载到pool里，在pool里完成；
- es的pool只存储新增的数据，然后持久化到磁盘上。之后es读磁盘数据，就和这个pool无关了，用的是os的page cache做优化；

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



