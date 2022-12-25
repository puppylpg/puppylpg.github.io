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
spring security[通过servlet容器标准的Filter把功能集成到servlet容器里](https://docs.spring.io/spring-security/reference/servlet/index.html)。在设计上，**它只强制原有应用使用servlet容器，但不强制原有应用一定要使用spring框架。**

> Spring Security integrates with the Servlet Container by using a standard Servlet Filter. This means it works with any application that runs in a Servlet Container. More concretely, you do not need to use Spring in your Servlet-based application to take advantage of Spring Security.

**但是spring security本身是基于spring框架的，所以使用spring会额外给服务引入spring webmvc框架，但只是security的实现基于它，原有的业务代码可以无视这一点。**

# 架构
**[这篇文档](https://docs.spring.io/spring-security/reference/servlet/architecture.html)非常清晰地梳理了spring security的架构！**

## servlet filter chain
spring security依赖servlet Filter拦截、认证请求。

![filterchain](/assets/screenshots/spring/security/filterchain.png)

filter的实现可以从两方面发挥作用：
1. 通过是否调用filter chain，决定请求是否继续走下去（走到最后一个，处理逻辑是servlet）：Prevent downstream Filter instances or the Servlet from being invoked. **In this case, the Filter typically writes the `HttpServletResponse`**；
2. 通过在filter chain的前、后执行相关代码，相当于做一些请求的前置、后置操作：Modify the HttpServletRequest or HttpServletResponse used by the downstream Filter instances and the Servlet.；

```
public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
	// do something before the rest of the application
    chain.doFilter(request, response); // invoke the rest of the application
    // do something after the rest of the application
}
```

所以直接把filter chain传给Filter，好处是可以在filter处理过后，也加一些操作。

> 不过如果是spring，就提供两个方法了，而不是在一个`doFilter`方法里搞定几方面的东西，更合理。

Filter配置在Context container里：
```
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

但是spring security提供了一个`DelegatingFilterProxy`，它是一个servlet Filter，但是它的`doFilter`逻辑比较特殊：从spring `ApplicationContext`里取出一个filter bean，调用它的`doFilter`处理逻辑。所以它把逻辑委托给filter bean了。

> servlet Filter注册的时候不需要调用`doFilter`，启动tomcat之后就会初始化servlet，初始化spring的wac。**当有请求过来的时候，再调用Filter的`doFilter`。此时去wac里取bean是完全来得及的**。所以`DelegatingFilterProxy`能这么做，都是因为servlet容器的注册启动、接受请求是两条有先后顺序的时间线。

所以`DelegatingFilterProxy`就像是一个桥，联通了servlet和spring wac。不过问题在于，单看这个设定好像没什么太大作用：每当需要一个Filter的时候，不仅需要创建一个spring的filter bean，依然还需要创建一个`DelegatingFilterProxy`，作为servlet容器的Filter注册到servlet容器上。这岂不是更麻烦了？

之所以这么想是因为没有意识到“桥”的作用：**注册一个`DelegatingFilterProxy`确实只能将逻辑delegate到一个filter bean上，但是如果这个spring的filter bean支持将逻辑再delegate到一堆别的bean上呢**？这不就相当于只给servlet容器注册了一个Filter，之后只要写一堆spring的bean就行了嘛？此时的编程又回到了spring相关的编程了。这就是“桥”的意义。

spring security已经提供了这样的一个filter bean实现，`FilterChainProxy`。`DelegatingFilterProxy`将filter逻辑委托给它，它再寻找`SecurityFilterChain`，和原有filter chain一起过滤request、response。

![filterchainproxy](/assets/screenshots/spring/security/filterchainproxy.png)

因此这里一共涉及两个代理proxy：
1. 注册到servlet上的delegating Filter，它是一个代理，实际实现filter功能的是spring wac里的filter bean（`FilterChainProxy`）。所以它是`FilterChainProxy`的proxy，名字叫delegating filter proxy；
2. spring wac里的这个filter bean，它即使一个被代理bean，也是一个代理bean，类似demultiplexer，它把功能分散到了一堆别的bean身上，就是`SecurityFilterChain`。所以它是security filter chain的proxy，名字叫filter chain proxy；

最后`SecurityFilterChain`则明显是在模拟servlet的filter chain的概念：一堆filter，有一个不同意，则请求不会继续流转下去。但其实这些bean维护在spring的wac中，并不注册在servlet上。所以它的名字叫security filter chain，是security的filter chain，不是servlet的filter chain。

## 盗版filter chain - `SecurityFilterChain`
显然spring的filter chain是在盗版servlet的filter chain。通过`DelegatingFilterProxy`把请求从正统filter chain上引流到自己的盗版filter chain上。

![multi-securityfilterchain](/assets/screenshots/spring/security/multi-securityfilterchain.png)

一个`SecurityFilterChain`本身就是一堆filter bean的集合，`FilterChainProxy`将逻辑委托给了一堆`SecurityFilterChain`（`List<FilterChainProxy>`），而不是一个`FilterChainProxy`。

> 所以可以理解为它里面实际存储了filter的二维数组。

只有第一个符合请求的`SecurityFilterChain`会生效，其他的`SecurityFilterChain`将不再执行。

> Only the first SecurityFilterChain that matches is invoked

多条filter chain的目的是什么？为了简化配置。比如url以user开头的请求都按照配置a的权限进行校验，而以admin开头的请求都按照另一些权限做更严格的校验。

## 如何验证
`ExceptionTranslationFilter`是security filter chain上的一个filter，它是spring security的核心filter。

![exceptiontranslationfilter](/assets/screenshots/spring/security/exceptiontranslationfilter.png)

它的伪代码如下：
```
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
```
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
```
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

# 配置
[spring security的配置](https://docs.spring.io/spring-security/reference/servlet/configuration/java.html)其实就是在配置最核心的`SecurityFilterChain`，所以跟架构放一起介绍。

## spring security借助spring mvc注册Filter到servlet容器
虽然引入spring security的服务本身可以不使用SpringMVC，但是spring security本身是要依赖SpringMVC的。

**spring security的关键其实就是如何把`DelegatingFilterProxy`作为一个`Filter`注册到servlet容器上**。spring security基于spring mvc，[Spring Web MVC]({% post_url 2022-12-03-spring-web-mvc %})说过，SpringMVC通过`WebApplicationInitializer`初始化servlet容器。所以spring security提供了基于它的抽象实现类`AbstractSecurityWebApplicationInitializer`，**在wac初始化的时候，手动把这个`Filter`添加到servlet上的即可**：
```
Dynamic registration = servletContext.addFilter(filterName, filter);
```
Filter实例是`DelegatingFilterProxy`，注册到servlet上的filter name叫`"springSecurityFilterChain"`。不仅如此，它委托给的那个`FilterChainProxy`在wac里的bean的名字也叫`"springSecurityFilterChain"`：`new DelegatingFilterProxy("springSecurityFilterChain")`。

> 属于是梅开二度了……

之所以都叫这个名，应该是因为这个filter把实现delegate给了`FilterChainProxy`，进而delegate给了`SecurityFilterChain`，所以两个代理其实都没干活儿，实际干活的是security filter chain，所以不如叫`"springSecurityFilterChain"`了。

> 所以这里注册`Filter`是手动在实例化的时候通过代码注册上去的，不是通过`web.xml`配置文件注册上去的！毕竟`WebApplicationInitializer`的本意就是：初始化的时候想干嘛就干嘛！

之前说过，使用spring security的工程不一定显式使用了spring框架，**所以原工程不一定有spring mvc的配置。这种情况下spring security的配置（依然是spring bean配置）怎么被启用**？spring security的`AbstractSecurityWebApplicationInitializer` **支持手动传入一个配置类，并实例化这个配置类里的bean**：
```
		if (this.configurationClasses != null) {
			AnnotationConfigWebApplicationContext rootAppContext = new AnnotationConfigWebApplicationContext();
			rootAppContext.register(this.configurationClasses);
			servletContext.addListener(new ContextLoaderListener(rootAppContext));
		}
```
此时spring security自己启动一个`AnnotationConfigWebApplicationContext`作为root wac。

这个配置类示例：
```
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
```
public class SecurityWebApplicationInitializer
	extends AbstractSecurityWebApplicationInitializer {

	public SecurityWebApplicationInitializer() {
		super(WebSecurityConfiguration.class);
	}
}
```

如果服务本身就使用了SpringMVC框架，那么一定有wac，所以不用手动传入spring security的config类了：
```
public class SecurityWebApplicationInitializer
	extends AbstractSecurityWebApplicationInitializer {

}
```
只需要按照[Spring Web MVC]({% post_url 2022-12-03-spring-web-mvc %})的方式加载我们的spring security相关的config类就行了：
```
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
```
WebApplicationContextUtils.getWebApplicationContext(getServletContext(), attrName)
```
拿wac干什么？`DelegatingFilterProxy`要从它里面取`SecurityFilterChain`啊！

## `HttpSecurity` - 配置`SecurityFilterChain`
配置spring security，除了配置基本组件（比如认证的用户名和密码）外，最主要的就是通过配置至少一个`SecurityFilterChain`来控制spring security的行为！

### 默认的那条security filter chain
springboot默认配置的`SecurityFilterChain`是：
```
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

spring security支持多条filter chain，那么问题来了：springboot自动配置只在bean不存在的情况下才会自动配置，如果我们自动配置了一条security filter chain，这条默认的还会有吗？回的。因为这个自动配置的bean没有声明为conditional on missing bean。

**多条`SecurityFilterChain`之间可以设定优先级，优先级高的filter chain在前面**。

### 怎么配置security filter chain
**spring security提供了便捷的方法帮助快速配置security filter chain——`HttpSecurity`！**

`@EnableWebSecurity`import了`HttpSecurityConfiguration`，它也是一个配置类，会自动配置“一堆”`HttpSecurity`对象（注意是一堆，是prototype，不是singleton）：
```
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
`HttpSecurity`里已经预设好一些属性了，所以每次新建一个filter chain的时候，不用担心东西最基础的东西都要重新设置一遍，比如session管理、request cache等等。我们只需要专注于定义自己需要的过滤行为就行了。正因如此，一下子就能把一个很复杂的过滤规则拆开成多个规则了。

> 这里设置的`PasswordEncoder`比较有意思，是个`LazyPasswordEncoder`。而它其实就是个wrapper，等到实际执行的时候，从`ApplicationContext`里寻找类型为`PasswordEncoder`的bean，并把实际功能实现delegate给它。所以 **虽然spring security在我们配置`PasswordEncoder`之前就设置好了`PasswordEncoder`，但实际用的还是我们配置的`PasswordEncoder`**……这和`DelegatingFilterProxy`的思想一毛一样啊！

`HttpSecurity`其实是一个builder，build后生成的实体是`DefaultSecurityFilterChain`，是`SecurityFilterChain`的实现。
```
public final class HttpSecurity extends AbstractConfiguredSecurityBuilder<DefaultSecurityFilterChain, HttpSecurity>
		implements SecurityBuilder<DefaultSecurityFilterChain>, HttpSecurityBuilder<HttpSecurity> {
```
`HttpBuilder`会在`performBuild`里，构造出一个`DefaultSecurityFilterChain`：
```
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
```
@Configuration
@EnableWebSecurity
public class MultipleSecurityFilterChainConfig {

    /**
     * 配置用户
     *
     * 默认用bcrypt加密
     */
    @Bean
    public UserDetailsService userDetailsService() {
        InMemoryUserDetailsManager manager = new InMemoryUserDetailsManager();
        manager.createUser(User.withDefaultPasswordEncoder().username("puppylpg").password("puppylpg").roles("USER").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("hello").password("world").roles("USER").build());
        manager.createUser(User.withDefaultPasswordEncoder().username("raichu").password("raichu").roles("USER", "ADMIN").build());
        return manager;
    }

    /**
     * admin才能查看h2-console
     *
     * user权限返回403 forbidden
     */
    @Bean
    @Order(1)
    public SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
        http
                .antMatcher("/h2-console/**")
                .authorizeHttpRequests(authorize -> authorize
                        .anyRequest().hasRole("ADMIN")
                )
                .httpBasic(withDefaults());
        return http.build();
    }

    /**
     * 配置认证方式、接口权限
     */
    @Bean
    @Order(2)
    protected SecurityFilterChain configure(HttpSecurity http) throws Exception {
        // opendoc csrf支持开启后，配不配置cookie里都有`XSRF-TOKEN`
        http.csrf().csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .and()
                // 认证请求
                .authorizeRequests()
                // 这些请求不仅要认证，还要拥有相应角色
                // but这样配置的话，"/user-api/users/"仍然不需要角色认证
                .antMatchers("/user-api/users").hasRole("ADMIN")
                // 其他请求只要认证了就行
                .anyRequest().authenticated()
//                .and()
                // 单独设置https和http。会把http302到https，但是https请求会失败...
//                .requiresChannel()
//                .antMatchers("/login").requiresSecure()
//                .antMatchers("/").requiresInsecure()
                .and()
                // 开启http basic认证：程序的认证，比如restful
                // 因为是放在Authentication header里的，所以和应用状态无关
                // 即使应用重启，只要有这个header，也可以直接通过认证
                .httpBasic()
                .and()
                // 使用表单提交用户名和密码的方式认证：人的认证
                // 返回302，Location: http://localhost:8080/login
                .formLogin()
                .and()
                .rememberMe()
                // remember me过期时间
                .tokenValiditySeconds((int) TimeUnit.DAYS.toSeconds(2))
                .key("hellokugou");
        // 两种认证方式，如果是浏览器，默认用第二种。如果是接口，直接返回401

        return http.build();
    }

    /**
     * 没设置优先级，为last
     */
    @Bean
    public SecurityFilterChain formLoginFilterChain(HttpSecurity http) throws Exception {
        http
                .authorizeHttpRequests(authorize -> authorize
                        .anyRequest().authenticated()
                )
                .formLogin(withDefaults());
        return http.build();
    }
}
```

需要注意的是：**我们配置security filter chain时，配置的是更高层次的功能，不是直接配置filter。spring security提供了这么多filter来完成相关功能**：
- https://docs.spring.io/spring-security/reference/servlet/architecture.html#servlet-security-filters

## 最常配的功能
- https://docs.spring.io/spring-security/reference/5.8/servlet/authorization/authorize-http-requests.html

我们最常配置的当然是url权限！

也可以直接用[权限注解](https://docs.spring.io/spring-security/reference/5.8/servlet/authorization/expression-based.html)直接做[方法级别的权限设置](https://docs.spring.io/spring-security/reference/5.8/servlet/authorization/expression-based.html#_method_security_expressions)：
```
@PreAuthorize("hasRole('USER')")
public void create(Contact contact);
```
当然，一两个特殊的权限可以用权限注解，大部分相同的权限可以直接配置到security filter chain里：which means that access will only be allowed for users with the role "ROLE_USER". **Obviously the same thing could easily be achieved using a traditional configuration and a simple configuration attribute for the required role.**

一遍遍写相同的权限注解不嫌累啊？

# 集成springboot
- https://docs.spring.io/spring-security/reference/servlet/getting-started.html#servlet-hello-auto-configuration

springboot会默认给spring security配置以下内容：
- 创建一个名为`springSecurityFilterChain`的Filter，把该filter注册到servlet容器上，**拦截每一个请求**；
- 自动配置一个`UserDetailsService` bean，并创建一个名为`user`的用户，密码会在启动时打印到log里：Using generated security password: 8e557245-73e2-4286-969a-ff57fe326336；

# 感想
spring security的这些思路真的不错！真的是把spring玩儿明白了！

