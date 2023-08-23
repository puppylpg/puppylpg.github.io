---
layout: post
title: "Elasticsearch：关系型文档"
date: 2022-05-03 21:31:21 +0800
categories: elasticsearch
tags: elasticsearch
---

es是非关系型数据库，但是现实世界中的数据往往又是关系型的，比如用户和用户所发表过的博客就是一对多的关系。**而程序是对现实的抽象**，所以即便使用es也会不可避免要处理关系型数据。

1. Table of Contents, ordered
{:toc}

# 关系型数据
所谓关系，比如一对一、一对多、多对多等。数据的连接join操作在关系型数据库比如mysql里代价是比较小的，但是在非关系型数据库里，数据的连接操作代价是非常大的。

join的本质是对两块数据做笛卡尔积，而非关系型数据库往往是易于平行拓展的分布式系统，这就意味着对跨实例的两块数据做join操作，往往会引入节点间的网络数据传输，非常耗费性能。

但是关系型数据又是现实存在的，所以es针对分布式系统做了一些关系型数据的支持：
1. object；
2. nested；
3. parent child；

es对关系型数据的处理方式：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/relations.html

# 一对一
一对一的关系比较简单，可以考虑把两个对象合成一条文档存储起来，既不需要join，也不会产生冗余数据。

## object - flatten
[object](https://www.elastic.co/guide/en/elasticsearch/reference/current/object.html)是层级数据最简单的组织方式：flatten，而非我们平常理解的嵌套。

### flatten
包含一个object就是在定义mapping的时候出现了properties的嵌套。**但是这个嵌套的属性并非我们理解的那种嵌套，在es里object实际是被flatten为每个属性的全路径名，并使用点分隔，存储为独立字段**。比如：
```json
PUT my-index-000001/_doc/1
{ 
  "region": "US",
  "manager": { 
    "age":     30,
    "name": { 
      "first": "John",
      "last":  "Smith"
    }
  }
}
```
实际存储为：
```json
{
  "region":             "US",
  "manager.age":        30,
  "manager.name.first": "John",
  "manager.name.last":  "Smith"
}
```

### array of objects
按照[Elasticsearch：basic]({% post_url 2022-04-20-es-basic %})所介绍的：es的任何一个field都能存放多个值，也就是可以存放数组。这意味着可以以数组的形式存储多个inner object。那是不是意味着object也可以存储一对多的关系？

**不可以！因为object的[每个field都会被flatten到单独的数组里，存成数组之后，每个object里的field都失去了原有的关联](https://www.elastic.co/guide/en/elasticsearch/reference/current/nested.html#nested-arrays-flattening-objects)**。

> 换言之，last name和first name之间没有成组的关系了。

这也就意味着不能以object的形式存储一对多关系。

关于array of object，还可以写成其他的形式：
- https://stackoverflow.com/a/72095595/7676237

比如：
```json
PUT my-index-000001/_doc/2
{ 
  "region": "US",
  "manager": { 
    "age":     30,
    "name": { 
      "first": "Lucy",
      "last":  "James"
    },
    "name.first": "Kate"
  }
}
```
和
```json
PUT my-index-000001/_doc/3
{ 
  "region": "US",
  "manager": { 
    "age":     30,
    "name": [
      { 
        "first": "Lucy",
        "last":  "James"
      },
      { 
        "first": "Kate"
      }
    ]
  }
}
```
**实际上并没有什么区别**！使用`fields`查询可以发现：
```json
GET my-index-000001/_search
{
  "_source": ["manager.name.first", "manager.name.last"], 
  "fields": [
    "manager.name.first", "manager.name.last"
  ]
}
```
1. **两个first name实际上都是以数组的形式存储的**；
2. **first name和last name分属两个数组，失去了关联**；

```json
    "hits": [
      {
        "_index": "my-index-000001",
        "_id": "2",
        "_score": 1,
        "_source": {
          "manager": {
            "name": {
              "first": "Lucy",
              "last": "James"
            },
            "name.first": "Kate"
          }
        },
        "fields": {
          "manager.name.first": [
            "Lucy",
            "Kate"
          ],
          "manager.name.last": [
            "James"
          ]
        }
      }
    ]
```

# 一对多
一对多是最常见的关系型数据。就以一个用户和他发的所有博客为例进行阐述。

## nested - 存放于同一segment
上面所说的无法使用object存储一对多关系，因为object的各个field被flatten到不同的array之后，失去了原有的联系。为了解决这个问题，引入了[nested类型](https://www.elastic.co/guide/en/elasticsearch/reference/current/nested.html)。

**和object array相比，[nested array能把子对象孤立起来，所以查的时候不会跨对象](https://www.elastic.co/guide/en/elasticsearch/reference/current/nested.html#nested-fields-array-objects)**。

### 存储于同一segment

> 什么是segment：[Elasticsearch：分片读写]({% post_url 2022-05-05-es-deep-dive %})

**nested文档在逻辑上，依然是一条嵌套了子文档的大文档。但是实际存储的时候，nested文档在物理上产生了n个子文档和1个父文档，并把他们存放在同一个segment上**：
- 同一个segment：https://discuss.elastic.co/t/index-nested-documents-separately/11748/3
- https://discuss.elastic.co/t/whats-nested-documents-layout-inside-the-lucene/59944
- https://www.elastic.co/guide/en/elasticsearch/guide/current/nested-objects.html
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/nested-objects.html
- 挨着的排序方式：https://stackoverflow.com/a/54023434/7676237

**为什么要放在同一个segment上？快！查询的时候，一和多都在一起，就可以快速把他们检索出来，并做join操作了**。

> 这是es处理join的一种方式：把相关文档挨着存放。

**这些子文档是隐式的独立子文档（hidden separate document）**。因为是隐式的，没有对上层暴露，所以所有的操作都是对逻辑上的整条文档来操作的，也意味着更新这个文档的任何一部分，所有的隐式子文档都会被更新。

> **These extra nested documents are hidden; we can’t access them directly**. To update, add, or remove a nested object, we have to reindex the whole document. It’s important to note that, **the result returned by a search request is not the nested object alone; it is the whole document**.

### nested查询
对nested使用普通的查询，只能查询非嵌套field，无法查询nested field。想查询nested field必须使用专用的[nested query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-nested-query.html)。

> **毕竟是以分离的文档存储在segment上的，普通的query不会组装他们，但是nested query会**。

创建一个nested index，父文档为user，嵌套子文档为blogs：
```json
PUT user-blogs-nested
{
  "mappings": {
    "properties": {
      "blogs": {
        "type": "nested" 
      }
    }
  }
}
```
cortana和john各发了两篇blogs：
```json
PUT user-blogs-nested/_doc/1
{
  "user" : "john",
  "blogs" : [
    {
      "name" : "halo",
      "content" :  "halo is amazing"
    },
    {
      "name" : "spartan",
      "content" :  "follow me spartans!"
    }
  ]
}

PUT user-blogs-nested/_doc/2
{
  "user" : "cortana",
  "blogs" : [
    {
      "name" : "halo",
      "content" :  "halo is a weapon"
    },
    {
      "name" : "ai",
      "content" :  "artificial intelligence is the futurn of human being"
    }
  ]
}
```
查看mapping，`GET user-blogs-nested/_mapping`：
```json
{
  "user-blogs-nested" : {
    "mappings" : {
      "properties" : {
        "blogs" : {
          "type" : "nested",
          "properties" : {
            "content" : {
              "type" : "text",
              "fields" : {
                "keyword" : {
                  "type" : "keyword",
                  "ignore_above" : 256
                }
              }
            },
            "name" : {
              "type" : "text",
              "fields" : {
                "keyword" : {
                  "type" : "keyword",
                  "ignore_above" : 256
                }
              }
            }
          }
        },
        "user" : {
          "type" : "text",
          "fields" : {
            "keyword" : {
              "type" : "keyword",
              "ignore_above" : 256
            }
          }
        }
      }
    }
  }
}
```
使用nested query查询这样的文档：blogs（nest field）以halo为名，且内容包含amazing
```json
GET user-blogs-nested/_search
{
  "query": {
    "nested": {
      "path": "blogs",
      "query": {
        "bool": {
          "must": [
            {
              "match": {
                "blogs.name": "halo"
              }
            },
            {
              "match": {
                "blogs.content": "amazing"
              }
            }
          ]
        }
      },
      "inner_hits": {
        "highlight": {
          "fields": {
            "blogs.name": {},
            "blogs.content": {}
          }
        }
      }
    }
  }
}
```
**查询结果显示的是整个完整的逻辑文档（1个父文档john + 2个子文档halo和spartan）**。

有两个类似debug的细节查询：
1. 为了更清楚地知道到底是哪个子文档被匹配上了，所以才显示整个文档：可以使用`inner_hits`显示匹配上的子文档；
2. 进一步，可以使用`highlight`查看该匹配的子文档究竟是哪些地方和搜索匹配上了。

查询结果：
```json
{
  "took" : 1,
  "timed_out" : false,
  "_shards" : {
    "total" : 1,
    "successful" : 1,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 1,
      "relation" : "eq"
    },
    "max_score" : 2.087221,
    "hits" : [
      {
        "_index" : "user-blogs-nested",
        "_type" : "_doc",
        "_id" : "1",
        "_score" : 2.087221,
        "_source" : {
          "user" : "john",
          "blogs" : [
            {
              "name" : "halo",
              "content" : "halo is amazing"
            },
            {
              "name" : "spartan",
              "content" : "follow me spartans!"
            }
          ]
        },
        "inner_hits" : {
          "blogs" : {
            "hits" : {
              "total" : {
                "value" : 1,
                "relation" : "eq"
              },
              "max_score" : 2.087221,
              "hits" : [
                {
                  "_index" : "user-blogs-nested",
                  "_type" : "_doc",
                  "_id" : "1",
                  "_nested" : {
                    "field" : "blogs",
                    "offset" : 0
                  },
                  "_score" : 2.087221,
                  "_source" : {
                    "name" : "halo",
                    "content" : "halo is amazing"
                  },
                  "highlight" : {
                    "blogs.name" : [
                      "<em>halo</em>"
                    ],
                    "blogs.content" : [
                      "halo is <em>amazing</em>"
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    ]
  }
}
```
**如果偏要使用普通查询查nested field会怎样**？

查询非nested field，没有问题，能显示整个文档：
```json
GET user-blogs-nested/_search
{
  "query":{
    "bool":{
      "must":[
        {
          "match":{
            "user":"john"
          }
        }
      ]
    }
  }
}
```
**使用普通查询查找nested field，什么也查不出来**：
```json
GET user-blogs-nested/_search
{
  "query":{
    "bool":{
      "must":[
        {
          "match":{
            "blogs.name":"halo"
          }
        }
      ]
    }
  }
}
```

> 如果既想拥有nested文档的独立子文档特性，又想拥有object可以使用普通查询直接查的特性，可以给nested设置`include_in_root`/`include_in_parent`，把nested子文档的field在root文档/父文档里也存一遍。

### inner hits - debug
使用[inner hits](https://www.elastic.co/guide/en/elasticsearch/reference/current/inner-hits.html)显示匹配上的子文档，对于nested查询和parent child查询来说都非常有用。
    
### 优点
快：
> because of the way that nested objects are indexed, joining the nested documents to the root document at query time is fast—almost as fast as if they were a single document.

当然这个快是相对于parent child join来讲的。**nested文档都放在一个segment上，所以join起来特别快，快到仿佛存的就是一条文档**。parent child因为需要拿着id做进一步的查询，相比之下自然就慢了。

**索引方便**：因为es在逻辑上呈现出来的nested文档其实就是一个文档，所以一次就可以传入整个文档，索引所有的父子文档。

### 缺点
因为segment是只读的，需要更新文档时只能在新的segment里创建文档。又因为nested文档必须把父文档和子文档都存放在同一个segment，**所以更新任何一个子文档或者父文档，就意味着重新索引整个文档到新的segment。所以nested文档不适合子文档频繁更新的情况**。

> 部分更新nested数据需要用到脚本，参考[这篇文章](https://iridakos.com/programming/2019/05/02/add-update-delete-elasticsearch-nested-objects)。

## parent child - 存放于同一shard
**nested文档使用隐式的独立文档存储子文档，parent child则使用一个显式的单独的field指明父子关系，用来关联父子文档**。

**父子文档无论是在物理存储上还是在逻辑呈现上，都是独立的，可以单独索引、单独查询、独立更新**。

父子文档使用一种`type=join`的field标识父子关系：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/parent-join.html
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/parent-child.html

得益于这个映射field，父-子文档关联查询操作也非常快。但是这个映射也对父-子文档关系有个限制条件：**父文档和其所有子文档，都必须要存储在同一个分片中**。

### 存放于同一shard
join比nested的存储要求低一些，只要在同一个shard就行：**只要在同一个shard，就不会跨节点，只要不跨节点，使用映射的id去做父子之间的相互查询还是很快的**。

### 父子查询
依然（因为懒，所以）使用dynamic mapping构建一个index。构建之前，这次提前指定join field：
```
PUT user-blogs-join
{
  "mappings": {
    "properties": {
      "user_blog": {
        "type": "join",
        "relations": {
          "user": "blog"
        }
      }
    }
  }
}
```
然后放入两个user，指定他们的类型为父类型user：
```
PUT user-blogs-join/_doc/u1
{
  "user" : "john",
  "user_blog": "user"
}

PUT user-blogs-join/_doc/u2
{
  "user" : "cortana",
  "user_blog": "user"
}
```
再放一些blog，类型为blog，同时指定parent的id，指明从属关系：
```
PUT user-blogs-join/_doc/b1?routing=u1
{
    "blog" : {
      "name" : "halo",
      "content" :  "halo is amazing"
    },
    "user_blog": {
      "name": "blog",
      "parent": "u1"
    }
}

PUT user-blogs-join/_doc/b2?routing=u1
{
    "blog" : {
      "name" : "spartan",
      "content" :  "follow me spartans!"
    },
    "user_blog": {
      "name": "blog",
      "parent": "u1"
    }
}

PUT user-blogs-join/_doc/b3?routing=u2
{
    "blog" : {
      "name" : "halo",
      "content" :  "halo is a weapon"
    },
    "user_blog": {
      "name": "blog",
      "parent": "u2"
    }
}

PUT user-blogs-join/_doc/b4?routing=u2
{
    "blog" : {
      "name" : "ai",
      "content" :  "artificial intelligence is the futurn of human being"
    },
    "user_blog": {
      "name": "blog",
      "parent": "u2"
    }
}
```
**存储子文档的时候必须指定routing，否则会报错**：`[routing] is missing for join field [user_blog]`。

子文档routing的值设为父文档的routing，使得他们存储在同一个分片上。

看看现在的mapping：
```
{
  "user-blogs-join" : {
    "mappings" : {
      "properties" : {
        "blog" : {
          "properties" : {
            "content" : {
              "type" : "text",
              "fields" : {
                "keyword" : {
                  "type" : "keyword",
                  "ignore_above" : 256
                }
              }
            },
            "name" : {
              "type" : "text",
              "fields" : {
                "keyword" : {
                  "type" : "keyword",
                  "ignore_above" : 256
                }
              }
            }
          }
        },
        "user" : {
          "type" : "text",
          "fields" : {
            "keyword" : {
              "type" : "keyword",
              "ignore_above" : 256
            }
          }
        },
        "user_blog" : {
          "type" : "join",
          "eager_global_ordinals" : true,
          "relations" : {
            "user" : "blog"
          }
        }
      }
    }
  }
}
```
父子文档的查询主要是两种：
1. 使用子文档查询父文档：`has_child`；
2. 使用父文档查询子文档：`has_parent`；

> **也可以直接根据父文档条件查询父文档、根据子文档条件查询子文档。因为他们都是对上层可见的独立的文档。所以不像nested文档，使用普通query是不可查nested field的**。

使用子文档查父文档：
```
GET user-blogs-join/_search
{
  "query": {
    "has_child": {
      "type": "blog",
      "query": {
        "match": {
          "blog.content": "amazing"
        }
      }
    }
  }
}
```
**查询结果只显示父文档john**，因为它本身就是一个独立的文档，**不像nested显示的是整个父子文档合在一起的大文档**：
```
{
  "took" : 602,
  "timed_out" : false,
  "_shards" : {
    "total" : 1,
    "successful" : 1,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 1,
      "relation" : "eq"
    },
    "max_score" : 1.0,
    "hits" : [
      {
        "_index" : "user-blogs-join",
        "_type" : "_doc",
        "_id" : "u1",
        "_score" : 1.0,
        "_source" : {
          "user" : "john",
          "user_blog" : "user"
        }
      }
    ]
  }
}
```

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/has-child.html
- https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-has-child-query.html

使用子文档查父文档：
```json
GET user-blogs-join/_search
{
  "query": {
    "has_parent": {
      "parent_type": "user",
      "query": {
        "match": {
          "user": "cortana"
        }
      }
    }
  }
}
```
查询结果只显示cortana发表的所有blog，他们都是独立的子文档：
```json
{
  "took" : 0,
  "timed_out" : false,
  "_shards" : {
    "total" : 1,
    "successful" : 1,
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
        "_index" : "user-blogs-join",
        "_type" : "_doc",
        "_id" : "b3",
        "_score" : 1.0,
        "_routing" : "u2",
        "_source" : {
          "blog" : {
            "name" : "halo",
            "content" : "halo is a weapon"
          },
          "user_blog" : {
            "name" : "blog",
            "parent" : "u2"
          }
        }
      },
      {
        "_index" : "user-blogs-join",
        "_type" : "_doc",
        "_id" : "b4",
        "_score" : 1.0,
        "_routing" : "u2",
        "_source" : {
          "blog" : {
            "name" : "ai",
            "content" : "artificial intelligence is the futurn of human being"
          },
          "user_blog" : {
            "name" : "blog",
            "parent" : "u2"
          }
        }
      }
    ]
  }
}
```
- https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-has-parent-query.html

还可以使用bool查询，**在使用子文档查询父文档的同时，给父文档加上过滤条件**：
```json
GET user-blogs-join/_search
{
  "query": {
    "bool": {
      "filter": [
        {
          "match": {
            "user": "cortana"
          }
        }
      ],
      "must": [
        {
          "has_child": {
            "type": "blog",
            "query": {
              "match": {
                "blog.content": "halo"
              }
            }
          }
        }
      ]
    }
  }
}
```
只查询名字含有cortana且发的blog内容包含halo的user。

### inner hits
和nested查询一样，既然根据子文档查父文档，就可以使用inner hits + highlight查看到底是哪个子文档的哪个地方匹配上了搜索条件，从而搜索出了父文档：
```json
GET user-blogs-join/_search
{
  "query": {
    "has_child": {
      "type": "blog",
      "score_mode": "sum", 
      "query": {
        "match": {
          "blog.content": "halo"
        }
      },
      "inner_hits": {
        "highlight": {
          "fields": {
            "blog.content": {}
          }
        }
      }
    }
  }
}
```
结果显示：
```
{
  "took" : 2,
  "timed_out" : false,
  "_shards" : {
    "total" : 1,
    "successful" : 1,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 2,
      "relation" : "eq"
    },
    "max_score" : 0.7721133,
    "hits" : [
      {
        "_index" : "user-blogs-join",
        "_type" : "_doc",
        "_id" : "u1",
        "_score" : 0.7721133,
        "_source" : {
          "user" : "john",
          "user_blog" : "user"
        },
        "inner_hits" : {
          "blog" : {
            "hits" : {
              "total" : {
                "value" : 1,
                "relation" : "eq"
              },
              "max_score" : 0.7721133,
              "hits" : [
                {
                  "_index" : "user-blogs-join",
                  "_type" : "_doc",
                  "_id" : "b1",
                  "_score" : 0.7721133,
                  "_routing" : "u1",
                  "_source" : {
                    "blog" : {
                      "name" : "halo",
                      "content" : "halo is amazing"
                    },
                    "user_blog" : {
                      "name" : "blog",
                      "parent" : "u1"
                    }
                  },
                  "highlight" : {
                    "blog.content" : [
                      "<em>halo</em> is amazing"
                    ]
                  }
                }
              ]
            }
          }
        }
      },
      {
        "_index" : "user-blogs-join",
        "_type" : "_doc",
        "_id" : "u2",
        "_score" : 0.6931471,
        "_source" : {
          "user" : "cortana",
          "user_blog" : "user"
        },
        "inner_hits" : {
          "blog" : {
            "hits" : {
              "total" : {
                "value" : 1,
                "relation" : "eq"
              },
              "max_score" : 0.6931471,
              "hits" : [
                {
                  "_index" : "user-blogs-join",
                  "_type" : "_doc",
                  "_id" : "b3",
                  "_score" : 0.6931471,
                  "_routing" : "u2",
                  "_source" : {
                    "blog" : {
                      "name" : "halo",
                      "content" : "halo is a weapon"
                    },
                    "user_blog" : {
                      "name" : "blog",
                      "parent" : "u2"
                    }
                  },
                  "highlight" : {
                    "blog.content" : [
                      "<em>halo</em> is a weapon"
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    ]
  }
}
```
john和cortana都发了一条内容含有halo的blog，所以他们俩都被匹配到了。

### 打分
根据子文档查询父文档，可能会查到一堆子文档，但是最终显示的是父文档。子文档的匹配分最终怎么反馈到父文档呢？`score_mode`属性：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-has-child-query.html

默认`score_mode=none`，意味着子文档的得分不计入父文档，不给父文档打分。但是也可以用sum/avg/max/min等将子文档的得分合并文父文档得分。如果使用avg，可以考虑使用`min_children`属性对子文档出现的门槛进行一定的限定。

**甚至可以使用`function_score`使用脚本修改分值**：
```
GET user-blogs-join/_search
{
  "query": {
    "bool": {
      "filter": [
        {
          "match": {
            "user": "john cortana"
          }
        }
      ],
      "must": [
        {
          "function_score": {
            "query": {
              "has_child": {
                "type": "blog",
                "score_mode": "sum", 
                "query": {
                  "match": {
                    "blog.content": "halo"
                  }
                }
              }
            },
            "script_score": {
              "script": "_score * doc['user.keyword'].value.length()"
            },
            "score_mode": "multiply"
          }
        }
      ]
    }
  }
}
```
显然，在分之差不多的情况下，cortana名字更长，最终得分更高：
```
{
  "took" : 6,
  "timed_out" : false,
  "_shards" : {
    "total" : 1,
    "successful" : 1,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 2,
      "relation" : "eq"
    },
    "max_score" : 3.3631706,
    "hits" : [
      {
        "_index" : "user-blogs-join",
        "_type" : "_doc",
        "_id" : "u2",
        "_score" : 3.3631706,
        "_source" : {
          "user" : "cortana",
          "user_blog" : "user"
        }
      },
      {
        "_index" : "user-blogs-join",
        "_type" : "_doc",
        "_id" : "u1",
        "_score" : 2.384636,
        "_source" : {
          "user" : "john",
          "user_blog" : "user"
        }
      }
    ]
  }
}
```

### 错误的routing
如果routing指定错了怎么办？parent设定为u1，但是routing却指定为了u2：
```
PUT user-blogs-join/_doc/b1?routing=u2
{
    "blog" : {
      "name" : "halo",
      "content" :  "[duplicated test] halo is amazing"
    },
    "user_blog": {
      "name": "blog",
      "parent": "u1"
    }
}
```
也就是说，这个属于u1的blog有可能存错分片了。如果u2和u1在同一个分片上，那么还是能够查到这个子文档blog的。如果不在一个分片上，我猜应该就查不到了。

### 多级父子关系
join和nested一样，可以扩展到多级：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/parent-join.html#_multiple_levels_of_parent_join

### 全局序数
join使用了doc_values
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/parent-child.html

> 父-子文档ID映射存储在 Doc Values 中。当映射完全在内存中（page cache）时， Doc Values 提供对映射的快速处理能力，另一方面当映射非常大时，可以通过溢出到磁盘提供足够的扩展能力

**同时使用全局序数Global Ordinals优化doc_values存储大小**：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/parent-child-performance.html
- Global Ordinals：https://www.elastic.co/guide/cn/elasticsearch/guide/current/preload-fielddata.html#global-ordinals

但是用的时候，global ordinals必须加载到内存里，这就涉及到一个取舍：
1. 是每次数据变更都加载到内存里？（预加载）
2. 还是在第一次查询的时候再加载到内存里？（懒加载）

预加载会导致refresh的负担加重，但是query的时候负担减轻。和spring bean的预加载是一样的。**懒加载只适合那种数据频繁变更，但是不怎么查询的情况**。

一般情况下，为了降低第一次查询时的延迟，可以把Global Ordinals预加载。**如果它是fielddata，就预加载到内存；如果它是doc_values，就预加载到page cache**：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/preload-fielddata.html#eager-global-ordinals

> 这种情况下，fielddata 没有载入到内存中，而是 doc values 被载入到文件系统缓存中。

在老的版本，父子索引的Global Ordinals是懒加载：
- https://www.elastic.co/guide/en/elasticsearch/reference/2.3/mapping-parent-field.html#_global_ordinals

但是在es7里，已经是提前预加载了：
- https://www.elastic.co/guide/en/elasticsearch/reference/7.17/parent-join.html#_global_ordinals

> 过期文档害死人啊……

- https://www.elastic.co/guide/en/elasticsearch/reference/current/parent-join.html#_global_ordinals

从我们设置的索引里也可以看出来，设置索引的时候没有指定`eager_global_ordinals`，但是查看mapping的时候，`eager_global_ordinals=true`：
```
        "user_blog" : {
          "type" : "join",
          "eager_global_ordinals" : true,
          "relations" : {
            "user" : "blog"
          }
        }
```

### 缺点
相对于nested来讲，会慢一些。毕竟需要通过id再查一次父文档或者子文档。但是还好，因为强制被扔到了同一个分片上，这种查询是不跨分片的，所以不跨节点，没有网络开销。

### 优点
1. 独立。父文档和子文档均是独立文档，所以可以独立增删、更新。**尤其适合子文档个数远大于父文档，或者子文档频繁更新的情况，这样就只会更新单独的一条子文档**。不像nested，整个父文档和所有子文档都要重新构建到新的segment；
2. 异步。索引子文档的时候，父文档未必一定要存在。

可以认为：
- **nested是索引阶段的连接**：查询的时候就不用连接了。但是一旦数据变了，需要重新索引，所以重新连接；
- **parent-child join是查询阶段的连接**：所以查询会稍慢一些，但是索引数据的时候很快，没必要在索引的时候连接数据；

### reindex: merge two indices
[Elasticsearch：alias、reindex、task]({% post_url 2022-05-02-es-reindex-task %})已经介绍过reindex了，除了单个索引的版本更新需要用到reindex，两个单索引合并为一个父子索引也可以使用reindex。

假设原有两个独立的索引：
1. user；
2. blog；

现在要支持按照blog搜索user，或者按照user搜索blog，需要构建一个父子关系索引。但是如何构建这种索引？

我摸索出来的一种比较合理的方式是：
1. 原有两个索引不变；
2. 构建新的user-blog父子关系索引；
3. 将数据从user和blog定期全量或增量使用reindex命令索引到父子关系索引里；

**user-blog父子关系索引的mapping只有三个field**：
1. `user`：object类型，代表user索引的所有field；
2. `blog`：object类型，代表blog索引的所有field；
3. `user_blog`：join类型，代表user和blog的父子关系；

**通过user和blog这两个顶层field，把原来两个索引下的field分开存放，以免混在一起过于混乱**。为了达到这种效果，reindex的user和blog的时候，需要使用script改一下他们的数据结构，让所有的user field外层加上user，所有的blog field外层加上field。

reindex user to user-blog：
```
POST _reindex?wait_for_completion=false
{
  "source": {
    "index": "user"
  },
  "dest": {
    "index": "user-blog"
  },
  "script": {
    "lang": "painless",
    "source": """
      def userId = ctx._source.user_id;
      ctx._id = userId;
      ctx._routing = userId;
      ctx._source = [params.outer_field: ctx._source];
      ctx._source.user_blog = params.parent
    """,
    "params": {
      "outer_field": "user",
      "parent": {
        "name": "user"
      }
    }
  }
}
```
1. user的`_routing`未必要和`_id`一致，但下面blog类型的`_routing`要和user的`_id`一致；
2. 增加新的field：`user_blog=user`；
3. **给user的所有field添加一层嵌套，外层field为`user`**：`ctx._source = [params.outer_field: ctx._source];`，**实际就是把原有的field和value作为新field的value，嵌套为一个map**；

reindex blog to user-blog：
```
POST _reindex?wait_for_completion=false
{
  "source": {
    "index": "blog",
    "query": {
      "range": {
        "timestamp": {
          "gte": 1609430400000
        }
      }
    }
  },
  "dest": {
    "index": "user-blog"
  },
  "script": {
    "lang": "painless",
    "source": """
      def id = ctx._source.id;
      def userId = ctx._source.userId;
      ctx._id = String.valueOf(userId) + "-" + id;
      ctx._routing = userId;
      ctx._source = [params.outer_field: ctx._source];
      ctx._source.kol_media = ['name': params.join_type, 'parent': userId]
    """,
    "params": {
      "outer_field": "blog",
      "join_type": "blog"
    }
  }
}
```
1. `_routing`要和user类型的`_id`相同，至于blog类型的`_id`用什么并不重要，不重复就行；
2. 增加新的field：`user_blog=blog`；
3. 给blog的所有field添加一层嵌套，外层field为`blog`；

script的painless语法取自Java语法的子集，并做了一些加强，提高可读性，减少样板代码：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-scripting-painless.html

制定方案时查阅的参考资料：
- 父子文档可以reindex而来：https://stackoverflow.com/a/59879035/7676237
- 使用reindex的script，通过脚本修改reindex的对象：https://stackoverflow.com/a/50607003/7676237
- “嵌套”原有的父与子：https://www.elastic.co/guide/en/elasticsearch/reference/current/properties.html
- 使用map语法构建object对象：https://stackoverflow.com/a/49378001/7676237
- painless脚本：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-scripting-using.html
- ctx对象：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-scripting-fields.html
- reindex context: https://www.elastic.co/guide/en/elasticsearch/painless/current/painless-reindex-context.html


# 多对多
多对多的场景相对较少一些。**但是es本身支持不了多对多的关系，因为多对多就无法保证所有的文档都在同一个节点内，所以跨网络的连接无法避免**：
1. 假设user u1的blog是b1/b2，为了避免网络开销，他们要在一个节点上；
2. 假设b2同时属于u2，那b2要和u2在同一节点上；
3. 但是u1和u2未必在同一节点上；

即使把u1和u2放在同一个节点，假设后来又增加了b3，它的父类是u1和u3，又怎么保证u3也和b1、b2在同一个节点呢？如果把u3也强制放到u1和u2所在的节点，**这样放下去的结果只有一个：所有的数据都在同一个节点**。那es就变成单点而不是分布式的了。

## 应用端连接
开发者自己在应用端做连接是一个方法，但是能力非常有限，只适用于数据量很少的情况。一旦数据量大起来：
1. 应用端做连接要把所有数据都加载在应用的内存里，内存占用是不可接受的；
2. 可能需要根据连接结果回查数据库，网络开销导致的时延也是不可接受的；

## 反规范化（冗余） - 多对多的唯一解
mysql这种关系型数据库讲究规范化normalization，在设计数据表的时候尽量使用范式来减少数据冗余。

es这种非关系型数据库不讲究范式，**甚至有些时候故意造成数据冗余，以换来查询上的便利。本质上这可以看作是一种空间换时间的策略**：使用复制数据来避免昂贵的连接操作，避免网络开销，就可以查的非常快。而对于分布式系统来讲，磁盘不是事儿，大不了再加个节点。

所以这种模式又称为denormalizing。

denormalizing的缺点在于数据会有多份，不好维护。所以更适合以下场景：
- 数据少；
- 内容不频繁变更；

虽然denormalizing也可以处理一对多的关系，但是因为数据维护上的不方便，一般一对多的关系不使用denormalizing。**它的优势在于：denormalizing是解决多对多关系的唯一方式——把多对多转换为一对多，转换的方式就是让一方数据变得冗余**、

比如上述user和blog多对多的情况，可以把隶属于多个user的blog非规范化，存储多份。

> 但整体来看还是比较麻烦的，毕竟同一个查询可能会查出来好几个一毛一样的blog，还得考虑使用id去重。

# 感想
了解完es对关系型数据的支持，感觉整个人对关系型数据库和非关系型数据库的理解又上升了一个档次！

1. 用途：理解数据库的设计用途和初衷，是学习理解这个数据库非常重要的部分，毕竟它所有的功能都是为了这个初衷而设计的；
    > 不像现在市场上的商业app，不管是啥做到最后都做成直播、带货了……
1. 因地制宜：不同的系统因为不同的设计用途，带来了不同的特性。而在支持理念上比较相似的功能的时候，不同的特性往往导致大家的实现千差万别，但其中很重要的就是：按照自己的特性，因地制宜设计和实现功能。在分布式数据库里，join如果引入网络开销必然是十分耗时的，而es作为一个快速搜索数据库又不能允许这种非常慢的搜索，那怎么办？**那就不要让有关系的数据跨节点**！所以es提出的nested（同一segment）和parent join（同一shard），都是基于这个前提的。

做软件要牢记自己的初衷，也要能想清楚自己的特性，才能提出适合自己的做法，做出有个性的东西。
