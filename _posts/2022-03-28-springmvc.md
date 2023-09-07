---
layout: post
title: "SpringMVC：HTTP请求处理全流程"
date: 2022-03-28 00:31:25 +0800
categories: Tomcat Http web servlet spring mvc
tags: Tomcat Http web servlet spring mvc
---

最近受到这四篇系列文章的激励：
- https://segmentfault.com/a/1190000021137583
- https://segmentfault.com/a/1190000021168133
- https://segmentfault.com/a/1190000021177809
- https://segmentfault.com/a/1190000021177945

把spring mvc处理请求的全流程梳理一下：
1. tcp服务器；
2. 基于tcp服务器构建tomcat，使用servlet处理请求；
3. spring使用DispatcherServlet处理请求；

基本把tcp -> http -> tomcat -> spring mvc的链条打通了。

1. Table of Contents, ordered
{:toc}

# TCP server
[（一）How Tomcat Works - 原始Web服务器]({% post_url 2020-10-07-tomcat-web-server %})，介绍了一个原始的TCP服务器的构建方式。

[从阻塞IO到IO多路复用到异步IO]({% post_url 2022-02-24-io-nio-aio %})则介绍了请求从网卡到达TCP服务器的过程。上述原始的tcp服务器使用的还是BIO。

# Tomcat
Tomcat使用原始的web服务器接收tcp请求，然后构建了一套servlet规范处理请求。

- [（二）How Tomcat Works - 原始Servlet服务器]({% post_url 2020-10-07-tomcat-servlet-server %})介绍了何谓servlet；
- [（三）How Tomcat Works - Tomcat连接器Connector]({% post_url 2020-10-08-tomcat-connector %})和[（四）How Tomcat Works - Tomcat servlet容器Container]({% post_url 2020-10-08-tomcat-container %})拆解了tomcat：
    + 前者介绍了tomcat怎么接收并解析请求的；
    + 后者介绍了请求是怎么在tomcat的体系里游走的；

从现在起，程序猿只要按照业务逻辑写个servlet，扔到tomcat下面，就可以处理http请求了。

问题又来了：**如果系统简单，总共没有几个接口，每个接口对应一个servlet，那就写几个servlet扔到tomcat里，再配置一下servlet的映射关系就行了**。如果系统复杂，那就要写一堆servlet，然而一堆servlet都配置到web.xml里，非常混乱。

所以，SpringMVC来了。

# Spring MVC
> Spring使用容器构建了一个自己的世界，使得程序猿在这个世界里组装代码非常简单。

spring mvc基于spring，要处理http请求。它选择继续站在前人的肩膀上：**把自己搞成一个servlet，依托于Tomcat存在**。

现在SpringMVC告诉程序猿：你们连servlet都不用写了，把自己的业务逻辑嵌在我的servlet里就行了。这个servlet就是DispatcherServlet。程序猿只需要在spring mvc的世界里写@Controller就可以了——以后大家不用写tomcat的servlet、listener、filter，来写我的@Service、@Controller吧！

他们都活在由DispatcherServlet构建的王国里。

# SpringMVC如何做的
## 世界分为两步
原本servlet协议就把servlet容器和程序猿做的工作拆分成了两步。有了DispatcherServlet之后，这两步依然没变：
1. tomcat调用DispatcherServlet；
2. 程序猿完全活在DispatcherServlet的世界；

## 第一步：Tomcat发现DispatcherServlet
### web.xml
Tomcat怎么发现servlet？将servlet配置在该web app的`web.xml`里。

DispatcherServlet作为servlet，也不例外：
```xml
<servlet>
    <servlet-name>mvc</servlet-name>
    <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
    <init-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>classpath:mvc-servlet.xml</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>
<servlet-mapping>
    <servlet-name>mvc</servlet-name>
    <url-pattern>/api</url-pattern>
</servlet-mapping>
```

