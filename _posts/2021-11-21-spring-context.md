---
layout: post
title: "Spring - bean的容器"
date: 2021-11-21 21:07:58 +0800
categories: spring
tags: spring
---

[Spring - bean的生命周期]({% post_url 2021-11-16-spring-bean-lifecycle %})介绍了spring bean的生命周期需要经过哪些步骤，但是这些只是一半的工作。bean之所以有这些步骤可做，是因为bean的容器在配合它：虽然已经定义了各种操作bean的接口，比如BeanPostProcessor等，如果容器不去响应他们，也就没法完成这些所谓的回调。只有bean和容器协同使用这些接口，才能实现完整的spring框架功能。

1. Table of Contents, ordered
{:toc}

# ApplicationContext启动流程
以启动AnnotationConfigApplicationContext为例：
```java
ApplicationContext context = new AnnotationConfigApplicationContext(xxx.class);
```
其中xxx.class，是以注解方式实现的bean配置。

之后就可以从context里获取bean了：
```java
Car car = context.getBean("car", Car.class);
```
也就是说，当创建ApplicationContext完之后，整个容器就启动完毕了，并完成了bean的初始化工作。这些都是怎么做到的？

查看AnnotationConfigApplicationContext的构造函数：
```java
	public AnnotationConfigApplicationContext(Class<?>... annotatedClasses) {
		this();
		register(annotatedClasses);
		refresh();
	}
```

第一步，this函数就是在准备读取配置的工具。这里的配置是带annotation的Java类配置：
```java
		this.reader = new AnnotatedBeanDefinitionReader(this);
		this.scanner = new ClassPathBeanDefinitionScanner(this);
```
所以准备的是从classpath下加载annotation bean的reader。

## ResourceLoader
spring既然有各种形式的配置：xml，java class，就同时拥有配套的读取配置的工具。哪怕只读xml，也有按照file路径读取、从classpath下读取等不同实现。这些都是ResourceLoader的各种不同实现类来完成的，以后再介绍。

第二步，register实际就是开始用reader读取注解标注的java类配置：
```java
	public void register(Class<?>... annotatedClasses) {
		Assert.notEmpty(annotatedClasses, "At least one annotated class must be specified");
		this.reader.register(annotatedClasses);
	}
```

第三步，refresh，**正好对应了配置加载完之后，bean的所有生命周期相关的事情**。

# refresh
回想bean的生命周期，在配置加载完之后：
1. BeanFactoryPostProcessor首先更改配置内容，比如替换占位符；
2. bean实例化 & 实例化前置后置操作；
3. bean属性值处理 + 属性值设置；
4. bean的各种aware回调操作；
5. bean的初始化 & 初始化前置后置操作；
6. 销毁bean；

再看refresh函数的步骤，基本完美对应了销毁前的各种工作：
```java
// Tell the subclass to refresh the internal bean factory.
ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();

// Prepare the bean factory for use in this context.
prepareBeanFactory(beanFactory);

// Allows post-processing of the bean factory in context subclasses.
postProcessBeanFactory(beanFactory);

// Invoke factory processors registered as beans in the context.
invokeBeanFactoryPostProcessors(beanFactory);

// Register bean processors that intercept bean creation.
registerBeanPostProcessors(beanFactory);

// Initialize message source for this context.
initMessageSource();

// Initialize event multicaster for this context.
initApplicationEventMulticaster();

// Initialize other special beans in specific context subclasses.
onRefresh();

// Check for listener beans and register them.
registerListeners();

// Instantiate all remaining (non-lazy-init) singletons.
finishBeanFactoryInitialization(beanFactory);

// Last step: publish corresponding event.
finishRefresh();
```

## 初始化BeanFactory
为什么要初始化BeanFactory？

BeanFactory接口定义了一堆获取bean的方法。**之前已经读取了bean config，现在可以把config转成BeanDefinitionRegistry装入BeanFactory里了**。

之后，就可以从factory里获取bean了。

