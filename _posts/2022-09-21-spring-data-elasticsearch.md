---
layout: post
title: "Spring Data - Elasticsearch"
date: 2022-09-21 00:08:57 +0800
categories: elasticsearch spring-data spring-data-elasticsearch
tags: elasticsearch spring-data spring-data-elasticsearch
---

[spring data](https://spring.io/projects/spring-data)是一个对开发者非常友好的工程，旨在帮开发者解脱数据访问相关的繁杂工作。至少从我的使用经验来说，简单的增删改查简直就是利器！太复杂的话可能没那么好使了（或者我太菜了，不会使。但我会慢慢学的，等会了我再来把这句话删掉）。

1. Table of Contents, ordered
{:toc}

# spring data
spring data的核心文档：
- https://docs.spring.io/spring-data/commons/docs/current/reference/html/

> 我还没好好看，后面我会好好看一遍，然后再来把这句话删了。

尤其是关于spring data repository的使用方法：
- https://docs.spring.io/spring-data/commons/docs/current/reference/html/#repositories

## object mapping
类似于orm，第一步是创建Object Mapping，告诉spring data怎么把对象和数据库里的数据映射：
- spring data common的orm：https://docs.spring.io/spring-data/commons/docs/current/reference/html/#mapping.fundamentals
- spring data elasticsearch的orm：https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.mapping

## repository
spring data的核心就是repository了。

创建repository：
- spring data common的repository：https://docs.spring.io/spring-data/commons/docs/current/reference/html/#repositories
- spring data elasticsearch的repository：https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.repositories

实现一个interface，继承spring data的repository：
1. 就自动具有了一堆增删改查方法；
2. 还可以只写方法名字，让spring data根据方法名自动生成方法实现；
3. 使用@Query直接绑定一个query到方法上：https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.query-methods.finders
3. 还可以继承spring data已经实现好的分页返回数据功能；
4. 返回stream也是一个不错的方法，可以避免一次性接收大数据，撑爆内存：https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#repositories.query-streaming

关于分页的一些示例：
- https://github.com/eugenp/tutorials/tree/master/persistence-modules/spring-data-elasticsearch
    + https://frontbackend.com/thymeleaf/spring-boot-bootstrap-thymeleaf-pagination-jpa-liquibase-h2
    + https://github.com/martinwojtus/tutorials/tree/master/thymeleaf

当需要自定义实现一些方法时，可以自己实现repository，并通过spring data默认的约定，将实现类自动整合到repository里：
- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#repositories.custom-implementations

# spring data elasticsearch
elasticsearch为非关系型数据库，依然能纳入spring data的体系中。而且从对elasticsearch的支持来看，并不是所有的数据库都能完全不违背spring data的设定，毕竟想100%统一所有的数据库基本是不可能的。

比如repository里默认的`findById`，对于elasticsearch就不那么适用：如果索引使用了多个分片，那么不指定routing仅凭id是无法找到想要的数据的。

## mapping
orm映射：
```
package io.puppylpg.data.entity;

import lombok.*;
import org.elasticsearch.core.Nullable;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.ReadOnlyProperty;
import org.springframework.data.elasticsearch.annotations.*;

import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * witake_media库。
 * <p>
 * Note：routing和_id不一致。
 *
 * @author liuhaibo on 2022/07/29
 */
@Data
@Document(indexName = "#{@environment.getProperty('app.es-indexes.witake-media')}", writeTypeHint = WriteTypeHint.FALSE, createIndex = false)
@Routing("userId")
public class WitakeMedia {

    @Id
    @ReadOnlyProperty
    private String realId;

    @Field(value = "id", type = FieldType.Keyword)
    private String mediaId;

    @Field(type = FieldType.Long)
    private long userId;

    @MultiField(
            mainField = @Field(type = FieldType.Keyword),
            otherFields = {
                    @InnerField(suffix = "icu", type = FieldType.Text)
            }
    )
    private String description;

    @Nullable
    @Field(type = FieldType.Keyword)
    private List<String> urls;

    @Nullable
    @Field(type = FieldType.Object)
    private Set<RawUrl> rawUrls;

    @Field(type = FieldType.Date, format = DateFormat.epoch_millis)
    private Instant timestamp;

    @Field(type = FieldType.Keyword)
    private String urlStatus;

    @Field(type = FieldType.Date, format = DateFormat.epoch_millis)
    private Instant updateTime;

    @Getter
    @Setter
    @ToString
    @EqualsAndHashCode(onlyExplicitlyIncluded = true)
    public static final class RawUrl {
        @EqualsAndHashCode.Include
        @Field(type = FieldType.Keyword)
        private String url;

        @Field(type = FieldType.Keyword)
        private String rawUrl;

        @EqualsAndHashCode.Include
        @Field(type = FieldType.Keyword)
        private String platform;

        @Field(type = FieldType.Keyword)
        private String brandId;

        @Field(type = FieldType.Keyword)
        private String type;

        @Field(type = FieldType.Object)
        private BrandingAnalyses brandingAnalyses;

        @Data
        public static final class BrandingAnalyses {

            @Field(type = FieldType.Keyword)
            private String id;

            @Field(type = FieldType.Keyword)
            private List<String> urls;

            @Field(type = FieldType.Keyword)
            private List<String> names;
        }
    }

    public static final class UrlStatus {
        /**
         * 没有任何url可匹配
         */
        public static final String NONE = "none";
        /**
         * 只有部分url解析出了原始url
         */
        public static final String MATCHING = "matching";
        /**
         * url全都解析出了原始url，之后会被pipeline修改为{@link #BRANDING}状态
         */
        public static final String MATCHED = "matched";
        /**
         * url全都解析出了原始url，且执行了品牌信息匹配步骤
         */
        public static final String BRANDING = "branding";
        /**
         * media的raw url是通过本服务解析之后写回的。针对这种情况，pipeline做了相关设置，
         * 不再尝试enrich raw url。详见pipeline的设置。
         */
        public static final String WRITING = "writing";
    }

}

```

### index name
P.J.Meisch自己写的不同环境指定index：
- https://www.sothawo.com/2020/07/how-to-provide-a-dynamic-index-name-in-spring-data-elasticsearch-using-spel/

使用SpEL获取当前环境指定的index name：
```
@Document(indexName = "#{@environment.getProperty('app.es-indexes.witake-media')}", writeTypeHint = WriteTypeHint.FALSE, createIndex = false)
```

### index auto create
spring data elasticsearch在启动的时候会检测es服务是否存在：
```
2022-08-22 00:23:44,852 TRACE [I/O dispatcher 1] tracer [RequestLogger.java:90] curl -iX GET 'http://localhost:9200/'
# HTTP/1.1 200 OK
# content-type: application/json; charset=UTF-8
# content-length: 545
#
# {
#   "name" : "4a8a456745de",
#   "cluster_name" : "docker-cluster",
#   "cluster_uuid" : "Mk7Y_Cn2QYW4jdsWcnBRgw",
#   "version" : {
#     "number" : "7.12.1",
#     "build_flavor" : "default",
#     "build_type" : "docker",
#     "build_hash" : "3186837139b9c6b6d23c3200870651f10d3343b7",
#     "build_date" : "2021-04-20T20:56:39.040728659Z",
#     "build_snapshot" : false,
#     "lucene_version" : "8.8.0",
#     "minimum_wire_compatibility_version" : "6.8.0",
#     "minimum_index_compatibility_version" : "6.0.0-beta1"
#   },
#   "tagline" : "You Know, for Search"
# }
```
检查用到的es index是否存在：
```
2022-08-22 00:23:44,875 TRACE [main] tracer [RequestLogger.java:90] curl -iX HEAD 'http://localhost:9200/url-info-test-list'
# HTTP/1.1 200 OK
# content-type: application/json; charset=UTF-8
# content-length: 814
#
```
如果不存在，且`@Document(createIndex = false)`，则会报错：
```
2022-08-21 17:00:59,581 TRACE [main] tracer [RequestLogger.java:90] curl -iX GET 'http://localhost:9200/witake_media_lhb_test/_doc/141140-ZbV_G2r-uLw'
# HTTP/1.1 404 Not Found
# content-type: application/json; charset=UTF-8
# content-length: 459
#
# {"error":{"root_cause":[{"type":"index_not_found_exception","reason":"no such index [witake_media_lhb_test]","resource.type":"index_expression","resource.id":"witake_media_lhb_test","index_uuid":"_na_","index":"witake_media_lhb_test"}],"type":"index_not_found_exception","reason":"no such index [witake_media_lhb_test]","resource.type":"index_expression","resource.id":"witake_media_lhb_test","index_uuid":"_na_","index":"witake_media_lhb_test"},"status":404}

Exception in thread "main" org.springframework.data.elasticsearch.NoSuchIndexException: Index [witake_media_lhb_test] not found.; nested exception is [witake_media_lhb_test] ElasticsearchStatusException[Elasticsearch exception [type=index_not_found_exception, reason=no such index [witake_media_lhb_test]]]
```
测试的时候能自动创建索引还是非常方便的！

但是生产环境的索引还是自己创建比较好。

而且，即使设置了auto create，spring data elasticsearch也只会在index不存在的时候创建index，如果映射类后续添加了一些字段，这些字段也不会被加到es的mapping里：
- https://stackoverflow.com/questions/70189254/spring-data-elasticsearch-7-9-3-add-field-to-existed-index

所以不如就自己动手创建吧。

### type hint
- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.mapping.meta-model.rules

type hint就别写了：`@Document(writeTypeHint = WriteTypeHint.FALSE)`

添加个`_class`字段，strict mapping肯定会报错的。而且es基本也不涉及对象的多态……

### routing
在elasticsearch里，提到id就要想到routing。尤其是如果索引的数据存在id和routing不一致的情况时，**一定要在任何使用id的场景想到routing**！一旦漏掉代码就bug了。

- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.routing

1. orm类不能忘了设置@Routing，这样repository自动生成的请求才会带上routing：
    ```
    @Routing("userId")
    ```
1. 自己手动创建query的时候，一定不要漏了routing。参考后面的手写update query；
2. **使用repository已有的一些和id相关的方法时**：比如spring data common里的`CrudRepository#findById`，该方法只能提供id不能提供routing参数，所以在routing和id不一致的索引里，不能用这个方法；

### `_id`
mapping最主要的就是设置`_id`。碰到下面这种field有个`id`字段，且和`_id`不同的情况，设置起来就很复杂：
```
    @Id
    @ReadOnlyProperty
    private String realId;

    @Field(value = "id", type = FieldType.Keyword)
    private String mediaId;
```

首先，创建个`id` field，标记上`@Id`，**会默认生成一个`id` field，值同`_id`**：
- https://stackoverflow.com/questions/37277017/spring-data-elasticsearch-id-vs-id

如果不设置这个id，直接存入es，es会自动生成个`_id`，但id field就是null了。但是在get的时候，**getId方法返回的是`_id`的值**，所以返回的是有值的：
- https://stackoverflow.com/a/37277492/7676237

如果原本的mapping没有`id` field，又是strict，那就凉了，写不进es……

**为了不让它自动生成一个`id` field，加上`@ReadOnlyProperty`注解**。spring data会在转换mapping的时候，认为标注该注解的字段isWriteable() = false：
- https://stackoverflow.com/questions/62765711/spring-data-elasticsearch-4-x-using-id-forces-id-field-in-source

而`@Transient`在spring data里是被忽略的。

而存在`id` field和`_id`值还不一样，这是最麻烦的情况。**首先，`@Id`标注的字段一定是`_id`**，不管它叫什么名字：
- https://juejin.cn/post/6844904068037476365

**spring data elasticsearch认为的`_id`**：
1. **标注`@Id`**；
2. **属性名为`id`或`document`，且不带`@Field`注解**；

> 原因见下一节。

所以其次，**不要再定义一个名为`id`的字段，这可以认为是spring data elasticsearch的保留字**。所以要定义一个其他的名字，然后使用注解给它改名`@Field(value = "id")`：
- `_id`和`id`同时存在的情况：https://stackoverflow.com/questions/62029613/set-different-id-and-id-fields-with-spring-data-elasticsearch

所以如果存在`id` field，值又和`_id`不同，设置起来还是挺麻烦的。

### 从代码看id
**spring data elasticsearch认为的`_id`**，看起来很抽象，看代码就觉得具体很多——

id的判定条件：
```
		this.isId = super.isIdProperty()
				|| (SUPPORTED_ID_PROPERTY_NAMES.contains(getFieldName()) && !hasExplicitFieldName());
```
1. 要么满足`super.isIdProperty`：
    1. `Lazy.of(() -> isAnnotationPresent(Id.class) || IDENTITY_TYPE != null && isAnnotationPresent(IDENTITY_TYPE))`，所以它的判断标准是：
    2. **标注了`org.springframework.data.annotation.Id`注解**；
    3. 不重要：~~如果classpath里有`org.jmolecules.ddd.annotation.Identity`注解，那么标注这个注解也算~~。估计是历史原因导致的兼容。
2. 要么满足`SUPPORTED_ID_PROPERTY_NAMES.contains(getFieldName()) && !hasExplicitFieldName()`：
    1. **没有显式设置field name**；
    2. **且field name是`SUPPORTED_ID_PROPERTY_NAMES = Arrays.asList("id", "document")`中的一个**；
    2. **这里的field name指的是：the name to be used to store the property in the document，不是类里的属性名**，而是对应的es的field名称；
    3. 因为规定了“没有显式设置field name”，所以这里必须 **没有使用`@Field`注解**。如果使用`@Field(value = "id")`，**它显式设置了，所以不算`_id`**；

## property
### 名字：`@Field`/`@MultiField`
`SimpleElasticsearchPersistentProperty`获取es的field名称的方式是：
1. `@Field`/`@MultiField`注解里指定了名字，那就是它；
2. 如果没指定，使用naming strategy解析java类的属性名称；
```
	@Override
	public String getFieldName() {

		if (annotatedFieldName == null) {
			FieldNamingStrategy fieldNamingStrategy = getFieldNamingStrategy();
			String fieldName = fieldNamingStrategy.getFieldName(this);

			if (!StringUtils.hasText(fieldName)) {
				throw new MappingException(String.format("Invalid (null or empty) field name returned for property %s by %s!",
						this, fieldNamingStrategy.getClass()));
			}

			return fieldName;
		}

		return annotatedFieldName;
	}
```
**注解里的名字则是从`@Field`或者`@MultiField`里取的**：
```
	@Nullable
	private String getAnnotatedFieldName() {

		String name = null;

		if (isAnnotationPresent(Field.class)) {
			name = findAnnotation(Field.class).name();
		} else if (isAnnotationPresent(MultiField.class)) {
			name = findAnnotation(MultiField.class).mainField().name();
		}

		return StringUtils.hasText(name) ? name : null;
	}
```
在反序列化的时候，如果一个property是id，且document里有`_id`（es的response里有`_id`），就把`_id`设置到这个field里。

> 这也是上文说的“但是在get的时候，getId方法返回的是`_id`的值，所以返回的是有值的”。即使id field是null，getId仍然是有值的，值为`_id`。

对于普通field，就是直接从es的response里取那个field的值。

### 反序列化
反序列化的第一步，es client返回`Map<String, Object> sourceAsMap`，它本身就是一个HashMap，里面的key是string，value是Object：
- 可能是Integer；
- **可能是ArrayList：所有的list，不管spring data es这里定义的是set还是list，es client返回的都是ArrayList类型**；
- 可能是HashMap：又是string to object的嵌套；

所以spring data es只需要考虑把ArrayList转成Set、List就行了。

又因为，es client的返回永远是：
1. 最外层是HashMap；
2. 键是string，值是（list of）object，object也是HashMap；

**所以spring data es的解析是递归的**：
- 遍历key，获取value；
    + 如果是list，遍历；
    + 如果是HashMap，递归解析；
    + 如果是普通object，直接完事儿；



`MappingElasticsearchConverter#readValue`里有一步，如果给property指定了converter，就用这个converter转这个field，复杂字段应该挺有用的：
```
			if (property.hasPropertyValueConverter()) {
				// noinspection unchecked
				return (R) propertyConverterRead(property, value);
			} else if (TemporalAccessor.class.isAssignableFrom(property.getType())
					&& !conversions.hasCustomReadTarget(value.getClass(), rawType)) {
```
自定义converter一般用不到：https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.mapping.meta-model.conversions

还能spel……离谱……

另外，既然es的field可以是单值或list，那无论将es里存储的单值还是list，都应该能转为List/Set。但是之前spring data es不支持这一点，如果将单值转成list/set，会报错：https://github.com/spring-projects/spring-data-elasticsearch/issues/2280

> Implemented in main and backported to 4.4.x and 4.3.x.

现在4.3.x/4.4.x的较新版本和4.5.x都支持这一点了。

### join type
甚至还支持es的join（话说回来，它不支持elasticsearch支持谁……）：
- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.jointype

### 时间相关的field
elasticsearch唯一的事件类型：date。

> 关于date，详见[Elasticsearch：basic]({% post_url 2022-04-20-es-basic %})。

date的格式由`@Field`的`format`属性指定：
- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#elasticsearch.mapping.meta-model.date-formats

比如elasticsearch类型：
```
        "timestamp" : {
          "type" : "date",
          "format" : "epoch_millis"
        },
```
对应的spring data elasticsearch注解属性是：
```
    @Field(type = FieldType.Date, format = DateFormat.epoch_millis)
    private Instant timestamp;
```
**使用Instant表示时间。**

类型：
```
        "timestamp" : {
          "type" : "date",
          "format" : "basic_date_time"
        },
```
对应的是：
```
    @Field(type = FieldType.Date, format = DateFormat.basic_date_time)
    private Instant timestamp;
```
当然作为spring data elasticsearch的使用者，我们不用关心每一个格式究竟长什么样，只要指定好格式，对开发者来说，他们都是Instant。

接下来就考虑怎么创建Instant就行了：
- 过去一个月：LocalDateTime.now().minusMonths(1).toInstant(ZoneOffset.ofHours(8))
- 元旦：LocalDateTime.now().with(TemporalAdjusters.firstDayOfYear()).toInstant(ZoneOffset.ofHours(8))

如果使用 **自定义的date类型，记得使用y取代u，因为u能表示负值**：If you are using a custom date format, you need to use uuuu for the year instead of yyyy. This is due to a change in Elasticsearch 7：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/migrate-to-java-time.html#java-time-migration-incompatible-date-formats

era - There are two eras, 'Current Era' (CE) and 'Before Current Era' (BCE)。前者用AD表示，后者用BC。y只能表示CE的year，正整数。而u能表示广义的year，比如-1年。

> 另外需要注意，0 year等同于1 AD，因为使用era的人没有0的概念，就好像楼房没有0层：https://stackoverflow.com/a/29014580/7676237

## repository
直接用接口继承ElasticsearchRepository即可：
```
package io.puppylpg.data.repository;

import io.puppylpg.data.entity.WitakeMedia;
import org.springframework.data.elasticsearch.repository.ElasticsearchRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * @author liuhaibo on 2022/07/29
 */
@Repository
public interface WitakeMediaRepository extends ElasticsearchRepository<WitakeMedia, String>, CustomRepository<WitakeMedia>, UpdateWitakeMediaRepository {

    /**
     * 放到try-with-resource里：
     * https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#repositories.query-streaming
     *
     * @param userId kol id
     * @return kol的所有media
     */
    Stream<WitakeMedia> findAllByUserId(long userId);

    /**
     * 别忘了方法名里的“in”。
     *
     * @param mediaIds 要查找的media id列表
     * @return id列表对应的media
     */
    List<WitakeMedia> findByMediaIdIn(Collection<String> mediaIds);

    Optional<WitakeMedia> findByMediaId(String mediaId);

    /**
     * 用时间戳搜索，eg:
     * - LocalDateTime.now().minusMonths(1).toInstant(ZoneOffset.ofHours(8))
     * - LocalDateTime.now().with(TemporalAdjusters.firstDayOfYear()).toInstant(ZoneOffset.ofHours(8))
     *
     * @param instant 时间戳
     * @return 所有>=的media
     */
    Stream<WitakeMedia> findByTimestampGreaterThanEqual(Instant instant);

    Stream<WitakeMedia> findByUrlStatus(String urlStatus);

    /**
     * 获取url没有完全匹配上branding的media。
     *
     * @return media stream
     */
    default Stream<WitakeMedia> findMatchingMedia() {
        return findByUrlStatus(WitakeMedia.UrlStatus.MATCHING);
    }
}
```

### custom repository
如果需要自定义实现，可以拓展接口：
- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#repositories.custom-implementations
```
package io.puppylpg.data.repository;

import io.puppylpg.data.entity.WitakeMedia;
import org.springframework.data.elasticsearch.core.query.UpdateResponse;

/**
 * 自定义一些业务相关的es操作。比如仅save但不立即refresh。
 * https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#repositories.custom-implementations
 *
 * @author liuhaibo on 2022/08/11
 */
public interface CustomRepository<T> {

    /**
     * es默认的repository会在save之后立刻调用refresh，但是没有必要，所以自定义一个不refresh的save方法：
     * https://github.com/spring-projects/spring-data-elasticsearch/issues/1266
     *
     * @param entity
     * @return
     */
    T saveWithoutRefresh(T entity);
}
```
实现类以Impl结尾：
```
package io.puppylpg.data.repository;

import io.puppylpg.config.AppProperties;
import io.puppylpg.data.entity.WitakeMedia;
import org.springframework.data.elasticsearch.core.ElasticsearchRestTemplate;
import org.springframework.data.elasticsearch.core.document.Document;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.data.elasticsearch.core.query.Criteria;
import org.springframework.data.elasticsearch.core.query.CriteriaQuery;
import org.springframework.data.elasticsearch.core.query.UpdateQuery;
import org.springframework.data.elasticsearch.core.query.UpdateResponse;
import org.springframework.stereotype.Repository;

import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

/**
 * @author liuhaibo on 2022/08/11
 */
@Repository
public class CustomRepositoryImpl<T> implements CustomRepository<T> {

    private final ElasticsearchRestTemplate elasticsearchRestTemplate;

    public CustomRepositoryImpl(ElasticsearchRestTemplate elasticsearchRestTemplate) {
        this.elasticsearchRestTemplate = elasticsearchRestTemplate;
    }
    
    @Override
    public T saveWithoutRefresh(T entity) {
        return elasticsearchRestTemplate.save(entity);
    }
}
```

### stream: scroll api
scroll api

TBD
```

```

### 慎用`save`
如果使用save保存文档，有两个地方需要注意：
1. **`ElasticsearchRepository`继承自`CrudRepository`的save方法默认会附带一个`_refresh`请求**，生产环境下高并发的`_refresh`会让elasticsearch不堪重负；
2. save对应的是index请求，慎用！**如果orm没有映射完所有的field，那么从elasticsearch先读取doc再save回去，会把没有映射到的field清空**；

save with refresh：
```
2022-08-18 14:54:00,926 TRACE [I/O dispatcher 1] tracer [RequestLogger.java:90] curl -iX GET 'https://localhost:9200/'
# HTTP/1.1 200 OK
# Server: YDWS
# Date: Thu, 18 Aug 2022 06:54:01 GMT
# Content-Type: application/json; charset=UTF-8
# Content-Length: 536
# Connection: keep-alive
#
# {
#   "name" : "es-ad-es-node-0",
#   "cluster_name" : "es-ad",
#   "cluster_uuid" : "z6oA-NW_ShmpJJQSXeyOIQ",
#   "version" : {
#     "number" : "7.11.2",
#     "build_flavor" : "default",
#     "build_type" : "docker",
#     "build_hash" : "3e5a16cfec50876d20ea77b075070932c6464c7d",
#     "build_date" : "2021-03-06T05:54:38.141101Z",
#     "build_snapshot" : false,
#     "lucene_version" : "8.7.0",
#     "minimum_wire_compatibility_version" : "6.8.0",
#     "minimum_index_compatibility_version" : "6.0.0-beta1"
#   },
#   "tagline" : "You Know, for Search"
# }
2022-08-18 14:54:01,023 TRACE [main] tracer [RequestLogger.java:90] curl -iX PUT 'https://localhost:9200/witake_media_lhb_test/_doc/141140-ZbV_G2r-uLw?timeout=1m' -d '{"userId":0,"description":"YUK Download FARLIGHT!!: https://bit.ly/3HIufGe \nAdd gua di Farlight84 #3820858\n\nJangan lupa ikutan Farlight Thousand Kill. Kalian cukup ScreenShoot dan upload total kill 1000 musuh ke Facebook, Instagram, ataupun Tiktok tag @farlight84_official. Kalian bisa memenangkan total hadiah 10.000 USD yang akan dibagikan secara merata, dan semua yang ikutan akan bakal dapat 10 gold/kill.\n\n#farlight84 #smash #farlight84smash1000 #freefire"}'
# HTTP/1.1 201 Created
# Server: YDWS
# Date: Thu, 18 Aug 2022 06:54:01 GMT
# Content-Type: application/json; charset=UTF-8
# Content-Length: 186
# Connection: keep-alive
# Location: /witake_media_lhb_test/_doc/141140-ZbV_G2r-uLw
#
# {"_index":"witake_media_lhb_test","_type":"_doc","_id":"141140-ZbV_G2r-uLw","_version":5,"result":"created","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":8,"_primary_term":1}
2022-08-18 14:54:01,089 TRACE [main] tracer [RequestLogger.java:90] curl -iX POST 'https://localhost:9200/witake_media_lhb_test/_refresh'
# HTTP/1.1 200 OK
# Server: YDWS
# Date: Thu, 18 Aug 2022 06:54:01 GMT
# Content-Type: application/json; charset=UTF-8
# Content-Length: 49
# Connection: keep-alive
#
# {"_shards":{"total":6,"successful":6,"failed":0}}
2022-08-18 14:54:01,104 TRACE [main] tracer [RequestLogger.java:90] curl -iX GET 'https://localhost:9200/witake_media_lhb_test/_doc/141140-ZbV_G2r-uLw'
# HTTP/1.1 200 OK
# Server: YDWS
# Date: Thu, 18 Aug 2022 06:54:01 GMT
# Content-Type: application/json; charset=UTF-8
# Content-Length: 1529
# Connection: keep-alive
#
# {"_index":"witake_media_lhb_test","_type":"_doc","_id":"141140-ZbV_G2r-uLw","_version":5,"_seq_no":8,"_primary_term":1,"found":true,"_source":{"urlStatus":"branding","urls":["https://bit.ly/3HIufGe"],"description":"YUK Download FARLIGHT!!: https://bit.ly/3HIufGe \nAdd gua di Farlight84 #3820858\n\nJangan lupa ikutan Farlight Thousand Kill. Kalian cukup ScreenShoot dan upload total kill 1000 musuh ke Facebook, Instagram, ataupun Tiktok tag @farlight84_official. Kalian bisa memenangkan total hadiah 10.000 USD yang akan dibagikan secara merata, dan semua yang ikutan akan bakal dapat 10 gold/kill.\n\n#farlight84 #smash #farlight84smash1000 #freefire","userId":0,"rawUrls":[{"rawUrl":"https://apps.apple.com/app/id1610702541?mt=8","brandId":"1610702541","type":"APP","brandingAnalyses":{"urls":["https://apps.apple.com/app/id1610702541"],"names":["Farlight 84"],"id":"1610702541"},"url":"https://bit.ly/3HIufGe","platform":"IOS"},{"rawUrl":"market://details?id=com.miraclegames.farlight84&referrer=adjust_reftag%3Dc44O2Uwq2Psjo%26utm_source%3D%25E7%25BA%25A2%25E4%25BA%25BA%25E9%25A6%2586%26utm_campaign%3D%25E3%2580%25902022%252F6%25E3%2580%2591ID%25E5%25A4%25A7%25E6%258E%25A8-IG%26utm_content%3D%25E3%2580%25902022%252F6%25E3%2580%2591ID%25E5%25A4%25A7%25E6%258E%25A8-IG-Rendy%2BRangers%26utm_term%3D%25E3%2580%25902022%252F6%25E3%2580%2591ID%25E5%25A4%25A7%25E6%258E%25A8-IG-Rendy%2BRangers-Rendy%2BRangers%2Big1","brandId":"com.miraclegames.farlight84","type":"APP","url":"https://bit.ly/3HIufGe","platform":"ANDROID"}]}}
2022-08-18 14:54:01,296 TRACE [main] tracer [RequestLogger.java:90] curl -iX PUT 'https://localhost:9200/witake_media_lhb_test/_doc/141140-ZbV_G2r-uLw?timeout=1m' -d '{"userId":0,"description":"YUK Download FARLIGHT!!: https://bit.ly/3HIufGe \nAdd gua di Farlight84 #3820858\n\nJangan lupa ikutan Farlight Thousand Kill. Kalian cukup ScreenShoot dan upload total kill 1000 musuh ke Facebook, Instagram, ataupun Tiktok tag @farlight84_official. Kalian bisa memenangkan total hadiah 10.000 USD yang akan dibagikan secara merata, dan semua yang ikutan akan bakal dapat 10 gold/kill.\n\n#farlight84 #smash #farlight84smash1000 #freefire","urls":["https://bit.ly/3HIufGe"],"rawUrls":[{"url":"https://tiny.one/RoK-Braxic","rawUrl":"https://apps.apple.com/app/id1354260888?mt=8","platform":"IOS","brandId":"1354260888","type":"APP"},{"url":"https://bit.ly/3HIufGe","rawUrl":"https://apps.apple.com/app/id1610702541?mt=8","platform":"IOS","brandId":"1610702541","type":"APP","brandingAnalyses":[]},{"url":"https://bit.ly/3HIufGe","rawUrl":"market://details?id=com.miraclegames.farlight84&referrer=adjust_reftag%3Dc44O2Uwq2Psjo%26utm_source%3D%25E7%25BA%25A2%25E4%25BA%25BA%25E9%25A6%2586%26utm_campaign%3D%25E3%2580%25902022%252F6%25E3%2580%2591ID%25E5%25A4%25A7%25E6%258E%25A8-IG%26utm_content%3D%25E3%2580%25902022%252F6%25E3%2580%2591ID%25E5%25A4%25A7%25E6%258E%25A8-IG-Rendy%2BRangers%26utm_term%3D%25E3%2580%25902022%252F6%25E3%2580%2591ID%25E5%25A4%25A7%25E6%258E%25A8-IG-Rendy%2BRangers-Rendy%2BRangers%2Big1","platform":"ANDROID","brandId":"com.miraclegames.farlight84","type":"APP"}],"urlStatus":"branding"}'
# HTTP/1.1 200 OK
# Server: YDWS
# Date: Thu, 18 Aug 2022 06:54:01 GMT
# Content-Type: application/json; charset=UTF-8
# Content-Length: 186
# Connection: keep-alive
#
# {"_index":"witake_media_lhb_test","_type":"_doc","_id":"141140-ZbV_G2r-uLw","_version":6,"result":"updated","_shards":{"total":2,"successful":2,"failed":0},"_seq_no":9,"_primary_term":1}
```
可以自定义一个方法，使用`ElasticsearchRestTemplate#save`，这样就只有index，没有refresh。参考上述custom repository里的方法实现。

### update
save会使用index对文档进行覆盖更新，所以得使用update请求。但是没找到能直接生成update请求的方法，update得自己写：
- https://stackoverflow.com/questions/40742327/partial-update-with-spring-data-elasticsearch-repository
- https://www.jianshu.com/p/b320ace6db2f

spring data没有update吗？

纯手撸update query相对麻烦：
```
    public void update(WitakeMedia witakeMedia, Instant updateTime) {
        Document document = Document.create();
        document.put("updateTime", updateTime.toEpochMilli());
        UpdateQuery updateQuery = UpdateQuery.builder(witakeMedia.getRealId()).withDocument(document).build();
        elasticsearchRestTemplate.update(updateQuery, this.witakeMedia);
    }
```
需要手动创建一个Document（其实就是个map），spring data elasticsearch会把它转换成UpdateQuery。（别忘了设置routing！！！上面的代码忘了设置了）

但是这种写法实在是不够通用！orm对象就不能直接转成Document吗？为什么还要我一个个把属性放到map（Document）里呢？

所以我研究了一下save是怎么做的。发现它能通过`ElasticsearchConverter#mapObject`把object自动转为Document对象。而ElasticsearchConverter是可以直接从ElasticsearchRestTemplate里获取的，所以我们也可以直接用ElasticsearchConverter做转换：
```
    public void update(WitakeMedia witakeMedia) {
        // 模仿save方法的obj转IndexRequest.source的方式
        UpdateQuery updateQuery = UpdateQuery.builder(witakeMedia.getRealId())
                .withDocument(elasticsearchConverter.mapObject(witakeMedia))
                .withRouting(String.valueOf(witakeMedia.getUserId()))
                .withRetryOnConflict(3)
                .build();
        elasticsearchRestTemplate.update(updateQuery, this.witakeMedia);
    }
```
> 这一次想起来设置routing了。

但是这个方法还不够通用，主要是id和routing是和WitakeMedia相关的，而非通用的。

继续参考save方法，它获取id和routing的方法也已经有了：
- ElasticsearchRestTemplate#getEntityId
- ElasticsearchRestTemplate#getEntityRouting

所以理论上，调用这两个方法就足够了：id、routing、source齐全，update query这不就直接生成了嘛！

但是不知为何，`ElasticsearchRestTemplate#getEntityId`是个private方法……所以现在如果想用它，得把它的整个方法体都拎出来，搞一个workaround：
```
    private final ElasticsearchRestTemplate elasticsearchRestTemplate;

    private final ElasticsearchConverter elasticsearchConverter;

    private final EntityOperations entityOperations;

    private final RoutingResolver routingResolver;

    public UpdateWitakeMediaRepositoryImpl(ElasticsearchRestTemplate elasticsearchRestTemplate) {
        this.elasticsearchRestTemplate = elasticsearchRestTemplate;
        // 获取converter
        this.elasticsearchConverter = elasticsearchRestTemplate.getElasticsearchConverter();

        MappingContext<? extends ElasticsearchPersistentEntity<?>, ElasticsearchPersistentProperty> mappingContext = this.elasticsearchConverter.getMappingContext();
		this.entityOperations = new EntityOperations(mappingContext);
		this.routingResolver = new DefaultRoutingResolver(mappingContext);
    }

    /**
     * update操作是手动构建的，且witake media的id和routing不一致，所以不要忘记手动设置routing。
     *
     * @param witakeMedia 待写入media
     */
    @Override
    public void update(WitakeMedia witakeMedia) {
        // 模仿save方法的obj转IndexRequest.source
        UpdateQuery updateQuery = UpdateQuery.builder(getEntityId(witakeMedia))
                .withDocument(elasticsearchConverter.mapObject(witakeMedia))
                .withRouting(elasticsearchRestTemplate.getEntityRouting(witakeMedia))
                .withRetryOnConflict(3)
                .build();
        elasticsearchRestTemplate.update(updateQuery, elasticsearchRestTemplate.getIndexCoordinatesFor(witakeMedia.getClass()));
    }

    @Nullable
    private String getEntityId(Object entity) {

        Object id = entityOperations.forEntity(entity, elasticsearchConverter.getConversionService(), routingResolver)
                .getId();

        if (id != null) {
            return stringIdRepresentation(id);
        }

        return null;
    }

    @Nullable
    private String stringIdRepresentation(@Nullable Object id) {
        return Objects.toString(id, null);
    }
```
但是我感觉getEntityId应该设置为public的。如果这个方法明天测试可行，就给spring data elasticsearch提个pr，把方法给为public，并增加一个update函数。

另外一点需要注意的，用来构建elasticsearch的UpdateRequest的UpdateQuery其实把`_update`和`_udpate_by_query`的属性混到一起了，但是实际转成UpdateRequest的时候，只会用其中一类的属性，另一类设置了也用不到。所以不要以为UpdateQuery里所有的属性只要设置了就有用了，要分清哪个是属于`_update`的，哪个是属于`_udpate_by_query`的。比如想使用update操作触发pipeline：
```
        Document doc = Document.create();
        doc.put("rawUrls", rawUrls);

        IndexCoordinates indexCoordinates = IndexCoordinates.of(appProperties.getEsIndexes().getWitakeMedia());

        // 比较狗。_update和_update_by_query所支持的参数并集都放在UpdateQuery里了，实际使用的时候要区分开，用错了等于没设置
        // 先更新文档
        UpdateQuery updateRawUrl = UpdateQuery.builder(witakeMedia.getRealId())
                .withDocument(doc)
                .withRetryOnConflict(3)
                .build();
        elasticsearchRestTemplate.update(updateRawUrl, indexCoordinates);

        // 再使用_update_by_query触发pipeline
        UpdateQuery updateByQuery = UpdateQuery.builder(new CriteriaQuery(new Criteria("_id").is(witakeMedia.getRealId())))
                // pipeline=branding
                .withPipeline("???")
                .build();
        return elasticsearchRestTemplate.update(updateByQuery, indexCoordinates);
```
> 上面的udpate又忘了设置routing了。

## 其他
打日志：
- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/index.html#elasticsearch.clients.logging

底层的client：
- https://docs.spring.io/spring-data/elasticsearch/docs/current/reference/html/#reference
# 长连接

- https://github.com/spring-projects/spring-boot/pull/32051


# spring boot对spring data的支持
`spring-boot-starter-data-elasticsearch`是spring boot的项目，和`spring-data-elasticsearch`是两码事。前者用到了后者，并提供了一些自动配置：
- https://docs.spring.io/spring-boot/docs/current/reference/html/data.html#data.nosql.elasticsearch

# 感想
使用spring data elasticsearch，只是把人从使用RestHighLevel写简单的查询的重复性工作里解放出来了，但是它也带了很多学习上的开销（save without reindex等）。但是相对来说，这些开销还是比较值得的，尤其是当查询elasticsearch的需求比较多的时候，这些开销就被分摊开来了。而且从另一方面来说，spring data elasticsearch的这些奇奇怪怪的点如果都注意到了，说明对elasticsearch的掌握已经比较深入了。

> 也可能对spring data本身的理解太浅显了，不然也不会有这么多开销 :D
