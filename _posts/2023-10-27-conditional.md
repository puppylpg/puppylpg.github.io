---
layout: post
title: "@Conditional"
date: 2023-10-27 16:53:23 +0800
categories: spring springboot
tags: spring springboot
---

关于springboot，已经写了很丑的两篇：
- enable autoconfig使用的是SPI：[SpringBoot - run]({% post_url 2022-07-21-springboot-run %})
- 关于自定义自动配置包，参考：[SpringBoot - 自动配置]({% post_url 2020-02-18-spring-boot-starter-auto-config %})

还差`@Conditional`注解了。

1. Table of Contents, ordered
{:toc}

# 用法
用法很简单：对于一个被`@Conditional`标记的bean definition，**只有满足condition条件时，才会被注册到bean factory里**。

> Indicates that a component is only eligible for registration when all specified conditions match.
>
> A condition is any state that can be determined programmatically before the bean definition is due to be registered (see Condition for details).

**所以spring一定是在加载bean定义的时候处理`@Conditional`注解的。**

# 实现

> 在spring工程里查看`@Conditional`，不要在springboot里查看，太多了。

## 以什么为条件
看`@Conditional`的定义：
```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface Conditional {

	/**
	 * All {@link Condition}s that must {@linkplain Condition#matches match}
	 * in order for the component to be registered.
	 */
	Class<? extends Condition>[] value();

}
```
`@Conditional`注解需要指定一个`Condition` class。这个`Condition` class就是要满足的条件，所以返回一个boolean：
```java
public interface Condition {

	/**
	 * Determine if the condition matches.
	 * @param context the condition context
	 * @param metadata metadata of the {@link org.springframework.core.type.AnnotationMetadata class}
	 * or {@link org.springframework.core.type.MethodMetadata method} being checked.
	 * @return {@code true} if the condition matches and the component can be registered
	 * or {@code false} to veto registration.
	 */
	boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata);

}
```
因此spring只需要执行这个`Condition`就行了。

> 它相当于是一个lambda函数，到时候spring会调用这个函数做bean condition的校验。

## spring怎么执行的`Condition`
在加载bean definition的时候执行，以判断要不要注册到registry里。

很容易就能找到在`AnnotatedBeanDefinitionReader`里（果然是在注册bean definition的时候）有一个`ConditionEvaluator`。在`registerBean`的时候，先用`ConditionEvaluator`判断一下是否符合条件：
```java
	public void registerBean(Class<?> annotatedClass, String name,
			@SuppressWarnings("unchecked") Class<? extends Annotation>... qualifiers) {

		AnnotatedGenericBeanDefinition abd = new AnnotatedGenericBeanDefinition(annotatedClass);
		if (this.conditionEvaluator.shouldSkip(abd.getMetadata())) {
			return;
		}
		
		// other code
		// ...
	}
```
整个流程就是这么简单。`ConditionEvaluator`会返回boolean代表校验是否通过。

## 具体怎么校验的
大概想一下，应该是从bean definition上读取`@Conditional`注解，取出里面的`Condition`，然后判断是否为true。

事实确实是这样。

第一步evaluator会判断bean定义里是否有`@Conditional`，如果没有，那就直接通过。

第二步，如果有`@Conditional`，取出所有的`Condition`：
```java
		for (String[] conditionClasses : getConditionClasses(metadata)) {
			for (String conditionClass : conditionClasses) {
				Condition condition = getCondition(conditionClass, this.context.getClassLoader());
				conditions.add(condition);
			}
		}
```

取`Condition`就是从`@Conditional`的属性值`value`里读取，然后new成对象：
```java
	private List<String[]> getConditionClasses(AnnotatedTypeMetadata metadata) {
		MultiValueMap<String, Object> attributes = metadata.getAllAnnotationAttributes(Conditional.class.getName(), true);
		Object values = (attributes != null ? attributes.get("value") : null);
		return (List<String[]>) (values != null ? values : Collections.emptyList());
	}
	
	private Condition getCondition(String conditionClassName, ClassLoader classloader) {
		Class<?> conditionClass = ClassUtils.resolveClassName(conditionClassName, classloader);
		return (Condition) BeanUtils.instantiateClass(conditionClass);
	}
```

所有的`Condition`要按照配置的order排一下序：
```java
		AnnotationAwareOrderComparator.sort(conditions);
```

最后，判断所有的`Condition`是否都返回true就行了：
```java
		for (Condition condition : conditions) {
			ConfigurationPhase requiredPhase = null;
			if (condition instanceof ConfigurationCondition) {
				requiredPhase = ((ConfigurationCondition) condition).getConfigurationPhase();
			}
			if (requiredPhase == null || requiredPhase == phase) {
				if (!condition.matches(this.context, metadata)) {
					return true;
				}
			}
		}
```
非常简单。

# 应用
虽然springboot才是`@Conditional`大展身手的地方，但是spring里本身也有用`@Conditional`的例子。

## `@Profile`
`@Profile`注解从3.1引入spring，`@Conditional`则是在spring 4.0引入的。引入的同时，`@Profile`就用`@Conditional`重写了。

看`@Profile`的定义，**`@Profile`等价于 `@Conditional(ProfileCondition.class)`**，并且能指定string数组配置，作为要匹配的profiles：
```java
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Conditional(ProfileCondition.class)
public @interface Profile {

	/**
	 * The set of profiles for which the annotated component should be registered.
	 */
	String[] value();

}
```
然后`ProfileCondition`就会判断当前environment是否包含这些profiles的任意一个：
```java
class ProfileCondition implements Condition {

	@Override
	public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
		MultiValueMap<String, Object> attrs = metadata.getAllAnnotationAttributes(Profile.class.getName());
		if (attrs != null) {
			for (Object value : attrs.get("value")) {
				if (context.getEnvironment().acceptsProfiles(Profiles.of((String[]) value))) {
					return true;
				}
			}
			return false;
		}
		return true;
	}

}
```
很整洁的实现。

## springboot
到了springboot里，基于`@Conditional`实现的注解就五花八门了，但整体逻辑和`@Profile`是一样的。

比如`@ConditionalOnBean`/`@ConditionalOnMissingBean`
```java
@Target({ ElementType.TYPE, ElementType.METHOD })
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Conditional(OnBeanCondition.class)
public @interface ConditionalOnBean {

	/**
	 * The class types of beans that should be checked. The condition matches when beans
	 * of all classes specified are contained in the {@link BeanFactory}.
	 * @return the class types of beans to check
	 */
	Class<?>[] value() default {};
	
	// ...
}
```
`OnBeanCondition`会判断bean factory里是否已经有声明的bean，再决定是否要注册这个bean。

同理用的比较多的还有：
- `@ConditionalOnClass`
- `@ConditionalOnProperty`

其他还有：
- `@ConditionalOnResource`
- `@ConditionalOnJava`
- ...

## 基于springboot
springboot基于`@Conditional`创建了一系列条件注解，我们（或者springboot自己）基于springboot提供的这些注解，就可以创建一些自动配置类了，比如elasticsearch的自动配置——如果没有`RestClient`，那就自动配置一个`RestClient`：
```java
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnMissingBean(RestClient.class)
	static class RestClientConfiguration {

		@Bean
		RestClient elasticsearchRestClient(RestClientBuilder restClientBuilder) {
			return restClientBuilder.build();
		}

	}
```
当然前提是classpath上必须有`RestClientBuilder`类：
```java
@ConditionalOnClass(RestClientBuilder.class)
```

# 感想
springboot差不多齐活了。

