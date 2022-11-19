---
layout: post
title: "Testcontainers - Elasticsearch"
date: 2022-11-08 00:43:46 +0800
categories: docker testcontainers elasticsearch
tags: docker testcontainers elasticsearch
---

第一次接触testcontainers，是改spring-data-elasticsearch的代码，当时就被testcontainers的集成测试惊艳到了。后来第二次再碰到testcontainers，是研究elasticsearch client时看别人用testcontainers测试client，第二次见面就感觉熟悉多了。小小研究之后，真的感觉相见恨晚，集成测试的问题从此解决了！再也不用配置h2模拟mysql了，再也不用写spring复杂的集成测试了。毕竟这是一个真服务，只要把它接入测试就行了，大大降低了写集成测试代码的难度。

1. Table of Contents, ordered
{:toc}

# 启动testcontainer elasticsearch
## 端口
elasticsearch 7.x默认绑定两个端口：
- 9200：http api连接；
- 9300：集群内部使用该端口通信（leader选举等）；历史原因，一些jar library client也使用该端口；

> 9300: Elasticsearch Default Transport port The TransportClient will be removed in Elasticsearch 8. No need to expose this port anymore in the future.

- https://discuss.elastic.co/t/what-are-ports-9200-and-9300-used-for/238578?u=puppylpg

这是container内部绑定的端口，**默认情况下，会把container内部绑定的两个端口都映射为本地端口**：
```
> docker container ls
CONTAINER ID   IMAGE                                                  COMMAND                  CREATED          STATUS          PORTS                                              NAMES
bdcb01292e95   docker.elastic.co/elasticsearch/elasticsearch:7.12.0   "/bin/tini -- /usr/l…"   11 seconds ago   Up 10 seconds   0.0.0.0:12625->9200/tcp, 0.0.0.0:12626->9300/tcp   hopeful_bhabha
d7c6a5102a69   testcontainers/ryuk:0.3.4                              "/app"                   13 seconds ago   Up 11 seconds   0.0.0.0:12611->8080/tcp                            testcontainers-ryuk-93b16e0f-c92c-426a-b6fc-2d0ead3c3d3e
```
**如果使用`.withExposedPorts(9200)`显式将docker绑定的端口映射到本地端口，则只有显式声明的端口才会映射到本地端口**：
```
> docker container ls
CONTAINER ID   IMAGE                                                  COMMAND                  CREATED         STATUS         PORTS                               NAMES
122f2219e24d   docker.elastic.co/elasticsearch/elasticsearch:7.12.0   "/bin/tini -- /usr/l…"   7 seconds ago   Up 6 seconds   9300/tcp, 0.0.0.0:12290->9200/tcp   gifted_wing
89893942953f   testcontainers/ryuk:0.3.4                              "/app"                   9 seconds ago   Up 8 seconds   0.0.0.0:12276->8080/tcp             testcontainers-ryuk-137b52ba-4250-47a4-b098-f3bf0d8df98c
```
所以使用`.withExposedPorts(9200, 9300)`和不使用的效果是一样的，都是将两个端口映射到本地端口。

## 获取docker端口本地映射
**想要用elasticsearch client连接container，需要使用本地映射的端口，但本地映射的端口是动态的。**

使用9200自然是连不上的：
- https://stackoverflow.com/questions/70705117/connection-refused-with-elasticsearch-test-container-even-after-adding-wait

> 既然用的是docker，就要尊重docker的基本原理，使用本地映射的端口。

