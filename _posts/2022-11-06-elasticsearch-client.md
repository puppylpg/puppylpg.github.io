---
layout: post
title: "Elasticsearch：client"
date: 2022-11-06 20:11:32 +0800
categories: elasticsearch spring-data-elasticsearch
tags: elasticsearch spring-data-elasticsearch
---

elasticsearch有很多Java client，底层的、上层的，废弃的、现存的，需要好好梳理一下，不然编程的时候一脸懵逼，尤其是使用spring boot自动配置client的时候。
- https://spinscale.de/posts/2022-03-03-running-the-elasticcc-platform-part-2.html

另外spring data elasticsearch也提供了基于elasticsearch原生client的上层client，比如ElasticsearchRestTemplate，在此一起进行对比。

1. Table of Contents, ordered
{:toc}

# LLRC
- https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/master/java-rest-low.html

Elasticsearch Low Level Rest Client（LLRC）：
- github：https://github.com/elastic/elasticsearch
- maven仓库：https://mvnrepository.com/artifact/org.elasticsearch.client/elasticsearch-rest-client
- 包名：`org.elasticsearch.client:elasticsearch-rest-client`
- 类：`org.elasticsearch.client.RestClient`

> 它的github地址就是elasticsearch的地址……所以它比较耦合，包含了elasticsearch所有的东西……

**它的包名是`org.elasticsearch.client:elasticsearch-rest-client`，无论已废弃的`org.elasticsearch.client:elasticsearch-rest-high-level-client`还是后面新出的`co.elastic.clients:elasticsearch-java`，底层都依赖它**：
```
<!-- https://mvnrepository.com/artifact/org.elasticsearch.client/elasticsearch-rest-client -->
<dependency>
    <groupId>org.elasticsearch.client</groupId>
    <artifactId>elasticsearch-rest-client</artifactId>
    <version>8.5.0</version>
</dependency>
```

> 注意：LLRC的名字里没有`low`，而HLRC的名字里有`high`。

LLRC做比较底层的请求工作，比如：
- 发送底层的HTTP请求；
- 处理TLS、http basic认证等；
- 选择cluster里的正确的节点，维护可使用的节点列表以发送http请求；

> takes care of all transport-level concerns: HTTP connection pooling, retries, node discovery, and so on

它内部使用的是Apache HttpClient。

# HLRC
- https://www.elastic.co/guide/en/elasticsearch/client/java-rest/current/java-rest-overview.html

Elaticsearch High Level Rest Client（HLRC）:
- github：https://github.com/elastic/elasticsearch
- maven仓库：https://mvnrepository.com/artifact/org.elasticsearch.client/elasticsearch-rest-high-level-client
- 包名：`org.elasticsearch.client:elasticsearch-rest-high-level-client`
- 类：`org.elasticsearch.client.RestHighLevelClient`

基于LLRC，提供一些高层的封装，比如有Request和Response实体类（**但不支持泛型，所以用起来没那么方便**）。

**7.15的时候被标记为deprecated（因为elasticsearch java client此时发布了，虽然还只是beta版），7.17.x之后就停止发布了**：
- https://www.elastic.co/guide/en/elasticsearch/client/java-rest/current/java-rest-high.html

# elasticsearch java
> 这朴实无华的名字……

- github：https://github.com/elastic/elasticsearch-java/
- maven仓库：https://mvnrepository.com/artifact/co.elastic.clients/elasticsearch-java
- 包名：`co.elastic.clients:elasticsearch-java`
- 类：`co.elastic.clients.elasticsearch.ElasticsearchClient`

> **包名用`co.elastic`是因为elasticsearch现在的官网是`elastic.co`**……之前用`org.elasticsearch`则很明显官网是`elasticsearch.org`，现在该网址301重定向到`https://www.elastic.co`。
>
> **它的名字里出现了java**（`elasticsearch-java`），而LLRC/HLRC的名字没出现java，出现的都是client，比如LLRC是`elasticsearch-rest-client`。

第一个版本是7.15.0，但它是beta版：
- https://github.com/elastic/elasticsearch-java/tags?after=v7.15.2

