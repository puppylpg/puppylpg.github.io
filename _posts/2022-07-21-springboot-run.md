---
layout: post
title: "SpringBoot - run"
date: 2022-07-21 21:40:28 +0800
categories: springboot
tags: springboot
---

为了写springboot的test case，把springboot test的文档看了一遍。看完之后感觉需要把springboot的整体流程看一下，于是跟着Spring Boot 1.0.2从入口debug走了一遍，发现超乎想象得流畅——

1. Table of Contents, ordered
{:toc}

# 入口
springboot的启动代码很简单。如果需要`CommandLineRunner`，写得就多一些。不需要的话写的代码就非常少：
```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @Bean
    public CommandLineRunner commandLineRunner(ApplicationContext ctx) {
        return args -> {

            System.out.println("Let's inspect the beans provided by Spring Boot:");

            String[] beanNames = ctx.getBeanDefinitionNames();
            Arrays.sort(beanNames);
            for (String beanName : beanNames) {
                System.out.println(beanName);
            }

        };
    }

}
```

**Spring Boot从1.2.0才开始有`@SpringBootApplication`注解**……所以1.0.2的代码可以这么写：
```java
@Configuration
@EnableAutoConfiguration
@Import({ApplicationConfig.class, WebConfig.class, SecurityConfig.class})
public class SpringBootRunner {

	public static void main(String[] args) {
		SpringApplication.run(SpringBootRunner.class, args);
	}

}
```
把@Import换成@ComponentScan也行。那么就和@SpringBootApplication一样了，@SpringBootApplication只不过是上面一堆注解的简单聚合：
```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan(excludeFilters = { @Filter(type = FilterType.CUSTOM, classes = TypeExcludeFilter.class),
		@Filter(type = FilterType.CUSTOM, classes = AutoConfigurationExcludeFilter.class) })
public @interface SpringBootApplication {
```

> @SpringBootConfiguration其实是@Configuration的alias。所以一样了。

# 核心语句
```java
SpringApplication.run(SpringBootRunner.class, args);
```
把springboot的启动类作为参数传给run。为什么把启动类作为参数？顺着run看实现，基本就都明白了：**其实是把启动类当配置类使用了**。

上述run方法是下面的包装：
```java
new SpringApplication(sources).run(args)
```
做了两件事：
1. 初始化SpringApplication，把启动类作为source。source就是配置类；
2. 启动spring ApplicationContext（带着args参数）；

args参数的用途：
- 比如`--spring.profiles.active=prod`，可以从里面获取使用的profile；
- 交给CommandLineRunner，作为他们的入参。毕竟是CommandLineRunner，本来就是为了处理command line参数的；
- 作为spring boot的唯一SpringApplicationRunListener的初始化参数，它在发布事件的时候，连args一起作为事件参数；

# 初始化SpringApplication
```java
	private void initialize(Object[] sources) {
		if (sources != null && sources.length > 0) {
			this.sources.addAll(Arrays.asList(sources));
		}
		this.webEnvironment = deduceWebEnvironment();
		setInitializers((Collection) getSpringFactoriesInstances(ApplicationContextInitializer.class));
		setListeners((Collection) getSpringFactoriesInstances(ApplicationListener.class));
		this.mainApplicationClass = deduceMainApplicationClass();
	}
```

1. **传入的启动类作为配置类**；
2. 判断启动的是web环境还是普通环境；
3. 加载ApplicationContextInitializer类：**很简单，就是initialize ApplicationContext的，改点儿ApplicationContext的东西**；
4. 加载ApplicationListener类：**自定义的listener，监听发往ApplicationContext的自定义事件的**；
5. 推断main函数所在的类：这个贼牛逼，直接`new RuntimeException().getStackTrace()`获取栈帧，然后遍历stacktrace，判断哪个栈帧的method是main，它对应的类就是启动类；

这里获取ApplicationContextInitializer和ApplicationListener并不是从SpringApplication里获取的，因为还没创建SpringApplication。**它使用的是springboot的SPI**：
- 从classpath下加载所有的`META-INF/spring.factories`文件；
- 读取每一个文件的内容，其实就是key-value，也就是Java的Properties；
- 如果properties的key是ApplicationContextInitializer或者ApplicationListener，就获取他们的值；

因为文件的名字叫`spring.factories`，所以干这个活儿的类就是SpringFactoriesLoader，和文件名相照应。

