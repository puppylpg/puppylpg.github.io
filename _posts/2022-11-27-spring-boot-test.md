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
spring test提供了`@BootstrapWith`注解，可以让第三方框架使用自己的`TestContextBootstrapper`构建`TestContext`。springboot就实现了这样一个注解`SpringBootTestContextBootstrapper`，只要标注`@BootstrapWith(SpringBootTestContextBootstrapper.class)`，就能以springboot的方式构建自己的`ApplicationContext`。

正如spring test的`@SpringJunitConfig`注解集成了`@ContextConfiguration`一样，springboot test提供了一堆集成了`@BootstrapWith(SpringBootTestContextBootstrapper.class)`的注解`@*Test`，`@SpringBootTest`就是其中最常用的一个。

> 和spring test一样，springboot的context只加载一次，全局缓存。

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

> 比较特殊的情况是，如果一个工程是纯lib项目，src里没有启动类，此时如果想用springboot test测这个包，那么test代码里就要写一堆configuration class，再写上一个`@SpingBootApplication`启动类，以进行自动配置。

## 为什么是`@SpringBootConfiguration`
它其实就是`@Configuration`的alias，对spring和springboot来说，它其实就是一个普通的spring `@Configuration`，**只有springboot test对它提供了额外支持**。所以只有在springboot test里它才有点儿高于`@Configuration`的额外作用：
1. springboot test先找`@SpringBootConfiguration`；
2. 再找它关联的config class；
3. **这些config class就是最终构建`ApplicationContext`时用到的config class**。

这个过程体现在`SpringBootTestContextBootstrapper`里，找的方式是：
```java
Class<?> found = new AnnotatedClassFinder(SpringBootConfiguration.class)
		.findFromClass(mergedConfig.getTestClass());
```
`AnnotatedClassFinder#findFromClass`的Javadoc说了：Find the first Class that is annotated with the target annotation, **starting from the package defined by the given source up to the root，所以是向上找。**

找到`@SpingBootApplication`之后，**它默认是带`@ComponentScan`的**，所以scan的那些包里的配置也都找到了！和springboot一样的配置就都来了！ (o゜▽゜)o☆[BINGO!]

但是，**`@SpingBootApplication`带的这个`@ComponentScan`不是一个普通的`@ComponentScan`**，它其实是：
```java
@ComponentScan(excludeFilters = { @Filter(type = FilterType.CUSTOM, classes = TypeExcludeFilter.class),
		@Filter(type = FilterType.CUSTOM, classes = AutoConfigurationExcludeFilter.class) })
```
它已经指定了`excludeFilters`：**默认不会去scan这些exclude filter指定的类**。

一共有两个exclude filter：
- 第二个是名为auto configuration的exclude filter，所以它明显是为了排除掉`@EnableAutoConfiguration`配置的bean。但是因为`@SpingBootApplication`里额外加上了`@EnableAutoConfiguration`了，所以这些被`@ComponentScan`故意遗漏的bean又被`@EnableAutoConfiguration`加回来了。**为什么这么做？为了后面要介绍的slice test。springboot更倾向于slice test，所以不一次性配置所有的autoconfig，而选择只配置某一slice的autoconfig（加上哪个autoconfig注解，就只配置那个autoconfig）**；
- 第一个filter干嘛的？Javadoc提了一下：They are primarily used internally to `support spring-boot-test`。**它是特意为springboot test准备的。为了支持springboot的“部分测试”（slice test）**。它会排除掉springboot test里指定的一些`TypeExcludeFilter`。对于`@SpingBootApplication`，它没有指定任何`TypeExcludeFilter`。

所以，**实际上对于使用`@SpingBootApplication`的src代码来说，没有exclude掉任何bean。效果相当于没加任何东西的正常的`@ComponentScan`**。但是对于slice test，则不会加载所有的配置。

