---
layout: post
title: "SpringBoot - 开发、部署、诊断"
date: 2023-01-08 22:37:56 +0800
categories: springboot
tags: springboot
---

2023年是清理库存之年，清理而后轻装向前。就把springboot之前看到的开发、部署以及一些诊断相关的东西都扔在一起做个了结吧。

1. Table of Contents, ordered
{:toc}

# spring-boot-devtools
[spring-boot-devtools](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#using.devtools)会给springboot的开发带来一些便利，**但是注意依赖需要设置为optional，防止作为本工程依赖时，别的项目被迫引入devtools。因为在生产环境使用它可能会导致安全问题。**

```
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-devtools</artifactId>
        <optional>true</optional>
    </dependency>
</dependencies>
```

## 默认properties
默认会设置一些开发友好的properties，比如禁用thymeleaf cache。在开发环境不禁用的话影响实时看效果。

## restart
开发的时候经常需要写完代码启动看一下效果，devtools可以自动重启。

假设使用idea开发、启动服务，然后修改代码。**此时代码的修改并不会让服务重启，因为监控的是classpath，而代码不在classpath上，target才会在classpath上**。我们要做的是让classpath发生变动。所以推荐使用`mvn compile`，或者如果只改了一两个文件，最好只recompile这一个文件，使用idea的快捷键`ctrl + shift + f9`。

此时服务会重启，直接访问url发现内容变了。

最好别配置idea的自动编译，会边写边编译，太难受了。手动编译一下并不麻烦。

- https://zhuanlan.zhihu.com/p/133233569
- https://blog.csdn.net/qq_52978553/article/details/122376118
- https://www.jetbrains.com/help/idea/compiling-applications.html#compilation_output_folders

服务重启的原理：devtools**使用了两个classloader，jar包类的使用不变的classloader加载，工程的类使用另一个restart classloader加载。所谓重启其实是扔掉restart classloader，重新创建一个**。

**所以并不是真的服务重启了，服务的pid应该一直没变**。

## remote restart
和restart一样，只不过这次服务不是用ide本地起的，而是起在了远程机器、docker里。

如前所述，默认情况下jar包不会把devtools打进去：
> **Developer tools are automatically disabled when running a fully packaged application**. If your application is launched from `java -jar` or if it is started from a special classloader, then it is considered a “production application”. You can control this behavior by using the `spring.devtools.restart.enabled` system property. To enable devtools, irrespective of the classloader used to launch your application, set the `-Dspring.devtools.restart.enabled=true` system property. **This must not be done in a production environment where running devtools is a security risk**. To disable devtools, **exclude the dependency or set the `-Dspring.devtools.restart.enabled=false` system property**.

所以首先要允许把devtools打包到jar包里：
```
<build>
    <plugins>
        <plugin>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-maven-plugin</artifactId>
            <configuration>
                <excludeDevtools>false</excludeDevtools>
            </configuration>
        </plugin>
    </plugins>
</build>
```
然后在远程机器上启动jar服务。

接着本地ide里创建configuration，module是本工程，**但是启动类不要使用springboot在服务里的启动类，而是替换成`org.springframework.boot.devtools.RemoteSpringApplication`**。最后设置好远程服务的地址。

其他一切都和之前一样了：修改并重新编译本地文件就行了，远程服务会自动restart。

- https://blog.csdn.net/sufu1065/article/details/127505890

原理应该和本地重启一样，只不过是先把变动发给远程服务，远程服务里的devtools会接受变动并重新创建restart classloader。

> 可以在play with docker里玩玩~

# spring-boot-maven-plugin
除了打一个带依赖的可执行的jar包，还有一个功能是[打一个layered jar](https://www.baeldung.com/spring-boot-docker-images)，为构建docker image提供便利。之前介绍Dockerfile的时候已经介绍过了。

# actuator
actuator主要用于更详细地了解系统的实际运行情况，让服务变得更加可感知。

actuator毕竟不是生产环境的功能，在不同的版本需要配置的东西并不完全相同，所以还是要参考对应版本的文档。
- https://docs.spring.io/spring-boot/docs/2.7.0/reference/html/actuator.html

## endpoints
endpoint可以查看app状态，基本把app里大家比较关心的各种状态（mapping、session、thread、logger、health、metrics、env等）都提供了暴露出来的方法，非常方便！

**endpoint需要先enable再expose才能用**。可以通过http或者jmx暴露。默认endpoint的prefix是`/actuator`，可修改。

**所有的actuator api可以在[这里](https://docs.spring.io/spring-boot/docs/current/actuator-api/htmlsingle/)查看详情。**

相对有用的endpoint：
- `beans`：查看所有的bean；
- `caches`：项目用到的cache；
- `conditions`：autoconfig判定，开发的时候开启debug log比这个要有效；
- `health`：**服务以及某些组件（mysql、elasticsearch、redis等）的运行状态**。直接看可能意义不大，可以暴露给监控接口用。还能开启一些更细致的状态监控：
    + db：监控db运行状态。如果有`DataSource`就会自动配置；
    + diskSpace
    + ping
- `env`：**可以看看当下生效的profiles，看到所有的properties和environment**，还挺有用的；
- `configprops`：**所有`@ConfigurationProperties`。可以使用`@Value`注入的值**。和env里的properties的区别的地方在于，env是原始的properties，而这个是注入properties后的properties bean的值。比如`server.servlet.context-path`这个property配置的值最终是注入到了`ServerProperties`里，configprops显示的是`server-org.springframework.boot.autoconfigure.web.ServerProperties`（表示以`server` prefiex开头）；
- `httptrace`：**http request和response详情**。需要手动配置相关bean；
- `metrics`：类似dropwizard的metric，引入micrometer后会自动注册更多metric。还能通过`/metrics/<metric>`查看具体metric的信息；
- `mapping`：**类似restful tool，查看服务所有的url mapping**；
- `loggers`：所有的log的级别。**不仅如此，还能[在运行时修改某些logger的级别](https://docs.spring.io/spring-boot/docs/current/actuator-api/htmlsingle/#loggers.setting-level)**，这就很爽了；
- `scheduledtasks`：查看[所有的spring schedule task](https://docs.spring.io/spring-boot/docs/current/actuator-api/htmlsingle/#scheduled-tasks)，倒是挺不错；
- `shutdown`：这要是带到生产环境就酸爽了；
- `startup`：[startup tracking](https://docs.spring.io/spring-boot/docs/current/actuator-api/htmlsingle/#startup)
- `session`：应该用了spring session才会开启，**[可以直接查看当前所有的session](https://docs.spring.io/spring-boot/docs/current/actuator-api/htmlsingle/#sessions)**，不错！Allows retrieval and deletion of user sessions from a Spring Session-backed session store. Requires a servlet-based web application that uses Spring Session.
- `threaddump`：jstack，一样的。但是该接口还支持返回[json格式的thread dump](https://docs.spring.io/spring-boot/docs/current/actuator-api/htmlsingle/#threaddump.retrieving-json)；
- `heapdump`：直接heapdump文件！牛逼！
- `prometheus`：直接用于[prometheus server抓metric](https://docs.spring.io/spring-boot/docs/current/actuator-api/htmlsingle/#prometheus)的endpoint；

### enable
除了shutdown，所有的endpoints默认都开启了。shutdown需要手动enable：
```
management.endpoint.shutdown.enabled=true
```
也可以反着来，禁掉所有，然后显式开启其中某一个：
```
management.endpoints.enabled-by-default=false
```
只开启`info` endpoint：
```
management.endpoint.info.enabled=true
```

> 对所有的endpoints的设置用的是复数endpoints，对某一个的设置用的是单数endpoint。

这个控制的是“有没有”这个endpoint，而非“暴露不暴露”。

> **Disabled endpoints are removed entirely from the application context**.

### expose
**所有enable的endpoint，jmx端默认基本都会暴露。web endpoint默认只会暴露health**。

具体参考：
- https://docs.spring.io/spring-boot/docs/2.7.0/reference/html/actuator.html#actuator.endpoints.exposing

分别使用jmx/web的include/exclude控制暴露行为。默认行为：
```
management.endpoints.jmx.exposure.exclude=
management.endpoints.jmx.exposure.include=*
management.endpoints.web.exposure.exclude=
management.endpoints.web.exposure.include=health
```

> `*` can be used to select all endpoints. `*` has a special meaning in YAML, so be sure to add quotation marks if you want to include (or exclude) all endpoints.

### security
**如果有spring security，springboot默认会对除`health`的endpoint进行保护**。health可能会被用作服务健康监控，默认不设置权限还挺合理的。

> If Spring Security is on the classpath and no other `SecurityFilterChain` bean is present, all actuators other than `/health` are secured by Spring Boot auto-configuration. **If you define a custom `SecurityFilterChain` bean, Spring Boot auto-configuration backs off and lets you fully control the actuator access rules**.

如果自己配置security的话，actuator提供了`EndpointRequest.toAnyEndpoint()`可以配置所有actuator相关的url。

```
import org.springframework.boot.actuate.autoconfigure.security.servlet.EndpointRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

import static org.springframework.security.config.Customizer.withDefaults;

@Configuration(proxyBeanMethods = false)
public class MySecurityConfiguration {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http.securityMatcher(EndpointRequest.toAnyEndpoint());
        http.authorizeHttpRequests((requests) -> requests.anyRequest().hasRole("ENDPOINT_ADMIN"));
        http.httpBasic(withDefaults());
        return http.build();
    }

}
```

## http trace
可以记录下最近100条request/response的具体信息，但是默认不会记录下cookie、session等信息，需要手动设置。
- https://docs.spring.io/spring-boot/docs/2.7.0/reference/html/actuator.html#actuator.tracing

还需要显式配置个bean来存储这些信息，比如demo用的in memory bean：
```
    /**
     * to use /actuator/httptrace
     */
    @Bean
    public HttpTraceRepository httpTraceRepository() {
        return new InMemoryHttpTraceRepository();
    }
```

完整actuator配置：
```
# actuator
management:
    ### enable
    endpoint:
        health:
            show-components: always
            show-details: always
        shutdown:
            enabled: true
    ### expose
    endpoints:
        web:
            exposure:
                include: '*'
    info:
        env:
            enabled: true
        git:
            enabled: true
        java:
            enabled: true
        os:
            enabled: true
    ## httptrace
    trace:
        http:
            include: AUTHORIZATION_HEADER,COOKIE_HEADERS,PRINCIPAL,REMOTE_ADDRESS,REQUEST_HEADERS,RESPONSE_HEADERS,SESSION_ID,TIME_TAKEN
```

# startup tracking
spring 5.3引入了startup tracking的功能，springboot 2.4可以通过actuator把`startup` endpoint暴露出来。它不仅能监控每一部分的启动时间，更能让人对spring context的启动过程有一个更直观的把控：

> Tracking the application startup steps with specific metrics can help understand where time is being spent during the startup phase, **but it can also be used as a way to better understand the context lifecycle as a whole**.

为了记录启动过程，需要一个组件记录这些信息。spring提供了`ApplicationStartup`接口，一般demo用的话，直接使用`BufferingApplicationStartup`即可：
```
    public static void main(String[] args) {
        SpringApplication application = new SpringApplication(SpringBootWebApp.class);
        application.setApplicationStartup(new BufferingApplicationStartup(10000));
        application.run(args);
    }
```

[这里](https://www.baeldung.com/spring-boot-actuator-startup)提供的解析结果很不错：
```
> curl 'http://localhost:8080/actuator/startup' -X POST \
| jq '[.timeline.events
 | sort_by(.duration) | reverse[]
 | select(.startupStep.name | match("spring.beans.instantiate"))
 | {beanName: .startupStep.tags[0].value, duration: .duration}]'
```
需要安装jq做json parser，可以分析出每一个bean实例化的时间，倒排一下，看看有没有特别拖累启动速度的bean。

# 感想
springboot真的是把能做的都做了，就差帮你把业务代码也写完了:D

