---
layout: post
title: "Elasticsearch：集群配置"
date: 2022-05-09 02:06:38 +0800
categories: elasticsearch
tags: elasticsearch
---

集群的配置和部署相关信息。

1. Table of Contents, ordered
{:toc}

# 集群状态
[健康度](https://www.elastic.co/guide/cn/elasticsearch/guide/current/cluster-health.html)简单用三种颜色表示：
- green：shard全都分配了；
- yellow：有没分配的replica shard；
- red：有宕机的master shard；

# 启动/关闭
启动前要[设置一下`vm.max_map_count`](https://stackoverflow.com/a/51448773/7676237)，否则会启动失败：

> max virtual memory areas vm.max_map_count [131072] is too low, increase to at least [262144]

elasticsearch一般使用detach（`-d`）的方式[启动](https://www.elastic.co/guide/en/elasticsearch/reference/current/starting-elasticsearch.html)，可以顺带保留pid（`-p`）到文件内：
```
./bin/elasticsearch -d -p pid
```

也可以自定义heap size：
```
ES_JAVA_OPTS="-Xms32g -Xmx32g" ./bin/elasticsearch -d -p pid
```
如果想持久化jvm配置，**也可以把jvm参数放到`config/jvm.options`里**。

[关闭](https://www.elastic.co/guide/en/elasticsearch/reference/current/stopping-elasticsearch.html)elasticsearch更简单，直接kill pid就行。

> 也可以使用`jps`或者`ps`查看pid。

## 停用节点decommission - 没有副本时
**如果没有副本，又要重启节点**，为了数据不停机，可以手动停用节点，让它的shard数据分配到别的节点：

- [`cluster.routing.allocation`](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-cluster.html#cluster-routing-settings)
    - `exclude`:
        - `_ip`：逗号分隔
        - `_name`

如果只是重启节点，没必要先停用节点，这样会导致分片先分配出去，再分配回来，在集群数据比较大的情况下，非常耗时。**当然前提是必须有副本**。

比如取消exclude name的设置：
```json
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.exclude._name" : null
  }
}
```

## 重启节点 - 有副本时

**如果数据存在副本，就可以先设置不要在集群宕机之后重新分配shard**，因为马上就重启回来了。

> 但是如果不存在副本，为了数据不宕机，还是需要先通过decommission的方式重启节点。

- [`cluster.routing.allocation`](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-cluster.html#cluster-shard-allocation-settings)
    - `enable`
        + `none`：停止shard分配。**如果master凉了，replica就会变成master。如果replica凉了，也不会重新分配replica，只是整个集群变成yellow**；
        + `all`：启用shard分配；

> 升级集群其实相当于轮流重启节点。

比如设置禁止分片分配：
```json
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable" : "none"
  }
}
```

# 配置的种类
elasticsearch的[配置](https://www.elastic.co/guide/en/elasticsearch/reference/current/settings.html)主要分为[dynamic和static](https://www.elastic.co/guide/en/elasticsearch/reference/current/settings.html#cluster-setting-types)：
- dynamic：**可以在运行时直接修改的配置（不停机）**。这种配置修改起来非常便利，**而且也可以持久化到配置文件里**；
- static：只能把配置写到配置文件里，重启才能生效；

dynamic无疑使非常便利的，但是可能考虑到一些安全问题，并不是所有的配置都是dynamic。比如[`reindex.remote.whitelist`](hhttps://www.elastic.co/guide/en/elasticsearch/reference/7.17/docs-reindex.html#reindex-from-remote)，因为安全问题所以[故意不搞成dynamic](https://github.com/elastic/elasticsearch/issues/29153)。

> 便利和安全需要相互妥协。

**即便只在运行时修改dynamic配置，也依然可以选择配置是临时的（transient setting）还是持久化（persistent setting）的**：

> Updates made using the cluster update settings API can be persistent, which apply across cluster restarts, or transient, which reset after a cluster restart. **You can also reset transient or persistent settings by assigning them a null value using the API.**

elasticsearch不建议使用transient配置，可能会不稳定，另外迁移集群的时候也不能忘了[迁移transient配置](https://www.elastic.co/guide/en/elasticsearch/reference/current/transient-settings-migration-guide.html)。所以如果决定长期用下去，记得把transient编程persistent。

如果相同的配置出现在多处，有以下**优先级**：
1. Transient setting
2. Persistent setting
3. `elasticsearch.yml` setting
4. Default setting value

通过[update setting api](https://www.elastic.co/guide/en/elasticsearch/reference/current/cluster-update-settings.html)设置：
```json
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable" : "none"
  }
}
```

通过[get setting api](https://www.elastic.co/guide/en/elasticsearch/reference/current/cluster-get-settings.html)查看设置：
```
GET _cluster/settings
```
结果示例：
```json
{
  "persistent" : {
    "xpack" : {
      "monitoring" : {
        "collection" : {
          "enabled" : "true"
        },
        "history" : {
          "duration" : "30d"
        }
      }
    }
  },
  "transient" : {
    "cluster" : {
      "routing" : {
        "allocation" : {
          "enable" : "none"
        }
      }
    }
  }
}
```

> 这里设置了监控保留最近30天的history信息。[但是很遗憾并无卵用](https://discuss.elastic.co/t/xpack-monitoring-history-duration-with-a-value-other-than-7d-does-not-work/238134/2?u=puppylpg)，不掏钱的话依旧只能保留7天……

# 集群配置

主要是配置集群节点之间的相互发现。

[默认在development模式下，elasticsearch会尝试在本地自动寻找其他节点组建集群](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/modules-discovery-bootstrap-cluster.html#_auto_bootstrapping_in_development_mode)：
> If the cluster is running with a completely default configuration then it will automatically bootstrap a cluster based on the nodes that could be discovered to be running on the same host within a short time after startup. This means that by default it is possible to start up several nodes on a single machine and have them automatically form a cluster which is very useful for development environments and experimentation. However, since nodes may not always successfully discover each other quickly enough this automatic bootstrapping cannot be relied upon and cannot be used in production deployments.

但是仅存在于一台机器上的集群并不具备容灾功能，不符合production部署规范，所以还是需要自己配置集群节点之间的相互发现。

## [节点](node：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html)
节点之间有以下相互发现的方法：
- 单播：**按图索骥**——只寻找配置文件里写了的小伙伴。大家认识的小伙伴的并集就是整个集群；
- ~~多播：**河东狮吼**——有木有name=xxx的集群，有的话带我一个。很方便，但是生产环境一般不用~~；

[多播已经废弃了](https://discuss.elastic.co/t/how-to-discover-elasticsearch-nodes-via-multicast/54006/2?u=puppylpg)。

## 集群名称
设置[`cluster.name`](https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#cluster-name):

> A node **can only join a cluster when it shares its `cluster.name` with all the other nodes in the cluster. The default name is `elasticsearch`**.

因为默认大家都叫`elasticsearch`，**所以在生产环境使用默认配置，且使用广播发现节点，可能别人起的node会不小心加入集群，这就比较离谱**。

## 节点名称
设置[`node.name`](https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#node-name)，有名字才好认。**默认节点名称为机器的hostname**。

## 节点ip
**默认只绑定到localhost，所以想节点发现必须绑到公有ip上**。使用[`network.host`](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/important-settings.html#network.host)配置。

一旦设置了这个选项，[elasticsearch会认为部署在生产环境](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/system-config.html#dev-vs-prod)：

> When you provide a value for `network.host`, Elasticsearch assumes that you are moving from development mode to production mode。

如果设置成机器ip，不具备可移植性，所以elasticsearch提供了[一些特殊值](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-network.html#network-interface-values):
- `_local_`：相当于localhost
- `_site_`：节点都在同一个子网中，则应该使用`_site_`
- `_global_`：节点在多个子网中或需要从外部访问，则应该使用`_global_`
- `_[networkInterface]_`：网卡名。比如`_en0_`
- `0.0.0.0`：比`_global_`少绑定了了ipv6

使用示例：
```
network.host: [ "_site_" ]
network.host: "_site_"
network.host: _site_
```

## 节点发现
如前所述，[development模式下的节点发现](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/important-settings.html#discovery-settings)是默认开启的：
1. 如果同一台机器启动多个elasticsearch，通信端口会从9300开始，依次增加；
2. 因此，**每一个elasticsearch在不配置节点发现的情况下，会默认寻找本机9300-9305有没有其他节点，有的话就组成集群**；

所以探测集群是默认行为。

> Out of the box, without any network configuration, Elasticsearch will bind to the available loopback addresses and scan local ports 9300 to 9305 to connect with other nodes running on the same server. This behavior provides an auto-clustering experience without having to do any configuration.

如果想和其他机器上的节点组集群，**就要设置一些初始seed，作为本节点的初始哥们儿，同时哥们儿的哥们儿也是我的哥们儿，大家就全都成了一个集群**。

可以通过[`discovery.seed_hosts`](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/important-settings.html#unicast.hosts)设置初始seed，格式为yaml sequence或array：
```
discovery.seed_hosts:
   - 192.168.1.10:9300
   - 192.168.1.11 
   - seeds.mydomain.com 
   - [0:0:0:0:0:ffff:c0a8:10c]:9301
```
可以用ip、hostname、甚至domain。因为这是一个static配置，所以需要重启节点才能生效，**因此通过DNS配置domain才是比较合理的选择**。

> ip的端口如果不指定，默认是9300。**如果该节点不存在，也无所谓**。

除了直接指定ip，还可以[增加一个中间层，provider](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/modules-discovery-hosts-providers.html#built-in-hosts-providers)，由provider产生ip，以此实现配置解耦。这样的话**在不重新配置该static配置（需要重启elasticsearch）的情况下也能做节点变更**。

> **DNS本身就像是一个中间层！如果`seed_hosts`使用了DNS，就不需要配置provider了！**

[最简单的provider可以是一个文件](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/modules-discovery-hosts-providers.html#built-in-hosts-providers)：
```
discovery.seed_providers: file
```
然后就可以**在`$ES_PATH_CONF/unicast_hosts.txt`里配置seed**：
```
10.10.10.5
10.10.10.6:9305
10.10.10.5:10005
# an IPv6 address
[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:9301
```
**该文件可以动态修改，无需重启elasticsearch。**

如果设置provider的同时还设置了`discovery.seed_hosts`，二者会**取并集**。

> 有趣的是，虽然[elasticserch 7已经弃用`discovery.zen.ping.unicast.hosts`](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/breaking-changes-7.0.html#_discovery_configuration_is_required_in_production)，但是看`discovery.seed_hosts`的url，还是`#unicast.hosts`。而且上面的配置文件也叫`unicast_hosts.txt`，所以它其实是在废弃multicast之后，隐匿了unicast的概念。

## 初始master
[`cluster.initial_master_nodes`](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/important-settings.html#initial_master_nodes)，算了别设置了。

## master选举

[master选举](https://www.elastic.co/guide/en/elasticsearch/reference/7.12/modules-discovery-quorums.html)是一个自动的过程。在7之前，elasticsearch通过设置`minimum_master_nodes`大于半数节点，来防止脑裂（split brain），形成两个集群各自独立运行。但是这样的话每个节点都要配置这个值，而且节点增减之后也不能忘了修改。所以[在7中这个配置项被废弃了](https://discuss.elastic.co/t/removal-of-discovery-zen-minimum-master-nodes/179263)，由elasticsearch[自己决定哪个节点可以用来组成quorum](https://www.elastic.co/blog/a-new-era-for-cluster-coordination-in-elasticsearch)。

> The minimum_master_nodes setting is removed in favour of allowing Elasticsearch itself to choose which nodes can form a quorum.

## role
elasticsearch的node可以有很多[角色](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html)，比较重要的有：
- [`data`](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#data-node)：保存分片，处理增删改查请求；
- [`master`](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#master-node)：管理集群，处理集群范围的行为。比如集群有哪些node、创建删除索引、分片应该怎么分配；
- [`voting_only`](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#voting-only-node)：能像master一样投票但不能称为master，**主要作为选举过程中的tiebreaker**。voting_only必须和mster role一起使用；

> **High availability (HA) clusters require at least three master-eligible nodes, at least two of which are not voting-only nodes**. Such a cluster will be able to elect a master node even if one of the nodes fails.

协调节点coordinating node：收到请求的节点被称为协调节点，要做两件事：
1. scatter：把请求分散到各个data node上，查数据；
2. gather：把各节点查到的数据汇聚成一个最终的结果；

**任何节点都是[协调节点](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#coordinating-node)**！所以如果一个节点的role为空`node.roles: [ ]`，它就是一个[纯协调节点](https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html#coordinating-only-node)。纯协调节点的好处是专门维护和客户端之间的请求，可以让其他节点纯处理搜索分片的事情，所以一定程度上能提高集群吞吐。

# 数据存储位置
elasticsearch存放数据的位置：
- 如果通过linux包管理器安装：`/var/data/elasticsearch`；
- 如果**通过zip安装：`$ES_HOME/data`**；

> 不要试图动data文件夹。不要备份data文件夹，没法直接恢复，需要使用elasticsearch的snapshot和resotre功能。

**可以在配置里设置data path: [`path.data`](https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#path-settings)，也可以设置[多个路径](https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html#_multiple_data_paths)**。

# 高可用
- https://www.elastic.co/guide/en/elasticsearch/reference/7.12/high-availability-cluster-design.html

# 节点迁移实例
假设每个索引都存在副本，就可以直接下掉节点。**同时使用禁止分片分配，加快分片恢复速度**。

## 禁止分片分配
设置禁止分片分配：
```json
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable" : "none"
  }
}
```
吃瓜节点（nodeC）的相关log：
```
[2023-04-03T15:01:06,331][INFO ][o.e.c.s.ClusterSettings  ] [nodeC] updating [cluster.routing.allocation.enable] from [all] to [none]
[2023-04-03T15:01:06,331][INFO ][o.e.c.s.ClusterSettings  ] [nodeC] updating [cluster.routing.allocation.enable] from [all] to [none]
```

## 停机
然后给旧节点（nodeA）停机。此时cluster state为yellow，下掉的主分片对应的副本会转正，但是会缺少副本，所以是yellow。

nodeA的相关log：
```
[2023-04-03T15:03:42,313][INFO ][o.e.n.Node               ] [nodeA] stopping ...
[2023-04-03T15:03:42,333][INFO ][o.e.x.w.WatcherService   ] [nodeA] stopping watch service, reason [shutdown initiated]
[2023-04-03T15:03:42,334][INFO ][o.e.x.m.p.l.CppLogMessageHandler] [nodeA] [controller/42927] [Main.cc@169] ML controller exiting
[2023-04-03T15:03:42,334][INFO ][o.e.x.w.WatcherLifeCycleService] [nodeA] watcher has stopped and shutdown
[2023-04-03T15:03:42,343][INFO ][o.e.x.m.p.NativeController] [nodeA] Native controller process has stopped - no new native processes can be started
[2023-04-03T15:03:42,412][INFO ][o.e.c.c.Coordinator      ] [nodeA] master node [{nodeM}{86WG7aelQzOnoCZLOBy3sw}{yl4LmPWZTheYSGF6EK-hsQ}{10.105.132.30}{10.105.132.30:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true}] failed, restarting discovery
org.elasticsearch.transport.NodeDisconnectedException: [nodeM][10.105.132.30:9300][disconnected] disconnected
[2023-04-03T15:03:48,535][INFO ][o.e.n.Node               ] [nodeA] stopped
[2023-04-03T15:03:48,535][INFO ][o.e.n.Node               ] [nodeA] closing ...
[2023-04-03T15:03:48,554][INFO ][o.e.n.Node               ] [nodeA] closed
```

吃瓜节点的相关log，先是发现一个节点（nodeA）没了，消息来自master（nodeM）：
{% raw %}
```
[2023-04-03T15:03:42,505][INFO ][o.e.c.s.ClusterApplierService] [nodeC] removed {{nodeA}{IfvgMjsHRCqS4MKQiZ6naQ}{kA-_4F3DRTWElSlUUZbhqQ}{10.105.132.120}{10.105.132.120:9300}{cdfhilmrstw}{ml.machine_memory=609641574400, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true}}, term: 18, version: 69262, reason: ApplyCommitRequest{term=18, version=69262, sourceNode={nodeM}{86WG7aelQzOnoCZLOBy3sw}{yl4LmPWZTheYSGF6EK-hsQ}{10.105.132.30}{10.105.132.30:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true}}
```
{% endraw %}
然后把自己相关的索引replica分片变成主分片：
```
[2023-04-03T15:03:42,534][INFO ][o.e.i.s.IndexShard       ] [nodeC] [index1][5] primary-replica resync completed with 0 operations
[2023-04-03T15:03:42,535][INFO ][o.e.i.s.IndexShard       ] [nodeC] [index2][0] primary-replica resync completed with 0 operations
[2023-04-03T15:03:42,607][INFO ][o.e.i.s.IndexShard       ] [nodeC] [index3][14] primary-replica resync completed with 296 operations
```

## 新节点
把旧节点所有数据copy到新节点所在的机器，可能要修改配置：
- `node.name`：如果本身就是`node1`这种和机器无关的名称，无需修改；
- `network.host`：如果用了`_site_`等非ip、hostname的值，无需修改；
- `discovery.seed_hosts`：如果用了DNS，无需修改；

新节点启动elasticsearch。

{% raw %}
吃瓜节点的相关log，发现一个新的node（nodeB）加入，消息同样来自master：
```
[2023-04-03T15:53:36,617][INFO ][o.e.c.s.ClusterApplierService] [nodeC] added {{nodeB}{IfvgMjsHRCqS4MKQiZ6naQ}{h0JTe5CsQe6wORb3kQ6rYQ}{10.105.132.124}{10.105.132.124:9300}{cdfhilmrstw}{ml.machine_memory=135211626496, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34071904256, transform.node=true}}, term: 18, version: 69281, reason: ApplyCommitRequest{term=18, version=69281, sourceNode={nodeM}{86WG7aelQzOnoCZLOBy3sw}{yl4LmPWZTheYSGF6EK-hsQ}{10.105.132.30}{10.105.132.30:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true}}
```
{% endraw %}

## 允许分片分配
开启分片分配：
```json
PUT /_cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable" : null
  }
}
```

吃瓜节点的相关log：
```
[2023-04-03T15:54:37,036][INFO ][o.e.c.s.ClusterSettings  ] [nodeC] updating [cluster.routing.allocation.enable] from [none] to [all]
[2023-04-03T15:54:37,036][INFO ][o.e.c.s.ClusterSettings  ] [nodeC] updating [cluster.routing.allocation.enable] from [none] to [all]
```

新节点上的数据会直接恢复，并同步下线期间的translog。所有分片同步完translog后，都会变成replica。cluster state重新变为green。

{% raw %}
新节点（nodeB）的相关log：
```
[2023-04-03T15:53:36,729][INFO ][o.e.c.s.ClusterApplierService] [nodeB] master node changed {previous [], current [{nodeM}{86WG7aelQzOnoCZLOBy3sw}{yl4LmPWZTheYSGF6EK-hsQ}{10.105.132.30}{10.105.132.30:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true}]}, added {{nodeD}{5hXjsmQiR6ad5w_feDNAaw}{MHvS3YF8RPuAQrYKGtYXbw}{10.105.132.121}{10.105.132.121:9300}{cdfhilmrstw}{ml.machine_memory=609639878656, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34071904256, transform.node=true},{nodeD}{tdKN6CHeRpmZxNd-sgLLpQ}{nVdtFXayTu206cqv43Di3A}{10.105.132.33}{10.105.132.33:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true},{nodeF}{d8UzAE-DTIOxRMR81OWmQg}{pe3V7E70RQSKtXDtxMkSaA}{10.105.132.32}{10.105.132.32:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true},{nodeM}{86WG7aelQzOnoCZLOBy3sw}{yl4LmPWZTheYSGF6EK-hsQ}{10.105.132.30}{10.105.132.30:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true},{nodeC}{ekqiqzAzSaavjYE-TnNtYA}{3MX6YkY_SKaERocVWDl1dw}{10.105.132.34}{10.105.132.34:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true}}, term: 18, version: 69281, reason: ApplyCommitRequest{term=18, version=69281, sourceNode={nodeM}{86WG7aelQzOnoCZLOBy3sw}{yl4LmPWZTheYSGF6EK-hsQ}{10.105.132.30}{10.105.132.30:9300}{cdfhilmrstw}{ml.machine_memory=135211630592, ml.max_open_jobs=20, xpack.installed=true, ml.max_jvm_size=34115485696, transform.node=true}}
```
现在的6个节点是B/C/D/E/F/M，没有了nodeA。
{% endraw %}

## 更新DNS
迁移完记得修改一下DNS，删掉旧节点ip，加入新节点ip。