# slice test
springboot test的`@SpringBootTest`是众多`@*Test`里最特殊的一个，会加载整个app里所有的配置。除此之外，springboot test支持 **只加载某一部分config，只测试某一部分代码**。springboot test称之为[slice test](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.autoconfigured-tests)。

> For example, you might want to test that Spring MVC controllers are mapping URLs correctly, and you do not want to involve database calls in those tests, or you might want to test JPA entities, and you are not interested in the web layer when those tests run.
>
> The `spring-boot-test-autoconfigure` module includes a number of annotations that can be used to automatically configure such “slices”. Each of them works in a similar way, providing a `@…Test` annotation that loads the `ApplicationContext` and one or more `@AutoConfigure…` annotations that can be used to customize auto-configuration settings.

**除了`@SpringBootTest`的其他`@*Test`都是做slice test的**，他们和`@SpringBootTest`如出一辙。**一个测试类只能用他们中的一个**，如果需要用其他slice的autoconfig，可以导入那个slice对应的`@*Test`里的`@AutoConfigure…`注解。

> Including multiple “slices” by using several `@…Test` annotations in one test is not supported. If you need multiple “slices”, pick one of the `@…Test` annotations and include the `@AutoConfigure…` annotations of the other “slices” by hand.

如果根本不在乎只加载app的slice config，就用`@SpringBootTest`。但是依然可以加上`@AutoConfigure…`，只是用他们自动配置一些bean，取得一些便利。

> It is also possible to use the `@AutoConfigure…` annotations with the standard `@SpringBootTest` annotation. You can use this combination if you are not interested in “slicing” your application but you want some of the auto-configured test beans.

这些只关注slice的`@*Test`都配置了啥？除了从代码里找，还可以来这里找：
- https://docs.spring.io/spring-boot/docs/current/reference/html/test-auto-configuration.html#appendix.test-auto-configuration

## 怎么做到的？
以`@DataElasticsearchTest`为例，他做的是spring-data-elasticsearch的slice test：
```java
@DataElasticsearchTest
class MyDataElasticsearchTests {

    @Autowired
    private SomeRepository repository;

    // ...

}
```
它只加载了以下autoconfig的类：
```java
// cache相关
org.springframework.boot.autoconfigure.cache.CacheAutoConfiguration

// elasticsearch相关
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchDataAutoConfiguration 
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchRepositoriesAutoConfiguration 
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRepositoriesAutoConfiguration 
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRestClientAutoConfiguration 
org.springframework.boot.autoconfigure.elasticsearch.ElasticsearchRestClientAutoConfiguration
```
所以使用这个注解就 **只做elasticsearch、spring-data-elasticsearch相关的autoconfig**。

想知道怎么做到只加载这些autoconfig，不加载其他autoconfig，需要看一下它的注解：
```java
@BootstrapWith(DataElasticsearchTestContextBootstrapper.class)
@ExtendWith(SpringExtension.class)
@OverrideAutoConfiguration(enabled = false)
@TypeExcludeFilters(DataElasticsearchTypeExcludeFilter.class)
@AutoConfigureCache
@AutoConfigureDataElasticsearch
@ImportAutoConfiguration
public @interface DataElasticsearchTest {
```

### 要加载这些
“要加载哪些autoconfig”，是通过它带的`@AutoConfigureDataElasticsearch`和`@AutoConfigureCache`注解做到的：

以`@AutoConfigureDataElasticsearch`为例：
```java
@ImportAutoConfiguration
public @interface AutoConfigureDataElasticsearch {
```
它标注了一个注解`@ImportAutoConfiguration`。该注解的javadoc（springboot 2.7.5）：
> The auto-configuration classes that should be imported. **When empty, the classes are specified using a file in `META-INF/spring` where the file name is the fully-qualified name of the annotated class, suffixed with `'.imports'`**.

