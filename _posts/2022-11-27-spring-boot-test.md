---
layout: post
title: "SpringBoot Test"
date: 2022-11-27 03:06:04 +0800
categories: spring springboot test
tags: spring springboot test
---

springboot是基于spring的，[springboot test](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing)自然也是基于[spring test]({% post_url 2022-11-25-spring-test %})的。`spring-boot-test`依赖基于`spring-test`依赖，使用spring test提供的`@BootstrapWith`构建自己的context，至少提供了两方面的便利：
1. **以springboot的方式寻找自己的config class**，比spring test使用`@ContextConfiguration`要方便许多；
2. **甚至给test都要做autoconfig：提供了`spring-boot-test-autoconfigure`**，支持slice test，让spring test写起来又简单了很多！

正如实际写项目的时候用的都是springboot一样，实际写test用的也基本都是springboot test。

> 和src代码一样，一般也是引入`spring-boot-starter-test`，这样所有需要的依赖和autoconfig都有了。

1. Table of Contents, ordered
{:toc}

# `SpringBootTestContextBootstrapper`
spring test提供了`@BootstrapWith`注解，可以让第三方框架是用自己的`TestContextBootstrapper`构建`TestContext`。springboot就实现了这样一个注解`SpringBootTestContextBootstrapper`，只要标注`@BootstrapWith(SpringBootTestContextBootstrapper.class)`，就能以springboot的方式构建自己的`ApplicationContext`。

正如spring test的`@SpringJunitConfig`注解集成了`@ContextConfiguration`一样，springboot test提供了一堆集成了`@BootstrapWith(SpringBootTestContextBootstrapper.class)`的注解`@*Test`，`@SpringBootTest`就是其中最常用的一个。

# springboot test的config class
spring test使用`@ContextConfiguration(classes=…)`指定config class，或者默认使用标注了`@Configuration`的静态内部类：
> If you are familiar with the Spring Test Framework, you may be used to using `@ContextConfiguration(classes=…)` in order to specify which Spring @Configuration to load. Alternatively, you might have often used nested `@Configuration` classes within your test.

**springboot test的关键是使用`SpringApplication`这个启动类以springboot的方式创建`ApplicationContext`**！只要用springboot的`SpringApplication`，一切springboot的特性都被springboot注册到`ApplicationContext`里了：
> External properties, logging, and other features of Spring Boot are installed in the context by default only if you use `SpringApplication` to create it.

## `@SpringBootConfiguration`
springboot test的`@*Test`（可不是只有`@SpringBootTest`这一个注解）找的primary configuration，就是`@SpringBootConfiguration`。

默认`@SpingBootApplication`是带这个注解的。**所以`@*Test`其实就是在找`@SpringBootConfiguration`或者`@SpingBootApplication`**。

> The search algorithm **works up from the package that contains the test until it finds a class annotated with `@SpringBootApplication` or `@SpringBootConfiguration`**

如果找不到就会报错：
> Unable to find a `@SpringBootConfiguration`, you need to use `@ContextConfiguration` or `@SpringBootTest(classes=...)` with your test