**[7.16是第一个正式版本](https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/7.16/introduction.html#_main_changes_since_version_7_15)。**

```
    <dependency>
      <groupId>co.elastic.clients</groupId>
      <artifactId>elasticsearch-java</artifactId>
      <version>8.4.3</version>
    </dependency>
```
因为它引入了序列化反序列化对象的功能（明显优于HLRC的地方），Response能够直接取出泛型对象，不需要再手动转了。

elasticsearch-java使用jsonp规范解析数据，同时把jackson作为底层实现，实现了jsonp的接口。具体可以参考elasticsearch-java里的：
- `JacksonJsonProvider extends jakarta.json.spi.JsonProvider`: A partial implementation of JSONP's SPI on top of Jackson
- `JsonpMapper`: A JsonpMapper combines a JSON-P provider and object serialization/deserialization based on JSON-P events
- 和它的实现类`JacksonJsonpMapper implements JsonpMapper`

jsonp默认已经声明在elasticsearch-java里了，所以如果系统里没有jackson，需要手动引入：
```
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>2.12.3</version>
    </dependency>
```

## 可能出现的jsonp依赖问题
如果报错：
> ClassNotFoundException: jakarta.json.spi.JsonProvider

就是jsonp的版本有问题（jakarta.json-api），很可能使用了1.x.x的jsonp依赖。

**1.x版本的`jakarta.json:jakarta.json-api`的包名是`javax.json`，而非`jakarta.json`**，从2.x开始才把包名改成后者。

所以如果出现：`ClassNotFoundException: jakarta.json.spi.JsonProvider`，可能是1.x版本的该依赖覆盖掉了`elasticsearch-java`里声明的2.x版本。此时需要手动引入2.x版本。

`jakarta.json:jakarta.json-api` 2.x版本是elasticsearch-java的默认jsonp版本，但它可能被springboot等默认的1.x版本的jsonp给覆盖掉：
```
<!-- https://mvnrepository.com/artifact/jakarta.json/jakarta.json-api -->
<dependency>
    <groupId>jakarta.json</groupId>
    <artifactId>jakarta.json-api</artifactId>
    <version>2.1.1</version>
</dependency>
```

### 为什么变包名？jakarta
javaEE（一系列标准和实现，比如servlet、JPA、bean validation等）已经交给开源基金会Eclipse Foundation了。**所以package也改了，从原来的`javax`变成了`jakarta`**（雅加达，印尼首都。Java岛就在印尼）。Eclipse创建了一个顶级project：[Eclipse Enterprise for Java(EE4J)](https://github.com/eclipse-ee4j/ee4j)。所以以后EE4J发布的高版本的原javaEE的依赖的包名都是`jakarta`开头的了。

- https://blogs.oracle.com/javamagazine/post/transition-from-java-ee-to-jakarta-ee

但是移交有一个过渡的过程。**最开始的发布的jakarta包，只是包的名字不叫javax了，但是里面的类的包名还是原来的`javax.*`，之后的版本才改成`jakarta.*`**。比如servlet api到了5，才改成`jakarta.*`，之前servlet api 4，即使jar包的名字叫`jakarta.servlet-api`，包名依然是`javax.*`。

> The highest impact item in this stage, however, is changing the package name in all the Java APIs from `javax.*` to `jakarta.*`.

Ref:
- https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/master/installation.html#class-not-found-jsonprovider

## 创建client
- https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/master/connecting.html

新的客户端包含三个主要组件，所以创建client也需要三步：
1. 基于LLRC；
2. **json object mapper：对象和json互转，所以说是strongly typed requests and responses**，HLRC做不到这一点；
3. transport layer：处理http请求；

```java
// 1. Create the low-level client
RestClient restClient = RestClient.builder(
    new HttpHost("localhost", 9200)).build();

// 2,3. Create the transport with a Jackson mapper
ElasticsearchTransport transport = new RestClientTransport(
    restClient, new JacksonJsonpMapper());

// And create the API client
ElasticsearchClient client = new ElasticsearchClient(transport);
```

## 设计理念
关于设计理念的介绍还是非常值得看看的：
- https://github.com/elastic/elasticsearch-java/tree/main/docs/design
- https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/api-conventions.html

### api参数为什么不用`Optional`？
elasticsearch api的参数有些是必传的（比如query里的value），有些是可选的（比如query里的size），**对于可选参数，要不要把类型定义成`Optional`**？
- https://github.com/elastic/elasticsearch-java/blob/main/docs/design/0000-model-classes-optionals.md

**API参数用了optional也白搭，对于`Optional`参数，API调用者依然可能传入null，所以还是得做参数的null check……**

既然无论如何都要做null check，所以，最终选择：
1. **必填API参数全都标注`@NotNull`**；
2. **可选API参数全都标注`@Nullable`**；

这样IDE就能在编码层面做很好的提示。在内部调用可选参数的时候，可以让它的getter返回Optional。

> We can however use Optional sanely: fields can be stored as nullable references, and translated to Optional when the getter is called. This also avoids excessive allocation of wrapping objects that may be long lived, and instead uses short-lived objects whose allocation may even be eliminated by inlining or escape analysis.

```java
// Optional property
@Nullable private String routing

public Optional<String> routing() {
  return Optional.of(this.routing);
}

public void routing(Optional<String> v) {
  this.routing = v.orElse(null);
}  
```
毕竟内部使用的时候，不会给Optional参数传个null，要不然真就是自己和自己过不去了……

教训：**API参数用`Optional`无意义。**

### model class为什么用immutable + builder
elasticsearch的request和response实体类怎么定义？pojo还是immutable data class + builder？
- https://github.com/elastic/elasticsearch-java/blob/main/docs/design/0001-model-classes-structure.md

pojo的缺点：
1. 可变；
2. **setter是随时可以调用的，所以不知道啥时候setter全都调用过了，无法做数据完整性校验**：The class cannot know when all setters have been called, and so cannot enforce any internal consistency check except by exposing a validation method that has to be called explicitly.

所以最终决定使用builder模式构建对象，对外只暴露getter方法。且因为没有setter，getter就可以忽略get前缀了，不需要`getName()`，直接用名字`name()`就行了。甚至还可以设置field为 public final，连getter方法都不用有了。

谈到public final，elasticsearch还整了个活儿，哈哈哈：
> Many developers freak out when they see public class fields ;-)

jdk14引入的[record class](https://www.baeldung.com/java-record-keyword)也是创建不可变对象的利器。它大致相当于一个只有`@Getter`和`@AllArgsConstruct`（当然`@ToString`和`@HashCode`也是有的），没有`@Setter`的类。

> [不过record class不提供builder模式，所以还是跟lombok差了点儿](https://www.baeldung.com/java-record-vs-lombok)。

elasticsearch的pojo则结合了上述两者，immutable + builder。

### 构建对象：使用lambda表达式
- https://github.com/elastic/elasticsearch-java/blob/main/docs/design/0001-model-classes-structure.md
- https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/building-objects.html

在构建嵌套对象上，如果嵌套对象的field传入一个`new Builder().xxx().build()`，会破坏构建的流畅性：
```java
FooResponse r = client.foo(
  FooRequest.builder()
    .name("z")
    .bar(Bar.builder()
      .name("Raise the bar")
      .build()
    )
  .build()
);
```
所以elasticsearch java client更倾向于传入一个lambda函数，用于builder构建时做回调，比如：
```java
FooResponse r = client.foo(foo -> foo
  .name("z")
  .bar(bar -> bar
    .name("Raise the bar")
  )
);
```
调用者只需要考虑怎么设置这个嵌套builder的属性就行了，`new builder()`和`build()`的步骤已经由elasticsearch做了。

elasticsearch java client几乎支持所有的嵌套对象都这么设置，同时也提供了上述传统的嵌套对象设置方法。比如query对象里的term对象：
```java
        // 可以直接传入一个Term对象
		public ObjectBuilder<Query> term(TermQuery v) {
			this._kind = Kind.Term;
			this._value = v;
			return this;
		}

        // 也可以传入一个term builder的回调，elasticsearch用这个回调构建出Term对象
		public ObjectBuilder<Query> term(Function<TermQuery.Builder, ObjectBuilder<TermQuery>> fn) {
			return this.term(fn.apply(new TermQuery.Builder()).build());
		}
```

> spring data elasticsearch在某些地方也有这种风格的代码。

这样写：
1. **不用import嵌套对象到当前类了**，因为使用的只是一个lambda Function；
2. **这样写出来的代码如果可以换一下行，很像DSL query**；

比如：
```java
FooResponse r = client.fooAction(foo -> foo
  .name("z")
  .query(q -> q       // abstract query builder
    .terms(tq -> tq   // choose the terms query implementation
      .field("bar")   // build the terms query
      .values("baz")
    )
  )
);
```
**甚至lambda表达式的入参，根本不需要被关心，用b0、b1……就行。相当于写query的时候完全只想DSL是怎么写的就行了，根本不需要记忆term的builder是Term.Builder还是TermQuery.Builder**：
```java
ElasticsearchClient client = ...
SearchResponse<SomeApplicationData> results = client
    .search(b0 -> b0
        .query(b1 -> b1
            .intervals(b2 -> b2
                .field("my_text")
                .allOf(b3 -> b3
                    .ordered(true)
                    .intervals(b4 -> b4
                        .match(b5 -> b5
                            .query("my favorite food")
                            .maxGaps(0)
                            .ordered(true)
                        )
                    )
                    .intervals(b4 -> b4
                        .anyOf(b5 -> b5
                            .intervals(b6 -> b6
                                .match(b7 -> b7
                                    .query("hot water")
                                )
                            )
                            .intervals(b6 -> b6
                                .match(b7 -> b7
                                    .query("cold porridge")
                                )
                            )
                        )
                    )
                )
            )
        ),
    SomeApplicationData.class 
);
```

> This example also highlights a useful naming convention for builder parameters in deeply nested structures. **For lambda expressions with a single argument, Kotlin provides the implicit `it` parameter and Scala allows use of `_`. This can be approximated in Java by using an underscore or a single letter prefix followed by a number representing the depth level (i.e. `_0`, `_1`, or `b0`, `b1` and so on).** Not only does this remove the need to create throw-away variable names, but it also improves code readability. Correct indentation also allows the structure of the query to stand out.

经验：用lambda参数构建builder时，IDE竟然不能自动补全！！！非常崩溃！后来发现，**先写后面的class参数，再写前面的lambda expression就能自动补全了……**

比如search请求，先写后面的XXX.class，再写前面的lambda就能有提示自动补全了……
```
elasticsearchClient.search(s -> s.index("ddd").query(q -> q.term(t -> t.field("s").value(v -> v.stringValue("s")))), XXX.class);
```

### Endpoint
所有的api其实就干两件事：
1. 发送请求；
2. 获取响应；

尤其是它是个http请求，所以只需要考虑：
1. 请求要转成什么样的：method、url、parameter、header、body；
2. 响应要怎么把body转回来；

以[create index api](https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-create-index.html)为例（因为它参数少，response也简单）。它的请求需要设置：
1. PUT
2. url path: index
2. parameter
    1. wait_for_active_shards
    2. master_timeout
    3. timeout
3. request body：可有可无

比如：
```
PUT /my-index-000001?timeout=1m
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 2
  }
}
```

它的响应需要设置：
1. response body
    1. json，三个字段：acknowledged、shards_acknowledged、index

比如：
```
{
  "acknowledged": true,
  "shards_acknowledged": true,
  "index": "my-index-000001"
}
```
> endpoint就是一个请求，带上response的deserializer，因为elasticsearch-java要能够反序列化响应。

普通的endpoint设计模式：
1. 构建一个Request对象，设置好属性，比如index、参数timeout等；
2. 里面有一个类似`send`的方法，能发送请求，返回响应；

但是这样有两个问题：
1. response类型不能拓展；
2. **request对象里必须持有client引用，这样的request就不是一个静态的（constant、static）request了**；

所以最好是把`send`方法独立出去，搞一个独立的client，有一个`send`方法，它接收一个请求，返回一个响应：
1. 请求实体类里，提供一个能把它转成http request的方法；
2. 并提供一个能把http response转成响应实体类的方法就行了。

比如这样的请求类：
```java
public interface XXRequest {
    // fields
    ...
    
    // http request
    
    public String genIndex();
    
    public Map<String, String> genParameters();
    
    public String genPath();
    
    //
    ...
    
    // http response
    
    public XxResponseDeserializer getResponseDeserializer();
}
```

但是elasticsearch没有直接在Request类里提供这样两种方法，而是把这两种行为交给了Request类里的Endpoint，**一个`Endpoint`定义了如何从Request对象构建出底层的http请求，并定义了deserializer，表明如何把请求反序列化**。所以可以认为关联了一个http request和它对应的response：
```java
public interface Endpoint<RequestT, ResponseT, ErrorT> {

  /**
   * The endpoint's identifier.
   */
  String id();

  /**
   * Get the endpoint's HTTP method for a request.
   */
  String method(RequestT request);

  /**
   * Get the URL path for a request.
   */
  String requestUrl(RequestT request);

  /**
   * Get the query parameters for a request.
   */
  default Map<String, String> queryParameters(RequestT request) {
    return Collections.emptyMap();
  }

  /**
   * Get the HTTP headers for a request.
   */
  default Map<String, String> headers(RequestT request) {
    return Collections.emptyMap();
  }

  boolean hasRequestBody();

  /**
   * The entity parser for the response body.
   */
  JsonpDeserializer<ResponseT> responseDeserializer();

  /**
   * Is this status code to be considered as an error?
   */
  boolean isError(int statusCode);

  /**
   * The entity parser for the error response body. Can be {@code null} to indicate that there's no error body.
   */
  @Nullable
  JsonpDeserializer<ErrorT> errorDeserializer(int statusCode);

}
```
以它的实现类`SimpleEndpoint`为例说明Endpoint的使用方式。`SimpleEndpoint`通过**方法回调**来生成request、解析response：**通过各种用户传入的函数来生成想要的http request/response部分（用户自定义生成行为）**。想定义一个endpoint，就需要使用一系列lambda行为作为构造函数的参数：
```java
    private final Function<RequestT, String> method;
    private final Function<RequestT, String> requestUrl;
    private final Function<RequestT, Map<String, String>> queryParameters;
    private final Function<RequestT, Map<String, String>> headers;
    private final boolean hasRequestBody;
    private final JsonpDeserializer<ResponseT> responseParser;

    public SimpleEndpoint(
        String id,
        Function<RequestT, String> method,
        Function<RequestT, String> requestUrl,
        Function<RequestT, Map<String, String>> queryParameters,
        Function<RequestT, Map<String, String>> headers,
        boolean hasRequestBody,
        JsonpDeserializer<ResponseT> responseParser
    ) {
        this.id = id;
        this.method = method;
        this.requestUrl = requestUrl;
        this.queryParameters = queryParameters;
        this.headers = headers;
        this.hasRequestBody = hasRequestBody;
        this.responseParser = responseParser;
    }

    @Override
    public String id() {
        return this.id;
    }

    @Override
    public String method(RequestT request) {
        return this.method.apply(request);
    }

    @Override
    public String requestUrl(RequestT request) {
        return this.requestUrl.apply(request);
    }
```

> 也可以不使用lambda，直接定义一系列接口方法，让实现类实现这些方法。这是两种理念，见下文。

了解它之前，先**举个简单的例子**。假设我们要根据first name和last name生成全名，有的姓在前名在后，有的名在前姓在后——

实体请求类：
```java
public class Name {
    String first;
    String last;
}
```
响应类：
```java
public class Person {
    String fullName;
    int age;
    // ...
}
```

第一种，提供两个方法：
```java
public Person firstLast(Name name) {
    String full = name.first + name.last;
    return new Person(full, ...);
}

public Person lastFirst(Name name) {
    String name.last + name.first;
    return new Person(full, ...);
}
```
显然，最后一句`new Person(full, ...)`重复了。当然可以把这一句封装为一个新的函数`newPerson(String full, ...)`，然后两个函数都调用该函数。**虽然最小化了代码重复，但都调用`newPerson(String full, ...)`依然是重复调用。**

第二种，多加一个标记，代表生成full name的方式，可以放在Name实体类里，也可以给函数多加一个参数：
```java
public Person name(Name name) {
    String full = name.first ? name.first + name.last : name.last + name.first;
    return new Person(full, ...);
}
```
这种方式写的方法少，因为方法逻辑复杂了，所以一个方法就够了。但是需要额外的判定标记才能决定用哪种逻辑分支，逻辑比较耦合，不太推荐。

第三种，**传入函数，相当于把一部分逻辑交给调用者**：
```java
public Person name(Name name, BiFunction<String, String, String> fullNameGenerator) {
    String full = fullNameGenerator.apply(name.first, name.last);
    return new Person(full, ...);
}
```
如果需要first last：
```java
name(name, (a, b) -> a + b);
```
如果需要last first：
```java
name(name, (a, b) -> b + a);
```
第三种方法，我们先写一个接受lambda的函数，再基于它写两个有不同lambda的name函数，就实现了两个生成策略。**第一个name函数已经写好了固定的逻辑，通过lambda暴露了不确定的逻辑，后面的两个name实现只需要提供lambda就行，达到了最大程度的代码复用。endpoint接口就是这样衍生出了一堆endpoint的！**

> **以后写代码可以考虑一下第三种，它的主要优点就是：开放、好拓展、最小化重复代码。**

**如果后来用户有了第三种名称生成方式：first-last**
```java
name(name, (a, b) -> a + "-" + b);
```

**可以学习这种“把函数做参数的函数”，这样写出来的函数的开放度更大一些**。之前经常写的函数都是把实体对象做参数，这可能并不能做到代码复用最大化。

再看`SimpleEndpoint`，它就是通过这种方式，**让参数lambda承担了不同的Endpoint的独有逻辑，自己写完了共有逻辑**。

比如`CreateIndexRequest`在类里定义了这么一个关于创建索引的endpoint实现，它是SimpleEndpoint的一个实例，传入了自己的http request生成行为：
```java
	/**
	 * Endpoint "{@code indices.create}".
	 */
	public static final Endpoint<CreateIndexRequest, CreateIndexResponse, ErrorResponse> _ENDPOINT = new SimpleEndpoint<>(
			"es/indices.create",

			// Request method
			request -> {
				return "PUT";
			},

			// Request path
			request -> {
				final int _index = 1 << 0;

				int propsSet = 0;

				propsSet |= _index;

				if (propsSet == (_index)) {
					StringBuilder buf = new StringBuilder();
					buf.append("/");
					SimpleEndpoint.pathEncode(request.index, buf);
					return buf.toString();
				}
				throw SimpleEndpoint.noPathTemplateFound("path");

			},

			// Request parameters
			request -> {
				Map<String, String> params = new HashMap<>();
				if (request.masterTimeout != null) {
					params.put("master_timeout", request.masterTimeout._toJsonString());
				}
				if (request.waitForActiveShards != null) {
					params.put("wait_for_active_shards", request.waitForActiveShards._toJsonString());
				}
				if (request.timeout != null) {
					params.put("timeout", request.timeout._toJsonString());
				}
				return params;

			}, SimpleEndpoint.emptyMap(), true, CreateIndexResponse._DESERIALIZER);
```
其实就是从用户构造好的create index Request里，取index、取param、取body、取header。

如果需要给原有request新增参数，普通写法要override原有Request类的某些方法。**按照新的写法，就是重写lambda入参**。其实没有本质区别，就是思路变了：逻辑从写在方法里，变成了写在lambda参数里。

比如一个endpoint：
```java
public static final Endpoint<FooRequest, FooResponse, ElasticsearchError> ENDPOINT =
    new Endpoint.Simple<>(
      r -> "POST",
      r -> "/foo",
      Endpoint.Simple.emptyMap(),
      Endpoint.Simple.emptyMap(),
      FooResponse.PARSER
    );
```

“继承”自它的另一个endpoint：
```java
public static final Endpoint<FooRequest, ReducedFooResponse, ElasticsearchError> FILTERED =
    new Endpoint.Simple<>(
      FooRequest.ENDPOINT::method,
      FooRequest.ENDPOINT::requestUrl,
      FooRequest.ENDPOINT::headers,
      r -> Map.of("filter_path", "-*.big_field"), // should be a static value for realz
      ReducedFooResponse.PARSER
);
```

倒不是一定非要用lambda参数这种模式，不过多了一种写代码的思路也挺好的。

ref：
- https://github.com/elastic/elasticsearch-java/blob/main/docs/design/0002-namespace-clients-and-endpoints.md

## Endpoint怎么用
endpoint接收一个request参数（或者更简洁的request lambda）。**所以用户侧只需要操心怎么通过lambda把Request实体类构建出来就行了：**
```java
elasticsearchClient.indices().create(c -> c.index("xxx"));
```

> **elasticsearch client的层次向来都是分明的。比如普通的api，client可以直接调用；index相关的api，都在`client.indices()`之下。**

在client侧，create方法实际会把创建索引**相关的endpoint、用户提供的request（lambda）**一同交给底层的transport，用于发送请求：
```java
	public CreateIndexResponse create(CreateIndexRequest request) throws IOException, ElasticsearchException {
		@SuppressWarnings("unchecked")
		JsonEndpoint<CreateIndexRequest, CreateIndexResponse, ErrorResponse> endpoint = (JsonEndpoint<CreateIndexRequest, CreateIndexResponse, ErrorResponse>) CreateIndexRequest._ENDPOINT;

		return this.transport.performRequest(request, endpoint, this.transportOptions);
	}
```
**实际上，所有的方法实现都是把它对应的endpoint和request交给底层的transport**，因为endpoint已经包含所有的请求构建、响应解析逻辑了。

而`Transport`实现就叫`RestClientTransport`，因为它是基于LLRC（RestClient）的。在`RestClientTransport`里：
```java
    public <RequestT, ResponseT, ErrorT> ResponseT performRequest(
        RequestT request,
        Endpoint<RequestT, ResponseT, ErrorT> endpoint,
        @Nullable TransportOptions options
    ) throws IOException {

        org.elasticsearch.client.Request clientReq = prepareLowLevelRequest(request, endpoint, options);
        org.elasticsearch.client.Response clientResp = restClient.performRequest(clientReq);
        return getHighLevelResponse(clientResp, endpoint);
    }
```
1. **先根据endpoint构造出request**；
2. 再调用底层的LLRC发送request获取response；
3. 最后使用endpoint里的`responseDeserializer`或者`errorDeserializer`解析请求/错误信息。**这里的解析就是反序列化，将响应体反序列化为对象**，因此用户调用`ElasticsearchClient`直接得到的就是对象；


主要看一下第一步，怎么根据endpoint获取request——
```java
    private <RequestT> org.elasticsearch.client.Request prepareLowLevelRequest(
        RequestT request,
        Endpoint<RequestT, ?, ?> endpoint,
        @Nullable TransportOptions options
    ) {
        String method = endpoint.method(request);
        String path = endpoint.requestUrl(request);
        Map<String, String> params = endpoint.queryParameters(request);

        org.elasticsearch.client.Request clientReq = new org.elasticsearch.client.Request(method, path);

        RequestOptions restOptions = options == null ?
            transportOptions.restClientRequestOptions() :
            RestClientOptions.of(options).restClientRequestOptions();

        if (restOptions != null) {
            clientReq.setOptions(restOptions);
        }

        clientReq.addParameters(params);

        if (endpoint.hasRequestBody()) {
            // Request has a body and must implement JsonpSerializable or NdJsonpSerializable
            ByteArrayOutputStream baos = new ByteArrayOutputStream();

            if (request instanceof NdJsonpSerializable) {
                writeNdJson((NdJsonpSerializable) request, baos);
            } else {
                JsonGenerator generator = mapper.jsonProvider().createGenerator(baos);
                mapper.serialize(request, generator);
                generator.close();
            }

            clientReq.setEntity(new ByteArrayEntity(baos.toByteArray(), JsonContentType));
        }
        // Request parameter intercepted by LLRC
        clientReq.addParameter("ignore", "400,401,403,404,405");
        return clientReq;
    }
```
分别从endpoint取出method、url、parameter、body，组成request即可。

**最后总结一下`Endpoint`的设计流程**：
1. elasticsearch-java负责定义request类（比如`CreateIndexRequest`）让用户提供构建请求的素材，同时request类里定义一个endpoint实现（`Endpoint<CreateIndexRequest, CreateIndexResponse, ErrorResponse> _ENDPOINT`），代表一系列行为，用于组合素材、构造出底层请求、反序列化响应；
2. 用户构建`CreateIndexRequest`请求（或lambda），用于提供素材：`elasticsearchClient.indices().create(c -> c.index("xxx"))`；
3. **elasticsearch-java所有的方法实现都遵循如下模板：将相应的请求素材和endpoint交给底层的transport**；
    1. transport使用endpoint从请求素材中组合出底层请求；
    2. 使用LLRC发送底层请求、获取响应；
    3. 使用endpoint里的deserializer反序列化响应；

再回头看`ElasticsearchClient`的创建步骤：需要一个LLRC，使用LLRC构建transport。顺理成章！

## elasticsearch java vs. HLRC：全面碾压
已废弃的RestHighLevelClient在两个地方很蹩脚：

第一个就是请求的构造，因为没有上述lambda builder setter支持，嵌套对象每一个都要知道要构建什么builder，也免不了import进来。写出来的请求和DSL差很远：
```
        SearchResponse response = restHighLevelClient.search(
                new SearchRequest(WITAKE_MEDIA)
                        .source(
                                new SearchSourceBuilder()
                                        .query(QueryBuilders.termQuery("id", "0"))
                        ),
                RequestOptions.DEFAULT
        );
```
另一个比较大的问题就是response不支持泛型，只能取出SearchHit，我们还要自己把search hit一个属性一个属性取出来（id、source等），手动转为实体类：
```
        SearchHit hit = Arrays.stream(response.getHits().getHits()).findFirst().get();
```

而ElasticsearchClient就很好地解决了上面两个问题：

非常DSL，终于有了统一的视觉：
```
        SearchResponse<WitakeMediaEs> response = elasticsearchClient.search(s -> s
                .index(WITAKE_MEDIA)
                .query(q -> q
                        .term(t -> t
                                .field("id")
                                .value(v -> v.stringValue("0"))
                        )
                ),
                WitakeMediaEs.class
        );
```
直接可以从search hit取出实体类对象，已经有jsonp为我们转换过了：
```
        Hit<WitakeMediaEs> hit = response.hits().hits().stream().findFirst().get();
        WitakeMediaEs witakeMediaEs = hit.source();
```

另外从elasticsearch client的开发者的角度来看，新的client更好维护，因为它的api可以由TypeScript生成。

比如index create api：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-create-index.html

对应的TypeScript描述为：
- https://github.com/elastic/elasticsearch-specification/blob/main/specification/indices/create/IndicesCreateRequest.ts

> github项目：https://github.com/elastic/elasticsearch-specification

能根据定义自动生成elasticsearch endpoint的代码，可以防止遗漏一些api的实现：
> along with code generated classes to make sure, that new endpoints are exposed as soon as they are defined within the Elasticsearch source.

HLRC则要手动一个个实现endpoint，增加了维护成本：
> Every class for every endpoint was created manually. Everything had to be kept in sync manually when new fields or parameters had been added resulting in high maintenance

> TypeScript，有意思，有空看看。Java学JavaScript引入了val，JavaScript学Java的强类型衍生了TypeScript:D

## elasticsearch java vs. spring data elasticsearch：各有千秋
spring data elasticsearch的ElasticsearchRestTemplate也支持泛型，所以和elasticsearch-java一样，也不需要手动转换类：
```
        SearchHit<WitakeMediaEs> searchHit = hits.getSearchHits().stream().findFirst().get();
        WitakeMediaEs witakeMediaEs = searchHit.getContent();
```

> 这个search hit是`org.springframework.data.elasticsearch.core.SearchHit<T>`不是`org.elasticsearch.search.SearchHit`。

但是在构造请求上，还不如elasticsearch-java方便，很像rest high level client，没有使用太多回调函数式风格构建query builder：
```
        SearchHits<WitakeMediaEs> hits = elasticsearchRestTemplate.search(
                new NativeSearchQueryBuilder()
                        .withQuery(
                                QueryBuilders.termQuery("id", "0")
                        )
                        .build(),
                WitakeMediaEs.class
        );
```

不过这个问题倒不是很大，因为spring data elasticsearch本身最大的优势就在于：它能根据查询接口方法自动生成请求。对于不太方便自动生成的请求，交给底层的ElasticsearchClient实现就行了。

另外，spring data elasticsearch 4.4已经集成elasticsearch-java用来构建reactive client了：
> Introduction of new imperative and reactive clients using the classes from the new Elasticsearch Java client

> TODO：reactive client后面再研究。

如果基于上述考虑混用二者，需要注意查询结果的反序列化：
1. spring data elasticsearch使用`@Field`将java属性转换为elasticsearch字段名（[从3.2起](https://stackoverflow.com/a/56840690/7676237)）；
2. elasticsearch-java使用jackson做属性转换，所以java对象的字段名和elasticsearch不一致时，要使用jackson的相关的注解进行转换，比如`@JsonProperty`、`@JsonIgnore`；

因此，**实体类上可能要标注两套注解**，给不同的框架使用，不要混淆。

比如下面的示例：
```
    @Id
    @ReadOnlyProperty
    @JsonIgnore
    private String realId;

    @Field(value = "id", type = FieldType.Keyword)
    @JsonProperty(value = "id")
    private String mediaId;
```
readId对应`_id`，因为标注了`@Id`，mediaId对应elasticsearch里自定义的`id`字段。之所以取名为mediaId而非id，是因为spring data elasticsearch默认会把名为id的当做`_id`（参考[Spring Data - Elasticsearch]({% post_url 2022-09-21-spring-data-elasticsearch %})）。加上`@ReadOnlyProperty`注解，是为了不让它自动生成一个`id` field。

`@JsonIgnore`用于elaticsearch-java，因为elasticsarch里不存在这个field，所以转的时候要忽略。`@JsonProperty`是为了让mediaId转换成`id` field，实际上不存在mediaId。

但是还有一个问题：`Instant`，**jackson默认转不了java8的对象，除了要新增包，还要给`ObjectMapper`注册上这个module，之后`ObjectMapper`才有了转换`Instant`对象的能力**。还好，elasticsearch-java的`JacksonJsonpMapper`支持传入自定义的`ObjectMapper`：
```
    @Bean
    public ElasticsearchClient elasticsearchClient(RestHighLevelClient restHighLevelClient) {
        // jackson to process java8 date/time
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        return new ElasticsearchClient(new RestClientTransport(restHighLevelClient.getLowLevelClient(), new JacksonJsonpMapper(objectMapper)));
    }
```
支持java8时间的包：
```
        <dependency>
            <groupId>com.fasterxml.jackson.datatype</groupId>
            <artifactId>jackson-datatype-jsr310</artifactId>
        </dependency>
```
Ref:
- https://codeboje.de/jackson-java-8-datetime-handling/

如果想自动创建index，最好使用spring data elasticsearch，非常方便，直接就能根据entity的注解生成mapping和analyzer了。

## 访问低版本elasticsearch server
elasticsearch-java好是好，只可惜发布的不够早。7.15才出现了beta版本，很可能生产环境的elasticsearch版本要比这个低。但是elasticsearch-java默认不支持访问低版本的elasticsearch，这个client会校验server的response header，如果没有`X-Elastic-Product: Elasticsearch`，直接就拒绝处理response了。

但是办法还是有的，既然缺header，手动补上就行了：
可以修改底层的http client，默认给低版本elasticsearch server的response加上header `X-Elastic-Product: Elasticsearch`；

- https://stackoverflow.com/a/74102828/7676237
- https://stackoverflow.com/a/74304292/7676237

spring boot可以这么设置：
```java
    /**
     * https://stackoverflow.com/a/74102828/7676237
     */
    @Bean
    public RestClientBuilderCustomizer lowVersionElasticsearchCompatibility() {
        return new RestClientBuilderCustomizer() {
            @Override
            public void customize(RestClientBuilder builder) {

            }

            public void customize(HttpAsyncClientBuilder builder) {
                // this request & response header manipulation helps get around newer versions of
                // elasticsearch-java client not working with older (<7.14) versions of Elasticsearch server
                builder.addInterceptorLast(
                        (HttpResponseInterceptor) (response, context) ->
                                response.addHeader("X-Elastic-Product", "Elasticsearch")
                );
            }
        };
    }
```
但是个别请求会不会有什么兼容问题就不得而知了，所以要写好集成测试。

## 反序列化response
`RestHighLevelClient#search`返回的是`SearchResponse`，获取hits后（`searchResponse.getHits().getHits()`），得到的是`SearchHit[]`，从`SearchHit#getSourceAsMap`只能获取`Map<String, Object>`，必须把map手动转成自己想要的类。

而`ElasticsearchClient#search`返回的是`SearchResponse<TDocument>`，它是带泛型的。获取hits后（`searchResponse.hits().hits()`），得到的是`List<Hit<T>>`，一路都是泛型，Hit也支持泛型，所以`Hit#source`直接就返回最终的类了。免去了自己手动转换的过程。

为什么HLRC不能直接返回类？因为它的`SearchHit`内部的source的表示形式是自定义的`BytesReference`接口，其实现类比如`BytesArray`内部存放的就是`byte[]`。**它没有对象的类信息，所以`SearchHit`要么直接返回bytes，要么转换一下，把bytes转成`Map<String, Object>`，但也仅此而已了**。而java client则支持泛型，所以它的`Hit`内部对source的表示形式是`<TDocument> source`，直接就是一个对象。这个对象是怎么来的？使用`jakarta.json`反序列化来的。

> 所以java client需要`jakarta.json-api`依赖。

具体怎么反序列化的？
```java
	protected static <TDocument> void setupHitDeserializer(ObjectDeserializer<Hit.Builder<TDocument>> op,
			JsonpDeserializer<TDocument> tDocumentDeserializer) {

		op.add(Builder::index, JsonpDeserializer.stringDeserializer(), "_index");
		op.add(Builder::id, JsonpDeserializer.stringDeserializer(), "_id");
		op.add(Builder::score, JsonpDeserializer.doubleDeserializer(), "_score");
		op.add(Builder::type, JsonpDeserializer.stringDeserializer(), "_type");
		op.add(Builder::explanation, Explanation._DESERIALIZER, "_explanation");
		op.add(Builder::fields, JsonpDeserializer.stringMapDeserializer(JsonData._DESERIALIZER), "fields");
		op.add(Builder::highlight, JsonpDeserializer.stringMapDeserializer(
				JsonpDeserializer.arrayDeserializer(JsonpDeserializer.stringDeserializer())), "highlight");
		op.add(Builder::innerHits, JsonpDeserializer.stringMapDeserializer(InnerHitsResult._DESERIALIZER),
				"inner_hits");
		op.add(Builder::matchedQueries, JsonpDeserializer.arrayDeserializer(JsonpDeserializer.stringDeserializer()),
				"matched_queries");
		op.add(Builder::nested, NestedIdentity._DESERIALIZER, "_nested");
		op.add(Builder::ignored, JsonpDeserializer.arrayDeserializer(JsonpDeserializer.stringDeserializer()),
				"_ignored");
		op.add(Builder::shard, JsonpDeserializer.stringDeserializer(), "_shard");
		op.add(Builder::node, JsonpDeserializer.stringDeserializer(), "_node");
		op.add(Builder::routing, JsonpDeserializer.stringDeserializer(), "_routing");
		op.add(Builder::source, tDocumentDeserializer, "_source");
		op.add(Builder::seqNo, JsonpDeserializer.longDeserializer(), "_seq_no");
		op.add(Builder::primaryTerm, JsonpDeserializer.longDeserializer(), "_primary_term");
		op.add(Builder::version, JsonpDeserializer.longDeserializer(), "_version");
		op.add(Builder::sort, JsonpDeserializer.arrayDeserializer(JsonpDeserializer.stringDeserializer()), "sort");

	}
```
可以看到`Hit`给elasticsearch返回的每一项都设置了一个反序列化器：比如`_routing`就是简单的反序列化为string，`_score`反序列化为double，`_version`反序列化为long。**但是`_source`并没有简单序列化为string，而是是按照自定义的`tDocumentDeserializer`反序列化为对象**。

这个deserializer是一个NamedDeserializer，它deserialize的方式是使用外部传入的`JsonpMapper`里面的deserializer。由于代码调用一直在委托，实在看不出用的哪个的mapper，所以debug了一下，发现这个`JsonMapper`就是`RestClientTransport`里的`JsonMapper`。`RestClientTransport`是我们手动创建的，里面的`ObjectMapper`就是我们添加过java8 `Instant`支持的`ObjectMapper`。所以，最后相当于它拿着`ElasticsearchClient#search`需要传入对象的class参数，进行了反序列化。

# spring boot配置client
通过上文已经知道：
1. LLRC是最基本的；
2. LLRC可以构造出HLRC，HLRC已弃用；
3. LLRC可以构造出transport，进而构造出ElasticsearchClient；

## 2.x
LLRC（`RestClient`）通过`RestClientBuilder`构造出来。springboot提供了`RestClientBuilderCustomizer`，所有的customizer会被收集构建为`RestClientBuilder`。如前文所写的`lowVersionElasticsearchCompatibility`这个customizer。
```java
		@Bean
		RestClientBuilder elasticsearchRestClientBuilder(
				ObjectProvider<RestClientBuilderCustomizer> builderCustomizers) {
			HttpHost[] hosts = this.properties.getUris().stream().map(this::createHttpHost).toArray(HttpHost[]::new);
			RestClientBuilder builder = RestClient.builder(hosts);
			builder.setHttpClientConfigCallback((httpClientBuilder) -> {
				builderCustomizers.orderedStream().forEach((customizer) -> customizer.customize(httpClientBuilder));
				return httpClientBuilder;
			});
			builder.setRequestConfigCallback((requestConfigBuilder) -> {
				builderCustomizers.orderedStream().forEach((customizer) -> customizer.customize(requestConfigBuilder));
				return requestConfigBuilder;
			});
			if (this.properties.getPathPrefix() != null) {
				builder.setPathPrefix(this.properties.properties.getPathPrefix());
			}
			builderCustomizers.orderedStream().forEach((customizer) -> customizer.customize(builder));
			return builder;
		}
```
有了`RestClientBuilder`之后，如果不存在HLRC相关的类，说明只使用LLRC，则通过builder直接构造HLRC：
```java
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnMissingClass("org.elasticsearch.client.RestHighLevelClient")
	@ConditionalOnMissingBean(RestClient.class)
	static class RestClientConfiguration {

		@Bean
		RestClient elasticsearchRestClient(RestClientBuilder restClientBuilder) {
			return restClientBuilder.build();
		}

	}
```

如果有HLRC相关的类，说明想使用HLRC，则自动构建HLRC：
```java
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnClass(org.elasticsearch.client.RestHighLevelClient.class)
	@ConditionalOnMissingBean({ org.elasticsearch.client.RestHighLevelClient.class, RestClient.class })
	static class RestHighLevelClientConfiguration {

		@Bean
		org.elasticsearch.client.RestHighLevelClient elasticsearchRestHighLevelClient(
				RestClientBuilder restClientBuilder) {
			return new org.elasticsearch.client.RestHighLevelClient(restClientBuilder);
		}

	}
```
然后再从HLRC里获取LLRC：
```java
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnClass(org.elasticsearch.client.RestHighLevelClient.class)
	@ConditionalOnSingleCandidate(org.elasticsearch.client.RestHighLevelClient.class)
	@ConditionalOnMissingBean(RestClient.class)
	static class RestClientFromRestHighLevelClientConfiguration {

		@Bean
		RestClient elasticsearchRestClient(org.elasticsearch.client.RestHighLevelClient restHighLevelClient) {
			return restHighLevelClient.getLowLevelClient();
		}

	}
```
**所以只有没有引入HLRC的包时，springboot才会直接配置LLRC，否则都是配置HLRC，再从HLRC获取LLRC**。大概是因为springboot要用上用户定义的那些builder customizer。

从springboot3.0开始，才引入对`ElasticsearchClient`的自动配置，在此之前，需要自己配置`ElasticsearchClient`：
```java
@AutoConfigureAfter({ElasticsearchRestClientAutoConfiguration.class})
@ConditionalOnClass(ElasticsearchClient.class)
public class ElasticsearchClientAutoConfigure {

    /**
     * 新的elasticsearch java client：https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/7.16/migrate-hlrc.html
     *
     * @param lowLevelClient low level client
     * @return 新client
     */
    @Bean
    @ConditionalOnBean(RestClient.class)
    @ConditionalOnMissingBean(ElasticsearchClient.class)
    public ElasticsearchClient elasticsearchClient(RestClient lowLevelClient) {
        // jackson to process java8 date/time
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        return new ElasticsearchClient(new RestClientTransport(lowLevelClient, new JacksonJsonpMapper(objectMapper)));
    }
}
```
通过LLRC配置`ElasticsearchClient`。需要注意的是，**LLRC必须先于`ElasticsearchClient`实例化，所以需要加上`@AutoConfigureAfter({ElasticsearchRestClientAutoConfiguration.class})`**。

另外还要自己实例化`JsonpMapper`以构建`RestClientTransport`。

## 3.x
springboot3.0引入对`ElasticsearchClient`的自动配置的同时，删除了对HLRC的自动配置！

因为没有了HLRC相关的包，所以会使用LLRC的builder customizer直接配置出LLRC。之后可以使用LLRC配置出`RestClientTransport`：
```java
	@Import({ JacksonJsonpMapperConfiguration.class, JsonbJsonpMapperConfiguration.class,
			SimpleJsonpMapperConfiguration.class })
	@ConditionalOnBean(RestClient.class)
	@ConditionalOnMissingBean(ElasticsearchTransport.class)
	static class ElasticsearchTransportConfiguration {

		@Bean
		RestClientTransport restClientTransport(RestClient restClient, JsonpMapper jsonMapper,
				ObjectProvider<TransportOptions> transportOptions) {
			return new RestClientTransport(restClient, jsonMapper, transportOptions.getIfAvailable());
		}

	}
```
再配置出`ElasticsearchClient`：
```java
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnBean(ElasticsearchTransport.class)
	static class ElasticsearchClientConfiguration {

		@Bean
		@ConditionalOnMissingBean
		ElasticsearchClient elasticsearchClient(ElasticsearchTransport transport) {
			return new ElasticsearchClient(transport);
		}

	}
```
最重要的是，要在LLRC之后再配置`ElasticsearchClient`，所以springboot的自动配置已经加上了`@AutoConfigurationAfter`：
```java
@AutoConfiguration(after = { JacksonAutoConfiguration.class, JsonbAutoConfiguration.class,
		ElasticsearchRestClientAutoConfiguration.class })
@ConditionalOnClass(ElasticsearchClient.class)
@Import({ ElasticsearchTransportConfiguration.class, ElasticsearchClientConfiguration.class })
public class ElasticsearchClientAutoConfiguration {

}
```

当然，`JsonpMapper`也会看情况自动配置：
```java
	@ConditionalOnMissingBean(JsonpMapper.class)
	@ConditionalOnBean(ObjectMapper.class)
	@Configuration(proxyBeanMethods = false)
	static class JacksonJsonpMapperConfiguration {

		@Bean
		JacksonJsonpMapper jacksonJsonpMapper() {
			return new JacksonJsonpMapper();
		}

	}

	@ConditionalOnMissingBean(JsonpMapper.class)
	@ConditionalOnBean(Jsonb.class)
	@Configuration(proxyBeanMethods = false)
	static class JsonbJsonpMapperConfiguration {

		@Bean
		JsonbJsonpMapper jsonbJsonpMapper(Jsonb jsonb) {
			return new JsonbJsonpMapper(JsonProvider.provider(), jsonb);
		}

	}

	@ConditionalOnMissingBean(JsonpMapper.class)
	@Configuration(proxyBeanMethods = false)
	static class SimpleJsonpMapperConfiguration {

		@Bean
		SimpleJsonpMapper simpleJsonpMapper() {
			return new SimpleJsonpMapper();
		}

	}
```
可能基于jackson、jsonb，或者直接`SimpleJsonpMapper`。

但是这里的JsonpMapper不支持传入自定义的ObjectMapper。因为[如果和其他地方共用一个ObjectMapper，会导致一个地方修改行为，影响到另一个地方](https://github.com/spring-projects/spring-boot/commit/a92ed5e2c2bc2fec62ae471df1a247cc69c9b03e)。而事实上ElasticsearchClient会[修改ObjectMapper的行为](https://github.com/spring-projects/spring-boot/issues/33426#issuecomment-1406287100)，所以共用的ObjectMapper如果在其他地方和这里设置的行为不一致，会导致错误。因此springboot在[构造JsonpMapper的时候不再支持传入ObjectMapper](https://github.com/spring-projects/spring-boot/commit/a92ed5e2c2bc2fec62ae471df1a247cc69c9b03e)。按照[springboot讨论的结果](https://github.com/spring-projects/spring-boot/issues/33426#issuecomment-1408945043)，如果想自定义ObjectMapper的行为，就自己构造一个JsonpMapper bean。

[Jackson3会自动集成java8 time支持](https://github.com/FasterXML/jackson-modules-java8)，但是不知道什么时候会发布。

# 感想
流行的开源代码写的还是很好的，多看看确实不一定在哪儿就悟了，编程水平又提升了。

Elasticsearch的client代码写的就已经很好了，期待看看Elasticsearch server的代码！