标注它的类是`org.springframework.boot.test.autoconfigure.data.elasticsearch.AutoConfigureDataElasticsearch`，所以根据javadoc，**它导入的autoconfig类，就是`META-INF/spring`下的`org.springframework.boot.test.autoconfigure.data.elasticsearch.AutoConfigureDataElasticsearch.imports`文件**，其内容就是：
```java
# AutoConfigureDataElasticsearch auto-configuration imports
org.springframework.boot.autoconfigure.elasticsearch.ElasticsearchRestClientAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchRepositoriesAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchDataAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRestClientAutoConfiguration
org.springframework.boot.autoconfigure.data.elasticsearch.ReactiveElasticsearchRepositoriesAutoConfiguration
```
也就是说，**每个`@AutoConfigure*`注解加载哪些autoconfig类实际上是提前写到`spring-boot-test-autoconfigure`的“配置文件”里的**。

> springboot 2.5.5的记录默认导入的autoconfig类的配置文件还没有`.import`后缀。所以这个约定其实也在变动。因此直接用别人的test autoconfig就行了，不用太深究。

同理，`@AutoConfigureCache`也导入了一个autoconfig类`org.springframework.boot.autoconfigure.cache.CacheAutoConfiguration`，两个autoconfig合在一起，就是上面记录的所有导入的autoconfig类。

### 不加载其他
**那么是怎么做到不加载其他的autoconfig呢？**

还得看`@SpingBootApplication`带的这个`@ComponentScan`：
```java
@ComponentScan(excludeFilters = { @Filter(type = FilterType.CUSTOM, classes = TypeExcludeFilter.class),
		@Filter(type = FilterType.CUSTOM, classes = AutoConfigurationExcludeFilter.class) })
```
**它不扫描指定的`TypeExcludeFilter`，所以`@DataElasticsearchTest`就指定了一个`TypeExcludeFilter`：`@TypeExcludeFilters(DataElasticsearchTypeExcludeFilter.class)`**。

`DataElasticsearchTypeExcludeFilter`是一个`TypeExcludeFilters`，**它会读取`@DataElasticsearchTest`配置的`include`和`exclude`属性**（这是一个能让用户自定义include/exclude的filter，还挺智能）：
- **`@DataElasticsearchTest`里配置的`includeFilters`，就是要留下来的配置类**；
- **`@DataElasticsearchTest`里配置的`excludeFilters`，就是要排除的配置类**；
- exclude优先级高于include；

`@DataElasticsearchTest`提供了include/exclude配置属性：
- `Filter[] includeFilters() default {}`
- `Filter[] excludeFilters() default {}`

**默认都为空，所以`@DataElasticsearchTest`没有包含任何配置，即所有的config class都被排除了。**

因此，**最终只有`@AutoConfigureCache`和`@AutoConfigureDataElasticsearch`里引入的autoconfig class生效了**。对于`@DataElasticsearchTest`，最终起作用的就是上面一大堆elasticsearch的自动配置类。

这样的话，就可以只测elasticsearch相关的东西了！

> 难为springboot了。

**如果想让`@Configuration`标记的config class都被自动扫描到，把它include进来就行了**：`@DataElasticsearchTest(includeFilters = @ComponentScan.Filter(type = FilterType.ANNOTATION, classes = Configuration.class))`。

## 特殊的`@SpringBootTest`
```java
@BootstrapWith(SpringBootTestContextBootstrapper.class)
@ExtendWith(SpringExtension.class)
public @interface SpringBootTest {
```
虽然都属于`@*Test`，**但是因为`@SpringBootTest`没有配置任何`TypeExcludeFilter`，所以成为了最特殊的那一个（会加载所有autoconfig）**。在`@SpringBootApplication`的`@ComponentScan`扫描的时候：
- **检测到`@SpringBootTest`，因为没有配置任何`TypeExcludeFilter`，所以加载的是整个工程的autoconfig class，实例化了所有可autoconfig的bean**；
- **检测到`@DataElasticsearchTest`，因为配置了`@TypeExcludeFilters(DataElasticsearchTypeExcludeFilter.class)`，且没有设置include，所以排除掉了所有的bean；又因为配置了`@AutoConfigureDataElasticsearch`，所以最终只加载了elasticsearch相关的bean**。