### annotation
**从Servlet 3.0起（spring 4.0支持Servlet 3.0），可以不再使用web.xml了**。servlet规范推出了一套支持annotation的配置逻辑：tomcat会查找`javax.servlet.ServletContainerInitializer`的实现类，它可以直接配置servlet。**所以找到它就相当于找到了web.xml**。

> 为了用annotation配置，原来web.xml里有的tag都有了对应的annotation，比如现在可以用@WebServlet来配置一个servlet了。

spring按照Servlet 3.0规范，实现了一个`ServletContainerInitializer`的实现类，`SpringServletContainerInitializer`！tomcat按照servlet协议的约定，会调用这个初始化类。

spring使用这个初始化类把mvc相关的组件都初始化起来：**`SpringServletContainerInitializer`会调用`WebApplicationInitializer#onStartup`的实现类，把初始化的任务交给它。后者真正负责配置servlet**。

> 它的名字非常精准：initialize web application。**而在onStartup方法里，DispatcherServlet就被创建并注册了**！

**没有了web.xml，用户要怎么自定义一些web app相关的配置**？在自己的SpringServletContainerInitializer搞定这些。所以理论上我们只要写一个WebApplicationInitializer就行了！当然不需要完全重写，spring已经有了抽象类`AbstractAnnotationConfigDispatcherServletInitializer`，它在实现了`WebApplicationInitializer`的同时，还为用户暴露了几个配置接口:
- 通过覆写getRootConfigClasses，把自己app里的spring配置类（业务层配置）告诉spring，由它注册到容器AnnotationConfigWebApplicationContext里（**业务层spring容器**）；
- 通过覆写getServletConfigClasses，**把配置放到一个新的AnnotationConfigWebApplicationContext里，这个web application context会被用来创建DispatcherServlet**。所以这里放的配置一般就是mvc相关的，比如WebMvcConfigurer实现类，以覆盖默认的mvc行为（**web层spring容器**）；
- 通过覆写getServletMappings，**配置DispatcherServlet这个唯一servlet映射的url**；

> 这里涉及到两个spring容器：**业务层spring容器和web层spring容器，且二者是父子容器——web层spring容器是业务层spring容器的子容器，所以业务bean访问不到web bean，但反之可以**。他们的具体实现类都是AnnotationConfigWebApplicationContext。

所以我们只要写个类 extends AbstractAnnotationConfigDispatcherServletInitializer，按照需求覆写上面的几个方法就行了：
```java
public class SpitterWebInitializer extends AbstractAnnotationConfigDispatcherServletInitializer {
  
  @Override
  protected Class<?>[] getRootConfigClasses() {
    return new Class<?>[] { RootConfig.class };
  }

  @Override
  protected Class<?>[] getServletConfigClasses() {
    return new Class<?>[] { WebConfig.class };
  }

  @Override
  protected String[] getServletMappings() {
    return new String[] { "/" };
  }

}
```
在自己写的配置类里，用户按照自己的需求，进行不同程度的自定义配置：
- 自定义一些配置，比如：把哪个uri映射到DispatcherServlet上（一般是`/`）；
- 业务逻辑相关的配置写在了RootConfig类里；
- web相关的配置写在了WebConfig里。

接下来就是在DispatcherServlet的王国里写Controller。

## 第二步：DispatcherServlet处理（分发）请求
现在，**因为该web app只有一个servlet，并且默认映射到`/`，所以所有打到该web app的请求，都交给DispatcherServlet处理**。

现在知道它为什么叫DispatcherServlet了——所有的请求都交给它处理，它再把请求dispatch出去！分发给谁？分发给程序猿熟悉的@Controller。

> 现在假定的场景还是传统的Tomcat部署。spring应用依旧需要打成war包放到Tomcat下面，由Tomcat配置该web app的context path：https://stackoverflow.com/a/40671177/7676237
>
> 而在spring boot里，使用的是内嵌的Tomcat容器，所以spring boot可以给tomcat配置context path：https://www.baeldung.com/spring-boot-context-path
>
> **spring boot怎么做到的？日后再探究：spring boot embedded tomcat**

