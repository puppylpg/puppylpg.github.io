---
layout: post
title: "Spring - run"
date: 2022-07-21 21:41:28 +0800
categories: spring
tags: spring
---

springboot既然都走一遭了，spring也走一遭吧。

1. Table of Contents, ordered
{:toc}

# `BeanFactory`
首先说一下spring最核心的BeanFactory接口。看到这个接口的第一印象是这个接口太复杂了！它衍生出了各种子接口，看得人眼花缭乱。但其实如果这么想，是把问题想颠倒了——与其说BeanFactory接口多，不如说BeanFactory功能多。而spring把BeanFactory拆解为一系列接口和衍生子接口，正是为了拆解BeanFactory的功能，把这些功能分门别类进行管理，使之变得有条理起来。如果不进行拆分，把所有的接口方法全扔到BeanFactory里，那才叫窒息！

现在再看BeanFactory及其子接口，瞬间变得亲切起来：
- BeanFactory：获取bean，比如getBean，可以用name获取bean，也可以用class类型获取该类型的bean。主要就是lookup；
- ListableBeanFactory：列出所有的bean，主要是traverse；
- HierarchicalBeanFactory：很简单的接口，和父子容器相关
    + getParentBeanFactory：指向parent的指针
    + containsLocalBean：不考虑parent，只看自己这一层有没有某个bean；
- AutowireCapableBeanFactory：bean的注入规则：AUTOWIRE_BY_NAME/AUTOWIRE_BY_TYPE/AUTOWIRE_CONSTRUCTOR；
- ConfigurableBeanFactory：配置BeanFactory，比如配置BeanPostProcessor；

还有一些没有拓展BeanFactory的接口，但也是在拓展BeanFactory的功能，ApplicationContext基本都实现了这些接口：
- BeanDefinitionRegistry：作为注册中心，注册BeanDefinition；
- SingletonBeanRegistry：专门注册、获取singleton bean的地方；

经过这么一拆解，BeanFactory的繁多的功能显得有条理了一些。而BeanFactory的实现类基本把上面的大部分接口都实现了，比如下面介绍的ApplicationContext。

# `ApplicationContext`
**如果说BeanFactory是发动机，那么ApplicationContext就是一辆完整的车：它以发动机为核心，同时配备了底盘、轮胎、车架、刹车等等系统。所以ApplicationContext才是面向程序员的接口，相较之下，BeanFactory显得有点儿太底层了。**

ApplicationContext，看它的接口定义：
```java
interface ApplicationContext extends EnvironmentCapable, ListableBeanFactory, HierarchicalBeanFactory,
		MessageSource, ApplicationEventPublisher, ResourcePatternResolver
```
它是这么多接口的集合，其中包括BeanFactory，所以它自然比BeanFactory强：
- Bean factory methods for accessing application components. Inherited from ListableBeanFactory.
- 它继承了ResourcePatternResolver接口，而后者继承了ResourceLoader，所以只需要告诉ApplicationContext config的地址，它是可以直接加载配置的：The ability to load file resources in a generic fashion. Inherited from the org.springframework.core.io.ResourceLoader interface.
- The ability to publish events to registered listeners. Inherited from the ApplicationEventPublisher interface.
The ability to resolve messages, supporting internationalization. Inherited from the MessageSource interface.
- EnvironmentCapable，所以它contains and exposes an Environment reference；

它主要就是这些接口的聚合体，是一个能直接加载config的context。

# `BeanDefinitionReader` + `ClassPathBeanDefinitionScanner`

AnnotationConfigApplicationContext还实现了BeanDefinitionRegistry接口。

- BeanDefinition getBeanDefinition(String beanName)
- registerBeanDefinition(String beanName, BeanDefinition 
- beanDefinition)removeBeanDefinition(String beanName)

先初始化AnnotatedBeanDefinitionReader。（此处涉及到BeanNameGenerator，默认是AnnotationBeanNameGenerator）。

获取Environment。在AbstractApplicationContext里，如果没有就创建一个StandardEnvironment（profiles + properties）。这一步和springboot new StandardEnvironment是一毛一样的。

Environment:
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-environment
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-definition-profiles-enable

**还涉及到ConditionEvaluator，evaluate `@Conditional`**。

