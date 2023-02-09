---
layout: post
title: "Redis - cluster"
date: 2021-01-31 18:32:07 +0800
categories: Redis
tags: Redis
---

一台机器的内存是有限的，在上面部署的redis能存储的内容自然也是有限的。如果内容过多，只能使用分布式数据库，将内容分摊到一堆redis里，这就是redis集群。

> Sentinel也是一堆redis，但那是为了高可用搞的主备，不同的redis保存的内容是相同的。和分布式集群不是一个东西。

1. Table of Contents, ordered
{:toc}

# node
集群是由一堆节点组成的。什么样的redis才能成为集群的节点？

## 节点模式
**节点必须是运行集群模式的redis，由redis.conf里的`cluster-enabled yes`指定**。

## 节点启动
建议创建不同的文件夹，保存不同redis节点的配置，然后**分别从各自的文件夹启动redis**。这个“分别从自己的目录下启动”很重要，因为启动的时候redis会在current working directory生成一些额外的文件，比如`nodes.conf`记录当前集群的节点都有哪些。

比如：
```
win-pichu@DESKTOP-T467619 ~/Utils/redis/redis-6.0.9/confs $ tree
.
└── cluster
    ├── 2222
    │   ├── appendonly.aof
    │   ├── nodes.conf
    │   └── redis.conf
    └── 2223
        ├── appendonly.aof
        ├── nodes.conf
        └── redis.conf

3 directories, 6 files
```
其中`nodes.conf`和`appendonly.aof`分别是开启了cluster mode和aof持久化之后生成的文件。

所以，如果启动完一台redis后还要在当前目录下启动redis，redis会发现当前目录已经存在`nodes.conf`等文件，将报错：`Sorry, the cluster configuration file nodes.conf is already used by a different Redis Cluster node. Please make sure that different nodes use different cluster configuration files.`

## 节点连接
client使用`-c`选项以cluster模式连上一台集群模式的redis，发送 **`CLUSTER MEET <host> <port>`**，就可以让改redis联合host:port指定的redis，组成一个两个节点的cluster。

> 我试了不用`-c`启动client貌似也没关系。cluster的功能也能用。**但是这种模式的client识别不了server返回的MOVED等指令**。

redis server本身要开启cluster-enabled，否则不能识别cluster指令：
```
127.0.0.1:6379> cluster meet 127.0.0.1 1111
(error) ERR This instance has cluster support disabled
```

**`CLUSTER NODES`** 可以显示cluster的所有node，其实就是`node.conf`里的内容。

# cluster数据结构
redis集群使用`struct clusterState`表示，属性包括：
- **`dict *nodes`：集群里所有的节点，key为节点name，value为`clusterNode`**；
- `clusterNode *myself`：只想自己的指针。毕竟每个集群节点都记录了所有的clusterNode，得知道哪个是自己；
- size：至少还处理着一个slot的节点，即逻辑上活着的节点；


redis cluster使用`struct clusterNode`表示节点状态：
- name；
- ctime：create time；
- ip；
- port；
- **char slots[2^14/8]：每个bit代表一个slot，1代表分配给了该node**；
- `clusterLink *link`：该节点的连接信息：
    + int fd：tcp socket描述符；
    + sds sndbuf：send buffer；
    + sds rcvbuf：receive buffer；
    + `clusterNode *node`：与该节点连接的节点（数组）；

> redis server可能保存有redisClient类型，里面也有缓冲区、fd等，是和client交互用的；redis server在cluster mode下可能保存有clusterNode.clusterLink，里面的缓冲区、fd等是和其他node交互用的。

**和sentinel对比一下，整个数据结构还是挺像的。state是总体，都有一个dict存着所有的node/instance。**

# slot
slot是cluster的核心。涉及到：
- slot分配；
- 分片sharding；
- slot转移；

redis cluster的数据库分为2^14个slot。key分配到哪个slot里类似hash（ **但其实用的CRC而不是hash** ），不过是一种桶恒为2^14的hash。这也就意味着，不存在rehash的情况。当需要调整slot到不同node的时候，直接整个slot搬过去就行了。

和通常hashmap相比优缺点：
- 优点：**不需要rehash，因为桶总数恒定**；
- 缺点：很容易算出key所在的桶，但，**桶在哪个node里**？

redis cluster必须对全部2^14个slot都在处理，否则该cluster不可用。（都缺了一块数据了，自然不可用。）

## ADDSLOTS
**`CLUSTER ADDSLOTS <slot1,2,...>`**，给server指派新的slot。

> slot使用空格分隔，连续的slot，中间可以用`...`省略。

**只有2^14全都分配完毕了，整个cluster才正常上线**。可以使用**`CLUSTER INFO`**查看集群status。使用CLUSTER NODES查看各个node绑定的slot情况。

## 数据结构
clusterNode里有：
- char slots[2^14/8]：每个bit代表一个slot，1代表分配给了该node；

> c这么声明bit array的？

clusterState则记录整个集群slot的分配情况：
- **`clusterNode *slots[2^14]`：指针数组，每个位置是一个指针，指向保存这个slot的node**；

有了这两个属性，无论是根据node查slot，还是根据slot查node，都可以做到O(1)复杂度查询：空间换时间呀！

## 寻找slot
有了上述数据结构，寻找slot在哪个node里就很简单了。

首先，计算key所在的桶，**`CLUSTER KEYSLOT <key>`**，实现是`crc16(key) & 2^14`，不是hash。

redis server收到一条命令：
1. 如果slot就在自己里面，直接操作；
2. 否则返回：**`MOVED <slot> <ip:port>`**，代表取那个ip:port，slot在那里；

**不使用cluster模式（`-c`）启动的client识别不了该命令。会直接输出该命令，而不是重定向**。

## `CLUSTER GETKEYSINSLOT <slot> <count>`
返回某个slot最多count个key。

实现：每一个kv对除了存进了db，是一个dict。此外，这些kv还存进了一个`zskiplist *slots_to_keys`，跳表的score（节点的value）是slot number，节点的key是要存储的key。相当于对整个db存的key按照slot number从小到大排了个序。

> 涉及dict的range操作，redis就用跳表先排序。和zset的实现一个套路。

## sharding
**因为桶的个数是恒定的，redis的sharding操作要比rehash简单多了**，只要把slot从一个节点挪到另一个就行了。

sharding是需要过程的。如果sharding一个slot的过程中，对该slot的请求来了，该redis找不到对应的key，有可能是挪到dst redis上了。所以redis会返回**`ASK <slot> <ip:port>`**，让client问问dst redis是不是在它上面。

ASK和MOVED格式一样：
- MOVED指的是slot不在我这儿，在别人那儿，你move到那里执行吧；
- ASK指的是我也不知道这个slot的这个key我是不是已经挪过去了，你ask一下它吧。

**dst slot正在接收slot的过程中，来了对应key的指令怎么办**？
- **正在挪到我这里的slot，不是我的slot**，所以返回MOVED；
- 除非指令带有ASK，说明是src redis让client过来的，那我就从正在导入的slot的查查有没有这个key；

redis怎么知道自己是不是在sharding？因为sharding过程中，redis会在clusterState里记录当前正在迁移的slot。

> redis知道的事情多，因为它创建的数据结构多呀。

# HA
cluster有主备，这点有点儿像sentinel了。所以也存在master和slave。

cluster使用clusterNode表示instance，所以它里面有：
- `clusterNode *slaveof`：如果我是slave，我要指向我的master；
- `clusterNode **slaves`：指针数组，如果我是master，我要指向我所有的slave；

如果master挂了，slave会取代它成为slave。类似sentinel，由其他master投票，得票最多的slave变为master。