DispatcherServlet的这一模式，又被称作Front Controller：
- https://en.wikipedia.org/wiki/Front_controller
- https://web.archive.org/web/20120419115929/http://java.sun.com/blueprints/patterns/FrontController.html

# DispatcherServlet
**DispatcherServlet按照什么标准把请求dispatch给controller**？

先列一下DispatcherServlet处理请求的流程：
1. handler mapping：根据uri映射handler execution chain（handler execution chain = handler + handler interceptor）；
3. **handler execution chain**: `HandlerInterceptor#preHandle`；
4. **handler execution chain**: handle(invoke controller)，调用完之后，会涉及到我们自己写的@Controller的方法的返回结果的转换：
    1. **restful转为json**；
    2. ModelAndView：获取model和view；
1. **handler execution chain**: `HandlerInterceptor#postHandle`；
4. 处理结果
    1. 处理异常结果；
    2. 处理view：ModelAndView -> view resolver -> view (+ model) = response；
1. 调用`HandlerInterceptor#afterCompletion`；
2. 发布`ServletRequestHandledEvent`事件，宣布请求处理完了；

`Servlet#service`是处理servlet请求的标准入口。DispatcherServlet继承了HttpServlet。上面归纳的处理流程，都在`DispatcherServlet#doDispatch`方法里。

> https://docs.spring.io/spring-framework/docs/3.0.0.M4/spring-framework-reference/html/ch15s02.html

**DispatcherServlet的核心就是handler，通过handler处理请求**：
1. handler mapping，苦苦求索就为找到handler；
2. handler interceptor：**依托于handler**，设置了handler interceptor，做一些前置后置操作。

## `HandlerMapping`：全靠uri找到handler chain
handler mapping通过请求的uri找到对应的handler execution chain。从它接口的唯一方法就能看出：
- `HandlerExecutionChain getHandler(HttpServletRequest request)`：根据request（的uri）找到chain。

> **Tomcat在Context内部是根据uri映射servlet的。现在DispatcherServlet把所有收来的请求也按照uri映射到相应的Controller**。所以spring先用DispatcherServlet让程序猿不再直接写servlet，抢了tomcat的风光，再使用和tomcat类似的逻辑，分发请求给controller。tomcat已气晕_(¦3」∠)_

Spring默认可能已经注册好了以下HandlerMapping：
- `RequestMappingHandlerMapping`：**根据@Controller上的@RequestMapping映射请求**；
- BeanNameUrlHandlerMapping
- RouterFunctionMapping
- SimpleUrlHandlerMapping
- WelcomePageHandlerMapping

大家基本都在写@Controller，所以`RequestMappingHandlerMapping`就能根据request里的uri，找到@Controller。

handler execution chain由两部分组成：
1. HandlerMethod：**它就是handler**。其实就是@Controller里的映射到相关uri的方法。根据uri找到它；
2. HandlerInterceptor：请求拦截器。**也是根据uri判断该interceptor应不应该处理这个请求**！

这一步，把所有跟这个uri相关的handler和interceptor都收集起来了，组装成了execution chain。请求接下来就要由这个chain处理。

> spring web mvc默认可能有2个handler interceptor：ConversionServiceExposingInterceptor和ResourceUrlProviderExposingInterceptor。

如果没找到相应的handler呢？根据配置，要么抛异常NoHandlerFoundException，要么返回404。总之，请求结束了。

## `HandlerExecutionChain`：处理请求
之所以叫chain，因为它是handler和一堆interceptor的组合。请求要按照顺序从链上通过：
1. `HandlerInterceptor#preHandle`：**如果返回false，请求直接gg，return**；
2. HandlerMethod：**反射调用Controller的相关方法**，得到业务逻辑的结果；
    + **返回结果转换：如果是restful，Java对象转json**。见下文；