为什么要使用SPI加载这两类bean？为什么不在SpringApplication启动后直接获取？**因为这是springboot想创建的类，不是我们想创建的，所以我们不会@ComponentScan这些类。springboot只能用SPI自己加载了**。包括其他的springboot相关的包，也可以借助这种SPI机制加载。**springboot内部有非常多的靠SPI加载的类，最典型的就是做autoconfig的类**。

> 还有一个原因是，需要在spring ApplicationContext创建好之前，就开始进行事件发布，这些listener无法利用ApplicationContext，只能通过spi手动加载。

`org.springframework.boot:spring-boot`包的`spring.factories`:
```properties
# PropertySource Loaders
org.springframework.boot.env.PropertySourceLoader=\
org.springframework.boot.env.PropertiesPropertySourceLoader,\
org.springframework.boot.env.YamlPropertySourceLoader

# Run Listeners
org.springframework.boot.SpringApplicationRunListener=\
org.springframework.boot.context.event.EventPublishingRunListener

# Application Context Initializers
org.springframework.context.ApplicationContextInitializer=\
org.springframework.boot.context.ContextIdApplicationContextInitializer,\
org.springframework.boot.context.config.DelegatingApplicationContextInitializer

# Application Listeners
org.springframework.context.ApplicationListener=\
org.springframework.boot.builder.ParentContextCloserApplicationListener,\
org.springframework.boot.cloudfoundry.VcapApplicationListener,\
org.springframework.boot.context.FileEncodingApplicationListener,\
org.springframework.boot.context.config.ConfigFileApplicationListener,\
org.springframework.boot.context.config.DelegatingApplicationListener,\
org.springframework.boot.liquibase.LiquibaseServiceLocatorApplicationListener,\
org.springframework.boot.logging.ClasspathLoggingApplicationListener,\
org.springframework.boot.logging.LoggingApplicationListener
```

# run
执行SpringApplication的创建工作。这个过程很流畅，因为每做完一步都会使用SpringApplicationRunListener发送事件，所以跟着这个事件看就行了，相当于做总结了。

run的第一步就是和上面一模一样的流程：从spring.factories里获取SpringApplicationRunListener的实现类。在spring.factories里，配置的是springboot实现的唯一SpringApplicationRunListener实现类EventPublishingRunListener。

这个类用于监听springboot启动的事件，然后发送spring的事件（套娃233）。监听spring事件的ApplicationListener对其做出响应。

但问题来了，这个listener需要处理的事件有：
- started
- environmentPrepared
- contextPrepared
- contextLoaded
- finished

也就是说，spring ApplicationContext在contextLoaded之后才算初始化完毕，或者至少在contextPrepared的时候，context才创建好。在此之前，怎么利用ApplicationContext发送spring事件？

实现的时候，springboot跳过了这一点，它发布的这些spring事件没有使用spring的ApplicationContext：
- 在initialize里，springboot利用自己的SPI机制，初始化了一堆ApplicationListener，这些listener就是springboot在启动过程中发送的spring事件的受众；
- springboot发布spring事件的时候，直接从这些初始化好的listener里选取合适的进行调用了；

**所以spring为什么在创建ApplicationContext之前，就迫不及待使用自己的SPI机制提前初始化好一堆ApplicationListener的原因找到了**：
1. 确实如前所述，springboot写的这些bean不在@ComponentScan的范围内；
2. **更重要的是，这些ApplicationListener要在ApplicationContext存在之前就使用到**。所以他们没办法等ApplicationContext去初始化他们；

> 在springboot的[core文档](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.spring-application.application-events-and-listeners)里也得到了证实。

同理，springboot自己的这个SpringApplicationRunListener也要在ApplicationContext存在之前就存在，所以提前用SPI机制实例化好了。

那ApplicationContextInitializer为啥也急着用SPI初始化？大概是ApplicationContextInitializer的设计就是在ApplicationContext完全准备好之前就需要发挥作用，所以没法等到ApplicationContext创建好之后再有。按照它的使用场景来看，这个接口好像是springboot定义的，其实它是spring定义的。spring用它主要是初始化web的ApplicationContext。

接下来就可以跟着springboot的SpringApplicationRunListener看springboot怎么启动spring ApplicationContext的了——

## started ~ environmentPrepared

