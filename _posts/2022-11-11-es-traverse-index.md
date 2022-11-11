---
layout: post
title: "Elasticsearch：遍历索引"
date: 2022-11-11 02:03:58 +0800
categories: elasticsearch
tags: elasticsearch
---

今天干了一件蠢事：遍历索引，一时偷懒，索引的条目也还在可接受范围内，所以使用page翻页遍历所有数据，结果翻车了~

1. Table of Contents, ordered
{:toc}

# 翻页遍历
使用spring data elasticsearch给数据做翻页遍历。因为不需要考虑先后，只是需要遍历一下，所以page就没指定搜索条件，也没有指定排序条件：
```
        Pageable pageReq = PageRequest.of(0, 1000);
        Page<Entity> page = null;

        log.info("total kol to process={} for index={}", x, y);

        do {
            log.info("start to process page={}", pageReq);
            try {
                page = xxxRepository.findAll(pageReq);
                batchProcess(page.toList());
            } catch (Exception e) {
                log.error("search/update elasticsearch data error for page={}", pageReq, e);
            }

            // next page
            pageReq = pageReq.next();
        } while (page != null && !page.isEmpty());
```
结果，的确是一页一页查了n条数据，和index里doc的数量相同。但是，处理结果并非不重不漏：有的doc被处理了两遍，有的没有被处理到。

上述现象是从log日志里看到的，有的doc id出现了多次，有的doc id根本就没出现。为什么？

# 如果文档得分相同，怎么排序？
因为没指定搜索条件，所以默认使用的是match_all搜索，所有文档的返回分数都是1。相同得分的文档的返回顺序是固定的吗？不是的——

虽然第一次拿[0, 1000)条，第二次拿[1000, 2000)条，但是并不能保证第二次查的时候，出现在第一次前一千条里的文档没有出现在第二次的一千条里，这样有的文档就被重复处理了。自然有的文档就被漏掉了。

## tie breaker
**如果文档得分相同，elasticsearch会找一个tie breaker——lucene id，为返回结果排序。但是，相同数据分片的主分片和各个replica之间的lucene id是不一样的**，所以如果请求到了不同的分片上，排序结果是不一样的。

> **Elasticsearch uses Lucene’s internal doc IDs as tie-breakers. These internal doc IDs can be completely different across replicas of the same data**. When paging search hits, you might occasionally see that documents with the same sort values are not ordered consistently.

比如search_all，所有文档的得分都是1，且它默认从shard 0取所有的数据（可以通过explain看到），所以同样的查询到了不同的node，读了不同的shard 0，返回的结果是不定的：
```
GET stored_kol/_search
{
  "_source": "nickname",
  "size": 3,
  "explain": true
}
```
实验证明：**只有在没有replica的情况下，相同得分的文档返回的顺序才是永远一样的！**

- https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html

# 解决方法
解决办法也很好理解：让文档之间有严格序。

## 手动指定sort
在原有page上加了个sort在unique字段上，以保证数据有序，每一条数据都能遍历到：
```
PageRequest.of(0, 1000, Sort.by("user_id").descending())
```

## search_after
**但是既然免不了使用sort，为什么不用[search_after]({% post_url 2022-05-08-es-performance %})呢？使用search_after翻页，不仅比分页效率高，写起来page似乎还简单些，不用指定from，size了，也不用算下一页的偏移了，指定一个`search_after`就够了。**

但是无论是普通sort还是search_after的sort，一定要使用一个天生unique的field，或者多指定几个备选sort以得到一个唯一序，否则还是可能重或漏。

首次查询：
```
GET twitter/_search
{
    "query": {
        "match": {
            "title": "elasticsearch"
        }
    },
    "sort": [
        {"date": "asc"},
        {"tie_breaker_id": "asc"}      
    ]
}
```
获取最后一个sort，进行下一个查询：
```
GET twitter/_search
{
    "query": {
        "match": {
            "title": "elasticsearch"
        }
    },
    "search_after": [1463538857, "654323"],
    "sort": [
        {"date": "asc"},
        {"tie_breaker_id": "asc"}
    ]
}
```
直到没有结果返回。

