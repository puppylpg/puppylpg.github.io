---
layout: post
title: "Elasticsearch：runtime field"
date: 2023-05-19 17:13:15 +0800
categories: elasticsearch
tags: elasticsearch
---

[runtime field](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime.html)是在查询时计算的field，是一种时间换空间的概念。虽然查询速度会比普通的field慢，但是非常灵活，适合做一些数据探索的工作。

1. Table of Contents, ordered
{:toc}

# vs. script field
虽然runtime field和script field一样，也是用painless script来计算值，但是功能上却比后者要强大很多——

[script fields](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-fields.html#script-fields)只能用来获取值（有点儿像数据后处理）。想作为query条件的话只能使用[script query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-script-query.html)，想做排序只能[使用script sort](https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html#script-based-sorting)。runtime field比script fields强，**它在功能上和普通的field没有区别，所以可以像真正的field一样进行搜索、聚合**。
> You can use script fields to access values in _source and return calculated values based on a script valuation. Runtime fields have the same capabilities, but provide greater flexibility because you can query and aggregate on runtime fields in a search request. Script fields can only fetch values.

**由于处理runtime field和处理普通field一致，所以在功能上runtime field对script field是全面碾压，使用起来也更加顺手**。

在性能上二者是一致的：
> If you move a script from any of these sections in a search request to a runtime field that is computing values from the same number of documents, the performance should be about the same. The performance for these features is largely dependent upon the calculations that the included script is running and how many documents the script runs against.

# runtime field
runtime field可以定义在mapping里，也可以定义在search请求里。


## in mapping
定义在mapping里，后续所有的查询就可以直接使用runtime field了。在逻辑上，好像真的有这么一个field一样。
```json
PUT my-index-000001/
{
  "mappings": {
    "runtime": {
      "day_of_week": {
        "type": "keyword",
        "script": {
          "source": "emit(doc['@timestamp'].value.dayOfWeekEnum.getDisplayName(TextStyle.FULL, Locale.ROOT))"
        }
      }
    },
    "properties": {
      "@timestamp": {"type": "date"}
    }
  }
}
```
和script field不同的是，**使用runtime field，必须在painless脚本里使用[`emit`函数](https://www.elastic.co/guide/en/elasticsearch/painless/8.7/painless-runtime-fields-context.html)把计算的值emit出来**：

> When defining a Painless script to use with runtime fields, you must include the emit method to emit calculated values.

因为runtime field并不真的存在索引后的值，而是一个临时计算的虚幻的值，所以它[可以无限修改、覆盖](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime-mapping-fields.html#runtime-updating-scripts)。不需要的时候，直接用null覆盖掉就好：
```json
PUT my-index-000001/_mapping
{
 "runtime": {
   "day_of_week": null
 }
}
```

## in query
如果只是临时用一用，我更喜欢把runtime field定义在单次查询的请求里。缺点是每次查询都要带上。

比如查询两个field（a和b）的比值：
```json
GET <index>/_search
{
  "runtime_mappings": {
    "a_b_ratio": {
      "type": "double",
      "script": {
        "source": "if (doc['a'].size() > 0 && doc['b'].size() > 0  && doc['a'].value > 0 && doc['b'].value > 0) { return emit(doc['a'].value / doc['b'].value); } else { return emit(0); }",
        "lang": "painless"
      }
    }
  },
  "query": {
    "range": {
      "a_b_ratio": {
        "gt": 0
      }
    }
  },
  "sort": [
    {
      "a_b_ratio": {
        "order": "desc"
      }
    }
  ], 
  "_source": ["a", "b", "a_b_ratio"], 
  "fields": [
    "a", "b", "a_b_ratio"
  ]
}
```

> 如果这里的返回值不使用`emit`，比如第二个条件直接`return 0`，会报错：`class_cast_exception: Cannot cast from [int] to [void]`。

可以用它过滤、排序，还能获取具体的值。和普通field唯一的区别是：**[只能使用fields查询](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime-retrieving-fields.html)runtime field的值，因为_source里没有**。

从结果里可以看出来，`_source`里查不出`a_b_ratio`：
```json
{
  "took" : 3,
  "timed_out" : false,
  "_shards" : {
    "total" : 15,
    "successful" : 15,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 1,
      "relation" : "eq"
    },
    "max_score" : null,
    "hits" : [
      {
        "_index" : "xxx",
        "_type" : "_doc",
        "_id" : "xxx",
        "_score" : null,
        "_source" : {
          "b" : 2,
          "a" : 1879.0
        },
        "fields" : {
          "a_b_ratio" : [
            939.5
          ],
          "b" : [
            2
          ],
          "a" : [
            1879.0
          ]
        },
        "sort" : [
          939.5
        ]
      }
    ]
  }
}
```

> 关于[fields](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-fields.html)查询参数，可以参考：[Elasticsearch：_source store doc_values]({% post_url 2022-10-05-es-source-store-docvalues %})

## index runtime fields
如果两列数据是关联的，比如上述a和b，天然就会产生a_b_ratio。最好的情况应该是在a、b两列数据摄入后就自动计算出二者的比值。因此可以一开始就在mapping里定义这样的runtime field，**相当于把runtime field进行了索引，之后每次查询不再需要实时计算**：
```json
PUT my-index-000001/
{
  "mappings": {
    "properties": {
      "timestamp": {
        "type": "date"
      },
      "temperature": {
        "type": "long"
      },
      "voltage": {
        "type": "double"
      },
      "node": {
        "type": "keyword"
      },
      "voltage_corrected": {
        "type": "double",
        "on_script_error": "fail", 
        "script": {
          "source": """
        emit(doc['voltage'].value * params['multiplier'])
        """,
          "params": {
            "multiplier": 4
          }
        }
      }
    }
  }
}
```
参考[完整的例子](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime-indexed.html)。

# 总结
总之，runtime field非常方便灵活，用于临时完成一些数据转换查询。这里还有一个[数据探索](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime-examples.html)的例子，用来从日志里获取ip等。