时间点：SpringApplication开始启动了，一直到environment创建后、ApplicationContext创建前。

根据是否是web环境，决定创建哪一个ConfigurableEnvironment：
- StandardServletEnvironment：servlet服务
- 或者StandardEnvironment：普通程序

这都是spring的environment。

Environment接口的主要方法：
- `String[] getActiveProfiles()`;
- `String[] getDefaultProfiles()`;

**它同时也是PropertyResolver接口，所以还要负责解析properties**：
- `String getProperty(String key)`：获取property的value；
- `String resolvePlaceholders(String text)`;

一般不直接用Environment接口，用的是它的子接口ConfigurableEnvironment：
- `MutablePropertySources getPropertySources()`：获取所有的property sources；
- `void merge(ConfigurableEnvironment parent)`：Append the given parent environment's active profiles, default profiles and property sources to this (child) environment's respective collections of each；
- `void setActiveProfiles(String... profiles)`：设置profiles；
- `void setDefaultProfiles(String... profiles)`;

> PropertySources是PropertySource的聚合体，每个PropertySource一个name。PropertySource是键值对的集合，理解为jdk的Properties或者Map都行。

### 环境
Environment代表app的运行环境，主要是两方面：
1. properties
2. profiles

ConfigurableEnvironment主要体现在“可配置”。所以主要就是可以设置active和default profiles，可以操作property sources。

#### 各种property
`AbstractEnvironment`会在初始化的时候调用`customizePropertySources(propertySources)`。假设创建的是StandardEnvironment，**它会在创建的时候就配置两个PropertySource（`StandardEnvironment#customizePropertySources`）**：
- **名为`systemProperties`的`PropertiesPropertySource`**：使用`System.getProperties()`获取，结果是map，所以构建为Properties，实例化为PropertiesPropertySource。内容大概有：
    + os.arch -> amd64
    + user.name -> puppylpg
    + user.dir -> C:\Users\puppylpg\Codes\Java\spring-boot-example
- **名为`systemEnvironment`的`SystemEnvironmentPropertySource`**：使用`System.getenv()`获取，结果也是map。不过实例化的时候用的是SystemEnvironmentPropertySource。内容大概有：
    + JAVA_HOME -> C:\Program Files\Java\jdk1.8.0_191
    + USERNAME -> puppylpg
    + Path -> C:\Program Files (x86)\Common……

> 这下加深记忆了system env和system properties。

**他俩是有先后顺序的**，这个顺序其实是取值的优先级。

> 如果是servlet相关的environment，还会在这俩之前注册`servletConfigInitParams`和`servletContextInitParams`。所以也可以看出来servlet config的优先级高于servlet context，二者都高于system property和system environment。

**最终这个property sources被保存到了`AbstractEnvironment#propertySources`。**

创建完`ConfigurableEnvironment`后，接下来就是赋值了。赋值当然也是两方面：
1. set property sources：如果command line有值，就构建一个`SimpleCommandLinePropertySource`，**添加到property source的最前面**（`addFirst(new SimpleCommandLinePropertySource(args))`）；
2. set profiles：根据cmd args配置profile。**注意，此时的profiles不是从所有的property sources里找的。此时`application.yml`还没有注册为property source，所以还没有涉及到解析配置文件里的`spring.profiles.active`**；

> 为什么springboot的args要写成：`--spring.profiles.active=prod`，因为springboot使用的是spring的CommandLineArgs来解析args，所以它就得`--`开头：https://stackoverflow.com/a/37439625/7676237

同时也理解了：**springboot是使用list存了一堆PropertySource，需要取某个property的时候，从前往后取。这个顺序就是优先级顺序。**