> `@DataElasticsearchTest`用的是`@BootstrapWith(DataElasticsearchTestContextBootstrapper.class)`，它是`SpringBootTestContextBootstrapper`（`@SpringBootTest` bootstrapwith）的子类！！！它触发`@AutoConfigureDataElasticsearch`代表的一系列自动配置类。

## 不要给`@SpringBootApplication`标注的class加其他注解
标注了`@SpringBootApplication`的class不要标注其他注解——

### 不要加用户自己写的`@Component`
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.user-configuration-and-slicing

如果要扫描的package跟默认的不一致，很可能加上一个自定义的`@ComponentScan`：
```java
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;

@SpringBootApplication
@ComponentScan({ "com.example.app", "com.example.another" })
public class MyApplication {

    // ...

}
```
这个自定义的`@ComponentScan`扫描到的所有bean都一定会被实例化出来。**不仅如此，因为它没有exclude `TypeExcludeFilter`，`@*Test`注解带上的那些`TypeExcludeFilter`都会被无视，相当于所有的autoconfig class都会被启用**。

> The underlying component scan configuration of `@SpringBootApplication` defines exclude filters that are used to make sure slicing works as expected. If you are using an explicit `@ComponentScan` directive on your `@SpringBootApplication`-annotated class, **be aware that those filters will be disabled. If you are using slicing, you should define them again.**

所以推荐把自定义的component scan写在其他地方，让默认的`@ComponentScan`扫描到它，再用它扫描自定义的包，对src代码没什么影响：
```java
@Configuration
@ComponentScan({ "com.example.app", "com.example.another" })
public class CustomConfig {
    
}
```
**对于test代码，区别可就大了**：因为slice test会禁掉所有的config class，也就扫描不到这个带有自定义`@ComponentScan`的配置类了，所以自定义的`@ComponentScan({ "com.example.app", "com.example.another" })`不会在slice test里生效了！

**结论：不要和`@SpringBootApplication`写在一起！**

### 不要加其他注解
同理，把其他的类似component scan的类和`@SpringBootApplication`写在一起也会有类似的现象。比如加了`@EnableBatchProcessing`，slice test会初始化batch processing相关的bean：
```java
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

比如`@WebMvcTest`默认只配置mvc相关的bean，不配置service bean，可以使用`@Import`手动把service bean的config class导入到测试类里！

## 如果还想导入其他autoconfig class呢？
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.additional-autoconfiguration-and-slicing

比如一个自定义的`xxx-spring-boot-autoconfig-xxx`不在slice test自动导入的类的名单里，想导入的话可以可以用`@ImportAutoConfiguration`：
```java
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.integration.IntegrationAutoConfiguration;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;

@JdbcTest
@ImportAutoConfiguration(IntegrationAutoConfiguration.class)
class MyJdbcTests {

}
```
**Make sure to not use the regular `@Import` annotation to import auto-configurations as they are handled in a specific way by Spring Boot.**

如果这个autoconfig老是和springboot slice test的那些autoconfig一起用，直接加入到它的`META-INF/spring/xxx`文件里，配置它的时候一定配置你！

# `@TestConfiguration` - 偷梁换柱

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Configuration
@TestComponent
public @interface TestConfiguration {
```
它是`@Configuration`的alias，所以spring test会把它当做一个正常的`@Configuration`（因为spring根本不知道`@TestConfiguration`是啥，只知道`@Configuration`），所以`@TestConfiguration`的static inner class可以[像`@Configuration`的static inner class一样被当做config class](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-ctx-management-javaconfig)。**springboot test对它做了额外支持**，所以只有在springboot test里，它才不是一个正常的`@Configuration`。

> 这就是框架堆叠的另一特点：对于上一层的spring来说，`@TestConfiguration`就是`@Configuration`

