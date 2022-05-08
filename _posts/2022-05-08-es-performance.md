---
layout: post
title: "Elasticsearch：performance"
date: 2022-05-08 20:42:06 +0800
categories: elasticsearch
tags: elasticsearch
---

调优永远是比较困难的话题，调优就意味着已经超越了普通的使用场景：
1. 要知道调哪些东西，会产生什么影响，以及在其他方面的连带影响；
2. 如何衡量调优的效果；

1. Table of Contents, ordered
{:toc}

# 可调之处
es的可调之处有很多：
1. 段合并相关：https://www.elastic.co/guide/cn/elasticsearch/guide/current/indexing-performance.html#segments-and-merging
2. 分片数量设置：https://www.elastic.co/guide/en/elasticsearch/reference/current/size-your-shards.html
3. translog大小/是否异步、refresh_interval：[Elasticsearch：deep dive]({% post_url 2022-05-05-es-deep-dive %})；
4. 全局序数要不要预加载：[Elasticsearch：关系型文档]({% post_url 2022-05-03-es-relations %})；
4. 存储限流：merge如果太猛，会拖慢index和query的速度。`indices.store.throttle.max_bytes_per_se`；
5. 缓存大小：主要是filter查询的缓存，`indices.cache.filter.size`；
6. and more...

不仅种类繁杂，调之前一定要想好，调的目的到底是什么。**es参数的调整很多时候都是索引速度和搜索速度之间的权衡，以xx换xx。比如refresh interval、flush interval、段合并条件等，如果让index速度变快了，query速度是会受影响的**。所以调之前一定要想清楚好处是什么，代价又是什么。

# cache
## segment cache
es的搜索有两个语境：
1. query context：文档和搜索词有多配？
2. filter context：文档和搜索词配不配？

**所以filter是可以被缓存的**！
- https://www.elastic.co/guide/en/elasticsearch/reference/current/query-filter-context.html

filter用在bool query里，包括两种：
1. filter
2. must_not

- https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-bool-query.html

放在filter下的的查询（match、term/terms、range）结果是可以被缓存的。**es会建立一个bitset，用作该filter和segment的匹配结果**：
1. 开销低：bitset的创建代价非常低，因为每个文档只需要1 bit；
2. **方便做位操作：filter之间的and/or就是bitset之间的and/or，非常快**；

bitset缓存在jvm内存里，使用`indices.cache.filter.size`控制。

> range的时间如果是now，就不会被缓存，因为下一次必然now就变了，缓存now的过滤结果没有意义……如果range的gt/lt值不存在，是可以的。毕竟一个有头有尾的范围就是`gt AND lt`，两个bitset的交集。

**段合并之后，被合并移除的段的cache就失效了，因为filter cache是段级别的。但是其它分段的缓存仍然是不变的**。

> segment不可变的好处：缓存！

## shard cache
分片查询也有缓存。如果来了和之前一模一样的请求，分片缓存将直接返回结果。

**但是refresh之后，分片缓存就会失效，因为整个分片上的数据变了**。所以如果是日志数据的索引，很有用。

# 查询性能诊断：profile api
一般情况下，使用es最关心的还是：为什么查询这么慢。

es的profile api可以返回各个分片的查询时间，kibana对es的profile api的查询结果进行了可视化，并按照分片查询时间，倒序排列，这样一眼就能看出最慢的分片是谁。

- profile api：https://www.elastic.co/guide/en/elasticsearch/reference/current/search-profile.html
- kibana profile：https://www.elastic.co/guide/en/kibana/current/xpack-profiler.html
- https://juejin.cn/post/6844903693515489287

不过profile api返回了太多Lucene相关的时间指标，由于不了解Lucene，很难去解读这些metric：
> With that said, a complete understanding is often not required to fix a slow query. It is usually sufficient to see that a particular component of a query is slow, and not necessarily understand why the advance phase of that query is the cause, for example.

但是有两个指标可以作为主要关注点：
- 最慢分片查询速度：木桶原理，最慢的分片决定了最终的查询速度；
- cumulative time（kibana搞的）：cumulative time并非总查询时间，因为实际查询时，不同节点的分片会并行查询。cumulative time只是每个分片时间的简单相加：

> The cumulative time metric is the sum of individual shard times. It is not necessarily the actual time it took for the query to return (wall clock time). Because shards might be processed in parallel on multiple nodes, the wall clock time can be significantly less than the cumulative time. However, if shards are colocated on the same node and executed serially, the wall clock time is closer to the cumulative time.

**但是cumulative time可以反应所有分片的查询速度。如果总叠加时间比较小，说明在各个节点的分片上，查询都是比较快的**。

kibana好像多了两个时间，以bool查询为例：
- self time：做bool的时间；
- total time：做bool + 每一个搜索总共的时间；

**shard名称为：`nodeId-indexName-shardId`**。

> nodeId需要查一查才知道对应哪个node：`GET /_nodes`

profile api使用：
1. query添加`"profile": "true"`；
2. 最好url添加`?human=true`，能把时间显示的人性化一点儿；

