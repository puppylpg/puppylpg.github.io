---
layout: post
title: "Spring Data"
date: 2023-12-20 01:15:42 +0800
categories: spring-data spring-data-elasticsearch
tags: spring-data spring-data-elasticsearch
---

最近给spring data elasticsearch提交了一些PR（[#2793](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793)、[#2802](https://github.com/spring-projects/spring-data-elasticsearch/pull/2802)），趁此机会系统看一下[spring data commons](https://docs.spring.io/spring-data/commons/reference/)的文档，顺便填一下之前说的[spring data elasticsearch](https://docs.spring.io/spring-data/elasticsearch/reference/)文档的坑。而且二者正好一个是抽象规范，一个是落地实现，结合起来看会好理解很多。实际上，后者也从前者复用了不少文档。

> 填坑：[Spring Data - Elasticsearch]({% post_url 2022-09-21-spring-data-elasticsearch %})

1. Table of Contents, ordered
{:toc}

# spring data commons

> 文档里经常提到的store-specific：store就是指数据库，所以它的意思就是数据库特有的东西。比如spring-data-elasticsearch抄完commons的文档，自己再加一段关于elasticsearch的独有操作。

## 核心概念：object mapping
spring data的核心概念就是[Object Mapping](https://docs.spring.io/spring-data/commons/reference/object-mapping.html)，OM，对象映射，**目的是把Java对象和底层的数据存储映射起来**。

> 不叫ORM，估计是因为它既能支持关系型数据库又能支持非关系型数据库？

核心流程就是：**创建一个对象，再填充对象的属性值**。
> Core responsibility of the Spring Data object mapping is to create instances of domain objects and map the store-native data structures onto those. This means we need two fundamental steps:
> 1. Instance creation by using one of the constructors exposed.
> 2. Instance population to materialize all exposed properties.

### 对象创建
对象创建有[一些规则](https://docs.spring.io/spring-data/commons/reference/object-mapping.html#mapping.object-creation)：**使用spring data的特定注解显式指定的构造方式优先，构造函数次之**。

同时为了提升性能，spring data没有使用传统的Java反射创建对象，而是使用了**运行时创建的object instantiator工具类**。

比如：
```java
class Person {
  Person(String firstname, String lastname) { … }
}
```
为了创建该对象，会生成一个相关的object instantiator：
```java
class PersonObjectInstantiator implements ObjectInstantiator {

  Object newInstance(Object... args) {
    return new Person((String) args[0], (String) args[1]);
  }
}
```

### 属性填充
属性填充看似简单，实则也设置了[很多规则](https://docs.spring.io/spring-data/commons/reference/object-mapping.html#mapping.property-population)，整体思路就是：**属性尽量搞成不可变的，然后使用`with...`设置不可变属性；尽量使用constructor设置值（spring data推荐使用lombok构建all-args constructor）；使用setter设置值；直接修改值**。

同样，对于一个实体：
```java
class Person {

  private final Long id;
  private String firstname;
  private @AccessType(Type.PROPERTY) String lastname;

  Person() {
    this.id = null;
  }

  Person(Long id, String firstname, String lastname) {
    // Field assignments
  }

  Person withId(Long id) {
    return new Person(id, this.firstname, this.lastame);
  }

  void setLastname(String lastname) {
    this.lastname = lastname;
  }
}
```
也是避免使用反射，而是**使用运行时生成的property accessor来设置属性**：
```java
class PersonPropertyAccessor implements PersistentPropertyAccessor {

  private static final MethodHandle firstname;

  private Person person;

  public void setProperty(PersistentProperty property, Object value) {

    String name = property.getName();

    if ("firstname".equals(name)) {
      firstname.invoke(person, (String) value);
    } else if ("id".equals(name)) {
      this.person = person.withId((Long) value);
    } else if ("lastname".equals(name)) {
      this.person.setLastname((String) value);
    }
  }
}
```

规则很复杂，但一般我们使用的场景都比较简单，一个lombok `@Data`走天下:D 如果想更加合理，可以参考spring data给出的[General recommendations](https://docs.spring.io/spring-data/commons/reference/object-mapping.html#mapping.general-recommendations)。

## 使用流程：`Repository`
spring data `Repository`的[目的](https://docs.spring.io/spring-data/commons/reference/repositories.html)是**在查数据的时候能够不写查询数据库的代码**。

> The goal of the Spring Data repository abstraction is to significantly reduce the amount of boilerplate code required to implement data access layers for various persistence stores.

使用spring data做查询（以取代传统CRUD）需要[四步](https://docs.spring.io/spring-data/commons/reference/repositories/query-methods.html)：
1. 创建一个接口，[继承`Repository`](https://docs.spring.io/spring-data/commons/reference/repositories/definition.html)；
2. 在接口里[定义查询方法](https://docs.spring.io/spring-data/commons/reference/repositories/query-methods-details.html)；
3. 构建spring配置，为接口[创建代理对象](https://docs.spring.io/spring-data/commons/reference/repositories/create-instances.html)；
4. 在需要使用的地方注入代理对象；

### query method
在接口里[定义方法](https://docs.spring.io/spring-data/elasticsearch/reference/repositories/query-methods-details.html)有两种方式：
1. **按照特定规则构造方法名**，然后由spring data解析方法名来生成查询；
2. **手动定义一个查询**，比如spring data elasticsearch的`@Query`；

**spring data默认使用的`queryLookupStrategy`就是`CREATE_IF_NOT_FOUND`：如果用户手动定义查询，就使用`USE_DECLARED_QUERY`，否则按照方法名`CREATE`**。

按照特定规则构造方法名主要是构建两部分：主语和谓词。参考[Repository query keywords](https://docs.spring.io/spring-data/commons/reference/repositories/query-keywords-reference.html)。

> Parsing query method names is divided into subject and predicate. 

方法所支持的返回类型可以参考[Repository query return types](https://docs.spring.io/spring-data/commons/reference/repositories/query-return-types-reference.html)。

在spring data elasticsearch里，多用[`query_string`](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html)将方法名解析为对应的查询，具体对应关系可以查看[这里](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/repositories/elasticsearch-repository-queries.html)。

### 自定义repository
如果查询方法过于个性化，spring data不太好生成，可以[自定义repository](https://docs.spring.io/spring-data/commons/reference/repositories/custom-implementations.html)，将自定义的查询方法融入到spring data里。

> 可以参考[Spring Data - Elasticsearch]({% post_url 2022-09-21-spring-data-elasticsearch %})



## spring data elasticsearch的Object Mapping
spring data elasticsearch的Object Mapping有很多自定义的注解，对应着elasticsearch相关的数据类型和概念，可以在[这里](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/object-mapping.html#elasticsearch.mapping.meta-model.annotations)详细查看。比如：是否写入mapping、date format、range type等等。

## converter
如果默认的类型转换不能满足需求，还可以[自定义`Converter`](https://docs.spring.io/spring-data/commons/reference/custom-conversions.html)，通过`@ValueConverter`注解指定到具体的property上。详情可参考[Spring Data - Elasticsearch]({% post_url 2022-09-21-spring-data-elasticsearch %})。

## callback
spring data同样支持在数据读写前后[做一些回调操作](https://docs.spring.io/spring-data/commons/reference/entity-callbacks.html)。spring data elasticsearch还[拓展出了更多的回调](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/entity-callbacks.html#elasticsearch.entity-callbacks)。详情也可参考[Spring Data - Elasticsearch]({% post_url 2022-09-21-spring-data-elasticsearch %})。

## scrolling
- https://docs.spring.io/spring-data/commons/reference/repositories/scrolling.html

## null值处理
在[null值处理](https://docs.spring.io/spring-data/commons/reference/repositories/null-handling.html)上，spring data有一些比较关键的约定。

### null相关注解
首先spring data定义了4个注解：`@NonNullApi`/`@NonNullFields`/`@NonNull`/`@Nullable`。其中比较陌生的是`@NonNullApi`，它用在`package-info.java`上，之后**整个包下parameter和return type**，除非显式设置`@Nullable`，否则都不能为null。`@NonNullFields`同理，**作用对象是属性**。

在[为spring data elasticsearch添加highligh query支持](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793/files)时，就碰到了该情况。当时为新增的`Query`设置初始值为null，IDE警告：'null' is assigned to a variable that is annotated with `@NotNull`。后来才发现因为该package同时标注了`@NonNullApi`和`@NonNullFields`。

**non null注解作用范围内的代码会在运行时被检查，一旦发现出现了null值，就会抛出异常**：
> Once non-null defaulting is in place, repository query method invocations get validated at runtime for nullability constraints. If a query result violates the defined constraint, an exception is thrown.

### null值返回
**在返回值上，所有的wrapper类（比如`Optional`）、collection、streams等的方法，都不会返回null，而是相对应的空值表示**，比如`Optional.empty()`：
> Repository methods returning collections, collection alternatives, wrappers, and streams are guaranteed never to return null but rather the corresponding empty representation.

方法所支持的返回类型可以参考[Repository query return types](https://docs.spring.io/spring-data/commons/reference/repositories/query-return-types-reference.html)。

## 怎么判断一个对象是不是新的
判断一个entity是不是新的是有必要的，可能涉及更新对象或新增对象。spring data有[一系列判断规则](https://docs.spring.io/spring-data/commons/reference/is-new-state-detection.html)，比如id为null或0（in case of primitive types），就是新对象。在spring data elastcisearch里，[还需要靠`Persistable`接口](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/auditing.html#elasticsearch.auditing.preparing)：
> As the existence of an Id is not a sufficient criterion to determine if an enitity is new in Elasticsearch, additional information is necessary. One way is to use the creation-relevant auditing fields for this decision

## Auditing
[Auditing](https://docs.spring.io/spring-data/commons/reference/auditing.html)的概念听起来很像git，为了能记录谁在什么时候对数据做了修改（但是似乎并不能记录改了啥）。

> Spring Data provides sophisticated support to transparently keep track of who created or changed an entity and when the change happened.

spring data elasticsearch[同样支持auditing](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/auditing.html#elasticsearch.auditing.preparing)。

## 投影
[Projections投影](https://docs.spring.io/spring-data/commons/reference/repositories/projections.html)的概念听起来更像映射。如果需要返回的只是对象的一部分，除了在返回对象后手动做映射转换之外，还可以直接让spring data返回转换后的部分。如果这个转换操作是高频操作，交给spring data会让代码更简洁。

## 事件发布
spring data在增删数据的时候还能[做事件的发布](https://docs.spring.io/spring-data/commons/reference/repositories/core-domain-events.html)！

> aggregate root指的是spring data的repository所管理的实体对象，即entity。
>
> Entities managed by repositories are aggregate roots.

## QBE
- https://docs.spring.io/spring-data/commons/reference/query-by-example.html

很像elasticsearch-java client的查询啊

## web拓展支持
- https://docs.spring.io/spring-data/commons/reference/repositories/core-extensions.html#core.web

# 开发者指南
[开发者文档](https://github.com/spring-projects/spring-data-commons/wiki/Developer-guide)深入到了spring data具体的实现，还是要好好看一看的，无论是spring data还是spring data elasticsearch，想提交更多PR还是要看得更深入。

# spring data elasticsearch
除了上述spring data共有的功能，在spring data elasticsearch下面还能找到一些支持elasticsearch独有功能文档。比如：
- [基于elasticsearch的不同的`Query`实现](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/template.html#elasticsearch.operations.nativequery)；
- [父子文档](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/join-types.html)；
- [`_routing`](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/routing.html)；
- [index setting/mapping、scroll、sort、runtime field、PIT](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/misc.html)；
- [Scripted and runtime fields](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/scripted-and-runtime-fields.html)；

功能还是挺多的。

# 感想
面对开发者，spring真的是比亲妈还操碎了心……

