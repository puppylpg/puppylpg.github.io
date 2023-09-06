---
layout: post
title: "Spring - bean的生命周期"
date: 2021-11-16 03:26:30 +0800
categories: spring
tags: spring
---

spring bean的生命周期相当复杂，流程图看上去就晕。但其实一一拆解开来，也并不是不可理解。掌握spring bean的生命周期，感觉就真正入门spring的核心了。

1. Table of Contents, ordered
{:toc}

# 使用反射构造java bean
spring中，初始化一个bean，假设什么额外操作都不做，仅 **根据配置** 使用反射new出一个对象，就两步：
```
graph TD

A[实例化] --> B[属性注入]
```

- 所谓实例化，就是根据配置文件中的定义，通过反射机制创建 Bean 的实例；
- 所谓属性注入，就是Spring 会自动检测 Bean 中定义的属性，并将配置文件中对应的属性值注入到 Bean 实例中。

> 使用[flowcharts](https://mermaid-js.github.io/mermaid/#/./flowchart?id=flowcharts-basic-syntax)画的图，但是kmarkdown看似不支持。

# bean级操作
如果只有上面的步骤，那和直接new一个对象没什么区别，无非是用了反射而已，并没有增加其他的东西。

spring首先在bean构造时期增加的两个重要操作：
```
graph TD

A[实例化] --> B[属性注入]

B --> C[初始化操作]

C --> D[预销毁操作]

style C fill:#f9f
style D fill:#f9f
```
- 初始化：做一些初始化操作。比如bean构造完之后输出一些log、启动一些线程池、连接数据库等等，可以是任何想做的操作；
- 预销毁：对象被销毁之前做一些操作，比如关闭初始化时候启动的线程池、关闭初始化时候连接的数据库、释放文件等等；

关于初始化的两点误区：
1. 初始化并不是“设置属性”。初**始化指的是在bean值设置好之后做一些任意操作**，所以初始化的时候并不是设置bean值，它已经设置好了；
2. “初始化”Initialization和“实例化”Instantiation是两个概念，虽然猛一看有点儿像。实例化是构造对象，是万物起源，初始化是值设置之后，远远晚于实例化。

## `InitializingBean`
初始化关联的接口是`InitializingBean`：如果bean需要有初始化操作，就实现该接口。容器在bean的初始化阶段，调用它的`afterPropertiesSet()`方法，完成初始化。

> **初始化用到的方法叫after Properties Set，所以很明显初始化是在bean的初始值设置之后。**

## `DisposalBean`
预销毁关联的接口是`DisposalBean`：如果bean需要有预销毁操作，就实现该接口。容器在bean的预销毁阶段，调用它的`destroy()`方法，完成预销毁。

## Aware
但bean级操作还不止这些。在初始化之前，bean还可以给自己增加一些aware操作：

```
graph TD

A[实例化] --> B[属性注入]

B --> Z[Aware]

Z --> C[初始化操作]

style Z fill:#f9f,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

C --> D[销毁前操作]

style C fill:#f9f
style D fill:#f9f
```

所谓Aware，其实是一系列xxxAware接口。这些接口都是 **以回调的方式**，给bean设置一些东西。

**何谓回调？就是被调用者实现一些行为，由调用者在约定好的时刻调用并执行**。比如以下回调接口：

### `BeanNameAware`
该Aware接口用于将 **配置文件中** bean的名称设置到bean里。

看它的方法：
```java
void setBeanName(String name);
```
显然，调用者（也就是spring容器）在回调该方法的时候，需要将配置中写的bean name作为参数传入。

一个默认的bean回调行为就是直接将它记下来：
```java
	public void setBeanName(String beanName) {
		this.beanName = beanName;
	}
```

这样，以回调的方式，容器将用户配置的这个bean的名称告诉了bean。（而bean的回调行为一般就是记录下该名称）

> 回调行为固然重要，**回调参数同样非常重要，它是约定的接口**。参数由调用者告诉被调用者，被调用者在设计回调行为时，还不知道这些值究竟是什么。

### `BeanFactoryAware`
同理，看它的方法就知道了：
```java
void setBeanFactory(BeanFactory beanFactory) throws BeansException;
```
容器告诉bean，创建它的bean factory是什么。一般bean的回调行为也是把bean factory记下来。

### `ApplicationContextAware` - 类似`BeanFactoryAware`
如果spring容器不是BeanFactory，而是ApplicationContext，那么还可以实现`ApplicationContextAware`，把bean和保存它的容器关联起来：
```java
void setApplicationContext(ApplicationContext applicationContext) throws BeansException;
```

> 如果spring容器是BeanFactory，则只能有`BeanFactoryAware`。它不存在ApplicationContext，自然也不能实现`ApplicationContextAware`。

## 意义
bean级操作是针对于某一个bean的。如果一个bean想要做一些奇奇怪怪的操作，就需要实现相应的bean级接口，由spring容器回调来特殊处理该bean。

但是bean级接口的意义没有那么的大，而且不经常用它的很重要原因就是：**由于必须要实现这些接口，代码已经不再是plain pojo了，必须要依赖spring框架的代码**。这样spring相当于入侵了原始代码。

**一种常见的解耦方式就是配置文件**。所以spring提供了xml配置的方式：在配置bean时可以配置`<init-method>`和`<destroy-method>`，从而取代`InitializingBean`和`DisposalBean`接口。

> 或者`@PostConstruct`/`@Predestroy`注解。

# 容器级操作 - bean级接口的颠覆者
有些操作是希望所有的bean都会去做的，如果让每一个bean都实现相同的bean级接口写上相同的回调逻辑显然是过于累赘的。此时容器级接口就会发挥很大的作用。

当然，即使某些特殊的bean不想被容器级接口的实现类处理，也可以在实现的时候把他们手动排除掉。**所以容器级接口几乎是完全可以取代bean级接口的**。

比如在bean初始化前后，可以对bean做一些操作:
```
graph TD

A[实例化] --> B[属性注入]

B --> D[Aware]

D --> E[初始化之前做一些处理]
style E fill:#f9f,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

E --> C[初始化操作]



C --> F[初始化之后做一些处理]
style F fill:#f9f,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

F --> Z[销毁前操作]
```

## `BeanPostProcessor`
bean初始化前后的处理由`BeanPostProcessor`接口定义。**它之所以叫bean的后处理器，大概是因为此时bean已经实例化完成，并设置完属性了，后面做的处理就是对bean的“后处理”了**。

它主要有两个方法：
```java
Object postProcessBeforeInitialization(Object bean, String beanName) throws BeansException;
```
初始化前操作，同样是回调，由spring容器在做初始化操作前，对bean进行处理。

```java
Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException;
```
初始化后操作，由spring容器在做初始化操作后，对bean进行处理。

### 用途举例：tomcat开启mbean
意义：**强制覆盖配置的属性，或在没提供配置属性的情况下手动设置某些属性**。

比如tomcat有这么一个`BeanPostProcessor`的实现类`WebServerFactoryCustomizerBeanPostProcessor`，专门处理`WebServerFactoryCustomizer`接口规定的自定义配置：
```java
	private void postProcessBeforeInitialization(WebServerFactory webServerFactory) {
		LambdaSafe.callbacks(WebServerFactoryCustomizer.class, getCustomizers(), webServerFactory)
				.withLogger(WebServerFactoryCustomizerBeanPostProcessor.class)
				.invoke((customizer) -> customizer.customize(webServerFactory));
	}
```
在它的“实例化前操作”里，会调用所有的`WebServerFactoryCustomizer`的`customize`方法。

比如我们自定义一个customizer，把禁用mbean的配置给改为false：
```java
    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> activateTomcatMBeanServer() {

        return (factory) -> {
            factory.setDisableMBeanRegistry(false);
        };
    }
```
那么无论tomcat关于禁用mbean的配置之前被配置成了什么，最终都会改为false，用以暴露mbean。

而之所以这么做，是因为当时所用的spring boot并没有提供tomcat关于mbean的配置项，导致tomcat的mbean没有暴露，最终只能通过这种比较晦涩的方式曲线救国了。

## `InstantiationAwareBeanPostProcessor`，涵盖`BeanPostProcessor`
既然初始化操作前后可以加上前处理和后处理，那实例化操作前后不也可以加上前处理和后处理？是的：

```
graph TD

A[实例化前操作] --> B[实例化]
style A fill:#f9f,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

B --> C[实例化后操作]
style C fill:#f9f,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

C --> D[属性值处理]
style D fill:#f9f,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

D --> E[属性注入]

E --> F[Aware]

F --> G[初始化之前做一些处理]

G --> H[初始化操作]

H --> I[初始化之后做一些处理]

I --> Z[销毁前操作]

style G fill:#f9f
style I fill:#f9f
```

实例化前后的操作由`InstantiationAwareBeanPostProcessor`负责。和`BeanPostProcessor`，是两个类似的方法：
```java
Object postProcessBeforeInstantiation(Class<?> beanClass, String beanName) throws BeansException;
boolean postProcessAfterInstantiation(Object bean, String beanName) throws BeansException;
```
但是查看其参数：
- 对于before方法，是在实例化之前调用的，**此时还没有bean实例，所以参数是bean class**；
- 对于after方法，是在实例化之后调用的，此时已经有bean实例里，所以参数是bean object。这一点和`BeanPostProcessor`一样，后者的参数全都是bean object。

`InstantiationAwareBeanPostProcessor`的下一步就是设置属性了。所以在设置之前，它又加了一步处理属性值的操作，用于方便统一对配置里的属性值进行修改：
```java
PropertyValues postProcessPropertyValues(PropertyValues pvs, PropertyDescriptor[] pds, Object bean, String beanName)
			throws BeansException;
```
其中pvs参数代表配置的原始属性值，由spring容器回调该方法时传入。

> `InstantiationAwareBeanPostProcessor`本身还是`BeanPostProcessor`的子接口，**所以它兼具实例化前后、初始化前后做一些操作的功能**。如果只需要做初始化前后的操作，只用`BeanPostProcessor`就行了。**否则就使用`InstantiationAwareBeanPostProcessor`，它不止可以做实例化前后的操作，还可以取代`BeanPostProcessor`**。

## 意义
容器级bean处理接口非常需要！**他们像spring容器上的插件一样**，所有容器中管理的bean都要经过插件的处理。

**spring扩展插件、spring子项目，都是使用这些后处理器完成的奇奇怪怪激动人心的功能**！AOP、动态代理等也都用到这个。

## `BeanFactoryPostProcessor` - 继续叠罗汉
通过上面的例子，大概可以明白了，只要spring觉得有必要，会继续在中间某几步的间隙增加操作步骤。只要spring容器支持在这些节点回调就行了。所以spring又加了一个——

由于ApplicationContext是BeanFactory的更高级实现，基于BeanFactory。所以如果spring容器用的是ApplicationContext，还可以在容器启动之后，进行上面那一通操作之前，做一些配置信息加工处理的工作。

```
graph TD

T[bean工厂后处理操作] --> A[实例化前操作]
style T fill:#f9f,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

A --> B[实例化]

B --> C[实例化后操作]

C --> D[属性值处理]

D --> E[属性注入]

E --> F[Aware]

F --> G[初始化之前做一些处理]

G --> H[初始化操作]

H --> I[初始化之后做一些处理]

I --> Z[销毁前操作]
```

在ApplicationContext启动后，**所有bean的配置都被加载了，同时还没有bean被实例化。此时，所有bean的配置都可以被修改。**
```java
void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) throws BeansException;
```

### 用途举例：替换配置文件中的占位符
spring提供了不少`BeanFactoryPostProcessor`的实现类，比如：
- `CustomEditorConfigurer`
- `PropertyPlaceholderConfigurer`：**处理spring配置中的占位符`${...}`**，然后再把处理后的正常配置值用于实例化bean；

# 容器启动销毁
spring4.x的一个很好的展示spring bean生命周期的例子：
- https://github.com/puppylpg/spring4.x/tree/master/chapter4/src/main/java/com/smart

这里只贴一下容器启动销毁的代码，不再展示bean和各种bean级、容器级接口实现。

## BeanFactory
```java
package com.smart.beanfactory;

import org.springframework.beans.factory.BeanFactory;
import org.springframework.beans.factory.config.ConfigurableBeanFactory;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.beans.factory.xml.XmlBeanDefinitionReader;
import org.springframework.beans.factory.xml.XmlBeanFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;

import com.smart.Car;

public class BeanLifeCycle {
    private static void LifeCycleInBeanFactory(){


       //①下面两句装载配置文件并启动容器
 	   Resource res = new ClassPathResource("com/smart/beanfactory/beans.xml");

       BeanFactory bf= new DefaultListableBeanFactory();
       XmlBeanDefinitionReader reader = new XmlBeanDefinitionReader((DefaultListableBeanFactory)bf);
       reader.loadBeanDefinitions(res);

       //②向容器中注册MyBeanPostProcessor后处理器
       ((ConfigurableBeanFactory)bf).addBeanPostProcessor(new MyBeanPostProcessor());

       //③向容器中注册MyInstantiationAwareBeanPostProcessor后处理器
       ((ConfigurableBeanFactory)bf).addBeanPostProcessor(
               new MyInstantiationAwareBeanPostProcessor());
       //④第一次从容器中获取car，将触发容器实例化该Bean，这将引发Bean生命周期方法的调用。
       Car car1 = (Car)bf.getBean("car");
       car1.introduce();
       car1.setColor("红色");

       //⑤第二次从容器中获取car，直接从缓存池中获取
       Car car2 = (Car)bf.getBean("car");

       //⑥查看car1和car2是否指向同一引用
       System.out.println("car1==car2:"+(car1==car2));
       //⑦关闭容器
       ((DefaultListableBeanFactory)bf).destroySingletons();

    }
	public static void main(String[] args) {
		LifeCycleInBeanFactory();
	}
}
```
xml config：
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:p="http://www.springframework.org/schema/p"
       xsi:schemaLocation="http://www.springframework.org/schema/beans
       http://www.springframework.org/schema/beans/spring-beans-4.0.xsd">
    <bean id="car" class="com.smart.Car"
          init-method="myInit"
          destroy-method="myDestory"
          p:brand="红旗CA72"
          p:maxSpeed="200"
            />

    <bean id="customAutowireConfigurer"
          class="org.springframework.beans.factory.annotation.CustomAutowireConfigurer">
        <property name="customQualifierTypes">
            <set>
                <value>test.FineQualifier</value>
            </set>
        </property>
    </bean>
    <!-- bean id="car" class="com.smart.beanfactory.Car"
    init-method="myInit"
    destroy-method="myDestory"
    p:brand="红旗CA72"/ -->

</beans>
```

使用BeanFactory启动容器比较麻烦：
1. 需要手动加载resource，并手动组装factory和resource；
2. 需要手动往factory上注册各种processor；

另外，**post processor的实际调用顺序并不是注册顺序，spring提供了Ordered接口让开发可以手动控制各个processor的执行顺序**。

## ApplicationContext
```java
package com.smart.context;

import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import com.smart.Car;
import org.springframework.context.support.AbstractApplicationContext;
import org.springframework.context.support.ClassPathXmlApplicationContext;

public class AnnotationApplicationContext {
	public static void main(String[] args) {
//		ApplicationContext ctx = new AnnotationConfigApplicationContext(Beans.class);


		/**
		 * 那些{@link org.springframework.beans.factory.config.BeanPostProcessor}等得被声明为bean
		 * 然后就不用再有注册他们到容器的动作了。
		 * 
		 * 而{@link org.springframework.beans.factory.BeanFactory}必须有手动add bean post processor的调用动作
		 */
		ApplicationContext ctx = new ClassPathXmlApplicationContext("com/smart/context/beans.xml");
		Car car =ctx.getBean("car",Car.class);
	}
}
```

bean xml config：
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<beans xmlns="http://www.springframework.org/schema/beans"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xmlns:p="http://www.springframework.org/schema/p"
	xsi:schemaLocation="http://www.springframework.org/schema/beans 
       http://www.springframework.org/schema/beans/spring-beans-4.0.xsd">
   <bean id="car" class="com.smart.Car"
         p:brand="红旗CA72"
         p:maxSpeed="200"/>
   <bean id="myBeanPostProcessor" class="com.smart.context.MyBeanPostProcessor"/>
   <bean id="myBeanFactoryPostProcessor" class="com.smart.context.MyBeanFactoryPostProcessor"/>
</beans>
```

使用ApplicationContext启动容器非常简单：
1. 不需要手动load resource，容器会自动选择合适的加载方式加载；
2. 不需要手动注册bean post process等，**只要把他们声明为bean**，就会自动使用反射识别出配置中的BeanPostProcessor、InstantiationAwareBeanPostProcessor、BeanFactoryPostProcessor，自动注册到容器上。

> **自动注册到容器的前提是必须得把他们声明为bean**。并不是说只要把类文件写出来了就行了。没有声明为bean，spring容器就还是不知道有这么个东西。

所以开发的时候自然是使用更高级的ApplicationContext，而不是BeanFactory。

# 容器级插件的用途举例 - `InitDestroyAnnotationBeanPostProcessor`
spring一开始让代码和框架解耦的方式只有一个：xml配置。比如上文提到的`<init-method>`。

spring注解的出现，让人们免去了写xml，通过注解配置程序，进而达到代码和框架解耦的目的：处理注解的代码承担了组装bean的任务。

`InitDestroyAnnotationBeanPostProcessor`就是这样一个东西，用于取代`<init-method>`和`<destroy-method>`。

别看名字长，细看，它是一个`BeanPostProcessor`。由上文可知，`BeanPostProcessor`是容器级的，在bean创建好后对bean做奇奇怪怪的事情的。再看它的名字`init destroy annotation`，它是负责实现init annotation（`@PostConstruct`）和destory annotation（`@PreDestroy`）这两个annotation的功能的。

## `javax.annotation.PostConstruct`
`postProcessAfterInitialization`。`InitDestroyAnnotationBeanPostProcessor`在“初始化前操作”`postProcessBeforeInitialization`里实现了对`@PostConstruct`的处理：
```java
	@Override
	public Object postProcessBeforeInitialization(Object bean, String beanName) throws BeansException {
	    // 找到带@PostConstruct的方法
		LifecycleMetadata metadata = findLifecycleMetadata(bean.getClass());
		try {
		    // 调用它
			metadata.invokeInitMethods(bean, beanName);
		}
		catch (InvocationTargetException ex) {
			throw new BeanCreationException(beanName, "Invocation of init method failed", ex.getTargetException());
		}
		catch (Throwable ex) {
			throw new BeanCreationException(beanName, "Failed to invoke init method", ex);
		}
		return bean;
	}
```

> `InitDestroyAnnotationBeanPostProcessor`仅在“初始化前操作”`postProcessBeforeInitialization`实现了对`@PostConstruct`的支持，并没有在“初始化后操作”`postProcessAfterInitialization`里做什么事。

所以，有了这个**插件**，spring可以支持`@PostConstruct`注解了。

## `javax.annotation.PreDestroy`
`BeanPostProcessor`只有`postProcessBeforeInitialization`和`postProcessAfterInitialization`两个方法，都是和init相关的，和destroy并没有什么关系。

所以spring又创建了一个`DestructionAwareBeanPostProcessor`，这个bean post processor新增了`postProcessBeforeDestruction`方法，这个方法会在`DisposableBeanAdapter`的`destroy`方法里回调。

> 注意，**这里的容器级插件`DestructionAwareBeanPostProcessor`被bean级插件`DisposableBeanAdapter`（接口为`DisposableBean`）调用，从而实现了容器级插件的功能。所以也可以说bean级插件是更底层的接口，容器级插件是更上层的接口**。

而`InitDestroyAnnotationBeanPostProcessor`就是`DestructionAwareBeanPostProcessor`的一个实现者。所以它用`BeanPostProcessor`原有的方法`postProcessBeforeInitialization`实现了对`@PostConstruct`的支持，又用`DestructionAwareBeanPostProcessor`新增的`postProcessBeforeDestruction`方法实现了对`@PreDestroy`的支持。

`BeanPostProcessor`（`DestructionAwareBeanPostProcessor`）由于和`InitializingBean`、`DisposalBean`位置基本重合，所以如果你有一个需求，要给bean在init或者destroy是做些什么操作，直接用这两个容器级插件接口就行了。

> 但是`BeanPostProcessor`并不能取代`InitializingBean`，仅仅是我们可以在需要使用`InitializingBean`的时候转而使用`BeanPostProcessor`而已。在整个spring框架里，`InitializingBean`和`DisposableBean`接口是不可或缺的。正如上文所述，`DestructionAwareBeanPostProcessor`其实是利用`DisposableBean`实现了其功能，所以我们可以在需要使用`DisposableBean`的时候使用`DestructionAwareBeanPostProcessor`，但是本质上，我们是用的还是`DisposableBean`。
>
> **一般开发spring框架级的东西时，用bean级接口比较多**。比如为了创造一个`DestructionAwareBeanPostProcessor`使用了`DisposableBean`。**但是在平时开发系统时，用容器级接口比较多**。


所以，一个类实现`InitializingBean#afterPropertiesSet`、在xml里设置`<init-method>`，标注了`@PostConstruct`，是能达到同样的效果的。不过如果非得吹毛求疵，其实他们发生的位置不完全一样：
1. `@PostConstruct`是`BeanPostProcessor#postProcessBeforeInitialization`里实现的，所以要最早；
2. `InitializingBean#afterPropertiesSet`和`<init-method>`是同一步，但如果看他们的调用者`AbstractAutowireCapableBeanFactory#invokeInitMethods`的实现，是先检测InitializingBean，再考虑`<init-method>`标注的。

不过这种小区别不重要，大体而言，他们基本是在同一时期被调用的。所以用哪个都行。

## 意义
1. bean级插件更底层，一些容器级插件会依托于他们实现容器级功能；
2. 容器级插件实现的很多功能非常惊艳！

# 总结
Bean的创建整体分为三步：
1. 创建出来。这个创建主要是通过构造函数（也许还有反射）把bean创建出来；
2. **Bean级生命周期接口**。也就是各种aware，以回调的方式，将bean的名字之类的信息告诉bean，bean把这些信息记下来。这些都是bean自己实现的接口；
3. **容器级生命周期接口**。也就是`BeanPostProcessor`等，观名达意，对bean进行后处理。主要从容器级**适用于所有的bean**，修改已创建好的这些bean（AOP、动态代理，就是通过`BeanPostProcessor`给bean做的手脚），**很像是一种插件，插在容器上**。当然可以加上条件，有选择的处理自己想要的bean。

以上就是bean创建出来大致经过的三个阶段。
