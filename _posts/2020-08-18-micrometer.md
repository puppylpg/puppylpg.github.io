---
layout: post
title: Micrometer
date: 2020-08-18 15:50:48 +0800
categories: micrometer
tags: micrometer
---

给系统加个监控吧，要不然根本不知道里面发生了啥。

1. Table of Contents, ordered
{:toc}

# metric
在Java程序中，一般需要统计的量被称为metric。比如请求个数、请求到来的速率、请求处理的时间分布quantile（.50/.95/.99等）。

# metric统计方案
## 最简陋
一般统计metric分为如下步骤：
1. 在应用中插入metric，统计数据。可以使用dropwizard；
2. 将metric暴露出来，比如通过Java提供的JMX（Java Management Extension）技术，将metric变量暴露到特定端口；
3. 此时，变量可以通过jmx端口从外部获取到。如果比较懒，或者急需临时观察一下metric，可以直接使用Java自带的jconsole连接host和jmx的port，观察metric。

> metric -> jmx -> jconsole

- https://www.dropwizard.io/

## 正常部署方案

上述方法的缺陷很明显：只能观察到应用当前暴露的metric的状态，没法查看过去的数据。且数据均为数字，很不直观。

所以正常的系统部署方案，一般会部署一个专门记录统计数据的第三方server，比如graphite，主要用来存储metric，并将metric绘制成图像，这样就能很直观地查看过去一段时间应用metric的变化。不过graphite主要是用来存储数据的，绘图UI其实也比较简陋，这个时候grafana就很有用，它利用graphite收集到的数据，通过查询graphite，将数据以更现代化更丰富的UI呈现出来。

> metric -> jmx -> (jmxtrans) -> graphite -> grafana

- https://graphiteapp.org/
- https://grafana.com/

由于graphite是一个server，接收发送来的数据。jmx也是一个server，提供查询metric的方法。两个server都是被动接收请求，所以还需要一个中间人，从jmx处查询到数据，再发送给graphite。这个工具一般使用jmxtrans，名字直白易懂：jmx transport，用来传输jmx暴露的metric。

- https://www.jmxtrans.org/
- https://github.com/jmxtrans/jmxtrans/wiki

## 优化部署方案
上述方法的一个很明显的缺陷就是链条过长，需要部署多个服务，一旦出问题需要检查不同服务以确定出问题位置。

另外使用jmxtrans比较麻烦，需要定义一套配置，jmxtrans按照配置抓取服务中的metric。定义配置本身就比较麻烦，而且多个服务就要定义多个配置。

既然graphite是一个server，那为是么不让Java服务直接将自己的metric发送到graphite呢？这样直接砍去了jmx和jmxtrans两个环节。

> metric -> graphite -> grafana

这样就相当清晰了：
1. 服务自己统计并发送自己的metric；
2. graphite接收并存储metric；
3. grafana绘制metric图像；

在应用中统计metric一般还是用dropwizard，发送到graphite则可以使用dropwizard提供的另一个依赖：metrics-graphite，配置好graphite地址，就可以直接发送了。当然还可以配置一些细粒度的属性，比如metric的prefix、发送频率等。

## 大一统方案 - micrometer
上述方案虽然简洁明了，但也存在一个致命缺陷：只能将自己使用dropwizard统计的metric通过dropwizard的metrics-graphite直接发送给graphite。第三方依赖比如tomcat，统计的metric是通过暴露jmx暴露的，想收集这些metric还是得通过jmx和jmxtrans。但是这些metric对于服务端又很重要，必须收集。如此一来还是逃不开链条很长的那一套。

micrometer则提供了一个大一统方案，解决了这个问题。

不妨想想如果我们自己想搞一套大一统方案，思路上应该怎么搞：
1. 首先肯定是要提供一种自定义metric的方式；
2. 要把一些流行的第三方比如tomcat的metric也收集起来；
3. 用户自定义的metric和收集的第三方的metric要是一个统一的格式；
4. 把该统一格式的metric发送到第三方统计server，可以是graphite，也可以是其他。

> micrometer -> graphite ect -> grafana

- http://micrometer.io/

micrometer甚至有做好的grafana模板：
- https://grafana.com/grafana/dashboards/4701

可惜是搭配Prometheusby监控系统用的，graphite用不了。期待graphite版本的模板。