**search_after的本质就是：elasticsearch先把文档排好序，再把指定sort后的文档返回给客户端。**

比如，
1. 如果把第二条文档的sort放到下一次请求的search_after，会从第三条文档开始返回数据；
2. 如果自己随便造一个sort的值放到下一次请求的search_after，会从比造的值大的那一条文档开始返回数据；

> 所以search_after返回快慢的一个重要影响因素就是：提供的sort字段对elasticsearch来说好不好排序。见下文`_shard_doc`。

## search_after + pit in time
但是上述方式只能在数据不发生变动的情况下生效。如果一条数据发生了增删改，比如user_id变了（当然这个不常见），一条排在后面的文档可能在下一次查询的时候，跑到当前search_after前头去了，导致它没有被处理到。

为了避免这种干扰，可以[使用PIT，给当前数据来个快照]({% post_url 2022-05-08-es-performance %})。

先获取pit id：
```
POST stored_kol/_pit?keep_alive=10m
```
pit id：
```
{
  "id": "48myAw8Nc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBRZYcXo0ZEdVMlNHQ24zeGlkb1A2dWJnAAAAAAAAbcXqFnM3TlZzeXpRVG15b21MRWVxdzFYTGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQQWR2lDLXIwTG1UeWkxaGIxbmZWY3ZtdwAAAAAAAFfUZRZEdDBHaUUzYlRkeW0xR3hHSlkxQUt3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEHFkdpQy1yMExtVHlpMWhiMW5mVmN2bXcAAAAAAABX1GcWRHQwR2lFM2JUZHltMUd4R0pZMUFLdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBhZHaUMtcjBMbVR5aTFoYjFuZlZjdm13AAAAAAAAV9RmFkR0MEdpRTNiVGR5bTFHeEdKWTFBS3cADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQkWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi-xZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEIFjZXaUo4V0VFUzYtaTNEQkNONmdBRWcAAAAAAABZq00WN0h6VkhHV3pTRTYyYnBnQmNUMUdsZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BCxZvYzR5OUE1SlFjZWxyVktMdmVMbXhnAAAAAAAASYETFlVTNlQwRGRrUzhlNHRoeWVjanpodXcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQoWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi_BZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUENFm9jNHk5QTVKUWNlbHJWS0x2ZUxteGcAAAAAAABJgRQWVVM2VDBEZGtTOGU0dGh5ZWNqemh1dwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BDBZlMDhPZEhQcVE0T1JlTkZLNHFTNE5RAAAAAAAAX0hzFkVKTmZaZXloUnlDX0puRlhCNThxbHcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQ4Wb2M0eTlBNUpRY2VsclZLTHZlTG14ZwAAAAAAAEmBFRZVUzZUMERka1M4ZTR0aHllY2p6aHV3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEBFmUwOE9kSFBxUTRPUmVORks0cVM0TlEAAAAAAABfSHIWRUpOZlpleWhSeUNfSm5GWEI1OHFsdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BABY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWatLFjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQMWNldpSjhXRUVTNi1pM0RCQ042Z0FFZwAAAAAAAFmrTBY3SHpWSEdXelNFNjJicGdCY1QxR2xnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUECFlhxejRkR1UyU0dDbjN4aWRvUDZ1YmcAAAAAAABtxekWczdOVnN5elFUbXlvbUxFZXF3MVhMZwABFjdqTW40SGxKVEF5NTVrT1VIdVYzLUEAAA=="
}
```

