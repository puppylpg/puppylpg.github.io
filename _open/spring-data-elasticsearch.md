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
增加一个根据entity的属性直接更新数据的方法，方便做更新操作。

但是这个pr的target branch设置错了，指向了`4.4.x`而不是`main`。刚开始对开源项目的发布流程不太懂，后来看多了慢慢就知道了所有的代码都要合到master，然后视情况合到不同的分支里。比如新特性只会合并到下一个版本的分支，bugfix可以合到下一个版本和之前已发布版本的分支。发版的时候使用对应分支的代码即可。[#2310](https://github.com/spring-projects/spring-data-elasticsearch/pull/2310)重新指向了`main`。

## [#2793](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793)
为highlight增加query支持，以在highlight部分使用和查询部分不同的query。

一开始使用的query类型是elasticsearch-java里的query，然后在code review的时候才了解到[spring-data-elasticsearch](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793#discussion_r1421031379)的核心类要屏蔽elasticsearch底层的细节，不能直接暴露出来，因为核心类还要被别的项目依赖。重新构思了一下，这里和query概念对应的就是spring-data-elasticsearch里的query，所以进行了替换。由于两个query的转换是核心常用操作，所以已经有了相关方法，直接拿来用就可以了。

> 测试用例不错，展示了索引数据的index流程。
{: .prompt-tip }

## [#2802](https://github.com/spring-projects/spring-data-elasticsearch/pull/2802)
为`@Highlight`注解增加`@Query`支持。

逻辑上承接[#2793](https://github.com/spring-projects/spring-data-elasticsearch/pull/2793)，既然已经在highlight里加入了对query的支持，那么可以在`@Highlight`注解里也加入相应操作，可以直接让用户以spring-data repository的方式，通过注解使用该功能。

实际实现的时候，比想象中的要复杂，因为一开始没注意到在注解里定义string query时，是可以支持参数替换的。项目里已经有了相关参数替换的代码，这里新建了`HighlightConverter`，把这一流程比较简洁地封装了起来。因为参数替换是和单个请求的参数相关的，所以highlight converter不像其他converter，不是单例，每一个请求都要实例化一个。

第一次注意到spring-data里可以直接用`@NonNullApi`直接给整个package默认标注nonnull，允许为null的地方需要手动设置`@Nullable`。这对开发流程有非常大的帮助，所有nullable的地方如果忘记了判断，编码时IDE直接就提示了。

关注一下注解是如何作用于代码的：
1. `@Highlight`注解的作用域是方法；
1. 处理方法，生成`ElasticsearchQueryMethod`的时候，**需要从方法上获取到`@Highlight`注解的内容，可以使用spring core里的`AnnotatedElementUtils#findMergedAnnotation`，非常简单**：
  > `this.highlightAnnotation = AnnotatedElementUtils.findMergedAnnotation(method, Highlight.class);`
1. 然后把`@Highlight`注解转化为`Highlight`实体类。这里的逻辑都封装在了`HighlightConverter#convert(org.springframework.data.elasticsearch.annotations.Highlight)`里；
1. 最后就可以把highlight实体类转换成elasticsearch-java里的highlight查询了；

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

## [#2826](https://github.com/spring-projects/spring-data-elasticsearch/pull/2826)
为`@Query`添加[SpEL](https://docs.spring.io/spring-framework/reference/core/expressions.html)支持！

> 目前为止改动最大的一处，实现大概花了完整的两天时间，后续修复一些测出来的bug又花了半天。

spring-data-elasticsearch的`@Query`支持string query，query可以[使用placeholder绑定参数](https://docs.spring.io/spring-data/elasticsearch/reference/elasticsearch/repositories/elasticsearch-repository-queries.html#elasticsearch.query-methods.at-query)，以实现不同参数的查询。这种绑定参数的实现比较简单，只能通过`?0`/`?1`来绑定第N个业务型参数（Pageable、Sort等不算）。如果能够以SpEL的方式访问参数则会方便很多。而且SpEL还支持访问参数的属性、通过SpEL语法做类型转换等更加高阶的用法，这样会让query方法里支持的参数类型更加灵活多样。

为了给query增加SpEL支持，首先去研究了一下[SpEL的解析器](https://docs.spring.io/spring-framework/reference/core/expressions/evaluation.html)。之前由于spring用的比较多，所以对SpEL并不算陌生，经常拿来对bean做赋值操作。但是仅限于此，并没有深入研究SpEL的解析和计算流程。显然这里如果想绑定SpEL支持，是需要这些步骤的。为此，先了解了SpEL的`Expression`、`ExpressionParser`和`EvaluationContext`，然后了解了SpEL的高阶语法，包括**[variable访问 `#`](https://docs.spring.io/spring-framework/reference/core/expressions/language-ref/variables.html)、[bean访问 `@`](https://docs.spring.io/spring-framework/reference/core/expressions/language-ref/bean-references.html)、[属性访问 `.`](https://docs.spring.io/spring-framework/reference/core/expressions/language-ref/properties-arrays.html)、[集合转换 `.![]`](https://docs.spring.io/spring-framework/reference/core/expressions/language-ref/collection-projection.html)、[表达式模板](https://docs.spring.io/spring-framework/reference/core/expressions/language-ref/templating.html)**等。除此之外，由于spring data jpa[很早](https://spring.io/blog/2014/07/15/spel-support-in-spring-data-jpa-query-definitions/)就在查询里[支持SpEL](https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html#jpa.query.spel-expressions)了，所以我还找了[spring data jpa](https://github.com/spring-projects/spring-data-jpa)和它的[example](https://github.com/spring-projects/spring-data-examples)，希望能得到一些借鉴。深入分析了其中的SpEL语法和实现后，才发现spring data jpa的实现要比想象的复杂很多，因为它要支持很多种QL，所以使用了多种正则对`@Query`里的string进行了匹配，来判断合适的SpEL替换位置。但是我们只需要支持elasticsearch的json query，没必要这么复杂。

接下来着手构建spring data elasticsearch里的SpEL支持。一开始想的比较简单：直接对`@Query`里的语句做SpEL evaluation即可。比较困难的地方在于**怎么绑定查询方法参数到SpEL的`EvaluationContext`上**。这一点参考了spring data jpa的实现，发现spring data common提供了`QueryMethodEvaluationContextProvider#getEvaluationContext`方法，接收`Parameters`信息和对应的参数值数组`Object[]`，之后spring data common会自动把他们一个个绑定为SpEL `EvaluationContext`里的变量。在spring data elasticsearch里，这些参数信息都可以从`ElasticsearchParametersParameterAccessor`里拿到，所以实现起来并不难。我在`ElasticsearchStringQuery`自己创建了一个`QueryMethodEvaluationContextProvider` default实例，来完成参数绑定的工作。

这样做是可以的，**但是这样做只能让SpEL从参数里取到信息**。按理来说，既然项目基于spring，那么也应该支持从spring context里获取bean的信息。**怎么和bean factory扯上关系呢**？spring data elasticsearch里之前已经有过使用SpEL的实现，且可以支持获取bean的信息，只不过局限在了[`@Document`注解对index name的处理](https://www.sothawo.com/2020/07/how-to-provide-a-dynamic-index-name-in-spring-data-elasticsearch-using-spel/)上。所以看看它是怎么获取的`QueryMethodEvaluationContextProvider`，我们也找到同样的provider就行了。深入代码后发现这个provider来自common里的`BasicPersistentEntity`，provider默认和我手动创建创建的一样，也是`EvaluationContextProvider.DEFAULT`，但是如前所述，这个default context显然不具备解析bean的能力。再仔细看，才发现它还提供了一个setter，可以由外部重新注入一个provider……原来，default context在运行时被替换掉了，真正被set进来的provider是`ExtensionAwareEvaluationContextProvider`，在`AbstractMappingContext`里完成。而且由于该类是个`ApplicationContextAware`，所以它是可以获取到`ApplicationContext`的，bean factory这不就来了嘛！这个bean factory就被设置到了provider里，从而能provide一个具有bean感知能力的`EvaluationContext`。**怎么把这样的provider传给`ElasticsearchStringQuery`让它去解析SpEL**？`ElasticsearchStringQuery`是由`ElasticsearchRepositoryFactory`里的`QueryLookupStrategy`创建的，而在common里，它的父类`RepositoryFactorySupport`里的`getQueryLookupStrategy`方法就提供了`QueryMethodEvaluationContextProvider`参数，就是我们想要的带有bean factory信息的provider。**只不过之前spring data elasticsearch并不支持在`@Query`里添加SpEL，所以这个由common传过来的参数也并没有用上**。现在就可以用了。

搞完上面的东西，基本上SpEL的功能就算实现了。虽然过程很复杂，但是最终写出来的代码并不多，加上测试用例也就一百多行。时间主要花在了对spring data common代码的理解上。说实话，想理解common的逻辑还是有点儿费劲的，而且非常难找spring data common本身的资料，找到的都是spring data一众子项目。不过它之所以是一众spring data的父项目，自然是提供了不少公共性的支持的，比如原始参数的解析获取、参数在SpEL context里的绑定等。

跑测试的时候，才发现事情并没有结束。有一个单元测试专门用来测试由spring data elasticsearch生成的原始elasticsearch json query是否符合预期。仿照其中的几个用例加了关于SpEL的单元测试后我才发现，当前实现的SpEL替换后的结果并不都符合elasticsearch的查询。比如`"term": { "value": "#{#name}" }`，**在查询里，`#{#name}`解析后的值被放在了双引号里，如果name变量的值本身是带引号的**，如`hello "world"`，SpEL解析完后就变成了`"term": { "value": "hello "world"" }`，这并不符合elasticsearch json query语法。**字符串里原有的引号应该被转义**，变成`"term": { "value": "hello \"world\"" }`，但是显然SpEL不知道这一点。再看看原有已支持的使用占位符（`?0`）的参数绑定功能，才意识到当初他们实现该功能的时候也遇到了同样的问题，所以对参数里碰到的引号手动多加了一层转义：
```java
parameterValue = parameterValue.replaceAll("\"", Matcher.quoteReplacement("\\\""));
```
而这些单元测试，也正是针对这一功能的。

所以我们**还需要干预SpEL计算值的过程**，让string里的引号多一层额外的转义。当然collection也有类似的问题，因为JDK里默认的`Collection#toString`也不满足elasticsearch json query里对集合值（比如`terms`查询会用到集合值）的定义。所以：
- 空collection要转为`[]`；
- 如果里面的值是string类型，**转换后的字符串要带上引号**，比如`["a", "b"]`。由于这个引号，string里原本的引号要被转义，比如`["hello \"world\""]`。这个转换最好应该由刚刚说的string转换器去处理，而不是collection转换器；
- 非string类型直接处理成string即可，**这样的值不需要被引号包围**，比如`[1, 2, 3]`。

**SpEL是怎么计算值的**？继续回到上面的provider，看看它提供的是什么样的`EvaluationContext`。`ExtensionAwareEvaluationContextProvider#getEvaluationContext`得到的是`StandardEvaluationContext`实例，它比`EvaluationContext`接口多了两个非常重要的方法：
- `setBeanResolver`：bean resolver接受一个bean factory，从而完成了上述在SpEL里查找bean的功能；
- `setTypeConverter`：接受一个type converter，从而完成SpEL的值转换的功能；

第二个方法涉及到的`TypeConverter`正是我们需要的。spring expression（SpEL）在实现它的功能的时候，委托给了spring的`ConversionService`。conversion service是spring里内置的一套通用的值转换方法。它里面注册了一堆`Converter`和`GenericConverter`，用以完成任意两种类型的值的转换。

**elasticsearch json query里主要就两类值：单值、多值，其中单值包括string和非string，多值就是collection**。这三种情况：
1. 单值非string：比如int，直接保持原值即可，比如1只需转换为1，从而得到查询`"term": { "value": 1 }`。在`ConversionService`里默认的integer转换器就是这样的，无需改变；
2. 单值string：如前所述，需要给字符串里原有的引号加一层转义。这就要求我们**自定义一个字符串到字符串的转换器**；
3. 多值：JDK里`Collection#toString`得到的字符串是这样的`[str1, str2]`，字符串本身没有被引号包围，不满足我们上面介绍的规则。所以还需要**自定义一个collection到字符串的转换器**。

> 如果集合里面的元素是string，只要继续调用`ConversionService`进行转换，自然会使用上述自定义的字符串到字符串的转换器，不用collection转换器操心字符串的转义问题。

所以才有了本次mr里的`ElasticsearchStringValueToStringConverter`和`ElasticsearchCollectionValueToStringConverter`两个converter。但是因为这两个converter靶向elasticsearch json query，所以这个`ConversionService`只能在解析`@Query`里的SpEL这一场景用，不能通用。

最后，经过SpEL解析后的`@Query` string得到的结果依然有些问题，比如`"term": { "value": "#{#name}" }`会被解析为`\"term\": { \"value\": \"hello \"world\"\" }`，除了`hello \"world\"`里的引号得到了正确的转义，查询的其他部分的引号也被转义了，这是不应该的……

再看SpEL的解析过程：`Expression#getValue(EvaluationContext, Class)`。由于我们`@Query`里的string并不全是SpEL表达式，只有`#{#name}`部分是，所以我们会用`new SpelExpressionParser().parseExpression(queryString, ParserContext.TEMPLATE_EXPRESSION)`对表达式进行解析，`#{`和`}`前后的部分都会被当做plain string，只有中间的部分才是真正需要evaluation的表达式。实际解析后，该string得到的`Expression`是一个`CompositeStringExpression`，它由三个`Expression`组成：
1. `LiteralExpression`：`"term": { "value": "`；
2. `SpelExpression`：`#{#name}`；
3. `LiteralExpression`：`" }`；

spel expression的`getValue`方法是获取值，然后使用`ConversionService`转换。如果值里有引号，会被自定义的`ElasticsearchStringValueToStringConverter`转换。literal expression的`getValue`方法是直接获取其中的literal部分，然后**也使用`ConversionService`转换**！所以这里的引号自然也会被错误转义！

没办法，只能单独判断了：
- **让literal expression直接通过`getExpressionString`获取原始字符串，而不是使用`getValue`获取转换后的值**；
- 让spel expression通过`getValue`获取转换后的值；
- 如果是composite expression，递归解析其中的每一个expression即可；

至此，SpEL终于成功支持了！由于该功能用到了参数绑定，所以spring data common里的`@Param`注解也有了用武之地。

光写下这一段话，梳理这个mr的实现历程，就花了我半天时间。梳理完后不得不感叹确实复杂。而在一开始，我对该功能的设想是：在转换`ElasticsearchStringQuery`之前，“直接对`@Query`里的语句做SpEL evaluation即可”。至于其中的曲折复杂，无论如何是想不到的。比如`ConversionService`，都是碰到之后再系统性边查边看的。还好，一路走来，终究是搞定了，爽！充实的一个周末~

后来根据维护者的review意见，又对代码增加了reactive支持，又断断续续花了两天时间。本来以为虚线程出了之后就不太用管reactive programming了，现在看来还是得管的:D

> 在`ElasticsearchStringQueryUnitTests`里，对解析后的`@Query`所做的判断不错，值得一看。
{: .prompt-tip }


## [#2834](https://github.com/spring-projects/spring-data-elasticsearch/pull/2834)
主要是为了统一`@Query`里旧有的placeholder replacement和新加的SpEL对查询值的处理逻辑，都使用`ConversionService`里新添加的`ElasticsearchCollectionValueToStringConverter`和`ElasticsearchStringValueToStringConverter`处理值。顺带修正了placeholder对值替换时的一个bug。在[#2833](https://github.com/spring-projects/spring-data-elasticsearch/pull/2833)里有详细的阐述。

这次代码虽然改动的远没上次多，但是我可以给满分！上次支持SpEL的时候，就打算使用新加的conversion service统一两处值转换的逻辑，但是在单元测试时失败了。失败的原因就是用户注册的custom converter注册到了default conversion service上，没有注册到新加的conversion service上，导致后者没有能力做一些自定义值转换。**怎么让新的conversion service拥有default conversion service的能力，同时又不让后者使用前者？**

这次设计了一个`ConversionService`的实现类`ElasticsearchQueryValueConversionService`，里面放了两个conversion service：一个valueConversionService，注册上上次实现的两个converter，专门用来转换elasticsearch query value；另一个是default conversion service，作为delegate。优先使用valueConversionService做值转换，如果转换不了，再使用delegate尝试。问题迎刃而解！尤其是下面把`this`注册到`ElasticsearchCollectionValueToStringConverter`的这一行代码，改动的那一瞬间惊为天人：
```java
private ElasticsearchQueryValueConversionService(ConversionService delegate) {
    Assert.notNull(delegate, "delegated ConversionService must not be null");
    this.delegate = delegate;

    // register elasticsearch custom type converters for conversion service
    valueConversionService.addConverter(new ElasticsearchCollectionValueToStringConverter(this));
    valueConversionService.addConverter(new ElasticsearchStringValueToStringConverter());
}
```
在注册elasticsearch值转换相关的converter的时候，因为collection类型的转换是递归的，所以需要传入一个conversion service，用于递归转换collection里的值。一开始放的是valueConversionService，单元测试没过的那一刻突然意识到它不包含默认的converter，这里的converter应该用this，也就是新创建的内含两重conversion service的conversion service。果然代码是逻辑上的体现，逻辑设计的好，代码写得就漂亮。

> 在`CustomMethodRepositoryELCIntegrationTests`里新加了`ElasticsearchCustomConversions`的注册逻辑，是spring data elasticsearch注册自定义converter的方式，值得一看。
{: .prompt-tip }

## [#2853](https://github.com/spring-projects/spring-data-elasticsearch/pull/2853)
给工程里原来使用placeholder replacement的地方都添加SpEL支持，比如`@Query` in `@Highlight`、`@SourceFilters`。为此需要把二者的处理逻辑封装在一起，放入`QueryStringProcessor`。比较麻烦的是所有这些地方都要传入`QueryMethodEvaluationContextProvider`以提供对SpEL表达式eval的能力。