**spring boot的配置实际上遵从[这么一个优先级](https://docs.spring.io/spring-boot/docs/1.5.6.RELEASE/reference/html/boot-features-external-config.html)：command line args是比较高的优先级，毕竟是用户在执行程序的时候手动指定的。system properties和os environment靠后，properties文件在更靠后**。

不同property的设置方式：
- 如果是command line args（main函数类后指定的args），那就给property前面加上`--`；
- 如果是system properties（java指令后，main函数类前），那就给property前面加上`-D`；
- 如果是os env，那就把property大写，并使用下划线代替dot，比如（HELLO_WORLD=nice），会给`hello.world` perperty设置值`nice`；

> If you use environment variables rather than system properties, most operating systems disallow period-separated key names, **but you can use underscores instead (e.g. `SPRING_CONFIG_NAME` instead of `spring.config.name`)**

第一种第二种本地跑的时候比较有用。**第三种在docker/k8s上执行的时候非常有用**，毕竟镜像的cmd不好改，env可以随便加。**对于点分的property，要换成下换下，比如`ELASTICSEARCH_INDEX_STOREDKOL_NAME`**。

> 显然system properties优先级要高于os env，因为前者需要在命令行里指定。

#### profiles
有了property，就可以通过property配置profiles：
- **从PropertySources里取`spring.profiles.active`**；

**取property是一个遍历PropertySource的过程，找到就return。所以list的位置就代表了优先级，开头的PropertySource优先级最高。一般是命令行参数PropertySource。**

拿到profiles之后，配置了一个：
- **名为`configurationProperties`的`ConfigurationPropertySources`**：配置在最开头，我也不知道有啥用……

如果指定了多个profiles，使用[last win strategy](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.external-config.files.profile-specific)。比如`spring.profiles.active=prod,live`，`application-prod.properties`里的值会被`application-live.properties`里的覆盖。

> profile specific property的取值逻辑是springboot自己定义的，按照上面介绍的property的取值逻辑，springboot实现的时候，大概是把`application-live.properties`作为了PropertySource list的靠前节点，`application-prod.properties`作为了靠后节点。

最后发送environmentPrepared事件，调用listener处理。**等一下，environment设置完了？但是貌似到现在一直没有处理`application.properties`？**

就在以为只是平平无奇发个事件调用listener处理的时候，listener来搞事情了。有一个ApplicationListener叫`ConfigFileApplicationListener`，一听就是处理配置文件的！果然，它先使用SPI机制获取EnvironmentPostProcessor:
```properties
org.springframework.boot.env.EnvironmentPostProcessor=\
org.springframework.boot.cloud.CloudFoundryVcapEnvironmentPostProcessor,\
org.springframework.boot.env.SpringApplicationJsonEnvironmentPostProcessor,\
org.springframework.boot.env.SystemEnvironmentPropertySourceEnvironmentPostProcessor,\
org.springframework.boot.reactor.DebugAgentEnvironmentPostProcessor
```
然后它自己也是个post processor。这些post processor是处理environment的。

别的都不说，单说ConfigFileApplicationListener自身。**它的目的就是**：
- **从`spring.config.location`，默认是**
    + file:./config/
    + file:./config/*/
    + file:./
    + classpath:config/
    + classpath:
- **的下面加载`spring.config.name`，默认是`application`**
- **的各种格式，默认有两类格式**
    + properties格式：后缀为`properties`或者`xml`；
    + yaml格式：后缀为`yml`/`yaml`；
- **的配置文件**。

**所以它就是spring boot配置文件配置方式的秘密！**

其中location和name是从之前的PropertySources里取的。配置完成后，PropertySources的最后多了一个（或多个）类似application.yml的配置，都是OriginTrackedMapPropertySource类型。

> **比如用的是dev profile，那PropertySources里会在末尾依次添加两个`OriginalTrOriginalTrackedMapPropertySource`：`application-dev.yml`和`applicaiton.yml`**。因此dev profile的配置会优先于default profile，也就是上面说的last win strategy。

所以在properties文件里，也可以使用`spring.profiles.active`指定使用的profiles，但是只能在默认的`application.yml/properties`里指定，不能在profile specific files里指定。比如不能在application-dev.yml里指定spring.profiles.active=dev，指定也没卵用。毕竟boot都不知道启用了dev profile，又怎么能知道dev里指定的active的profiles呢。
> - https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.profiles

这就产生了一个有意思的事情：profiles从`application.properties`里获取，获取profiles之后，把profiles-specific properties放到链表里`application.properties`的前面，所以优先级反而比`application.properties`高。

所以都可以通过啥set profiles？只要不是profiles-specific properties就行。比如系统环境变量、系统properties，或者用户的命令行参数**！也就是之前说的args。**ConfigurableEnvironment有一堆PropertySource，命令行参数也是PropertySource的一种！所以命令行参数就作为一种PropertySource注册到ConfigurableEnvironment上了。

最后的最后，ConfigFileApplicationListener不止做这个：
- environmentPrepared：除了在这个阶段加载各种配置文件；
- contextLoaded：还会在bean加载完之后，给ApplicationContext注册一个PropertySourceOrderingPostProcessor，用于处理@PropertySource相关的内容；


> 对于容器来讲，**发送事件其实就是调用listener处理事件……**

## ~ contextPrepared

时间点：创建ApplicationContext之后，加载配置解析bean到ApplicationContext之前。

此处有个小彩蛋：springboot在这里决定是否print banner，也就是：
```java
	private static final String[] BANNER = { "",
			"  .   ____          _            __ _ _",
			" /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\",
			"( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\",
			" \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )",
			"  '  |____| .__|_| |_|_| |_\\__, | / / / /",
			" =========|_|==============|___/=/_/_/_/" };
```
springboot是把它一行行提前存为string数组了，需要打就一行行打出来。也可以设置`SpringApplication#showBanner(false)`不让它打。

创建ApplicationContext：
- web就是AnnotationConfigEmbeddedWebApplicationContext：这个是springboot的
- 否则就是AnnotationConfigApplicationContext：spring的；

直接使用BeanUtils.instantiate实例化它。

然后让ApplicationContext给JVM注册shutdownhook。spring的ApplicationContext的抽象实现类都有这个方法：
```java
	@Override
	public void registerShutdownHook() {
		if (this.shutdownHook == null) {
			// No shutdown hook registered yet.
			this.shutdownHook = new Thread() {
				@Override
				public void run() {
					doClose();
				}
			};
			Runtime.getRuntime().addShutdownHook(this.shutdownHook);
		}
	}
```
用于关闭spring的ApplicationContext。

接着把上面创建好的Environment设置到ApplicationContext里，方便后续使用。

最后发送contextPrepared事件。

## ~ contextLoaded：解析加载bean到ApplicationContext
终于要加载配置到ApplicationContext了！这样的ApplicationContext才是完整的ApplicationContext！

配置类是哪个？就是
```java
		SpringApplication.run(SpringBootRunner.class, args);
```
就是springboot的启动类。

启动类有@SpringBootApplication注解，它既是@Configuration，又有@ComponentScan，所以可以找到一堆配置类（或者xml）。

加载过程：
```java
	protected void load(ApplicationContext context, Object[] sources) {
		BeanDefinitionLoader loader = createBeanDefinitionLoader(
				getBeanDefinitionRegistry(context), sources);
		if (this.beanNameGenerator != null) {
			loader.setBeanNameGenerator(this.beanNameGenerator);
		}
		if (this.resourceLoader != null) {
			loader.setResourceLoader(this.resourceLoader);
		}
		if (this.environment != null) {
			loader.setEnvironment(this.environment);
		}
		loader.load();
	}
```
创建BeanDefinitionLoader：它是xml、java config的聚合体，里面XmlBeanDefinitionReader/AnnotatedBeanDefinitionReader/GroovyBeanDefinitionReader都有，所以啥类型的配置都能加载。它里面还有一个ClassPathBeanDefinitionScanner，从classpath扫描“component class”（同时创建一个包含启动类的ClassExcludeFilter，放防止自己再扫描一遍，无限递归了……）；

加载bean，BeanDefinitionLoader#load：
```java
	public int load() {
		int count = 0;
		for (Object source : this.sources) {
			count += load(source);
		}
		return count;
	}
	
	private int load(Object source) {
		Assert.notNull(source, "Source must not be null");
		if (source instanceof Class<?>) {
			return load((Class<?>) source);
		}
		if (source instanceof Resource) {
			return load((Resource) source);
		}
		if (source instanceof Package) {
			return load((Package) source);
		}
		if (source instanceof CharSequence) {
			return load((CharSequence) source);
		}
		throw new IllegalArgumentException("Invalid source type " + source.getClass());
	}
```
判断source的类型，如果是java class就使用上述AnnotatedBeanDefinitionReader加载：
```java
	private int load(Class<?> source) {
		if (isGroovyPresent()) {
			// Any GroovyLoaders added in beans{} DSL can contribute beans here
			if (GroovyBeanDefinitionSource.class.isAssignableFrom(source)) {
				GroovyBeanDefinitionSource loader = BeanUtils.instantiateClass(source,
						GroovyBeanDefinitionSource.class);
				load(loader);
			}
		}
		if (isComponent(source)) {
			this.annotatedReader.register(source);
			return 1;
		}
		return 0;
	}
```
**其中`isComponent(source)`是在判断这个类是不是配置类**。判断标准是该类的注解或注解的注解是否含有@Component。而@SpringBootApplication含有@Configuration，@Configuration含有@Component。**所以所有人都是@Component，@Configuration也是。怪不得说“component class”**。

然后就是spring注册配置类的方式了：`AnnotatedBeanDefinitionReader#register(Class<?>... annotatedClasses)`。

配置加载完毕！发送并处理contextLoaded事件。

## ~ finished：刷新ApplicationContext，结束配置
然后就是调用大名鼎鼎的`AbstractApplicationContext#refresh()`了。

之后springboot执行所有自己设计的CommandLineRunner，这时候ApplicationContext已经启动并配置完毕了，springboot可以直接从里面拿CommandLineRunner类型的bean了：
```java
List<CommandLineRunner> runners = new ArrayList<CommandLineRunner>(context
				.getBeansOfType(CommandLineRunner.class).values());
```
排序并执行：
```java
		AnnotationAwareOrderComparator.sort(runners);
		for (CommandLineRunner runner : runners) {
			try {
				runner.run(args);
			}
			catch (Exception ex) {
				throw new IllegalStateException("Failed to execute CommandLineRunner", ex);
			}
		}
```
> 所以CommandLineRunner是支持排序的。

发送finished事件！完结，撒花，打印start up log（同样可以设置为不打印）。

# springboot
学习spring的非常好的工程！相当于帮忙从大框架上梳理spring了！

`spring.factories`里还有很多其他类的配置，什么时候加载的？想什么时候加载就什么时候加载……反正是SPI


# autoconfig
@EnableAutoConfiguration什么时候生效的

AutoConfigurationImportSelector搞的它，而这个selector是一个DeferredImportSelector，**这种selector在所有的配置bean都处理过之后才会生效，所以很适合@Conditional**：A variation of ImportSelector that runs after all @Configuration beans have been processed. This type of selector can be particularly useful when the selected imports are @Conditional.



Auto-configurations must be loaded that way only. Make sure that they are defined in a specific package space and that they are never the target of component scanning. Furthermore, auto-configuration classes should not enable component scanning to find additional components. Specific @Imports should be used instead.

You can use the @AutoConfigureAfter or @AutoConfigureBefore annotations if your configuration needs to be applied in a specific order. **For example, if you provide web-specific configuration, your class may need to be applied after WebMvcAutoConfiguration.**



springboot test autoconfig的ApplicationContextRunner其实也相当于自己配置了一个ApplicationContext。
- https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.developing-auto-configuration.testing

定义的这些是不是构建context的最小集合？
```java
			this.contextFactory = source.contextFactory;
			this.allowBeanDefinitionOverriding = source.allowBeanDefinitionOverriding;
			this.allowCircularReferences = source.allowCircularReferences;
			this.initializers = source.initializers;
			this.environmentProperties = source.environmentProperties;
			this.systemProperties = source.systemProperties;
			this.classLoader = source.classLoader;
			this.parent = source.parent;
			this.beanRegistrations = source.beanRegistrations;
			this.configurations = source.configurations;
```

- 现在的测试用runner：https://github.com/spring-projects/spring-boot/blob/main/spring-boot-project/spring-boot-autoconfigure/src/test/java/org/springframework/boot/autoconfigure/jackson/JacksonAutoConfigurationTests.java
- 以前的测试直接用application context：https://github.com/spring-projects/spring-boot/blob/2.7.x/spring-boot-project/spring-boot-autoconfigure/src/test/java/org/springframework/boot/autoconfigure/jackson/JacksonAutoConfigurationTests.java
- autoconfig还有集成测试，好像用的docker……：https://github.com/spring-projects/spring-boot/blob/2.7.x/spring-boot-project/spring-boot-autoconfigure/src/test/java/org/springframework/boot/autoconfigure/elasticsearch/ElasticsearchRestClientAutoConfigurationIntegrationTests.java

不用enable configuration properties，不会产生这个bean，导致配置失败：
> 14:08:11.760 [main] DEBUG org.springframework.beans.factory.support.DefaultListableBeanFactory - Creating shared instance of singleton bean 'org.springframework.boot.context.properties.BoundConfigurationProperties'


