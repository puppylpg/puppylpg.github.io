---
layout: post
title: "Elasticsearch：alias、reindex、task"
date: 2022-05-02 02:33:31 +0800
categories: elasticsearch
tags: elasticsearch
---

在es里，索引的功能一般都是随需求逐步增加的。而因为es是不可变的，这些变动大都需要重建索引。

1. Table of Contents, ordered
{:toc}

# alias
建索引的时候，尽量使用带版本号的名字，然后创建一个无版本的的别名作为指针。这样es对外暴露的就是指针，但实际操作的是哪个index，完全由维护者自己决定。

在构建索引的时候，可以先根据旧的索引创建新的索引，把数据填充好后，让alias指向新的索引，从而实现数据的无缝切换：
- https://www.elastic.co/guide/en/elasticsearch/reference/8.1/aliases.html
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/index-aliases.html

设给`my_index_v1`设置alias为`my_index`：
```
PUT /my_index_v1/_alias/my_index
```

查alias的原始名称：
```
GET /*/_alias/my_index
```

查index的alias：
```
GET /my_index_v1/_alias/*
```

**删除一个索引的alias的同时将alias指定为另一个索引**：
```
POST /_aliases
{
    "actions": [
        { "remove": { "index": "my_index_v5", "alias": "my_index" }},
        { "add":    { "index": "my_index_v6", "alias": "my_index" }}
    ]
}
```
**以上操作对于上层应用来说是原子操作**。

# reindex
reindex可以把数据从一个index索引到另一个index。这里之所以不说“复制到另一个index”，因为在索引过程中可以对数据做任意的修改，所以功能强大到超出了“复制”的范畴。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-reindex.html

## 异步
reindex只需要指定source和dest就行了。但是因为reindex的时间一般都比较长，直接使用kibana发送同步请求会timeout。所以建议异步，设置`wait_for_completion=false`：
```
POST _reindex?wait_for_completion=false
{
  "source": {
    "index": "index_a"
  },
  "dest": {
    "index": "index_b"
  }
}
```
异步reindex会返回taskid，可以用id进行query，查询任务进度：
```
GET /_tasks/Ap6U5o-lS1afaThsBIoGpg:7030680
```
query结果会显示当前任务的状态：
```
{
  "completed" : false,
  "task" : {
    "node" : "Ap6U5o-lS1afaThsBIoGpg",
    "id" : 7030680,
    "type" : "transport",
    "action" : "indices:data/write/reindex",
    "status" : {
      "total" : 419521,
      "updated" : 0,
      "created" : 62000,
      "deleted" : 0,
      "batches" : 63,
      "version_conflicts" : 0,
      "noops" : 0,
      "retries" : {
        "bulk" : 0,
        "search" : 0
      },
      "throttled_millis" : 0,
      "requests_per_second" : -1.0,
      "throttled_until_millis" : 0
    },
    "description" : "reindex from [index_a] to [index_b][_doc]",
    "start_time_in_millis" : 1638168002678,
    "running_time_in_nanos" : 96594813496,
    "cancellable" : true,
    "headers" : { }
  }
}
```

完成后的查询结果，除了修改状态，还增加了统计结果：
```
{
  "completed" : true,
  "task" : {
    "node" : "Ap6U5o-lS1afaThsBIoGpg",
    "id" : 7030680,
    "type" : "transport",
    "action" : "indices:data/write/reindex",
    "status" : {
      "total" : 419521,
      "updated" : 0,
      "created" : 419521,
      "deleted" : 0,
      "batches" : 420,
      "version_conflicts" : 0,
      "noops" : 0,
      "retries" : {
        "bulk" : 0,
        "search" : 0
      },
      "throttled_millis" : 0,
      "requests_per_second" : -1.0,
      "throttled_until_millis" : 0
    },
    "description" : "reindex from [index_a] to [index_b][_doc]",
    "start_time_in_millis" : 1638168002678,
    "running_time_in_nanos" : 510702240804,
    "cancellable" : true,
    "headers" : { }
  },
  "response" : {
    "took" : 510671,
    "timed_out" : false,
    "total" : 419521,
    "updated" : 0,
    "created" : 419521,
    "deleted" : 0,
    "batches" : 420,
    "version_conflicts" : 0,
    "noops" : 0,
    "retries" : {
      "bulk" : 0,
      "search" : 0
    },
    "throttled" : "0s",
    "throttled_millis" : 0,
    "requests_per_second" : -1.0,
    "throttled_until" : "0s",
    "throttled_until_millis" : 0,
    "failures" : [ ]
  }
}
```
如果没记住当前异步任务返回的id也没关系，可以使用task api直接搜所有的reindex任务：
```
GET _tasks?actions=*reindex&detailed
```

## remote reindex
远程索引和直接reindex没有本质的区别，只不过前者在集群间reindex，后者在单节点内操作。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/reindex-upgrade-remote.html

**remote reindex首要要把源cluster配置为目的cluster的白名单，重启es**：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-reindex.html#reindex-from-remote

如果source需要用户名和密码，也要在reindex时指定：
```
POST _reindex
{
  "source": {
    "remote": {
      "host": "http://<ip>:<port>",
      "username": "",
      "password": ""
    },
    "index": "index_a"
  },
  "dest": {
    "index": "index_b"
  }
}
```

