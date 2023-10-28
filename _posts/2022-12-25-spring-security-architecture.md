---
layout: post
title: "Spring Security - 架构"
date: 2022-12-25 00:51:13 +0800
categories: spring security
tags: spring security
---

spring有webmvc和webflux，这里只介绍基于servlet的spring webmvc相关的spring security。

> 因为webflux我还不会:D

1. Table of Contents, ordered
{:toc}

# 和servlet的关系
spring security[通过servlet容器标准的`Filter`接口把功能集成到servlet容器里](https://docs.spring.io/spring-security/reference/servlet/index.html)。在设计上，**它只强制原有应用使用servlet容器，但不强制原有应用一定要使用spring框架。**

> Spring Security integrates with the Servlet Container by using a standard Servlet Filter. This means it works with any application that runs in a Servlet Container. **More concretely, you do not need to use Spring in your Servlet-based application to take advantage of Spring Security**.

**但是spring security本身是基于spring框架的，所以使用spring security会额外给服务引入spring webmvc框架，但只是security的实现基于它，原有的业务代码可以无视这一点。**

# 架构
**[这篇文档](https://docs.spring.io/spring-security/reference/servlet/architecture.html)非常清晰地梳理了spring security的架构！**

## servlet filter chain
spring security依赖servlet Filter拦截、认证请求。

![filterchain](/pics/spring/security/filterchain.png)

filter的实现可以从两方面发挥作用：
1. 通过是否调用filter chain，决定请求是否继续走下去（走到最后一个，处理逻辑是servlet）：Prevent downstream Filter instances or the Servlet from being invoked. **In this case, the Filter typically writes the `HttpServletResponse`**；
2. 通过在filter chain的前、后执行相关代码，相当于做一些请求的前置、后置操作：Modify the HttpServletRequest or HttpServletResponse used by the downstream Filter instances and the Servlet.；

```java
public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
	// do something before the rest of the application
    chain.doFilter(request, response); // invoke the rest of the application
    // do something after the rest of the application
}
```

所以直接把filter chain传给Filter，好处是可以在filter处理过后，也加一些操作。

> 不过如果是spring，就提供两个方法了，而不是在一个`doFilter`方法里搞定几方面的东西，更合理。

Filter配置在Context container里：
```xml
<filter>
   <filter-name>LogFilter</filter-name>
   <filter-class>LogFilter</filter-class>
   <init-param>
      <param-name>test-param</param-name>
      <param-value>Initialization Paramter</param-value>
   </init-param>
</filter>

<filter>
   <filter-name>AuthenFilter</filter-name>
   <filter-class>AuthenFilter</filter-class>
   <init-param>
      <param-name>test-param</param-name>
      <param-value>Initialization Paramter</param-value>
   </init-param>
</filter>

<filter-mapping>
   <filter-name>LogFilter</filter-name>
   <url-pattern>/*</url-pattern>
</filter-mapping>

<filter-mapping>
   <filter-name>AuthenFilter</filter-name>
   <url-pattern>/*</url-pattern>
</filter-mapping>
```
Filter是在请求到来之后，和请求做匹配的。检查filter-mapping，如果一个filter-name适用于该请求，加载filter-name对应的filter。**所有符合条件的filter会组成一个filter chain，chain的最后是servlet**。

所以spring security的第一步就是注册一个security相关的servlet Filter到servlet容器：
1. 当请求到来时，需要判断请求是否已经认证。如果没有认证，把请求想要访问的地址缓存下来，并重定向到login；
2. 当登陆请求再次发过来且验证成功后，取出之前缓存的请求地址，继续访问该请求；
3. 如果验证失败，返回错误。

## 如何注册Filter - `DelegatingFilterProxy`
按理来说，注册Filter是和spring无关的行为，因为注册Filter可以通过servlet配置来完成，此时还没有开始初始化servlet，也没有创建spring的`ApplicationContext`。

但是spring security提供了一个`DelegatingFilterProxy`，它是一个servlet Filter，比较特殊的是它的`doFilter`逻辑：从spring `ApplicationContext`里取出一个filter bean，调用它的`doFilter`处理逻辑。所以它把逻辑委托给filter bean了。

> servlet Filter注册的时候不需要调用`doFilter`，启动tomcat之后就会初始化servlet，初始化spring的wac。**当有请求过来的时候，再调用Filter的`doFilter`。此时去wac里取bean是完全来得及的**。所以`DelegatingFilterProxy`能这么做，都是因为servlet容器的注册启动、接受请求是两条有先后顺序的时间线。

所以`DelegatingFilterProxy`就像是一个桥，联通了servlet和spring wac。不过问题在于，单看这个设定好像没什么太大作用：每当需要一个Filter的时候，不仅需要创建一个spring的filter bean，依然还需要创建一个`DelegatingFilterProxy`，作为servlet容器的Filter注册到servlet容器上。这岂不是更麻烦了？

之所以这么想是因为没有意识到“桥”的作用：**注册一个`DelegatingFilterProxy`确实只能将逻辑delegate到一个filter bean上，但是如果这个spring的filter bean支持将逻辑再delegate到一堆别的bean上呢**？这不就相当于只给servlet容器注册了一个Filter，之后只要写一堆spring的bean就行了嘛？此时的编程又回到了spring相关的编程了。这就是“桥”的意义。

> 类似多路复用了。管道就一条，大家共用一下。

spring security已经提供了这样的一个filter bean实现，`FilterChainProxy`。`DelegatingFilterProxy`将filter逻辑委托给它，它再寻找`SecurityFilterChain`，和原有filter chain一起过滤request、response。

![filterchainproxy](/pics/spring/security/filterchainproxy.png)

因此这里一共涉及两个代理proxy：
1. 注册到servlet上的delegating Filter，它是一个代理，实际实现filter功能的是spring wac里的filter bean（`FilterChainProxy`）。所以它是`FilterChainProxy`的proxy，名字叫delegating filter proxy；
2. spring wac里的这个filter bean，它既是一个被代理bean，也是一个代理bean，类似demultiplexer，它把功能分散到了一堆别的bean身上，就是`SecurityFilterChain`。所以它是security filter chain的proxy，名字叫filter chain proxy；

最后`SecurityFilterChain`则明显是在模拟servlet的filter chain的概念：一堆filter，有一个不同意，则请求不会继续流转下去。但其实这些bean维护在spring的wac中，并不注册在servlet上。所以它的名字叫security filter chain，是security的filter chain，不是servlet的filter chain。

> 用`DispatcherServlet`这个servlet取代所有servlet，把请求分发给所有的`@Controller`；用`DelegatingFilterProxy`这个filter取代（secutiry相关的）所有filter，把filter逻辑放到自己的wac里的filter bean上。我算是看出来了，spring是想掏空servlet容器:D

## 盗版filter chain - `SecurityFilterChain`
显然spring的filter chain是在盗版servlet的filter chain。通过`DelegatingFilterProxy`把请求从正统filter chain上引流到自己的盗版filter chain上。

![multi-securityfilterchain](/pics/spring/security/multi-securityfilterchain.png)

一个`SecurityFilterChain`本身就是一堆filter bean的集合，`FilterChainProxy`将逻辑委托给了一堆`SecurityFilterChain`（`List<FilterChainProxy>`），而不是一个`FilterChainProxy`。

> 所以可以理解为它里面实际存储了filter的二维数组。

**只有第一个符合请求的`SecurityFilterChain`会生效，其他的`SecurityFilterChain`将不再执行。**

> Only the first SecurityFilterChain that matches is invoked

多条filter chain的目的是什么？为了支持不同的配置链。比如url以user开头的请求都按照配置a的权限进行校验，而以admin开头的请求都按照另一些权限做更严格的校验。

## 如何验证
`ExceptionTranslationFilter`是security filter chain上的一个filter，它是spring security的核心filter。

![exceptiontranslationfilter](/pics/spring/security/exceptiontranslationfilter.png)

它的伪代码如下：
```java
try {
	filterChain.doFilter(request, response);
} catch (AccessDeniedException | AuthenticationException ex) {
	if (!authenticated || ex instanceof AuthenticationException) {
		startAuthentication();
	} else {
		accessDenied();
	}
}
```
1. 调用FilterChain.doFilter(request, response)处理请求；
2. 如果出现错误，catch住；
3. 如果是认证错误，**缓存请求，重定向到登录页（或者发送`WWW-Authenticate` header）**；
4. 如果是没有权限，调用`AccessDeniedHandler`处理权限问题；

## 如何缓存请求、识别请求
请求被重定向到登录页，再次请求认证通过后，是如何自动跳转到之前的请求页的？

奥秘全在session和请求缓存。

**一旦浏览器发送了第一个请求，servlet容器会让浏览器给后面的请求（除非有显式的logout）设置同一个session id**。当然spring security也会在登录成功后生成新的session id，并让浏览器使用新的session id。总之这一行为是由servlet服务器控制的。

**session id对应着服务器里session manager管理的一个session。session可以理解为一个map，保存着所有的这个session相关的自定义key value。session id一般放在cookie里，key为`JSESSIONID`。**

> 详见[（七）How Tomcat Works - Tomcat Session]({% post_url 2020-10-08-tomcat-session %})

如果一个请求需要认证，spring security会把请求序列化到请求对应的session里（key为`SPRING_SECURITY_SAVED_REQUEST`），再重定向请求到登录页。接下来的认证请求还会带着那个session id，spring security就可以根据id找到session，再从session里取出上次序列化的请求，执行这个请求。对于用户来说，就是在继续执行刚刚的请求了。

> 其实就是一种上下文切换，所以要保存上下文……而spring选择把上下文保存在了session里。

spring security对请求暂存的抽象是`RequestCache`，上面介绍的把请求缓存在session里，是它的默认实现`HttpSessionRequestCache`：
```java
        if (this.createSessionAllowed || request.getSession(false) != null) {
			// Store the HTTP request itself. Used by
			// AbstractAuthenticationProcessingFilter
			// for redirection after successful authentication (SEC-29)
			request.getSession().setAttribute(this.sessionAttrName, savedRequest);
		} else {
			this.logger.trace("Did not save request since there's no session and createSessionAllowed is false");
		}
```

> session是tomcat创建的。`request.getSession()`可以直接获取session，如果没有session，会新建一个。`request.getSession(false)`则不新建，如果没有就返回null。

spring security还提供了`CookieRequestCache`实现，把request暂存到cookie里，cookie名为`REDIRECT_URI`，cookie直接放到response里。这样的话服务器端就不需要暂存请求了。
```java
		String redirectUrl = UrlUtils.buildFullRequestUrl(request);
		Cookie savedCookie = new Cookie(COOKIE_NAME, encodeCookie(redirectUrl));
		savedCookie.setMaxAge(COOKIE_MAX_AGE);
		savedCookie.setSecure(request.isSecure());
		savedCookie.setPath(getCookiePath(request));
		savedCookie.setHttpOnly(true);
		response.addCookie(savedCookie);
```

> 缺点就是请求响应本身会变大。

## 如何返回错误

# spring security借助spring mvc注册Filter到servlet容器
虽然引入spring security的服务本身可以不使用SpringMVC，但是spring security本身是要依赖SpringMVC的。

> 流程应该是：request先被spring security的filter引入spring的wac，spring security的filter bean都在spring的wac里，经过验证之后，出了spring wac，继续走servlet container流程上的下一个filter，最后到了servlet，该servlet是和spring无关的。相当于中间因为要用security filter，所以绕路到了spring wac，但最终的servlet并不是spring mvc的dispatcher servlet。

**spring security的关键其实就是如何把`DelegatingFilterProxy`作为一个`Filter`注册到servlet容器上**。spring security基于spring mvc，[Spring Web MVC]({% post_url 2022-12-03-spring-web-mvc %})说过，SpringMVC通过`WebApplicationInitializer`初始化servlet容器。所以spring security提供了基于它的抽象实现类`AbstractSecurityWebApplicationInitializer`，**在wac初始化的时候，手动把这个`Filter`添加到servlet上即可**：
```java
Dynamic registration = servletContext.addFilter(filterName, filter);
```

> **它只`ServeletContext#addFilter`，不`ServeletContext#addServlet`。所以spring security不涉及servlet。与之相对的，springmvc的`AbstractDispatcherServletInitializer`则是`ServeletContext#addServlet`**。两个对照着看，意图都很明显。

Filter实例是`DelegatingFilterProxy`，注册到servlet上的filter name叫`"springSecurityFilterChain"`。不仅如此，它委托给的那个`FilterChainProxy`在wac里的bean的名字也叫`"springSecurityFilterChain"`：`new DelegatingFilterProxy("springSecurityFilterChain")`。

> 属于是梅开二度了……

之所以都叫这个名，应该是因为这个filter把实现delegate给了`FilterChainProxy`，进而delegate给了`SecurityFilterChain`，所以两个代理其实都没干活儿，实际干活的是security filter chain，所以不如叫`"springSecurityFilterChain"`了。

> 所以这里注册`Filter`是手动在实例化的时候通过代码注册上去的，不是通过`web.xml`配置文件注册上去的！毕竟`WebApplicationInitializer`的本意就是：初始化的时候想干嘛就干嘛！

之前说过，使用spring security的工程不一定显式使用了spring框架，**所以原工程不一定有spring mvc的配置。这种情况下spring security的配置（依然是spring bean配置）怎么被启用**？spring security的`AbstractSecurityWebApplicationInitializer` **支持手动传入一个配置类，并实例化这个配置类里的bean**：
```java
		if (this.configurationClasses != null) {
			AnnotationConfigWebApplicationContext rootAppContext = new AnnotationConfigWebApplicationContext();
			rootAppContext.register(this.configurationClasses);
			servletContext.addListener(new ContextLoaderListener(rootAppContext));
		}
```
此时spring security自己启动一个`AnnotationConfigWebApplicationContext`作为root wac。

这个配置类示例：
```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

	@Bean
	public UserDetailsService userDetailsService() {
		InMemoryUserDetailsManager manager = new InMemoryUserDetailsManager();
		manager.createUser(User.withDefaultPasswordEncoder().username("user").password("password").roles("USER").build());
		return manager;
	}
}
```
它通过`@EnableWebSecurity`启用了spring security的相关bean，并通过`@Configuration`成为spring bean配置类。所以可以直接把这个配置类显式传给spring security：
```java
public class SecurityWebApplicationInitializer
	extends AbstractSecurityWebApplicationInitializer {

	public SecurityWebApplicationInitializer() {
		super(WebSecurityConfiguration.class);
	}
}
```

如果服务本身就使用了SpringMVC框架，那么一定有wac，所以不用手动传入spring security的config类了：
```java
public class SecurityWebApplicationInitializer
	extends AbstractSecurityWebApplicationInitializer {

}
```
只需要按照[Spring Web MVC]({% post_url 2022-12-03-spring-web-mvc %})的方式加载我们的spring security相关的config类就行了：
```java
public class MvcWebApplicationInitializer extends
		AbstractAnnotationConfigDispatcherServletInitializer {

	@Override
	protected Class<?>[] getRootConfigClasses() {
		return new Class[] { WebSecurityConfig.class };
	}

	// ... other overrides ...
}
```

> 有句话不知当讲不当讲……怎么感觉用已有的SpringMVC框架加载spring security配置，反而更麻烦了……

**所以总结起来整个架构的配置就一句话：spring security借助spring mvc注册Filter到servlet容器。**

一切配置完毕，按照SpringMVC的约定，wac一定和servlet绑定起来了，所以可以从servlet里拿到wac：
```java
WebApplicationContextUtils.getWebApplicationContext(getServletContext(), attrName)
```
拿wac干什么？`DelegatingFilterProxy`要从它里面取`SecurityFilterChain`啊！

# 配置
[spring security的配置](https://docs.spring.io/spring-security/reference/servlet/configuration/java.html)其实就是在配置最核心的`SecurityFilterChain`，所以跟架构放一起介绍。

## `HttpSecurity` - 配置`SecurityFilterChain`
配置spring security，除了配置基本组件（比如认证的用户名和密码）外，最主要的就是通过配置至少一个`SecurityFilterChain`来控制spring security的行为！

### 默认的那条security filter chain
springboot默认配置的`SecurityFilterChain`是：
```java
	/**
	 * The default configuration for web security. It relies on Spring Security's
	 * content-negotiation strategy to determine what sort of authentication to use. If
	 * the user specifies their own {@code WebSecurityConfigurerAdapter} or
	 * {@link SecurityFilterChain} bean, this will back-off completely and the users
	 * should specify all the bits that they want to configure as part of the custom
	 * security configuration.
	 */
	@Configuration(proxyBeanMethods = false)
	@ConditionalOnDefaultWebSecurity
	static class SecurityFilterChainConfiguration {

		@Bean
		@Order(SecurityProperties.BASIC_AUTH_ORDER)
		SecurityFilterChain defaultSecurityFilterChain(HttpSecurity http) throws Exception {
			http.authorizeRequests().anyRequest().authenticated();
			http.formLogin();
			http.httpBasic();
			return http.build();
		}

	}
```
这条security filter chain做了三件事：
1. 所有请求都要认证；
2. 支持表单登录；
3. 支持http basic认证；

所有的`SecurityFilterChain`会被自动注入到`WebSecurityConfiguration`里（就是通过`@EnableWebSecurity` import进来的那个spring security的配置类）。

spring security支持多条filter chain。**多条`SecurityFilterChain`之间可以设定优先级，优先级高的filter chain在前面**。

> 如果我们自己配置了一条security filter chain，这条默认的就不再配置了。

### 怎么配置security filter chain
**spring security提供了便捷的方法帮助快速配置security filter chain——`HttpSecurity`！**

`@EnableWebSecurity`import了`HttpSecurityConfiguration`，它也是一个配置类，会自动配置“一堆”`HttpSecurity`对象（注意是一堆，是prototype，不是singleton）：
```java
	@Bean(HTTPSECURITY_BEAN_NAME)
	@Scope("prototype")
	HttpSecurity httpSecurity() throws Exception {
		WebSecurityConfigurerAdapter.LazyPasswordEncoder passwordEncoder = new WebSecurityConfigurerAdapter.LazyPasswordEncoder(
				this.context);
		AuthenticationManagerBuilder authenticationBuilder = new WebSecurityConfigurerAdapter.DefaultPasswordEncoderAuthenticationManagerBuilder(
				this.objectPostProcessor, passwordEncoder);
		authenticationBuilder.parentAuthenticationManager(authenticationManager());
		HttpSecurity http = new HttpSecurity(this.objectPostProcessor, authenticationBuilder, createSharedObjects());
		// @formatter:off
		http
			.csrf(withDefaults())
			.addFilter(new WebAsyncManagerIntegrationFilter())
			.exceptionHandling(withDefaults())
			.headers(withDefaults())
			.sessionManagement(withDefaults())
			.securityContext(withDefaults())
			.requestCache(withDefaults())
			.anonymous(withDefaults())
			.servletApi(withDefaults())
			.apply(new DefaultLoginPageConfigurer<>());
		http.logout(withDefaults());
		// @formatter:on
		applyDefaultConfigurers(http);
		return http;
	}
```
`HttpSecurity`里已经预设好一些属性了，所以每次新建一个filter chain的时候，不用担心最基础的东西都要重新设置一遍，比如session管理、request cache等等。我们只需要专注于定义自己需要的过滤行为就行了。正因如此，一下子就能把一个很复杂的过滤规则拆开成多个规则了。

> 这里设置的`PasswordEncoder`比较有意思，是个`LazyPasswordEncoder`。而它其实就是个wrapper，等到实际执行的时候，从`ApplicationContext`里寻找类型为`PasswordEncoder`的bean，并把实际功能实现delegate给它。所以 **虽然spring security在我们配置`PasswordEncoder`之前就设置好了`PasswordEncoder`，但实际用的还是我们配置的`PasswordEncoder`**……这和`DelegatingFilterProxy`的思想一毛一样啊！

`HttpSecurity`其实是一个builder，build后生成的实体是`DefaultSecurityFilterChain`，是`SecurityFilterChain`的实现。
```java
public final class HttpSecurity extends AbstractConfiguredSecurityBuilder<DefaultSecurityFilterChain, HttpSecurity>
		implements SecurityBuilder<DefaultSecurityFilterChain>, HttpSecurityBuilder<HttpSecurity> {
```
`HttpBuilder`会在`performBuild`里，构造出一个`DefaultSecurityFilterChain`：
```java
	@Override
	protected DefaultSecurityFilterChain performBuild() {
		ExpressionUrlAuthorizationConfigurer<?> expressionConfigurer = getConfigurer(
				ExpressionUrlAuthorizationConfigurer.class);
		AuthorizeHttpRequestsConfigurer<?> httpConfigurer = getConfigurer(AuthorizeHttpRequestsConfigurer.class);
		boolean oneConfigurerPresent = expressionConfigurer == null ^ httpConfigurer == null;
		Assert.state((expressionConfigurer == null && httpConfigurer == null) || oneConfigurerPresent,
				"authorizeHttpRequests cannot be used in conjunction with authorizeRequests. Please select just one.");
		this.filters.sort(OrderComparator.INSTANCE);
		List<Filter> sortedFilters = new ArrayList<>(this.filters.size());
		for (Filter filter : this.filters) {
			sortedFilters.add(((OrderedFilter) filter).filter);
		}
		return new DefaultSecurityFilterChain(this.requestMatcher, sortedFilters);
	}
```
因此，我们可以通过`HttpSecurity`工具类比较方便地构造出`SecurityFilterChain`对象。

比如配置多条优先级不同的filter chain：
```java
/**
 * {@link org.springframework.security.access.prepost.PreAuthorize}需要通过{@link EnableMethodSecurity}手动开启。。。
 *
 * @author puppylpg on 2022/12/16
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class MultipleSecurityFilterChainConfig {

    /**
     * 配置用户。
     * 默认会创建一个DelegatingPasswordEncoder，实际就是使用bcrypt加密。
     * 之所以deprecated是因为密码应该从外部读取，而不是使用password encoder在运行的时候生成。
     */
    @Bean
    public UserDetailsService userDetailsService() {
        InMemoryUserDetailsManager manager = new InMemoryUserDetailsManager();
        manager.createUser(User.withDefaultPasswordEncoder().username("guest").password("guest").roles("no auth").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("hello").password("world").roles("USER").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("raichu").password("raichu").roles("ADMIN").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("puppylpg").password("puppylpg").roles("USER", "ADMIN").build());
        return manager;
    }

    /**
     * admin才能查看h2-console。
     * user权限会返回403 forbidden
     */
    @Bean
    @Order(1)
    public SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
        http
                .antMatcher("/h2-console/**")
                .authorizeHttpRequests(authorize -> authorize
                        .anyRequest().hasRole("ADMIN")
                )
                .formLogin();
        return http.build();
    }

    /**
     * user相关的url只能admin才能看
     */
    @Bean
    @Order(2)
    protected SecurityFilterChain formAuth(HttpSecurity http) throws Exception {
        // opendoc csrf支持开启后，配不配置cookie里都有`XSRF-TOKEN`
        http.csrf().csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .and()
                // 这些请求不仅要认证，还要拥有相应角色
                // but这样配置的话，"/user-api/users/"仍然不需要角色认证
                .antMatcher("/user-api/users")
                .authorizeHttpRequests(authorize -> authorize.anyRequest().hasRole("ADMIN"))
                // 使用表单提交用户名和密码的方式认证：人的认证
                // 返回302，Location: http://localhost:8080/login
                .formLogin();

        return http.build();
    }

    /**
     * /basic url需要使用basic认证
     */
    @Bean
    @Order(3)
    protected SecurityFilterChain basicAuth(HttpSecurity http) throws Exception {
        http.csrf().csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .and()
                .antMatcher("/basic")
                .httpBasic()
                .and()
                // basic auth不要用session
                .sessionManagement()
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS);

        return http.build();
    }

    /**
     * 其他请求。没设置优先级，为last
     */
    @Bean
    public SecurityFilterChain formLoginFilterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(authorize -> authorize
                        .anyRequest().authenticated()
                )
                .formLogin(withDefaults())
                .rememberMe()
                // remember me过期时间
                .tokenValiditySeconds((int) TimeUnit.DAYS.toSeconds(2))
                // remember me加密用到的key
                .key("hellokugou");
        return http.build();
    }
}
```

我们一共配置了4条security filter chain：
1. 对"`/h2-console/**`"使用form认证，进行admin鉴权；
2. 对"`/user-api/users`"使用form认证，进行admin鉴权；
3. 对"`/basic`"使用basic认证（同时不创建session），**没有声明鉴权方式。但是在相关controller方法上设置了`@PreAuthorize("hasAnyAuthority('ROLE_USER')")`，所以还是需要user权限**；
4. 对其他请求组使用form认证，开启remember me，鉴权方式为必须认证过（`SecurityContextHolder`里有东西就行）；

> **context path即使被修改了，这里的url matcher也不用考虑。因为tomcat在匹配url的时候已经去掉context path，此时传给Filter的是后面的url**。

**我们配置security filter chain时，配置的是更高层次的功能（比如使用form还是basic认证），而非直接配置filter**。spring security提供了[非常多的filter](https://docs.spring.io/spring-security/reference/servlet/architecture.html#servlet-security-filters)来完成相关功能，**根据我们配置的行为，spring security会在各个security filter chain上注册不同的filter**。

#### filter chain上的具体filter
比如我们刚刚的4条filter chain的信息可以从log里看出来。每一条filter chain匹配什么url、**注册了哪些filter用于认证**，都打印了出来：
- 2022-12-30 16:31:37.013  INFO 77449 --- [  restartedMain] o.s.s.web.DefaultSecurityFilterChain     : **Will secure Ant [pattern='/h2-console/**']** with [org.springframework.security.web.session.DisableEncodeUrlFilter@48e8b558, org.springframework.security.web.context.request.async.WebAsyncManagerIntegrationFilter@1f7b645, org.springframework.security.web.context.SecurityContextPersistenceFilter@bdcf938, org.springframework.security.web.header.HeaderWriterFilter@57eab8d0, org.springframework.security.web.csrf.CsrfFilter@4c26ef1a, org.springframework.security.web.authentication.logout.LogoutFilter@28b4fb6c, org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter@37744595, org.springframework.security.web.authentication.ui.DefaultLoginPageGeneratingFilter@728af88b, org.springframework.security.web.authentication.ui.DefaultLogoutPageGeneratingFilter@49299c17, org.springframework.security.web.savedrequest.RequestCacheAwareFilter@4d541e83, org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter@7e40403a, org.springframework.security.web.authentication.AnonymousAuthenticationFilter@7840ca88, org.springframework.security.web.session.SessionManagementFilter@1e7c54d, org.springframework.security.web.access.ExceptionTranslationFilter@3f547b47, org.springframework.security.web.access.intercept.AuthorizationFilter@8142cac]
- 2022-12-30 16:31:37.039  INFO 77449 --- [  restartedMain] o.s.s.web.DefaultSecurityFilterChain     : **Will secure Ant [pattern='/user-api/users']** with [org.springframework.security.web.session.DisableEncodeUrlFilter@2a1e7cbf, org.springframework.security.web.context.request.async.WebAsyncManagerIntegrationFilter@13021eff, org.springframework.security.web.context.SecurityContextPersistenceFilter@33535f2a, org.springframework.security.web.header.HeaderWriterFilter@5db0b4f5, org.springframework.security.web.csrf.CsrfFilter@3bccb97a, org.springframework.security.web.authentication.logout.LogoutFilter@56d9f727, org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter@33e7d52b, org.springframework.security.web.authentication.ui.DefaultLoginPageGeneratingFilter@e2ef4de, org.springframework.security.web.authentication.ui.DefaultLogoutPageGeneratingFilter@5ffb5704, org.springframework.security.web.savedrequest.RequestCacheAwareFilter@6ab366ca, org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter@327c7075, org.springframework.security.web.authentication.AnonymousAuthenticationFilter@52b88f5d, org.springframework.security.web.session.SessionManagementFilter@6d8a2c88, org.springframework.security.web.access.ExceptionTranslationFilter@320d668c, org.springframework.security.web.access.intercept.AuthorizationFilter@7e864675]
- 2022-12-30 16:31:37.055  INFO 77449 --- [  restartedMain] o.s.s.web.DefaultSecurityFilterChain     : **Will secure Ant [pattern='/basic']** with [org.springframework.security.web.session.DisableEncodeUrlFilter@690bc59c, org.springframework.security.web.context.request.async.WebAsyncManagerIntegrationFilter@534e4aea, org.springframework.security.web.context.SecurityContextPersistenceFilter@58ca097, org.springframework.security.web.header.HeaderWriterFilter@6b7c3011, org.springframework.security.web.csrf.CsrfFilter@6b812575, org.springframework.security.web.authentication.logout.LogoutFilter@3f00dc7b, org.springframework.security.web.authentication.www.BasicAuthenticationFilter@5acf5c09, org.springframework.security.web.savedrequest.RequestCacheAwareFilter@2e005fb8, org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter@24f61ed1, org.springframework.security.web.authentication.AnonymousAuthenticationFilter@73c16b9e, org.springframework.security.web.session.SessionManagementFilter@67c48b97, org.springframework.security.web.access.ExceptionTranslationFilter@e57856]
- 2022-12-30 16:31:37.081  INFO 77449 --- [  restartedMain] o.s.s.web.DefaultSecurityFilterChain     : **Will secure any request** with [org.springframework.security.web.session.DisableEncodeUrlFilter@661bdaf1, org.springframework.security.web.context.request.async.WebAsyncManagerIntegrationFilter@70fcc268, org.springframework.security.web.context.SecurityContextPersistenceFilter@275a25bb, org.springframework.security.web.header.HeaderWriterFilter@1a759cc, org.springframework.security.web.csrf.CsrfFilter@37c664a5, org.springframework.security.web.authentication.logout.LogoutFilter@48351427, org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter@52989d3f, org.springframework.security.web.authentication.ui.DefaultLoginPageGeneratingFilter@77b86813, org.springframework.security.web.authentication.ui.DefaultLogoutPageGeneratingFilter@23b85c07, org.springframework.security.web.savedrequest.RequestCacheAwareFilter@3e9458f, org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter@383b1507, org.springframework.security.web.authentication.rememberme.RememberMeAuthenticationFilter@32ec2f67, org.springframework.security.web.authentication.AnonymousAuthenticationFilter@74a6ddf6, org.springframework.security.web.session.SessionManagementFilter@233d8e35, org.springframework.security.web.access.ExceptionTranslationFilter@700a83bc, org.springframework.security.web.access.intercept.AuthorizationFilter@1c8aaef0]

每一条filter chain都是`DefaultLogoutPageGeneratingFilter`实现，**虽然spring security在上面添加的filter有很多，但是大致可以分成三部分**：
1. **logout filter前的filter是大家共有的**：org.springframework.security.web.session.DisableEncodeUrlFilter@661bdaf1, org.springframework.security.web.context.request.async.WebAsyncManagerIntegrationFilter@70fcc268, org.springframework.security.web.context.SecurityContextPersistenceFilter@275a25bb, org.springframework.security.web.header.HeaderWriterFilter@1a759cc, org.springframework.security.web.csrf.CsrfFilter@37c664a5, org.springframework.security.web.authentication.logout.LogoutFilter@48351427
2. **接下来这一部分filter和认证方式对应，这也是该filter chain独有的认证方式的体现。认证方式不同，用到的filter也不同**：
    1. **表单登录用的是`UsernamePasswordAuthenticationFilter`**：org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter@33e7d52b, org.springframework.security.web.authentication.ui.DefaultLoginPageGeneratingFilter@e2ef4de, org.springframework.security.web.authentication.ui.DefaultLogoutPageGeneratingFilter@5ffb5704，**除了认证filter，还有login/logout page generate filter**；
    2. **basic认证用的是`BasicAuthenticationFilter`**：org.springframework.security.web.authentication.www.BasicAuthenticationFilter@5acf5c09，**就他一个，因为不需要logout**；
    3. 也可以添加一些其他自定义的认证filter，**比如jwt相关的filter，手动添加到这个位置**：`http.addFilterBefore(<jwtAuthenticationTokenFilter>, UsernamePasswordAuthenticationFilter.class)`。**如果此时不再配置form login，`UsernamePasswordAuthenticationFilter`将会不存在，但不重要，不管有没有它，jwt的filter都会放在合适的位置**；
3. **最后一部分的filter也相同**：org.springframework.security.web.savedrequest.RequestCacheAwareFilter@3e9458f, org.springframework.security.web.servletapi.SecurityContextHolderAwareRequestFilter@383b1507, org.springframework.security.web.authentication.rememberme.RememberMeAuthenticationFilter@32ec2f67, org.springframework.security.web.authentication.AnonymousAuthenticationFilter@74a6ddf6, org.springframework.security.web.session.SessionManagementFilter@233d8e35, org.springframework.security.web.access.ExceptionTranslationFilter@700a83bc, org.springframework.security.web.access.intercept.AuthorizationFilter@1c8aaef0

其中第三条有`BasicAuthenticationFilter`，其他几条都是`UsernamePasswordAuthenticationFilter`。最后一条chain因为配置了remember me，所以多了`RememberMeAuthenticationFilter`。

这些filter的默认位置写在了`FilterOrderRegistration`里：
```java
	FilterOrderRegistration() {
		Step order = new Step(INITIAL_ORDER, ORDER_STEP);
		put(DisableEncodeUrlFilter.class, order.next());
		put(ForceEagerSessionCreationFilter.class, order.next());
		put(ChannelProcessingFilter.class, order.next());
		order.next(); // gh-8105
		put(WebAsyncManagerIntegrationFilter.class, order.next());
		put(SecurityContextHolderFilter.class, order.next());
		put(SecurityContextPersistenceFilter.class, order.next());
		put(HeaderWriterFilter.class, order.next());
		put(CorsFilter.class, order.next());
		put(CsrfFilter.class, order.next());
		put(LogoutFilter.class, order.next());
		this.filterToOrder.put(
				"org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter",
				order.next());
		this.filterToOrder.put(
				"org.springframework.security.saml2.provider.service.web.Saml2WebSsoAuthenticationRequestFilter",
				order.next());
		put(X509AuthenticationFilter.class, order.next());
		put(AbstractPreAuthenticatedProcessingFilter.class, order.next());
		this.filterToOrder.put("org.springframework.security.cas.web.CasAuthenticationFilter", order.next());
		this.filterToOrder.put("org.springframework.security.oauth2.client.web.OAuth2LoginAuthenticationFilter",
				order.next());
		this.filterToOrder.put(
				"org.springframework.security.saml2.provider.service.web.authentication.Saml2WebSsoAuthenticationFilter",
				order.next());
		put(UsernamePasswordAuthenticationFilter.class, order.next());
		order.next(); // gh-8105
		put(DefaultLoginPageGeneratingFilter.class, order.next());
		put(DefaultLogoutPageGeneratingFilter.class, order.next());
		put(ConcurrentSessionFilter.class, order.next());
		put(DigestAuthenticationFilter.class, order.next());
		this.filterToOrder.put(
				"org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
				order.next());
		put(BasicAuthenticationFilter.class, order.next());
		put(RequestCacheAwareFilter.class, order.next());
		put(SecurityContextHolderAwareRequestFilter.class, order.next());
		put(JaasApiIntegrationFilter.class, order.next());
		put(RememberMeAuthenticationFilter.class, order.next());
		put(AnonymousAuthenticationFilter.class, order.next());
		this.filterToOrder.put("org.springframework.security.oauth2.client.web.OAuth2AuthorizationCodeGrantFilter",
				order.next());
		put(SessionManagementFilter.class, order.next());
		put(ExceptionTranslationFilter.class, order.next());
		put(FilterSecurityInterceptor.class, order.next());
		put(AuthorizationFilter.class, order.next());
		put(SwitchUserFilter.class, order.next());
	}
```
如果我们使用上述`http.addFilterBefore(<jwtAuthenticationTokenFilter>, UsernamePasswordAuthenticationFilter.class)`新注册了一个filter，该filter也会添加到现有的order里，以便继续使用`http.addFilterBefore(<another>, <jwtAuthenticationTokenFilter>.class)`在其前后添加filter。

> 怎么让client发送的request带上jwt token？client也是自己写的，发送的时候直接手动设置header，带上token就行了……
>
> **非jwt为了后续不再需要认证，用的是session，因为session可以放到cookie里，下次自动带过来**。
> 
> 但是如果需要做remember me功能，可以把jwt的token扔到cookie里，只要没到过期时间，下次cookie会自动带上该token，拿到token，相当于remember me了。

**配置完filter chain，可以看看这些log的url pattern和自己想的是不是一样，从而快速判断filter chain有没有配错。**

#### filter chain的认证过程
如果我们此时使用basic auth提供guest用户访问`/basic` url，会因为权限不足而被拒。具体流程可以从debug日志看出来——

首先，因为我们的用户存在了in-memory database里，`DaoAuthenticationProvider`先从db里获取了用户：
```
2022-12-30 16:59:07.770 DEBUG 81703 --- [nio-8081-exec-1] o.s.security.web.FilterChainProxy        : Securing GET /basic
2022-12-30 16:59:08.547 DEBUG 81703 --- [nio-8081-exec-1] s.s.w.c.SecurityContextPersistenceFilter : Set SecurityContextHolder to empty SecurityContext
2022-12-30 16:59:09.072 DEBUG 81703 --- [nio-8081-exec-1] o.s.s.a.dao.DaoAuthenticationProvider    : Authenticated user
```
然后`BasicAuthenticationFilter`认证了请求，创建了一个guest用户的authentication `UsernamePasswordAuthenticationToken [Principal=org.springframework.security.core.userdetails.User [Username=guest, Password=[PROTECTED], Enabled=true, AccountNonExpired=true, credentialsNonExpired=true, AccountNonLocked=true, Granted Authorities=[ROLE_no auth]], Credentials=[PROTECTED], Authenticated=true, Details=WebAuthenticationDetails [RemoteIpAddress=0:0:0:0:0:0:0:1, SessionId=null], Granted Authorities=[ROLE_no auth]]`，放到了`SecurityContextHolder`里：
```
2022-12-30 16:59:09.073 DEBUG 81703 --- [nio-8081-exec-1] o.s.s.w.a.www.BasicAuthenticationFilter  : Set SecurityContextHolder to UsernamePasswordAuthenticationToken [Principal=org.springframework.security.core.userdetails.User [Username=guest, Password=[PROTECTED], Enabled=true, AccountNonExpired=true, credentialsNonExpired=true, AccountNonLocked=true, Granted Authorities=[ROLE_no auth]], Credentials=[PROTECTED], Authenticated=true, Details=WebAuthenticationDetails [RemoteIpAddress=0:0:0:0:0:0:0:1, SessionId=null], Granted Authorities=[ROLE_no auth]]
2022-12-30 16:59:09.075 DEBUG 81703 --- [nio-8081-exec-1] o.s.s.w.csrf.CsrfAuthenticationStrategy  : Replaced CSRF Token
2022-12-30 16:59:09.075 DEBUG 81703 --- [nio-8081-exec-1] o.s.security.web.FilterChainProxy        : Secured GET /basic
```
**filter chain走完了，最后到了servlet**，显然是`DispatcherServlet`。dispatcher servlet按照请求mapping，找到了controller `FrontPageController#basic()`：
```
2022-12-30 16:59:09.077 DEBUG 81703 --- [nio-8081-exec-1] org.apache.tomcat.util.http.Parameters   : Set encoding to UTF-8
2022-12-30 16:59:09.078 DEBUG 81703 --- [nio-8081-exec-1] o.s.web.servlet.DispatcherServlet        : GET "/wtf/basic", parameters={}
2022-12-30 16:59:09.085 DEBUG 81703 --- [nio-8081-exec-1] s.w.s.m.m.a.RequestMappingHandlerMapping : Mapped to com.puppylpg.server.controller.FrontPageController#basic()
```
因为方法设置了`@PreAuthorize("hasAnyAuthority('ROLE_USER')")`，**且配置里设置了`@EnableMethodSecurity`**，所以aop发挥作用，before method interceptor进行拦截认证，发现权限不对，没有user权限。所以鉴权的结果是不通过。返回一个`ExpressionAttributeAuthorizationDecision`，值为`[granted=false, expressionAttribute=ExpressionAttribute [Expression=hasAnyAuthority('ROLE_USER')]]`：
```
2022-12-30 16:59:09.100 DEBUG 81703 --- [nio-8081-exec-1] horizationManagerBeforeMethodInterceptor : Authorizing method invocation ReflectiveMethodInvocation: public java.lang.String com.puppylpg.server.controller.FrontPageController.basic(); target is of class [com.puppylpg.server.controller.FrontPageController]
2022-12-30 16:59:09.114 DEBUG 81703 --- [nio-8081-exec-1] horizationManagerBeforeMethodInterceptor : Failed to authorize ReflectiveMethodInvocation: public java.lang.String com.puppylpg.server.controller.FrontPageController.basic(); target is of class [com.puppylpg.server.controller.FrontPageController] with authorization manager org.springframework.security.authorization.method.PreAuthorizeAuthorizationManager@6b7a3dd8 and decision ExpressionAttributeAuthorizationDecision [granted=false, expressionAttribute=ExpressionAttribute [Expression=hasAnyAuthority('ROLE_USER')]]
```
这是权限不足，所以由`AccessDeniedHandlerImpl`往response status里写入403 forbidden，请求结束，默认清理掉`SecurityContextHolder`：
```
2022-12-30 16:59:09.122 DEBUG 81703 --- [nio-8081-exec-1] o.s.web.servlet.DispatcherServlet        : Failed to complete request: org.springframework.security.access.AccessDeniedException: Access Denied
2022-12-30 16:59:09.124 DEBUG 81703 --- [nio-8081-exec-1] o.s.s.w.access.AccessDeniedHandlerImpl   : Responding with 403 status code
2022-12-30 16:59:09.124 DEBUG 81703 --- [nio-8081-exec-1] s.s.w.c.SecurityContextPersistenceFilter : Cleared SecurityContextHolder to complete request
```
试图返回`/error`：
```
2022-12-30 16:59:09.124 DEBUG 81703 --- [nio-8081-exec-1] o.a.c.c.C.[Tomcat].[localhost]           : Processing ErrorPage[errorCode=0, location=/error]
2022-12-30 16:59:09.575 DEBUG 81703 --- [nio-8081-exec-1] o.s.security.web.FilterChainProxy        : Securing GET /error
2022-12-30 16:59:09.899 DEBUG 81703 --- [nio-8081-exec-1] s.s.w.c.SecurityContextPersistenceFilter : Set SecurityContextHolder to empty SecurityContext
2022-12-30 16:59:10.820 DEBUG 81703 --- [nio-8081-exec-1] o.s.s.w.a.AnonymousAuthenticationFilter  : Set SecurityContextHolder to anonymous SecurityContext
2022-12-30 16:59:10.820 DEBUG 81703 --- [nio-8081-exec-1] o.s.security.web.FilterChainProxy        : Secured GET /error
2022-12-30 16:59:10.839 DEBUG 81703 --- [nio-8081-exec-1] w.c.HttpSessionSecurityContextRepository : Did not store anonymous SecurityContext
2022-12-30 16:59:10.839 DEBUG 81703 --- [nio-8081-exec-1] w.c.HttpSessionSecurityContextRepository : Did not store anonymous SecurityContext
2022-12-30 16:59:10.840 DEBUG 81703 --- [nio-8081-exec-1] s.s.w.c.SecurityContextPersistenceFilter : Cleared SecurityContextHolder to complete request
2022-12-30 16:59:10.840 DEBUG 81703 --- [nio-8081-exec-1] o.a.c.c.C.[.[.[.[dispatcherServlet]      :  Disabling the response for further output
2022-12-30 16:59:10.845 DEBUG 81703 --- [nio-8081-exec-1] o.a.coyote.http11.Http11InputBuffer      : Before fill(): parsingHeader: [true], parsingRequestLine: [true], parsingRequestLinePhase: [0], parsingRequestLineStart: [0], byteBuffer.position(): [0], byteBuffer.limit(): [0], end: [306]
```

## 最常配的功能
- https://docs.spring.io/spring-security/reference/5.8/servlet/authorization/authorize-http-requests.html

我们最常配置的当然是url权限！

也可以直接用[权限注解](https://docs.spring.io/spring-security/reference/5.8/servlet/authorization/expression-based.html)直接做[方法级别的权限设置](https://docs.spring.io/spring-security/reference/5.8/servlet/authorization/expression-based.html#_method_security_expressions)：
```java
@PreAuthorize("hasRole('USER')")
public void create(Contact contact);
```
当然，一两个特殊的权限可以用权限注解，大部分相同的权限可以直接配置到security filter chain里：which means that access will only be allowed for users with the role "ROLE_USER". **Obviously the same thing could easily be achieved using a traditional configuration and a simple configuration attribute for the required role.**

一遍遍写相同的权限注解不嫌累啊？

## 升级spring security 6
spring security很方便，但是使用起来最头疼的问题是api三天两头变……

security5升级到6又发生了大变化。如果要升级，需要先升级到5.8，此时在6里会删掉的api在5.8里标注了deprecated。
- [`authorizeHttpRequests`里的各种url matcher替换为`requestMatchers`](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/config.html#use-new-requestmatchers)
- [`authorizeHttpRequests`外的各种url matcher替换为`securityMatchers`](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/config.html#use-new-security-matchers)
- 所有的配置均返回`HttpSecurity`对象本身，相关配置使用customizer定义细节；

虽然又变了，但是平心而论，本次升级还是让配置security方便了不少，尤其是第三点。

security 5：
```java
        http.csrf().csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .and()
                .antMatcher("/basic")
                .httpBasic()
                .and()
                // basic auth不要用session
                .sessionManagement()
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS);

        return http.build();
```

security 6：
```java
        return http.csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
                .securityMatcher("/basic")
                .httpBasic(Customizer.withDefaults())
                // basic auth不要用session
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .build();
```
可以看到csrf方法本身返回`HttpSecurity`，因此不需要通过`and`方法再转回`HttpSecurity`；而csrf的相关配置均在csrf方法里通过customizer搞定了，非常方便！

上面的配置转成spring security 6后如下：
```java
/**
 * {@link org.springframework.security.access.prepost.PreAuthorize}需要通过{@link EnableMethodSecurity}手动开启。。。
 *
 * @author puppylpg on 2022/12/16
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class MultipleSecurityFilterChainConfig {

    /**
     * 配置用户。
     * 默认会创建一个DelegatingPasswordEncoder，实际就是使用bcrypt加密。
     * 之所以deprecated是因为密码应该从外部读取，而不是使用password encoder在运行的时候生成。
     */
    @Bean
    public UserDetailsService userDetailsService() {
        InMemoryUserDetailsManager manager = new InMemoryUserDetailsManager();
        manager.createUser(User.withDefaultPasswordEncoder().username("guest").password("guest").roles("no auth").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("hello").password("world").roles("USER").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("actuator").password("exposeall").roles("ENDPOINT_ADMIN").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("puppylpg").password("puppylpg").roles("USER", "ADMIN").build());
        return manager;
    }

    /**
     * admin才能查看h2-console。
     * user权限会返回403 forbidden
     */
    @Bean
    @Order(1)
    public SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
        return http.securityMatcher("/h2-console/**")
                .authorizeHttpRequests(request -> request.anyRequest().hasRole("ADMIN"))
                .formLogin(Customizer.withDefaults())
                .build();
    }

    /**
     * /actuator相关url。
     * 优先级可以和前一条重复，只要这两条chain匹配的url不重叠，不会有什么问题。
     */
    @Bean
    @Order(1)
    public SecurityFilterChain actuatorAuth(HttpSecurity http) throws Exception {
        // 这条链匹配的url
        return http.securityMatcher(EndpointRequest.toAnyEndpoint())
                // 这条链的权限
                .authorizeHttpRequests(request -> request.anyRequest().hasRole("ENDPOINT_ADMIN"))
                .httpBasic(withDefaults())
                // basic auth不要用session
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .build();
    }

    /**
     * user相关的url只能admin才能看
     */
    @Bean
    @Order(2)
    protected SecurityFilterChain formAuth(HttpSecurity http) throws Exception {
        // opendoc csrf支持开启后，配不配置cookie里都有`XSRF-TOKEN`
        return http.csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
                // 这些请求不仅要认证，还要拥有相应角色
                // but这样配置的话，"/user-api/users/"仍然不需要角色认证
                .securityMatcher("/user-api/users")
                .authorizeHttpRequests(request -> request.anyRequest().hasRole("ADMIN"))
                // 使用表单提交用户名和密码的方式认证：人的认证
                // 返回302，Location: http://localhost:8080/login
                .formLogin(Customizer.withDefaults())
                .build();
    }

    /**
     * /basic url需要使用basic认证
     */
    @Bean
    @Order(3)
    protected SecurityFilterChain basicAuth(HttpSecurity http) throws Exception {
        return http.csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
                .securityMatcher("/basic")
                .httpBasic(Customizer.withDefaults())
                // basic auth不要用session
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .build();
    }

    /**
     * 其他请求。没设置优先级，为last
     */
    @Bean
    public SecurityFilterChain formLoginFilterChain(HttpSecurity http) throws Exception {
        return http.authorizeHttpRequests(request -> request.anyRequest().authenticated())
                .formLogin(withDefaults())
                // remember me过期时间
                // remember me加密用到的key
                .rememberMe(rm -> rm.tokenValiditySeconds((int) TimeUnit.DAYS.toSeconds(2)).key("hellokugou"))
                .build();
    }
}
```

# 集成springboot
- https://docs.spring.io/spring-security/reference/servlet/getting-started.html#servlet-hello-auto-configuration

springboot会默认给spring security配置以下内容：
- 创建一个名为`springSecurityFilterChain`的Filter，把该filter注册到servlet容器上，**拦截每一个请求**；
- 自动配置一个`UserDetailsService` bean，并创建一个名为`user`的用户，密码会在启动时打印到log里：Using generated security password: 8e557245-73e2-4286-969a-ff57fe326336；

# 感想
**最后再总结一下spring security注册和使用Filter的流程**：
1. 借助springmvc，为servlet容器添加security相关的filter。完成这件任务的是**`AbstractSecurityWebApplicationInitializer`**，它是springmvc的`WebApplicationInitializer`接口的实现，所以会被springmvc执行。执行的逻辑就是add filter到servlet context；
2. 如果项目本身使用了springmvc，springmvc会为servlet容器添加dispatcher servlet。完成这件任务的是**`AbstractDispatcherServletInitializer`**，它是springmvc的`WebApplicationInitializer`接口的实现，所以会被springmvc执行。执行的逻辑就是add servlet到servlet context；此时request的流程是：
    1. http
    2. 进入servlet 容器
        1. servlet filter
        2. 进入springmvc
            1. security filter
            2. dispatcher servlet
2. 如果项目本身没使用springmvc，项目一定自己往servlet context上注册了servlet（要不然用servlet容器干嘛）；此时request的流程是：
    1. http
    2. 进入servlet 容器
        1. servlet filter
        2. 进入springmvc
            1. security filter
        3. **出了springmvc**：
            1. 自己注册的servlet

spring security的这些思路真的不错！真的是把springmvc玩儿明白了！
