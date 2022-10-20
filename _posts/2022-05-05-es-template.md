---
layout: post
title: "Elasticsearch：default index template"
date: 2022-05-05 16:10:07 +0800
categories: elasticsearch
tags: elasticsearch
---

从实际遇到的问题，介绍一下索引的模板和默认模板。

1. Table of Contents, ordered
{:toc}

# 问题
kibana对es的监控没了。We couldn't activate monitoring index pattern

# 监控方案
当前用的第一种（比较简单，但官方已经不推荐）的监控方式：
- https://www.cnblogs.com/h--d/p/13192992.html

整体流程是：kibana向es发出查询请求，查询es状态，并把es的监控信息写入es保存起来。所以kibana先查es，再写es。

# 定位错误
查看es log，发现报错：
```
[2022-04-22T08:00:02,012][WARN ][o.e.x.m.e.l.LocalExporter] [node-1] unexpected error while indexing monitoring document
org.elasticsearch.xpack.monitoring.exporter.ExportException: StrictDynamicMappingException[mapping set to strict, dynamic introduction of [threads] within [node_stats.thread_pool.write] is not allowed]
 
 ...
 
Caused by: org.elasticsearch.index.mapper.StrictDynamicMappingException: mapping set to strict, dynamic introduction of [threads] within [node_stats.thread_pool.write] is not allowed
```

看报错信息，写es失败：`node_stats.thread_pool.write`这个filed接收不了threads这个子field。因为索引的dynamic=strict，所以不能接受未定义field。

> - 参考dynamic的定义：https://www.elastic.co/guide/en/elasticsearch/reference/current/dynamic.html#dynamic-parameters

但是从log看不出来是哪个index报的错。盲猜是monitor相关的index。

