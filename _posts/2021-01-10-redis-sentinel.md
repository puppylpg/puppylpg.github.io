---
layout: post
title: "Redis - Sentinel"
date: 2021-01-28 23:05:44 +0800
categories: Redis
tags: Redis
---

Sentinel要解决的问题是高可用性（Highly Availability，HA），即：一个redis倒下去，千万个redis站起来，不至于系统没有redis可用了。也就是常说的主备。当master宕机的时候，要有slave站出来扛起大旗。

> **Sentinel本质上是一个redis，不过它不执行redis的db功能**（所以它启动的时候也不需要载入AOF或者RDB文件），而是作为一个监控，**监视着一个系统里所有的其他redis（所有master + 所有slave + 其他所有sentinel）**。

1. Table of Contents, ordered
{:toc}

# 复制
一个HA系统首先要给master配一个或多个slave，slave先把master数据库中的内容同步过来，拥有和master相同的数据库。一个slave如何同步master？

## 首次同步 - SYNC
先考虑slave第一次同步master的场景。master把自己的内容全都发给slave，slave就有了master的全部内容，这是一次全量同步。

全量同步要求slave给master发一个 **SYNC命令** ：
1. master执行BGSAVE生成一个RDB文件，发送给slave；
2. master做BGSAVE需要一定的时间，而且，就像AOF rewrite一样，slave copy一份RDB里的内容，也需要一定时间，这些时间内master接收到的新命令全都放在缓冲区中，之后再发给slave；

这样slave就完全同步master了。

接下来呢？
- 简单粗暴：可以周期性像上面一样不停同步。但是如果数据库很大，这种周期性同步必然间隔不能太短。但是间隔太长，master挂了之后，slave因为长时间没同步master，内容肯定丢了很多。所以周期性同步不可取；
- 命令传播：master在第一次和slave全同步之后，接下来每次修改数据库，都把修改数据库的指令也发给slave，salve就能实时和master保持同步了，毕竟这种同步数据发送的代价很小。

> 当然也不能说第一种方式完全不可取。它还是有好处的——代码简单。在原有代码上价格周期性，基本没什么代价。第二种方式一眼看去怎么着也要再实现命令解析的功能，代码肯定是要多写点儿的。但是显然，这种方式只适合初期工期紧任务重的版本，后期就要优化成第二种。

## 断线同步
如果一个slave因为网络断线了，后来又重新连上了，应该怎么和master同步呢？

不用说，简单粗暴的情况下，把断线的slave当成初次同步的slave没什么不可以的。好处是不用新加代码。缺点也很显而易见，slave缺的是从掉线到上线这段期间master的数据，增量同步一下就行了，没必要再来个全量同步。

显然后者更优秀，但是实现更复杂：
1. 从哪里开始增量：首先得知道上次同步到哪里了，断线后才能从那里开始增量。复制偏移量**replication offset**；
2. 增哪些量：其次得知道上次同步偏移量之后的command history，就像使用AOF rewrite缓冲区记录着内容一样。复制积压缓冲区**replication backlog**；

> Redis前期正是先用了简单粗暴的方法，后期迭代中再将其优化为增量同步。

所以从Redis 2.8开始，slave可以给master发送 **PSYNC命令（partial sync）** 进行增量同步：
1. master向slave回复+CONTINUE；
2. master向slave发送掉线期间的写命令；

> **PSYNC也可以进行全量同步**。如果replication backlog设置的不够大，slave掉线太久，掉线期间的写指令backlog装不完，就得进行全量同步了。

## `REPLCONF ACK <replication_offset>`
slave每秒发送一次该指令：
1. 心跳检测：我还活着；
2. 展示同步进度：master发现slave发的offset落后，说明自己刚刚给slave发的写命令丢了，slave没收到。

# Sentinel
sentinel使用`struct sentinelState`表示自己的状态，包含：：
- `dict *masters`：sentinel监视的多个master。key为master name，value为`struct sentinelRedisInstance`；

一个Sentinel系统中有三类redis instance：
- sentinel；
- master；
- slave；

redis使用`struct sentinelRedisInstance`这一种数据结构表示三者，他们都是instance的实例。

**`sentinelRedisInstance`中的一些属性**：
- addr：是一个`struct sentinelAddr`结构，内含ip和port两个属性，标志着这个redis实例的地址；
- name；
- runid；
- down_after_period：无响应多少ms后被判断为主观下线；
- quorum：判断该实例客观下线的最小投票数；
- **`dict *slaves`：key为slave name，value自然也是sentinelRedisInstance，代表该master的所有slave**；
- **`dict *sentinels`：同上，代表监视该master的所有sentinel**；

> **有点儿像一个树状结构：SentinelState里含有各个master，每个master含有slaves和sentinels，分别保存各个redis的信息。**

