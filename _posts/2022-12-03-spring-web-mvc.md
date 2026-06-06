---
layout: post
title: "Spring Web MVC"
date: 2022-12-03 00:25:17 +0800
categories: spring mvc cors
tags: spring mvc cors
---

SpringMVC的全称是[Spring Web MVC](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html)，来自于它的module名`spring-webmvc`。

> 现在的[Spring WebFlux](https://docs.spring.io/spring-framework/docs/current/reference/html/web-reactive.html)亦如是，来自`spring-webflux`。

1. Table of Contents, ordered
{:toc}

# 初始化`DispatcherServlet`
`DispatcherServlet`已经是SpringMVC默认情况下唯一的一个servlet了。所以SpringMVC的核心就是把`DispatcherServlet`注册到tomcat容器里。

tomcat分两条线：
1. 第一条线分两步：
    1. 第一步实例化tomcat的各个组件，并像拼零件一样拼到一起：**把host挂到engine上，context挂到host上，~~servlet挂到context上~~**；
    2. 第二步通过tomcat start，触发刚刚那一串儿组件的初始化，**链式启动engine、host、context，启动context的时候加载`ServletContainerInitializer`，用它来实例化servlet，比如`DispatcherServlet`**；
3. 第二条线接收请求，交给刚刚的组件，根据请求的url，一步步找到处理它的servlet，处理请求；

> **servlet这个最底层`Container`比较特殊，是在start的时候才实例化出来的**。其他几个上层`Container`是一开始就实例化出来的。

根据[SpringMVC：HTTP请求处理全流程]({% post_url 2022-03-28-springmvc %})的介绍，**SpringMVC的理念是让servlet容器调用SpringMVC，从而进行SpringMVC的初始化**。tomcat寻找实现`ServletContainerInitializer`接口的类来初始化servlet，寻找方式是SPI：jar包需要有一个文件`META-INF/services/javax.servlet.ServletContainerInitializer`，文件内容为接口的实现类的类名。

> 也只能靠SPI了，毕竟不能想spring一样做component scan。

找到这样的实现类后，tomcat会在`Context` container的标准实现`StandardContext`里调用他们，对servlet容器进行初始化：
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
从调用这一步开始，就进入了SpringMVC的流程。

SpringMVC对`ServletContainerInitializer`接口的实现为`SpringServletContainerInitializer`，所以SpringMVC的jar包包含`META-INF/services/javax.servlet.ServletContainerInitializer`，内容就是`org.springframework.web.SpringServletContainerInitializer`。

**SpringMVC的这个实现并没有直接初始化servlet container，而是委托给了`WebApplicationInitializer`**。所以程序猿可以实现spring提供的`WebApplicationInitializer`以初始化`DispatcherServlet`。

**一个最简单的`WebApplicationInitializer`实现**：
```java
public class MyWebApplicationInitializer implements WebApplicationInitializer {

    @Override
    public void onStartup(ServletContext servletContext) {

        // Load Spring web application configuration
        AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext();
        context.register(AppConfig.class);

        // Create and register the DispatcherServlet
        DispatcherServlet servlet = new DispatcherServlet(context);
        ServletRegistration.Dynamic registration = servletContext.addServlet("app", servlet);
        registration.setLoadOnStartup(1);
        registration.addMapping("/app/*");
    }
}
```
1. 创建一个`WebApplicationContext`，加载spring config配置（**主要就是为了用这些bean实例化`DispatcherServlet`**）；
2. 使用`WebApplicationContext`里的bean实例化`DispatcherServlet`；
3. **将`DispatcherServlet`添加到`ServletContext`里**，并将其映射为某个mapping；

**“将`DispatcherServlet`添加到`ServletContext`里”，实际就是把servlet注册到了tomcat的`Context` container里**。按照tomcat`ServletContext`的标准实现`ApplicationContext`（和spring的重名了，但二者完全不是一个东西……）的实现逻辑来看，`ServletContext#addServlet`这一行为会：
1. 创建一个`Wrapper`；
2. 把servlet放到`Wrapper`里；
3. **把`Wrapper`挂到`Context`上**；

```java
        Wrapper wrapper = (Wrapper) context.findChild(servletName);

        // Assume a 'complete' ServletRegistration is one that has a class and
        // a name
        if (wrapper == null) {
            wrapper = context.createWrapper();
            wrapper.setName(servletName);
            context.addChild(wrapper);
        } else {
            if (wrapper.getName() != null &&
                    wrapper.getServletClass() != null) {
                if (wrapper.isOverridable()) {
                    wrapper.setOverridable(false);
                } else {
                    return null;
                }
            }
        }

        ServletSecurity annotation = null;
        if (servlet == null) {
            wrapper.setServletClass(servletClass);
            Class<?> clazz = Introspection.loadClass(context, servletClass);
            if (clazz != null) {
                annotation = clazz.getAnnotation(ServletSecurity.class);
            }
        } else {
            wrapper.setServletClass(servlet.getClass().getName());
            wrapper.setServlet(servlet);
            if (context.wasCreatedDynamicServlet(servlet)) {
                annotation = servlet.getClass().getAnnotation(ServletSecurity.class);
            }
        }
```

## 题外话：`WebApplicationInitializer`是怎么被发现的
“只要实现一个`WebApplicationInitializer`，它就会自动被用来初始化servlet”。谁发现的这个实现类？它怎么就被用来初始化servlet了？需要配置成bean吗？不需要。

`SpringServletContainerInitializer`会使用`WebApplicationInitializer`初始化servlet，但是看`SpringServletContainerInitializer`的方法就会发现，`WebApplicationInitializer`的实现类们是从调用者传进来的：
```java
public void onStartup(@Nullable Set<Class<?>> webAppInitializerClasses, ServletContext servletContext)
			throws ServletException
```
传进来之后才开始进入到spring的一亩三分地，所以“实例化`WebApplicationInitializer`的实现类”显然不是spring干的。

SpringMVC的调用者是谁？servlet容器，或者说tomcat。在tomcat的`StandardContext`中：
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
显然，`ServletContainerInitializer#onStartup`的第一个参数`Set<Class<?>>`，是由tomcat收集的。

查看spring的`ServletContainerInitializer`实现`SpringServletContainerInitializer`，会发现它上面标注了`@HandlesTypes(WebApplicationInitializer.class)`。**而`@HandlesTypes`是servlet规范提供的标准注解**：

> This annotation is used to declare an array of application classes which are passed to a javax.servlet.ServletContainerInitializer. Since: Servlet 3.0

所以，**servlet规范通过`@HandlesTypes`声明了每一个`ServletContainerInitializer`的第一个参数绑定为哪些类。而servlet容器负责找到并实例化这些类，然后在调用`ServletContainerInitializer#onStartup`的时候传给`ServletContainerInitializer`**。

> 在[这里](https://stefan-isele.logdown.com/posts/201646)可以找到类似的说明：The class `org.springframework.web.SpringServletContainerInitializer` is annotated with
`@javax.servlet.annotation.HandlesTypes(WebApplicationInitializer.class)`
and implements `javax.servlet.ServletContainerInitializer`. According to the Servlet 3 specification the container will call `ServletContainerInitializer#onStartup(Set<Class<?>>, ServletContext)` on every class in the classpath implementing that interface, suppling a set of classes as defined in HandlesTypes.

接下来的事情就比较简单了，tomcat是怎么实例化这些类的？**通过`clazz = Introspection.loadClass(context, className)`直接从classpath上找相关的类，找到一个实例化一个。**

找到和initializer相关联的类之后，通过`Context#addServletContainerInitializer`把他们关联起来：
```java
    /**
     * Add a ServletContainerInitializer instance to this web application.
     *
     * @param sci       The instance to add
     * @param classes   The classes in which the initializer expressed an
     *                  interest
     */
    public void addServletContainerInitializer(
            ServletContainerInitializer sci, Set<Class<?>> classes);
```

**这里可以注意一下，因为springboot直接手动调用该方法，手动关联initializer对应的class为springboot自己的`ServletContextInitializer`**。

另外需要注意的一点：tomcat扫描classpath上的类，判断名字是否符合。spring也是扫描classpath上的类，不过是`ComponentScan`指定的路径，不是完整的classpath。另外扫描到类之后，判断有没有相关bean注解，再决定是否实例化。**所以tomcat的杀伤力比较大，随随便便引入的一个第三方（恶意）包如果含有相关的类，都会被实例化出来**。这也是springboot所谓的用servlet默认的方式启动不安全，需要自己手撸一套启动流程，弃用servlet容器默认的类探测的原因。

> 详见[SpringBoot MVC]({% post_url 2022-12-03-springboot-web-mvc %})

## hierarchy
上述实现比较简单，只使用了一个`WebApplicationContext`。**实际上servlet是有层级关系的：servlet的属性分为两类，所有servlet共享的和各个servlet独有的。前者放在全局的`ServletContext`里，后者放在servlet独有的`ServletConfig`里**。

**servlet本身就支持parent child层级，所以[SpringMVC也支持层级关系](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-servlet-context-hierarchy)**：有一个全局的`WebApplicationContext`作为root，和全局的`ServletContext`关联在一起，还有servlet独有的`WebApplicationContext`，是root wac的子wac。子wac能访问父wac的bean，反之不行。

> [MockMvc]({% post_url 2022-11-26-spring-mvc-test %})也和上面的使用场景一样，root wac也是实例化`DispatcherServlet`时使用的wac。

spring把它`web.xml`里配置的init param使用`ServletContext`/`ServletConfig`读出来，放到了对应的父/子`WebApplicationContext`里。**如果场景比较简单，可以把所有的变量都设置到共享的param，不设置servlet独有的param。同理，也可以只使用一个`WebApplicationContext`初始化`DispatcherServlet`**。上面的例子就是这样。

> It is also possible to have a context hierarchy where one root `WebApplicationContext` is shared across multiple `DispatcherServlet` (or other Servlet) instances, each with its own child `WebApplicationContext` configuration.

所以实际实现SpringMVC的时候，一般比上面的例子复杂：
1. 注册实现一个`ContextLoaderListener`：负责（从`web.xml`）加载spring相关的配置到root `WebApplicationContext`；
2. 注册实现一个`DispatcherServlet`，加载`DispatcherServlet`相关的spring配置到一个新的`WebApplicationContext`，并用这个子`WebApplicationContext`初始化`DispatcherServlet`（**初始化`DispatcherServlet`的时候不用把父wac也set进来，因为子wac默认就能访问父wac**）；
3. 添加`DispatcherServlet`的映射；

一般都不从头实现`WebApplicationInitializer`，上面这些步骤已经被封装到SpringMVC给出的abstract实现`AbstractAnnotationConfigDispatcherServletInitializer`里了，只把上面步骤里需要配置的部分暴露了出来：
1. **root `WebApplicationContext`加载哪些spring配置？由`Class<?>[] getRootConfigClasses()`方法指定**；
2. **`DispatcherServlet`的`WebApplicationContext`加载哪些spring配置？由`Class<?>[] getServletConfigClasses()`方法指定**；
3. **`DispatcherServlet`被映射到了什么mapping上？由`String[] getServletMappings()`方法指定**；

我们只要override上面三个方法并给出具体实现就行了。比如：
```java
public class MyWebAppInitializer extends AbstractAnnotationConfigDispatcherServletInitializer {

    @Override
    protected Class<?>[] getRootConfigClasses() {
        return new Class<?>[] { RootConfig.class };
    }

    @Override
    protected Class<?>[] getServletConfigClasses() {
        return new Class<?>[] { App1Config.class };
    }

    @Override
    protected String[] getServletMappings() {
        return new String[] { "/app1/*" };
    }
}
```
**RootConfg里放的是root wac的spring bean配置；App1Config里放的是DispatcherServlet的子wac的spring bean配置；最后把DispatcherServlet映射到了`/app1/*`上，所有context path + `/app1/*`开头的url都交给`DispatcherServlet`处理**。

大致等价以下`web.xml`：
```xml
<web-app>

    <listener>
        <listener-class>org.springframework.web.context.ContextLoaderListener</listener-class>
    </listener>

    <context-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>/WEB-INF/root-context.xml</param-value>
    </context-param>

    <servlet>
        <servlet-name>app1</servlet-name>
        <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
        <init-param>
            <param-name>contextConfigLocation</param-name>
            <param-value>/WEB-INF/app1-context.xml</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>app1</servlet-name>
        <url-pattern>/app1/*</url-pattern>
    </servlet-mapping>

</web-app>
```
共享的`<context-param>`通过`servlet.getServletContext().getInitParameter()`获取，serlvet独有的`<init-param>`通过`servlet.getServletConfig().getInitParameter()`获取。SpringMVC会把`ServletContext`/`ServletConfig`里的init parameter取出来，直接使用，或者放到spring的environment properties里。

> If an application context hierarchy is not required, applications can return all configuration through getRootConfigClasses() and null from getServletConfigClasses().
>
> If an application context hierarchy is not required, applications may configure a “root” context only and leave the contextConfigLocation Servlet parameter empty.

只配置root wac的代码相当于下面的`web.xml`：
```xml
<web-app>

    <listener>
        <listener-class>org.springframework.web.context.ContextLoaderListener</listener-class>
    </listener>

    <context-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>/WEB-INF/app-context.xml</param-value>
    </context-param>

    <servlet>
        <servlet-name>app</servlet-name>
        <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>app</servlet-name>
        <url-pattern>/app/*</url-pattern>
    </servlet-mapping>

</web-app>
```

同理，也可以只配置`DispatcherServlet`的config，不配置root wac config。反正`DispatcherServlet`用的是子wac，bean无论放到父wac还是子wac，都能获取到：
```java
public class MyWebAppInitializer extends AbstractAnnotationConfigDispatcherServletInitializer {

    @Override
    protected Class<?>[] getRootConfigClasses() {
        return null;
    }

    @Override
    protected Class<?>[] getServletConfigClasses() {
        return new Class<?>[] { MyWebConfig.class };
    }

    @Override
    protected String[] getServletMappings() {
        return new String[] { "/" };
    }
}
```
总之一般不需要用那么多层级。

除了上面三个最重要的方法，还有一些其他可以自定义的方法，比如注册servlet `Filter`：
```java
public class MyWebAppInitializer extends AbstractDispatcherServletInitializer {

    // ...

    @Override
    protected Filter[] getServletFilters() {
        return new Filter[] {
            new HiddenHttpMethodFilter(), new CharacterEncodingFilter() };
    }
}
```

## springboot
**springboot不走寻常路，SpringMVC是接入servlet，通过servlet container调起SpringMVC并初始化`DispatcherServlet`；springboot是让servlet接入它……它启动一个自己的`WebServerApplicationContext`（一种`ApplicationContext`），然后调起一个内嵌servlet container。所以所有servlet规范的`Filter`和`Servlet`都可以以bean的形式注册到springboot的`WebServerApplicationContext`里，等启动内嵌servlet container的时候，springboot再把他们添加到container里**：
> Spring Boot follows a different initialization sequence. **Rather than hooking into the lifecycle of the Servlet container, Spring Boot uses Spring configuration to bootstrap itself and the embedded Servlet container. Filter and Servlet declarations are detected in Spring configuration and registered with the Servlet container**.

所以在springboot里，可以看不到对servlet容器的显式配置。但是在springmvc里，无论写配置代码还是使用配置文件，都免不了以servlet容器的方式配置对springmvc的调用。

> **调用关系反转了，springboot翻身做主人了……6！**

springboot的embed container：
- https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/#web.servlet.embedded-container

## `ContextLoaderListener`
为什么SpringMVC要注册`ContextLoaderListener`这个实现了servlet `ServletContextListener`规范的listener？为了从`web.xml`加载配置。

因为servlet的`ServletContextListener`提供了创建和销毁web applicaiton时候的回调。`ContextLoaderListener`在`contextInitialized`的时候初始化了spring的`WebApplicationContext`。

其中有一步就是从`ServletContext`里取出`contextConfigLocation`参数的值，把它设置为wac的config location：
```java
		String configLocationParam = sc.getInitParameter(CONFIG_LOCATION_PARAM);
		if (configLocationParam != null) {
			wac.setConfigLocation(configLocationParam);
		}
```
所以root wac会从`contextConfigLocation`的地方加载spring bean配置。

servlet 3.+可以不使用`web.xml`了，`ContextLoaderListener`是不是没用了？也并不是。它除了加载配置，还负责把root wac和`ServletContext`绑定。现在创建root `ApplicationContext`直接通过覆盖`Class<?>[] getRootConfigClasses()`方法就行了，创建后的root wac可以直接传给`ContextLoaderListener`，相当于`ContextLoaderListener`跳过了从`web.xml`指定的地方load配置这一步，直接就获取了root wac。后面初始化wac（比如把它和`ServletContext`绑定）还是通过`ContextLoaderListener`在`contextInitialized`时触发的行为来实现的。

当然如果像上面最简单的实现那样，手动关联了wac和`ServletContext`，那确实不需要`ContextLoaderListener`了。

## 组成`DispatcherServlet`的零件
`DispatcherServlet`需要[一大坨形形色色的bean](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-servlet-special-bean-types)来完成自己的功能。这些bean被加载到wac之后，用来构建`DispatcherServlet`。**如果在wac里找不到这些bean，spring配置了一个默认组件列表：`spring-webmvc-5.3.10.jar!\org\springframework\web\servlet\DispatcherServlet.properties`和`DispatcherServlet`类在同一个package下**。

**既然一定要配置这些bean，说明这些组件不能缺，缺了`DispatcherServlet`就不能用了。**

> 在[MockMvc]({% post_url 2022-11-26-spring-mvc-test %})初始化`DispatcherServlet`的时候也记录了这些过程。

# `DispatcherServlet`请求处理流程
[从宏观的角度看流程](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-servlet-sequence)，**一路下来request上绑定了不少东西，也相当于全局传参了。在最后的时候会删掉，恢复一个干净的request**。

> 和ServletContext一样，这里的关联用的是`ServletRequest#setAttribute`。

具体寻找handler、调用controller（包括interceptor）处理请求的细节，参考之前[SpringMVC：HTTP请求处理全流程]({% post_url 2022-03-28-springmvc %})介绍的流程就好。

> 有趣。每个框架都要提供一个interceptor。servlet的是Filter，SpringMVC的是HandlerInterceptor。

# 异常处理
这里也有exception：https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-ann-exceptionhandler

controller advice:https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-ann-controller-advice

# `UriComponents`
[uricomponents](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-uri-building)他来了！！！MockMvc的时候说学一下来着。

# 异步request
https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-ann-async

# CORS
## 为什么有CORS
CORS规范规定，**在跨域发送能修改数据的请求（ajax、除了GET以外的所有http方法）之前，浏览器必须先发一个预请求（preflight request），使用OPTIONS问问server可不可以，只有server同意了，才可以发出这种请求**。

所以CORS是浏览器的默认行为。有了CORS，能一定程度上保护恶意网站借浏览器之手乱发送数据修改请求到别的网站的server。

> 当然，虽然server能自行决定要不要允许跨域修改数据的请求，但不排除有的server直接允许所有的CORS请求……相当于CORS规定白忙活了……此时有可能发生CSRF。如果server不允许任何CORS，那就肯定没办法CSRF了。但是CORS请求也不建议完全拒绝，毕竟互联网多姿多彩的原因之一就是跨域请求。

- https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- https://en.wikipedia.org/wiki/Cross-origin_resource_sharing
- https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods/OPTIONS
- https://www.ruanyifeng.com/blog/2016/04/cors.html

host1发送到host2的GET请求之前，会先发个预检请求问问可不可以：
```bash
curl 'https://host2.com/v1.0.0/brand-analyze/advice/search-all?keyword=Snapcha' \
  -X 'OPTIONS' \
  -H 'authority: host2.com' \
  -H 'accept: */*' \
  -H 'accept-language: zh-CN,zh;q=0.9,en;q=0.8' \
  -H 'access-control-request-headers: token,userid' \
  -H 'access-control-request-method: GET' \
  -H 'origin: https://host1.com' \
  -H 'referer: https://host1.com/' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36' \
  --compressed
```
问问带token和userid这俩header的get请求行不行。

host2的服务器说可以：
```properties
access-control-allow-credentials: true
access-control-allow-headers: token, userid
access-control-allow-methods: GET
access-control-allow-origin: https://host1.com
access-control-max-age: 2592000
cache-control: no-cache, no-store, max-age=0, must-revalidate
content-length: 0
date: Thu, 17 Nov 2022 06:10:34 GMT
expires: 0
pragma: no-cache
server: YDWS
vary: Origin
vary: Access-Control-Request-Method
vary: Access-Control-Request-Headers
x-content-type-options: nosniff
x-frame-options: DENY
x-xss-protection: 1; mode=block
```
`Access-Control-Max-Age: 86400`代表这一段时间内不用预检了，所以第一次CORS请求强制发送完预检请求之后，很长时间内接下来的请求都不会强制预检了。

预检请求通过后，此时host1再向host2发正式请求：
```bash
curl 'https://host2.com/v1.0.0/brand-analyze/advice/search-all?keyword=Snapcha' \
  -H 'authority: host2.com' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: zh-CN,zh;q=0.9,en;q=0.8' \
  -H 'origin: https://host1.com' \
  -H 'referer: https://host1.com/' \
  -H 'sec-ch-ua: "Google Chrome";v="107", "Chromium";v="107", "Not=A?Brand";v="24"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Linux"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'token: eyJhbGciOiJIUzUxMiJ9.eyJrb2xJZCI6MCwiY3JlYXRlZCI6MTY2ODY1Mzc3MTI3MywibmFtZSI6IueuoeeQhua1i-ivlSIsImtvbE5hbWUiOiIiLCJpZCI6MTAwNjM0LCJ0eXBlIjo0LCJleHAiOjE2Njg2ODk3NzEyNzMsInBsYXRmb3JtIjoiIn0.p4YDttx8gbleVAdLnIBNA3YlLL-17R8IBqfzTf8qg3S5NsfGwpYbFrXXpbSD_vYdkklPjpKFH5n_5JrzLvq0Jg' \
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36' \
  -H 'userid: 100634' \
  --compressed
```
POST请求同理。

## SpringMVC自动处理CORS
**cors最大的特点是它不涉及业务逻辑。唯一需要开发者指定的就是：是否对某些接口允许CORS。所以只需要开发者配置一下CORS的策略就行了，其他事情完全可以由SpringMVC做完。**

> **Preflight requests are handled directly**, while simple and actual CORS requests are intercepted, validated, and **have required CORS response headers set**.

可以给controller单独配置cors，也可以配置个全局的。一般使用[cors filter](https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-cors-filter)配置一个全局的实现就挺好。

> 它是一个servlet Filter实现。

# View
## groovy markup
groovy markup不错：https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-view-groovymarkup-example

## pdf & excel
默认就有pdf和excel的ViewResolver，不错：https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#mvc-view-document

# client
`RestTemplate`和`WebClient`
- https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#webmvc-client

# websocket
- https://docs.spring.io/spring-framework/docs/current/reference/html/web.html#websocket

# 感想
在经历了Spring `MockMvc`从一个简单的角度过了SpringMVC的流程后，对SpringMVC更理解了。再一看SpringMVC的文档，果然是。不容易啊，一开始为了SpringMVC先研究了tomcat，都2020年的事儿了。

