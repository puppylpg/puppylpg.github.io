---
layout: post
title: Micrometer
date: 2020-08-18 15:50:48 +0800
categories: micrometer
tags: micrometer
---

在Java程序中，一般需要统计的量被称为metric。比如请求个数、请求到来的速率、请求处理的时间分布quantile（.50/.95/.99等）。

1. Table of Contents, ordered
{:toc}

# metric统计方案
## 最简陋
一般统计metric分为如下步骤：
1. 在应用中插入metric，统计数据。可以使用[dropwizard](https://www.dropwizard.io/
)或者micrometer；
2. 将metric暴露出来，比如通过Java提供的JMX（Java Management Extension）技术，将metric变量暴露到特定端口；
3. 此时，变量可以通过jmx端口从外部获取到。如果比较懒，或者急需临时观察一下metric，可以直接使用Java自带的jconsole连接host和jmx的port，观察metric。

> metric -> jmx -> jconsole

## 正常部署方案

上述方法的缺陷很明显：只能观察到应用当前暴露的metric的状态，没法查看过去的数据。且数据均为数字，很不直观。

所以正常的系统部署方案，一般会部署一个专门记录统计数据的第三方server，比如[graphite](https://graphiteapp.org/)，主要用来存储metric，并将metric绘制成图像，这样就能很直观地查看过去一段时间应用metric的变化。不过graphite主要是用来存储数据的，绘图UI其实也比较简陋，这个时候[grafana](https://grafana.com/)就很有用，它利用graphite收集到的数据，通过查询graphite，将数据以更现代化更丰富的UI呈现出来。

> metric -> jmx -> (jmxtrans) -> graphite -> grafana

由于graphite是一个server，jmx也是一个server，两个server都是被动接收请求，所以还需要一个中间人，从jmx处查询到数据，再发送给graphite。这个工具一般使用[jmxtrans](https://www.jmxtrans.org/)，名字直白易懂：jmx transport，用来传输jmx暴露的metric。

## 优化部署方案
上述方法的一个很明显的缺陷就是链条过长，需要部署多个服务，一旦出问题需要检查不同服务以确定出问题位置。

另外使用jmxtrans比较麻烦，需要定义一套配置，jmxtrans按照配置抓取服务中的metric。定义配置本身就比较麻烦，而且多个服务就要定义多个配置。

既然graphite是一个server，那为什么不让Java服务直接将自己的metric发送到graphite呢？这样直接砍去了jmx和jmxtrans两个环节。

> metric -> graphite -> grafana

这样就相当清晰了：
1. 服务自己统计并发送自己的metric；
2. graphite接收并存储metric；
3. grafana绘制metric图像；

在应用中统计metric一般还是用dropwizard，发送到graphite则可以使用dropwizard提供的另一个依赖：metrics-graphite，配置好graphite地址，就可以直接发送了。当然还可以配置一些细粒度的属性，比如metric的prefix、发送频率等。

## 大一统方案 - micrometer
上述方案虽然简洁明了，但也存在一个致命缺陷：只能将自己使用dropwizard统计的metric通过dropwizard的metrics-graphite直接发送给graphite。第三方依赖比如tomcat，统计的metric是通过jmx暴露的，想收集这些metric还是得通过jmx和jmxtrans。但是这些metric对于服务端又很重要，必须收集。如此一来还是逃不开链条很长的那一套。

[micrometer](http://micrometer.io/)则提供了一个大一统方案，解决了这个问题。

不妨想想如果我们自己想搞一套大一统方案，思路上应该怎么搞：
1. 首先肯定是要提供一种自定义metric的方式；
2. 要把一些流行的第三方比如tomcat的metric也收集起来；
3. 用户自定义的metric和收集的第三方的metric要是一个统一的格式；
4. 把该统一格式的metric发送到第三方统计server，可以是graphite，也可以是其他。

> micrometer -> graphite -> grafana

micrometer甚至有做好的[grafana模板](https://grafana.com/grafana/dashboards/4701)，不过要注意数据源，这个模板是搭配Prometheus监控系统用的，graphite用不了。

> grafana的模板可以在[Dashboards](https://grafana.com/grafana/dashboards)里检索。

# micrometer
micrometer是专门为基于jvm的app做的监控组件，有两大优势：
1. 只要将micrometer引入系统，就能自动监控很多组件的metric，比如JVM。
2. 可以自动支持各种监控系统：graphite、prometheus、influx、elasticsearch等等。比如引入micrometer graphite之后，可以自动配置将metric发往graphite。

在micrometer里，meter就是metric的意思。通过接口`Meter`来表示。

> 强烈建议看一下micrometer的[文档](http://micrometer.io/docs)。

## 统一的meter接口
micrometer观察了各个监控系统（eg：graphite、prometheus）的特性，重新定义了一整套大一统接口，可以收集metric，并发送到各种监控系统。

- http://micrometer.io/docs/concepts

### `Meter`
meter就是metric。具体细分有：
- Counter;
- Gauge;
- Timer;
- DistributionSummary;
- LongTaskTimer
- FunctionCounter
- FunctionTimer
- TimeGauge

### `MeterRegistry`
用于创建、持有meter。micrometer为每种支持的监控系统定义了一个MeterRegistry的实现，比如Graphite对应的是`GraphiteMeterRegistry`，主要用途是将注册在该registry上的meter以graphite的通用规范发送给graphite。

`CompositeMeterRegistry`是个特殊的registry，可以添加多个registry，同时向多个监控系统发数据。Metrics类里有一堆静态方法，比如counter方法可以直接为该registry添加一个Counter。`CompositeMeterRegistry`里添加的所有MeterRegistry都会注册上这个Counter。最大的好处就是：**可以一次向多个监控系统注册Meter**。

> Micrometer provides a `CompositeMeterRegistry` to which multiple registries can be added, allowing you to publish metrics to more than one monitoring system simultaneously.

### `Counter`
非常简单的Meter。只增不减的计数器，可以统计：
- 累加值：发生的次数；
- **速率：metric发生的速率，比如1/5/15min内的平均qps**。

> dropwizard里测速率的指标是meter，micrometer里没有meter是统一的metric接口，不是具体指标，dropwizard的meter的作用被counter涵盖了。

有多种创建counter的方法（并+1）：
```java
meterRegistry.counter("counter").increment();

Counter counter = Counter
    .builder("counter")
    .baseUnit("beans") // optional
    .description("a description of what this counter does") // optional
    .tags("region", "test") // optional
    .register(registry);
```

### `Gauge`
实时反映一个metric的状态，比如缓存的大小。不像Counter一样一直只增不减，Gauge的大小是不断变化的。
- 值：一个随时变化可大可小的值。

> gauge: the thickness, size, or capacity of something.

> Gauges are useful for monitoring things with natural upper bounds. We don’t recommend using a gauge to monitor things like request count, as they can grow without bound for the duration of an application instance’s life.

> If it helps, think of a Gauge as a "heisen-gauge" - a meter that only changes when it is observed.

**注意，这样注册gauge是错误的**：
```java
meterRegistry.gauge(name, queue.size());
```
这种方式注册Gauge度量是不正确的。**在这种情况下，`queue.size()`方法会在注册时被立即调用，返回一个固定的值，而不是在每次度量被查询时返回动态的队列大小**。这意味着，如果您使用这种方式注册度量，度量的值将永远不会改变。

看看该方法的Javadoc：
```java
    /**
     * Register a gauge that reports the value of the {@link Number}.
     * @param name Name of the gauge being registered.
     * @param number Thread-safe implementation of {@link Number} used to access the
     * value.
     * @param <T> The type of the state object from which the gauge value is extracted.
     * @return The number that was passed in so the registration can be done as part of an
     * assignment statement.
     */
    @Nullable
    public <T extends Number> T gauge(String name, T number) {
        return gauge(name, emptyList(), number);
    }
```
第二个参数必须是会自己变的number，可以支持被micrometer并发访问以获取其当前值。

所以，应该使用`Gauge.builder`方法来创建Gauge度量，**并将一个`Supplier`作为指标函数传递给它。这个Supplier应该是一个lambda表达式或方法引用，它可以在每次度量被查询时动态计算并返回队列的大小**。例如，可以使用以下代码来注册一个动态的Gauge度量：
```java
Gauge.builder("gauge", queue, Queue::size)
        .description("Size of the queue for task: " + xxx)
        .register(meterRegistry);
```

### `Timer` - timed events
统计短时间事件，比如请求处理时长。Timer统计的指标比较丰富：
- 累加值：事件发生的次数；
- 速率：1/5/15min内事件每秒发生的次数；
- 分位点：**事件时长的分布**。比如处于.95分位点的事件的时长，用来估算整个服务的性能。50/75/95/98/99/999之外，还能统计min/max。

注意事项：
1. **`Timer`统计的内容涵盖`Counter`**，但不要滥用Timer，对于仅使用Counter就可以解决问题的场景，不要用Timer。
2. Counter和Gauge是不同的东西，Counter仅用于累加，只增不减，所以不要在使用Gauge的场合使用Counter。

> Timers are intended for measuring short-duration latencies, and the frequency of such events. All implementations of Timer report at least the total time and count of events as separate time series.

> recording many longer durations could cause overflow of the total time at Long.MAX_VALUE nanoseconds (292.3 years).

> The appropriate base unit for timers varies by metrics backend for good reason. Micrometer is decidedly un-opinionated about this, but because of the potential for confusion, requires a TimeUnit when interacting with Timers. Micrometer is aware of the preferences of each implementation and publishes your timing in the appropriate base unit based on the implementation.

```java
Timer timer = Timer
    .builder("my.timer")
    .description("a description of what this timer does") // optional
    .tags("region", "test") // optional
    .register(registry);
```
timer通过一系列record来记录时间：
```java
public interface Timer extends Meter {
    ...
    void record(long amount, TimeUnit unit);
    void record(Duration duration);
    double totalTime(TimeUnit unit);
}
```
除此之外，还有一些更方便的**衡量代码执行时间**的方法：
```java
    /**
     * Executes the callable {@code f} and records the time taken.
     * @param f Function to execute and measure the execution time.
     * @param <T> The return type of the {@link Callable}.
     * @return The return value of {@code f}.
     * @throws Exception Any exception bubbling up from the callable.
     */
    @Nullable
    <T> T recordCallable(Callable<T> f) throws Exception;

    /**
     * Executes the runnable {@code f} and records the time taken.
     * @param f Function to execute and measure the execution time.
     */
    void record(Runnable f);
```
**它会（同步）执行代码，并记录代码执行时间**。实现其实就是micrometer自己在代码块的开头结尾记录一下时间，并作差：
```java
    @Override
    public <T> T recordCallable(Callable<T> f) throws Exception {
        final long s = clock.monotonicTime();
        try {
            return f.call();
        }
        finally {
            final long e = clock.monotonicTime();
            record(e - s, TimeUnit.NANOSECONDS);
        }
    }
```
比dropwizard方便多了。

### `DistributionSummary` - sized/weighted/... events
用来统计事件的分布，类似Timer，**只是单位不同**。

Timer统计的单位是时间，每一个事件发生的时间，DistributionSummary可以是任何单位，比如请求的大小，则单位可以设定为byte，DistributionSummary标识的就是**事件大小的分布**，相应的p95的含义就是处于.95分位点的请求的大小。

不过M1 rate还是表示一分钟内每秒达到的请求，还是qps。累加值还是表示事件发生的次数。这两方面的统计量是不变的。

同样有多种创建方式：
```java
DistributionSummary summary = registry.summary("response.size");

DistributionSummary summary = DistributionSummary
    .builder("response.size")
    .description("a description of what this summary does") // optional
    .baseUnit("bytes") // optional (1)
    .tags("region", "test") // optional
    .scale(100) // optional (2)
    .register(registry);
```
也使用record方法记录事件。

## `MeterFilter`
meter的过滤器，添加在`MeterRegistry`上，决定了：
- Deny：哪些meter可以被注册；
- Transform：改变meter的id、tag、unit等属性；
- configure：distribution statistics for some meter types，统计一些meter类型分布；

## `MeterBinder`
接口，定义bindTo方法，用来将meter注册到`MeterRegistry`上。

比如`UptimeMetrics implements MeterBinder`的bindTo方法实现：
```java
@Override
public void bindTo(MeterRegistry registry) {
    TimeGauge.builder("process.uptime", runtimeMXBean, TimeUnit.MILLISECONDS, RuntimeMXBean::getUptime)
        .tags(tags)
        .description("The uptime of the Java virtual machine")
        .register(registry);

    TimeGauge.builder("process.start.time", runtimeMXBean, TimeUnit.MILLISECONDS, RuntimeMXBean::getStartTime)
        .tags(tags)
        .description("Start time of the process since unix epoch.")
        .register(registry);
}
```
定义了两个TimeGauge，register到registry上。可以看到他们传进去的就是一个lambda，是gauge的正确用法。

再比如[micrometer-jvm-extras](https://github.com/mweirauch/micrometer-jvm-extras)，文档里**展示了直接注册和通过spring bean注册metric到`MeterRegistry`的逻辑**：
```java
    /* Plain Java */
    final MeterRegistry registry = new SimpleMeterRegistry();
    new ProcessMemoryMetrics().bindTo(registry);
    new ProcessThreadMetrics().bindTo(registry);
```

```java
    /* With Spring */
    @Bean
    public MeterBinder processMemoryMetrics() {
        return new ProcessMemoryMetrics();
    }

    @Bean
    public MeterBinder processThreadMetrics() {
        return new ProcessThreadMetrics();
    }
```

# 不同监控系统的差异
micrometer包含一个core module，它使用SPI机制支持不同的监控系统，每一种支持的监控系统对应一类子module。

不同的监控系统有三个主要方面的差异。

## dimensional
prometheus是支持标签的，**标签就是维度，类似druid，可以按照标签聚合数据**。graphite是不支持标签的，它是hierarchical，就像目录一样，是层级状的。

micrometer往graphite发送数据的时候，就会把标签的tag/value扁平化，作为metric名称的一部分。

### tag
因此，micrometer里可以给meter打标签，将标签一并发给支持标签的监控系统，用以支持通过标签检索数据。
```java
registry.counter("database.calls", "db", "users")
```

> For example if we select `database.calls` we can see the total number of calls to all databases. Then we can group by or select by `db` to drill down further or perform comparative analysis on the contribution of calls to each database.

按名字选meter可以直接获取其值，但是按照tag聚合、分类，可以深度研究（drill down）数据。

通用标签：Common tags can be defined at the registry level and are added to every metric reported to the monitoring system. 

### `NamingConvention`
不同的监控系统有不同的命名规范，**micrometer建议我们在程序里统一用dot分隔的名字，它会将metric转成各个监控系统想要的格式**。

比如`registry.timer("http.server.requests")`在发送时会被转换为：
- Prometheus - `http_server_requests_duration_seconds`
- Atlas - `httpServerRequests`
- Graphite - `http.server.requests`
- InfluxDB - `http_server_requests`

> Each Micrometer implementation for a monitoring system comes with a naming convention that transforms lowercase dot notation names to the monitoring system's recommended naming convention. Additionally, this naming convention implementation sanitizes metric names and tags of special characters that are disallowed by the monitoring system.

转换工作由`NamingConvention`来做，它主要做两件事：
1. `NamingConvention`不同的实现会将meter name转成相应监控系统想要的格式；
2. 如果监控系统不支持name中有某些字符，则用其他字符替换掉它；

具体细节要看不同`NamingConvention`的实现，比如graphite对应的有`GraphiteHierarchicalNamingConvention`和`GraphiteHierarchicalNameMapper`两种。

我们也可以手动注册nameing convention到registry以修改他们的行为：
```java
registry.config().namingConvention(myCustomNamingConvention);
```

## rate aggregation
简单来说，就是发送给监控系统的是累计值，还是增量。不同的监控系统要求不同的值。

Timers and distribution summaries support collecting data to observe their percentile distributions.
1. 监控服务端支持自查询percentile的，micrometer只发bucket数据就行了；
2. 服务器不支持自查询的，micrometer就算好percentile，发给服务器；

## pull/publish
prometheus是主动从服务保留的endpoint上拉取metric，而graphite则是被动接收，需要服务主动把metric发过去。

# spring boot + micrometer
spring boot最大的优点（缺陷:D）就是自动配置。

> 了解原理，自动配置是一个非常方便的属性，不明就里，自动配置能把你搞得云里雾里。

引入相应的依赖之后，spring boot会自动为micrometer配置好相应的`MeterRegistry`，绑定众多的`MeterBinder`，注册好基本满足大部分需求的Meter。整个服务基本不需要再配置什么了。

## prometheus
使用micrometer + prometheus的组合非常简单。

引入micrometer prometheus依赖：
```xml
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-prometheus</artifactId>
            <version>1.11.5</version>
        </dependency>
```
只要引入了`micrometer-registry-prometheus`依赖，且是web系统，springboot actuator就会自动创建`/actuator/prometheus` endpoint。

> Exposes metrics in a format that can be scraped by a Prometheus server. Requires a dependency on micrometer-registry-prometheus.

默认情况下，[除了`/aucuator/shudown` endpoint](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#actuator.endpoints.enabling)，其他的endpoint都是开启的。但是[只有`/actuator/health` endpoint是通过jvm和http暴露的](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#actuator.endpoints.exposing)，所以我们还要配置prometheus端口通过http暴露：
```yaml
# /actuator/*接口
management:
  endpoints:
    # 通过http暴露
    web:
      exposure:
        include: health,metrics,prometheus
  # 注意endpoint与endpoints
  endpoint:
    health:
      show-details: always
  metrics:
    tags:
      application: ${spring.application.name}

spring:
  application:
    name: APP-bj
```
**但是一定要注意这个配置的前缀是endpoints，而非endpoint！尤其是二者一同出现的时候，非常容易弄混，导致配置错误**！endpoints（复数）前缀用于配置整体端口（在web或jmx上）的暴露情况。endpoint（单数）前缀只用于单个endpoint的属性配置，比如配置health endpoint是否展示详情。

### security
如果是线上系统，需要给prometheus或其他endpoint加上认证，以防止敏感信息暴露。

可以创建一个用户，专门用于actuator的endpoint认证：
```java
    /**
     * 创建一个prometheus用户，用于http basic认证，读取系统spring actuator metric
     */
    @Bean
    public UserDetailsService userDetailsService() {
        InMemoryUserDetailsManager manager = new InMemoryUserDetailsManager();
        manager.createUser(User.withDefaultPasswordEncoder().username("prometheus").password("prometheus").roles("ENDPOINT").build());
        return manager;
    }
```
如果/health endpoint需要用于健康监测，可以不设置任何认证：
```java
    /**
     * spring actuator，通过http basic认证读取
     */
    @Bean
    @Order(1)
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http.securityMatcher(EndpointRequest.toAnyEndpoint())
                .authorizeHttpRequests(
                        requests -> requests.requestMatchers("/actuator/health").permitAll()
                                .anyRequest().hasRole("ENDPOINT")
                )
                .httpBasic(withDefaults())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .build();
    }
```
actuator security chain的order可以高于match all的security chain。

`EndpointRequest.toAnyEndpoint()`是什么？默认是一下三个endpoint：
- /actuator/
- /actuator/*
- /actuator/health

如果配置了通过web暴露prometheus，则会新增加`/actuator/prometheus`。

### prometheus配置
**上述配置还为服务的metric添加了一个通用标签`application=${spring.application.name}`**，假设app名为APP-bj，prometheus的抓取任务配置为：
```yaml
- basic_auth:
    password: prometheus
    username: prometheus
  dns_sd_configs:
  - names:
    - '*.APP.ad.svc.cluster6.nbj03.x.com'
  honor_labels: true
  job_name: APP-before-migration
  metrics_path: /actuator/prometheus
  scrape_interval: 15s
```
则采集到的数据示例如下：
```
system_cpu_usage {application: APP-bj, instance: 10-105-50-121.APP.ad.svc.cluster6.nbj03.x.com:11224, job: APP-before-migration, prometheus: common-prometheus-service/prom-1ad1f4ad}
```
数据添加了一个`application: APP-bj`的标签，这非常有用，当有很多服务的时候，可以用这个标签做过滤把不同服务区分开来。

### grafana配置
prometheus抓取到数据后，把该prometheus配置为grafana的数据源，然后就可以通过grafana展示数据了。

推荐使用[JVM Quarkus - Micrometer Metrics](https://grafana.com/grafana/dashboards/14370-jvm-quarkus-micrometer-metrics/)模板，支持micrometer + prometheus。

> 模板里jvm process memory部分的数据需要额外引入[micrometer-jvm-extras](https://github.com/mweirauch/micrometer-jvm-extras)，并通过`MeterBinder`注册到`MeterRegistry`上。

该模板默认已经设置以下variables，用于metric过滤展示：
- application变量，`label_values(application)`：就是通过上述application标签，过滤出只属于这个app的metric；
- instance变量，`label_values(jvm_memory_used_bytes{application="$application"}, instance)`：有了application，可以进一步细分出instance；
- jvm_memory_pool_heap变量，`label_values(jvm_memory_used_bytes{application="$application", instance="$instance", area="heap"},id)`
- jvm_memory_pool_nonheap变量，`label_values(jvm_memory_used_bytes{application="$application", instance="$instance", area="nonheap"},id)`

这些变量是通过从`jvm_memory_used_bytes`的值里解析出来的。它的示例数据如下：
```
jvm_buffer_memory_used_bytes{application="APP-bj", id="direct", instance="10-105-50-121.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="direct", instance="10-105-58-160.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="direct", instance="10-105-62-112.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="mapped", instance="10-105-50-121.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="mapped", instance="10-105-58-160.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="mapped", instance="10-105-62-112.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="mapped - 'non-volatile memory'", instance="10-105-50-121.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="mapped - 'non-volatile memory'", instance="10-105-58-160.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
jvm_buffer_memory_used_bytes{application="APP-bj", id="mapped - 'non-volatile memory'", instance="10-105-62-112.APP-bj.ad.svc.cluster6.nbj03.x.com:11224", job="APP-bj-before-migration", prometheus="common-prometheus-service/prom-1ad1f4ad"}
```
**可看到它有很多组标签，application是我们通过springboot的配置加上的，id、instance、prometheus标签应该是micrometer自己加的。job标签应该是prometheus server抓取数据的时候加上的。**

> 在配置好prometheus为DataSource之后，可以通过grafana的explorer查询这些metric，查看详情。

## 查看metric
**可以通过`/actuator/metrics` endpoint查看系统里所有的metric**。micrometer自动注册了非常多的metric。

比如：http://localhost:8080/actuator/metrics
```json
{
  "names":[
    "application.ready.time",
    "application.started.time",
    "auto.registry.counter",
    "disk.free",
    "disk.total",
    "executor.active",
    "executor.completed",
    "executor.pool.core",
    "executor.pool.max",
    "executor.pool.size",
    "executor.queue.remaining",
    "executor.queued",
    "global.registry.counter",
    "global.registry.timer",
    "http.server.requests.active",
    "jvm.buffer.count",
    "jvm.buffer.memory.used",
    "jvm.buffer.total.capacity",
    "jvm.classes.loaded",
    "jvm.classes.unloaded",
    "jvm.compilation.time",
    "jvm.gc.concurrent.phase.time",
    "jvm.gc.live.data.size",
    "jvm.gc.max.data.size",
    "jvm.gc.memory.allocated",
    "jvm.gc.memory.promoted",
    "jvm.gc.overhead",
    "jvm.gc.pause",
    "jvm.info",
    "jvm.memory.committed",
    "jvm.memory.max",
    "jvm.memory.usage.after.gc",
    "jvm.memory.used",
    "jvm.threads.daemon",
    "jvm.threads.live",
    "jvm.threads.peak",
    "jvm.threads.started",
    "jvm.threads.states",
    "logback.events",
    "process.cpu.usage",
    "process.files.max",
    "process.files.open",
    "process.start.time",
    "process.uptime",
    "system.cpu.count",
    "system.cpu.usage",
    "system.load.average.1m",
    "tomcat.sessions.active.current",
    "tomcat.sessions.active.max",
    "tomcat.sessions.alive.max",
    "tomcat.sessions.created",
    "tomcat.sessions.expired",
    "tomcat.sessions.rejected"
  ]
}
```
以`jvm.buffer.memory.used`为例：http://localhost:8080/actuator/metrics/jvm.buffer.memory.used
```json
{
  "name":"jvm.buffer.memory.used",
  "description":"An estimate of the memory that the Java virtual machine is using for this buffer pool",
  "baseUnit":"bytes",
  "measurements":[
    {
      "statistic":"VALUE",
      "value":49152
    }
  ],
  "availableTags":[
    {
      "tag":"application",
      "values":[
        "spring-boot-prometueus"
      ]
    },
    {
      "tag":"id",
      "values":[
        "direct",
        "mapped - 'non-volatile memory'",
        "mapped"
      ]
    }
  ]
}
```
**可以通过`/actuator/prometheus` endpoint查看这些metric以什么样的格式暴露给prometheus**：http://localhost:8080/actuator/prometheus

> `/actuator/prometheus`接口返回的是[prometheus的metric格式](https://prometheus.io/docs/instrumenting/exposition_formats/#text-based-format)的数据。

数据过长，只以`jvm_buffer_memory_used_bytes`为例
```
# HELP jvm_buffer_memory_used_bytes An estimate of the memory that the Java virtual machine is using for this buffer pool
# TYPE jvm_buffer_memory_used_bytes gauge
jvm_buffer_memory_used_bytes{application="spring-boot-prometueus",id="direct",} 40960.0
jvm_buffer_memory_used_bytes{application="spring-boot-prometueus",id="mapped",} 0.0
jvm_buffer_memory_used_bytes{application="spring-boot-prometueus",id="mapped - 'non-volatile memory'",} 0.0
```
**可看到它把jvm.buffer.memory.used使用下滑线分隔，并把baseUnit（bytes）作为了名称的一部分。所有的tags（application、id）进行了组合，每个组合一个数据点**。

同理，关于http每个请求接口，有以下metric：
```
# HELP http_server_requests_seconds  
# TYPE http_server_requests_seconds summary
http_server_requests_seconds_count{application="spring-boot-prometueus",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/actuator/metrics",} 1.0
http_server_requests_seconds_sum{application="spring-boot-prometueus",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/actuator/metrics",} 0.046464209
# HELP http_server_requests_seconds_max  
# TYPE http_server_requests_seconds_max gauge
http_server_requests_seconds_max{application="spring-boot-prometueus",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/actuator/metrics",} 0.046464209
```
tag有uri、method、status等。

**我们可以使用prometheus的PromQL对数据进行分类统计（就像druid一样）！**

统计每个接口（按照uri、method、status）的平均时长：
```
avg by (uri, method, status) (http_server_requests_seconds_sum / http_server_requests_seconds_count)
```
逆序排列：
```
sort_desc(avg by (uri, method, status) (http_server_requests_seconds_sum / http_server_requests_seconds_count))
```
topk：
```
topk(10, avg by (uri, method, status) (http_server_requests_seconds_sum / http_server_requests_seconds_count))
```

### prometheus查询
prometheus有[关于查询的文档](https://prometheus.io/docs/prometheus/latest/querying/basics/)，但**更推荐[PromQL cheatsheet](https://promlabs.com/promql-cheat-sheet/)，每一条示例还带有对应的lab演示**。

**也可以通过上述grafana模板里每个panal对应的表达式来学习prometheus的查询——**


使用gauge表示时间：
```
          "expr": "process_uptime_seconds{application=\"$application\", instance=\"$instance\"}",
          "legendFormat": "",
      "title": "Uptime",

# HELP process_uptime_seconds The uptime of the Java virtual machine
# TYPE process_uptime_seconds gauge
process_uptime_seconds{application="my-app",} 149338.551
```

使用gauge表示内存使用量，然后使用sum函数求和，用除法求占比：
```
          "expr": "sum(jvm_memory_used_bytes{application=\"$application\", instance=\"$instance\", area=\"heap\"})*100/sum(jvm_memory_max_bytes{application=\"$application\",instance=\"$instance\", area=\"heap\"})",
          "legendFormat": "",
      "title": "Heap used",

# HELP jvm_memory_used_bytes The amount of used memory
# TYPE jvm_memory_used_bytes gauge
jvm_memory_used_bytes{application="my-app",area="nonheap",id="Compressed Class Space",} 2.8313048E7
jvm_memory_used_bytes{application="my-app",area="nonheap",id="CodeHeap 'non-nmethods'",} 2529280.0
jvm_memory_used_bytes{application="my-app",area="nonheap",id="CodeHeap 'profiled nmethods'",} 3.1949184E7
jvm_memory_used_bytes{application="my-app",area="nonheap",id="Metaspace",} 2.42186192E8
jvm_memory_used_bytes{application="my-app",area="heap",id="ZGC Old Generation",} 3.85875968E8
jvm_memory_used_bytes{application="my-app",area="heap",id="ZGC Young Generation",} 2.91504128E8
jvm_memory_used_bytes{application="my-app",area="nonheap",id="CodeHeap 'non-profiled nmethods'",} 4.6045696E7
```

用summary表示http请求，会生成`_count`，`_sum`，`_max`后缀的metric，然后用来求qps。`rate`函数就是qps：Per-second rate of increase, averaged over last 5 minutes:
```
rate(demo_api_request_duration_seconds_count[5m])
```

系统总qps就是所有请求的qps的sum：
```
          "expr": "sum(rate(http_server_requests_seconds_count{application=\"$application\", instance=\"$instance\"}[2m]))",
          "legendFormat": "HTTP",
      "title": "Rate",


# HELP http_server_requests_seconds  
# TYPE http_server_requests_seconds summary
http_server_requests_seconds_count{application="my-app",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/v1.0.0/task-assignments",} 11.0
http_server_requests_seconds_sum{application="my-app",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/v1.0.0/task-assignments",} 0.209631814
http_server_requests_seconds_count{application="my-app",error="none",exception="none",method="POST",outcome="SUCCESS",status="200",uri="/v1.0.0/kol-agg/query-relation-account",} 250.0
http_server_requests_seconds_sum{application="my-app",error="none",exception="none",method="POST",outcome="SUCCESS",status="200",uri="/v1.0.0/kol-agg/query-relation-account",} 2.992996877
...
```

请求平均时长就是所有请求先求和再平均：
```
          "expr": "sum(rate(http_server_requests_seconds_sum{application=\"$application\", instance=\"$instance\", status!~\"5..\"}[2m]))/sum(rate(http_server_requests_seconds_count{application=\"$application\", instance=\"$instance\", status!~\"5..\"}[2m]))",
          "legendFormat": "HTTP - AVG",
          "expr": "max(http_server_requests_seconds_max{application=\"$application\", instance=\"$instance\", status!~\"5..\"})",
          "legendFormat": "HTTP - MAX",
      "title": "Duration",

# HELP http_server_requests_seconds_max  
# TYPE http_server_requests_seconds_max gauge
http_server_requests_seconds_max{application="my-app",error="none",exception="none",method="GET",outcome="SUCCESS",status="200",uri="/v1.0.0/task-assignments",} 0.0
http_server_requests_seconds_max{application="my-app",error="none",exception="none",method="POST",outcome="SUCCESS",status="200",uri="/v1.0.0/kol-agg/query-relation-account",} 0.006695165
```
等等。

## ~~graphite~~
> 不建议，比prometheus麻烦太多，还要主动push。

以jmx和graphite为两个目标监控系统，使用spring boot配置micrometer。

自动配置graphite的MeterRegistry需要micrometer-registry-graphite，jmx同理。他们会自动下载micrometer的核心依赖比如micrometer-core，所以只写这两个就行了：
```xml
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-graphite</artifactId>
        </dependency>
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-jmx</artifactId>
        </dependency>
```
由于上述两个lib在classpath上，`JmxMeterRegistry`/`GraphiteMeterRegistry`都已经由spring-boot自动创建好了。详见`GraphiteMetricsExportAutoConfiguration`。同时创建好的还有`GraphiteConfig`等。

另外查看GraphiteMetricsExportAutoConfiguration的类定义，可看到类的注解：
```java
@ConditionalOnProperty(prefix = "management.metrics.export.graphite", name = "enabled", havingValue = "true",
		matchIfMissing = true)
```
意味着需要配置`management.metrics.export.graphite.enable=true`属性才能显式自动配置该bean。不过spring boot里，该配置的默认值就是true。

> 注意：如果我们此时手动配置一个GraphiteMeterRegistry会很尴尬，这样spring boot就不会自己创建该bean了，
同时，**application.yml里对GraphiteMeterRegistry的配置就没用了**！！！因为这些配置是给spring boot自动配置用的！
spring boot不自动配置了，properties里的配置自然也没用了。

所以如果自己创建`GraphiteMeterRegistry`，需要自己创建并传入GraphiteConfig，比如：
```java
GraphiteConfig graphiteConfig = new GraphiteConfig() {
    @Override
    public String host() {
        return "<graphite-host>";
    }

    @Override
    public int port() {
        return 2003;
    }

    @Override
    public String get(String k) {
        return null; // accept the rest of the defaults
    }
};

GraphiteMeterRegistry registry = new GraphiteMeterRegistry(graphiteConfig, Clock.SYSTEM);
```

### spring boot的自动配置行为
首先，看官方文档是非常非常必要的，[看看spring已经做好了哪些](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-metrics)。毕竟用的别人的代码，很多东西已经写好默认了，就不用动手了。如果不看文档、不看自动配置的那些代码，再手撸一遍就搞笑了。

- `Metrics.global`
- 其实还配置好了一个`CompositeMeterRegistry`，需要用的话可以直接注入
- 配置好了一堆`MeterRegistry`，比如`GraphiteMeterRegistry`（只要引入了micrometer-registry-graphite的包即可）
- 还有tomcat的registry、jvm的registry
- 这些registry都已经注册到了`CompositeMeterRegistry`上

如果不看文档，岂不是要自己造了。

还有更细粒度的自定义：
- `MeterRegistryCustomizer<GraphiteMeterRegistry>`，可以配置`GraphiteMeterRegistry`，用代码替换个别配置项

这是个很重要的信息。因为spring boot提供的通过配置文件进行配置的项有限，就可以通过这个进一步自定义。

还会为web(Spring MVC)自动生成一些metrics（控制的是生成web的metrics，而不是上面的那些"export"的行为）：
```properties
management.metrics.web.server.request.metric-name=auto-time-for-all.http.server.requests
```

### 配置
在application.yml里配置micrometer：
```yaml
management:
  metrics:
    export:
      graphite:
        step: 1m
        host: localhost
        port: 2003
        # key `pokemon`的value来自`management.metrics.tags.pokemon`，其他tag的value参考配置代码
        tags-as-prefix: metric,project,profile,host,port,pokemon
        # disable tag, use as hierarchical name
        graphite-tags-enabled: false
        protocol: plaintext
      jmx:
        enabled: true
    web:
      server:
        request:
          autotime:
            enabled: true
          metric-name: auto-time-for-all.http.server.requests
    # add common tags for meter，也可以通过代码配置tag
    tags:
      pokemon: pikachu
      application: course-prophet
      author: puppylpg
```

建议开启actuator，可以开启`/metrics` endpoint，服务启动后直接观察metric：
```yaml
management:
  endpoints:
    jmx:
      exposure:
        include: "*" # default
    web:
      exposure:
        include: "*" # to expose /metrics endpoint in web
```

下面一一解释上述配置：
- `management.metrics.export.graphite`:
    - step：将meter发送到监控系统的频率。1m代表1min发一次；
    - host/port：graphite地址；
    - graphite-tags-enabled：是否开启tag支持。如果不开启，tag将作为层级name来用，添加到meter的名字前后作为前后缀；
    - tags-as-prefix：决定哪些tag添加到meter名字之前。其余tag添加到meter名字之后。共同组成meter的层级名称；
    - protocol：以什么协议发送给graphite。graphite支持plaintext/pickle/udp三种协议。这里要看部署的graphite开启了什么协议支持。虽然pickle可以批量发送metric，如果graphite不支持pickle，发pickle消息是没用的；
- `management.metrics.tags`：直接在配置文件里配置common tag，使用key value自定义一堆tag，spring boot会将其存为Map；
- `management.metrics.web.server.request.autotime`:
    - enabled：是否对spring mvc的方法自动开启统计的Timer；
    - metric-name：timer的名字；

> management.metrics.web.server.request.autotime.enabled开启之后默认会有一组名为`http.server.requests.exception.{None/TimeoutException/...}.method.{GET/POST/...}.outcome.{SUCCESS/...}.status.{200/...}.uri.{方法对应的uri}`的Timer，统计各个uri方法的各种情况下对应的metric。因为都是Timer，所以count/m1_rate/p75等都可以获取。

> 这里使用management.metrics.web.server.request.autotime.metric-name将http.server.requests改名为all-time-for-all.http.server.reuqests。

### 标签作为前后缀
可以给MeterRegistry配置common tag，从而给registry里的所有meter打一堆标签，**奇偶位置分别为key和value**：
```java
meterRegistry.config().commonTags("profile", "test", "project", "test-server", "host", MachineUtils.getShortHostName(), "port", env.getProperty("server.port"));
```
如果不使用graphite的tag系统：
```java
management.metrics.export.graphite.graphite-tags-enabled=false
```
将会使用`GraphiteHierarchicalNameMapper`和`GraphiteHierarchicalNamingConvention`。

**`GraphiteHierarchicalNameMapper`可以将其中的一些tag的key和value作为prefix，其余的将变成suffix**：
```java
management.metrics.export.graphite.tags-as-prefix=profile,project,host,port
```
均为dot分隔，添加在meter名字前后。

假设配置了这么多tag又没有enable tag，"suffix" tag会变成suffix，因为它没有配置在`management.metrics.export.graphite.tags-as-prefix`里：
```java
// graphite name eg: test.test-server.DESKTOP-T467619.8090.auto.registry.new.counter.suffix.pika
registry.config()
        .commonTags(
                "metric", "micrometer",
                "project", "test-server",
                "profile", getProfilesConcatenation(),
                "host", MachineUtils.getShortHostName(),
                "port", env.getProperty("server.port"),
                // 没有在tags-as-prefix里配置，所以这个tag会变成suffix，而不是prefix
                "suffix", "pika"
        );
```

> GraphiteHierarchicalNameMapper: Defines the mapping between a combination of name + dimensional tags and a hierarchical name.

**`GraphiteHierarchicalNameMapper`拼接好名字之后，`GraphiteHierarchicalNamingConvention`默认使用`NamingConvention.camelCase`，将meter本身的名字处理成驼峰写法。**

可以用上面说的`MeterRegistryCustomizer<GraphiteMeterRegistry>`，替换GraphiteMeterRegistry的NamingConvention为`NamingConvention.dot`，就全都是dot分隔的了：
```java
@Bean
MeterRegistryCustomizer<GraphiteMeterRegistry> graphiteMetricsNamingConvention() {
    return registry -> registry.config().namingConvention(NamingConvention.dot);
}
```

## 使用`MeterRegistryCustomize`r个性化`MeterRegistry`
spring boot提供的properties文件里对`MeterRegistry`的配置项毕竟有限，而且表述复杂的配置也不容易。更多更复杂的配置可以在代码中使用`MeterRegistryCustomizer`来实现。

MeterRegistryCustomizer的个性化配置通过`MeterRegistryPostProcessor#postProcessAfterInitialization`来完成：if bean instanceof MeterRegistry, 则`getConfigurer().configure((MeterRegistry) bean)`，就把customizer的行为配置到registry的bean上了。

比如：
```java
    /**
     * You can register any number of MeterRegistryCustomizer beans to further configure the registry,
     * such as applying common tags, before any meters are registered with the registry:
     *
     * @return
     */
    @Bean
    MeterRegistryCustomizer<MeterRegistry> metricsCommonTags() {
        return registry -> {

            if (registry instanceof GraphiteMeterRegistry) {
                // graphite name eg: test.test-server.DESKTOP-T467619.8090.auto.registry.new.counter.suffix.pika
                registry.config()
                        .commonTags(
                                "metric", "micrometer",
                                "project", "test-server",
                                "profile", getProfilesConcatenation(),
                                "host", MachineUtils.getShortHostName(),
                                "port", env.getProperty("server.port"),
                                // 没有在tags-as-prefix里配置，所以这个tag会变成suffix，而不是prefix
                                "suffix", "pika"
                        );
            }


            GraphiteHierarchicalNameMapper nameMapper = new GraphiteHierarchicalNameMapper(graphiteProperties.getTagsAsPrefix());

            registry.config()
                    .onMeterAdded(meter -> {
                        String registryClass = registry.getClass().getSimpleName();
                        NamingConvention namingConvention = registry.config().namingConvention();

                        String meterConventionName = meter.getId().getConventionName(registry.config().namingConvention());
//                        log.info("{}; Meter Added: {}", registryClass, meterConventionName);
                        System.out.println(String.format("%s; Meter Added: %s", registryClass, meterConventionName));
                        if (registry instanceof GraphiteMeterRegistry) {
//                            log.info("Final graphite name for this meter: {}", nameMapper.toHierarchicalName(meter.getId(), namingConvention));
                            System.out.println("Final graphite name for this meter: " + nameMapper.toHierarchicalName(meter.getId(), namingConvention));
                        }
                    });
        };
    }

    private String getProfilesConcatenation() {
        StringJoiner joiner = new StringJoiner("-");
        for (String activeProfile : env.getActiveProfiles()) {
            joiner.add(activeProfile);
        }
        return joiner.toString();
    }

    /**
     * You can apply customizations to particular registry implementations by being more specific about the generic type:
     *
     * @return
     */
    @Bean
    MeterRegistryCustomizer<GraphiteMeterRegistry> graphiteMetricsNamingConvention() {
        return registry -> registry.config().namingConvention(NamingConvention.dot);
    }
```
第一个配置自定义了所有的`MeterRegistry`：
1. 如果是GraphiteMeterRegistry，添加一些common tags；
2. 所有的MeterRegistry每新注册一个meter，就输出meter的一些信息。如果是GraphiteMeterRegistry，使用GraphiteHierarchicalNamingConvention输出它的名字。**这样就可以在log里看到发给graphite的metric名字长啥样，如果不满意提前修正**。

第二个配置自定义了GraphiteMeterRegistry：NamingConvention使用dot分隔的方式，要不然GraphiteMeterRegistry默认的行为是使用GraphiteDimensionalNamingConvention或GraphiteHierarchicalNamingConvention，都会把meter的名字处理成下划线分隔的样子。

Ref
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-metrics
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-metrics-meter
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-endpoints-exposing-endpoints

## 默认注册的meter
micrometer-core依赖里，`io.micrometer.core.instrument.binder`下有各种各样的`MeterBinder`，binder里注册了不同的meter。spring boot默认会把`MeterBinder`注册到`MeterRegistryPostProcessor`，它是一个`BeanPostProcessor`实例，会在构建一个bean后起作用。它的作用很简单明了：
```java
@Override
public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
	if (bean instanceof MeterRegistry) {
		getConfigurer().configure((MeterRegistry) bean);
	}
	return bean;
}
```
如果这个bean是`MeterRegistry`的实例，就把该binder注册上去。

所以系统中所有的MeterRegistry实例都会注册上这些binder里的所有meter。

> 和MeterRegistryCustomizer的实现方式一样。

以下是这些binder里的一些meter总结，具体细节可以在这些binder里找到。

JVM info:
- `process.uptime`: Gauge，JVM启动时间；
- `process.cpu.usage`: jvm使用的cpu量占系统cpu百分比；
- `jvm.classes.loaded`: Gauge，jvm加载class数；
- `jvm.classes.unloaded`: Counter，jvm启动后卸载class数；

JVM thread:
- `jvm.threads.{live/peak/daemon}`: Gauge，jvm存活/巅峰/守护线程数；
- `jvm.threads.states.state.{blocked/new/runnable/terminated/timed-waiting}`: Gauge，jvm各个状态的线程数；

JVM memory：used/committed/max
- `jvm.memory.used.area.{heap/nonheap}.id.*`: Gauge，heap/non-heap各个区的内存使用量；
- `jvm.memory.max.area.{heap/nonheap}.id.*`: Gauge，heap/non-heap各个区的最大配置。used/max可以得出heap/nonheap的使用比例；
- `jvm.memory.committed.area.{heap/nonheap}.id.*`:

> 详情参考[MemoryUsage](https://docs.oracle.com/javase/9/docs/api/java/lang/management/MemoryUsage.html)。jvm的内存有init -> used -> committed -> max。committed是系统保证已经可以让jvm使用的内存大小。committed永远介于used和max之间，**但是启动一段时间之后可能小于init（此时used也一定小于init）**。

因为用的是G1收集器，所以heap有：
- G1-Eden-Space
- G1-Survivor-Space
- G1-Old-Gen：老年代大小远大于前两个（新生代）。

nonheap和heap相比，每一块都很小。有：
- Code-Cache
- Compressed-Class-Space
- Metaspace

最大的两块就是Eden和Old Gen了。二者中，Old Gen远大于Eden。

JVM GC:
- `jvm.gc.pause.action.*.cause.*`: Timer，总和为G1垃圾收集的总时间。也可以统计速率：每秒垃圾收集的总时间。
- `jvm.gc.memory.allocated`: Counter，Incremented for an increase in the size of the young generation memory pool after one GC to before the next。**两次GC之间新生代的垃圾增长量byte**。可以统计其速率：每秒增长的大小（byte）。
- `jvm.gc.memory.promoted`: Counter, Count of positive increases in the size of the old generation memory pool before GC to after GC。**一次GC使老年代增长的大小byte**。可以统计其速率：每秒增长的大小（byte）。

以下两个old gen相关的meter已经可以用上面的表示了：
- `jvm.gc.live.data.size`: Gauge，Size of old generation memory pool after a full GC。等同于jvm.memory.used.area.heap.id.G1-Old-Gen；
- `jvm.gc.max.data.size`: Gauge，Max size of old generation memory pool，等同于jvm.memory.max.area.heap.id.G1-Old-Gen；

Tomcat:
- `tomcat.threads.{busy/config/current}.name.{http-nio-8642/...}`: Gauge，tomcat忙碌/配置/当前线程数；
- `tomcat.threads.config.max.name.{http-nio-8642}`: Gauge，tomcat配置的最大线程数；
- `tomcat.sessions.*`: Counter，tomcat各种session统计；
- `tomcat.global.{sent/received}.name.{http-nio-8642/...}`: Counter，tomcat收发字节数；

logback:
- `logback.events.level.{error/warn/info/...}`: Counter，各个级别日志条目统计；

system:
- `system.cpu.usage`：系统cpu使用情况；
- `system.load.average.1m`: 系统1m的load average；
- `system.cpu.count`：系统核数；

# 最后
加了监控之后再看jvm的新生代老年代，抽象的概念是不是瞬间写实了？