要给context（registry）注册annotation post processors，所以创建了一个DefaultListableBeanFactory。给这个bean factory设置AnnotationAwareOrderComparator，用于支持@Ordered。还要给bean factory设置AutowireCandidateResolver的实现者ContextAnnotationAutowireCandidateResolver，用于识别bean是否符合某个注入策略（按类型注入、按名称注入等。@Resource的怨念……），还能支持@Lazy。

然后手动给registry添加：
- ConfigurationClassPostProcessor，它实际是ConfigurationClassPostProcessor
- AutowiredAnnotationBeanPostProcessor
- RequiredAnnotationBeanPostProcessor
- CommonAnnotationBeanPostProcessor
- EventListenerMethodProcessor
- DefaultEventListenerFactory
- （如果检测到JPA的类）PersistenceAnnotationBeanPostProcessor


> **所以spring容器需要用到的组件自己不是靠@Bean注册上去的……因为spring容器这一套初始化好了之后，才支持@Bean，@Configuration……这个时候spring也得像我们一样，自己组装组件去写代码。**
>
> springboot在spring的context完成之前，则是使用SPI注册组件。

AnnotatedBeanDefinitionReader初始化结束。

然后创建ClassPathBeanDefinitionScanner。第二个new的是用来扫描base package的bean definition scanner……

ClassPathBeanDefinitionScanner，它会包含：
- include filter
- exclude filter

所以此处又定义了TypeFilter接口。

默认注册的include filter：
- AnnotationTypeFilter，@Component
- AnnotationTypeFilter，javax.annotation.ManagedBean（如果有的话。如果ClassNotFoundException，那说明没有，就不加载了。又是一个trick），JSR-250
- AnnotationTypeFilter，javax.inject.Named，JSR-330

AbstractTypeHierarchyTraversingFilter是AnnotationTypeFilter的父类，还挺有意思的：先看这个类有没有目标annotation，再看这个类的父类有没有annotation。


# register config class

注册bean，涉及到BeanDefinition、AnnotatedBeanDefinition接口。
- isPrimary
- isSingleton
- isLazyInit
- isAutowireCandidate

等等，和bean的配置相关的东西。

用一个StandardAnnotationMetadata代表这个config class的AnnotationMetadata：
- 比如annotation的attributes
- 是否有标注了某个annotation的方法：boolean hasAnnotatedMethods(String annotationName);
- 是否标注了某个annotation：boolean isAnnotated(String annotationName);

等等。

**这时候就要用ConditionEvaluator判断了：如果是@Conditional标记的类，就判断一下是不是应该跳过。**

> 注意：这里只是判断是否跳过，并不是不处理。如果符合@Conditional的条件，是要直接处理的。**@Conditional并不代表最后处理**！只是在springboot的实现中，它的那些auto configuration类上标注的@Conditional是需要最后处理的。他们最后被处理是因为他们是为了做auto configuration，而不是因为他们是@Conditional。

@Configuration的类，本身会被配置为一个bean。会从annotation获取配置的信息。比如如果有@Description，就获取内容，set到BeanDefinition的description里。

# refresh
refresh和destroy都不允许并发，所以加锁。

## prepare refresh
```java
		// Initialize any placeholder property sources in the context environment
		initPropertySources();

		// Validate that all properties marked as required are resolvable
		// see ConfigurablePropertyResolver#setRequiredProperties
		getEnvironment().validateRequiredProperties();
```
也没看出来要干啥。第一个好像是org.springframework.web.context.support.WebApplicationContextUtils.initServletPropertySources子类才override了这个空方法。

