---
layout: post
title: "Spring Data Elasticsearch 5.x"
date: 2023-12-08 22:32:04 +0800
categories: elasticsearch spring-data-elasticsearch
tags: elasticsearch spring-data-elasticsearch
---

elasticsearch已经废弃了hlrc（[Elasticsearch：client]({% post_url 2022-11-06-elasticsearch-client %})），使用新的elasticsearch-java客户端：
- hlrc request -> hlrc client -> string response
- elasticsearch-java request -> elasticsearch-java client -> generic hits

前者是老的查询方式，大概是elasticsearch的java初学者最先学会构建的请求形式；后者能够产生支持泛型的查询结果，使用起来非常方便。
**在spring data elasticsearch 4.x中，存在`ElasticsearchRestTemplate`，它恰好把二者连接了起来**：它能接收由hlrc构建的request，并得到支持泛型的查询结果：
- hlrc request -> `ElasticsearchRestTemplate` -> generic hits

> **在有历史遗留查询的项目里，`ElasticsearchRestTemplate`使用起来尤为方便**！

但是spring data elasticsearch在5.x版本里选择全面拥抱elasticsearch-java，彻底放弃了hlrc，移除了hlrc的依赖。因此，**起桥接作用的`ElasticsearchRestTemplate`在spring data elasticsearch 5.x中也被删除了**，只留下了全新的`ElasticsearchTemplate`，它只能接收新的elasticsearch-java构建的请求，处理请求，得到泛型结果：
- ~~hlrc request -> `ElasticsearchRestTemplate` -> generic hits~~
- elasticsearch-java request -> `ElasticsearchTemplate` -> generic hits

因此，迁移spring data elasticsearch到5.x最大的问题就是迁移涉及到`ElasticsearchRestTemplate`的代码。

1. Table of Contents, ordered
{:toc}

# hlrc query
旧有的hlrc request有两种选择：
1. 使用新的elasticsearch-java重写请求，然后交给 `ElasticsearchTemplate`处理；
2. 保留hlrc请求，但是不再使用spring data elasticsearch，而是使用原生的hlrc client替代`ElasticsearchRestTemplate`发起请求。返璞归真；

> spring data elasticsearch历史包袱丢得很干脆，使得5.x的代码干净了许多。但是对于使用了spring data elasticsearch 4.x，又要升级到5.x的人来说，就很绝望……

## 重写请求
重写请求一般对应两种情况：
1. 请求相对不太长，如果太长，重写起来可能太费劲；
2. 没有使用旧有api处理聚合。在处理聚合结果的时候，往往会使用hlrc里的代码迭代bucket，把这些代码转换成新的elasticsearch-java的代码也比较麻烦；

先看一个简单的请求重写。一个HLRC请求，包含两个filter，两个可选filter：
```java
BoolQueryBuilder queryBuilder = QueryBuilders.boolQuery()
        .filter(QueryBuilders.termsQuery(WITAKE_MEDIA_USER_ID, kolIdList))
        .filter(QueryBuilders.rangeQuery(WITAKE_MEDIA_TIMESTAMP).gte(startTimestamp).lte(endTimestamp));

if (videoType == VideoType.COOPERATION) {
    queryBuilder.filter(QueryBuilders.existsQuery(MEDIA_BRAND_ID));
}

if (CollectionUtils.isNotEmpty(mediaSubTypeList)) {
    queryBuilder.filter(QueryBuilders.termsQuery(WITAKE_MEDIA_SUBTYPE,
            mediaSubTypeList.stream().map(MediaSubType::getValue).collect(Collectors.toList())));
}
```

