---
layout: post
title: "JUnit Jupiter"
date: 2022-11-20 02:26:45 +0800
categories: junit jupiter testcontainers maven
tags: junit jupiter testcontainers maven
---

既然assertj看完了，既然testcontainers、spring、springboot几乎每个框架都接入了jupiter的@ExtendWith，那就好好看看早就想看的jupiter吧！

1. Table of Contents, ordered
{:toc}

# basic
一些之前不太常用但看起来很好用的注解：

## @DisplayName("😱")
不错，使测试报告可读性好了很多。

## assertion
差点儿意思
- https://junit.org/junit5/docs/current/user-guide/#writing-tests-assertions

集成Assertj:
- https://junit.org/junit5/docs/current/user-guide/#writing-tests-assertions-third-party

## assumption
这个assertj也有，以后可以用一用：
- https://junit.org/junit5/docs/current/user-guide/#writing-tests-assumptions

## @Disabled
没有@Ignored了，使用`@Disabled("Disabled until bug #99 has been fixed")`

## @Tag
打标签：marking and filtering tests

- https://junit.org/junit5/docs/current/user-guide/#writing-tests-tagging-and-filtering
- https://junit.org/junit5/docs/current/user-guide/#running-tests-tags
- https://junit.org/junit5/docs/current/user-guide/#running-tests-build-maven-filter-tags

## lifecycle
before all/before each/after all/after each
- https://junit.org/junit5/docs/current/user-guide/#writing-tests-test-instance-lifecycle

## `@Nested`
一组测试，更好的组织方式。也能共享一些东西：
- https://junit.org/junit5/docs/current/user-guide/#writing-tests-nested

## 参数化测试
- https://junit.org/junit5/docs/current/user-guide/#writing-tests-parameterized-tests

如果只是参数不同，测试方法都一样，可以直接用`@ParameterizedTest`。

需要指定一个source产出参数：https://junit.org/junit5/docs/current/user-guide/#writing-tests-parameterized-tests-sources

然后consume掉它：https://junit.org/junit5/docs/current/user-guide/#writing-tests-parameterized-tests-consuming-arguments

# junit的架构：`@ExtendWith`
- https://junit.org/junit5/docs/current/user-guide/#extensions-registration

以基于jupiter的testcontainers测试框架为例：**我们可以直接使用testcontainers框架提供的`@TestContainers`进行container的自动管理**。该注解会寻找标注了`@Container`的field，并在测试前后对它自动开启关闭。

**`@TestContainers`标注了`@ExtendWith(TestcontainersExtension.class)`**，也就是说，`@TestContainers`的整个功能是由`TestcontainersExtension`类提供的支持。

此时jupiter的`Extendwith`所处的层级：
1. junit框架：junit加载`@ExtentWith`里提供的拓展类；
2. testcontainers：作为junit框架使用者，写一个符合`@ExtentWith`规范的拓展类，也就是`TestcontainersExtension`，读取自己关心的注解`@Container`，控制container的启动和关闭；
3. 程序猿：作为testcontainers使用者，写自己的测试代码，使用`@TestContainers`指定由testcontainers自动管理的测试类，并在container上标注`@Container`；

testcontainers的`TestcontainersExtension`做哪些事情？测试前启动container，测试后关闭container。所以`TestcontainersExtension`实现了jupiter的以下几个生命周期接口：
- BeforeAllCallback
- BeforeEachCallback
- AfterEachCallback
- AfterAllCallback
- ExecutionCondition

## `ExtensionContext`
想完成回调，回调参数是非常重要的，它是这个回调函数所能拥有的一切上下文信息。jupiter提供了`ExtensionContext`回调参数，而且根据不同的回调类型，提供了不同的实现：
- **beforeAll/afterAll的`ExtensionContext`类型为`ClassExtensionContext`，每个test class对应一个该对象**；
- **beforeEach/afterEach的`ExtensionContext`类型为`MethodExtensionContext`，每个test method对应一个该对象，且对象的parent指向该test class的`ExtensionContext`**；