> grafana的模板可以在https://grafana.com/grafana/dashboards里检索。

# micrometer

- http://micrometer.io/docs/concepts
- http://micrometer.io/docs

在micrometer里，meter就是metric的意思。通过接口`Meter`来表示。

## 统一的接口
micrometer观察了各个监控系统（eg：graphite）的特性，重新定义了一整套大一统接口，可以收集metric，并发送到各种监控系统。

### Meter
metric。具体细分有：
- Counter;
- Gauge;
- Timer;
- DistributionSummary;

### MeterRegistry
用于注册、收集Meter。

micrometer为每个监控系统定义了一个MeterRegistry的实现，比如Graphite对应的是GraphiteMeterRegistry，主要用途是将注册在该registry上的meter以graphite的通用规范发送给graphite。

CompositeMeterRegistry是个特殊的registry，可以添加多个registry。micrometer提供了一个全局的CompositeMeterRegistry：`Metrics.globalRegistry`，同时Metrics类里有一堆静态方法，比如counter方法可以直接为该registry添加一个Counter。CompositeMeterRegistry里添加的所有MeterRegistry都会注册上这个Counter。最大的好处就是：**可以一次向多个监控系统注册Meter**。

> Micrometer provides a CompositeMeterRegistry to which multiple registries can be added, allowing you to publish metrics to more than one monitoring system simultaneously.

### Counter
非常简单的Meter。只增不减的计数器，可以统计：
- 累加值：发生的次数；
- 速率：metric发生的速率，比如1/5/15min内的平均qps。

### Gauge
实时反映一个metric的状态，比如缓存的大小。不像Counter一样一直只增不减，Gauge的大小是不断变化的。
- 值：一个随时变化可大可小的值。

> gauge: the thickness, size, or capacity of something.

> Gauges are useful for monitoring things with natural upper bounds. We don’t recommend using a gauge to monitor things like request count, as they can grow without bound for the duration of an application instance’s life.

> If it helps, think of a Gauge as a "heisen-gauge" - a meter that only changes when it is observed.

### Timer - timed events
统计短时间事件，比如请求处理时长。Timer统计的指标比较丰富：
- 累加值：事件发生的次数；
- 速率：1/5/15min内事件每秒发生的次数；
- 分位点：**事件时长的分布**。比如处于.95分位点的事件的时长，用来估算整个服务的性能。50/75/95/98/99/999之外，还能统计min/max。

注意事项：
1. Timer统计的内容涵盖Counter，但不要滥用Timer，对于仅使用Counter就可以解决问题的场景，不要用Timer。
2. Counter和Gauge是不同的东西，Counter仅用于累加，只增不减，所以在使用Gauge的场合使用Counter。

> Timers are intended for measuring short-duration latencies, and the frequency of such events. All implementations of Timer report at least the total time and count of events as separate time series.

> recording many longer durations could cause overflow of the total time at Long.MAX_VALUE nanoseconds (292.3 years).

> The appropriate base unit for timers varies by metrics backend for good reason. Micrometer is decidedly un-opinionated about this, but because of the potential for confusion, requires a TimeUnit when interacting with Timers. Micrometer is aware of the preferences of each implementation and publishes your timing in the appropriate base unit based on the implementation.

### DistributionSummary - sized/weighted/... events
用来统计事件的分布，类似Timer，只是单位不同。

Timer统计的单位是时间，每一个事件发生的时间，DistributionSummary可以是任何单位，比如请求的大小，则单位可以设定为byte，DistributionSummary标识的就是**事件大小的分布**，相应的p95的含义就是处于.95分位点的请求的大小。

不过M1 rate还是表示一分钟内每秒达到的请求，还是qps。累加值还是表示事件发生的次数。这两方面的统计量是不变的。

## unit
Add base units for maximum portability -- base units are part of the naming convention for some monitoring systems. Leaving it off and violating the naming convention will have no adverse effect if you forget.

## Tag
给meter打标签，可以将标签一并发给支持标签的监控系统，使用标签检索数据。
```
registry.counter("database.calls", "db", "users")
```
For example if we select database.calls we can see the total number of calls to all databases. Then we can group by or select by db to drill down further or perform comparative analysis on the contribution of calls to each database

按名字选meter可以直接获取其值，但是按照tag聚合、分类，可以深度研究（drill down）数据。

