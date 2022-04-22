---
layout: post
title: "Elasticsearch：sort、aggregation"
date: 2022-04-22 23:45:54 +0800
categories: elasticsearch
tags: elasticsearch
---

上一篇讲了搜索，这一篇说说排序和聚合。

1. Table of Contents, ordered
{:toc}

# sort
## 显式排序
按照某个字段的值排序，和mysql没什么区别，支持升序降序等。**但是field必须开启doc_values属性才能排序**。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html

## 按照得分排序
es的查询结果，如果没有显式排序，默认按照文档的搜索得分排序。分数越高的文档和搜索词的相关性越强。

TF/IDF（term frequency–inverse document frequency）：
1. TF：词语频率高；
2. IDF：且并不是所有文档频率都这么高；

通俗地讲，就是该词不仅在你文档里出现的频率高，而且比在其他文档里出现的平均频率高，那说明这个词在你的文档里很重要。

- 什么是相关性：https://www.elastic.co/guide/cn/elasticsearch/guide/current/relevance-intro.html
- 相关度背后的理论：https://www.elastic.co/guide/cn/elasticsearch/guide/current/scoring-theory.html

# aggregation
和mysql的group by类似，聚合内部也可以再进行子聚合，其实就是group by多个field，最后可以对聚合字段做sum/min等计算。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations.html

使用es的Java API写聚合表达式相对复杂一些：
- https://elasticsearchjava-api.readthedocs.io/en/latest/aggregation.html
- https://www.elastic.co/guide/en/elasticsearch/client/java-rest/current/java-rest-high-aggregation-builders.html

# doc_values - doc的所有value
**排序和聚合之所以要一起说，是因为他们都用到了文档的所有token**：
1. 排序使用TFIDF给文档打分，需要知道这个文档所有的token有哪些；
2. 聚合也一样。比如对keyword类型的字符串做聚合，要知道这个完整的字符串的内容；

这就需要用到正排索引，它和倒排索引是完全相反的概念：
- 倒排索引是根据token找所有包含这个token的文档；
- 正排索引是根据文档找它所有的token；

两个文档：
1. The quick brown fox jumped over the lazy dog
2. Quick brown foxes leap over lazy dogs in summer

倒排索引：
```
Term      Doc_1  Doc_2
-------------------------
Quick   |       |  X
The     |   X   |
brown   |   X   |  X
dog     |   X   |
dogs    |       |  X
fox     |   X   |
foxes   |       |  X
in      |       |  X
jumped  |   X   |
lazy    |   X   |  X
leap    |       |  X
over    |   X   |  X
quick   |   X   |
summer  |       |  X
the     |   X   |
------------------------
```

正排索引：
```
Doc      Terms
-----------------------------------------------------------------
Doc_1 | brown, dog, fox, jumped, lazy, over, quick, the
Doc_2 | brown, dogs, foxes, in, lazy, leap, over, quick, summer
-----------------------------------------------------------------
```

所以正排索引其实很简单：把这个字符串所有的token存下来就行了。看起来似乎毫无难度可言。**这也是给一个field建正排索引的属性名称叫`doc_values`的原因，doc's all the values，非常朴素的一个名字**。

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/docvalues.html

## index vs. doc_values
- `index`：倒排索引，绝大多数field类型默认都开启，开启之后即可搜索。**不开启一般不能搜索，但不绝对**；
- `doc_values`：倒排索引，**除了`text`和`annotated_text`**，其他field类型都默认开启了；

**Numeric types, date types, the boolean type, ip type, geo_point type and the keyword type can also be queried when they are not indexed but only have doc values enabled. 大概是因为排好序了，所以就可搜索了。类似innodb**。

text不开启正排索引，估计是开启后聚合出来的都是token，意义不大。一般聚合都是在聚合不同的文档，查看分组数据。如果对text做sort或agg，会报错：
>
> "type" : "illegal_argument_exception",
>
> "reason" : "Text fields are not optimised for operations that require per-document field data like aggregations and sorting, so these operations are disabled by default. Please use a keyword field instead. **Alternatively, set fielddata=true on [name] in order to load field data by uninverting the inverted index. Note that this can use significant memory.**"

关于fielddata，见后文。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-index.html
- https://www.elastic.co/guide/en/elasticsearch/reference/current/doc-values.html

## 性能
doc_values是用磁盘的，但是如果jvm内存足够，会被放在内存里，加快访问速度。如果jvm内存不够大，**虽然放在磁盘上，但是也可以充分利用操作系统的page cache来优化访问磁盘的速度**。

