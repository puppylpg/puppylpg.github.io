---
layout: post
title: "Spring Security - Authentication"
date: 2022-12-25 23:08:21 +0800
categories: spring security
tags: spring security
---

spring security主要解决三个问题：
- Authentication：认证。谁在访问；
- Authorization：权限。这个用户能不能访问；
- protection：防止一些常见的攻击；

前两个问题是最基础的，也是两个递进的问题——知道了谁在访问（Authentication），才能判断他有没有资格访问（Authorization）。

1. Table of Contents, ordered
{:toc}

# Authentication中的核心概念
[Authentication](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html)的核心概念涉及到三级对象：
- `SecurityContextHolder`：存储认证对象的地方。认证一旦通过，要把认证信息存储下来，以供后续校验逻辑使用；
- `SecurityContext`：认证对象。它就是`Authentication`的简单wrapper；
- `Authentication`：真正的认证对象。由三部分组成：
    + `Principal`：可以理解为就是一个用户名，一个string代表的用户名；
    + `Credentials`：就是一个密码。只不过是object对象，而非简单的string；
    + `Authorities`：权限。string代表的权限，不过是一个多值的集合；

![securitycontextholder](/pics/spring/security/securitycontextholder.png)

## `SecurityContextHolder`

> 一个容器，或者说存放认证信息的盒子。

最简单往`SecurityContextHolder`里设置`SecurityContext`的方法就是手动创建一个测试authentication并set进去：
```java
SecurityContext context = SecurityContextHolder.createEmptyContext();
Authentication authentication =
    new TestingAuthenticationToken("username", "password", "ROLE_USER");
context.setAuthentication(authentication);

SecurityContextHolder.setContext(context);
```
`SecurityContextHolder`使用`ThreadLocal`存储authentication，所以相当于是（该线程的）全局变量，可在同一线程执行的任意地方获取、修改authentication。**因此可以使用`SecurityContextHolder#getContext`在任何地方获取到authentication。**

> By default, `SecurityContextHolder` uses a `ThreadLocal` to store these details, which means that the SecurityContext is always available to methods in the same thread, **even if the `SecurityContext` is not explicitly passed around as an argument to those methods**. Using a `ThreadLocal` in **this way is quite safe if you take care to clear the thread after the present principal’s request is processed. Spring Security’s `FilterChainProxy` ensures that the `SecurityContext` is always cleared.**

**缺点是必须做好善后工作，在本次请求的最后要清理掉线程里保存的该状态。spring security在`FilterChainProxy`的最后会清掉`SecurityContext`**：
```java
	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		boolean clearContext = request.getAttribute(FILTER_APPLIED) == null;
		if (!clearContext) {
			doFilterInternal(request, response, chain);
			return;
		}
		try {
			request.setAttribute(FILTER_APPLIED, Boolean.TRUE);
			doFilterInternal(request, response, chain);
		}
		catch (RequestRejectedException ex) {
			this.requestRejectedHandler.handle((HttpServletRequest) request, (HttpServletResponse) response, ex);
		}
		finally {
			SecurityContextHolder.clearContext();
			request.removeAttribute(FILTER_APPLIED);
		}
	}
```
按照servlet filter chain的规范，在filter chain的后面做的都属于后操作。**而`FilterChainProxy`是spring security的入口，等filter chain调用完毕之后，spring security也一定结束了。此时清理掉`SecurityContext`正合适。**

> 但是这么做的话，岂不是每个请求都要认证一遍？会不会产生太多的认证开销？**为了避免这种重复的认证开销，Spring Security使用了会话管理（session）和缓存机制（cache）来优化性能。见下文。**

## `SecurityContext` - wrapper
`Authentication`的wrapper，所以其实它也没干啥，就是get/set `Authentication`。

## `Authentication`
看起来挺唬人，但是里面的用户名（principal）、密码（credentials）、权限（authorities），其实基本都是string。

authority还使用`GrantedAuthority`封装了一层，其实还是string。