## 加速reindex
reindex的时候，如果数据量很大，或者destination在索引文档时所做的分析太多，reindex就会比较慢。尤其是remote reindex，还需要收网络环境的限制。有一些经验可以加快reindex的速度：
1. `refresh_interval=-1`：只摄入数据，不刷新数据，整个reindex流程会加快。但refresh interval设为-1的话，**kibana统计的document count永远是0。因为索引不再刷新了**。所以实际使用的时候，建议设个比较大的值，比如30s或者120s，既不消耗太多资源，又能看到索引状态的变化（跟默认1s refresh一次，还是少消耗不少资源的）；
2. `number_of_replicas=0`：正常的数据添加，只有master和slave都新增数据完毕，才会返回。设置replica为0，无疑会减少这个时间。但是搞完之后还要再把副本数改回来，还是稍微有点儿麻烦的。如果reindex数据的需求比较紧急，可以设置这个；

> Create an index with the appropriate mappings and settings. **Set the refresh_interval to -1 and set number_of_replicas to 0 for faster reindexing**.
>
> **When the reindex job completes, set the refresh_interval and number_of_replicas to the desired values (the default settings are 30s and 1)**.

一次实践：没开上述两个优化时，reindex速度为3k document/s。设置后提升到了4-5k/s：：
```
PUT witake_media/_settings
{
  "index" : {
    "number_of_replicas" : 0,
    "refresh_interval" : -1
  }
}
```
**这些都可以随时改变，而不需要重启index**。

> **副本数可以随时修改，但是分片数无法修改**：Can't update non dynamic settings [[index.number_of_shards]] for open indices [[index_a/zAE70-09R3GwbguBFXQI8A]]

index的时候的优化建议，reindex也可以借鉴一些：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/tune-for-indexing-speed.html#_unset_or_increase_the_refresh_interval

和本地reindex一样，remote reindex最好也使用异步。

## reindex script
reindex修改原始数据后放入新的索引，主要体现在reindex时使用到的脚本。

参阅：[Elasticsearch：关系型文档]({% post_url 2022-05-03-es-relations %})

# task
reindex的文档说，异步reindex完成之后最好删掉task，回收空间：
> When you are done with a task, you should delete the task document so Elasticsearch can reclaim the space.

但是查看es所有的索引，可以看到有一个叫`.task`的索引，它里面存储的就是es所有的task信息：
```
GET _cat/indices
```
实际上该索引所占的空间和业务数据所占的空间相比，完全不值一提！

毕竟查看它的mapping：
```
GET .tasks/_mapping
```
一个task就下面这一点儿信息：
```
{
  ".tasks" : {
    "mappings" : {
      "dynamic" : "strict",
      "_meta" : {
        "version" : "7.12.1"
      },
      "properties" : {
        "completed" : {
          "type" : "boolean"
        },
        "error" : {
          "type" : "object",
          "enabled" : false
        },
        "response" : {
          "type" : "object",
          "enabled" : false
        },
        "task" : {
          "properties" : {
            "action" : {
              "type" : "keyword"
            },
            "cancellable" : {
              "type" : "boolean"
            },
            "description" : {
              "type" : "text"
            },
            "headers" : {
              "type" : "object",
              "enabled" : false
            },
            "id" : {
              "type" : "long"
            },
            "node" : {
              "type" : "keyword"
            },
            "parent_task_id" : {
              "type" : "keyword"
            },
            "running_time_in_nanos" : {
              "type" : "long"
            },
            "start_time_in_millis" : {
              "type" : "long"
            },
            "status" : {
              "type" : "object",
              "enabled" : false
            },
            "type" : {
              "type" : "keyword"
            }
          }
        }
      }
    }
  }
}
```
所以.task index实际所占用的空间非常小，可以不删。

## `enabled` property
但是看这个mapping会让人产生疑惑：由[Elasticsearch：basic]({% post_url 2022-04-20-es-basic %})可知，内层object的dynamic是继承自parent object的。而.task的最外层object的dynamic=strict，这就意味着内存object的dynamic也是strict。但是看看上述reindex task的内容，`task.status`里面实际还存储着非常多个子field，这不是和dynamic=strict冲突了吗？

本来的确应该冲突的，但是这里多给`task.status`设置了`enabled=false`。**在es里enabled=false时，该field是完全不被分析的，只是单纯地存起来，并在被查到的时候显示出来**。

听起来似乎很像index属性？是的。不过enabled只能用于object和顶层mapping，而index属性用于一般的type：
- https://stackoverflow.com/a/20662348/7676237

**这也就导致了task的实际结构体是比较混乱的：它并没有定义task里的status、response应该是什么样的数据结构，但当前status的结构又被当成既定事实在被使用**。

> 毕竟task五花八门，估计es觉得用一个通用的status去定义不同任务的状态是比较困难的。比如reinde的status有total/updated/created等field，但是其他task的status可能就没这些。**干脆定义一个enabled=false的object得了，啥都能往里塞**。

所以es java client对task的定义里，并没有定义status的实际结构，只有一个类似toString的方法输出status里的各个field。所以没有一个标准的获取status里field的机制（毕竟压根就没有分不同的task定义好不同的field），整体处理起来也比较麻烦。

## task api
如果真删除一个task的状态也很简单。task有一套管理的api：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/tasks.html

删除任务，使用任务名删除：
```
# ALERT
POST _tasks/CgcjZsMDTZaCMZsxw8njsA:238496/_cancel
```

## Java es task
使用Java es client向es提交reindex任务要注意超时问题：
- 使用同步任务会超时；
- 使用异步任务（上述`wait_for_completion=false`）还是会超时。毕竟这个异步只是在让子线程去和es沟通，但实际上子线程也会超时；
- 提交异步任务，获取taskId，然后根据taskId定时查询结果，看看任务完成了没有；

大致可以参考：
- https://stackoverflow.com/a/71948843/7676237