## springboot test对它做了什么支持？
在`SpringBootTestContextBootstrapper`里：
```java
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
- **如果没有指定config class**，则以springboot的方式探测config class：从当前test class找带`@SpringBootConfiguration`的类，把它作为config class。当然如果它component scan了，scan的config class也算。
- 如果指定了config class：**如果指定的config class全都标记了`@TestConfiguration`注解，会继续以springboot的方式探测config class**。这也就是`@TestConfiguration`的javadoc说的，**以`@TestConfiguration`的方式手动提供config，不会阻止springboot autoscan**：Unlike regular `@Configuration` classes the use of `@TestConfiguration` does not prevent auto-detection of `@SpringBootConfiguration`。**最终指定的所有`@TestConfiguration`标记的config class会和`@SpringBootConfiguration`探测到的config class合并**！
- 如果指定了config class，且指定的config class并非都是`@TestConfiguration`标记的类，那么就不再自动探测`@SpringBootConfiguration`。相当于尊重spring的决定，以spring的方式配置test config。

> **怎么指定config class？以spring test的方式指定啊**！springboot test只是在spring test的基础上实现的。

所以`@TestConfiguration`的特殊之处在于，即使以spring test的方式指定它为config class（即：把它[作为测试类的static inner class的注解](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.detecting-configuration)），仍然不耽误继续以springboot的方式探测test class。

> Unlike a nested `@Configuration` class, which would be used instead of your application's primary configuration, a nested `@TestConfiguration` class is used in addition to your application's primary configuration.

另外，官方文档和[这里](https://stackoverflow.com/a/50643036/7676237)都说[作为独立的class的注解](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.excluding-configuration)，该class它不会被扫描到，需要手动`@Import`。但是从代码上我确实没看到有关于这一点的支持，权且记在这里┓( ´∀` )┏

> When placed on a top-level class, `@TestConfiguration` indicates that classes in `src/test/java` should not be picked up by scanning. You can then import that class explicitly where it is required