## prepare bean factory
设置一堆东西：
- StandardBeanExpressionResolver，好像是处理spel的。BeanExpressionResolver接口；
- ResourceEditorRegistrar：往PropertyEditorRegistrar里注册处理某个class所使用的PropertyEditor。具体编辑啥，后面可以查查
- ApplicationContextAwareProcessor，它是一个BeanPostProcessor。**用于给所有xxxAware的bean设置xxx。真省事儿，一个bean post processor就设置完了**。**注意，这个bean post processor是直接手动`addBeanPostProcessor`添加到ApplicationContext里的**
    ```java
    	private void invokeAwareInterfaces(Object bean) {
    		if (bean instanceof Aware) {
    			if (bean instanceof EnvironmentAware) {
    				((EnvironmentAware) bean).setEnvironment(this.applicationContext.getEnvironment());
    			}
    			if (bean instanceof EmbeddedValueResolverAware) {
    				((EmbeddedValueResolverAware) bean).setEmbeddedValueResolver(
    						new EmbeddedValueResolver(this.applicationContext.getBeanFactory()));
    			}
    			if (bean instanceof ResourceLoaderAware) {
    				((ResourceLoaderAware) bean).setResourceLoader(this.applicationContext);
    			}
    			if (bean instanceof ApplicationEventPublisherAware) {
    				((ApplicationEventPublisherAware) bean).setApplicationEventPublisher(this.applicationContext);
    			}
    			if (bean instanceof MessageSourceAware) {
    				((MessageSourceAware) bean).setMessageSource(this.applicationContext);
    			}
    			if (bean instanceof ApplicationContextAware) {
    				((ApplicationContextAware) bean).setApplicationContext(this.applicationContext);
    			}
    		}
    	}
    ```
- 既然上面的这些xxxAware都会被ApplicationContextAwareProcessor处理，那这些接口就被ApplicationContext记下来，不再单独处理他们了：`ignoreDependencyInterface`
- 如果需要织入，添加一个BeanPostProcessor：LoadTimeWeaverAwareProcessor
- 注册几个bean作为singleton：
    + environment：getEnvironment()
    + systemProperties：getEnvironment().getSystemProperties()
    + systemEnvironment：getEnvironment().getSystemEnvironment()
- 那么这些bean怎么get呢？按照名字或者类型get。而存放他们的地方，在DefaultSingletonBeanRegistry里，其实就是一个map：
    ```java
    /** Cache of singleton objects: bean name --> bean instance */
	private final Map<String, Object> singletonObjects = new ConcurrentHashMap<String, Object>(64);
    ```


> 和之前说的一样，spring的这些都是直接new object的方式，再设置到ApplicationContext里。和我们编程一样。


## register BeanFactoryPostProcessor
> 注意：上面一个步骤已经注册的两个是BeanPostProcessor，不是BeanFactoryPostProcessor。

二者有啥区别：
- BeanFactoryPostProcessor是处理 **bean定义** 的：A BeanFactoryPostProcessor may interact with and modify bean definitions, but never bean instances.
- BeanPostProcessor是处理 **bean实例** 的：If bean instance interaction is required, consider implementing BeanPostProcessor instead.

其实想想，BeanFactoryPostProcessor是BeanFactory的PostProcessor。它是处理 **BeanFactory实例** 的。**BeanFactory实例里有啥？有BeanDefinition。所以它可以修改BeanDefinition**。

比如PropertyResourceConfigurer。

BeanDefinitionRegistryPostProcessor继承了BeanFactoryPostProcessor，所以它：
- 不仅继承了postProcessBeanFactory
- 还新增了postProcessBeanDefinitionRegistry

后者（处理BeanFactory）在bean definition注册好了之后，就修改bean definition：Modify the application context's internal bean definition registry after its standard initialization. 

之前已经注册过一个名为`org.springframework.context.annotation.internalConfigurationAnnotationProcessor`的BeanDefinitionRegistryPostProcessor了，它实际是ConfigurationClassPostProcessor。

这个BeanDefinitionRegistryPostProcessor不得了，**它有最高优先级，因为他要先把@Configuration里的@Bean注册的BeanDefinition全都读出来，然后其他的BeanFactoryPostProcessor才能去修改这些BeanDefinition**：This post processor is Ordered.HIGHEST_PRECEDENCE as it is important that any Bean methods declared in Configuration classes have their respective bean definitions registered before any other BeanFactoryPostProcessor executes.

由ConfigurationClassParser去处理这个@Configuration的definition。如果有@Import，还要处理@Import的bean，还挺麻烦的。

获取它的所有标注了@Bean的方法`sourceClass.getMetadata().getAnnotatedMethods(Bean.class.getName())`，然后遍历这些方法，记录下这些bean。

这是一个BeanFactoryPostProcessor的用法。