所以虽然回调接口的参数看起来都是`ExtensionContext`，但实际上大不相同。不仅类型未必相同，`ExtensionContext`对象也未必是同一个。但是能确定的是：
- 每个test class的beforeAll/afterAll的`ExtensionContext`都是同一个对象，test class之间是不同的对象；
- 每个test method的beforeEach/afterEach的`ExtensionContext`都是同一个对象，同一test class不同test method之间是不同的对象；

## `BeforeAllCallback`
在测试前，`TestcontainersExtension`需要找到谁标注了`@Container`注解，启动container。

看它对`BeforeAllCallback`回调接口的实现，非常直白：
```java
    @Override
    public void beforeAll(ExtensionContext context) {
        Class<?> testClass = context
            .getTestClass()
            .orElseThrow(() -> {
                return new ExtensionConfigurationException("TestcontainersExtension is only supported for classes.");
            });

        Store store = context.getStore(NAMESPACE);
        List<StoreAdapter> sharedContainersStoreAdapters = findSharedContainers(testClass);

        sharedContainersStoreAdapters.forEach(adapter -> {
            store.getOrComputeIfAbsent(adapter.getKey(), k -> adapter.start());
        });

        List<TestLifecycleAware> lifecycleAwareContainers = sharedContainersStoreAdapters
            .stream()
            .filter(this::isTestLifecycleAware)
            .map(lifecycleAwareAdapter -> (TestLifecycleAware) lifecycleAwareAdapter.container)
            .collect(Collectors.toList());

        store.put(SHARED_LIFECYCLE_AWARE_CONTAINERS, lifecycleAwareContainers);
        signalBeforeTestToContainers(lifecycleAwareContainers, testDescriptionFrom(context));
    }
```java
1. 首先获取标注了这个注解`@ExtendWith(TestcontainersExtension.class)`的class；
2. 在该类里找到所有的shard container，即：标注了`@Container`且为static的container（shared container）；
3. 启动这些container；

**通过jupiter提供的`ExtensionContext`回调参数，找到标注注解的类，进而从类信息获取各种field，进而找到要启动的容器。**

所有启动的shared container最后肯定都要关掉，**但是testcontainers并没有在`afterAll`回调里显式关闭这些container，而是直接交给了jupiter销毁它们**。

jupiter怎么做的？**jupiter在`ExtensionContext`里创建了一个`Store`。所有存储在该context的store里的`CloseableResource`类型的对象，都会随context的销毁而关闭**。

> Any instances of `ExtensionContext.Store.CloseableResource` stored in the Store of the provided `ExtensionContext` will be closed before methods in this API are invoked. You can use the parent context’s Store to work with such resources.

所以testcontainers在beforeAll里把所有的container对象封装为了`CloseableResource`类型的`StoreAdapter`：
```java
    /**
     * An adapter for {@link Startable} that implement {@link CloseableResource}
     * thereby letting the JUnit automatically stop containers once the current
     * {@link ExtensionContext} is closed.
     */
    private static class StoreAdapter implements CloseableResource {

        @Getter
        private String key;

        private Startable container;

        private StoreAdapter(Class<?> declaringClass, String fieldName, Startable container) {
            this.key = declaringClass.getName() + "." + fieldName;
            this.container = container;
        }

        private StoreAdapter start() {
            container.start();
            return this;
        }

        @Override
        public void close() {
            container.stop();
        }
    }
```java
到时候jupiter调用`CloseableResource#close`，其实就是调用`container.stop()`。

然后jupiter把找到的所有shared container都放到了store里：
```java
        sharedContainersStoreAdapters.forEach(adapter -> {
            store.getOrComputeIfAbsent(adapter.getKey(), k -> adapter.start());
        });
```java
**这样等这个测试类结束的时候，所有shared container都会自动销毁。**