### role vs. authority
authority一般分为两拨：role vs. authority。但是role和authority其实没区别……authority就是`GrantedAuthority`，其实就是个string。`UserDetails`的实现类 **`User`在添加role的时候，也是把它构造为`GrantedAuthority`，只不过加了个`ROLE_`前缀，所以它其实还是string**。**`User`把这两类`GrantedAuthority`放在了一起，所以都是等价的string，没区别了。唯一的区别就是，role在存储和判断的时候，都会默认加上`ROLE_`前缀**。

> **So `hasAuthority('ROLE_ADMIN')` means the the same as `hasRole('ADMIN')` because the `ROLE_` prefix gets added automatically.**

# `AuthenticationManager`
但是正常情况下，security context都不是像上面一样手动new一个`TestingAuthenticationToken`，而是使用`AuthenticationManager`完成认证：
- `Authentication authenticate(Authentication authentication) throws AuthenticationException`

它的最常见实现类是`ProviderManager`，**后者又把认证的活儿委托给了一堆`AuthenticationProvider`，从而可以做到多类用户的认证。每个`AuthenticationProvider`只负责一类认证（比如负责remember me形式的认证方式）。**

> You can inject multiple `AuthenticationProviders` instances into `ProviderManager`. Each `AuthenticationProvider` performs a specific type of authentication. For example, **`DaoAuthenticationProvider` supports username/password-based authentication, while `JwtAuthenticationProvider` supports authenticating a JWT token.**

`ProviderManager`可以设置一个父`AuthenticationManager`作为默认的认证方式（比如基于用户名密码的认证）。多个`ProviderManager`也可以可以共享父`AuthenticationManager`，比如spring security的多条`SecurityFilterChain`可以有一些相同的认证机制。

**一旦认证完，验证了一个用户的身份，获取了它的权限，就可以把密码删了，以防止密码泄露。后面的鉴权流程只需要基本权限就够用了**。通过`ProviderManager#eraseCredentialsAfterAuthentication`控制这一行为：

> **By default, `ProviderManager` tries to clear any sensitive credentials information from the `Authentication` object that is returned by a successful authentication request. This prevents information, such as passwords, being retained longer than necessary in the `HttpSession`.**

对于`User`对象，删除密码就意味着：
```java
	@Override
	public void eraseCredentials() {
		this.password = null;
	}
```
简单而纯粹。