> page cache可参考：[Innodb - Buffer Pool¶]({% post_url 2022-01-23-innodb-buffer-pool %})；

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/docvalues-intro.html

不需要排序或聚合的字段可以关闭doc_values，可以节省不少磁盘空间，但是一定要想清楚，如果哪天需要排序了，就要重建索引了！

### 列式存储的压缩
其实就一句话：不存原始值！

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/_deep_dive_on_doc_values.html

### jvm内存不要开太大
一般意义上的理解是，内存当然是越大越好，越大越不容易oom啊！的确没错，但太大的内存也更难回收垃圾。而且如果不是程序写的太烂，一般不需要特别大的jvm内存。

而且现在还要考虑一点：doc_values使用利用os的page cache加快查询速度的。**如果jvm内存太大，把os内存都占了，os就没有太多的内存用来做page cache了，那doc values的速度就很受影响**。

> 因为 Doc Values 不是由 JVM 来管理，所以 Elasticsearch 实例可以配置一个很小的 JVM Heap，这样给系统留出来更多的内存。同时更小的 Heap 可以让 JVM 更加快速和高效的回收。
>
> 之前，我们会建议分配机器内存的 50% 来给 JVM Heap。但是对于 Doc Values，这样可能不是最合适的方案了。 以 64gb 内存的机器为例，可能给 Heap 分配 4-16gb 的内存更合适，而不是 32gb。
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/heap-sizing.html

# fielddata - “内存版doc_values”
上面对text排序、聚合的报错里提到，如果一定要用，请使用fielddata。

先演示一下fielddata：
```
PUT users
{
    "mappings" : {
      "properties" : {
        "name" : {
          "type" : "text",
          "fields": {
            "kw": {
              "type": "keyword"
            },
            "fd": {
              "type": "text",
              "fielddata": true
            }
          }
        },
        "mobile" : {
          "type" : "keyword"
        },
        "age" : {
          "type" : "integer"
        }
      }
    }
}

PUT users/_doc/1
{
  "name":"tom cat",
  "mobile": "15978866921",
  "age": 30
}

PUT users/_doc/2
{
  "name":"jerry mouse",
  "mobile": "15978866920",
  "age": 35
}

PUT users/_doc/3
{
  "name":"jack rose",
  "mobile": "15978866922",
  "age": 20
}

PUT users/_doc/4
{
  "name":"rose jack",
  "mobile": "110",
  "age": 20
}

GET users/_search
{
  "query": {
    "match_all": {}
  },
  "sort": [
    {
      "name.kw": {
        "order": "asc"
      }
    }
  ]
}

GET users/_search
{
  "query": {
    "match_all": {}
  },
  "sort": [
    {
      "name.fd": {
        "order": "asc"
      }
    }
  ]
}

GET users/_search
{
  "aggs": {
    "by_word": {
      "terms": {
        "field": "name.kw"
      }
    }
  },
  "size": 0
}

GET users/_search
{
  "aggs": {
    "by_word": {
      "terms": {
        "field": "name.fd"
      }
    }
  },
  "size": 0
}
```
**对text+fielddata排序，效果和对keyword排序不同**：
- **前者按name中的最小的那个token作为这个name的排序值**；
- 后者按name的自然序，因为整个name是一个token；

**对text+fielddata聚合（terms聚合），效果和keyword不同**：
- **前者按name中的每个token聚合计数**；
- 后者将这个name作为token进行聚合计数。

**所以大致可以看出来，fielddata和doc_values起到的作用是一样的，只不过它放在内存里**。

> 而它的名字field data，和doc's values，其实没啥区别。大概也能猜出来，二者功能上类似。

## 性能
fielddata放在内存里。

关于数据放内存还是放磁盘，各有千秋：
- 放内存：用的是jvm的内存。用得太多会oom；
- 放磁盘：用的是os的内存，page cache。用得太多会用不上内存，变成真用磁盘了。速度会变慢。

从一个老文档也可以看出来，**doc_values在取代fielddata，只有text在用fielddata了**：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/aggregations-and-analysis.html

> 从历史上看，fielddata 是 所有 字段的默认设置。但是 Elasticsearch 已迁移到 doc values 以减少 OOM 的几率。**分析的字符串（曾经的analyzed string，也就是现在的text类型）是仍然使用 fielddata 的最后一块阵地**。 最终目标是建立一个序列化的数据结构类似于 doc values ，可以处理高维度的分析字符串，逐步淘汰 fielddata。

fielddata被取代，**因为磁盘速度上来了，而把数据放在后者没有jvm oom风险**。

- https://segmentfault.com/a/1190000021668629