使用elasticsearch-java重写后的代码非常清晰，和elasticsearch原生查询请求体里的json几乎无异：
```java
Query q = new Query.Builder()
        .bool(b -> {
                    b
                            .filter(f -> f
                                    .terms(t -> t
                                            .field(WITAKE_MEDIA_USER_ID)
                                            .terms(tsv -> tsv
                                                    .value(kolIdList.stream().map(FieldValue::of).toList())
                                            )
                                    )
                            )
                            .filter(f -> f
                                    .range(r -> r
                                            .field(WITAKE_MEDIA_TIMESTAMP)
                                            .gte(jsonDataConverter(startTimestamp))
                                            .lte(jsonDataConverter(endTimestamp))
                                    )
                            );

                    if (videoType == VideoType.COOPERATION) {
                        b.filter(f -> f
                                .exists(e -> e
                                        .field(MEDIA_BRAND_ID)
                                )
                        );
                    }

                    if (CollectionUtils.isNotEmpty(mediaSubTypeList)) {
                        b.filter(f -> f
                                .terms(ts -> ts
                                        .field(WITAKE_MEDIA_SUBTYPE)
                                        .terms(tsv -> tsv
                                                .value(mediaSubTypeList.stream().map(MediaSubType::getValue).map(FieldValue::of).toList())
                                        )
                                )
                        );
                    }
                    return b;
                }
        )
        .build();
```
需要特殊注意的是range里的范围取值。旧的hlrc直接传数字或null，但是新的取值必须是`JsonData`类型或null。在获取`JsonData`类型时，一般直接使用`JsonData.of(value)`转换数据，但该方法不支持null value，所以需要单独判断null：
```java
    @Nullable
    private static JsonData jsonDataConverter(Number value) {
        return Objects.isNull(value) ? null : JsonData.of(value);
    }
```

> *getKolRecentDaysMediaStatistic*

另一个hlrc request重写的例子：
```java
BoolQueryBuilder queryBuilder = QueryBuilders.boolQuery()
        .filter(QueryBuilders.termsQuery(WITAKE_MEDIA_USER_ID, kolIdList));
        
if (CollectionUtils.isNotEmpty(mediaSubTypeList)) {
    queryBuilder.filter(QueryBuilders.termsQuery(WITAKE_MEDIA_SUBTYPE,
            mediaSubTypeList.stream().map(MediaSubType::getValue).collect(Collectors.toList())));
}
```
重写后：
```java
Query q = new Query.Builder()
        .bool(b -> {
                    b.filter(f -> f
                            .terms(t -> t
                                    .field(WITAKE_MEDIA_USER_ID)
                                    .terms(tsv -> tsv
                                            .value(kolIdList.stream().map(FieldValue::of).toList())
                                    )
                            )
                    );

                    if (CollectionUtils.isNotEmpty(mediaSubTypeList)) {
                        b.filter(f -> f
                                .terms(ts -> ts
                                        .field(WITAKE_MEDIA_SUBTYPE)
                                        .terms(tsv -> tsv
                                                .value(mediaSubTypeList.stream().map(MediaSubType::getValue).map(FieldValue::of).toList())
                                        )
                                )
                        );
                    }
                    return b;
                }
        )
        .build();
```

> *getKolLastItemsSubTypedMediaStatistic*

重写请求时也有多种写法。显式使用builder：
```java
    new Query.Builder()
            .term(new TermQuery.Builder().field("user_id").value("10").build())
            .build()
```
直接传入lambda表达式，专注逻辑，享受屏蔽builder带来的好处：
```java
    q -> q
            .term(t -> t.
                    field("platform")
                    .value("YouTube")
            )
```

> 原理可参考[Elasticsearch：client]({% post_url 2022-11-06-elasticsearch-client %})的设计理念部分。

整体来看，重写普通请求是比较简单的，虽然看起来代码似乎更长了，但是好处是很明显的：
1. **非常利于后期维护**：因为代码非常接近原生json查询，可读性非常强；
2. **非常利于开发**：请求构造起来非常简单，不用像hlrc一样考虑应该用什么builder（TermsQueryBuilder、HasChildQueryBuilder、FunctionScoreQueryBuilder等）来构建某部分的查询。使用函数式构建方式，查询的所有部分都有统一的逻辑，具体使用到的builder全被屏蔽在方法里了。


## 使用hlrc client
另一种处理方式就是保留hlrc请求，抛弃spring data elasticsearch，转而使用hlrc client。适合请求特别长不想重写的情况，或者使用了旧有api遍历聚合。