# 权限认证filter
介绍spring security架构时说过，spring security提供了[很多filter](https://docs.spring.io/spring-security/reference/servlet/architecture.html#servlet-security-filters)放在自己的security filter chain上以完成各个功能。**`UsernamePasswordAuthenticationFilter`就是其中使用`AuthenticationManager`来做用户名密码校验以生成`Authentication`的filter**。

![abstractauthenticationprocessingfilter](/pics/spring/security/abstractauthenticationprocessingfilter.png)

> `AbstractAuthenticationProcessingFilter`是`UsernamePasswordAuthenticationFilter`的抽象父类。

核心认证逻辑主要关心的是：**如何把用户提供的认证信息构造成spring security需要的authentication**。

**注意：只有post请求且url结尾为`/login`，才会让`UsernamePasswordAuthenticationFilter`开启认证，否则该filter没有任何作用**。`UsernamePasswordAuthenticationFilter`会把用户名密码信息（从request parameter获取username和password）构造成`UsernamePasswordAuthenticationToken`交给`AuthenticationManager`认证。`AuthenticationManager`则采用合适的`AuthenticationProvider`完成认证过程。**如果认证成功，会把authentication放到`SecurityContextHolder`里**：`SecurityContextHolder.setContext(context)`。

> When the user submits their credentials, the `AbstractAuthenticationProcessingFilter` creates an `Authentication` from the `HttpServletRequest` to be authenticated. The type of `Authentication` created depends on the subclass of `AbstractAuthenticationProcessingFilter`. For example, `UsernamePasswordAuthenticationFilter` creates a `UsernamePasswordAuthenticationToken` from a username and password that are submitted in the `HttpServletRequest`.

认证完毕后，会做一系列操作，比如重定向到原有的请求、如果配置了remember me，记下该认证信息等等。如果认证失败，也会有失败处理逻辑，返回相应异常。

## `AuthenticationEntryPoint`
一般情况下，尤其是对于前后端系统，用户一开始的请求是不带有认证信息的，所以需要重定向用户请求到登录页面。**这一流程一般是在抛出认证异常之后，由`ExceptionTranslationFilter`做的。`ExceptionTranslationFilter`通过`AuthenticationEntryPoint`返回登录endpoint**。可能是登录页、也可能是`WWW-Authenticate` header以让用户完成basic认证，等等。

> Used by `ExceptionTranslationFilter` to commence an authentication scheme.
>
> **The `AuthenticationEntryPoint` implementation might perform a redirect to a log in page, respond with an WWW-Authenticate header, or take other action.**

**冷知识：`ExceptionTranslationFilter`也是filter chain上的一个filter。**

> 抛出异常的是`AccessDecisionManager`。

# 具体认证形式
认证方式是多种多样的，可以是登录页，也可以是basic认证，或者其他形式。

## 用户密码认证
有一点需要分清楚，**无论form登录还是basic认证，本质上都是用户名密码的认证方式，所以都可以用`UsernamePasswordAuthenticationFilter`实现**。

### form login
[表单登录](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/form.html)应该是最常见的流程了。

这个时序图完美展示了表单登录的流程：

![loginurlauthenticationentrypoint](/pics/spring/security/loginurlauthenticationentrypoint.png)

`FilterSecurityInterceptor`，和`ExceptionTranslationFilter`也都是spring security提供的filter chain上的filter。

因为要让用户登录，要重定向到登录页，所以此时`ExceptionTranslationFilter`用来转换错误的`AuthenticationEntryPoint`是`LoginUrlAuthenticationEntryPoint`。从中也可以看到，返回的并非直接是登录页，而是`/login` endpoint，再由client发起`/login`请求，才重新通过自定义的controller返回登录页。

> In most cases, the `AuthenticationEntryPoint` is an instance of `LoginUrlAuthenticationEntryPoint`.

再次提交用户名密码之后，就是上一节讲的核心认证逻辑的内容了。不过[有几个之前没确定的地方现在就确定了](https://docs.spring.io/spring-security/reference/_images/servlet/authentication/unpwd/usernamepasswordauthenticationfilter.png)：
1. 构造的`Authentication`用的是`UsernamePasswordAuthenticationFilter`，构造成`UsernamePasswordAuthenticationToken`；
2. `AuthenticationManager` 里肯定有根据构造成`UsernamePasswordAuthenticationToken`存储的位置做相关验证的`AuthenticationProvider`;
3. `AuthenticationSuccessHandler`一般是`SimpleUrlAuthenticationSuccessHandler`，要在认证成功后把请求重定向到之前请求的资源url；

所以还会涉及到之前[Spring Security - 架构]({% post_url 2022-12-25-spring-security-architecture %})介绍的请求缓存和重定向的逻辑。

默认情况下，spring security已经设置好了登录页。也可以通过手动配置覆盖它：
```java
public SecurityFilterChain filterChain(HttpSecurity http) {
	http
		.formLogin(withDefaults());
	// ...
}
```
比如通过设置form相关的supplier重定义它的行为：
```java
public SecurityFilterChain filterChain(HttpSecurity http) {
	http
		.formLogin(form -> form
			.loginPage("/login")
			.permitAll()
		);
	// ...
}
```
手动指定`loginPage`属性后，要自己渲染login页面（可以使用thymeleaf搞定）。不仅如此，还要自定义一个controller，将`/login`对应到（使用thymeleaf创建的）view上：
```java
@Controller
class LoginController {
	@GetMapping("/login")
	String login() {
		return "login";
	}
}
```
spring boot应该能帮忙简化这些行为。

### basic认证
[basic认证](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/passwords/basic.html)的流程大同小异，只不过返回的不再是`login` endpoint了，而是带`WWW-Authenticate` header的响应。

这个时序图完美展示了basic认证的流程：

![basicauthenticationentrypoint](/pics/spring/security/basicauthenticationentrypoint.png)

此时处于filter chain上的filter不再是`UsernamePasswordAuthenticationToken`，而是`BasicAuthenticationFilter`，它创建的还是`UsernamePasswordAuthenticationToken`。后面的认证流程不变。

这个时候不像表单登录，认证前的请求是不缓存的，**因为客户端有能力重新发送之前的请求**！所以不需要server自动帮它做重定向。

> **The `RequestCache` is typically a `NullRequestCache` that does not save the request since the client is capable of replaying the requests it originally requested.**
>
> 666，原来是这样约定的……spring security属实把需求拿捏了。

同样，basic认证也是spring security默认支持的。也同样，如果使用了spring security自定义配置，就需要手动配置basic认证。

> Spring Security’s HTTP Basic Authentication support in is enabled by default. However, as soon as any servlet based configuration is provided, HTTP Basic must be explicitly provided.

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) {
	http
		// ...
		.httpBasic(withDefaults());
	return http.build();
}
```

### digest认证
**[Digest认证不建议使用](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/passwords/digest.html)**，因为它不支持bcrypt这种有破解难度的密码，所以用不用digest用处不大，lookup table破解起来并不费事儿，相当于明文裸奔了。

所以与其用digest，不如用basic，只要配上https就行了。

# 用户管理
认证流程介绍清楚了，还有一个问题：认证用户从哪里来？

认证用户有两个核心概念：
- [`UserDetails`](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/passwords/user-details.html)：**代表一个用户**。包含user详细信息，比如username、password、authority，还包括是否启用、是否过期、是否锁定等。spring security里它的实现是`User`。
- [`UserDetailsService`](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/passwords/user-details-service.html)：**管理`user`**。常用的实现是`UserDetailsManager`，它的实现有`InMemoryUserDetailsManager`（就是用一个map管理user）、`JdbcUserDetailsManager`；

**首先，要能表示一个用户。其次，要能从一个地方获取合法的用户信息**。也就是上述两个抽象。

## `UserDetailsService` - 获取用户的地方
它的作用就是获取用户：
- `UserDetails loadUserByUsername(String username)`

用户能来自那里？那可太多了：
- 来自memory，当然一般也就在测试的时候会在memory里设置几个用户；
- 来自数据库，使用jdbc读取；
- 来自ldap，比如接入公司的用户体系的时候，一般使用ldap。**没错，ldap只是一个存储方式**！

### in memory
[测试用in memory user](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/passwords/in-memory.html)。有多种方式创建user：

**直接指定用户，此时密码用“密文”。就像在数据库里一样，这时候的用户信息已经是处理过的了，不再是原始信息**：
```java
@Bean
public UserDetailsService users() {
	UserDetails user = User.builder()
		.username("user")
		.password("{bcrypt}$2a$10$GRLdNijSQMUvl/au9ofL.eDwmoohzzS7.rmNSJZ.0FxO/BTk76klW")
		.roles("USER")
		.build();
	UserDetails admin = User.builder()
		.username("admin")
		.password("{bcrypt}$2a$10$GRLdNijSQMUvl/au9ofL.eDwmoohzzS7.rmNSJZ.0FxO/BTk76klW")
		.roles("USER", "ADMIN")
		.build();
	return new InMemoryUserDetailsManager(user, admin);
}
```
但是既然是测试用，不如直接指定明文得了，反正都不安全。此时指定的是加密前的用户密码，存储到memory之前会使用`User.withDefaultPasswordEncoder()`加密一下：
```java
@Bean
public UserDetailsService users() {
	// The builder will ensure the passwords are encoded before saving in memory
	UserBuilder users = User.withDefaultPasswordEncoder();
	UserDetails user = users
		.username("user")
		.password("password")
		.roles("USER")
		.build();
	UserDetails admin = users
		.username("admin")
		.password("password")
		.roles("USER", "ADMIN")
		.build();
	return new InMemoryUserDetailsManager(user, admin);
}
```

### jdbc
[把用户存储到数据库里才是正常的做法](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/passwords/jdbc.html)。

如果想不做什么操作，就需要使用spring security定义的表结构。可以从`JdbcUserDetailsManager`查看schema。

想自定义表结构？当然可以，不过spring security提供的`JdbcUserDetailsManager`就不能用了，需要按照自己的表结构覆盖掉它的一些方法。

### ldap
LDAP (Lightweight Directory Access Protocol)，[一般接入公司人员组织架构的时候使用](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/passwords/ldap.html)。

## 用户验证器 - `DaoAuthenticationProvider`
之前说`AuthenticationManager`负责验证用户名密码，实际上它会委托给一个个具体的`AuthenticationProvider`。**`DaoAuthenticationProvider`就是其中一种`AuthenticationProvider`，负责从`UserDetailsService`获取用户信息（`UserDetails`），并（使用`PasswordEncoder`）验证**。

> `DaoAuthenticationProvider` is an `AuthenticationProvider` implementation that leverages a `UserDetailsService` and `PasswordEncoder` to authenticate a username and password.
>
> The `DaoAuthenticationProvider` validates the `UserDetails` and then returns an `Authentication` that has a principal that is the `UserDetails` returned by the configured `UserDetailsService`.
>
> `UserDetailsService` is used by `DaoAuthenticationProvider` for retrieving a username, password, and other attributes for authenticating with a username and password.

**最终，认证通过的authentication（`UsernamePasswordAuthenticationToken`）被设置到了（线程）全局`SecurityContextHolder`里。**

> Ultimately, the returned `UsernamePasswordAuthenticationToken` will be set on the `SecurityContextHolder` by the authentication Filter.

# Authentication持久化
**如果是表单登录，第一次请求会让用户提供凭证，后面的请求肯定就不需要了**。凭证被持久化了，默认持久化到session里。

## 登录过程
上面介绍过登录流程，[这里具象化为了http请求和响应](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/persistence.html)。

**登陆成功后要换session id，以防止[session fixation attacks](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/session-management.html#ns-session-fixation)**。

> Upon authenticating the user, the user is associated to a new session id to prevent session fixation attacks.

> 在[Spring Security - 架构]({% post_url 2022-12-25-spring-security-architecture %})里已经介绍过请求缓存、重定向逻辑了。

## 凭证持久化
凭证默认放在`SecurityContext`，后者通过`SecurityContextRepository`来维护（增删改查）。**默认用到的`SecurityContextRepository`是`HttpSessionSecurityContextRepository`，它把`SecurityContext`放在了session里，key为`SPRING_SECURITY_CONTEXT`**。

**这和缓存请求以重定向的思路一样，也是放到session里**。当然，basic认证的时候不需要缓存请求，因为client能自己发，所以用的`NullRequestCache `。这里也类似，对于oauth，应该也可以自己一直带上认证，所以不需要把`SecurityContext`存下来，用`NullSecurityContextRepository`就行，其实也是啥也不干。

`RequestAttributeSecurityContextRepository`则是把`SecurityContext`放在request里，作为一个attribute：`javax.servlet.ServletRequest.setAttribute(String, Object)`。把`SecurityContext`只和这个request关联，并不会让接下来的request也能检索到context。**它的主要作用是防止请求出错导致session被清理，报错页面访问不到user信息了**。

因此：
1. 在不同request间持久化context用`HttpSessionSecurityContextRepository`；
2. 为了防止单个request报错后依然要访问context，用`RequestAttributeSecurityContextRepository`。

它俩场景不同，不如一起用了。所以spring security提供了`DelegatingSecurityContextRepository`，默认把context同时使用这两种方式持久化。

**security filter chain里的`SecurityContextPersistenceFilter`是用来做context的持久化的**。

# session
spring security默认使用session存放认证信息，对于form登录的用户来说，这意味着只在login请求发送一次用户名密码就行了，后面的请求不需要用户名密码了，spring security会从session里取认证信息。

**但是对于basic认证来说，这会导致一个问题：第一次basic认证如果成功了，后面的请求即使用户名密码错了，依然能通过认证，因为后面的请求直接从session里就拿到认证信息了。**

> **恍然大明白，其实form登录的前后端系统，我们只发送了一次用户名密码，后面的请求都没有带。那么`UsernamePasswordAuthenticationFilter`只认证一次（post `/login`）太合情合理了！**

同样，如果第一次的basic认证成功了但鉴权失败（403 forbidden），不仅第一次的请求会失败，因为接下来的请求带有session，也会失败。**请求带着session id，直接就认证通过了，所以甚至都不会再次触发basic认证**，想在浏览器里重新进行basic认证都没办法。欲哭无泪。而由于session默认是会被序列化的，重启服务后会继续生效，再加上basic认证一般都不会配置logout，在session过期前永远不可能认证通过了……

## basic认证禁用session
因此basic认证需要禁用session，以让每次请求都带上用户名和密码信息。直接修改`HttpSecurity`即可：
```java
http.sessionManagement().sessionCreationPolicy(SessionCreationPolicy.STATELESS);
```
- STATELESS：session创建策略实际上不使用session，也不从session里取认证信息。

**设置stateless之后，server不再返回set-cookie JSESSIONID了，因此client的下次请求也不会设置session id**。

## 并发session控制
一个比较有意思的问题：[一个账户最多能多少人同时使用](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/session-management.html#ns-concurrent-sessions)？比如一个账号同时间只能登陆一次（同一时刻只能有一个关于这个账号的session）。第二次登陆默认踢掉第一次，或者直接禁止第二次登陆。

慎用第二种策略。。。

> Note that if you are using the second approach, a user who has not explicitly logged out (but who has just closed their browser, for example) will not be able to log in again until their original session expires.

# remember me
之前介绍的Authentication持久化是同session的不同request之间的持久化。而 **remember me是不同session之间的持久化**。也就是说，关掉浏览器之后，下次还能在不提供用户名密码的情况下直接通过认证。

**同一session的不同request可以通过session共享数据，但是不同session之间没法共享数据，怎么办？现在只剩下cookie了**。可以给浏览器发送个cookie，服务记录下这个cookie关联的Authentication。让浏览器下一次的请求带上这个cookie，就能找到这个Authentication，则本次请求对应的session都不用认证了，就实现了跨session的认证。

> This is typically accomplished by sending a cookie to the browser, with the cookie being detected during future sessions and causing automated login to take place. 

## 流程
如果服务支持remember me，开启之后，如果用户设置了remember me（勾选remember me框），http response会让设置两个cookie：
- remember-me=aGVsbG86MTY0ODY1NTI3MTYxMzoyZjFiYTlkYzZjNzA4NWZiYTRjMjA3NDJkZGFhOTMyNg; Max-Age=2419200; Expires=Wed, 30-Mar-2022 15:47:51 GMT; Path=/; HttpOnly
- JSESSIONID=EC43C831BC13E3BE5F51C6EE34155AAD; Path=/; HttpOnly

如果关掉浏览器再打开，cookie里有刚刚的remember me：
- Cookie: remember-me=aGVsbG86MTY0ODY1NTI3MTYxMzoyZjFiYTlkYzZjNzA4NWZiYTRjMjA3NDJkZGFhOTMyNg

此时访问资源，不需要登录，server会返回一个新的session id（不是刚刚的那个），而且不再返回set cookie remember me：
- Set-Cookie: JSESSIONID=0862C3F35DAC95956855137E71BBB493; Path=/; HttpOnly

remember-me有个过期时间，Expires，值就是设置的4周。4周内每次重新访也就会有这个cookie，所以永远认证成功。所以必须得有logout。

**之后当请求没有在`SecurityContextHolder`里设置`Authentication`，且cookie里有remember me的时候，spring security的`RememberMeAuthenticationFilter`会**：
1. 从cookie里取出`remember-me`这个key对应的value；
2. 解密value，取出用户名密码；
3. 根据用户名和密码，判断是否要给`SecurityContextHolder`设置`Authentication`；

## remember-me value
cookie里的remember-me对应的值如下：
1. 明文：给谁用什么算法加密的，过期时间是什么时候；
2. 密文：加密后的值；
```java
base64(username + ":" + expirationTime + ":" + algorithmName + ":" + algorithmHex(username + ":" + expirationTime + ":" password + ":" + key))
```

> key: A private key to prevent modification of the remember-me token

但是这个cookie要是被偷了就凉了……

> Notably, this has a potential security issue in that a captured remember-me token will be usable from any user agent until such time as the token expires. This is the same issue as with digest authentication.

## `RememberMeAuthenticationFilter`的实现
`RememberMeAuthenticationFilter`会调用`RememberMeServices`，生成一个`RememberMeAuthenticationToken`，等待后续被验证。`RememberMeServices`有两个实现：
- `TokenBasedRememberMeServices`
- `PersistentTokenBasedRememberMeServices`

验证token使用的是`AuthenticationManager`里的`RememberMeAuthenticationProvider`。

> **此时并没有提供用户名密码，但是会自动提供remember me相关的cookie，所以通过`RememberMeAuthenticationProvider`这个`AuthenticationProvider`就把验证的工作做了。**

**唯一可跨session实现remember me功能的方式是使用cookie存储一个remember me相关的信息**。如果没有remember me，登录完之后返回的set cookie header如下：
```
Set-Cookie: JSESSIONID=8606493EF67C64BC0158AD46B2CE3992; Path=/wtf; HttpOnly
Set-Cookie: XSRF-TOKEN=; Max-Age=0; Expires=Thu, 01-Jan-1970 00:00:10 GMT; Path=/wtf
Set-Cookie: XSRF-TOKEN=6d610efc-278f-4968-9b05-3071af8486f3; Path=/wtf
```
下次请求的cookie如下：
```
Cookie: JSESSIONID=8606493EF67C64BC0158AD46B2CE3992; XSRF-TOKEN=6d610efc-278f-4968-9b05-3071af8486f3
```

开启remember me之后，**首先是request parameter里多了一个参数`remember-me = on`**，其次登录完之后，set cookie的header也发生了变化：
```
Set-Cookie: JSESSIONID=6F09CB1EC1191FAE8B201AC5B6C4C8B0; Path=/wtf; HttpOnly
Set-Cookie: remember-me=aGVsbG86MTY3MjIyMDU0ODQyNjplMThiYzZmMDY2ZDZmNjE0NjRjZGU4OGU4ZGJlYWQ3Yw; Max-Age=172800; Expires=Wed, 28-Dec-2022 09:42:28 GMT; Path=/wtf; HttpOnly
Set-Cookie: XSRF-TOKEN=; Max-Age=0; Expires=Thu, 01-Jan-1970 00:00:10 GMT; Path=/wtf
Set-Cookie: XSRF-TOKEN=3f7105ab-f13c-410f-bfc7-ad3694695ab0; Path=/wtf
```
**新增返回了一个remember me相关的cookie，且把过期时间告诉了浏览器，超过时间浏览器自己就不发送了**。

下次请求的cookie如下：
```
Cookie: JSESSIONID=6F09CB1EC1191FAE8B201AC5B6C4C8B0; XSRF-TOKEN=3f7105ab-f13c-410f-bfc7-ad3694695ab0; remember-me=aGVsbG86MTY3MjIyMDU0ODQyNjplMThiYzZmMDY2ZDZmNjE0NjRjZGU4OGU4ZGJlYWQ3Yw
```
如果这个remember me相关的cookie没有过期，那么就会在请求的时候带上remember-me key对应的value。如前所述，该value是`hello:1672220548426:e18bc6f066d6f61464cde88e8dbead7c` base64之后的值。

关掉浏览器，再次请求，此时cookie不再包含jsessionid，但是依旧会包含remember-me key：
```
Cookie: remember-me=aGVsbG86MTY3MjIyMDU0ODQyNjplMThiYzZmMDY2ZDZmNjE0NjRjZGU4OGU4ZGJlYWQ3Yw
```

`RememberMeServices`会把`remember-me` key对应的cookie取出来：
```java
	protected String extractRememberMeCookie(HttpServletRequest request) {
		Cookie[] cookies = request.getCookies();
		if ((cookies == null) || (cookies.length == 0)) {
			return null;
		}
		for (Cookie cookie : cookies) {
			if (this.cookieName.equals(cookie.getName())) {
				return cookie.getValue();
			}
		}
		return null;
	}
```
**既然从cookie里解析出了user，那就取数据库中的user，把username、password、expireTime、key等信息再生成一次签名（这里用的是md5算法），和remember me cookie里的签名作比较就行了。因此，remember me在server重启之后依然能用，因为cookie里已经保留好必要信息了（username、signature）。**

> 其实即使是把信息保存到了session里，在服务重启之后依然是能用的，因为tomcat默认持久化了session。详见[（七）How Tomcat Works - Tomcat Session]({% post_url 2020-10-08-tomcat-session %})

如果发起了post `/logout`请求，server应该让浏览器清除掉`remember-me` cookie：
```
remember-me=; Max-Age=0; Expires=Thu, 01-Jan-1970 00:00:10 GMT; Path=/wtf
```
这样下次就要重新登录了。

## 配置
可以配置remember me的过期时间、算法涉及到的额外key等：
```java
    @Bean
    @Order(2)
    protected SecurityFilterChain configure(HttpSecurity http) throws Exception {
        http.
                .rememberMe()
                // remember me过期时间
                .tokenValiditySeconds((int) TimeUnit.DAYS.toSeconds(2))
                // remember me加密用到的key
                .key("hellokugou");
        // 两种认证方式，如果是浏览器，默认用第二种。如果是接口，直接返回401

        return http.build();
    }
```

# logout
[logout是必须提供的功能](https://docs.spring.io/spring-security/reference/servlet/authentication/logout.html)。它主要做两件事：让http session失效，让remember me也失效（因为明确说了要退出）。spring security还会默认重定向到登录页：
- Invalidating the HTTP Session
- Cleaning up any RememberMe authentication that was configured
- Clearing the `SecurityContextHolder`
- Redirecting to `/login?logout`

# spring security的本质
其实看到这里，差不多也就能感受到spring security的本质了：
- **一切认证工具都是为了往`SecurityContextHolder`放一个authentication**；
- 一切认证校验都是从`SecurityContextHolder`取authentication，看是否符合当前方法/url的权限。符合则继续执行，不符合则结束请求，往http response写入401/403等status、给body写入一些自定义的内容；
- 所谓的避免重复认证（同一session只认证一次），不过是把该session id放到了cookie里。又因为根据规范session在下次打开浏览器的时候必须不一样，所以发明了remember me，只不过是往cookie里放了一个多少天内都不会自动清除的id罢了。和session id相比，它不会在浏览器重启后被清理；

尤其是第一点，无论是spring security默认的`UsernamePasswordAuthenticationFilter`，或者其他的认证filter，甚至是我们自己添加一个其他的什么认证filter（比如添加一个校验header里的token的filter），**只要它能在我们认证通过的情况下往`SecurityContextHolder`放一个authentication就行了**。当然，认证不通过、或者没有进行认证的情况下，最好自定义一个对应的`AuthenticationEntryPoint`，以返回和filter相对应的报错。

**最明显的例子就是spring security test支持的`@WithMockUser`，真的就是简单粗暴往`SecurityContextHolder`放一个由注解定义的authentication。这个authentication甚至都不需要用户名密码，只要设置的权限符合后面的认证方法，就可以通过认证**。

# 感想
spring security对需求拿捏得是真准啊。我反而是通过功能在认识需求了:D

spirng security确实6，这么多功能，尤其是对请求的缓存、对认证消息的缓存、remember me，看得我越来越通透了。
