---
layout: post
title: "Elasticsearch：_source store doc_values"
date: 2022-10-05 21:57:15 +0800
categories: elasticsearch lucene
tags: elasticsearch lucene
---

一切始于一个奇怪的现象：elasticsearch以`epoch_millis`存储时间戳的时候，竟然可以接受string（字面值为long）存储，且使用起来和long毫无区别：
```json
GET <index>/_search
{
  "query": {
    "range": {
      "timestamp": {
        "lte": "2",
        "format": "epoch_millis"
      }
    }
  }
}

GET <index>/_search
{
  "query": {
    "range": {
      "timestamp": {
        "lte": 2,
        "format": "epoch_millis"
      }
    }
  }
}
```

> 但是只能用long字面值的string，用其他string是不合法的。

而spring-data-elasticsearch在转换时间的时候，全都用的string，没有long。对于Instant的long，也是转换成了string格式。所以我在它那里提了一个[issue](https://github.com/spring-projects/spring-data-elasticsearch/issues/2318)。通过这个issue，也明白了另外一个之前困扰我的问题：[为什么elasticsearch能够做到总是返回_source](https://stackoverflow.com/questions/71391844/are-elasticsearch-object-properties-really-just-flat-properties-with-a-namespace)。

> 从[date的文档介绍](https://www.elastic.co/guide/en/elasticsearch/reference/current/date.html)也可以看出来，**elasticsearch在内部实际是使用string存储`epoch_millis`的，即使传入的是long**：
Dates will always be rendered as strings, even if they were initially supplied as a long in the JSON document.

1. Table of Contents, ordered
{:toc}

# 存储方式
elasticsearch的`_search` API有三种查询参数，对应了不同的查询方式：
- [`fields`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#search-fields-param)
    + 还能直接用[`_source`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#source-filtering)
- [`stored_fields`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#stored-fields)
- [`docvalue_fields`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#docvalue-fields)


其实对应了三种存储方式：
- [`fields`或默认的`_source`](https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-source-field.html)
- [`store`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/mapping-store.html)属性
- [`doc_values`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/doc-values.html)属性

## `_source` field
**elasticsearch默认会把原始文档存成一个名为[`_source`](https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-source-field.html)的field，作为elasticsearch创建的文档结构的一部分**，如果查询的时候没有什么特殊参数，**返回的是符合条件的文档的`_source`字段（而不是这个文档的全部）**。

> **`_source`是`store`类型的字段，对用户透明**。

## `store`
[`store`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/mapping-store.html)是field的一个属性，默认store=false，即：field不单独存储到文档里。假设field的`index`属性为true（默认），这个field会出现在倒排索引里，所以field可查询。但是查询到这个文档后，返回的是`_source` field，是整个文档，而不是单独的某个字段。

如果不想返回整个`_source`，只想返回某个字段，可以[在查询的时候使用`_source` option](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#source-filtering)从`_source`里获取。

> 返回的是`_source`里该字段的原始值。

虽然直接返回`_source`是很快的，但是想从`_source`里取某几个字段，速度自然就变慢了。如果`_source`太大（比如有个context字段存了一篇文章），而经常用到的请求都只是查其中的小字段（比如title），那么可以给title设置`store=true`，只查title，且直接返回title。

这是典型的以（存储）空间换（查询）时间，一般情况下不太用得到。

### Lucene的`store`
**`stored`是Lucene里的概念：一个index=true但是stored=false的字段能被搜索到，但不在最终的返回结果里。如果所有字段都只index不stored，最终返回的只有一个文档id**。用户可能会拿着这个id去其他数据库比如mysql获取完整数据。
- https://stackoverflow.com/a/32952682/7676237

**elasticsearch的`store`使用的就是Lucene `stored`的概念，`_source`是elasticsearch文档的第0个`store=true`的field**。`store`的field是row manner：每一个field在elasticsearch的document里顺次排列。

![store](/pics/Elasticsearch/storage/storedfields.png)

![_source field](/pics/Elasticsearch/storage/sourcefield.png)

elasticsearch返回store字段比返回_source里的某个字段速度快的原因也一目了然：field的寻找时间变快了，只需要返回每个命中的doc从起始位置偏移x个字节后的field就行了，无需加载`_source`并解析里面的field。

> 以空间换时间。

## doc_values
[`doc_values`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/doc-values.html)原本是为了排序和聚合用的，但因为它使用了额外的空间存储field（这一点比较像`store`），**所以在搜索的时候如果只需要返回这一部分的field，可以直接从`doc_values`存储的地方读取**。

> 多占用的空间不能浪费，也可以拿来换时间！

**`index`是构建一个倒排索引，是key to value的map，value就是doc。搜索是知道key，找value，也就是找doc。但是排序和聚合是知道doc找key，也就是按照value找key，所以按理说得搞个value to key的map。**

> `doc_values`的文档开头详细介绍了这一点：https://www.elastic.co/guide/en/elasticsearch/reference/8.4/doc-values.html
>
> 先不考虑一个key有多个value的问题。

### Lucene的`doc_values`
Lucene的`doc_values`是把倒排索引（key to value）倒过来（value to key），英文叫 **univert the inverted index**，“把倒排索引倒过来”，中文称之为正排索引。

**Lucene用一个数组实现了这个value to key的map，数组的下标本身代表了doc的id（Lucene id，不是elasticsearch id）**：

![正排索引](/pics/Elasticsearch/storage/uninvert-the-inverted-index.png)

`doc_values`的结构是 **列式存储，不同文档的相同field（逻辑上的一个列）的值存储为一行（对应为上述一个数组）**，所以适合给这个列的值做排序和聚合。当只需要返回这个列的值时，可以从这里直接读取所有列的值（实际上是在读行）。

> The value of the same fields for different documents are stored all together consecutively in memory and it is possible to access a certain field for a certain document “almost” directly.
>
> **所谓行式列式：在读取的时候其实都是行式，但是如果这一行存储的是所有的文档的这一列（把列按行存），在逻辑上相当于一读一列。所以把列按行存（行实际上存的是列的数据），就是列式存储。**

正排索引一开始使用的是`fielddata`，放在内存里，后来才发展成了`doc_values`，放磁盘里：
- elasticsearch从`fielddata`到`doc_values`的发展：https://www.elastic.co/cn/blog/elasticsearch-as-a-column-store
- Lucene的`doc_values`：https://blog.trifork.com/2011/10/27/introducing-lucene-index-doc-values/

### `index`
关闭index并非就不能查找了，如果开启`doc_values`也是可以的（**[doc-value-only field](https://www.elastic.co/guide/en/elasticsearch/reference/current/doc-values.html#doc-value-only-fields)），可查，但查的比index要慢，而且可聚合，尤其适用于那些不怎么用于查找、过滤的统计field。**

> Query performance on doc values is much slower than on index structures, but offers an interesting tradeoff between disk usage and query performance for fields that are only rarely queried and where query performance is not as important. This makes doc-value-only fields a good fit **for fields that are not expected to be normally used for filtering, for example gauges or counters on metric data.**

如果只想把数据存到`_source`里，直接`index=false` + `doc_value=false`，应该更省空间：
- https://www.elastic.co/guide/en/elasticsearch/reference/8.4/mapping-index.html

# 查询
查询之所以有不同的方法，其实就是因为field存储的位置不同，**我们实际上是在使用不同的查询参数告诉elasticsearch去不同的地方查询**：
- https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html

从不同的地方查：
- `fields`或默认的`_source`: 从`_source`查；
- `store`: 从`store=true`的field查；
- `doc_values`: 从`doc_values=true`的field查；

## `_source`过滤查询
[`_source`过滤](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#source-filtering)查询，从`_source`查特定的字段，所以要解析`_source`。**返回的field和`_source`里存入的值相同**。

## `fields`查询
同样是从`_source`获取特定field，**但是返回的值并不是原始值，而是使用mapping解析后的值**：
1. 从`_source`取field的值；
2. 使用mapping解析值；

> The fields option returns values in the way that matches how Elasticsearch indexes them. For standard fields, this means that the fields option looks in `_source` to find the values, then parses and formats them using the mappings. Selected fields that can’t be found in `_source` are skipped.

正因如此，在开篇的例子中，date的内部使用string存储，所以即使`epoch_millis`存储的时候值为long，在通过`fields`查询时，也会返回string而非long：
- https://github.com/spring-projects/spring-data-elasticsearch/issues/2318#issuecomment-1264448733

假设updateTime和timestamp两个field都是epoch_millis类型，存入的都是long而非string：
```json
GET <index>/_search
{
  "fields": ["updateTime", "timestamp", "likes"],
  "_source": ["updateTime", "timestamp", "likes"]
}
```
结果`fields`返回的是string，`_source`返回的是存入时的long：
```json
      {
        "_index" : "<index>",
        "_type" : "_doc",
        "_id" : "1310454-zs_KVugpMxs",
        "_score" : 1.0,
        "_routing" : "1310454",
        "_source" : {
          "updateTime" : 1663094372553,
          "timestamp" : 1662999708000,
          "likes" : 18
        },
        "fields" : {
          "updateTime" : [
            "1663094372553"
          ],
          "timestamp" : [
            "1662999708000"
          ],
          "likes" : [
            18
          ]
        }
      },
```

**官方认为`fields`查询比`_source`查询有一些优势。由于它用到了mapping**，所以能：
1. **规范化返回数据**：比如上述`epoch_millis`既存储了long又存储了string，就可以使用mapping统一返回string；
2. Accepts multi-fields and field aliases
3. Formats dates and spatial data types
4. **Retrieves runtime field values**
5. Returns fields calculated by a script at index time
6. Returns fields from related indices using lookup runtime fields

> ~~暂时只用到了第一条优势~~。2023-05-19：现在也用到runtime field了。

**因为会用到mapping，所以对于runtime field这种实际没有被index的数据，虽然`_source`里没有该field，但是使用`fields`查询可以把它查出来。**

> [Elasticsearch：runtime field]({% post_url 2023-05-19-es-runtime-field %})

### 自定义转换：runtime field
`fields`只能按照mapping进行转换，正常情况下没什么问题。但是如果有特殊的需求，比如`fields`只能让epoch_millis以string返回，如果我们就想让它以long返回，可以使用[runtime field](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime-override-values.html)转换数据，再用`fields`查出来：
```json
GET <index>/_search
{
  "runtime_mappings": {
    "wtf": {
      "type": "long",
      "script": {
        "source":
        """emit(Long.parseLong(params._source['timestamp'].toString()))"""
      }
    }
  },
  "_source": false, 
  "fields": [
    "wtf"
  ]
}
```
返回的是long：
```json
{
  "took" : 2,
  "timed_out" : false,
  "_shards" : {
    "total" : 15,
    "successful" : 15,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 2,
      "relation" : "eq"
    },
    "max_score" : 1.0,
    "hits" : [
      {
        "_index" : "<index>",
        "_type" : "_doc",
        "_id" : "gHz4xIMBiDkSEf3Uym3G",
        "_score" : 1.0,
        "fields" : {
          "wtf" : [
            1633429574000
          ]
        }
      },
      {
        "_index" : "<index>",
        "_type" : "_doc",
        "_id" : "Znz4xIMBiDkSEf3UEG2_",
        "_score" : 1.0,
        "fields" : {
          "wtf" : [
            1622749174000
          ]
        }
      }
    ]
  }
}
```

## `stored_fields`查询
[stored_fields](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#stored-fields)查询，直接查`stored`字段。

**官方文档说的很清楚，不建议用`store`，可以使用上述`_source`过滤查询取代`store`查询**：
> The `stored_fields` parameter is for fields that are explicitly marked as `stored` in the mapping, which is off by default and generally not recommended. Use `source filtering` instead to select subsets of the original source document to be returned.

如果field没有设置`store=true`，查询会被忽略：
> If the requested fields are not stored (store mapping set to false), they will be ignored.

## `docvalue_fields`查询
如果只查`doc_values=true`的列，[`docvalue_fields`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#docvalue-fields)查询也会很快。

`docvalue_fields`存储的内容和`_source`一样，但查询比`_source`轻量，毕竟不需要加载整个`_source`。而且`doc_value`默认为true。反正就算不查它，空间也已经占用过了。

## ~~`script_fields`查询~~

> 建议使用runtime field取代script fields查询：[Elasticsearch：runtime field]({% post_url 2023-05-19-es-runtime-field %})

介绍了这么多，顺便把[`script_fields`](https://www.elastic.co/guide/en/elasticsearch/reference/8.4/search-fields.html#script-fields)也介绍了。

上面说的基本都是空间换时间，**`script_fields`是典型的时间换空间**：不需要存，但每次查的时候都要临时计算。如果临时用一用，还是挺不错的：
```json
GET /_search
{
  "query": {
    "match_all": {}
  },
  "script_fields": {
    "test1": {
      "script": {
        "lang": "painless",
        "source": "doc['price'].value * 2"
      }
    },
    "test2": {
      "script": {
        "lang": "painless",
        "source": "doc['price'].value * params.factor",
        "params": {
          "factor": 2.0
        }
      }
    }
  }
}
```
也可以用script获取`_source`里的field：
```json
GET /_search
{
  "query": {
    "match_all": {}
  },
  "script_fields": {
    "test1": {
      "script": "params['_source']['message']"
    }
  }
}
```
- `doc['my_field'].value`：会把field缓存到内存里，所以更快，但需要占用内存；
- `params['_source']['my_field']`：每次都从`_source`里解析，所以慢，但省内存；

# 脚本
在从painless脚本里访问文档的字段时，也因为存储类型不同，产生了[不同的访问方式](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/modules-scripting-fields.html)。

只有doc_values字段才能用[`doc['xxx']`](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/modules-scripting-fields.html#modules-scripting-doc-vals)访问，其他的只能去`_source`里取：[`params._source.xxx`](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/modules-scripting-fields.html#modules-scripting-source)。如果是stored fields，可以使用[`params._fields['xxx']`](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/modules-scripting-fields.html#modules-scripting-stored)。

同样的，能用doc values就尽量不用source。source本身就是stored fields所以和其他stored fields速度差不多。除非source过大，这时候读取整个source再从里面提取field的速度要慢于直接的stored fields。

但是使用doc要做双重判断：
- 判断key存在：`doc.containsKey('xxx')`
- 判断值存在：`doc['xxx'].size() > 0`

然后才能安全取值：`doc['xxx'].value`，非常麻烦。es8推出了[`field()`](https://www.elastic.co/guide/en/elasticsearch/reference/8.10/script-fields-api.html) API，来简化这个问题。但是目前还没有稳定。

## params
在Elasticsearch的Script脚本中，可以通过params参数访问以下变量：

- params._source：表示文档的原始源（source）。
- params._fields：表示文档的字段（fields）。
- params._now：表示当前时间戳。
- params._score：表示文档的得分（score）。
- params._index：表示文档所在的索引（index）。
- params._type：表示文档的类型（type）。
- params._id：表示文档的ID。
- params._version：表示文档的版本号（version）。
- params._routing：表示文档的路由（routing）。
- params._parent：表示文档的父文档（parent）。
- params._now：表示当前时间戳。
- 除了以上预定义的变量外，还可以通过自定义的params参数传递其他变量给脚本使用。

> 没找到相关资料，以上回答来自chatgpt。

# 查询速度比对
一个实验：
- https://sease.io/2021/02/field-retrieval-performance-in-elasticsearch.html

![elastic-benachmarks](/pics/Elasticsearch/storage/elastic-benachmarks.png)

可以看出，**需要取出的fields比较多的时候，使用`_source`更快，需要取出的fields较少时，从`doc_values`取更快**。

`store`以行的方式存储，取的fields少的时候，不如`doc_values`直接把所有文档的整个field域的值（逻辑上列式存储的优势）取走快，但是如果取的fields比较多，相当于遍历所有fields了，`doc_values`的优势就没了。当然官方建议不用`store`，除非存储非常充足，否则没必要单独存一遍，直接用`_source`就行了。

所以：取的field较少时建议使用`doc_values`，取的多（实验中是40+个fields）建议使用`_source`。土豪可以考虑开`store`。

# 感想
1. Lucene还是要看一看的；
1. elasticsearch的实现也是要看一看的，正好又是Java实现的；

> 这篇文章是国庆在周口写的~