**所以`@TestConfiguration`的主要作用就是偷梁换bean**。在[这里](https://reflectoring.io/spring-boot-testconfiguration/)举了一个使用`@TestConfiguration`标注的web client替代代码里真正的web client的例子。毕竟做集成测试的时候，不可能用真正的web client，那相当于依赖外部了。

# 支持args
可以在测试的时候直接[指定命令行参数](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.using-application-arguments)：
```java
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(args = "--app.test=one")
class MyApplicationArgumentTests {

    @Test
    void applicationArgumentsPopulated(@Autowired ApplicationArguments args) {
        assertThat(args.getOptionNames()).containsOnly("app.test");
        assertThat(args.getOptionValues("app.test")).containsOnly("one");
    }

}
```
那岂不是可以通过args传入profiles信息了。

# `@SpringBootTest`
`@SpringBootTest`因为会扫描所有的autoconfig class，所以默认会构建一个完整的`ApplicationContext`！但是，由于[Spring Mvc Test - MockMvc]({% post_url 2022-11-26-spring-mvc-test %})能在不启动server的情况下，单线程测试spring mvc，**所以`@SpringBootTest`在默认情况下虽然构建了完整的 `ApplicationContext`，[依然使用`MockMvc`执行servlet，而非真启动一个server](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.with-mock-environment)**：
```java
WebEnvironment webEnvironment() default WebEnvironment.MOCK
```

> **Creates a `WebApplicationContext` with a mock servlet environment if servlet APIs are on the classpath**, a `ReactiveWebApplicationContext` if Spring WebFlux is on the classpath or a regular `ApplicationContext` otherwise.

如果要真启动一个server，需要配置：`@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)`。

## `MockMvc`
springboot test在两种情况下都会使用`MockMvc`：
1. `@WebMvcTest`：做mvc相关的slice test；
2. `@SpringBootTest`：加载app完整的bean到`ApplicationContext`，但依然使用`MockMvc`单线程执行`DispatcherServlet`；

但是二者还是有区别的：**使用[`@WebMvcTest`](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.spring-mvc-tests)只会检测mvc相关的autoconfig class，所以不会实例化service bean、data layer bean，如果想测试的话需要手动mock，写given**。`@SpringBootTest`启动了完整的`ApplicationContext`，所以实例化了service bean，data layer bean，可以直接注入，不需要mock！

> **`@WebMvcTest` auto-configures the Spring MVC infrastructure and limits scanned beans to `@Controller`, `@ControllerAdvice`, `@JsonComponent`, Converter, GenericConverter, Filter, HandlerInterceptor, WebMvcConfigurer, WebMvcRegistrations, and HandlerMethodArgumentResolver**. Regular `@Component` and `@ConfigurationProperties` beans are not scanned when the `@WebMvcTest` annotation is used. `@EnableConfigurationProperties` can be used to include `@ConfigurationProperties` beans.
>
> If you want to focus only on the web layer and not start a complete `ApplicationContext`, consider using `@WebMvcTest` instead.

所以`@SpringBootTest`默认也可以注入`MockMvc`：
```java
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

> MockMvc只是不会启动server，和要不要mock bean是两码事。如果所有的bean都有了，就不用mock bean了，否则是需要mock的。就算所有bean都有了，有时候为了在测试的时候换成另一个实现，依然会mock bean。

## 启动真正的server
配置`@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)`会[真正启动一个server](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.with-running-server)，前提是classpath上得有servlet：
> If a web environment is not available on your classpath, this mode transparently falls back to creating a regular non-web `ApplicationContext`

如果springboot工程根本不是web，也可以显式指定`NONE`：启动的就是`ApplicationContext`，而非`WebServerApplicationContext`。当然不指定默认也都会启动非web的`ApplicationContext`，和springboot的启动流程一样。

> 我才发现springboot使用的不`是WebApplicationContext`，而是`WebServerApplicationContext`。它也是一种特殊的`ApplicationContext`，能够创建和管理`WebServer`（tomcat、jetty等）。

### `TestRestTemplate`
不仅启动server，springboot test还自动帮你创建一个已经获取了这个server的ip和port的[`TestRestTemplate`](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.utilities.test-rest-template)/`WebTestClient`！贴心啊！

> For convenience, tests that need to make REST calls to the started server can additionally `@Autowire` a `WebTestClient`, which resolves relative links to the running server and comes with a dedicated API for verifying responses, as shown in the following example:

直接注入`TestRestTemplate`就行了：
```java
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
```java
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

看起来spring更推崇webflux，后面学一下：
> Spring Framework 5.0 provides a new `WebTestClient` that works for WebFlux integration tests and both WebFlux and MVC end-to-end testing. **It provides a fluent API for assertions, unlike `TestRestTemplate`.**

hhh，来自spring的嫌弃……

# `@MockBean`
mock bean一般发生在两种情况下：
1. **没有bean**：比如使用`@WebMvcTest`的时候，service bean需要mock；
2. **替换bean**：比如使用真实的bean模拟一个failure会很难复现，可以mock一个bean替换掉它；

> Often, `@WebMvcTest` is limited to a single controller and is used in combination with `@MockBean` to provide mock implementations for required collaborators.

[`@MockBean`](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.spring-boot-applications.mocking-beans)是springboot test提供的一个对mockito的支持。感觉像testcontainers的`@Container`一样，为mock bean提供了一些便利。直接mock就相当于`@Autowired`了一个bean，不过given还是免不了：
```java
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
**最主要是它可以直接替换bean**：
> You can use the annotation to add new beans or replace a single existing bean definition. 