也就是以`.`开头的index：
```
GET _cat/indices/.*

green open .kibana-event-log-7.12.0-000007     pYjt4MgrSPy1YvCDQP8lgg 15 1      0      0     6kb     3kb
green open .kibana_7.12.0_001                  odCf50ggSSOzM52FY7f7Lw  1 1    412     32   6.6mb   4.3mb
green open .kibana_task_manager_7.12.0_001     45EEFmERRLyshiC0KxvnkA  1 1      9  30051   8.3mb   3.1mb
green open .ds-ilm-history-5-2022.03.29-000010 ZjP3E_YpQmmkwpZa_5NAIQ  1 1     15      0  80.8kb  40.4kb
green open .apm-custom-link                    p4rqdwq9RCaAusBCIwLBcw 15 1      0      0     6kb     3kb
green open .kibana-event-log-7.12.0-000008     SDcnREHNRPa_92EXST212A 15 1      0      0     6kb     3kb
green open .monitoring-es-7-2022.04.18         gUb-MtnLRKGpkfZZu4Ni9Q  1 1 652609 283754   1.1gb 566.2mb
green open .kibana-event-log-7.12.0-000009     kzkTb2U3TWqk0xlVYFmESg 15 1      0      0     6kb     3kb
green open .monitoring-es-7-2022.04.17         TjNhpGcISGm6zJlnRXRpFg  1 1 558972 344514     1gb 553.5mb
green open .monitoring-es-7-2022.04.16         qEqLQG-hQgOzNLUTBP3a5Q  1 1 534334 329945     1gb 547.1mb
green open .ds-ilm-history-5-2022.02.27-000009 H80_LpWjRqmgLoHcW6kfbg  1 1     22      0 102.6kb  51.3kb
green open .monitoring-kibana-7-2022.04.16     frNQLa6WSheyKDQI2Of_XA  1 1  17278      0   6.3mb   3.1mb
green open .monitoring-kibana-7-2022.04.18     -pAUY81cS6-9oPoDdeCUTw  1 1  17264      0   6.5mb   3.2mb
green open .monitoring-kibana-7-2022.04.17     p8qay42gSQ23h1Jx_ray-g  1 1  17280      0   6.3mb   3.1mb
green open .monitoring-kibana-7-2022.04.19     _69KXenXRRWWZWly12Eu0w  1 1  17280      0   6.2mb   3.1mb
green open .kibana-event-log-7.12.0-000010     illzSe9DQLOlnu4d9gifQg 15 1      8      0    93kb  46.5kb
green open .apm-agent-configuration            iMRPVgorT7yV7j_vGsGQQw 15 1      0      0     6kb     3kb
green open .ds-ilm-history-5-2022.01.28-000008 t528VjuXQVKQlxzEhZkGwA  1 1     22      0  83.4kb  41.7kb
green open .monitoring-es-7-2022.04.19         noY84MlnQW64xH-E9u4hCQ  1 1 658669   2526     1gb 561.3mb
green open .ds-ilm-history-5-2021.12.29-000007 3Lrv-0owRnSJ0-u9Prn9xg  1 1     24      0 117.8kb  58.9kb
green open .tasks                              FEoqLC12TK-PKdGVxHhFKA  1 1     63      0 176.8kb  84.8kb
green open .monitoring-es-7-2022.04.22         uuIo5HeBQGKv0L2rel1EEQ 15 1  18060 228004  79.4mb  39.8mb
green open .monitoring-kibana-7-2022.04.21     YEDA39V2TN6_j4hEH0tUCQ  1 1   5242      0   2.1mb     1mb
green open .monitoring-kibana-7-2022.04.20     cNNSYaifTDSC1xmY0yZhrQ  1 1  17278      0   6.2mb   3.1mb
green open .monitoring-kibana-7-2022.04.22     e5kmnwW6SLKQswyoNeM1uQ 15 1    484      0   3.3mb   1.6mb
green open .async-search                       cIYn0VToR0uE6lsNQzA8EQ  1 1      0      0  25.5kb  12.7kb
green open .monitoring-es-7-2022.04.21         sDG2cWHHT5CuD9bCZ4nIQg  1 1 779440 703560   1.2gb 626.2mb
green open .monitoring-es-7-2022.04.20         DDNoYKUqSy6JKYo5AxLTsw  1 1 732097  59782   1.1gb 584.3mb
```
其中和监控相关的index有两种，一种是kibana的监控数据，一种是es的监控数据，各7天，每天一个index：
```
GET _cat/indices/.monitoring-*

green open .monitoring-es-7-2022.04.19     noY84MlnQW64xH-E9u4hCQ  1 1 658669   2526    1gb 561.3mb
green open .monitoring-es-7-2022.04.22     uuIo5HeBQGKv0L2rel1EEQ 15 1  18298 231645 84.9mb  42.6mb
green open .monitoring-kibana-7-2022.04.21 YEDA39V2TN6_j4hEH0tUCQ  1 1   5242      0  2.1mb     1mb
green open .monitoring-es-7-2022.04.18     gUb-MtnLRKGpkfZZu4Ni9Q  1 1 652609 283754  1.1gb 566.2mb
green open .monitoring-kibana-7-2022.04.20 cNNSYaifTDSC1xmY0yZhrQ  1 1  17278      0  6.2mb   3.1mb
green open .monitoring-es-7-2022.04.17     TjNhpGcISGm6zJlnRXRpFg  1 1 558972 344514    1gb 553.5mb
green open .monitoring-es-7-2022.04.16     qEqLQG-hQgOzNLUTBP3a5Q  1 1 534334 329945    1gb 547.1mb
green open .monitoring-kibana-7-2022.04.22 e5kmnwW6SLKQswyoNeM1uQ 15 1    490      0  3.4mb   1.7mb
green open .monitoring-kibana-7-2022.04.16 frNQLa6WSheyKDQI2Of_XA  1 1  17278      0  6.3mb   3.1mb
green open .monitoring-es-7-2022.04.21     sDG2cWHHT5CuD9bCZ4nIQg  1 1 779440 703560  1.2gb 626.2mb
green open .monitoring-kibana-7-2022.04.18 -pAUY81cS6-9oPoDdeCUTw  1 1  17264      0  6.5mb   3.2mb
green open .monitoring-es-7-2022.04.20     DDNoYKUqSy6JKYo5AxLTsw  1 1 732097  59782  1.1gb 584.3mb
green open .monitoring-kibana-7-2022.04.17 p8qay42gSQ23h1Jx_ray-g  1 1  17280      0  6.3mb   3.1mb
green open .monitoring-kibana-7-2022.04.19 _69KXenXRRWWZWly12Eu0w  1 1  17280      0  6.2mb   3.1mb
```
查看今天的es monitoring的mapping：
```
GET .monitoring-es-7-2022.04.22/_mapping
```

果然field有`node_stats.thread_pool.write`，且没有定义threads field，**而且mapping的dynamic属性设置的是strict**。确实无法写入在mappings里未定义的threads field。

```
{
  ".monitoring-es-7-2022.04.22" : {
    "mappings" : {
      "dynamic" : "strict",
      "date_detection" : false,
      "properties" : {
        "ccr_auto_follow_stats" : {
          "properties" : {
            "auto_followed_clusters" : {
              "type" : "nested",
              "properties" : {
                "cluster_name" : {
                  "type" : "keyword"
...
```

> 查看`.monitoring-es-7-2022.04.22`的mappings定义，监控的metric还挺多。

# 为什么产生错误
错误的原因知道了，但是错误是怎么产生的？昨天的监控信息为啥没事儿？

看了一下昨天的index的mapping：
```
GET .monitoring-es-7-2022.04.21/_mapping
```
**dynamic为false，所以可以写入mapping里未定义的threads field，不会报错**！

这就离谱了，为啥昨天的index denamic=false，今天存储监控信息的index的dynamic=strict，两个还不一样？

查了好久，也没查到答案。

一开始查找的方向在于为啥x-pack这个监控插件要创建一个dymamic=strict的mapping：
- https://www.elastic.co/guide/en/x-pack/current/xpack-introduction.html

后来，不经意看到了之前晓立设置的es索引的default template：
```
PUT _template/default_template
{
   "index_patterns" : [
     "*"
   ],
   "order": 0,
   "settings": {
       ...
   },
   "mappings": {
   "dynamic": "strict"
 }
}
```
看着那个index_patterns，擦……所有的index都默认被设置为dynamic=strict！所以不是x-pack给监控索引设置的dynamic=strict，是默认设置的……