在`ExtensionContext`里，`Store`是和namespace关联的。所以testcontainers创建了一个自定义的namespace，`Namespace.create(TestcontainersExtension.class)`。**毕竟一个类可能同时声明了很多`@ExtendWith`，比如还添加了spring的jupiter extension。大家用的都是同一个`ExtensionContext`对象。有了namespace，各操作各的，省得冲突**。

> 获取这个namespace关联的`Store store = context.getStore(NAMESPACE)`。把它当成是个map就行。

testcontainers本身还支持container启动后的回调，`TestLifecycleAware`，所以还要在shared container里把实现了这些接口的container找出来，然后调用它们的`TestLifecycleAware#beforeTest`。

> testcontainers的extension class是jupiter的回调，同时testcontainers还要触发使用testcontainers的程序猿写的container在测试前后的回调。
>
> 别人调我，我调你。别人是我爸爸，我是你爸爸。无论计算机世界还是这个真实的世界不都是这样？底层给我暴露一些接口，这些接口是我所能获取的所有；我给上层暴露一些接口，这些接口也是他们能获取的所有。

显然，在容器销毁后还要调用这批`TestLifecycleAware`容器的`TestLifecycleAware#afterTest`方法。所以testcontainers决定把这些过滤出来的container也放到store里（key=sharedLifecycleAwareContainers），等`afterAll`的时候再取出这些container触发afterTest回调。

## `BeforeEachCallback`
在每个test method启动前启动，启动的是**非shared container**，然后调用它们相关的回调：
```java
    @Override
    public void beforeEach(final ExtensionContext context) {
        Store store = context.getStore(NAMESPACE);

        List<TestLifecycleAware> lifecycleAwareContainers = collectParentTestInstances(context)
            .parallelStream()
            .flatMap(this::findRestartContainers)
            .peek(adapter -> store.getOrComputeIfAbsent(adapter.getKey(), k -> adapter.start()))
            .filter(this::isTestLifecycleAware)
            .map(lifecycleAwareAdapter -> (TestLifecycleAware) lifecycleAwareAdapter.container)
            .collect(Collectors.toList());

        store.put(LOCAL_LIFECYCLE_AWARE_CONTAINERS, lifecycleAwareContainers);
        signalBeforeTestToContainers(lifecycleAwareContainers, testDescriptionFrom(context));
    }
```
这次找的container被testcontainers称为restart container，也就是每个test跑之前都要重启一下的container：标注了`@Container`且非static的field。当然因为这是beforeEach，所以只需要start它们就行，stop操作在afterEach里做。

同样，为了方便，把这些container也放到了store里，等test方法结束后这些非共享container自动就被jupiter关闭了。

最后，回调这些container中的`TestLifecycleAware`类型container的`TestLifecycleAware#beforeTest`。同时把他们放到store里（key=localLifecycleAwareContainers）存起来，准备afterEach的时候调用。

## `AfterEachCallback`
```java
    @Override
    public void afterEach(ExtensionContext context) {
        signalAfterTestToContainersFor(LOCAL_LIFECYCLE_AWARE_CONTAINERS, context);
    }

    private void signalAfterTestToContainersFor(String storeKey, ExtensionContext context) {
        List<TestLifecycleAware> lifecycleAwareContainers = (List<TestLifecycleAware>) context
            .getStore(NAMESPACE)
            .get(storeKey);
        if (lifecycleAwareContainers != null) {
            TestDescription description = testDescriptionFrom(context);
            Optional<Throwable> throwable = context.getExecutionException();
            lifecycleAwareContainers.forEach(container -> container.afterTest(description, throwable));
        }
    }
```java
从store里取出key=localLifecycleAwareContainers的容器，触发afterTest回调。

因为已经交给jupiter自动关闭了，所以这里其实没有在测试方法结束后显式close容器的动作。

## `AfterAllCallback`
```java
    public void afterAll(ExtensionContext context) {
        signalAfterTestToContainersFor(SHARED_LIFECYCLE_AWARE_CONTAINERS, context);
    }
```java
同上，从store里取出key=sharedLifecycleAwareContainers的容器，触发afterTest回调。

