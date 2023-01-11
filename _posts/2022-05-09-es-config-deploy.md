---
layout: post
title: "Elasticsearch：配置部署"
date: 2022-05-09 02:06:38 +0800
categories: elasticsearch
tags: elasticsearch
---

集群的配置和部署相关信息。

1. Table of Contents, ordered
{:toc}

# 集群
状态：
- green：shard全都分配了；
- yellow：有没分配的replica shard；
- red：有宕机的master shard；

Ref：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/cluster-health.html
- 分片：https://www.elastic.co/guide/cn/elasticsearch/guide/current/_add-an-index.html

## 配置

es的配置主要分为dynamic和static：
- dynamic：**可以在运行时直接修改的配置（不停机）**。这种配置修改起来非常便利，**而且也可以持久化到配置文件里**；
- static：只能停机把配置写到配置文件里；

dynamic无疑使非常便利的，但是可能考虑到一些安全问题，并不是所有的配置都是dynamic。比如[`reindex.remote.whitelist`](hhttps://www.elastic.co/guide/en/elasticsearch/reference/7.17/docs-reindex.html#reindex-from-remote)，因为安全问题所以[故意不搞成dynamic](https://github.com/elastic/elasticsearch/issues/29153)。

> 便利和安全需要相互妥协。

**dynamic即使是运行时修改，也依然可以选择配置是临时的（transient setting）还是持久化（persistent setting）的**。如果相同的配置出现在多处，有以下优先级：
1. Transient setting
2. Persistent setting
3. `elasticsearch.yml` setting
4. Default setting value

总体来说，es支持的配置行为还是非常便利多样的。

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
es node可以有很多角色：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html

比较重要的：
- data：保存分片，处理增删改查请求；
    + https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#data-node
- master：管理集群，处理集群范围的行为。比如集群有哪些node、创建删除索引、分片应该怎么分配；
    + https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#master-node
- voting_only：能像master一样投票但不能称为master，**主要作为选举过程中的tiebreaker**。voting_only必须和mster role一起使用；
    + https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#voting-only-node

> **High availability (HA) clusters require at least three master-eligible nodes, at least two of which are not voting-only nodes**. Such a cluster will be able to elect a master node even if one of the nodes fails.

协调节点coordinating node：收到请求的节点被称为协调节点，要做两件事：
1. scatter：把请求分散到各个data node上，查数据；
2. gather：把各节点查到的数据汇聚成一个最终的结果；

**任何节点都是协调节点**！所以如果一个节点的role为空`node.roles: [ ]`，它就是一个纯协调节点。纯协调节点的好处是专门维护和客户端之间的请求，可以让其他节点纯处理搜索分片的事情，所以一定程度上能提高集群吞吐。
+ https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#coordinating-node
+ https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#coordinating-only-node

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