> 突然想起刚刚查到的也遇到过这个问题的：
> - https://stackoverflow.com/a/55559428/7676237
> 
> 只不过它说的比较简单，没意识到是这个问题。

# 解决办法
可以查看当前所有的index template：
```
GET _template
```
监控已经创建了个默认的`.monitoring-es`模板，匹配".monitoring-es-7-"开头的index：
```
    "index_patterns" : [
      ".monitoring-es-7-*"
    ],
```
优先级是order=0。

而晓立设置的default template默认匹配所有的index：
```
   "index_patterns" : [
     "*"
   ],
```
优先级也是order=0。

**两个优先级相同的模板同时满足`.monitoring-es-7-2022.04.22`这个索引，会发生什么情况**？

按照[Indices matching multiple templates](https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-templates-v1.html#multiple-templates-v1)的说法：

> Multiple matching templates with the same order value will result in a non-deterministic merging order.

行为不可预测。

## ~~新加一个优先级更高的默认dynamic=false的模板~~
所以可以给内部（dot开头）index设置个优先级更高的template，dynamic默认为false：
```
PUT _template/internal_default_template
{
    "order" : 1,
    "index_patterns" : [
      ".*"
    ],
    "mappings" : {
      "dynamic" : "false"
    }
}
```
这样es先解析order=0的template，再拿order=1的覆盖它，最后新建的monitor相关的index的dynamic就是false。

Ref：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-templates-v1.html
- https://www.cnblogs.com/Neeo/articles/10869231.html

## 修改原有defalt template
后来感觉上述方法不太合适。

最好的办法还是修改一开始的default template，**使之只影响业务自己创建的index，不要影响插件创建的内部index**（这些index基本都以dot开头）。

template使用`index_patterns`指定匹配的index，可以使用一些通配符：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-templates-v1.html#put-index-template-v1-api-request-body
- https://www.elastic.co/guide/en/elasticsearch/reference/current/sql-index-patterns.html
- https://www.elastic.co/guide/en/elasticsearch/reference/current/api-conventions.html#api-multi-index

> 但是`index_patterns`的文档解释的不够细致，实际使用起来令人费解。

一开始设置了：
```
  "index_patterns":[
    "*",
    "-.*"
  ],
```
打算实现“匹配任意索引，除了以dot开头的索引”的效果，但是实际效果并没有用。

后来改成：
```
  "index_patterns":[
    "-.*"
  ],
```
“不匹配以dot开头的索引”，就可以了。此时default template不适用于dot开头的索引，不会干涉监控index会使用它自己的template。

elaticsearch里multi-target syntax的规范：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/api-conventions.html#api-multi-index

最终的detaulf_template修改：
```
PUT _template/default_template
{
  "index_patterns":[
    "-.*"
  ],
  "order":0,
  "settings":{
    "index":{
      "mapping":{
        "nested_objects":{
          "limit":"100"
        },
        "total_fields":{
          "limit":"2000"
        },
        "depth":{
          "limit":"20"
        }
      },
      "search":{
        "slowlog":{
          "level":"debug",
          "threshold":{
            "fetch":{
              "warn":"1s",
              "trace":"200ms",
              "debug":"500ms",
              "info":"800ms"
            },
            "query":{
              "warn":"3s",
              "trace":"500ms",
              "debug":"1s",
              "info":"2s"
            }
          }
        }
      },
      "refresh_interval":"10s",
      "indexing":{
        "slowlog":{
          "reformat":"false",
          "threshold":{
            "index":{
              "warn":"3s",
              "trace":"500ms",
              "debug":"1s",
              "info":"2s"
            }
          },
          "source":"1000",
          "level":"debug"
        }
      },
      "number_of_shards":"15",
      "translog":{
        "flush_threshold_size":"1024m",
        "sync_interval":"30s",
        "durability":"request"
      },
      "merge":{
        "scheduler":{
          "max_thread_count":"1"
        }
      },
      "max_result_window":"10000",
      "unassigned":{
        "node_left":{
          "delayed_timeout":"5m"
        }
      },
      "number_of_replicas":"1"
    }
  },
  "mappings":{
    "dynamic":"strict"
  }
}
```
- 改了index pattern；
- 改了异步写入translog的方式。**原有async的设定会导致es关闭时丢掉最近30s的未同步到磁盘的数据**。

关于translog的写入方式参考“Translog 有多安全?”：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/translog.html

# 其他：为什么上午八点才报错？
早上八点，首先想到UTC +8。查了一下index创建的时间：
```
GET _cat/indices?h=health,status,index,id,pri,rep,docs.count,docs.deleted,store.size,creation.date.string&v=

green  open   .monitoring-es-7-2022.04.21     sDG2cWHHT5CuD9bCZ4nIQg   1   1     779440       703560      1.2gb 2022-04-21T00:00:00.307Z
```
果然是UTC零点，也就是东八区早上八点创建的。（Z：zulu时区，也是UTC时区）

新创建的索引mapping有问题，所以八点报的错。

