---
layout: post
title: "SpringBoot MVC"
date: 2022-12-03 02:54:20 +0800
categories: spring springboot mvc
tags: spring springboot mvc
---

在介绍[Spring Web MVC]({% post_url 2022-12-03-spring-web-mvc %})的时候说过，springboot反转了调用关系，翻身做主人了。**springboot启动内嵌的servlet容器，内嵌的servlet容器还和之前调用SpringMVC的方式一样，只不过这次调用的是springboot的组件，不再是SpringMVC了**。

1. Table of Contents, ordered
{:toc}

# 蓄意内嵌servlet容器
[springboot MVC](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#web.servlet.embedded-container)不像SpringMVC一样，由servlet容器调用自己。而是启动一个自己的`ApplicationContext`，先像普通springboot app一样配置好各种bean，**这些bean甚至可以包含一些包装了servlet的`Servlet`/`Filter`的wrapper bean**。然后启动一个servlet容器，**再把那些wrapper bean注册到servlet容器里**。

**这样程序猿来说，配置servlet、filter的工作就可以以普通springboot bean的形式进行了。对于新手来说，甚至都不用太理解servlet规范就可以上手配置，启动一个servlet容器了**。不得不说，springboot这一思路真的是6！

> When using an embedded servlet container, you can register servlets, filters, and all the listeners (such as HttpSessionListener) from the servlet spec, **either by using Spring beans or by scanning for servlet components.**
>
> **Any Servlet, Filter, or servlet `Listener` instance that is a Spring bean is registered with the embedded container**.
>
> By default, if the context contains only a single Servlet, it is mapped to `/`. **In the case of multiple servlet beans, the bean name is used as a path prefix**. Filters map to `/*`.

另外借助springboot定义好的名为web的[logging group](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#features.logging.log-groups)，可以直接配置`logging.level.web=debug`以让所有的web相关日志都输出debug，非常方便。

# servlet context初始化
那么springboot启动内嵌的tomcat之后，后面应该还是使用SPI自动监测servlet的`ServletContainerInitializer`或者SpringMVC的`SpringServletContainerInitializer`做初始化工作吧？也不是了。

**servlet的初始化使用的还是`ServletContainerInitializer`，但不再是随随便便检测到的`ServletContainerInitializer`，也不再是SpringMVC的`SpringServletContainerInitializer`，而是springboot手动指定的自己的`ServletContainerInitializer`实现。[按照springboot的说法](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#web.servlet.embedded-container.context-initializer)，这样做可以避免别的实现了servlet的SPI规范的第三方依赖对servlet容器进行初始化。**
> Embedded servlet containers do not directly execute the `jakarta.servlet.ServletContainerInitializer` interface or Spring's `org.springframework.web.WebApplicationInitializer` interface. **This is an intentional design decision intended to reduce the risk that third party libraries designed to run inside a war may break Spring Boot applications.**

这一安全考虑也可以参考[Spring Web MVC]({% post_url 2022-12-03-spring-web-mvc %})“`WebApplicationInitializer`是怎么被发现的”，**因为tomcat确实会把classpath上所有的相关类都收集起来做servlet的初始化，比较失控**。

这么一看springboot管的挺宽啊！**servlet都已经定义了`ServletContainerInitializer`的SPI规范，springboot却不让自己启动的内嵌servlet容器检测别的SPI规范实现者**。按照上面的说法，它这么做是为了防止那些实现者在初始化的时候破坏了springboot app。

springboot怎么做到阻止别人的？

**springboot在启动内嵌tomcat的时候，不使用SPI机制检测`ServletContainerInitializer`了，而是手动set `ServletContainerInitializer`到tomcat里，且只set springboot自己的`ServletContainerInitializer`实现类`TomcatStarter`。这样就能防止第三方随意注册，包括SpringMVC。而且因为掐断了SpringMVC，所以自定义SpringMVC的`WebApplicationInitializer`以初始化servlet容器的方法也失灵了**。

## `ServletContainerInitializer`

现在，只有springboot的`TomcatStarter`会被servlet容器调用以进行初始化。springboot也把初始化的过程委托了出去：就像SpringMVC的`SpringServletContainerInitializer`提供了`WebApplicationInitializer`以初始化`ServletContext`（tomcat的）一样，springboot的`TomcatStarter`会调用`ServletContextInitializer`初始化`ServletContext`。现在我们可以实现`ServletContextInitializer`的实现类以自定义servlet容器了。

> If you need to perform servlet context initialization in a Spring Boot application, you should register a bean that implements the `org.springframework.boot.web.servlet.ServletContextInitializer` interface. The single onStartup method provides access to the `ServletContext` and, if necessary, can easily be used as an adapter to an existing `WebApplicationInitializer`.

springboot的`ServletContextInitializer`和SpringMVC的`WebApplicationInitializer`，这俩用来自定义初始化servlet容器的接口长得一模一样，甚至连方法的javadoc都是抄的……
```java
public interface WebApplicationInitializer {

	/**
	 * Configure the given {@link ServletContext} with any servlets, filters, listeners
	 * context-params and attributes necessary for initializing this web application. See
	 * examples {@linkplain WebApplicationInitializer above}.
	 * @param servletContext the {@code ServletContext} to initialize
	 * @throws ServletException if any call against the given {@code ServletContext}
	 * throws a {@code ServletException}
	 */
	void onStartup(ServletContext servletContext) throws ServletException;

}

public interface ServletContextInitializer {

	/**
	 * Configure the given {@link ServletContext} with any servlets, filters, listeners
	 * context-params and attributes necessary for initialization.
	 * @param servletContext the {@code ServletContext} to initialize
	 * @throws ServletException if any call against the given {@code ServletContext}
	 * throws a {@code ServletException}
	 */
	void onStartup(ServletContext servletContext) throws ServletException;

}
```
**所以这俩的设计思路是一模一样的。唯一的区别就是：在springboot里，SpringMVC被掐断了，所以SpringMVC提供的`WebApplicationInitializer`不能用了，用springboot提供的`ServletContextInitializer`吧。用法还和之前写SpringMVC的`WebApplicationInitializer`一样。**

> 反而觉得springboot的名字起的更直白：所谓init web app，不就是init `ServletContext`嘛！

# 启动流程
springboot启动mvc的流程：
1. 启动springboot app，配置bean；
2. 启动内嵌servlet容器；
3. servlet调用springboot的`ServletContextInitializer`以初始化servlet容器（和servlet调用SpringMVC一模一样）；
3. 将servlet相关的bean从springboot的wac里取出来，注册到servlet里；

## 启动springboot - `ServletWebServerApplicationContext`
启动springboot web，`ApplicationContext`用的是`ServletWebServerApplicationContext`，它是springboot对`WebServerApplicationContext`和`WebApplicationContext`接口实现。它和SpringMVC的`WebServerApplicationContext`不同的地方在于：它会创建并启动内嵌servlet容器。

> Under the hood, Spring Boot uses a different type of `ApplicationContext` for embedded servlet container support. The `ServletWebServerApplicationContext` **is a special type of `WebApplicationContext` that bootstraps itself by searching for a single `ServletWebServerFactory` bean. Usually a `TomcatServletWebServerFactory`**, `JettyServletWebServerFactory`, or `UndertowServletWebServerFactory` has been auto-configured.

创建servlet容器的事情实际是交给`ServletWebServerFactory`干的，比如`TomcatServletWebServerFactory`。

## 创建`WebServer` - `ServletWebServerFactory`
内嵌servlet容器的抽象是`WebServer`，比如`TomcatServletWebServer`。

`ServletWebServerApplicationContext`也是`ApplicationContext`，所以也有普通`ApplicationContext`的生命流程：
1. 在`postProcessBeforeInitialization`的时候，**会调用`ServletWebServerFactoryCustomizer#customize`，把程序猿自定义的tomcat的port、context path等属性全都设置到tomcat server里**；
2. `onRefresh`的时候获取`ServletWebServerFactory` bean（通过autoconfig class自动配置的），用它实例化`TomcatWebServer`。
    1. **`TomcatWebServer`其实就是apache tomcat（`org.apache.catalina.startup.Tomcat`）的wrapper**，所以要先创建一个真正的tomcat。此时connector、service、engine、valve、docBase，全都映入眼帘……废话，这些代码都是tomcat的……host注册到engine上，**最后一个tomcat container是Context，注册到host上（servlet的`Wrapper`这个最底层Container比较特殊，是在start的时候才实例化出来的。其他几个上层Container是一开始就实例化出来的）**
    2. **此时还手动注册了springboot的`ServletContainerInitializer`实现类`TomcatStarter`到`Context`上**，见下文。
    3. 创建`TomcatWebServer`完毕。**启动tomcat**！

## 启动tomcat
启动tomcat，内部调用的是`Server#start`。然后就是tomcat lifecycle那一长串的父子container的链式调用start了。

> 关于tomcat `Server`，参考[（九）How Tomcat Works - Tomcat Service]({% post_url 2020-10-09-tomcat-service %})。

这一串调用里会涉及到异步启动。**但很明显，这个异步启动只是为了让下一级的各个子`Container`组件并行执行以加快启动时间**。之后的阻塞式`get()`说明了依然是全都执行完毕后才能进行后面的操作：
```java
        for (Container child : children) {
            results.add(startStopExecutor.submit(new StartChild(child)));
        }

        MultiThrowable multiThrowable = null;

        for (Future<Void> result : results) {
            try {
                result.get();
            } catch (Throwable e) {
                log.error(sm.getString("containerBase.threadedStartFailed"), e);
                if (multiThrowable == null) {
                    multiThrowable = new MultiThrowable();
                }
                multiThrowable.add(e);
            }

        }
```

### 调用`ServletContainerInitializer`
tomcat启动到`Context` container的时候，就涉及到`ServletContainerInitializer`的调用了。和SpringMVC的入口一样，springboot亦如此：
```java
            // Call ServletContainerInitializers
            for (Map.Entry<ServletContainerInitializer, Set<Class<?>>> entry :
                initializers.entrySet()) {
                try {
                    entry.getKey().onStartup(entry.getValue(),
                            getServletContext());
                } catch (ServletException e) {
                    log.error(sm.getString("standardContext.sciFail"), e);
                    ok = false;
                    break;
                }
            }
```
会调用所有的`ServletContainerInitializer`。

> tomcat的ServletContext的实现就叫`org.apache.catalina.core.ApplicationContext`：`ApplicationContext implements ServletContext`，重名了，就很魔性。**`getServletContext()`获取的就是这个tomcat的ApplicationContext**。

**springboot在创建embed tomcat的时候，就往`Context` container里手动set了一个`ServletContainerInitializer`的实现：`TomcatStarter`**。

> 还set了一个websocket相关的initializer，但那是另一回事儿了。所以可以理解为有且只有一个springboot的servlet initializer。所以现在不走SpringMVC那一套了。

#### `ServletContainerInitializer` SPI探测去哪了？
**虽然springboot手动往embed tomcat只注册了自己的`ServletContainerInitializer`，它是怎么做到不让embed tomcat探测别人的SPI实现的？**

tomcat的[WebappServiceLoader](https://github.com/apache/tomcat/blob/af983a45c8e3f2252c1a14d52024dde63ffffff2/java/org/apache/catalina/startup/WebappServiceLoader.java#L187)会遍历所有的jar包，并从jar里加载文件：
```java
uri = new URI("jar:" + baseExternal + "!/" + entryName);
```
这显然是为了使用SPI机制。

`ContextConfig`用于配置`Context` container，它会探测`ServletContainerInitializer`的SPI实现：
```java
detectedScis = loader.load(ServletContainerInitializer.class);
```
它是默认的Context config类：the default context configuration class for deployed web applications.

在apache `Tomcat`的main函数里，tomcat在加载web app的时候，自动就注册上这个config类了：
```java
tomcat.addWebapp(path, war.getAbsolutePath());
```
所以正常的tomcat一定会探测`ServletContainerInitializer`的SPI实现。

**springboot启动的是embed tomcat。创建完`Tomcat`实例之后，手撸了一组tomcat的`Container`组件，手动配置了`Context` container，没有使用标准的`ContextConfig`类配置`Context`，所以失去了探测`ServletContainerInitializer`的SPI实现的功能。**

> springboot启动的是被魔改的tomcat。

因此，springboot就能放心给这个embed tomcat手动设置自己的`ServletContainerInitializer`实现了。

### 调用`ServletContextInitializer`，注册`DispatcherServlet`
和SpringMVC的原理一样，springboot的`ServletContainerInitializer`的实现类要调用springboot的`ServletContextInitializer`初始化servlet容器。`ServletWebServerApplicationContext`就提供了一个`ServletContextInitializer`——`selfInitialize`方法：
```java
	private void selfInitialize(ServletContext servletContext) throws ServletException {
		prepareWebApplicationContext(servletContext);
		registerApplicationScope(servletContext);
		WebApplicationContextUtils.registerEnvironmentBeans(getBeanFactory(), servletContext);
		for (ServletContextInitializer beans : getServletContextInitializerBeans()) {
			beans.onStartup(servletContext);
		}
	}
```
**它的最后一步，会把servlet bean、filter bean都从`ServletWebServerApplicationContext`里取出来，用来初始化`ServletContext`！**

**`ServletWebServerApplicationContext`里注册的servlet相关的spring bean是各路`RegistrationBean`**：
- `FilterRegistrationBean`：filter wrapper
- `DispatcherServletRegistrationBean`：`DispatcherServlet` wrapper

> `DispatcherServletRegistrationBean`有个autoconfig class：`DispatcherServletAutoConfiguration`，所以是启动过程中自动配置的。它创建的时候也创建了`DispatcherServlet`。

**这些`RegistrationBean`有个共同的`onStartup`方法，把自己注册到`ServletContext里`！**

如果加入了spring security支持，还会有`DelegatingFilterProxyRegistrationBean`：
- `DelegatingFilterProxyRegistrationBean`：springSecurityFilterChain

一般情况下只会有`DispatcherServlet`一个servlet（`DispatcherServletRegistrationBean`），如果还有其他的servlet，比如配置了h2 database web console，还会再产生一个普通的`ServletRegistrationBean`：
- `ServletRegistrationBean`：比如`WebServlet`，url=h2-console，启动了一个h2 web console。

## 启动`TomcatWebServer`
启动完tomcat，初始化完servlet container之后，springboot还给`BeanFactory`注册了启动关闭`TomcatWebServer`（embed tomcat wrapper）的lifecycle：
```java
getBeanFactory().registerSingleton("webServerGracefulShutdown",
		new WebServerGracefulShutdownLifecycle(this.webServer));
getBeanFactory().registerSingleton("webServerStartStop",
		new WebServerStartStopLifecycle(this, this.webServer));
```

最后`ServletWebServerApplicationContext#finishRefresh`的时候，调起`LifecycleProcessor#onRefresh`，启动所有`Lifecycle` bean的start方法（有点儿像tomcat lifecycle的方式），这个时候就启动`TomcatWebServer`了！

注意这个时候启动的是`TomcatWebServer`，不是tomcat。tomcat在创建`TomcatWebServer`完成之前就启动了。

这个时候会输出那句著名的：
```java
logger.info("Tomcat started on port(s): " + getPortsDescription(true) + " with context path '"
		+ getContextPath() + "'");
```

> Tomcat started on port(s): 8081 (http) with context path '/wtf' :D

然后发布`TomcatWebServer`启动完毕事件。

# `@ServletComponentScan`
servlet提供了标准的`@WebServlet`/`@WebFilter`/`@WebListener`以注册servlet组件，标准tomcat会扫描并注册他们。但是springboot用的是embed tomcat，所以提供了[`@ServletComponentScan`](https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#web.servlet.embedded-container.context-initializer.scanning)对他们提供支持。**在使用standalone tomcat时，该注解不会生效，否则就实例化两份了**：

> `@ServletComponentScan` has no effect in a standalone container, where the container’s built-in discovery mechanisms are used instead.

# 感想
第一次试图了解springboot tomcat还是四年前，刚工作一年整，对spring了解一般，springboot更是不了解。当时啥也没探究出来，太惨了……

加油吧菜鸡o(╥﹏╥)o，把前置知识都理解清楚了，一切都水到渠成了。