比如下面的场景：在往Reverser里注入RemoteService的时候，注入的是假的service！这样就可以直接测Reverse了！不需要考虑怎么创建一个拥有假service的Reverser！
```java
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
**它的原理是先正常创建`ApplicationContext`，refresh之后，再用mock bean替换真bean**：
> `@MockBean` cannot be used to mock the behavior of a bean that is exercised during application context refresh. By the time the test is executed, the application context refresh has completed and it is too late to configure the mocked behavior. We recommend using a `@Bean` method to create and configure the mock in this situation.

还可以用[`@SpyBean`](https://docs.spring.io/spring-boot/docs/2.7.5/api/org/springframework/boot/test/mock/mockito/SpyBean.html)：

> Additionally, you can use `@SpyBean` to wrap any existing bean with a Mockito spy.

感觉用这个比直接裸用mockito方便多了，spring提供支持之后，是比直接用原生的好用了。（废话，要不然支持了个寂寞）

# `TestPropertyValues` - 魔改property
使用[`TestPropertyValues`](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.utilities.test-property-values)快速魔改environment的property，非常方便：
```java
import org.junit.jupiter.api.Test;

import org.springframework.boot.test.util.TestPropertyValues;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;

class MyEnvironmentTests {

    @Test
    void testPropertySources() {
        MockEnvironment environment = new MockEnvironment();
        TestPropertyValues.of("org=Spring", "name=Boot").applyTo(environment);
        assertThat(environment.getProperty("name")).isEqualTo("Boot");
    }

}
```

# `OutputCapture` - capture from stdout/stderr
使用[`OutputCapture`](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.testing.utilities.output-capture)不过stdout/stderr的输出，并拿来做断言，很强大！

```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class MyOutputCaptureTests {

    @Test
    void testName(CapturedOutput output) {
        System.out.println("Hello World!");
        assertThat(output).contains("World");
    }

}
```

# springboot测试的层次
参考：
- 代码：https://github.com/puppylpg/spring-boot-testing-strategies
- 非常好的blog：https://thepracticaldeveloper.com/guide-spring-boot-controller-tests/

基于以上springboot test的知识，springboot有四个层次的测试：
1. mock mvc manually：**手动构建`MockMvc`，没有使用spring构建`MockMvc`。任何其他mvc组件（filter、controller advice）如果想用，都得自己手动组装**。当然也不含任何service；
2. only `MockMvc`（slice test）：使用spring配置的`MockMvc`，但是也使用`ApplicationContext`，所以能给controller注入各种filter、controller advice。**但只有mvc相关的bean，没有service bean**；
3. `@SpringBootTest` full test but `MockMvc`（`@SpringBootTest`）：还是`MockMvc`，但是已经使用了springboot的完整配置初始化了所有的bean。有`ApplicationContext`，给controller注入各种filter、controller advice，**而且有service bean**；
4. `@SpringBootTest` full server test(without `MockMvc`)：也是使用完整的springboot配置，但是不再使用`MockMvc`，而是启动真正的server。此时需要用`TestRestTemplate`作为client发送http请求进行测试；

**当然，无论哪一种，都可以使用`@MockBean` mock service bean。即使启用完整的springboot，有了真实的service bean，也可以用`@MockBean`使用mock的service bean替换掉真的service bean**。

## mock mvc manually
`MockMvc`要自己手动构建、组装。
```java
@ExtendWith(MockitoExtension.class)
public class SuperHeroControllerMockMvcStandaloneTest {

    private MockMvc mvc;

    @Mock
    private SuperHeroRepository superHeroRepository;

    @InjectMocks
    private SuperHeroController superHeroController;

    /**
     * This object will be magically initialized by the {@link JacksonTester#initFields(Object, ObjectMapper)} method below.
     */
    private JacksonTester<SuperHero> jsonSuperHero;

    @BeforeEach
    public void setup() {
        // We would need this line if we would not use the MockitoExtension
        // MockitoAnnotations.initMocks(this);
        // Here we can't use @AutoConfigureJsonTesters because there isn't a Spring context
        JacksonTester.initFields(this, new ObjectMapper());
        // MockMvc standalone approach
        mvc = MockMvcBuilders.standaloneSetup(superHeroController)
                .setControllerAdvice(new SuperHeroExceptionHandler())
                .addFilters(new SuperHeroFilter())
                .build();
    }