> BeanFactory和ApplicationContext的关系就像DriverManager和DataSource，前者负责基本的获取connection的功能，后者则提供把connection池化的功能，使功能更强大。但本质上，底层还是要依靠DriverManager的。

### `BeanDefinition` & `BeanDefinitionRegistry`
bean可以以xml或者Java config的形式配置，这是spring所支持的语法。这些配置被加载到spring容器内部之后，需要用一种数据结构表示，也就是`BeanDefinition`，**一个bean的定义会在内存中生成一个`BeanDefinition`**。而`BeanDefinitionRegistry`很显然是注册`BeanDefinition`的地方。

BeanDefinition作为和bean定义语法相对应的语法结构，自然是bean定义里有什么，它就有什么：
- getBeanClassName
- getDependesOn
- getScope
- isSingleton
- isLasyInit

等等。

`BeanDefinitionRegistry`则是注册bean definition的地方，**配置集中地**，所以首要方法是：
- registerBeanDefinition

收集了一堆bean的配置，当然要能遍历这些配置、根据配置名称获取配置等等。

> 简单理解为一个map就行：bean名称到BeanDefinition的映射。

> 使用annotation Java config class作为配置，和xml配置相比，多配置了一个bean：config class本身也是一个bean。

## bean factory post process
从配置中寻找BeanFactoryPostProcessor，并回调其方法，以达到一些对bean定义的修改。最最常见的就是`PropertyPlaceholderConfigurer`，替换bean定义时的占位符`${}`为实际值。

## bean post process
实例化bean前后，初始化bean前后，都可以调用bean post process做一些改动。

## 初始化国际化相关的消息源

## 注册listener

## 实例化所有非懒加载bean

- `InstantiationStrategy`：相当于new。一般都是SimpleInstantiationStrategy，相当于直接new。也有cglib相关的strategy；
- `BeanWrapper`：填充bean属性；

## 发布ApplicationContext完成事件
见下文容器事件。

# 配置文件
spring可以使用外部配置文件配置一些变量，并在bean配置里引用。比如数据库的地址、用户名密码、一些自定义的周期任务的时间等等。

因为有一个`BeanFactoryPostProcessor`是`PropertyPlaceholderConfigurer`，它会在bean的definition加载之后，处理所有的definition，将bean定义里的占位符替换为真实值。

- locations：属性文件的位置。支持多个属性文件；
- order：属性文件优先级顺序；
- placeholderPrefix/placeholderSuffix：配置占位符格式。默认是`${`和`}`；

```xml
<!--1.使用传统的PropertyPlaceholderConfigurer引用属性文件  -->
<bean class="org.springframework.beans.factory.config.PropertyPlaceholderConfigurer" p:fileEncoding="utf-8">
	<property name="locations">
		<list>
			<value>classpath:com/smart/placeholder/jdbc.properties</value>
		</list>
	</property>
</bean>

<!--2.使用context命名空间的配置引用属性文件  -->
<context:property-placeholder location="classpath:com/smart/placeholder/jdbc.properties" file-encoding="utf8"/>
```

`PropertyPlaceholderConfigurer`读配置的时候，有一个方法叫做`convertProperties`，默认是不做转换。这就给转变property的形式提供了方便。比如配置文件的用户名和密码写成密文，然后写一个子类，覆写该方法，发现是用户名和密码就进行解谜。

# 容器事件
其实说白了还是回调：
1. 事件：可以是枚举、plain string，用来标记一个事件。一般用不同的类来标记不同事件。
2. listener：回调接口。对一些事件作出响应。既然事件用类表示，那不同的listener只需要接收不同的类对象就行；
3. 事件触发：**回调接口的调用者遍历所有回调接口，并传入事件对象**。对该对象感兴趣的接口就会处理它了。

**在spring中，容器事件的触发，其实就是spring容器调用所有的回调接口，并传入事件对象**。