[这里也介绍了](https://www.javacodegeeks.com/2019/09/springbootconfiguration-annotation-spring-boot.html):
> The primary reason for this usually is that the test annotations like `@DataJpaTest` and a few others look first for the `@SpringBootConfiguration` annotation in the current package. **In case, it’s missing in the current package, they start looking up the package hierarchy until they find this annotation.**
> 
> **Make sure that your test classes are either in the same package as your class marked with `@SpringBootApplication` or at least lower in the package hierarchy**

springboot test默认是找标注了`@*Test`的本package或 **上级package**，直到找到这样的注解。一般情况下都能找到。

比较特殊的情况是，工程是一个基于springboot的纯lib项目，src里没有启动类。此时如果想用springboot test测这个包，那么test代码里就要写上一个`@SpingBootApplication`。

## 为什么是`@SpringBootConfiguration`
它其实就是`@Configuration`的alias，对spring和springboot来说，它其实就是一个普通的spring `@Configuration`，**只有springboot test对它提供了额外支持**。所以只有在springboot test里它才有点儿高于`@Configuration`的额外作用：
1. springboot test先找`@SpringBootConfiguration`；
2. 再找它关联的config class；
3. **这些config class就是最终构建`ApplicationContext`时用到的config class**。

这个过程体现在`SpringBootTestContextBootstrapper`里：
```
	protected Class<?>[] getOrFindConfigurationClasses(MergedContextConfiguration mergedConfig) {
		Class<?>[] classes = mergedConfig.getClasses();
		if (containsNonTestComponent(classes) || mergedConfig.hasLocations()) {
			return classes;
		}
		Class<?> found = new AnnotatedClassFinder(SpringBootConfiguration.class)
				.findFromClass(mergedConfig.getTestClass());
		Assert.state(found != null, "Unable to find a @SpringBootConfiguration, you need to use "
				+ "@ContextConfiguration or @SpringBootTest(classes=...) with your test");
		logger.info("Found @SpringBootConfiguration " + found.getName() + " for test " + mergedConfig.getTestClass());
		return merge(found, classes);
	}

	private boolean containsNonTestComponent(Class<?>[] classes) {
		for (Class<?> candidate : classes) {
			if (!MergedAnnotations.from(candidate, SearchStrategy.INHERITED_ANNOTATIONS)
					.isPresent(TestConfiguration.class)) {
				return true;
			}
		}
		return false;
	}
```
- 如果指定了config class：**先从指定的config class里扔掉标记了`@TestConfiguration`的class，剩下的就是config class**。
- **如果没有指定config class**，从当前test class找带`@SpringBootConfiguration`的类，把它作为config class。当然如果它component scan了，scan的config class也算。

> **指定config class是谁指定的？spring test啊！springboot test只是在spring test指定的config class的基础上拓展了一下：如果没有config class（对于spring test来说，那就是没有了），springboot test会自己找带`@SpringBootConfiguration`的类，自己收集config class！（对于springboot test来说，没有我就按自己的方式找！）**

找的方式是：
```
		Class<?> found = new AnnotatedClassFinder(SpringBootConfiguration.class)
				.findFromClass(mergedConfig.getTestClass());
```
`AnnotatedClassFinder#findFromClass`的Javadoc说了：Find the first Class that is annotated with the target annotation, **starting from the package defined by the given source up to the root，所以是向上找。**

找到`@SpingBootApplication`之后，它默认是带`@ComponentScan`的，所以scan的那些包里的配置也都找到了！和springboot一样的配置就都来了！ (o゜▽゜)o☆[BINGO!]

但是，**`@SpingBootApplication`带的这个`@ComponentScan`不是一个普通的`@ComponentScan`**，它其实是：
```
@ComponentScan(excludeFilters = { @Filter(type = FilterType.CUSTOM, classes = TypeExcludeFilter.class),
		@Filter(type = FilterType.CUSTOM, classes = AutoConfigurationExcludeFilter.class) })
```
它已经指定了`excludeFilters`：**默认不会去scan这些exclude filter指定的类**。

一共有两个exclude filter：
- 第二个明显是为了排除掉`@EnableAutoConfiguration`配置的bean。但是因为`@SpingBootApplication`里额外加上了`@EnableAutoConfiguration`了，所以这些被`@ComponentScan`故意遗漏的bean又被`@EnableAutoConfiguration`加回来了；
- 第一个filter干嘛的？Javadoc提了一下：They are primarily used internally to `support spring-boot-test`。**它是特意为springboot test准备的。为了支持springboot的“部分测试”（slice test）**。

# slice test
springboot test的`@SpringBootTest`是众多`@*Test`里最特殊的一个，会加载整个app里所有的配置。除此之外，springboot test支持 **只加载某一部分config，只测试某一部分代码**。springboot test称之为[slice test](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.autoconfigured-tests)。

> For example, you might want to test that Spring MVC controllers are mapping URLs correctly, and you do not want to involve database calls in those tests, or you might want to test JPA entities, and you are not interested in the web layer when those tests run.
>
> The `spring-boot-test-autoconfigure` module includes a number of annotations that can be used to automatically configure such “slices”. Each of them works in a similar way, providing a `@…Test` annotation that loads the `ApplicationContext` and one or more `@AutoConfigure…` annotations that can be used to customize auto-configuration settings.

**除了`@SpringBootTest`的其他`@*Test`都是做slice test的**，他们和`@SpringBootTest`如出一辙。一个测试类只能用他们中的一个，如果需要用其他slice的autoconfig，可以导入那个slice对应的`@*Test`里的`@AutoConfigure…`注解。

> Including multiple “slices” by using several `@…Test` annotations in one test is not supported. If you need multiple “slices”, pick one of the `@…Test` annotations and include the `@AutoConfigure…` annotations of the other “slices” by hand.

如果根本不在乎只加载app的slice config，就用`@SpringBootTest`。但是依然可以加上`@AutoConfigure…`，只是用他们自动配置一些bean，取得一些便利。

> It is also possible to use the `@AutoConfigure…` annotations with the standard `@SpringBootTest` annotation. You can use this combination if you are not interested in “slicing” your application but you want some of the auto-configured test beans.

这些只关注slice的`@*Test`都配置了啥？除了从代码里找，还可以来这里找：
- https://docs.spring.io/spring-boot/docs/current/reference/html/test-auto-configuration.html#appendix.test-auto-configuration

## 怎么做到的？
以`@DataElasticsearchTest`为例，他做的是spring-data-elasticsearch的slice test：
```
@DataElasticsearchTest
class MyDataElasticsearchTests {

    @Autowired
    private SomeRepository repository;

    // ...

}
```
它只加载了以下autoconfig的类：
```
org.springframework.boot.autoconfigure.cache.CacheAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchDataAutoConfiguration 
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchRepositoriesAutoConfiguration 
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRepositoriesAutoConfiguration 
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRestClientAutoConfiguration 
org.springframework.boot.autoconfigure.elasticsearch.ElasticsearchRestClientAutoConfiguration
```
所以使用这个注解就 **只做elasticsearch、spring-data-elasticsearch相关的autoconfig**。

### 要加载这些
这一点是通过它带的`@AutoConfigureDataElasticsearch`注解做到的：
```
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@BootstrapWith(DataElasticsearchTestContextBootstrapper.class)
@ExtendWith(SpringExtension.class)
@OverrideAutoConfiguration(enabled = false)
@TypeExcludeFilters(DataElasticsearchTypeExcludeFilter.class)
@AutoConfigureCache
@AutoConfigureDataElasticsearch
@ImportAutoConfiguration
public @interface DataElasticsearchTest {
```
这个注解会默认对应`META-INF/spring`下的`org.springframework.boot.test.autoconfigure.data.elasticsearch.AutoConfigureDataElasticsearch.imports`文件，其内容就是：
```
# AutoConfigureDataElasticsearch auto-configuration imports
org.springframework.boot.autoconfigure.elasticsearch.ElasticsearchRestClientAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchRepositoriesAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchDataAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRestClientAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRepositoriesAutoConfiguration
```
也就是说，**每个`@AutoConfigure*`注解加载哪些autoconfig类实际上是提前写到`spring-boot-test-autoconfigure`的“配置文件”里的**。

### 不加载其他
**那么是怎么做到只加载这些autoconfig，不加载其他的bean的呢？**

`@DataElasticsearchTest`里还有一个注解`@TypeExcludeFilters(DataElasticsearchTypeExcludeFilter.class)`，它配置了一个`DataElasticsearchTypeExcludeFilter`。这是一个`TypeExcludeFilters`，它会读取`@DataElasticsearchTest`配置的`include`和`exclude`属性：
- **`@DataElasticsearchTest`里配置的`includeFilters`，就是要留下来的配置类**；
- **`@DataElasticsearchTest`里配置的`excludeFilters`，就是要排除的配置类**；
- exclude优先级高于include；

`@DataElasticsearchTest`提供了include/exclude配置属性：
- `Filter[] includeFilters() default {}`
- `Filter[] excludeFilters() default {}`

**默认都为空，所以`@DataElasticsearchTest`没有包含任何配置，即所有的config class都被排除了。**

因此，**最终只有`@AutoConfigure*`里的config class生效了**。对于`@DataElasticsearchTest`，最终起作用的就是上面一大堆elasticsearch的自动配置类。

这样的话，就可以只测elasticsearch相关的东西了！

> 难为springboot了。

**如果想让`@Configuration`标记的config class都被自动扫描到，可以这么设置**：`@DataElasticsearchTest(includeFilters = @ComponentScan.Filter(type = FilterType.ANNOTATION, classes = Configuration.class))`

所以`SpringBootApplication`的`@ComponentScan`是这样的：
```
@ComponentScan(excludeFilters = { @Filter(type = FilterType.CUSTOM, classes = TypeExcludeFilter.class),
		@Filter(type = FilterType.CUSTOM, classes = AutoConfigurationExcludeFilter.class) })
```
- **当`@SpringBootTest`检测到这个注解的时候，因为没有配置任何`TypeExcludeFilter`，所以加载的是整个工程的config class，实例化了所有的bean**；
- **当`@DataElasticsearchTest`检测到这个注解的时候，因为配置了`@TypeExcludeFilters(DataElasticsearchTypeExcludeFilter.class)`，且没有设置include，所以排除掉了所有的bean；又因为配置了`@AutoConfigureDataElasticsearch`，所以最终只加载了elasticsearch相关的bean**。

> `@DataElasticsearchTest`用的是`@BootstrapWith(DataElasticsearchTestContextBootstrapper.class)`，它是`SpringBootTestContextBootstrapper`（`@SpringBootTest` bootstrapwith）的子类！！！它触发`@AutoConfigureDataElasticsearch`代表的一系列自动配置类。

## 不要给`@SpringBootApplication`标注的main class加其他注解
标注了`@SpringBootApplication`的main class不要标注其他注解——

### 不要加用户自己写的`@Component`
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.user-configuration-and-slicing

如果要扫描的package跟默认的不一致，很可能加上一个自定义的`@ComponentScan`：
```
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;

@SpringBootApplication
@ComponentScan({ "com.example.app", "com.example.another" })
public class MyApplication {

    // ...

}
```
这样就覆盖掉了默认的带filter过滤的`@ComponentScan`，就没办法使用slice test了！而是实例化了这个自定义的`@ComponentScan`扫描的所有bean。

> The underlying component scan configuration of @SpringBootApplication defines exclude filters that are used to make sure slicing works as expected. If you are using an explicit @ComponentScan directive on your @SpringBootApplication-annotated class, be aware that those filters will be disabled. If you are using slicing, you should define them again.

所以推荐把自定义的component scan写在其他地方，让默认的`@ComponentScan`扫描到它，再用它扫描自定义的包，对src代码没什么影响：
```
@Configuration
@ComponentScan({ "com.example.app", "com.example.another" })
public class CustomConfig {
    
}
```
对于test代码，因为slice test会禁掉所有的config class，也就扫描不到这个带有自定义`@ComponentScan`的配置类了，所以自定义的`@ComponentScan({ "com.example.app", "com.example.another" })`不会在slice test里生效了！

**结论：不要和`@SpringBootApplication`写在一起！**

### 不要加其他注解
同理，把其他的类似component scan的类和`@SpringBootApplication`写在一起也会有类似的现象。比如加了`@EnableBatchProcessing`，slice test会初始化batch processing相关的bean：
```
@SpringBootApplication
@EnableBatchProcessing
public class MyApplication {

    // ...

}
```
解决方法一样，把这个注解单拉出去。

**结论：不要和`@SpringBootApplication`写在一起！**

### 不侵入src代码
**但是这样算不算测试代码对src代码造成了影响**？如果不想刻意为了测试用例注意这些问题，可以自定义一个`@SpringBootConfiguration`，它啥也没有，就不会初始化任何bean。slice test还是只会初始化配置文件里写的那些autoconfig class里的bean。

> If this is not an option for you, you can create a `@SpringBootConfiguration` somewhere in the hierarchy of your test so that it is used instead. Alternatively, you can specify a source for your test, which disables the behavior of finding a default one.

## 如果slice test自动配置的bean不够用呢？
- https://docs.spring.io/spring-boot/docs/current/reference/html/howto.html#howto.testing.slice-tests

使用`@Import`手动把config class导入到测试类里！

## 如果还想导入其他autoconfig呢？
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.additional-autoconfiguration-and-slicing

比如`witake-spring-boot-autoconfig-xxx`不在slice test自动导入的类的名单里，想导入的话可以可以用`@ImportAutoConfiguration`：
```
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.integration.IntegrationAutoConfiguration;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;

@JdbcTest
@ImportAutoConfiguration(IntegrationAutoConfiguration.class)
class MyJdbcTests {

}
```
**Make sure to not use the regular `@Import` annotation to import auto-configurations as they are handled in a specific way by Spring Boot.**

如果这个autoconfig老是和springboot slice tst的那些autoconfig一起用，直接加入到它的`META-INF/spring/xxx`文件里，配置它的时候一定配置你！

## `@TestConfiguration`
- https://reflectoring.io/spring-boot-testconfiguration/
- https://stackoverflow.com/questions/50607285/spring-boot-testconfiguration-not-overriding-bean-during-integration-test

它也是`@Configuration`，用来偷梁换柱。

> spring test会把它当做一个正常的`@Configuration`（因为spring根本不知道`@TestConfiguration`是啥，只知道`@Configuration`），所以`@TestConfiguration`的static inner class可以[像`@Configuration`的static inner class一样被当做config class](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-ctx-management-javaconfig)。springboot test知道它不是一个正常的`@Configuration`，会在component scan的时候exclude掉它。
>
> 这就是框架堆叠的另一特点：对于上一层的spring来说，`@TestConfiguration`就是`@Configuration`

它的特点：
1. [作为static inner class的注解](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.detecting-configuration)：Unlike a nested `@Configuration` class, which would be used instead of your application’s primary configuration, a nested `@TestConfiguration` class is used in addition to your application’s primary configuration.
2. [作为独立的class的注解](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.excluding-configuration)： When placed on a top-level class, `@TestConfiguration` indicates that classes in `src/test/java` should not be picked up by scanning. You can then import that class explicitly where it is required

**to modify Spring’s application context** during test runtime. We can use it **to override certain bean definitions**, for example 
- to replace real beans with fake beans 
- or to change the configuration of a bean to make it better testable.

> 和spring test一样，springboot的context只加载一次，全局缓存。

# 支持args
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.using-application-arguments

那岂不是可以通过args传入profiles信息了。

# `MockMvc`
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.with-mock-environment

虽然不启动server，但是看起来效果和启动server一样啊？所以是直接在请求线程里执行server的代码了？？？

启动了ApplicationContext所以不需要！确实和[`@WebMvcTest`](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.spring-mvc-tests)不一样，这个是需要mock given的，毕竟没有ApplicationContext，没有service bean。

> @WebMvcTest auto-configures the Spring MVC infrastructure and limits scanned beans to @Controller, @ControllerAdvice, @JsonComponent, Converter, GenericConverter, Filter, HandlerInterceptor, WebMvcConfigurer, WebMvcRegistrations, and HandlerMethodArgumentResolver. Regular @Component and @ConfigurationProperties beans are not scanned when the @WebMvcTest annotation is used. @EnableConfigurationProperties can be used to include @ConfigurationProperties beans.


```
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class MyMockMvcTests {

    @Test
    void testWithMockMvc(@Autowired MockMvc mvc) throws Exception {
        mvc.perform(get("/")).andExpect(status().isOk()).andExpect(content().string("Hello World"));
    }

    // If Spring WebFlux is on the classpath, you can drive MVC tests with a WebTestClient
    @Test
    void testWithWebTestClient(@Autowired WebTestClient webClient) {
        webClient
                .get().uri("/")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("Hello World");
    }

}
```
If you want to focus only on the web layer and not start a complete ApplicationContext, consider using @WebMvcTest instead.

所以MockMvc不会启动server，但和要不要mock given是两码事。如果所有的bean都有了，就不用mock bean了，否则是需要mock的。

Often, @WebMvcTest is limited to a single controller and is used in combination with @MockBean to provide mock implementations for required collaborators.

@WebMvcTest also auto-configures MockMvc. Mock MVC offers a powerful way to quickly test MVC controllers without needing to start a full HTTP server.

```
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(UserVehicleController.class)
class MyControllerTests {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private UserVehicleService userVehicleService;

    @Test
    void testExample() throws Exception {
        given(this.userVehicleService.getVehicleDetails("sboot"))
            .willReturn(new VehicleDetails("Honda", "Civic"));
        this.mvc.perform(get("/sboot/vehicle").accept(MediaType.TEXT_PLAIN))
            .andExpect(status().isOk())
            .andExpect(content().string("Honda Civic"));
    }

}
```

- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.utilities.test-rest-template

Spring Framework 5.0 provides a new WebTestClient that works for WebFlux integration tests and both WebFlux and MVC end-to-end testing. **It provides a fluent API for assertions, unlike TestRestTemplate.**

hhh，来自spring的嫌弃……

# 真正的server

果然，不启动server。默认启动一个mock web environment。If a web environment is not available on your classpath, this mode transparently falls back to creating a regular non-web ApplicationContext

`NONE`：启动的就是ApplicationContext，而非WebServerApplicationContext。

> 我才发现springboot使用的不是WebApplicationContext，而是WebServerApplicationContext。它也是一种特殊的ApplicationContext，能够创建和管理WebServer（tomcat、jetty等）。

哦我懂了，mock的server，client和server的逻辑都是在一个线程里执行的吧！！！



不仅启动server，还自动帮你创建一个已经获取了这个server的ip和port的TestRestTemplate/WebTestClient！贴心啊！For convenience, tests that need to make REST calls to the started server can additionally @Autowire a WebTestClient, which resolves relative links to the running server and comes with a dedicated API for verifying responses, as shown in the following example:

直接注入TestRestTemplate就行了：
```
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.client.TestRestTemplate;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class MyRandomPortTestRestTemplateTests {

    @Test
    void exampleTest(@Autowired TestRestTemplate restTemplate) {
        String body = restTemplate.getForObject("/", String.class);
        assertThat(body).isEqualTo("Hello World");
    }

}
```
如果用了spring-webflux，会直接注入一个client：
```
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.test.web.reactive.server.WebTestClient;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class MyRandomPortWebTestClientTests {

    @Test
    void exampleTest(@Autowired WebTestClient webClient) {
        webClient
            .get().uri("/")
            .exchange()
            .expectStatus().isOk()
            .expectBody(String.class).isEqualTo("Hello World");
    }

}
```

# `@MockBean`
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.mocking-beans

You can use the annotation to add new beans or replace a single existing bean definition. 

它可以直接替换bean！！！在往Reverser里注入RemoteService的时候，注入的是假的service！6啊！这样就可以直接测Reverse了！不需要考虑怎么创建一个拥有假service的Reverser！
```
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

@SpringBootTest
class MyTests {

    @Autowired
    private Reverser reverser;

    @MockBean
    private RemoteService remoteService;

    @Test
    void exampleTest() {
        given(this.remoteService.getValue()).willReturn("spring");
        String reverse = this.reverser.getReverseValue(); // Calls injected RemoteService
        assertThat(reverse).isEqualTo("gnirps");
    }

}
```

所以是先正常创建ApplicationContext，refresh之后，再用mock bean替换真bean的：
> @MockBean cannot be used to mock the behavior of a bean that is exercised during application context refresh. By the time the test is executed, the application context refresh has completed and it is too late to configure the mocked behavior. We recommend using a @Bean method to create and configure the mock in this situation.

还可以用[`@SpyBean`](https://docs.spring.io/spring-boot/docs/2.7.5/api/org/springframework/boot/test/mock/mockito/SpyBean.html)：
Additionally, you can use @SpyBean to wrap any existing bean with a Mockito spy.

艹，感觉用这个比直接裸用mockito方便多了……
果然，spring提供支持之后，是比直接用原生的好用了。（废话，要不然支持了个寂寞）

# 改Environment的property
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.utilities.test-property-values

# capture from stdout/stderr
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.utilities.output-capture


test
- https://spring.io/guides/gs/testing-web/