比如：
```
GET /<index>/_search?human=true
{
  "query":{
    "bool":{
      "should":[
        {
          "match":{
            "title.reb_eng":"halo infinite"
          }
        },
        {
          "match":{
            "description.reb_eng":"halo infinite"
          }
        },
        {
          "match":{
            "tags.eng":"halo infinite"
          }
        }
      ],
      "filter":[
        {
          "range":{
            "timestamp":{
              "gte":1640966400000
            }
          }
        }
      ],
      "minimum_should_match":1
    }
  },
  "profile":"true"
}
```
profile api不对shard按时间倒序排序，用kibana看出倒序结果后，**如果配置了慢日志，可以去相应节点查看这段时间查询的慢日志**，确实很慢：
```
[puppylpg@a.com elasticsearch-3]$ grep -i "halo infinite" logs/<index>-es_index_search_slowlog.log
[2022-04-19T10:59:04,543][WARN ][i.s.s.query              ] [node-3] [<index>][9] took[5.7s], took_millis[5736], total_hits[8719 hits], types[], stats[], search_type[QUERY_THEN_FETCH], total_shards[15], source[{"query":{"bool":{"filter":[{"range":{"timestamp":{"from":1640966400000,"to":null,"include_lower":true,"include_upper":true,"boost":1.0}}}],"should":[{"match":{"title.reb_eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}},{"match":{"description.reb_eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}},{"match":{"tags.eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}}],"adjust_pure_negative":true,"minimum_should_match":"1","boost":1.0}},"profile":true}], id[],
[2022-04-19T10:59:13,159][WARN ][i.s.s.query              ] [node-3] [<index>][0] took[14.3s], took_millis[14352], total_hits[6917 hits], types[], stats[], search_type[QUERY_THEN_FETCH], total_shards[15], source[{"query":{"bool":{"filter":[{"range":{"timestamp":{"from":1640966400000,"to":null,"include_lower":true,"include_upper":true,"boost":1.0}}}],"should":[{"match":{"title.reb_eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}},{"match":{"description.reb_eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}},{"match":{"tags.eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}}],"adjust_pure_negative":true,"minimum_should_match":"1","boost":1.0}},"profile":true}], id[],
[2022-04-19T10:59:13,192][WARN ][i.s.s.query              ] [node-3] [<index>][11] took[14.3s], took_millis[14385], total_hits[7825 hits], types[], stats[], search_type[QUERY_THEN_FETCH], total_shards[15], source[{"query":{"bool":{"filter":[{"range":{"timestamp":{"from":1640966400000,"to":null,"include_lower":true,"include_upper":true,"boost":1.0}}}],"should":[{"match":{"title.reb_eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}},{"match":{"description.reb_eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}},{"match":{"tags.eng":{"query":"halo infinite","operator":"OR","prefix_length":0,"max_expansions":50,"fuzzy_transpositions":true,"lenient":false,"zero_terms_query":"NONE","auto_generate_synonyms_phrase_query":true,"boost":1.0}}}],"adjust_pure_negative":true,"minimum_should_match":"1","boost":1.0}},"profile":true}], id[],
```

# slow log
比如给索引设置默认slow log threshold：
```
PUT _template/default_template
{
   "index_patterns": "*",
   "order": 0,
   "settings": {
        "index.search.slowlog.threshold.query.warn":"3s",
        "index.search.slowlog.threshold.query.info":"2s",
        "index.search.slowlog.threshold.query.debug":"1s",
        "index.search.slowlog.threshold.query.trace":"500ms",
           
        "index.search.slowlog.threshold.fetch.warn":"1s",
        "index.search.slowlog.threshold.fetch.info":"800ms",
        "index.search.slowlog.threshold.fetch.debug":"500ms",
        "index.search.slowlog.threshold.fetch.trace":"200ms",
        "index.search.slowlog.level":"debug",
           
        "index.indexing.slowlog.threshold.index.warn":"3s",
        "index.indexing.slowlog.threshold.index.info":"2s",
        "index.indexing.slowlog.threshold.index.debug":"1s",
        "index.indexing.slowlog.threshold.index.trace":"500ms",
        "index.indexing.slowlog.level":"debug",
        "index.indexing.slowlog.source":"1000",
        "index.indexing.slowlog.reformat":"false"
   }
}
```
slow log分为index slow log和search slow log，最终存储位置比如：`logs/<index name>-es_index_search_slowlog.log`。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-slowlog.html

# ssd
因为es是依赖磁盘的数据库，查询的时候直接从磁盘读数据，所以两个东西非常影响es速度：
1. 磁盘速度。ssd能大幅提升es性能；
2. 操作系统的page cache。操作系统有足够的可用内存以缓存Lucene放置在磁盘上的不可变数据，将对查询大有裨益；

ssd对es的性能提升非常大！普通磁盘如果存储空间不足，对性能影响也很大。之前发生慢查询，最后发现一个节点上的分片巨慢（24s+），主要是磁盘容量已经使用90%+了，把该节点下掉之后，速度正常了许多（10s+，不过此时其他节点的磁盘也不是很富裕）。最后换成全新大容量ssd，同样的查询直接就变成了几百毫秒的量级：

1. 最慢分片查询速度：
    - 换ssd之前：即使剔除掉慢节点node6（最慢的节点查询速度24s+），最慢的分片查询也已经逼近10s；
    - 换ssd之后：最慢的节点查询速度在1.8s；
1. 总体分片查询速度cumulative time：
    - 换ssd之前：15个分片累加的时间为24.9s，平均单分片查询速度1660ms；
    - 换ssd之后：15个分片累加的时间为12.4s，平均单分片查询速度827ms；
因为最慢的节点才是最终查询消耗的时间，实际查询时，换完ssd后对5亿+条文档的media索引的查询时间基本都是在1s以内。之前没还ssd，4.7亿文档查询速度在24s+，剔除掉慢节点node6，也需要十几秒才能查完。

# deep pagination

- https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html#search-after