spring容器在初始化过程中有事件触发，这一点和tomcat容器启动的时候拥有的事件触发机制别无二致：[（五）How Tomcat Works - Tomcat Lifecycle]({% post_url 2020-10-08-tomcat-lifecycle %})。

**但是spring容器事件特殊的地方在于**：它还能让用户借助spring容器进行 **自定义事件** 的触发！**tomcat没法让用户自定义事件和listener**。究其原因：
1. 我们可以注册listener，**这些listener只要配置为bean，就能被容器加载，并注册到容器上**，非常简单；
2. 我们可以获取容器，并调用容器的事件触发方法，来触发listener；

而在tomcat中：
1. 给tomcat添加listener，并不方便：**我们没法添加自定义的事件处理listener**；
2. 获取tomcat容器的引用也并不方便：**我们没法在自己想要的时刻发布事件**；

**所以tomcat只能玩**：
1. tomcat自己决定要触发的事件；
2. tomcat自己注册对事件感兴趣的listener；
3. tomcat自己在某些时机发布事件；

所以想利用tomcat帮我们触发事件不太行。

怎么获取spring容器的引用呢？别忘了各种aware接口。如果用的容器是ApplicationContext而非BeanFactory，容器就会回调`ApplicationContextAware`，并将容器的引用作为参数传入。

## 定义事件
spring本身提供的事件根定义是ApplicationEvent，主要是容器相关的事件ApplicationContextEvent，它又有四种具体的容器事件：
- ContextStartedEvent
- ContextRefreshedEvent
- ContextClosedEvent
- ContextStoppedEvent

所以我们可以定义一个容器相关的事件ApplicationContextEvent的子类，创建一种新事件：
```java
public class MailSendEvent extends ApplicationContextEvent {
	private String to;
	
	public MailSendEvent(ApplicationContext source, String to) {
		super(source);
		this.to = to;
	}
	
	public String getTo() {
		return this.to;
	}
}
```
source是事件里必须有的，代表事件源，也就是ApplicationContext。

## listener
再创建一个listener，接收这种事件：
```java
public class MailSendListener implements ApplicationListener<MailSendEvent>{

	public void onApplicationEvent(MailSendEvent event) {
		System.out.println("MailSendListener:事件来自" + event.getSource());
		System.out.println("MailSendListener:向" + event.getTo() + "发送完一封邮件");
	}
}
```
注意，spring的listener不需要判断接收事件的类型是不是自己感兴趣的！**因为spring只会把事件发给匹配它的listener，而不是所有的listener**！怎么做到的？

spring将事件委托给了SimpleApplicatonEventMulticaster，看它触发事件的时候是怎么通知listener的：
```java
	ResolvableType type = (eventType != null ? eventType : resolveDefaultEventType(event));
	for (final ApplicationListener<?> listener : getApplicationListeners(event, type)) {
	    ...
	}
```
它会拿到事件类型，然后检索所有的listener，只有事件类型和listener接收的事件类型一致，该listener才会作为目标listener收到事件通知。

> 在spring容器里，spring就是无所不能的神，可以检索任何自己想知道的信息。

## 事件触发
我们要持有spring容器，才能使用它发布事件。持有的方式就是借助于回调接口`ApplicationContextAware`：
```java
public class MailSender implements ApplicationContextAware {

	private ApplicationContext ctx ;

	public void setApplicationContext(ApplicationContext ctx)
			throws BeansException {
		this.ctx = ctx;

	}
	
	public void sendMail(String to){
		System.out.println("MailSender:模拟发送邮件...");
		MailSendEvent mse = new MailSendEvent(this.ctx,to);
		ctx.publishEvent(mse);
	}
}
```
这样就能获取容器的引用，进而操作容器了。

## 事件用途
比如创建一个`ApplicationListener<ContextRefreshedEvent>`，在容器构建好之后做一些操作（获取所有的bean，做一些奇奇怪怪的修改）。

如果对逻辑的处理可以拆成几部分，也可以用事件，比如上述mail send事件。