再从bean factory里获取其他的BeanFactoryPostProcessor：
```java
String[] postProcessorNames = beanFactory.getBeanNamesForType(BeanDefinitionRegistryPostProcessor.class, true, false);
```
> 从这里开始，貌似后面都开始从BeanFactory（map）里根据type获取bean了（无论是spring自己提前put进去的，还是程序猿自己的@Bean被解析了然后put进去的）。从这里开始，bean已经都注册上了，可以这么获取了。

再依次处理一遍。总体而言，他们的处理顺序是：
- 先把BeanFactoryPostProcessor分成两拨，一拨是BeanDefinitionRegistryPostProcessor，另一拨是纯BeanFactoryPostProcessor
- 先调用BeanDefinitionRegistryPostProcessor#postProcessBeanDefinitionRegistry
    - 先按序处理实现了PriorityOrdered的；
    - 再按序处理实现了Ordered的；
    - 最后处理普通的
- 再调用BeanFactoryPostProcessor#postProcessBeanFactory：
    - 先调用BeanDefinitionRegistryPostProcessor的
    - 再调用纯BeanFactoryPostProcessor的

经过这一通操作，我们自定义的bean都注册好了。

再获取所有的BeanFactoryPostProcessor：
```java
String[] postProcessorNames = beanFactory.getBeanNamesForType(BeanFactoryPostProcessor.class, true, false);
```
按上面的顺序再来一遍（已经在上面执行过的就不再执行了）。这里主要是为了处理我们也自定义的BeanFactoryPostProcessor。因为ConfigurationClassPostProcessor已经分析完了所有的@Configuration，这里我们自定义的BeanFactoryPostProcessor也会出现了。

比如我们的BeanFactoryPostProcessor可能会给修改某个BeanDefinition，添加一个属性：
```java
	public void postProcessBeanFactory(ConfigurableListableBeanFactory bf) throws BeansException {
		BeanDefinition bd = bf.getBeanDefinition("car");
		bd.getPropertyValues().addPropertyValue("brand", "奇瑞QQ");
		System.out.println("ApplicationContext启动后，加载完配置，还没实例化bean：调用MyBeanFactoryPostProcessor.postProcessBeanFactory()！");
	}
```

总之，这一大块儿的目的，就是处理完所有的BeanFactoryPostProcessor。（同时@Configuration里定义的@Bean也被处理完了）

- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory-extension-factory-postprocessors

## register bean post processor
又是从BeanFactory里直接按照类型获取所有的BeanPostProcessor：
```java
String[] postProcessorNames = beanFactory.getBeanNamesForType(BeanPostProcessor.class, true, false);
```
接下来先给bean post processor排序：
- @PriorityOrder
- @Order
- rest

为什么这一部分叫registerBeanPostProcessors？因为这些BeanPostProcessor被取出并排序之后，全都使用`beanFactory.addBeanPostProcessor`添加到了BeanFactory里。

> 他们比较重要，所以单独都拎出来放到BeanFactory里了。牌面！

最后spring还手动添加了一个ApplicationListenerDetector，它也是一个BeanPostProcessor，专门用来检测实现ApplicationListener接口的bean的：
```java
		@Override
		public Object postProcessAfterInitialization(Object bean, String beanName) {
			if (bean instanceof ApplicationListener) {
				// potentially not detected as a listener by getBeanNamesForType retrieval
				Boolean flag = this.singletonNames.get(beanName);
				if (Boolean.TRUE.equals(flag)) {
					// singleton bean (top-level or inner): register on the fly
					this.applicationContext.addApplicationListener((ApplicationListener<?>) bean);
				}
				else if (flag == null) {
					if (logger.isWarnEnabled() && !this.applicationContext.containsBean(beanName)) {
						// inner bean with other scope - can't reliably process events
						logger.warn("Inner bean '" + beanName + "' implements ApplicationListener interface " +
								"but is not reachable for event multicasting by its containing ApplicationContext " +
								"because it does not have singleton scope. Only top-level listener beans are allowed " +
								"to be of non-singleton scope.");
					}
					this.singletonNames.put(beanName, Boolean.FALSE);
				}
			}
			return bean;
		}
```
把所有的ApplicationListener bean添加到ApplicationContext里：`this.applicationContext.addApplicationListener((ApplicationListener<?>) bean)`。