3. `HandlerInterceptor#postHandle`：后处理，在渲染view之前；
4. 处理结果：可能是异常，也可能是`ModelAndView`：非restful，见下文；
5. `HandlerInterceptor#afterCompletion`：完成后处理；

handler interceptor其实挺好记：
1. preHandle在handle之前；
2. postHandle在handle之后，处理结果（渲染view、处理exception）之前；
3. afterCompletion在处理结果（渲染view、处理exception）之后。毕竟都搞完了才叫completion。

### 返回结果转换：`HandlerMethodReturnValueHandler`
我们的业务逻辑处理完请求之后，会产生不同的返回值。比如：
- 返回void；
- 返回Java对象；
- 返回ModelAndView；

`HandlerMethodReturnValueHandler`专门根据相应的return value，做一些处理。
- `boolean supportsReturnType(MethodParameter returnType)`：是否能处理这种类型；
- `void handleReturnValue`：处理返回值；

#### `ModelAndViewMethodReturnValueHandler`：转换为ModelAndView（网页）
> **只是转换，并不是渲染view。渲染view在最后。**

比如`ModelAndViewMethodReturnValueHandler`专门处理返回`ModelAndView`的controller返回的数据。它的supportsReturnType的实现：
```java
 	@Override
	public boolean supportsReturnType(MethodParameter returnType) {
		return ModelAndView.class.isAssignableFrom(returnType.getParameterType());
	}
```
而它的处理方式就是从ModelAndView里获取model和view。

> **注意：这里并不是渲染view**。

#### `RequestResponseBodyMethodProcessor`：转换为json/xml（`@RequestBody`，restful）
> **对于restful，到这儿整个请求其实就是处理完了。后面没它事儿了。**

如果是restful，最终会使用`RequestResponseBodyMethodProcessor`处理返回的数据：
> **Resolves method arguments annotated with @RequestBody and handles return values from methods annotated with @ResponseBody by reading and writing to the body of the request or response with an HttpMessageConverter**.

其实就是使用各种`HttpMessageConverter`转换Java对象为json/xml等：[RESTful - HttpMessageConverter]({% post_url 2020-05-26-RESTful-HttpMessageConverter %})。

**它的view为null，所以也不需要model**。

> 注意：**如果返回值已经是string了，就不处理body了。所以rest controller如果返回string，并不是把string object给序列化为json，而是直接返回string。**

然后就按照content type、accept types、produce types开始转换，**最后写body。其实就是往response的outputstream里写数据**，和[（一）How Tomcat Works - 原始Web服务器]({% post_url 2020-10-07-tomcat-web-server %})并没有本质区别。

## 处理结果
结果就三种：
1. 有异常，处理异常；
1. 有model and view，渲染view；
2. **以上两个都没有。它可能是restful，因为restful不返回view。但是restful在handle的时候已经被转换成json了。这里不需要再处理了**。

### 处理异常
如果DispatcherServlet处理请求的过程中有异常，spring会对其拦截，并进行处理。

**所谓拦截，就是try catch住DispatcherServlet整个处理的流程，获取exception**。

接下来就是怎么处理这个exception的问题。

