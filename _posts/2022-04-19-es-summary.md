---
layout: post
title: "汇总：Elasticsearch"
date: 2022-04-19 22:20:23 +0800
categories: elasticsearch
tags: elasticsearch
---

时间过得真快，转眼搞elasticsearch小半年了。这半年对es有了不少理解，同时一些地方和之前学习的innodb、redis等作对照，又有了不少更加深入的理解。

以[Elasticsearch: 权威指南](https://www.elastic.co/guide/cn/elasticsearch/guide/current/index.html)为基础，加上其他资料，汇总一下对es的学习流程。

大致分为以下部分：
- es基本使用：[Elasticsearch：basic]({% post_url 2022-04-20-es-basic %})；
- es搜索的原理、highlight：[Elasticsearch：search]({% post_url 2022-04-22-es-search %})；
- 正排索引`doc_values`：[Elasticsearch：sort、aggregation]({% post_url 2022-04-22-es-sort-agg %})；
- 聚合：[Elasticsearch：aggregation]({% post_url 2022-09-04-es-agg %})；
- reindex和task：[Elasticsearch：alias、reindex、task]({% post_url 2022-05-02-es-reindex-task %})；
- es对关系型数据的支持，同时也介绍了全局序数：[Elasticsearch：关系型文档]({% post_url 2022-05-03-es-relations %})；
- es底层的分片、查询、数据提交：[Elasticsearch：内部原理]({% post_url 2022-05-05-es-deep-dive %})；
- 调优、jvm内存、ssd、分页：[Elasticsearch：performance]({% post_url 2022-05-08-es-performance %})；
- 配置集群，集群部署：[Elasticsearch：配置部署]({% post_url 2022-05-09-es-config-deploy %})；
- index default template：[Elasticsearch：default index template]({% post_url 2022-05-05-es-template %})；
- pipeline：[Elasticsearch：pipeline]({% post_url 2022-08-27-es-pipeline %})；
- `_source`、`store`、`doc_values`、`index`，search：[Elasticsearch：_source store doc_values]({% post_url 2022-10-05-es-source-store-docvalues %})；
- 监控
- 备份：[Elasticsearch：backup]({% post_url 2022-10-19-es-backup %})；
- java客户端：[Elasticsearch：client]({% post_url 2022-11-06-elasticsearch-client %})；
- 遍历、翻页、search_after、pit、track_total_hits：[Elasticsearch：遍历索引]({% post_url 2022-11-11-es-traverse-index %})；