通用标签：Common tags can be defined at the registry level and are added to every metric reported to the monitoring system. 

## Meter Filter
meter的过滤器，添加在MeterRegistry上，决定了：
- Deny：哪些meter可以被注册；
- Transform：改变meter的id、tag、unit等属性；
- configure：distribution statistics for some meter types，统计一些meter类型分布；


## NamingConvention
Each Micrometer implementation for a monitoring system comes with a naming convention that transforms lowercase dot notation names to the monitoring system’s recommended naming convention. Additionally, this naming convention implementation sanitizes metric names and tags of special characters that are disallowed by the monitoring system.

所以程序中建议统一用dot分隔的名字，micrometer会将metric转成各个监控系统想要的格式。NamingConvention做两件事：
1. NamingConvention不同的实现会将meter name转成相应监控系统想要的格式；
2. 如果监控系统不支持name中有某些字符，则用其他字符替换掉它；

具体细节要看不同NamingConvention的实现，比如graphite对应的有GraphiteHierarchicalNamingConvention和GraphiteHierarchicalNameMapper两种。

## rate aggregation
Timers and distribution summaries support collecting data to observe their percentile distributions.
1. 监控服务端支持自查询percentile的，micrometer只发bucket数据就行了；
2. 服务器不支持自查询的，micrometer就算好percentile，发给服务器；

## MeterBinder
接口，定义bindTo方法，用来将meter注册到MeterRegistry上。