同样，因为已经交给jupiter自动关闭了，所以这里其实没有在测试类结束后显式close容器的动作。

## `ExecutionCondition`
`TestcontainersExtension`还实现了`ExecutionCondition`，也算生命周期接口吧。它其实就是判断要不要执行test：

> Evaluate this condition for the supplied ExtensionContext.
An enabled result indicates that the container or test should be executed; whereas, a disabled result indicates that the container or test should not be executed.

对于testcontainers，要不要执行其实就是在没有docker daemon的情况下，测试到底是不跑，还是报错（默认报错）。该行为通过`@Testcontainers(disabledWithoutDocker = true)`控制。

所以testcontainers的`ExecutionCondition`就是在检测`disabledWithoutDocker`的值，并做出相应判断：
```java
    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        return findTestcontainers(context)
            .map(this::evaluate)
            .orElseThrow(() -> new ExtensionConfigurationException("@Testcontainers not found"));
    }
    
    private Optional<Testcontainers> findTestcontainers(ExtensionContext context) {
        Optional<ExtensionContext> current = Optional.of(context);
        while (current.isPresent()) {
            Optional<Testcontainers> testcontainers = AnnotationSupport.findAnnotation(
                current.get().getRequiredTestClass(),
                Testcontainers.class
            );
            if (testcontainers.isPresent()) {
                return testcontainers;
            }
            current = current.get().getParent();
        }
        return Optional.empty();
    }
    
    private ConditionEvaluationResult evaluate(Testcontainers testcontainers) {
        if (testcontainers.disabledWithoutDocker()) {
            if (isDockerAvailable()) {
                return ConditionEvaluationResult.enabled("Docker is available");
            }
            return ConditionEvaluationResult.disabled("disabledWithoutDocker is true and Docker is not available");
        }
        return ConditionEvaluationResult.enabled("disabledWithoutDocker is false");
    }
```xml

