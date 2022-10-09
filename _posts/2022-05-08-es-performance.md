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
深度分页（比如超过1000页），比如遍历所有数据。

## from size
如果使用`search`接口的from size进行分页获取，对于分布式的系统来说是比较消耗性能的事情。

> Each shard must load its requested hits and the hits for any previous pages into memory. For deep pages or large sets of results, these operations can significantly increase memory and CPU usage, resulting in degraded performance or node failures.

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/_fetch_phase.html

## scroll
> **深度分页的代价根源是结果集全局排序**，如果去掉全局排序的特性的话查询结果的成本就会很低。 **游标查询用字段`_doc`来排序**。 这个指令让 Elasticsearch 仅仅从还有结果的分片返回下一批结果。

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/scroll.html

elasticsearch可以使用scroll api，“滚动”获取所有的数据，每次取出“一页”，直到取完：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html#scroll-search-results

scroll的请求可以参见：[Spring Data - Elasticsearch]({% post_url 2022-09-21-spring-data-elasticsearch %})的stream部分。

scroll api会在查询的“那一刻”，生成一个scroll id，这个scroll id会对应着一个“search context”，标记着请求执行的“那一刻”，索引里所有符合条件的文档。之后每一次使用这个scroll id查询，都会把这些文档一批批返回。

> 同一个连续的scroll请求，中间返回的scroll id可能是会变的。如果变了，就要使用新返回的scroll id继续滚动下去。

**scroll查询到的一直都是开始时那一刻的文档，即全局的一个snapshot**。为什么这么牛逼？**这全都仰仗elasticsearch的segment是不可变的**。修改的内容只会记录在新的segment里，而不是修改老的segment。**所以查询开始的那一刻，只要那一刻所有的segment不删掉，就可以一直查到那一刻已有的数据，同时也不耽误新的udpate数据生成到新的segment里**。

这也就意味着，在scroll结束之前，这些context是会一直保留下来的：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html#scroll-search-context

elasticsearch后台每次refresh会生成一个segment，还会有后台任务进行段合并的工作（[Elasticsearch：deep dive]({% post_url 2022-05-05-es-deep-dive %})），“保留context”就意味着：
1. **占用磁盘、文件描述符**：这些合并后的segment不能被删掉，还要继续被保留下去，直到scroll id被删掉；
2. **占用内存（heap space）**：每个段里的doc并不都是有效的，那些被delete或者update的doc会被记录在`.del`文件里，保留这些会占用额外的内存：https://www.elastic.co/guide/cn/elasticsearch/guide/current/dynamic-indices.html#deletes-and-updates

> elasticsearch的不可变segment让它有了“只要一直不删除旧的segment，就相当于保留了所有数据的各个节点的历史记录”的能力，但是不能一直这样下去，性能开销会慢慢越来越不可接受。
>
> 但是这里应该不会因为segment变多而导致搜索性能降低。这些旧的segment肯定对新的搜索请求不可见，只为scroll提供搜索。

> **像mysql这种在原数据上修改的数据库，能够在游标滚动查询数据的“那一刻”，给所有的老数据做一个snapshot吗？毕竟它也有MVCC。这个可以后续了解了解。**
>
> MVCC：我读我的，你写你的。我的隔离级别决定了我读那一版数据。你是后开启的事务，事务id比我大，而我只读版本链里事务id小于等于我的那一版，那你的修改我就“看不到”。相当于也搞了全局snapshot。
>
> MVCC不处理写写冲突。实际上也不会有写写冲突（脏写），因为这种情况mysql会加锁。

scroll如此消耗性能，肯定是不能同时出现太多、保留太久的。每次scroll请求“下一页”的时候，都可以指定一个timeout，如果在timeout之前，没有关于这个scroll id的新的scroll请求，这个scroll id就会被删掉，后续再用这个scroll id就会404 Not Found。所以scroll的timeout一定要大于获取的这一批数据的处理时间，否则就没法继续scroll了。

> 要及时为scroll id “续一秒”。

所以scroll为什么比from size适合deep pagination？大概是因为from size每次都无脑返回(from + size)项doc到协调节点，**而scroll记录了上次scroll在每个shard上的游标？** 因为从[这个](https://discuss.elastic.co/t/sliced-scroll-with-sort/284874/4?u=puppylpg)回答来看，scroll是和自己的这次scroll context绑定的，而下面的PIT则不和请求绑定，多个请求可以用一个PIT。这么说的话，scroll是可以把自己上次的游标信息记录到这个scroll的context里的。但是确实不如search after快。

## search after
search after确实能让翻页更快：每次记录下前一页的最后一项，新的页在它的基础上查找，自然会更快。

> 之前还确实遇到过类似的事情：就像在mysql中使用limit翻页一样，越翻越慢。而记录下上一页的最后一项的id，并在下一次查询中使用“where id > xxx”，则避免了翻页的开销。参考[Innodb：索引的正确使用与拉胯的limit]({% post_url 2022-05-10-innodb-index-limit %})。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html#search-after

但是显然search after只能“连续往后翻”，不能像from size一样可以任意跳页，还能往前跳。

## Point In Time(PIT)
**from size和search after本身都是无状态的**：如果连续的多次查询中间有数据变动，新的变动会影响后面的查询结果。比如查完第一页查第二页，结果第一页插了一项（并refresh了），此时查出来的第二页的第一项就是之前第一页的最后一项……

> scroll是有状态的，可以理解为它已经和PIT强绑定了。

所以elasticsearch还提供了PIT（Point In Time），其实就是之前scroll api的snapshot功能，甚至连文档的内容都是照抄的：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/point-in-time-api.html

PIT接口独立出来之后，已经可以和 **任意search请求组合使用** 了（search api已经支持pit参数了）：如果需要多次搜索在同一个snapshot上进行，就先使用PIT api生成一个snapshot。所以PIT不止可以和search after结合使用，还能和from size结合使用。

> reindex也和PIT有关，reindex的就是那一刻的snapshot数据。

