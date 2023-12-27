---
title: spring-data-elasticsearch
date: 2023-12-27 18:11:25 +0800
order: 1
---

- [my issue](https://github.com/spring-projects/spring-data-elasticsearch/issues?q=is%3Aissue+author%3A%40me+)
- [my PR](https://github.com/spring-projects/spring-data-elasticsearch/pulls?q=is%3Apr+author%3A%40me+)

1. Table of Contents, ordered
{:toc}

## [#2305](https://github.com/spring-projects/spring-data-elasticsearch/pull/2305)
增加一个根据entity直接更新数据的方法，方便做更新操作。

但是这个pr的target branch设置错了，指向了`4.4.x`而不是`main`。刚开始对开源项目的发布流程不太懂，后来看多了慢慢就知道了所有的代码都要合到master，然后视情况合到不同的分支里。比如新特性只会合并到下一个版本的分支，bugfix可以合到下一个版本和之前已发布版本的分支。发版的时候使用对应分支的代码即可。[#2310](https://github.com/spring-projects/spring-data-elasticsearch/pull/2310)重新指向了`main`。

## [#2793](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793)
为highlight增加query支持，以在highlight部分使用和查询部分不同的query。

一开始使用的query类型是elasticsearch-java里的query，然后在code review的时候才了解到[spring-data-elasticsearch](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793#discussion_r1421031379)的核心类要屏蔽elasticsearch底层的细节，不能直接暴露出来，因为核心类还要被别的项目依赖。重新构思了一下，这里和query概念对应的就是spring-data-elasticsearch里的query，所以进行了替换。由于两个query的转换是核心常用操作，所以已经有了相关方法，直接拿来用就可以了。

> 测试用例不错，展示了索引数据的index流程。
{: .prompt-tip }

## [#2802](https://github.com/spring-projects/spring-data-elasticsearch/pull/2802)
逻辑上承接[#2793](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793)，既然已经在highlight里加入了对query的支持，那么可以在`@Highlight`注解里也加入相应操作，可以直接让用户以spring-data repository的方式，通过注解使用该功能。

实际实现的时候，比想象中的要复杂，因为一开始没注意到在注解里定义string query时，是可以支持参数替换的。项目里已经有了相关参数替换的代码，这里新建了`HighlightConverter`，把这一流程比较简洁地封装了起来。因为参数替换是和单个请求的参数相关的，所以highlight converter不像其他converter，不是单例，每一个请求都要实例化一个。

第一次注意到spring-data里可以直接用`@NonNullApi`直接给整个package默认标注nonnull，允许为null的地方需要手动设置`@Nullable`。这对开发流程有非常大的帮助，所有nullable的地方如果忘记了判断，编码时IDE直接就提示了。

> 测试用例不错，展示了如何以spring-data repository的方式使用spring-data-elasticsearch。
{: .prompt-tip }

## [#2806](https://github.com/spring-projects/spring-data-elasticsearch/pull/2806)
在spring-data-elasticsearch的返回里添加更多elasticsearch response的细节，比如shard统计信息。

需求本身是比较简单的，但是shard统计信息里有很多自定义的类，在这些类[究竟是要重写还是直接暴露](https://github.com/spring-projects/spring-data-elasticsearch/pull/2806#discussion_r1436214492)的问题上，我表达了疑惑。维护者也承认了这一[窘境](https://github.com/spring-projects/spring-data-elasticsearch/pull/2806#discussion_r1436548128)，并表示elasticsearch-java里的类是使用脚本生成的，但我们的类不是啊！所以不太能复用，显得有些丑。而我也在[elasticsearch-specification](https://github.com/puppylpg/elasticsearch-specification/tree/main/specification)里注意到了这一情况。最终选择了类重写。好在elasticsearch里的`ErrorCause`是复用的，所以这里也可以借助之前的代码，稍稍省些力。

## [#2807](https://github.com/spring-projects/spring-data-elasticsearch/pull/2807)
为项目添加[multiple template search](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-template.html#run-multiple-templated-searches)支持。

之前项目已经支持了[search](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-search.html)、[msearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-multi-search.html)、[template search](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-template-api.html)，没有支持[multiple template search](https://www.elastic.co/guide/en/elasticsearch/reference/current/multi-search-template.html)。一开始我看到`SearchTemplateQuery`是spring-data-elasticsearch的query接口的子类之一，还以为[search template](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/misc.html#elasticsearch.misc.searchtemplates)是spring-data-elasticsearch自己创建的独立功能，看了文档才发现是elasticsearch的。

比较麻烦的是，elasticsearch-java中，这四个请求基本是独立的，使用独立的方法发起请求。所以在spring-data-elasticsearch里，需要根据请求的具体类型，使用四个方法之一发起请求。而且虽然api里template search的request body和multiple template search的request body里的body部分一致，但实际上elasticsearch-java提供的是不同的类，所以代码并不能复用。

好在研究完elasticsearch-java提供的代码，我发现`MsearchRequest`和`MsearchTemplateRequest`在request body里的header部分共用了`MultisearchHeader`，在构造multiple template search的时候简单了一些。body部分虽然不同，但是multiple template search的body部分参数较少，直接参考template search的body构建即可，不算麻烦。返回结果部分，elasticsearch-java的`MsearchResponse`和`MsearchTemplateResponse`共用了`MultiSearchResponseItem`，直接避免了再来一次hits遍历和转型，大大节省了工作量。

> 测试用例不错，展示了完整的以spring-data repository的方式使用spring-data-elasticsearch的流程。同时也展示了在spring-data-elasticsearch里构建集成测试时，测试索引防重名的办法。
{: .prompt-tip }