> 因为spring data elasticsearch已经抛弃了hlrc，此时hlrc需要我们[手动引入](https://docs.spring.io/spring-data/elasticsearch/reference/migration-guides/migration-guide-4.4-5.0.html#elasticsearch-migration-guide-4.4-5.0.old-client)。

比如使用hlrc里的`Terms`等遍历聚合结果里的bucket。如果遍历逻辑比较复杂，再替换成elasticsearch-java里的遍历方式就比较窒息：
```java
Terms groupByUserId = searchResponse.getAggregations().get(USER_ID_GROUP_AGG_NAME);
List<? extends Terms.Bucket> groupByUserIdBuckets = groupByUserId.getBuckets();
for (Terms.Bucket bucket : groupByUserIdBuckets) {
    Long userId = (Long) bucket.getKey();
    long mediaNum = bucket.getDocCount();
    
    Map<String, org.elasticsearch.search.aggregations.Aggregation> aggregationMap = bucket.getAggregations().getAsMap();
    ParsedExtendedStats extendedStatsAgg = (ParsedExtendedStats) aggregationMap.get(aggName);
    double avgValue = extendedStatsAgg.getAvg();
    double maxValue = extendedStatsAgg.getMax();
    double minValue = extendedStatsAgg.getMin();
    // ...
}
```
感到窒息的另一个原因就是**当下elasticsearch-java的sample实在是太少了，哪怕是[elasticsearch-java的官方api](https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/8.11/aggregations.html)也没有提供太多细节**，这一点和[hlrc client细致入微的官方api](https://www.elastic.co/guide/en/elasticsearch/client/java-rest/current/java-rest-high-search.html#java-rest-high-search-response-aggs)形成了鲜明的对比。

> 还有一个原因是当前版本的ChatGPT的训练数据还没有太新，涉及到的elasticsearch java相关的client基本都是hlrc的。所以即使拜托ChatGPT帮忙翻译代码，也没什么帮助。

但这一点终究是会得到改善的，随着时间的推移，关于elasticsearch-java的sample和官方api文档都会越来越丰富。

与之相反，使用hlrc这种过时的请求方式，所带来的缺陷是非常明显的！比如对hits的访问，需要自己把string结果序列化为对象，相当麻烦。

# 请求发起方式

## hlrc client search
HLRC请求需要把builder构造成`SearchRequest`：
```java
        SearchRequest searchRequest = new SearchRequest(elasticsearchTemplate.getIndexCoordinatesFor(WitakeMediaEs.class).getIndexName())
                .source(
                        new SearchSourceBuilder()
                                .query(queryBuilder)
                                .aggregation(groupByUserIdAgg)

                );
        SearchResponse searchResponse;
        try {
            searchResponse = restHighLevelClient.search(searchRequest, RequestOptions.DEFAULT);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        List<BrandAnalysisMedia> brandAnalysisMedias = Arrays.stream(searchResponse.getHits().getHits())
                .map(SearchHit::getSourceAsString)
                // 手动序列化
                .map(str -> JacksonUtil.toObject(str, BrandAnalysisMedia.class))
                .toList();
```
**如果想获取hits，只能获取string结果，然后自己序列化为对象**。

## `ElasticsearchTemplate` search
elasticsearch-java使用`ElasticsearchTemplate`发起请求，可以接受`org.springframework.data.elasticsearch.core.query.Query`，[该Query有以下几种实现](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/template.html#elasticsearch.operations.queries)：
- `CriteriaQuery`：spring data elasticsearch创造的一种通用简单查询，当查询比较简单时可以用；
- `StringQuery`：直接把原始json请求用来查询。懒人专用……
- `NativeQuery`：之所以叫native，是因为它包装的是elasticsearch-java的`co.elastic.clients.elasticsearch._types.query_dsl.Query`。**这也是最常用的查询方式，因为可以使用elasticsearch-java构建出任意复杂的请求**；
- `SearchTemplateQuery`：spring data elasticsearch提供的[模板查询](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/misc.html#elasticsearch.misc.searchtemplates)；

> `NativeQuery`只是search query部分包装的是`co.elastic.clients.elasticsearch._types.query_dsl.Query`，其他部分还都是spring data elasticsearch自己定义的。**因此不要错吧`NativeQuery`当做elasticsearch-java的`Query`**。

这里展示使用`ElasticsearchTemplate`对`NativeQuery`发起查询的情况：
```java
        NativeQuery query = new NativeQueryBuilder()
                .withQuery(q)
                .withAggregation(USER_ID_GROUP_AGG_NAME, agg)
                .withMaxResults(0)
                .build();
        SearchHits<WitakeMediaEs> searchHits = elasticsearchTemplate.search(query, WitakeMediaEs.class);
```
返回的结果已经被序列化好了。

## `ElasticsearchClient` search
spring data elasticsearch的`ElasticsearchTemplate`本质上还是使用了elasticsearch-java的`ElasticsearchClient`发起的请求，所以把elasticsearch-java也提一下。

`NativeQuery#withQuery`部分里的`q`就是elasticsearch-java的`SearchRequest`本身，直接用它[发起请求](https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/searching.html)即可：
```java
String searchText = "bike";

SearchResponse<Product> response = esClient.search(s -> s
    .index("products") 
    .query(q -> q      
        .match(t -> t   
            .field("name")  
            .query(searchText)
        )
    ),
    Product.class      
);

TotalHits total = response.hits().total();
boolean isExactResult = total.relation() == TotalHitsRelation.Eq;

if (isExactResult) {
    logger.info("There are " + total.value() + " results");
} else {
    logger.info("There are more than " + total.value() + " results");
}

List<Hit<Product>> hits = response.hits().hits();
for (Hit<Product> hit: hits) {
    Product product = hit.source();
    logger.info("Found product " + product.getSku() + ", score " + hit.score());
}
```
结果直接就是泛型。

# 更多查询
记录一下更多查询的重写方式。

## child query
hlrc的复杂查询还是比较难写的，**需要对着api找相应的builder（HasChildQueryBuilder），并确定其用法**：
```java
QueryBuilder queryBuilder = QueryBuilders.termsQuery(EsIndexConstant.STORED_KOL_MEDIA_BRAND_ID, brandIdList);
HasChildQueryBuilder hasChildQuery = JoinQueryBuilders.hasChildQuery(CHILD_TYPE, queryBuilder, ScoreMode.Total);
BoolQueryBuilder boolQueryBuilder = QueryBuilders.boolQuery()
        .filter(QueryBuilders.termQuery(kolField("op_status", storedKolMediaIndex), StatusCode.OP_STATUS_NOT_DELETE))
        .filter(QueryBuilders.termQuery(kolField("visible", storedKolMediaIndex), Boolean.TRUE.toString()));
boolQueryBuilder.must(hasChildQuery);
```
新的查询方式由于和原生json类似，根本不用看api，直接就写出来了：
```java
Query q = new Query.Builder()
        .bool(b -> b
                .filter(f -> f
                        .term(t -> t
                                .field(kolField("op_status", storedKolMediaIndex))
                                .value(StatusCode.OP_STATUS_NOT_DELETE)
                        )
                )
                .filter(f -> f
                        .term(t -> t
                                .field(kolField("visible", storedKolMediaIndex))
                                .value(Boolean.TRUE.toString())
                        )
                )
                .must(m -> m
                        .hasChild(hc -> hc
                                .type(CHILD_TYPE)
                                .query(hcq -> hcq
                                        .terms(ts -> ts
                                                .field(STORED_KOL_MEDIA_BRAND_ID)
                                                .terms(tsv -> tsv
                                                        .value(brandIdList.stream().map(FieldValue::of).toList())
                                                )
                                        )
                                )
                                .scoreMode(ChildScoreMode.Sum)
                        )
                )

        )
        .build();
```

## agg
agg应该是最难写的查询部分了。

**hlrc的agg非常难写，因为和原始查询的结构完全对不上**：
```java
TermsAggregationBuilder groupByUserIdAgg = AggregationBuilders.terms(USER_ID_GROUP_AGG_NAME).field(WITAKE_MEDIA_USER_ID)
        .size(kolIdList.size())
        .subAggregation(AggregationBuilders.extendedStats(WITAKE_MEDIA_EXTENDED_STATS_WATCH).field(WITAKE_MEDIA_VIEW))
        .subAggregation(AggregationBuilders.extendedStats(WITAKE_MEDIA_EXTENDED_STATS_REPOSTED).field(WITAKE_MEDIA_REPOSTED))
        .subAggregation(AggregationBuilders.extendedStats(WITAKE_MEDIA_EXTENDED_STATS_LIKES).field(WITAKE_MEDIA_LIKES))
        .subAggregation(AggregationBuilders.extendedStats(WITAKE_MEDIA_EXTENDED_STATS_COMMENT).field(WITAKE_MEDIA_COMMENT))
        .subAggregation(AggregationBuilders.avg(MEDIA_INTERACTIVE_IN_TIME_GROUP).script(new Script(MEDIA_SCRIPT_INTERACTION_RATE)));
```
新的查询在写agg的时候会简单非常多：
```java
Aggregation agg = Aggregation.of(a -> a
        .terms(t -> t
                .field(WITAKE_MEDIA_USER_ID)
                .size(kolIdList.size())
        )
        .aggregations(
                Map.of(
                        WITAKE_MEDIA_EXTENDED_STATS_WATCH,
                        Aggregation.of(s -> s
                                .extendedStats(es -> es.field(WITAKE_MEDIA_VIEW))
                        ),
                        WITAKE_MEDIA_EXTENDED_STATS_REPOSTED,
                        Aggregation.of(s -> s
                                .extendedStats(es -> es.field(WITAKE_MEDIA_REPOSTED))
                        ),
                        WITAKE_MEDIA_EXTENDED_STATS_LIKES,
                        Aggregation.of(s -> s
                                .extendedStats(es -> es.field(WITAKE_MEDIA_LIKES))
                        ),
                        WITAKE_MEDIA_EXTENDED_STATS_COMMENT,
                        Aggregation.of(s -> s
                                .extendedStats(es -> es.field(WITAKE_MEDIA_COMMENT))
                        ),
                        MEDIA_INTERACTIVE_IN_TIME_GROUP,
                        Aggregation.of(sa -> sa
                                .avg(avg -> avg
                                        .script(s -> s
                                                .inline(il -> il
                                                        .source(MEDIA_SCRIPT_INTERACTION_RATE)
                                                )
                                        )
                                )
                        )
                )
        )
);
```

> *getKolRecentDaysMediaStatistic*

新的bucket怎么遍历？参考[ElasticCC Platform - Part 2 - Using The New Elasticsearch Java Client](https://spinscale.de/posts/2022-03-03-running-the-elasticcc-platform-part-2.html)，或者[slides](https://docs.google.com/presentation/d/1R9pLrRdIPQplNr23TTqST-892Un9g_3AmrLjG5lNM74/present?slide=id.g110ee7befd7_0_184)：
```java
return response.aggregations().get("by_session")
    .sterms().buckets().array().stream()
    .collect(Collectors.toMap(
        StringTermsBucket::key,
        b -> b.aggregations().get("avg").avg().value())
    );
```

pipeline aggregation对于hlrc来说更是逆天：
```java
TermsAggregationBuilder timeAgg = AggregationBuilders.terms(TIME_GROUP_AGG_NAME)
        .field(WITAKE_MEDIA_TIMESTAMP)
        .size(limit)
        .order(BucketOrder.key(false))
        .subAggregation(AggregationBuilders.avg(MEDIA_COMMENT_IN_TIME_GROUP).field(WITAKE_MEDIA_COMMENT))
        .subAggregation(AggregationBuilders.avg(MEDIA_REPOST_IN_TIME_GROUP).field(WITAKE_MEDIA_REPOSTED))
        .subAggregation(AggregationBuilders.avg(MEDIA_LIKE_IN_TIME_GROUP).field(WITAKE_MEDIA_LIKES))
        .subAggregation(AggregationBuilders.avg(MEDIA_VIEW_IN_TIME_GROUP).field(WITAKE_MEDIA_VIEW))
        .subAggregation(AggregationBuilders.avg(MEDIA_INTERACTIVE_IN_TIME_GROUP).script(new Script(MEDIA_SCRIPT_INTERACTION_RATE)));
TermsAggregationBuilder groupByUserIdAgg = AggregationBuilders.terms(USER_ID_GROUP_AGG_NAME).field(WITAKE_MEDIA_USER_ID)
        .size(kolIdList.size())
        .subAggregation(timeAgg)
        .subAggregation(PipelineAggregatorBuilders.extendedStatsBucket(WITAKE_MEDIA_EXTENDED_STATS_WATCH, TIME_GROUP_TO_MEDIA_VIEW))
        .subAggregation(PipelineAggregatorBuilders.extendedStatsBucket(WITAKE_MEDIA_EXTENDED_STATS_REPOSTED, TIME_GROUP_TO_MEDIA_REPOST))
        .subAggregation(PipelineAggregatorBuilders.extendedStatsBucket(WITAKE_MEDIA_EXTENDED_STATS_LIKES, TIME_GROUP_TO_MEDIA_LIKE))
        .subAggregation(PipelineAggregatorBuilders.extendedStatsBucket(WITAKE_MEDIA_EXTENDED_STATS_COMMENT, TIME_GROUP_TO_MEDIA_COMMENT));
```

elasticsearch-java的pipeline agg由于和原始json对应，难度降低了不少。**但也是找了半天才发现应该使用`AggregationBuilders`获取pipeline agg**。除了这一点，基本没什么太大的困难了：
```java
Aggregation agg = Aggregation.of(a -> a
        .terms(byUser -> byUser
                .field(WITAKE_MEDIA_USER_ID)
                .size(kolIdList.size())
        )
        .aggregations(
                Map.of(
                        TIME_GROUP_AGG_NAME,
                        Aggregation.of(time -> time
                                .terms(byTs -> byTs
                                        .field(WITAKE_MEDIA_TIMESTAMP)
                                        .size(limit)
                                        .order(NamedValue.of("_key", co.elastic.clients.elasticsearch._types.SortOrder.Desc))
                                )
                                .aggregations(
                                        Map.of(
                                                MEDIA_COMMENT_IN_TIME_GROUP,
                                                Aggregation.of(sa -> sa
                                                        .avg(avg -> avg
                                                                .field(WITAKE_MEDIA_COMMENT)
                                                        )
                                                ),
                                                MEDIA_REPOST_IN_TIME_GROUP,
                                                Aggregation.of(sa -> sa
                                                        .avg(avg -> avg
                                                                .field(WITAKE_MEDIA_REPOSTED)
                                                        )
                                                ),
                                                MEDIA_LIKE_IN_TIME_GROUP,
                                                Aggregation.of(sa -> sa
                                                        .avg(avg -> avg
                                                                .field(WITAKE_MEDIA_LIKES)
                                                        )
                                                ),
                                                MEDIA_VIEW_IN_TIME_GROUP,
                                                Aggregation.of(sa -> sa
                                                        .avg(avg -> avg
                                                                .field(WITAKE_MEDIA_VIEW)
                                                        )
                                                ),
                                                MEDIA_INTERACTIVE_IN_TIME_GROUP,
                                                Aggregation.of(sa -> sa
                                                        .avg(avg -> avg
                                                                .script(s -> s
                                                                        .inline(il -> il
                                                                                .source(MEDIA_SCRIPT_INTERACTION_RATE)
                                                                        )
                                                                )
                                                        )
                                                )
                                        )
                                )
                        ),
                        WITAKE_MEDIA_EXTENDED_STATS_WATCH,
                        co.elastic.clients.elasticsearch._types.aggregations.AggregationBuilders.extendedStatsBucket(es -> es
                                .bucketsPath(bp -> bp
                                        .single(TIME_GROUP_TO_MEDIA_VIEW)
                                )
                        ),
                        WITAKE_MEDIA_EXTENDED_STATS_REPOSTED,
                        co.elastic.clients.elasticsearch._types.aggregations.AggregationBuilders.extendedStatsBucket(es -> es
                                .bucketsPath(bp -> bp
                                        .single(TIME_GROUP_TO_MEDIA_REPOST)
                                )
                        ),
                        WITAKE_MEDIA_EXTENDED_STATS_LIKES,
                        co.elastic.clients.elasticsearch._types.aggregations.AggregationBuilders.extendedStatsBucket(es -> es
                                .bucketsPath(bp -> bp
                                        .single(TIME_GROUP_TO_MEDIA_LIKE)
                                )
                        ),
                        WITAKE_MEDIA_EXTENDED_STATS_COMMENT,
                        co.elastic.clients.elasticsearch._types.aggregations.AggregationBuilders.extendedStatsBucket(es -> es
                                .bucketsPath(bp -> bp
                                        .single(TIME_GROUP_TO_MEDIA_COMMENT)
                                )
                        )
                )
        )
);
```

> *getKolLastItemsSubTypedMediaStatistic*

## sort
hlrc的sort，也是需要查api查半天：
```java
Query query = new NativeSearchQueryBuilder()
        .withQuery(queryBuilder)
        .withSort(SortBuilders.scriptSort(new Script(ScriptType.STORED, null, TAG_CROSS_SORT, ImmutableMap.of(CONTENT_TAGS, storedKol.getContentTags().stream().map(Object::toString).collect(Collectors.toList()))),
                ScriptSortBuilder.ScriptSortType.NUMBER).order(SortOrder.DESC))
        .withSort(SortBuilders.scriptSort(new Script(ScriptType.STORED, null, FAN_SIMILAR_SORT, ImmutableMap.of(FAN_NUM, storedKol.getFanNum())),
                ScriptSortBuilder.ScriptSortType.NUMBER).order(SortOrder.ASC))
        .withSort(SortBuilders.fieldSort(USER_ID).order(SortOrder.DESC))
        .withPageable(pageable)
        .build();
```
elasticsearch-java的sort，和query一样，基本不太需要查看api：
```java
NativeQuery query = new NativeQueryBuilder()
        .withQuery(q)
        .withSort(
                SortOptions.of(so -> so
                        .script(st -> st
                                .script(s -> s
                                        .stored(sd -> sd
                                                .id(TAG_CROSS_SORT)
                                                .params(Map.of(CONTENT_TAGS, JsonData.of(storedKol.getContentTags())))
                                        )
                                )
                                .type(ScriptSortType.Number)
                                .order(co.elastic.clients.elasticsearch._types.SortOrder.Desc)
                        )
                ),
                SortOptions.of(so -> so
                        .script(st -> st
                                .script(s -> s
                                        .stored(sd -> sd
                                                .id(FAN_SIMILAR_SORT)
                                                .params(Map.of(FAN_NUM, JsonData.of(storedKol.getFanNum())))
                                        )
                                )
                                .type(ScriptSortType.Number)
                                .order(co.elastic.clients.elasticsearch._types.SortOrder.Asc)
                        )
                ),
                SortOptions.of(so -> so
                        .field(fs -> fs
                                .field(USER_ID)
                                .order(co.elastic.clients.elasticsearch._types.SortOrder.Desc)
                        )
                )
        )
        .withPageable(pageable)
        .build();
```

## highlight
hlrc的highlight：
```java
HighlightBuilder.Field field = new HighlightBuilder.Field(NICKNAME_AUTOCOMPLETE).numOfFragments(0);
```
这一点spring data elasticsearch比较奇怪，`NativeQuery`接收的是自己定义的highlight query，而非elasticsearch-java原生的`co.elastic.clients.elasticsearch.core.search.Highlight`：
```java
        HighlightQuery hq = new HighlightQuery(
                new Highlight(
                        HighlightParameters.builder().withNumberOfFragments(0).build(),
                        List.of(new org.springframework.data.elasticsearch.core.query.highlight.HighlightField(NICKNAME_AUTOCOMPLETE))
                ),
                Entity.class
        );

        NativeQuery searchQuery = new NativeQueryBuilder()
                .withQuery(q)
                .withPageable(PageRequest.of(0, size))
                .withHighlightQuery(hq)
                .build();
```
怎么使用elasticsearch-java自己的highlight？看[这个PR](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793)就好了。不知道这个支持`highlight_query`的PR会不会被接受。

# 感想
elasticsearch-java的架构设计真的是惊为天人！在写[Elasticsearch：client]({% post_url 2022-11-06-elasticsearch-client %})的时候，我还没太意识到其爽点，真正写了一些查询之后，真的是爽到不能自已！**曾经从写原始json查询到使用hlrc写出相应的java代码是严重割裂的**！甚至必须靠ChatGPT帮我翻译相关代码，才能把aggregation的代码写出来。如今这些查询写起来简直是砍瓜切菜，一气呵成！

而spring data elasticsearch在果断放弃历史包袱之后也变得简洁了许多。但是删除了转接老hlrc request到泛型结果的`ElasticsearchRestTemplate`之后，对于想要升级5.x的曾经的4.x的老用户来说真的是生不如死……

> 但是其实，我一开始只是想升级springboot3.2，使用一下springboot的虚线程支持来着……因为和spring data elasticsearch 4.x不兼容，所以才入了这些升级的坑……本来我是打算4.x的代码用到天荒地老的……