这就是spring解耦逻辑的地方：我有一个BeanPostProcessor，专门处理实现了某个接口的bean。
- **这些逻辑就可以从spring初始化的主流程里剥离出来**
- **所以可以把BeanPostProcessor当成spring容器的插件：插了这个插件，spring多了这个功能**
- **也可以把这些BeanPostProcessor当做回调函数：每个bean在实例化之后，都会调用这个回调函数**

**因为BeanPostProcessor是在实例化前后被调用的，所以这里只是“register”，并不会调用。**

### Programmatically registering BeanPostProcessor instances

BeanPostProcessor既可以直接`addBeanPostProcessor`到ApplicationContext里，也可以通过bean的形式，自动注册到ApplicationContext容器里。那么用哪一种呢？

主要还是看应用时机：
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory-extension-bpp

第一种手动add的方式添加的早，所以可以：
> This can be useful when you need to evaluate conditional logic before registration or even for copying bean post processors across contexts in a hierarchy

除此之外，自动注册BeanPostProcessor就行了。

### BeanPostProcessor instances and AOP auto-proxying
这一段也说明了上述BeanPostProcessor的流程：
Classes that implement the BeanPostProcessor interface are special and are treated differently by the container. 
1. All BeanPostProcessor instances and beans that they directly reference are instantiated on startup, as part of the special startup phase of the ApplicationContext. 
2. Next, all BeanPostProcessor instances are registered in a sorted fashion and applied to all further beans in the container. 
3. Because AOP auto-proxying is implemented as a BeanPostProcessor itself, **neither BeanPostProcessor instances nor the beans they directly reference are eligible for auto-proxying and, thus, do not have aspects woven into them**.

所以BeanPostProcessor和他们引用的bean都没有被代理的机会了。

## init message source

## init application event multicaster
new一个SimpleApplicationEventMulticaster，它是ApplicationEventMulticaster接口的实现类。
- addApplicationListener
- removeApplicationListener
- void multicastEvent(ApplicationEvent event)

感觉它和Tomcat的那个event support一样，内部维护了一个listener list，触发事件的时候就遍历调用一下这些listener。看了一下，是的，它就是一样。

## on refresh
在实例化singleton bean之前做的操作：Template method which can be overridden to add context-specific refresh work. Called on initialization of special beans, before instantiation of singletons.

是一个空的protected方法，应该是写其他web相关的子类的时候需要干点儿啥，就在这里新定义了一个protected方法。

## register listener
就是从BeanFactory里获取所有的ApplicationListener类型的bean`String[] listenerBeanNames = getBeanNamesForType(ApplicationListener.class, true, false)`，然后添加到刚刚的那个SimpleApplicationEventMulticaster里。

**从现在起，可以触发事件回调了！**

## finish bean factory initialization
**开始实例化所有的非@Lazy的singleton！**

获取所有的bean name（这个功能BeanFactory提供了），如果它是：
- 实体类
- singleton
- 非@Lazy
```java
if (!bd.isAbstract() && bd.isSingleton() && !bd.isLazyInit()) {
```
那就初始化它！

如果它是 **factory bean（BeanFactory类型的bean）**，它的名字是以&开头的：Used to dereference a FactoryBean instance and distinguish it from beans created by the FactoryBean. For example, if the bean named myJndiObject is a FactoryBean, **getting &myJndiObject will return the factory, not the instance returned by the factory.**

反正spring就是拿这个标记来做bean的区分。


真正实例化bean的，是AbstractBeanFactory对BeanFactory接口的getBean(String name)方法的实现。看这个实现就知道bean是怎么创建的了，但是它巨复杂……

反正就是先实例化bean：
- 用的是`AbstractAutowireCapableBeanFactory#createBean(String beanName, RootBeanDefinition mbd, Object[] args)`
- **实例化前回调**：`InstantiationAwareBeanPostProcessor#postProcessBeforeInstantiation`
- 中间又获得class，又决定constructor，最终通过反射new了一个bean：`BeanUtils#instantiateClass(Constructor<T> ctor, Object... args)`