## sentinel从配置解析masters信息
**sentinel从配置文件redis.conf里的配置项`SENTINEL XXX YYY`中读取所有的master配置，创建所有master实例，将配置分别set到各个master实例中。**

## sentinel通过master找到其slave
sentinel**每10s**给masters发送**INFO命令**，获取master信息。从中解析每个master的所有slave，set到master的`dict *slaves`属性里。

## sentinel从slave处获取信息
sentinel从master获取其slave后，和slave建立连接。同样**每10s**发送**INFO命令**，获取其信息。比如它的master是谁，当前replication offset到哪儿了。

## sentinel通过master/slave的订阅频道找到其他sentinel
sentinel发现新的master/slave时，会和他们建立两个连接：
- 命令连接：收发命令，比如INFO命令；
- 订阅连接：sentinel订阅master/slave的`__sentinel__:hello` channel，可以向该channel发信息，也可以从该频道收信息；

1. sentinel**每2s**向所有和它连接的redis实例（master/slave）的该频道发送一条消息：`PUBLISH __sentinel_:hello xxx`，报上自己的ip、port等，同时发送该master的相关信息；
2. 其他sentinel因为也订阅了redis实例的该channel，会收到该信息，从而知道有其他sentinel监视该系统，记录下来。记录到该消息中描述的master下的`dict *sentinels`数据结构里；
3. 发消息的sentinel因为订阅该channel的缘故，也会收到消息：
    1. 会收到自己发到这条channel里的消息，忽略掉；
    2. 会收到别的sentinel发到这条channel里的消息，从而知道有其他sentinel，记录下来。

## sentinel和sentinel建立命令连接
这样就可以直接发送命令交流了。但是不需要再创建订阅连接了，因为订阅连接的作用就是为了sentinel之间互相发现。

## sentinel连接一切
所以，在一个sentinel系统中，sentinel和万物互联：
1. sentinal从配置文件知道masters，二者建立命令连接、订阅连接；
2. sentinel从master知道slave，二者建立命令连接，订阅连接；
3. sentinel从订阅的channel获取其他sentinel，二者建立命令连接。

这样，所有的sentinel和所有的master以及master的slave都互联起来了。

> 只是所有的sentinel和任意master、任意slave、任意sentinel都连起来了，master之间不互联，master只和自己的slave连接，slave之间不互联。

# redis下线
sentinel每1s向所有master、slave、sentinel发送PING命令，如果连续down_after_milliseconds内没收到有效回复：
- 主观下线：该实例下线了；
- 客观下线：如果客观下线的是master，sentinel问问其他sentinel该master是否下线了，达到quorum个都这么认为，则该master和master对应的slave都被标记为客观下线。对master进行故障转移；

**客观下线是指，大家都觉得你挂了**。紧接着sentinel们会帮他们选个新的master，再带领他们一起上线。

# 翻身农奴把歌唱
sentinel会投票选一个slave（姑且认为随机选得了），给它发送`SLAVEOF no one`，他就变成master了。

# 订阅发布
## 订阅退订
redis支持订阅发布功能：client可以订阅redis的一个channel，当redis的该channel收到消息后，会向所有订阅该channel的client发送消息。

订阅的实现其实很简单：
1. client向redis订阅某channel；
2. redis创建一个 **`dict *pubsub_channels`**，以channel为key，clients为value，记录下订阅该channel的所有client。可用链表保存所有client；

- SUBSCRIBE：向redis注册一条订阅信息，也就是从dict里找到channel，给它的value加个节点，记下该client；
- UNSUBSCRIBE：从链表里删掉这个client即可；

redis还支持**模糊订阅**，用类似通配符的规则，一次性给client订阅所有满足条件的channel。redis的实现也相当粗暴：
1. 再搞一个 **`list *pubsub_patterns`**，专门保存模糊订阅；
2. 每个节点代表一个client和它的模糊订阅字符串；

- PSUBSCRIBE：pattern subscribe，给链表加个节点即可；
- PUNSUBSCRIBE：从链表删掉节点；

## 发布
因为保存订阅信息分散在两个属性里，当某channel收到消息，发布的时候也要访问两个属性：
1. pubsub_channels dict里找出该channel对应的value，遍历所有的client，把消息发给他们即可；
2. 遍历pubsub_patterns链表，看每一个节点记录的模糊channel和该channel是否匹配，匹配就发给它对应的节点；

- PUBLISH：向某channel发布一条信息；

还有一个查看当前频道信息的命令PUBSUB：
- PUBSUB CHANNELS <pattern>：pattern可选，返回全部或者符合pattern的channel；
- PUBSUB NUMSUB <channel1,2,...>：这些channel总共有多少订阅者；