> 之后查的时候就不用指定索引了，把pit id带上就行了。
>
> [**A search request with the pit parameter must not specify index, routing, and preference as these parameters are copied from the point in time.**](https://www.elastic.co/guide/en/elasticsearch/reference/8.3/point-in-time-api.html)

第一次查询，**给原本的search_after查询加上pit id，其他不变**：
```
GET /_search
{
  "pit": {
    "id": "48myAw8Nc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBRZYcXo0ZEdVMlNHQ24zeGlkb1A2dWJnAAAAAAAAbcXqFnM3TlZzeXpRVG15b21MRWVxdzFYTGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQQWR2lDLXIwTG1UeWkxaGIxbmZWY3ZtdwAAAAAAAFfUZRZEdDBHaUUzYlRkeW0xR3hHSlkxQUt3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEHFkdpQy1yMExtVHlpMWhiMW5mVmN2bXcAAAAAAABX1GcWRHQwR2lFM2JUZHltMUd4R0pZMUFLdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBhZHaUMtcjBMbVR5aTFoYjFuZlZjdm13AAAAAAAAV9RmFkR0MEdpRTNiVGR5bTFHeEdKWTFBS3cADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQkWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi-xZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEIFjZXaUo4V0VFUzYtaTNEQkNONmdBRWcAAAAAAABZq00WN0h6VkhHV3pTRTYyYnBnQmNUMUdsZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BCxZvYzR5OUE1SlFjZWxyVktMdmVMbXhnAAAAAAAASYETFlVTNlQwRGRrUzhlNHRoeWVjanpodXcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQoWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi_BZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUENFm9jNHk5QTVKUWNlbHJWS0x2ZUxteGcAAAAAAABJgRQWVVM2VDBEZGtTOGU0dGh5ZWNqemh1dwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BDBZlMDhPZEhQcVE0T1JlTkZLNHFTNE5RAAAAAAAAX0hzFkVKTmZaZXloUnlDX0puRlhCNThxbHcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQ4Wb2M0eTlBNUpRY2VsclZLTHZlTG14ZwAAAAAAAEmBFRZVUzZUMERka1M4ZTR0aHllY2p6aHV3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEBFmUwOE9kSFBxUTRPUmVORks0cVM0TlEAAAAAAABfSHIWRUpOZlpleWhSeUNfSm5GWEI1OHFsdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BABY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWatLFjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQMWNldpSjhXRUVTNi1pM0RCQ042Z0FFZwAAAAAAAFmrTBY3SHpWSEdXelNFNjJicGdCY1QxR2xnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUECFlhxejRkR1UyU0dDbjN4aWRvUDZ1YmcAAAAAAABtxekWczdOVnN5elFUbXlvbUxFZXF3MVhMZwABFjdqTW40SGxKVEF5NTVrT1VIdVYzLUEAAA==",
    "keep_alive": "10m"
  },
  "sort": [
    {
      "fan_num": {
        "order": "asc"
      }
    }
  ], 
  "_source": "nickname",
  "explain": true,
  "size": 3
}
```

前面说过，**如果一个sort翻页没有做到下面两点，最终遍历的结果一定会有重有漏**：
1. sort里要有tie breaker；
2. 或者在unique field上sort；

> **If you cannot use a PIT, we recommend that you include a tiebreaker field in your sort. This tiebreaker field should contain a unique value for each document. If you don’t include a tiebreaker field, your paged results could miss or duplicate hits.**

**用了pit之后，即使sort的field不是唯一的也没关系，pit默认会加上一个tie breaker：`_shard_doc`，也可以在sort里手动显式指定它：**
> **All PIT search requests add an implicit sort tiebreaker field called `_shard_doc`, which can also be provided explicitly.**

对于上面的请求，**返回结果会默认按照fan_num升序排，同时在fan_num相同时，使用`_shard_doc`作为tie breaker**：
```
{
  "pit_id" : "48myAw8Nc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBRZYcXo0ZEdVMlNHQ24zeGlkb1A2dWJnAAAAAAAAbcXqFnM3TlZzeXpRVG15b21MRWVxdzFYTGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQQWR2lDLXIwTG1UeWkxaGIxbmZWY3ZtdwAAAAAAAFfUZRZEdDBHaUUzYlRkeW0xR3hHSlkxQUt3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEHFkdpQy1yMExtVHlpMWhiMW5mVmN2bXcAAAAAAABX1GcWRHQwR2lFM2JUZHltMUd4R0pZMUFLdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBhZHaUMtcjBMbVR5aTFoYjFuZlZjdm13AAAAAAAAV9RmFkR0MEdpRTNiVGR5bTFHeEdKWTFBS3cADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQkWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi-xZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEIFjZXaUo4V0VFUzYtaTNEQkNONmdBRWcAAAAAAABZq00WN0h6VkhHV3pTRTYyYnBnQmNUMUdsZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BCxZvYzR5OUE1SlFjZWxyVktMdmVMbXhnAAAAAAAASYETFlVTNlQwRGRrUzhlNHRoeWVjanpodXcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQoWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi_BZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUENFm9jNHk5QTVKUWNlbHJWS0x2ZUxteGcAAAAAAABJgRQWVVM2VDBEZGtTOGU0dGh5ZWNqemh1dwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BDBZlMDhPZEhQcVE0T1JlTkZLNHFTNE5RAAAAAAAAX0hzFkVKTmZaZXloUnlDX0puRlhCNThxbHcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQ4Wb2M0eTlBNUpRY2VsclZLTHZlTG14ZwAAAAAAAEmBFRZVUzZUMERka1M4ZTR0aHllY2p6aHV3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEBFmUwOE9kSFBxUTRPUmVORks0cVM0TlEAAAAAAABfSHIWRUpOZlpleWhSeUNfSm5GWEI1OHFsdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BABY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWatLFjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQMWNldpSjhXRUVTNi1pM0RCQ042Z0FFZwAAAAAAAFmrTBY3SHpWSEdXelNFNjJicGdCY1QxR2xnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUECFlhxejRkR1UyU0dDbjN4aWRvUDZ1YmcAAAAAAABtxekWczdOVnN5elFUbXlvbUxFZXF3MVhMZwABFjdqTW40SGxKVEF5NTVrT1VIdVYzLUEAAA==",
  "took" : 17,
  "timed_out" : false,
  "_shards" : {
    "total" : 15,
    "successful" : 15,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 10000,
      "relation" : "gte"
    },
    "max_score" : null,
    "hits" : [
      {
        "_shard" : "[stored_kol_v8][0]",
        "_node" : "6WiJ8WEES6-i3DBCN6gAEg",
        "_index" : "stored_kol_v8",
        "_type" : "_doc",
        "_id" : "4084456",
        "_score" : null,
        "_source" : {
          "nickname" : "حمـوديـ  Fm ."
        },
        "sort" : [
          0,
          174
        ],
        "_explanation" : {
          "value" : 1.0,
          "description" : "*:*",
          "details" : [ ]
        }
      },
      {
        "_shard" : "[stored_kol_v8][0]",
        "_node" : "6WiJ8WEES6-i3DBCN6gAEg",
        "_index" : "stored_kol_v8",
        "_type" : "_doc",
        "_id" : "4113192",
        "_score" : null,
        "_source" : {
          "nickname" : "Lumbre Music"
        },
        "sort" : [
          0,
          838
        ],
        "_explanation" : {
          "value" : 1.0,
          "description" : "*:*",
          "details" : [ ]
        }
      },
      {
        "_shard" : "[stored_kol_v8][0]",
        "_node" : "6WiJ8WEES6-i3DBCN6gAEg",
        "_index" : "stored_kol_v8",
        "_type" : "_doc",
        "_id" : "4123462",
        "_score" : null,
        "_source" : {
          "nickname" : "Adnan Paint"
        },
        "sort" : [
          0,
          947
        ],
        "_explanation" : {
          "value" : 1.0,
          "description" : "*:*",
          "details" : [ ]
        }
      }
    ]
  }
}
```

> 所以现在sort里多了一个`_shard_doc`值，变成了两个值。

下一次查的时候，要把最后一个文档的sort的值（fan_num、`_shard_doc`）指定到下一次请求`search_after`，**同时别忘了把上次返回的pit id更新到这次的请求里**：
```
GET /_search
{
  "pit": {
    "id": "48myAw8Nc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBRZYcXo0ZEdVMlNHQ24zeGlkb1A2dWJnAAAAAAAAbcXqFnM3TlZzeXpRVG15b21MRWVxdzFYTGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQQWR2lDLXIwTG1UeWkxaGIxbmZWY3ZtdwAAAAAAAFfUZRZEdDBHaUUzYlRkeW0xR3hHSlkxQUt3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEHFkdpQy1yMExtVHlpMWhiMW5mVmN2bXcAAAAAAABX1GcWRHQwR2lFM2JUZHltMUd4R0pZMUFLdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBhZHaUMtcjBMbVR5aTFoYjFuZlZjdm13AAAAAAAAV9RmFkR0MEdpRTNiVGR5bTFHeEdKWTFBS3cADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQkWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi-xZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEIFjZXaUo4V0VFUzYtaTNEQkNONmdBRWcAAAAAAABZq00WN0h6VkhHV3pTRTYyYnBnQmNUMUdsZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BCxZvYzR5OUE1SlFjZWxyVktMdmVMbXhnAAAAAAAASYETFlVTNlQwRGRrUzhlNHRoeWVjanpodXcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQoWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRi_BZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUENFm9jNHk5QTVKUWNlbHJWS0x2ZUxteGcAAAAAAABJgRQWVVM2VDBEZGtTOGU0dGh5ZWNqemh1dwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BDBZlMDhPZEhQcVE0T1JlTkZLNHFTNE5RAAAAAAAAX0hzFkVKTmZaZXloUnlDX0puRlhCNThxbHcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQ4Wb2M0eTlBNUpRY2VsclZLTHZlTG14ZwAAAAAAAEmBFRZVUzZUMERka1M4ZTR0aHllY2p6aHV3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEBFmUwOE9kSFBxUTRPUmVORks0cVM0TlEAAAAAAABfSHIWRUpOZlpleWhSeUNfSm5GWEI1OHFsdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BABY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWatLFjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQMWNldpSjhXRUVTNi1pM0RCQ042Z0FFZwAAAAAAAFmrTBY3SHpWSEdXelNFNjJicGdCY1QxR2xnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUECFlhxejRkR1UyU0dDbjN4aWRvUDZ1YmcAAAAAAABtxekWczdOVnN5elFUbXlvbUxFZXF3MVhMZwABFjdqTW40SGxKVEF5NTVrT1VIdVYzLUEAAA==",
    "keep_alive": "10m"
  },
  "sort": [
    {
      "fan_num": {
        "order": "asc"
      }
    }
  ], 
  "search_after": [
    0,
    947
  ],
  "_source": "nickname",
  "explain": true
}
```
如果把上一次sort里的`_shard_doc`值去掉，只留下0，会从fan_num=1的doc返回。因为有那么多fan_num=0的文档，没有`shard_doc`作为第二顺位帮忙指定具体是哪一条，elasticsearch就当做是最后一条了，所以从fan_num=1的文档开始返回；

### 最快的遍历
既然用了search_after，不用from size，说明是纯遍历。**如果纯遍历，且完全没有任何遍历顺序上的要求，建议直接指定sort为`_shard_doc`，这样的遍历是最快的**：
```
GET /_search
{
  "pit": {
    "id": "48myAw8Nc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBRY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWan-FjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQQWWHF6NGRHVTJTR0NuM3hpZG9QNnViZwAAAAAAAG3ELhZzN05Wc3l6UVRteW9tTEVlcXcxWExnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEHFkNXS3J5UjZrUmVPd0hjMVEtNGlJbGcAAAAAAABUYDMWZEZqaS0wNFNRWWEyTVl5WHNrOTB0ZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBhZHaUMtcjBMbVR5aTFoYjFuZlZjdm13AAAAAAAAV9IuFkR0MEdpRTNiVGR5bTFHeEdKWTFBS3cADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQkWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRgNBZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEIFkdpQy1yMExtVHlpMWhiMW5mVmN2bXcAAAAAAABX0i8WRHQwR2lFM2JUZHltMUd4R0pZMUFLdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BCxZDV0tyeVI2a1JlT3dIYzFRLTRpSWxnAAAAAAAAVGA1FmRGamktMDRTUVlhMk1ZeVhzazkwdGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQoWZTA4T2RIUHFRNE9SZU5GSzRxUzROUQAAAAAAAF9HFRZFSk5mWmV5aFJ5Q19KbkZYQjU4cWx3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUENFkNXS3J5UjZrUmVPd0hjMVEtNGlJbGcAAAAAAABUYDYWZEZqaS0wNFNRWWEyTVl5WHNrOTB0ZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BDBZvYzR5OUE1SlFjZWxyVktMdmVMbXhnAAAAAAAASX7bFlVTNlQwRGRrUzhlNHRoeWVjanpodXcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQ4Wb2M0eTlBNUpRY2VsclZLTHZlTG14ZwAAAAAAAEl-3BZVUzZUMERka1M4ZTR0aHllY2p6aHV3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEBFmUwOE9kSFBxUTRPUmVORks0cVM0TlEAAAAAAABfRxQWRUpOZlpleWhSeUNfSm5GWEI1OHFsdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BABY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWan8FjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQMWNldpSjhXRUVTNi1pM0RCQ042Z0FFZwAAAAAAAFmp_RY3SHpWSEdXelNFNjJicGdCY1QxR2xnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUECFm9jNHk5QTVKUWNlbHJWS0x2ZUxteGcAAAAAAABJftoWVVM2VDBEZGtTOGU0dGh5ZWNqemh1dwABFjdqTW40SGxKVEF5NTVrT1VIdVYzLUEAAA==",
    "keep_alive": "10m"
  },
  "_source": "nickname",
  "sort": [
    {
      "_shard_doc": "desc"
    }
  ]
  "explain": true
}
```
**使用`_shard_doc`比使用自定义字段排序更快，因为elasticsearch不需要遍历完所有文档就能给出这个序：**
> **search_after requests have optimizations that make them faster when the sort order is _shard_doc and total hits are not tracked.** If you want to iterate over all documents regardless of the order, this is the most efficient option.
>
> 如果用自定义的字段比如fan_num，elasticsearch还要先给fan_num排排座次。

因为只指定了`_shard_doc`，所以返回的sort也只有`_shard_doc`一个值（一个数字），把它放到接下来的请求的`search_after`里就行了：
```
GET /_search
{
  "pit": {
    "id": "48myAw8Nc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBRY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWan-FjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQQWWHF6NGRHVTJTR0NuM3hpZG9QNnViZwAAAAAAAG3ELhZzN05Wc3l6UVRteW9tTEVlcXcxWExnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEHFkNXS3J5UjZrUmVPd0hjMVEtNGlJbGcAAAAAAABUYDMWZEZqaS0wNFNRWWEyTVl5WHNrOTB0ZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BBhZHaUMtcjBMbVR5aTFoYjFuZlZjdm13AAAAAAAAV9IuFkR0MEdpRTNiVGR5bTFHeEdKWTFBS3cADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQkWQ1dLcnlSNmtSZU93SGMxUS00aUlsZwAAAAAAAFRgNBZkRmppLTA0U1FZYTJNWXlYc2s5MHRnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEIFkdpQy1yMExtVHlpMWhiMW5mVmN2bXcAAAAAAABX0i8WRHQwR2lFM2JUZHltMUd4R0pZMUFLdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BCxZDV0tyeVI2a1JlT3dIYzFRLTRpSWxnAAAAAAAAVGA1FmRGamktMDRTUVlhMk1ZeVhzazkwdGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQoWZTA4T2RIUHFRNE9SZU5GSzRxUzROUQAAAAAAAF9HFRZFSk5mWmV5aFJ5Q19KbkZYQjU4cWx3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUENFkNXS3J5UjZrUmVPd0hjMVEtNGlJbGcAAAAAAABUYDYWZEZqaS0wNFNRWWEyTVl5WHNrOTB0ZwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BDBZvYzR5OUE1SlFjZWxyVktMdmVMbXhnAAAAAAAASX7bFlVTNlQwRGRrUzhlNHRoeWVjanpodXcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQ4Wb2M0eTlBNUpRY2VsclZLTHZlTG14ZwAAAAAAAEl-3BZVUzZUMERka1M4ZTR0aHllY2p6aHV3AA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUEBFmUwOE9kSFBxUTRPUmVORks0cVM0TlEAAAAAAABfRxQWRUpOZlpleWhSeUNfSm5GWEI1OHFsdwANc3RvcmVkX2tvbF92OBY3ak1uNEhsSlRBeTU1a09VSHVWMy1BABY2V2lKOFdFRVM2LWkzREJDTjZnQUVnAAAAAAAAWan8FjdIelZIR1d6U0U2MmJwZ0JjVDFHbGcADXN0b3JlZF9rb2xfdjgWN2pNbjRIbEpUQXk1NWtPVUh1VjMtQQMWNldpSjhXRUVTNi1pM0RCQ042Z0FFZwAAAAAAAFmp_RY3SHpWSEdXelNFNjJicGdCY1QxR2xnAA1zdG9yZWRfa29sX3Y4FjdqTW40SGxKVEF5NTVrT1VIdVYzLUECFm9jNHk5QTVKUWNlbHJWS0x2ZUxteGcAAAAAAABJftoWVVM2VDBEZGtTOGU0dGh5ZWNqemh1dwABFjdqTW40SGxKVEF5NTVrT1VIdVYzLUEAAA==",
    "keep_alive": "10m"
  },
  "_source": "nickname",
  "sort": [
    {
      "_shard_doc": "desc"
    }
  ], 
  "search_after": [                                
    60129693554
  ],
  "explain": true
}
```

# `_shard_doc`
**`_shard_doc`就是shard id + doc lucene id**：
> The _shard_doc value is the combination of the shard index within the PIT and the Lucene’s internal doc ID, it is unique per document and constant within a PIT.

- https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html
- https://discuss.elastic.co/t/elastic-no-mapping-found-for-shard-doc-in-order-to-sort-on/268188/2?u=puppylpg

**7.12之后才有的`_shard_doc`**。在此之前的版本显式指定`_shard_doc`会报错：No mapping found for [_shard_doc] in order to sort on

# PIT
[PIT的api doc](https://www.elastic.co/guide/en/elasticsearch/reference/8.3/point-in-time-api.html#point-in-time-keep-alive)解释了pit的代价：
> Normally, the background merge process optimizes the index by merging together smaller segments to create new, bigger segments. Once the smaller segments are no longer needed they are deleted. However, open point-in-times prevent the old segments from being deleted since they are still in use.

和之前[Elasticsearch：performance]({% post_url 2022-05-08-es-performance %})认知的差不多。

还有[一篇很好的文章](https://www.elastic.co/blog/get-a-consistent-view-of-your-data-over-time-with-the-elasticsearch-point-in-time-reader)，介绍了为什么pit取代了scroll：**主要因为scroll和query绑定，而一个pit产生的snapshot可以让多个请求使用。**

> 为啥老外的这些商业网站默认都要重定向到cn……你以为你机翻的文章比英文好读吗……还不能直接改url……好在文章上面可以选en。

**pit还支持[slicing](https://www.elastic.co/guide/en/elasticsearch/reference/current/point-in-time-api.html#search-slicing)，很像kafka consumer的概念，大家一起分担任务。**

> 不知道为啥pit的api示例里不带search_after，但世界上没有sort和search_after，根本没法翻页……

# spring data elasticsearch对pit的支持
今年八月刚完成对search_after和pit的支持：
- https://github.com/spring-projects/spring-data-elasticsearch/issues/1684
- https://github.com/spring-projects/spring-data-elasticsearch/pull/2273
- https://docs.spring.io/spring-data/elasticsearch/docs/5.0.0-RC2/reference/html/#elasticsearch.misc.point-in-time

但是看样子在5.x版本才能用……4.4.x感觉凉凉……

[4.x确实凉了](https://github.com/spring-projects/spring-data-elasticsearch/pull/2273/files#r1019984036)：
> This change was in 5.0.M6 (I obviously was neglecting setting the milestones when closing issues this summer). So it will be in version 5.
>
> It won't be backported to 4.4. After a version (minor) is released, it will be only updated with bugfixes and dependency patch updates, not with new features or API changes.

# `track_total_hits`
上文提到`search_after`在两种情况都满足的情况下才能加速：
1. when the sort order is `_shard_doc`;
2. and total hits are not tracked. 

[`track_total_hits`](https://www.elastic.co/guide/en/elasticsearch/reference/master/search-your-data.html#track-total-hits)是简单而直白的概念：设为true，就会统计所有符合条件的doc的数量。它还能接收一个数值，默认是10000，doc数量数到10000就不数了。

但是这听起来似乎不太科学，数到10000就不数了什么意思？难道elasticsearch不遍历完所有的文档就给出query的结果了吗？显然不是。如果这样的话，top N就不是真正的top N了，这属于功能直接错了，再怎么节省性能也不可能以给出错误结果为代价。

既然如此，`track_total_hits`不设为true究竟是如何提升性能的？

事实上，不设置`track_total_hits`为true，只能说有可能提升性能，但也未必。根据[这个答案](https://stackoverflow.com/a/66450951/7676237)的提示，至少有两种情况是能提升性能的：
1. filter;
2. sorted index

## filter
filter查询不计算score，**所有doc的分值都为0**，所以也就没必要排序了。如果按照默认查询方式的话，会返回10条文档。既然没必要排序，那么理论上随便返回10条就够了。

> 以下查询用的elasticsearch性能较差，所以查询时间相对都比较久。

如果使用默认查询：
```
GET witake_media/_search
{
  "query": {
    "bool": {
      "filter": [
        {
          "match": {
            "description.text": "hello"
          }
        }
      ]
    }
  }
}
```
返回10条文档花了7s，`total`的值显示一共有超过10000条符合条件的文档：
```
{
  "took" : 7093,
  "timed_out" : false,
  "_shards" : {
    "total" : 3,
    "successful" : 3,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 10000,
      "relation" : "gte"
    },
    "max_score" : 0.0,
```
**也就是说这个query至少查到了10000条返回条件的文档，最终才返回10条**。慢是应该的。

如果设置`"track_total_hits": 100`，4.6s就返回了：
```
{
  "took" : 4640,
  "timed_out" : false,
  "_shards" : {
    "total" : 3,
    "successful" : 3,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "total" : {
      "value" : 100,
      "relation" : "gte"
    },
    "max_score" : 0.0,
```
这次找到100条就停止搜索了，所以快了些。

> 为了防止filter cache，这次搜索换了个关键词。虽然关键词不一样对结果也有影响，但选的都是简单基本常用词，所以影响没那么大。上次用的是hello，这次是good，下面用的是world。

最后一次设置了`"track_total_hits": false`，2.5s就返回了：
```
  "took" : 2509,
  "timed_out" : false,
  "_shards" : {
    "total" : 3,
    "successful" : 3,
    "skipped" : 0,
    "failed" : 0
  },
  "hits" : {
    "max_score" : 0.0,
```
**这次返回的hits里没有total值，说明找到10条就返回了，所以究竟有多少符合条件的doc，完全没有概念。**

**所以对于纯filter query，`track_total_hits`的确能加速不少。**

## index sorting
[index sorting](https://www.elastic.co/guide/en/elasticsearch/reference/master/index-modules-index-sorting.html)是 **在存储doc的时候，就按照某个字段给本shard的所有doc排个序**。

> Innodb：老弟，你抄我？

**因此，如果查询的sort也用了这个field，直接就可以返回了，不需要遍历整个shard的doc就能找出top N**。

此时，**设置`track_total_hits`为false就能达到early termination的效果，能更快返回。但是，false一定要显式设置，因为`track_total_hits`的默认值虽然不是true，但也不是false**，而是数值10000。

**所以对于index sorting，`track_total_hits`也能加速不少。**

因此`search_after`说了，按照`_shard_doc`排序能加速排序，但千万别track total hits，否则还是要遍历shard里所有的doc。

这么说来，**elasticsearch的shard应该可以理解为默认情况下是按照`_shard_doc`排序的index**（只不过Lucene id不在elasticsearch层面暴露）。我觉得完全可以这样认为，既然它就是lucene的id，只要不断自增就行了。

**同理，像aggregation这种query，设不设置`track_total_hits`完全是没卵用的，不管值为啥，都要找完所有的doc才能给出精确值。**

# 感想
虽然这次遍历翻车了，但涨了这么多教训，翻得也不亏。

这也是第二次见pit了，第一次看的时候，看到`_shard_doc`我还一愣一愣的，这次终于捋顺了。果然不同的阶段看同样的知识，理解是完全不同的。有的东西不多刷几遍是理解不了的。

> 翻车之后，领悟更透彻，因为对要解决的问题认识得更清晰了:D 只纯粹灌输知识，没完全领悟它要解决的问题时，确实看得一知半解，不知道它究竟要干什么。