实例化完了就populate bean，设置property。
- **实例化后回调**：`InstantiationAwareBeanPostProcessor#postProcessAfterInstantiation`

接着initialize bean：
- 如果bean是Aware，就判断它是那种Aware，然后set相应的东西，很暴力。
    ```java
    	private void invokeAwareMethods(final String beanName, final Object bean) {
		if (bean instanceof Aware) {
			if (bean instanceof BeanNameAware) {
				((BeanNameAware) bean).setBeanName(beanName);
			}
			if (bean instanceof BeanClassLoaderAware) {
				((BeanClassLoaderAware) bean).setBeanClassLoader(getBeanClassLoader());
			}
			if (bean instanceof BeanFactoryAware) {
				((BeanFactoryAware) bean).setBeanFactory(AbstractAutowireCapableBeanFactory.this);
			}
		}
	}
    ```
- **初始化前回调**：`BeanPostProcessor#postProcessBeforeInitialization`
- 调用init method
    + InitializingBean#afterPropertiesSet
    + 如果有自定义的init method，就调用那个method
- **初始化后回调**：`BeanPostProcessor#postProcessAfterInitialization`

终于bean创建出来了！

### FactoryBean
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-factory-extension-factorybean

如果定义的一个bean是FactoryBean，那么spring会生成一个FactoryBean和一个该FactoryBean产生的bean。如果直接获取bean，获取的是产生的bean。如果想获取FactoryBean本身，getBean的参数要加&，因为FactoryBean的名字在ApplicationContext里是以&开头的！

为什么不直接定义一个bean，而要定义FactoryBean再让它生成bean？因为一个bean的逻辑可能比较复杂，在配置里不好写，不如用代码构建它。比如生成proxy bean的ProxyFactoryBean。

## ApplicationContext终于创建好了……
最后发布一个ContextRefreshedEvent事件吧。看起来还有这些和生命周期相关的事件：
- ContextStartedEvent
- ContextStoppedEvent
- ContextClosedEvent
- ContextRefreshedEvent

完结，撒花✿✿ヽ(°▽°)ノ✿

# 一种debug方法
随便写个class，implements InstantiationAwareBeanPostProcessor就行了，然后@Bean把它配置成一个bean。把所有的方法都打断点，自然就可以观察实例化前后，初始化前后的调用逻辑了。

# 感想
接口真是个好东西。其实现在看到一个东西只有class没有接口，才会更头疼。

# @Autowired
原来之前的constructor是需要标注@Autowired的。如果有多个constructor，也是需要标注@Autowired的：
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-autowired-annotation

> if several constructors are available and there is no primary/default constructor, at least one of the constructors must be annotated with @Autowired in order to instruct the container which one to use

# Environment
Environment:
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-environment
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-definition-profiles-enable

# @PropertySource
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-property-source-abstraction

The @PropertySource annotation provides a convenient and declarative mechanism for adding a PropertySource to Spring’s Environment.

# @EventListener
使用注解，免去了接口继承。这是一个不错的思路：
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#context-functionality-events-annotation

# 关于Resource
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#context-functionality-resources

A Resource is essentially a more feature rich version of the JDK java.net.URL class. In fact, the implementations of the Resource wrap an instance of java.net.URL, where appropriate. A Resource can obtain low-level resources from almost any location in a transparent fashion, including from the classpath, a filesystem location, anywhere describable with a standard URL, and some other variations. If the resource location string is a simple path without any special prefixes, where those resources come from is specific and appropriate to the actual application context type.


# factory
BeanFactory和ApplicationContext的区别，这一段说的比较清楚了：
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#beans-beanfactory

An AnnotationConfigApplicationContext has all common annotation post-processors registered and may bring in additional processors underneath the covers through configuration annotations, such as @EnableTransactionManagement. At the abstraction level of Spring’s annotation-based configuration model, the notion of bean post-processors becomes a mere internal container detail.

# StartupStep
spring自己记录下每一步都有啥：
- https://docs.spring.io/spring-framework/docs/current/reference/html/core.html#context-functionality-startup

听起来还是很美好的：
> Tracking the application startup steps with specific metrics can help understand where time is being spent during the startup phase, but it can also be used as a way to better understand the context lifecycle as a whole.

@since spring 5.3, springboot 2.4