在[testcontainer elasticsearch](https://www.testcontainers.org/modules/elasticsearch/)官方实例中，示范了 **获取本地动态映射端口的方法：`ElaticsearchContainer#getHttpHostAddress()`**

比如手动构建client：
```
client =
        RestClient
            .builder(HttpHost.create(container.getHttpHostAddress()))
            .setHttpClientConfigCallback(httpClientBuilder -> {
                return httpClientBuilder.setDefaultCredentialsProvider(credentialsProvider);
            })
            .build();
```

**但是如果是使用spring boot，elasticsearch client是根据properties属性自动创建的。也就是说`spring.elasticsearch.uris`是提前写到properties文件里的**，这怎么办？

**spring test提供了一个注解专门做这件事：`@DynamicPropertySource`，能够在运行时动态设置properties**：

> Method-level annotation for integration tests that need to add properties with dynamic values to the Environment's set of PropertySources.
>
> **This annotation and its supporting infrastructure were originally designed to allow properties from Testcontainers  based tests** to be exposed easily to Spring integration tests. However, this feature may also be used with any form of external resource whose lifecycle is maintained outside the test's ApplicationContext.

所以可以在运行时获取动态地址后，设置到`spring.elasticsearch.uris`属性：
```
    @DynamicPropertySource
    static void elasticProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.elasticsearch.uris", container::getHttpHostAddress);
    }
```
实际上properties文件里的`spring.elasticsearch.uris`就不用设置了。

- https://stackoverflow.com/a/71995586/7676237

## 完整示例

定义container：
```
public class XxxElasticsearchContainer {

    private static final String IMAGE_NAME = "docker.elastic.co/elasticsearch/elasticsearch:7.12.0";

    public static ElasticsearchContainer getXxxContainer() {
        return new ElasticsearchContainer(IMAGE_NAME)
                .withPassword("pikachu")
                .withEnv("ES_JAVA_OPTS", "-Xms1024m -Xmx1024m");
    }
}
```
使用container：
```
@SpringBootTest
@Testcontainers
public class ElasticsearchClientIntegrationTest {

    @Container
    private static final ElasticsearchContainer CONTAINER = XxxElasticsearchContainer.getXxxContainer();

    @DynamicPropertySource
    static void elasticProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.elasticsearch.uris", OVERSEAS::getHttpHostAddress);
    }
    
    // spring boot会根据properties自动配置好这些client
    @Autowired
    private ElasticsearchRestTemplate elasticsearchRestTemplate;

    @Autowired
    private RestHighLevelClient restHighLevelClient;

    @Autowired
    private ElasticsearchClient elasticsearchClient;
```

# testcontainer jupiter
```
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <version>1.17.6</version>
    <scope>test</scope>
</dependency>
```
testcontainers的`junit-jupiter`包提供了对jupiter测试框架的扩展`TestcontainersExtension`，通过它可以解析`@Container`注解。

> **这个包的artifact id和junit-jupiter一样，只有group id不一样（`org.testcontainers:junit-jupiter` vs. `org.junit.jupiter:junit-jupiter`）**，所以不要看错了。

`@ExtendWith(TestcontainersExtension.class)`已经放在了`@Testcontainers`注解中，所以直接使用`@Testcontainers`即可：
```
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@ExtendWith(TestcontainersExtension.class)
@Inherited
public @interface Testcontainers {
    /**
     * Whether tests should be disabled (rather than failing) when Docker is not available.
     */
    boolean disabledWithoutDocker() default false;
}
```

> 还可以设置没有docker的时候跳过测试而不是测试失败：`@Testcontainers(disabledWithoutDocker = true)`。

- `org.testcontainers.junit.jupiter.Container`：表明这是一个container，和`@Testcontainers`配合使用，被标注的container将会被testcontainer extension管理；
- `org.testcontainers.junit.jupiter.Testcontainers`：@Testcontainers is a JUnit Jupiter extension to activate automatic startup and stop of containers used in a test case。**static变量container的start/stop会放在`@BeforeAll/@AfterAll`里，由所有test方法共享；非static变量container的start/stop会放在`@BeforeEach/@AfterEach`里**；

> 在`@Testcontainers`注解上有`@ExtendWith(TestcontainersExtension.class)`，处理`@Container`的逻辑就是在类`TestcontainersExtension`里实现的。

用这两个注解也就相当于可以小小懒一下了。

## 全局唯一container
不管是[手动start/stop container](https://www.testcontainers.org/test_framework_integration/manual_lifecycle_control/)，还是使用拓展的jupiter注解管理container（使用static变量），最多只能做到单个test class共用一个container。但是如果test class多了，每个class都stop/start一次容器，整个测试流程也会很慢，毕竟Elasticsearch container在我i7 cpu的开发机上启动一次也需要10-20s。

其实多个test class之前共用一个Elasticsearch container并没有什么问题，毕竟一般都是串行测试。testcontainers提供了[全局唯一singleton container的写法](https://www.testcontainers.org/test_framework_integration/manual_lifecycle_control/#singleton-containers)，不过这个就只能纯手工管理start/stop了。stop并不需要太操心：At the end of the test suite the Ryuk container that is started by Testcontainers core will take care of stopping the singleton container.

- https://stackoverflow.com/a/62443261/7676237

## 会同时引入junit4 junit5
`org.testcontainers:junit-jupiter`显然引入了`org.junit.jupiter:junit-jupiter`。它也依赖`org.testcontainers:testcontainers`，但是后者把junit4作为compile依赖，所以`org.testcontainers:junit-jupiter`相当于既引入了junit4又引入了junit5……

[2018年的issue就提出了在2.0版本删掉junit4 compile依赖](https://github.com/testcontainers/testcontainers-java/issues/970)，四年过去了，目前testcontainers发的依然是1.x版本:D不过今年九月已经有关于[把junit4从core里移到单独module的pr](https://github.com/testcontainers/testcontainers-java/pull/5826)了，看来还是指日可待的。然后转头一看，[2.0 milestone](https://github.com/testcontainers/testcontainers-java/milestone/20)至今只完成了27%，而且no due date……

- https://www.testcontainers.org/test_framework_integration/junit_5/

# testcontainers-java
在[testcontainers-java](https://github.com/testcontainers/testcontainers-java)中也有一些测试用例，可以看到这些testcontainer的用法：
- https://github.com/testcontainers/testcontainers-java/blob/main/modules/elasticsearch/src/test/java/org/testcontainers/elasticsearch/ElasticsearchContainerTest.java

**在这里还有一个使用testcontainers做集成测试的完整的web工程示例**，使用了spring-data-jps/redis/web mvc：
- https://github.com/testcontainers/testcontainers-java/tree/main/examples/spring-boot

> 以后工程的集成测试真是太舒服了！

# testcontainer debug
除了传统断点调试，还可以debug卡住docker，直接给Elasticsearch container发测试http请求，查看mapping之类的。

直接获取本地映射的端口后，往docker发送一些请求，以诊断错误：
```
GET http://localhost:3024/<index>/_search
```
使用postman发就可以，记得加上Authorization basic auth `elastic:pikachu`

还可以看看mapping/settings/ananlyzer等。

也可以打开tracer debug，查看spring data elasticsearch自动生成的http请求。

# 致谢
感谢[testcontainers](https://www.testcontainers.org/)：https://github.com/testcontainers/testcontainers-java，让代码测试又轻松了很多。

[正好最近gitlab-ci全都使用docker runner了，直接在docker runner里起个dind service]({% post_url 2022-10-09-docker-dind %})，就可以跑testcontainer的测试了，衔接地非常丝滑！