也可以看看spring test提供的[`SpringExtension`](https://github.com/spring-projects/spring-framework/blob/d0d5730f7f341c84feb068aa255a170aea3202b4/spring-test/src/main/java/org/springframework/test/context/junit/jupiter/SpringExtension.java)，它已经成junit的范例了。

# 第三方支持
maven、ide都使用了某些入口启动junit。更直观感受就是可以通过[console launcher](https://junit.org/junit5/docs/current/user-guide/#running-tests-console-launcher)启动junit。

launcher：
- https://junit.org/junit5/docs/current/user-guide/#launcher-api

## maven对junit的支持
从2.22.0开始，maven的maven-surefire/failsafe-plugin已经默认支持junit了。

[引入junit jupiter依赖和两个plugin](https://junit.org/junit5/docs/current/user-guide/#running-tests-build-maven-engines-configure)：
```xml
<dependencies>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <version>5.9.1</version>
        <scope>test</scope>
    </dependency>
</dependencies>

<build>
    <plugins>
        <plugin>
            <artifactId>maven-surefire-plugin</artifactId>
            <version>2.22.2</version>
        </plugin>
        <plugin>
            <artifactId>maven-failsafe-plugin</artifactId>
            <version>2.22.2</version>
        </plugin>
    </plugins>
</build>
```

### maven-surefire-plugin
[surefire](https://maven.apache.org/surefire/maven-surefire-plugin/)默认识别以这些开头结尾的类作为测试类：
- `**/Test*.java`
- `**/*Test.java`
- `**/*Tests.java`
- `**/*TestCase.java`

**默认情况下，surefire会[在test phase执行test goal](https://maven.apache.org/surefire/maven-surefire-plugin/test-mojo.html)**，跑这些测试用例。所以不需要手动配置`<executables>`，除非修改了涉及到的测试用例的类，否则配置了也会跳过：
```xml
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <configuration>
                    <excludedGroups>${tag.integration-test}</excludedGroups>
                </configuration>
                <executions>
                    <execution>
                        <id>unit test only</id>
                        <phase>test</phase>
                        <goals>
                            <goal>test</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>
```java
**surefire默认执行的就是test，所以再写一个id为unit test only的execution执行test，跟默认的test一模一样，就跳过了**：
```xml
[INFO] --- maven-surefire-plugin:2.22.2:test (default-test) @ xxx-metric ---
[INFO] 
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.puppylpg.service.UnitTest
[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.108 s - in com.pupylpg.service.UnitTest
[INFO] 
[INFO] Results:
[INFO] 
[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0
[INFO] 
[INFO] 
[INFO] --- maven-surefire-plugin:2.22.2:test (unit test only) @ xxx-metric ---
[INFO] Skipping execution of surefire because it has already been run for this configuration
```java

如果test类识别规则和默认不一致，也可以自定义规则进行覆盖。比如：
- 使用[include/exclude](https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html#overriding-exclude-rules-of-maven-surefire)，把以`IT`（Integration Test）结尾的class也算进来；
- 使用[tag filter](https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html#filtering-by-tags)，只跑带有某些tag的测试用例；

> 显然，maven的surefire对junit的tag做了支持，所以才能使用[`<excludeGroups>`标签](https://maven.apache.org/surefire/maven-surefire-plugin/test-mojo.html#excludedgroups)进行过滤。

可以参考spring-data-elasticsearch，使用surefire插件对unit test和integration test做了区分，使用junit tag对integration test做了过滤。

它把test goal绑定到了两个phase上：test和integration-test，前者excludeGroup，后者使用group进行过滤：
```xml
<plugin>
	<groupId>org.apache.maven.plugins</groupId>
	<artifactId>maven-surefire-plugin</artifactId>
	<configuration>
		<useSystemClassLoader>true</useSystemClassLoader>
		<useFile>false</useFile>
		<includes>
			<include>**/*Tests.java</include>
			<include>**/*Test.java</include>
		</includes>
		<systemPropertyVariables>
			<es.set.netty.runtime.available.processors>false</es.set.netty.runtime.available.processors>
		</systemPropertyVariables>
	</configuration>
	<executions>
		<!-- the default-test execution runs only the unit tests -->
		<execution>
			<id>default-test</id>
			<phase>${mvn.unit-test.goal}</phase>
			<goals>
				<goal>test</goal>
			</goals>
			<configuration>
				<excludedGroups>integration-test</excludedGroups>
			</configuration>
		</execution>
		<!-- execution to run the integration tests against Elasticsearch -->
		<execution>
			<id>integration-test-elasticsearch</id>
			<phase>${mvn.integration-test-elasticsearch.goal}</phase>
			<goals>
				<goal>test</goal>
			</goals>
			<configuration>
				<groups>integration-test</groups>
				<systemPropertyVariables>
					<sde.integration-test.environment>elasticsearch</sde.integration-test.environment>
				</systemPropertyVariables>
			</configuration>
		</execution>
</plugin>
```

### maven-failsafe-plugin
在test和verify之间，还有个叫[integration-test](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html#default-lifecycle)的phase！真正的集成测试应该在integration-test phase执行。可以使用[maven-failsafe-plugin](https://maven.apache.org/surefire/maven-failsafe-plugin/index.html)做这件事情。

> The name (failsafe) was chosen both because it is a synonym of surefire and because it implies that when it fails, it does so in a safe way.

failsafe有两个goal：
- [**在integration-test phase执行的intergation-test goal**](https://maven.apache.org/surefire/maven-failsafe-plugin/integration-test-mojo.html)；
- [**在verify phase执行的verify goal**](https://maven.apache.org/surefire/maven-failsafe-plugin/verify-mojo.html)；

**使用时应该用它的verify goal，因为verify在verify phase，所以能完整做完它前面的`pre-integration-test`/`integration-test`/`post-integration-test`三个phase**。如果直接用它的integration-test goal，只会执行到integration phase，不会做post-integration-test，可能导致集成测试完没有做资源回收。比如jetty server在结束后没有销毁。

比如官方提供的[使用jetty plugin做集成测试](https://maven.apache.org/surefire/maven-failsafe-plugin/usage.html#using-jetty-and-maven-failsafe-plugin)的例子：为了能做web的集成测试，需要启动一个jetty server，因此使用[jetty-maven-plugin](https://maven.apache.org/plugins/maven-war-plugin/examples/rapid-testing-jetty6-plugin.html)并把它的start goal绑定到pre-integration-test phase，就能在integration-test之前启动jetty server。

[failsafe默认按照这些类名过滤测试用例](https://maven.apache.org/surefire/maven-failsafe-plugin/examples/junit-platform.html#filtering-by-test-class-names-for-maven-failsafe)，在verify阶段跑这些用例：
- `**/IT*.java`
- `**/*IT.java`
- `**/*ITCase.java`

同理，也可以使用[include/exclude](https://maven.apache.org/surefire/maven-failsafe-plugin/examples/junit-platform.html#overriding-exclude-rules-of-maven-failsafe)或者[tag filter](https://maven.apache.org/surefire/maven-failsafe-plugin/examples/junit-platform.html#filtering-by-tags)自定义要执行的测试用例。

### 使用testcontainers跑集成测试
testcontainers虽然是集成测试，但它不像jetty有jetty plugin支持，能在pre-integration-test阶段启动，所以可以像spring-data-elasticsearch那样把它放在surefire里。

不过也可以把所有使用testcontainers的测试类放在integration-test阶段，使用failsafe触发它。只不过此时不需要像jetty一样使用“testcontainers的plugin”启动一个container而已。

可以配置surefire跑不带`@Tag("intergation-test")`的测试用例，而failsafe只跑带有`@Tag("intergation-test")`的测试用例：
```xml
<properties>
    <!-- tag to mark integration test -->
    <tag.integration-test>integration-test</tag.integration-test>
</properties>

<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-surefire-plugin</artifactId>
    <configuration>
        <!-- 只做非集成测试 -->
        <excludedGroups>${tag.integration-test}</excludedGroups>
    </configuration>
</plugin>
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-failsafe-plugin</artifactId>
    <configuration>
        <!-- 只做集成测试 -->
        <includes>**/*</includes>
        <groups>${tag.integration-test}</groups>
    </configuration>
</plugin>
```java

> 假设`tag.integration-test=intergation-test`，且所有的测试类都符合`*Test.java`。此时failsafe一定要覆盖掉默认的includes，否则includes获取到的测试类为空（它的默认配置是获取带`IT`的测试类），导致groups过滤在includes的基础上进行过滤后还是空。

此时测试用例分成了两拨，`mvn test`只跑非集成测试的那波，`mvn verify`（涵盖了test phase）先跑非集成测试的测试类，再跑集成测试的测试类。

# junit vs. assertj
junit是测试框架，框架就意味着它有生命周期，需要在生命周期的不同阶段做不同的事情，触发不同的回调等等。assertj只是一个更方便的断言工具，让断言写起来更高效。

# 感想
第一次听说junit是大学老师让写单元测试测试自己的代码。但是当时对使用Java写程序尚不甚明了，更不能体会单元测试的意图了。写出来的单元测试也很敷衍，反正ide也支持，一点按钮就跑起来了。后来工作了，用Java写工程已经上道儿了，也体会到了单元测试的好处。但是junit用了那么久，却从来没有好好看过junit大概是个什么样的架构，也没看过它的官方文档，导致写出来的单元测试一直处于很低级的层面。终于今年被没有单元测试集成测试的代码的测试复杂度恶心到了，一定要给springboot工程加上单元测试和集成测试，发现想学习springboot的test，还是要先大致了解junit。从那一刻开始，看了springboot的源码，看了spring的源码，中间又用了docker，上了gitlab-ci，跑testcontainers，用assertj做断言，然后一切又连起来了：testcontainers要用docker，使用gitlab-ci docker runner的dind，有自己的jupiter @ExtendWith拓展，兜兜转转，回到了最初的起点。今天终于把junit jupiter的架构稍微看了看……

下一步，终于又是springboot test了~