比如`UptimeMetrics implements MeterBinder`的bindTo方法实现：
```
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
定义了两个TimeGauge，register到registry上。

## Ref
- https://spring.io/blog/2018/03/16/micrometer-spring-boot-2-s-new-application-metrics-collector
- http://micrometer.io/docs 
- http://micrometer.io/docs/concepts
- https://www.baeldung.com/micrometer

# micrometer使用
创建一个GraphiteMeterRegistry：
```
        GraphiteConfig graphiteConfig = new GraphiteConfig() {
            @Override
            public String host() {
                return "quipu-graphite.inner.youdao.com";
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
        registry.config().commonTags("prefix", "prefix-");
```
创建一个JmxMeterRegistry，注册一些micrometer提供好的：
```
        JmxMeterRegistry registry = new JmxMeterRegistry(JmxConfig.DEFAULT, Clock.SYSTEM);

        new ClassLoaderMetrics().bindTo(registry);
        new JvmMemoryMetrics().bindTo(registry);
        new JvmGcMetrics().bindTo(registry);
        new ProcessorMetrics().bindTo(registry);
        new JvmThreadMetrics().bindTo(registry);
```


Micrometer uses Dropwizard Metrics as the underlying instrumentation library when recording metrics destined for Graphite.


# spring boot + micrometer
spring boot最大的优点（缺陷）就是自动配置。

> 了解原理，自动配置是一个非常方便的属性，不明就里，自动配置能把你搞得云里雾里。

引入相应的依赖之后，spring boot会自动为micrometer配置好相应的MeterRegistry，绑定众多的MeterBinder，注册好基本满足大部分需求的Meter。整个服务基本不需要再配置什么了。

下面以jmx和graphite为两个目标监控系统，使用spring boot配置micrometer。

## 依赖
自动配置graphite的MeterRegistry需要micrometer-registry-graphite，jmx同理。他们会自动下载micrometer的核心依赖比如micrometer-core，所以只写这两个就行了：
```
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-graphite</artifactId>
        </dependency>
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-jmx</artifactId>
        </dependency>
```
由于上述两个lib在classpath上，JmxMeterRegistry/GraphiteMeterRegistry都已经由spring-boot自动创建好了。详见GraphiteMetricsExportAutoConfiguration。
同时创建好的还有GraphiteConfig等。

另外查看GraphiteMetricsExportAutoConfiguration的类定义，可看到类的注解：
```
@ConditionalOnProperty(prefix = "management.metrics.export.graphite", name = "enabled", havingValue = "true",
		matchIfMissing = true)
```
意味着需要配置`management.metrics.export.graphite.enable=true`属性才能显式自动配置该bean。不过spring boot里，该配置的默认值就是true。

> 注意：如果我们此时手动配置一个GraphiteMeterRegistry会很尴尬，这样spring boot就不会自己创建该bean了，
同时，**application.yml里对GraphiteMeterRegistry的配置就没用了**！！！因为这些配置是给spring boot自动配置用的！
spring boot不自动配置了，properties里的配置自然也没用了。

所以如果自己创建GraphiteMeterRegistry，需要自己创建并传入GraphiteConfig，比如：
```
        GraphiteConfig graphiteConfig = new GraphiteConfig() {
            @Override
            public String host() {
                return "quipu-graphite.inner.youdao.com";
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

## spring boot做好的自动配置行为
首先，看官方文档是非常非常必要的，看看spring已经做好了哪些：
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-metrics

毕竟用的别人的代码，很多东西已经写好默认了，就不用动手了。这点不看文档、不看自动配置的那些代码，再手撸一遍就搞笑了。

- Metrics.global
- 其实还配置好了一个CompositeMeterRegistry，需要用的话可以直接注入
- 配置好了一堆MeterRegistry，比如GraphiteMeterRegistry（只要引入了micrometer-registry-graphite的包即可）
- 还有tomcat的registry、jvm的registry
- 这些registry都已经注册到了CompositeMeterRegistry上

如果不看文档，岂不是要自己造了。

还有更细粒度的自定义：
- `MeterRegistryCustomizer<GraphiteMeterRegistry>`，可以配置GraphiteMeterRegistry，用代码替换个别配置项

这是个很重要的信息。因为spring boot提供的通过配置文件进行配置的项有限，就可以通过这个进一步自定义。

还会为web(Spring MVC)自动生成一些metrics（控制的是生成web的metrics，而不是上面的那些"export"的行为）：
```
management.metrics.web.server.request.metric-name=auto-time-for-all.http.server.requests
```

## 配置
在application.yml里配置micrometer：
```
management:
  metrics:
    export:
      graphite:
        step: 1m
        host: localhost
        port: 2003
        tags-as-prefix: metric,project,profile,host,port,pokemon # pokemon comes from `management.metrics.tags.pokemon`
        graphite-tags-enabled: false # disable tag, use as hierarchical name
        protocol: plaintext
      jmx:
        enabled: true
    web:
      server:
        request:
          autotime:
            enabled: true
          metric-name: auto-time-for-all.http.server.requests
    tags: # add common tags for meter
      pokemon: pikachu
      application: test-server
      author: puppylpg
```

建议开启actuator，可以开启`/metrics` endpoint，服务启动后直接观察metric：
```
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
- management.metrics.export.graphite:
    - step：将meter发送到监控系统的频率。1m代表1min发一次；
    - host/port：graphite地址；
    - graphite-tags-enabled：是否开启tag支持。如果不开启，tag将作为层级name来用，添加到meter的名字前后作为前后缀；
    - tags-as-prefix：决定哪些tag添加到meter名字之前。其余tag添加到meter名字之后。共同组成meter的层级名称；
    - protocol：以什么协议发送给graphite。graphite支持plaintext/pickle/udp三种协议。这里要看部署的graphite开启了什么协议支持。虽然pickle可以批量发送metric，如果graphite不支持pickle，发pickle消息是没用的；
- management.metrics.tags：直接在配置文件里配置common tag，使用key value自定义一堆tag，spring boot会将其存为Map；
- management.metrics.web.server.request.autotime:
    - enabled：是否对spring mvc的方法自动开启统计的Timer；
    - metric-name：timer的名字；

> management.metrics.web.server.request.autotime.enabled开启之后默认会有一组名为`http.server.requests.exception.{None/TimeoutException/...}.method.{GET/POST/...}.outcome.{SUCCESS/...}.status.{200/...}.uri.{方法对应的uri}`的Timer，统计各个uri方法的各种情况下对应的metric。因为都是Timer，所以count/m1_rate/p75等都可以获取。

> 这里使用management.metrics.web.server.request.autotime.metric-name将http.server.requests改名为all-time-for-all.http.server.reuqests。

### 标签作为前后缀
可以给MeterRegistry配置common tag，从而给registry里的所有meter打一堆标签，奇偶位置分别为key和value：
```
meterRegistry.config().commonTags("profile", "test", "project", "test-server", "host", MachineUtils.getShortHostName(), "port", env.getProperty("server.port"));
```
如果不使用graphite的tag系统：
```
management.metrics.export.graphite.graphite-tags-enabled=false
```
将会使用GraphiteHierarchicalNameMapper和GraphiteHierarchicalNamingConvention。

GraphiteHierarchicalNameMapper可以将其中的一些tag的key和value作为prefix，其余的将变成suffix：
```
management.metrics.export.graphite.tags-as-prefix=profile,project,host,port
```
均为dot分隔，添加在meter名字前后。

> GraphiteHierarchicalNameMapper: Defines the mapping between a combination of name + dimensional tags and a hierarchical name.

GraphiteHierarchicalNamingConvention默认使用`NamingConvention.camelCase`，将meter本身的名字处理成驼峰写法。

可以用上面说的`MeterRegistryCustomizer<GraphiteMeterRegistry>`，替换GraphiteMeterRegistry的NamingConvention为`NamingConvention.dot`，
就全都是dot分隔的了。

### 使用MeterRegistryCustomizer个性化MeterRegistry
spring boot提供的properties文件里对MeterRegistry的配置项毕竟有限，而且表述复杂的配置也不容易。更多更复杂的配置可以在代码中使用MeterRegistryCustomizer来实现。

MeterRegistryCustomizer的个性化配置通过`MeterRegistryPostProcessor#postProcessAfterInitialization`来完成：if bean instanceof MeterRegistry, 则getConfigurer().configure((MeterRegistry) bean)，就把customizer的行为配置到registry的bean上了。

比如：
```
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
                                "suffix", "pika"
                        );
            }


            GraphiteHierarchicalNameMapper nameMapper = new GraphiteHierarchicalNameMapper(graphiteProperties.getTagsAsPrefix());

            registry.config()
                    .onMeterAdded(meter -> {
                        String registryClass = registry.getClass().getSimpleName();
                        NamingConvention namingConvention = registry.config().namingConvention();
                        String conventionName = namingConventionName(namingConvention);

                        // 刚开始创建的时候用的是GraphiteHierarchicalNamingConvention，被替换后就不是了
                        if (namingConvention instanceof GraphiteHierarchicalNamingConvention) {
                            conventionName = "graphiteHierarchicalNamingConvention";
                        }

                        String meterConventionName = meter.getId().getConventionName(registry.config().namingConvention());
//                        log.info("{}; {}; Meter Added: {}", registryClass, conventionName, meterConventionName);
                        System.out.println(String.format("%s; %s; Meter Added: %s", registryClass, conventionName, meterConventionName));
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

    private String namingConventionName(NamingConvention namingConvention) {
        return namingConvention == NamingConvention.dot ? "dot" :
                namingConvention == NamingConvention.camelCase ? "camel" :
                        namingConvention == NamingConvention.identity ? "identity" :
                                namingConvention == NamingConvention.slashes ? "slashes" :
                                        namingConvention == NamingConvention.snakeCase ? "snake" :
                                                namingConvention == NamingConvention.upperCamelCase ? "upperCamel" : "unknown";
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
第一个配置自定义了所有的MeterRegistry：
1. 如果是GraphiteMeterRegistry，添加一些common tags；
2. 所有的MeterRegistry每新注册一个meter，就输出meter的一些信息。如果是GraphiteMeterRegistry，使用GraphiteHierarchicalNamingConvention输出它的名字。**这样就可以在log里看到发给graphite的metric名字长啥样，如果不满意提前修正**。

第二个配置自定义了GraphiteMeterRegistry：NamingConvention使用dot分隔的方式，要不然GraphiteMeterRegistry默认的行为是使用GraphiteDimensionalNamingConvention或GraphiteHierarchicalNamingConvention，都会把meter的名字处理成下划线分隔的样子。

### Ref
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-metrics
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-metrics-meter
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#production-ready-endpoints-exposing-endpoints

## 默认注册的meter
micrometer-core依赖里，`io.micrometer.core.instrument.binder`下有各种各样的MeterBinder，binder里注册了不同的meter。spring boot默认会把MeterBinder注册到MeterRegistryPostProcessor，它是一个BeanPostProcessor实例，会在构建一个bean后起作用。它的作用很简单明了：
```
	@Override
	public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
		if (bean instanceof MeterRegistry) {
			getConfigurer().configure((MeterRegistry) bean);
		}
		return bean;
	}
```
如果这个bean是MeterRegistry的实例，就把该binder注册上去。

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