#### `HandlerExceptionResolver`：处理异常
spring默认会注册下面三种resolver（顺序）：
- **`ExceptionHandlerExceptionResolver`：使用`@ExceptionHandler`对应的方法处理异常**；
- `ResponseStatusExceptionResolver `：使用`@ResponseStatus`对应的方法处理异常。缺点是只能处理status code，没法设置body；
- `DefaultHandlerExceptionResolver`：把[Spring定义的异常和status code](https://docs.spring.io/spring-framework/docs/3.2.x/spring-framework-reference/html/mvc.html#mvc-ann-rest-spring-mvc-exceptions)进行映射。同样，缺点是设置不了body。**如果不定义任何异常处理器，用的就是这个**；

**当使用`@ExceptionHandler`全局处理异常时，`ExceptionHandlerExceptionResolver`是会被用到的异常处理器。**

#### `@ExceptionHandler`：定义异常返回的header和body
`@ExceptionHandler`非常灵活，可以给被注解的方法设置非常灵活的参数：
- exception；
- request、response；

等等。

还可以设置非常灵活的返回值：
- ModelAndView/Model/View；
- String；
- `@ResponseBody`：to set the response content. The return value will be converted to the response stream using message converters；
- `HttpEntity<?>`/`ResponseEntity<?>`：to set response headers and content；
- void：if the method handles the response itself (by writing the response content directly, declaring an argument of type ServletResponse / HttpServletResponse for that purpose)；

**所以`@ExceptionHandler`和`@ResponseStatus`相比，最大的优势在于定义header和body**。

> 强烈建议看看它的Javadoc！
>
> 相似地，标记了`@RequestMapping`的方法也有[很多参数类型](https://docs.spring.io/spring-framework/docs/3.2.x/spring-framework-reference/html/mvc.html#mvc-ann-methods)可以设置，[很多种类型](https://docs.spring.io/spring-framework/docs/3.2.x/spring-framework-reference/html/mvc.html#mvc-ann-return-types)可以作为返回值。和`@ExceptionHandler`类似。

它的劣势在于定义在@Controller时，只能被该Controller独有。**而`@ControllerAdvice` + `@ExceptionHandler`则可以让后者在所有Controller内共享，作为全局的exception处理器**！

> **`@ControllerAdvice`的Javadoc**：Specialization of @Component for classes that declare @ExceptionHandler, @InitBinder, or @ModelAttribute methods to be shared across multiple @Controller classes.

比如下面这个示例，`@ControllerAdvice`和`@ExceptionHandler`组合使用，甚至还加了`@ResponseStatus`：
```java
@ControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 想序列化它为json，必须加{@link Data}
     */
    // TODO: Whitelabel Error Page
    @ExceptionHandler(UserNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public @ResponseBody ErrorResponse userNotFound(UserNotFoundException e, HttpServletResponse response) {
        response.setHeader("no-user-id", e.getMessage());
        return new ErrorResponse(11111, e.getMessage());
    }
    
    // 当然也可以只返回header status
//    public void userNotFound(UserNotFoundException e, HttpServletResponse response) {
//        response.setHeader("no-user-id", e.getMessage());
//        return;
//    }
}
```
`@ExceptionHandler`默认被上述`ExceptionHandlerExceptionResolver`持有，它会负责发现所有的`@ExceptionHandler`：
```java
	private void initExceptionHandlerAdviceCache() {
		if (getApplicationContext() == null) {
			return;
		}

        // 1
		List<ControllerAdviceBean> adviceBeans = ControllerAdviceBean.findAnnotatedBeans(getApplicationContext());
		for (ControllerAdviceBean adviceBean : adviceBeans) {
			Class<?> beanType = adviceBean.getBeanType();
			if (beanType == null) {
				throw new IllegalStateException("Unresolvable type for ControllerAdviceBean: " + adviceBean);
			}
			ExceptionHandlerMethodResolver resolver = new ExceptionHandlerMethodResolver(beanType);
			if (resolver.hasExceptionMappings()) {
			
			    // 2
				this.exceptionHandlerAdviceCache.put(adviceBean, resolver);
			}
			if (ResponseBodyAdvice.class.isAssignableFrom(beanType)) {
			
			    // 3
				this.responseBodyAdvice.add(adviceBean);
			}
		}
	}
```
1. 它会从ApplicationContext里找到所有的`@ControllerAdvice` bean；
2. 然后把`@ExceptionHandler`找出来；
3. 再把返回`@ResponseBody`的找出来；

最后用这些handler处理异常。

参阅：
- spring处理异常：https://www.baeldung.com/exception-handling-for-rest-with-spring
- https://www.baeldung.com/spring-dispatcherservlet#handlerExceptionResolver
- DispatcherServlet的处理流程：https://www.baeldung.com/spring-dispatcherservlet

### `ModelAndView`：如果需要返回view
如果不是restful，返回的是model and view，就要开始渲染html了。

#### model & view
- `Model`：**一些数据，用来渲染view的参数。可以理解为map**；
- `View`：**参数化的用来渲染网页的模板**。比如thymeleaf的模板；
- `ModelAndView`：就是为了让方法一次return俩值……both model and view。This class merely holds both to make it possible for a controller to return both model and view in a single return value。ModelAndView里面的view之所以用Object不用View，因为放的是：View instance or view name String；

参阅：
- https://www.baeldung.com/spring-mvc-model-model-map-model-view

调用`View#render`方法，交给特定框架渲染html就好。而View的render方法，第一个参数代表model，实际定义的是个map，暴露了model的本质。

> view resolver & view: 本质还是后端渲染。现在前后端分离了，正常的系统都不需要这俩了。

### ~~restful？~~
不需要处理这个结果。handle后就转过了。

### `HandlerInterceptor#afterCompletion`
view都渲染完了，请求确实处理完了。

## 发布事件
终于处理完了请求，可喜可乐！怎么着也得庆祝一下不是？所以最后还不忘再发布一个`ServletRequestHandledEvent`。参见[Spring - bean的容器]({% post_url 2021-11-21-spring-context %})里对容器事件的介绍。

> 其实发布事件的代码在DispatcherServlet的父类FrameworkServlet里。

# 框架的本质
程序的执行永远是线性的：
1. Java提供的框架是main函数：程序猿在main函数里写代码就行了；
2. Tomcat在main里启动，然后构造了Connector、Container（Engine/Host/Context/Wrapper），提供的是servlet接口：程序猿只要写servlet扔到tomcat里就行了；
3. Spring在main里启动，构造的是spring application context：程序猿只要在里面写bean就行了；
4. SpringMVC由Tomcat调用，构造了DispatcherServlet：程序猿只要在DispatcherServlet里写Controller就行了；

所以框架的本质就是在线性运行的main函数里，把你引到它的世界，并让大家爱上这个世界，在此停留。至于原本main那条线上要做的事情，不需要再管了。

不管了，就简单了。但是如果不知道还有外面的那条线，被框架蒙蔽在它所构建的世界里，就永远是个被一叶障目的程序猿，不见泰山。有了框架：可以免去写那些东西了，但不代表不需要知道外面的世界。

**而现实是，框架经常是堆叠的**。比如spring web mvc基于tomcat而存在，所以程序猿所在的spring web mvc的世界外还有一个tomcat的世界。这是一个套娃的世界，如果程序猿对此没有感知，请求报错的时候将会非常迷茫。

> 所以tomcat和spring mvc可以共存：context path设为/xxx/，这样所有非xxx的请求会依然使用tomcat，/xxx/开头的请求才会进入spring mvc。

在DispatcherServlet之前，spring也有参与，比如：javax.servlet.Filter接口spring也继承了。所以在进入servlet之前也调用了spring的filter。用的还挺多的，包括spring security。可以再学学filter接口。

还有一个好玩儿的东西：spring处理请求的时候，把request#attribute当做临时传参的地方了。不过接下来会立刻擦掉：
```java
	@Override
	protected HandlerMethod getHandlerInternal(HttpServletRequest request) throws Exception {
		request.removeAttribute(PRODUCIBLE_MEDIA_TYPES_ATTRIBUTE);
		try {
			return super.getHandlerInternal(request);
		}
		finally {
			ProducesRequestCondition.clearMediaTypesAttribute(request);
		}
	}
```
finally语句，确保一定擦掉。不让用户看见。233，小动作。
