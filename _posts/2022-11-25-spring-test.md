---
layout: post
title: "Spring Test - Spring TestContext Framework"
date: 2022-11-25 20:44:59 +0800
categories: spring test
tags: spring test
---

快半年了，从第一次看spring test到现在，中间兜兜转转又做了一大堆事，补充了一大堆知识，现在回头再看，一切终于豁然开朗了！

1. Table of Contents, ordered
{:toc}

[Spring TestContext Framework](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-framework)是spring test的核心，支持junit4/5/TestNG。以jupiter为例，它借助jupiter提供的测试生命周期回调函数，**构建了spring的`ApplicationContext`，用于bean的维护和注入**。

# Spring TestContext Framework的抽象
框架的核心是：
- `TestContextManager`
- `TestContext`
- `TestExecutionListener`
- `SmartContextLoader`

## test instance
测试之前首先要了解[test instance](https://www.baeldung.com/junit-testinstance-annotation)，它是测试框架提供的概念。

比如jupiter里，**默认情况下，每次执行一个test method都会新建一个test class的实例**。这样测试方法之间就不会互相干扰（**所以测试类的不同测试方法之间不必考虑线程安全**，比如test method可以修改类变量）。这种行为默认对应`@TestInstance(Lifecycle.PER_METHOD)`。

但是也可以使用`@TestInstance(Lifecycle.PER_CLASS)`，让所有的test method共用一个test class instance：
1. 可以让各个test method之间共享类变量；
2. 可以让`@BeforeAll`标注在非static方法上，给非static类变量赋值；

> 默认行为里，`@BeforeAll`是要标注在static方法上的。

## `TestContext`
**和一个test instance绑定**，用于保存测试所需要的context，提供：
- context management
- caching support

**它使用`SmartContextLoader`加载`ApplicationContext`**。

它的核心方法就是获取`ApplicationContext`：
- `getApplicationContext`

此外还有一些感知测试用例信息的方法，比如`getTestMethod/Class/Instance`等。

**它不是`ApplicationContext`，它持有`ApplicationContext`。看起来它像是一个为了能让测试代码独立于测试框架（agnostic of the actual testing framework in use）而做的一个套壳的context。**

## `TestContextManager`
spring test的核心类，内部维护一个`TestContext`。负责：
- **使用`TestContextBootstrapper`加载这个`TestContext`**；
- 维护它的状态变化；
- 在特定的执行阶段触发特定的`TestExecutionListener`，**提供依赖注入、事务管理等重要功能**；

> A `TestContextManager` is created for each test class (for example, for the execution of all test methods within a single test class in JUnit Jupiter). The `TestContextManager`, in turn, manages a `TestContext` that holds the context of the current test. The `TestContextManager` also updates the state of the `TestContext` as the test progresses and **delegates to `TestExecutionListener` implementations, which instrument the actual test execution by providing dependency injection, managing transactions, and so on**

这些listener有的是在jupiter的生命周期被调用，比如：
- before all
- before each
- after each
- after all

有的则是spring test自己加的测试生命周期：
- before execution：在before each之后，test method执行之前；
- after execution：在test method执行之后，after each之前；

### 加载`TestContext` - `TestContextBootstrapper`
`TestContextManager`要负责加载`TestContext`。

千层饼模式开启：
1. junit框架：**jupiter向基于自己的使用者提供了`@ExtendWith`注解**，加载它提供的拓展类；
2. spring：作为junit框架使用者，写一个自己的`@ExtentWith`实现，也就是`SpringExtension`类，读取自己关心的注解比如`@ContextConfiguration`，控制spring容器的启动和关闭；
3. **spring又向基于自己的使用者提供了`@BootstrapWith`**，使用它提供的bootstrap实现构建`TestContext`；
4. springboot：spring的小弟，**基于此提供了`TestContextBootstrapper`的实现类`SpringBootTestContextBootstrapper`，构建属于springboot的context**。`@SpringBootTest`注解其实就是`@BootstrapWith(SpringBootTestContextBootstrapper.class)` + `@ExtendWith(SpringExtension.class)`；
5. 程序猿：作为springboot使用者，写自己的测试代码，使用`@SpringBootTest`，也可能会手动添加上`@ContextConfiguration`等；

> 又是一通站在前人的肩膀上┓( ´∀` )┏

加载`TestContext`时，**如果没有通过`@BootstrapWith`指定自定义的加载类，就使用spring test默认的`DefaultTestContextBootstrapper`或`WebTestContextBootstrapper`进行加载；否则使用指定的`TestContextBootstrapper`加载**：
```java
    static TestContextBootstrapper resolveTestContextBootstrapper(BootstrapContext bootstrapContext) {
		Class<?> testClass = bootstrapContext.getTestClass();

		Class<?> clazz = null;
		try {
			clazz = resolveExplicitTestContextBootstrapper(testClass);
			if (clazz == null) {
				clazz = resolveDefaultTestContextBootstrapper(testClass);
			}
			if (logger.isDebugEnabled()) {
				logger.debug(String.format("Instantiating TestContextBootstrapper for test class [%s] from class [%s]",
						testClass.getName(), clazz.getName()));
			}
			TestContextBootstrapper testContextBootstrapper =
					BeanUtils.instantiateClass(clazz, TestContextBootstrapper.class);
			testContextBootstrapper.setBootstrapContext(bootstrapContext);
			return testContextBootstrapper;
		}
		catch (IllegalStateException ex) {
			throw ex;
		}
		catch (Throwable ex) {
			throw new IllegalStateException("Could not load TestContextBootstrapper [" + clazz +
					"]. Specify @BootstrapWith's 'value' attribute or make the default bootstrapper class available.",
					ex);
		}
	}
```
**所以这里会处理`@BootstrapWith`注解**：
```java
	private static Class<?> resolveExplicitTestContextBootstrapper(Class<?> testClass) {
		Set<BootstrapWith> annotations = new LinkedHashSet<>();
		AnnotationDescriptor<BootstrapWith> descriptor =
				TestContextAnnotationUtils.findAnnotationDescriptor(testClass, BootstrapWith.class);
		while (descriptor != null) {
			annotations.addAll(descriptor.findAllLocalMergedAnnotations());
			descriptor = descriptor.next();
		}

		if (annotations.isEmpty()) {
			return null;
		}
		if (annotations.size() == 1) {
			return annotations.iterator().next().value();
		}

		// Allow directly-present annotation to override annotations that are meta-present.
		BootstrapWith bootstrapWith = testClass.getDeclaredAnnotation(BootstrapWith.class);
		if (bootstrapWith != null) {
			return bootstrapWith.value();
		}

		throw new IllegalStateException(String.format(
				"Configuration error: found multiple declarations of @BootstrapWith for test class [%s]: %s",
				testClass.getName(), annotations));
	}
```

### 触发`TestExecutionListener`
**`TestContextManager`的另一个重要功能是在jupiter的各个阶段调用相关listener**。调用由实现了jupiter生命周期接口的`SpringExtension`触发。

比如在before all阶段触发相关listener：
```java
	public void beforeTestClass() throws Exception {
		Class<?> testClass = getTestContext().getTestClass();
		if (logger.isTraceEnabled()) {
			logger.trace("beforeTestClass(): class [" + testClass.getName() + "]");
		}
		getTestContext().updateState(null, null, null);

		for (TestExecutionListener testExecutionListener : getTestExecutionListeners()) {
			try {
				testExecutionListener.beforeTestClass(getTestContext());
			}
			catch (Throwable ex) {
				logException(ex, "beforeTestClass", testExecutionListener, testClass);
				ReflectionUtils.rethrowException(ex);
			}
		}
	}
```
**因为需要在before all阶段触发，所以该方法会被`@ExtendWith`的`SpringExtension`在beforeAll阶段调用**：
```java
	/**
	 * Delegates to {@link TestContextManager#beforeTestClass}.
	 */
	@Override
	public void beforeAll(ExtensionContext context) throws Exception {
		getTestContextManager(context).beforeTestClass();
	}
```

## `TestExecutionListener`
**spring test里的各种`TestExecutionListener`实现提供了非常重要的功能**，比如：
- `DependencyInjectionTestExecutionListener`：为test instance进行依赖注入；
- `TransactionalTestExecutionListener`：提供事务管理；
- `SqlScriptsTestExecutionListener`：执行`@Sql`配置的sql脚本；
- `EventPublishingTestExecutionListener`：往test `ApplicationContext`发送event，ApplicationContext再根据event触发相关event listener；

> **为什么一提到listener我脑子里想的就是打个log……似乎listener是可有可无的……可能被各类doc经常举的listener的例子毒害了……**

`TestExecutionListener`通过`@TestExecutionListeners`注册：
```java
// Switch to default listeners
@TestExecutionListeners(
    listeners = {},
    inheritListeners = false,
    mergeMode = MERGE_WITH_DEFAULTS)
class MyTest extends BaseTest {
    // class body...
}
```

listener是一种非常重要的回调机制，jupiter通过listern回调了`SpringExtension`，spring test再通过listener回调触发了依赖注入、事务管理，同时触发了`ApplicationContext` event，再由`ApplicationContext`触发event相关的回调。**这些回调机制本身还是给框架插入了很多非常重要的“回调插件”的！**

## `ContextLoader`
`ContextLoader`/`SmartContextLoader`：**用于加载测试类的`ApplicationContext`**。官方推荐使用`SmartContextLoader`接口。

> **A SmartContextLoader is responsible for loading an ApplicationContext for a given test class**.
>
> `ContextLoader`，用于加载context配置。它是个接口，**spring3.1定义了它的子接口`SmartContextLoader`用于支持annotation配置**：The `SmartContextLoader` SPI supersedes the `ContextLoader` SPI introduced in Spring 2.5: a `SmartContextLoader` can choose to process either resource locations or annotated classes.

所以他们的实现有支持xml配置的，有支持annotation配置的：
- `AnnotationConfigContextLoader`
- `GenericXmlContextLoader`
- `DelegatingSmartContextLoader`：**默认的context loader。它是上述二者的聚合体**，实际执行的时候根据配置资源的不同，将加载行为delegate to他们俩中的一个；

其实`AnnotationConfigContextLoader`加载config class最终还是用的`new AnnotatedBeanDefinitionReader(context).register(componentClasses)`，和非test spring代码创建的`AnnotationConfigApplicationContext`里的`new AnnotatedBeanDefinitionReader(this)`其实一毛一样。

**读取的config class哪来的？`@ContextConfiguration`注解里设置的！**

当然web相关的配置加载也得来一套：
- `GenericXmlWebContextLoader`
- `AnnotationConfigWebContextLoader`
- `WebDelegatingSmartContextLoader`：**默认的web context loader**，上述二者的聚合；

**怎么判断是不是web环境？给测试类加上`@WebAppConfiguration`后就是啊！**

> `@WebAppConfiguration` is a class-level annotation that you can use **to declare that the `ApplicationContext` loaded for an integration test should be a `WebApplicationContext`**. The mere presence of `@WebAppConfiguration` on a test class ensures that a `WebApplicationContext` is loaded for the test, using the default value of "`file:src/main/webapp`".

**其实spring test可以看做spring core的另一种套壳，是spring core的另一种打开方式。进入spring core不再使用main函数，而是通过junit框架，通过`SpringExtension`，通过暴露给程序猿的`@Test`测试类。**

比如同样是启动`ApplicationContext`：
- **spring可以直接`new AnnotationConfigApplicationConfig(config class)`**；
- **spring test因为不让程序猿在test代码里显式创建test的`ApplicationContext`（如果写测试代码还要手动new一个context，那也太麻烦了），所以没法直接new，而是spring test框架通过`SpringExtension`自己new。那么new的时候怎么指定程序猿想要的config class呢？于是spring test提供了个`@ContextConfiguration`注解，可以写在test class上，供程序猿配置config class（看起来有点儿像缺啥就拿根棍儿随便搭一下）**。

spring test提供的机制没那么多，所以代码量也相对较小，代码找起来也比较方便，读起来比较容易。**看了spring test，可以更深刻理解spring**。

# 启动`TestContext`框架
虽然对基于jupiter的spring test来说，`SpringExtension`才是启动spring test框架的入口，**但因为启动`TestContext`才是启动spring test的核心，所以也可以说`TestContextBootstrapper`才算是spring test的入口。**

> Since the `TestContextBootstrapper` SPI is likely to change in the future (to accommodate new requirements), we strongly encourage implementers not to implement this interface directly but rather to extend `AbstractTestContextBootstrapper` or one of its concrete subclasses instead.

## spring
spring test的`TestContextBootstrapper`默认实现是`DefaultTestContextBootstrapper`。

spring test在使用jupiter框架的时候要给测试类加上`@ExtendWith(SpringExtension.class)`。为了使用方便，spring test定义了组合注解`@SpringJUnitConfig`，**它集成了spring test里使用最广泛的两个注解`@ExtendWith(SpringExtension.class)`和`@ContextConfiguration`**：
```java
@ExtendWith(SpringExtension.class)
@ContextConfiguration
@Documented
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface SpringJUnitConfig {
```
所以测试的时候直接使用该注解即可。

## springboot
如前所述，spring boot自定义了一个`SpringBootTestContextBootstrapper`，它继承了spring的`DefaultTestContextBootstrapper`，但是使用自己的`SpringBootContextLoader`作为context loader（**除此之外它还会寻找启动类的注解`@SpringBootConfiguration`等等**）。所以spring boot的测试用例要写上`@BootstrapWith(SpringBootTestContextBootstrapper.class)`。又因为它要借助spring extension接入jupiter，所以还要加上`@ExtendWith(SpringExtension.class)`。

springboot新定义了组合注解`@SpringBootTest`，它集成了`@BootstrapWith(SpringBootTestContextBootstrapper.class)`和`@ExtendWith(SpringExtension.class)`：
```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@BootstrapWith(SpringBootTestContextBootstrapper.class)
@ExtendWith(SpringExtension.class)
public @interface SpringBootTest {
```
测试类直接写这个注解就行了。

> 这个注解没有加spring test的`@ContextConfiguration`，因为它默认按照springboot的方式寻找配置了，所以默认不需要加`@ContextConfiguration`。

**除了`@SpringBootTest`，springboot还提供了一大堆和它类似的但只专注做slice test的注解，比如`@WebMvcTest`**。详情参考[spring-boot-test]({% post_url 2022-11-27-spring-boot-test %})的slice test部分。

## mybatis-spring-boot
和springboot同理，mybatis-spring-boot包里也实现了自己的bootstrap类`MybatisTestContextBootstrapper`，不过它比springboot靠上层，继承了springboot的默认启动类`SpringBootTestContextBootstrapper`。所以它需要加上`@ExtendWith(SpringExtension.class)`和`@BootstrapWith(MybatisTestContextBootstrapper.class)`。

为了方便，它模仿springboot的`@*Test`定义了`@MybatisTest`组合注解：
```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@BootstrapWith(MybatisTestContextBootstrapper.class)
@ExtendWith(SpringExtension.class)
@OverrideAutoConfiguration(enabled = false)
@TypeExcludeFilters(MybatisTypeExcludeFilter.class)
@Transactional
@AutoConfigureCache
@AutoConfigureMybatis
@AutoConfigureTestDatabase
@ImportAutoConfiguration
public @interface MybatisTest {
```
测试类直接写这个注解就行了。

# `TestExecutionListener` - 功能性插件
如前所述，**它是回调接口，起到插件的作用，而且是执行具体功能的重要插件！**
- `ServletTestExecutionListener`：如果有`@WebAppConfiguration`，就为`WebApplicationContext`创建servlet api mock；
- **`DependencyInjectionTestExecutionListener`：负责测试实例的依赖注入**；
- `TransactionalTestExecutionListener`：**测试完使用rollback策略达到回滚的效果**；
- `SqlScriptsTestExecutionListener`：加载@Sql配置的sql脚本；
- `EventPublishingTestExecutionListener`：在每种test execution的生命周期发送相应的容器事件，见下文；

“listener就像插件一样”，其实这和spring的`PostBeanProcesser`是一样的，大家都是回调接口！就算注册的方式不尽相同，可能需要手动注册，可能直接通过bean注入进行注册，但功能都是类似的。

## 手动注册listener
**想注册`TestExecutionListener`，只需要标注上`@TestExecutionListeners`注解。spring默认的bootstrap（`DefaultTestContextBootstrapper`）会检测该注解，加载并注册这个listener。**

注意，**如果使用这种方式注册自定义的listener，默认的listener将不会被自动注册**……

> spring：没想到吧，其实我是springboot……

**必须显式配置注册方式为[merge default listener](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-tel-config-merging)**，才能把这两拨listener都注册上：
```java
@ContextConfiguration
@TestExecutionListeners(
    listeners = MyCustomTestExecutionListener.class,
    mergeMode = MERGE_WITH_DEFAULTS
)
class MyTest {
    // class body...
}
```

## 自动注册listner
如果一个listener在所有的test class里都要用，每次都使用`@TestExecutionListeners`显得有些麻烦了。spring还提供了另一种[自动注册]((https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-tel-config-automatic-discovery))方式：在`META-INF/spring.factories`里设置`org.springframework.test.context.TestExecutionListener`列表即可，这些listener都会被spring test加载进来。

> **这种在`META-INF/spring.factories`下设置要注册的class列表的方式是由spring提供的`SpringFactoriesLoader`做的**。springboot加载autoconfig的类也是通过这种方式来加载的：[spring boot starter 自动配置原理]({% post_url 2020-02-18-spring-boot-starter-auto-config %})

题外话：**`SqlScriptsTestExecutionListener`充分展示了怎么处理注解**：
1. 使用反射获取类上或者method上的`@Sql`注解。以类上的`@Sql`注解举例：
2. 获取Sql注解配置的`executionPhase`和`statement`属性；
3. 如果phase和当前phase一致（比如都是before class或者before method），那就加载statement路径声明的文件，然后处理它。

> **所以：注解，不过是一种配置罢了。配置属性还是要支持的那些属性**。所以它能取代xml。

# 触发测试event
spring有一套[容器事件发布机制]({% post_url 2021-11-21-spring-context %})：
1. `ApplicationEvent`：定义的事件；
2. `ApplicationListener`，处理相应的事件；

> 我们可以手动通过`ApplicationContext`触发事件：`ctx.publishEvent(mse)`。而spring的`ApplicationContextAware`给了我们这种获取`ApplicationContext`的能力。**这相当于我们能拿到一个全局变量，全局变量里有所有的listener，所以我们想什么时候触发就什么时候触发！**

不过这里我们不需要手动触发事件，我们关注的是spring利用该机制在容器的不同阶段（application start/refresh/close/stop）分别触发相应的listener。

spring test 搞了一个`EventPublishingTestExecutionListener`，在每种test execution时机发送相应的容器事件。所以现在用户可以自定义一系列这些容器事件的listener，每次到了before class/before method/...，都会触发相应的事件，我们的event listener就能感知到这些事件。

> **但是有个条件：这些event依托于`ApplicationContext`（这个“全局变量”），那就得有`ApplicationContext`**。但是测试的时候，`ApplicationContext`是懒加载的，所以第一次before class event不会被发布，因为还没有创建出`ApplicationContext`。如果想让它发布，需要自己实现一个`TestExecutionListener`，调用一下`ApplicationContext`（就会把它加载出来），并确保该listener在`EventPublishingTestExecutionListener`之前执行。

## `ApplicationListener` over `TestExecutionListener`
既然spring test已经在测试的各个时间点使用事件发布机制发布了事件，**那我们就可以选择使用spring的`ApplicationListener`接收这些事件，而非使用spring test的`TestExecutionListener`（由`TestContextManager`调用）。毕竟spring core的用法比spring test的用法适用范围更广泛**！如果二者能实现同样的效果，自然学习使用范围更广的那个。

所以只需要搞一个bean实现`ApplicationListener`就行了（在spring test的场景下，这个bean可以是标注`@Configuration`的类）。

## `@EventListener` over `ApplicationListener`
由于spring[还有一个功能](https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#context-functionality-events-annotation)（spring的功能真多……），**没必要非得`implements ApplicationListener`并实现它的`onApplicationEvent`方法，直接给bean的方法标记`@EventListener`也是可以的**。

> 注意是spring的`@EventListener`，不是jdk的`@EventListener`……

为了确定`@EventListener`监听的是哪个（些）事件：
1. 要么方法参数和`onApplicationEvent`的参数一样，是一个事件；
2. 要么在`@EventListener`注解里标明事件；

比如在spring test里想监听before test class事件，可以写成：`@EventListener(BeforeTestClassEvent.class)`。

## `@BeforeTestClass` over `@EventListener`
更进一步，**因为这些事件是测试时的常用事件，所以spring test又搞了一堆alias annotation，比如：`@BeforeTestClass`**。

> This annotation may be used on `@EventListener`-compliant methods within a Spring test `ApplicationContext` — for example, on methods in a `@Configuration` class. A method annotated with this annotation will be invoked as part of the `org.springframework.test.context.TestExecutionListener.beforeTestClass` lifecycle.

所以现在想监听测试用例的事件更简单了：
- **不用实现`TestExecutionListener`**（spring test的`EventPublishingTestExecutionListener`帮你转接为`ApplicationContext`事件了）；
- **不用实现`ApplicationListener`**（spring帮你转为`@EventListener`了）；
- **不用标注`@EventListener`**（spring test帮你alias为比如`@BeforeTestMethod`了）；
- **直接标注下面的annotation就行**：
    + `@BeforeTestClass`
    + `@PrepareTestInstance`
    + `@BeforeTestMethod`
    + `@BeforeTestExecution`
    + `@AfterTestExecution`
    + `@AfterTestMethod`
    + `@AfterTestClass`

# `TestContext`管理
重点来了，**关于spring test如何配置bean的问题**——

## 获取`ApplicationContext`
已知，实现`ApplicationContextAware`的类，能访问`ApplicationContext`。`AbstractJUnit4SpringContextTests`和`AbstractTestNGSpringContextTests`都实现了这个接口，所以他们能够提供获取`ApplicationContext`的能力。

但是我们写测试用例的时候，并不需要让类实现`ApplicationContextAware`，**在`DependencyInjectionTestExecutionListener`的帮助下，我们可以直接使用`@Autowired`注入`ApplicationContext`**。

`DependencyInjectionTestExecutionListener`会通过`TestContext#getTestInstance`获取测试用例类，然后给它注入需要的`ApplicationContext`：
```java
	protected void injectDependencies(final TestContext testContext) throws Exception {
		Object bean = testContext.getTestInstance();
		AutowireCapableBeanFactory beanFactory = testContext.getApplicationContext().getAutowireCapableBeanFactory();
		beanFactory.autowireBeanProperties(bean, AutowireCapableBeanFactory.AUTOWIRE_NO, false);
		beanFactory.initializeBean(bean, testContext.getTestClass().getName());
		testContext.removeAttribute(REINJECT_DEPENDENCIES_ATTRIBUTE);
	}
```

## 配置xml/groovy/class config
配置文件定义的bean怎么加载到`TestContext`的`ApplicationContext`里？
- 在spring里，用的是`@Configuration`、`@ComponentScan`或者直接把类register到`ApplicationContext`。
- 在spring test里，**使用`@ContextConfiguration`指定想要加载的xml或者class**。可以指定多个。
    - `locations`（或者默认的value）属性用于指定xml文件：**可以是`classpath:`下的xml，也可以是绝对文件（`/`开头），或者`file:`、`http:`等**；
    - `classes`属性用于指定class配置文件：**class就比较简单了，只要能import进来，就可以指定它**；

> **能作为配置的class类可以被称为“component class”**：
> - 它不仅仅是标注了`@Configuration`的类；
> - 标注`@Component`/`@Service`/`@Repository`的也可以导进`ApplicationContext`；
> - `@Bean`也行；
> 
> **这一点跟spring是一致的**！`AnnotationConfigApplicationContext#register`可接受的是`annotatedClasses`，它的解释是：one or more annotated classes, e.g. `@Configuration` classes。所以`@Service`等也是可以的！

**如果不指定位置，`@ContextConfiguration`使用默认的位置加载配置**：
- 默认的xml位置是类所在的包下，且名字为`类名-context.xml`：`GenericXmlContextLoader` and `GenericXmlWebContextLoader` detect a default location based on the name of the test class. If your class is named `com.example.MyTest`, `GenericXmlContextLoader` loads your application context from "`classpath:com/example/MyTest-context.xml`"
- **默认的class配置是测试类的任意命名的静态内部类，只要它标注`@Configuration`就行**：`AnnotationConfigContextLoader` and `AnnotationConfigWebContextLoader` detect all **static nested classes of the test class that meet the requirements for configuration class implementations, as specified in the `@Configuration` javadoc**. Note that the name of the configuration class is arbitrary.

```java
// ApplicationContext will be loaded from the
// static nested Config class
@SpringJUnitConfig 
class OrderServiceTest {

    @Configuration
    static class Config {

        // this bean will be injected into the OrderServiceTest class
        @Bean
        OrderService orderService() {
            OrderService orderService = new OrderServiceImpl();
            // set properties, etc.
            return orderService;
        }
    }

    @Autowired
    OrderService orderService;

    @Test
    void testOrderService() {
        // test the orderService
    }

}
```

这默认加载配置的地方，你不说谁知道……spring，你也springboot化了嘛：
> The TestContext framework also places a great deal of importance on convention over configuration, with reasonable defaults that you can override through annotation-based configuration.

如果想混合加载配置，构建`ApplicationContext`怎么办？spring不支持，spring boot支持：
> Furthermore, some third-party frameworks (such as Spring Boot) provide first-class support for loading an `ApplicationContext` from different types of resources simultaneously (for example, XML configuration files, Groovy scripts, and `@Configuration` classes). The Spring Framework, historically, has not supported this for standard deployments. 

但是spring有它自己的支持方法，比如：
- 在xml里定义一个配置class为bean，或者auto scan它；
- 在class配置类里，可以`@ImportResource`导入一个xml配置类；

这一点是spring core所支持的东西。

## 配置是继承的
最后，**配置默认是可继承的。一个测试用例子类默认继承它的父类所配置的配置文件**：
```java
@ExtendWith(SpringExtension.class)
// ApplicationContext will be loaded from "/base-config.xml"
// in the root of the classpath
@ContextConfiguration("/base-config.xml") 
class BaseTest {
    // class body...
}

// ApplicationContext will be loaded from "/base-config.xml" and
// "/extended-config.xml" in the root of the classpath
@ContextConfiguration("/extended-config.xml") 
class ExtendedTest extends BaseTest {
    // class body...
}
```

## 指定profile
spring支持profile，可以使用`@Profile`定义多套配置：
```java
@Configuration
@Profile("dev")
public class StandaloneDataConfig {

    @Bean
    public DataSource dataSource() {
        return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.HSQL)
            .addScript("classpath:com/bank/config/sql/schema.sql")
            .addScript("classpath:com/bank/config/sql/test-data.sql")
            .build();
    }
}

@Configuration
@Profile("production")
public class JndiDataConfig {

    @Bean(destroyMethod="")
    public DataSource dataSource() throws Exception {
        Context ctx = new InitialContext();
        return (DataSource) ctx.lookup("java:comp/env/jdbc/datasource");
    }
}

@Configuration
public class TransferServiceConfig {

    @Autowired DataSource dataSource;

    @Bean
    public TransferService transferService() {
        return new DefaultTransferService(accountRepository(), feePolicy());
    }

    @Bean
    public AccountRepository accountRepository() {
        return new JdbcAccountRepository(dataSource);
    }

    @Bean
    public FeePolicy feePolicy() {
        return new ZeroFeePolicy();
    }
}
```
**spring test新增了`@ActiveProfiles`注解，用于指定哪些profile的配置**。可以把这些config class全部导进来，然后指定使用哪一个profile：
```java
@SpringJUnitConfig({
        TransferServiceConfig.class,
        StandaloneDataConfig.class,
        JndiDataConfig.class,
        DefaultDataConfig.class})
@ActiveProfiles("dev")
class TransferServiceTest {

    @Autowired
    TransferService transferService;

    @Test
    void testTransferService() {
        // test the transferService
    }
}
```
> `@SpringJUnitConfig`：is a composed annotation that combines `@ExtendWith(SpringExtension.class)` from JUnit Jupiter with `@ContextConfiguration` from the Spring TestContext Framework.

但是写个test case都能用到这么多profile？确实不常见……

> 假设真的用了`@ActiveProfiles`，一般不止一个测试用例会用这个profile，这样为了好修改，最好写个composed annotation。

如果只想继承configuration，不想继承profile，设置`inheritProfiles = false`就好了：
```java
// "dev" profile overridden with "production"
@ActiveProfiles(profiles = "production", inheritProfiles = false)
class ProductionTransferServiceTest extends AbstractIntegrationTest {
    // test body
}
```

## 指定properties
spring可以指定properties文件，test也可以！
**In contrast to the `@PropertySource` annotation used on `@Configuration` classes, you can declare the `@TestPropertySource` annotation on a test class to declare resource locations for test properties files or inlined properties.**

`@TestPropertySource`指定properties文件的路径和`@ContextConfiguration`指定xml配置文件路径语法一毛一样。

**`@TestPropertySource`还能配置inline properties**：
- `key=value`
- `key:value`
- `key value`

上述三种语法都行：
```java
@ContextConfiguration
@TestPropertySource(properties = {"timezone = GMT", "port: 4242"}) 
class MyIntegrationTests {
    // class body...
}
```

当然，**重复多个`@TestPropertySource`注解看起来会更简洁**。
> As of Spring Framework 5.2, `@TestPropertySource` can be used as repeatable annotation. That means that you can have multiple declarations of `@TestPropertySource` on a single test class

**如果只写了`@TestPropertySource`不写路径，这玩意儿也是有默认properties文件的，直接就是测试用例包下的`类名.properties`**。有点儿隐晦。
> if the annotated test class is `com.example.MyTest`, the corresponding default properties file is classpath:com/example/MyTest.properties

最后，和profiles一样，`@TestPropertySource`指定的properties默认也是被子类继承的。除非显式关掉`inheritProperties = true`。

### dynamic property source
[在app启动后动态注册property source](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-ctx-management-dynamic-property-sources)，这个太重要了！

在测试testcontainers这种先启动容器后知道端口的场景下，只能在容器启动后，再获取properties，动态注册到PropertySource里。之后spring data elasticsearch就能从PropertySource里读取port，从而连接容器了：
```java
    @DynamicPropertySource
    static void elasticProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.elasticsearch.uris", container::getHttpHostAddress);
    }
```
所以，这么注册的PropertySource的优先级必定非常高。

> **Dynamic properties have higher precedence than** those loaded from `@TestPropertySource`, the operating system’s environment, Java system properties, or property sources added by the application declaratively by using `@PropertySource` or programmatically. Thus, dynamic properties can be used to selectively override properties loaded via `@TestPropertySource`, system property sources, and application property sources.

## `WebApplicationContext`
spring是根据classpath下有没有servlet相关的类来决定要不要启动`WebApplicationContext`的，**spring test则更粗暴：只看有没有标注`@WebAppConfiguration`**。
> **To instruct the TestContext framework to load a `WebApplicationContext` instead of a standard `ApplicationContext`, you can annotate the respective test class with `@WebAppConfiguration`.**
>
> **The presence of `@WebAppConfiguration` on your test class instructs the TestContext framework (TCF) that a `WebApplicationContext` (WAC) should be loaded for your integration tests**. In the background, the TCF makes sure that **a `MockServletContext` is created** and supplied to your test’s WAC. **By default, the base resource path for your MockServletContext is set to `src/main/webapp`**.

**web application的默认配置是`src/main/webapp`，可以通过`@WebAppConfiguration("xxx")`覆盖，同样支持file和classpath语法**：
> If you are familiar with the directory structure of a web application in a Maven project, **you know that `src/main/webapp` is the default location for the root of your WAR**. **If you need to override this default, you can provide an alternate path to the `@WebAppConfiguration` annotation (for example, `@WebAppConfiguration("src/test/webapp")`)**. If you wish to reference a base resource path from the classpath instead of the file system, **you can use Spring's `classpath:` prefix. 我猜是`@WebAppConfiguration("classpath:webapp")`**

**`@ContextConfiguration`默认指的是classpath上的文件，`@WebAppConfiguration`默认指的是file路径的文件**：
> By default, `@WebAppConfiguration` resource paths are file system based，所以想使用classpath下的文件夹一定要以`classpath:`开头！但是`@ContextConfiguration`是classpath based！

它使用file based路径我觉得是很合理的，**因为它需要的是web配置文件，而默认web配置文件`src/main/webapp`并不在classpath上，自然不可能会用基于classpath的文件加载方式**。

spring test对`WebApplicationContext`的支持和`ApplicationContext`一致：比如也可以使用上面说的`@ContextConfiguration`、`@ActiveProfiles`、`@TestExecutionListeners`、`@Sql`、`@Rollback`等：
```java
@ExtendWith(SpringExtension.class)

// defaults to "file:src/main/webapp"
@WebAppConfiguration
// detects "WacTests-context.xml" in the same package
// or static nested @Configuration classes
@ContextConfiguration
class WacTests {
    //...
}
```

### `ServletTestExecutionListener `
web的很多mock都是它实现的：
- sets up default thread-local state by using Spring Web's `RequestContextHolder` before each test method and creates a `MockHttpServletRequest`, a `MockHttpServletResponse`, and a `ServletWebRequest` based on the base resource path configured with `@WebAppConfiguration`；
- ensures that the `MockHttpServletResponse` and `ServletWebRequest` can be injected into the test instance
- and, once the test is complete, it cleans up thread-local state.

所以可以给web测试注入很多东西：
```java
@SpringJUnitWebConfig
class WacTests {

    @Autowired
    WebApplicationContext wac; // cached

    @Autowired
    MockServletContext servletContext; // cached

    @Autowired
    MockHttpSession session;

    @Autowired
    MockHttpServletRequest request;

    @Autowired
    MockHttpServletResponse response;

    @Autowired
    ServletWebRequest webRequest;

    //...
}
```
> `@SpringJUnitWebConfig` = `@ExtendWith(SpringExtension.class)` + `@ContextConfiguration` + `@WebAppConfiguration`

**前两个的生命周期是全test suite，其他的都是仅在每个method里使用。**

## context缓存（复用）
无论`ApplicationContext`还是`WebApplicationContext`，在整个test suite（多个test class）周期内都是缓存下来并复用的。

**`ApplicationContext`能否被复用，看它的key是否相同。key取决于使用的configuration、profile、properties等**，如果不一样，就不能复用之前别的test class创建好的`ApplicationContext`。那么另一个test class就只能重新创建自己的`ApplicationContext`。

如果一个测试用例被标记为`@DirtiesContext`，说明它改变了`ApplicationContext`的状态（比如改变了一个单例bean的值），那么`ApplicationContext`就要被销毁并重新生成。所以会重建cache。因此，**`@DirtiesContext`可以认为是手动触发`ApplicationContext`重建的信号器**。

# 依赖注入
依赖注入是由`DependencyInjectionTestExecutionListener`做的，候选bean是使用`@ContextConfiguration`等配置的bean。

**注入的时候可以使用setter injection, field injection。但是只有jupiter才能使用constructor injection，别的框架不行。因为只有接入jupiter的`SpringExtension`参与了test class的实例化，所以可以操纵它的constructor。**

**而且在测试代码上，spring test鼓励field injection，因为测试类并不需要实例化**。所以不是很需要constructor injection：
> **Although field injection is discouraged in production code, field injection is actually quite natural in test code. The rationale for the difference is that you will never instantiate your test class directly**. Consequently, there is no need to be able to invoke a public constructor or setter method on your test class.

如果同类型的bean有多个，仅靠`@Autowired`是搞不定注入的。可以像spring一样使用`@Qualifier`，也可以注入`ApplicationContext`，手动get：`applicationContext.getBean("titleRepository", TitleRepository.class)`。反正是测试代码。

## constructor injection
[spring test + jupiter才可以这么玩](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-junit-jupiter-di)。不过反正可以field injection，不用constructor injection也问题不大。

# 事务管理
spring test的事务管理是由`TransactionalTestExecutionListener`做的。正如[Spring - Data Access & Transaction]({% post_url 2022-08-01-spring-dao-transaction %})介绍的一样：
1. 首先就是要配置一个`PlatformTransactionManager` bean，要不然谁来做事务管理；
2. 然后对需要的方法标注`@Transactional`：**Annotating a test method with `@Transactional` causes the test to be run within a transaction that is, by default, automatically rolled back after completion of the test**；

**注意区分这个“事务管理”管理的是哪些事务：它负责的是在执行完一个test方法之后，把写的数据roolback。不是程序里写的那些事务，那些事务由`ApplicationContext`里配置的事务管理器管理，或者手动使用JDBC操作事务**。

很明显的一点就是：**程序里的那些事务都是写失败了才会rollback，写成功了肯定不rollback。而test method的事务是写成功之后把事务rollback，清理掉写入的数据。**

> You should not confuse such transactions with Spring-managed transactions (those managed directly by Spring within the `ApplicationContext` loaded for tests) or application-managed transactions (those managed programmatically within application code that is invoked by tests). 

但是这些事务并非没有关联，毕竟标注了`@Transaction`的test method可能会调用业务代码里带有`@Transaction`的方法，此时就会出现事务传播：spring定义的事务传播行为默认是`PROPAGATION.REQUIRED`，如果事务已存在，则加入到这个事务中！而不是创建两个事务。

也可以不让数据写完之后rollback：**使用[`@Commit`](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#spring-testing-annotation-commit)在method测试过后让提交事务，相当于`@Rollback(false)`**。

# 执行sql script
可以通过现成的sql script[给数据库注入数据](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-executing-sql)：
```java
@SpringJUnitConfig
@Sql("/test-schema.sql")
class DatabaseTests {

    @Test
    void emptySchemaTest() {
        // run code that uses the test schema without any test data
    }

    @Test
    @Sql({"/test-schema.sql", "/test-user-data.sql"})
    void userTest() {
        // run code that uses the test schema and test data
    }
}
```
**这里的路径默认是一个classpath资源，路径是相对测试类所在的package**：
> Each path is interpreted as a Spring Resource. A plain path (for example, "schema.sql") is treated as a **classpath resource that is relative to the package in which the test class is defined**. A path starting with a slash is treated as an absolute classpath resource (for example, "/org/example/schema.sql"). A path that references a URL (for example, a path prefixed with classpath:, file:, http:) is loaded by using the specified resource protocol.

如果`@Sql`不指定script，spring test还会检测[默认script](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-executing-sql-declaratively-script-detection)，不过用处不大……

多个`@Sql`在java8是允许的。如果用了低版本jdk或者kotlin，使用`@SqlGroup`以达到这个效果。

test method的`@Sql`会覆盖test class的`@Sql`，除非显式声明[merge二者](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-executing-sql-declaratively-script-merging)。

# spring test的annotation
spring test提供的最重要的那些annotation基本已经在上面提到了。[还有一些spring里的annotation太重要了](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#integration-testing-annotations-standard)，所以spring test同样提供了支持，比如`@Annotation`、`@Value`。

再详细介绍一下spring test单独引入的那些测试专用的annotation：

## `@BootstrapWith`
spring test有自己的启动`TestContext`的流程，正常测试够用了。但有的开发团队或第三方框架想自己改点儿东西。属于比较底层的控制行为。
- https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-bootstrapping

## `@ContextConfiguration`
从哪里加载配置（xml/classes），去配置`ApplicationContext``：
> @ContextConfiguration` declares the application context resource locations or the component classes used to load the context.

class是[Component Classes](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-ctx-management-javaconfig-component-classes)，既可以是带`@Configuration`的class，也可以是`@Component/Service/Repository`等class。

## `@WebAppConfiguration`
`@WebAppConfiguration` is a class-level annotation that you can use to declare that the `ApplicationContext` loaded for an integration test should be a `WebApplicationContext`.

就是为了告诉spring应该用web的context。**别忘了就它的资源路径是file base的，因为不在classpath行**。

## `@Commit`
执行完测试用例之后，不要回滚，让它持久化。和`@Rollback`相对。

## `@Sql`
执行测试用例之前先执行sql脚本填充数据：
```java
@Sql({"/test-schema.sql", "/test-user-data.sql"}) 
```

## 支持junit的相关注解
主要是junit4和jupiter两套。[spring test对jupiter的支持类是`SpringExtension`](https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#testcontext-junit-jupiter-extension)，结合`@ExtendWith`使用：`@ExtendWith(SpringExtension.class)`。

spring test提供了`@SpringJUnitConfig`组合注解，它是`@ExtendWith(SpringExtension.class)` + `@ContextConfiguration`。还有`@SpringJUnitWebConfig` = `@ExtendWith(SpringExtension.class)` + `@ContextConfiguration` + `@WebAppConfiguration`。

在`@SpringJUnitConfig`里声明了classes属性，配置它和配置`@ContextConfiguration(classes = xxx)`是一样的：
```java
	/**
	 * Alias for {@link ContextConfiguration#classes}.
	 */
	@AliasFor(annotation = ContextConfiguration.class)
	Class<?>[] classes() default {};
```

## 组合注解
如果几个注解经常一起使用，可以把他们当做meta annotation，组合出一个新注解。比如上面的`@SpringJUnitConfig`就是一个组合注解。

这是jdk的功能，在spring里也常用：
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-meta-annotations

比如`@Service`不过是`@Component`的alias罢了……
```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Component 
public @interface Service {

    // ...
}
```

spring test自己举的例子也不错：
- https://docs.spring.io/spring-framework/docs/current/reference/html/testing.html#spring-testing-annotation-testexecutionlisteners

# 感想
一直玩不明白spring test和springboot test。第一次正式看并记录spring test是在今年六月初，当时看得我一脸懵逼。再次真正回来梳理明白是十一月底。这期间兜兜转转，又扩充了海量的知识，终于在系统地看了jupiter之后，才终于搞明白了spring/boot test。人的水平不一样，看东西理解能力差别太大了。终于搞清楚了，现在我可太开心了~