    @Test
    public void canRetrieveByIdWhenExists() throws Exception {
        // given
        given(superHeroRepository.getSuperHero(2))
                .willReturn(new SuperHero("Rob", "Mannon", "RobotMan"));

        // when
        MockHttpServletResponse response = mvc.perform(
                get("/superheroes/2")
                        .accept(MediaType.APPLICATION_JSON))
                .andReturn().getResponse();

        // then
        assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.getContentAsString()).isEqualTo(
                jsonSuperHero.write(new SuperHero("Rob", "Mannon", "RobotMan")).getJson()
        );
    }
}
```

## only mock mvc
使用springboot构建`MockMvc`，这个时候mvc的组件也自动组装好了，我们直接用就行了。但是只有mvc相关的bean被实例化了，其他bean（service、repository）没有。
```java
@AutoConfigureJsonTesters
@WebMvcTest(SuperHeroController.class)
public class SuperHeroControllerMockMvcWithContextTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private SuperHeroRepository superHeroRepository;

    /**
     * This object will be initialized thanks to {@link AutoConfigureJsonTesters}
     */
    @Autowired
    private JacksonTester<SuperHero> jsonSuperHero;

    @Test
    public void canRetrieveByIdWhenExists() throws Exception {
        // given
        given(superHeroRepository.getSuperHero(2))
                .willReturn(new SuperHero("Rob", "Mannon", "RobotMan"));

        // when
        MockHttpServletResponse response = mvc.perform(
                get("/superheroes/2")
                        .accept(MediaType.APPLICATION_JSON))
                .andReturn().getResponse();

        // then
        assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.getContentAsString()).isEqualTo(
                jsonSuperHero.write(new SuperHero("Rob", "Mannon", "RobotMan")).getJson()
        );
    }
}
```

## springboot full test mock mvc
虽然还是`MockMvc`，但是已经是完整的springboot `ApplicationContext`了，各种bean都有了。当然如果想替换掉真实的service bean，依然可以使用`@MockBean`。
```java
@AutoConfigureJsonTesters
@SpringBootTest
@AutoConfigureMockMvc
public class SuperHeroControllerSpringBootMockTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private SuperHeroRepository superHeroRepository;

    /**
     * This object will be initialized thanks to {@link AutoConfigureJsonTesters}
     */
    @Autowired
    private JacksonTester<SuperHero> jsonSuperHero;

    @Test
    public void canRetrieveByIdWhenExists() throws Exception {
        // given
        given(superHeroRepository.getSuperHero(2))
                .willReturn(new SuperHero("Rob", "Mannon", "RobotMan"));

        // when
        MockHttpServletResponse response = mvc.perform(
                get("/superheroes/2")
                        .accept(MediaType.APPLICATION_JSON))
                .andReturn().getResponse();

        // then
        assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.getContentAsString()).isEqualTo(
                jsonSuperHero.write(new SuperHero("Rob", "Mannon", "RobotMan")).getJson()
        );
    }
}
```

## springboot full server test
同样是完整的springboot `ApplicationContext`，各种bean都有，但不使用`MockMvc`，真实启动server。此时只能使用client去测试了。
```java
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
public class SuperHeroControllerSpringBootTest {

    /**
     * you can still mock beans and replace them in the context
     */
    @MockBean
    private SuperHeroRepository superHeroRepository;

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    public void canRetrieveByIdWhenExists() {
        // given
        given(superHeroRepository.getSuperHero(2))
                .willReturn(new SuperHero("Rob", "Mannon", "RobotMan"));

        // when
        ResponseEntity<SuperHero> superHeroResponse = restTemplate.getForEntity("/superheroes/2", SuperHero.class);

        // then
        assertThat(superHeroResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(superHeroResponse.getBody().equals(new SuperHero("Rob", "Mannon", "RobotMan")));
    }
}
```

# 感想
太难了……终于看懂springboot test了。看完spring test之后，再看springboot test一切都豁然开朗了！所以千层饼不能心急，得一层一层吃。

