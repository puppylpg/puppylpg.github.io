---
layout: post
title: "Spring Security - Authentication"
date: 2022-12-25 23:08:21 +0800
categories: spring security
tags: spring security
---

spring security主要解决三个问题：
- Authentication：认证。谁在访问；
- Authorization：权限。某用户能不能访问；
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

![securitycontextholder](/assets/screenshots/spring/security/securitycontextholder.png)

## `SecurityContextHolder` - 人柱力
最简单往`SecurityContextHolder`里设置`SecurityContext`的方法就是手动创建一个测试authentication并set进去：
```
SecurityContext context = SecurityContextHolder.createEmptyContext();
Authentication authentication =
    new TestingAuthenticationToken("username", "password", "ROLE_USER");
context.setAuthentication(authentication);

SecurityContextHolder.setContext(context);
```
`SecurityContextHolder`使用`ThreadLocal`存储authentication，所以相当于是全局变量，可在同一线程执行的任意地方获取、修改authentication。**因此可以使用`SecurityContextHolder#getContext`在任何地方获取到authentication。**

> By default, `SecurityContextHolder` uses a `ThreadLocal` to store these details, which means that the SecurityContext is always available to methods in the same thread, **even if the `SecurityContext` is not explicitly passed around as an argument to those methods**. Using a `ThreadLocal` in **this way is quite safe if you take care to clear the thread after the present principal’s request is processed. Spring Security’s `FilterChainProxy` ensures that the `SecurityContext` is always cleared.**

**缺点是必须做好善后工作，最后要清理掉线程里保存的该状态。spring security在`FilterChainProxy`的最后会清掉`SecurityContext`**：
```
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

## `SecurityContext` - wrapper
所以其实它也没干啥。

## `Authentication`
看起来挺唬人，但是里面的用户名（principal）、密码（credentials）、权限（authorities），其实基本都是string。

authority还使用`GrantedAuthority`封装了一层，其实还是string。

### role vs. authority
authority一般分为两拨：role vs. authority。但是role和authority其实没区别……authority就是`GrantedAuthority`，其实就是个string。`UserDetails`的实现类 **`User`在添加role的时候，也是把它构造为`GrantedAuthority`，只不过加了个`ROLE_`前缀，所以它其实还是string**。**`User`把这两类`GrantedAuthority`放在了一起，所以都是等价的string，没区别了。唯一的区别就是，role在存储和判断的时候，都会默认加上`ROLE_`前缀**。

> **So `hasAuthority('ROLE_ADMIN')` means the the same as `hasRole('ADMIN')` because the `ROLE_` prefix gets added automatically.**

# `AuthenticationManager`
但是正常情况下，security context都不是像上面一样手动new一个`TestingAuthenticationToken`，而是使用`AuthenticationManager`完成认证：
- `Authentication authenticate(Authentication authentication) throws AuthenticationException`

它的最常见实现类是`ProviderManager`，**后者又把认证的活儿委托给了一堆`AuthenticationProvider`，从而可以做到多类用户的认证。每个`AuthenticationProvider`只负责一类认证。**

> You can inject multiple `AuthenticationProviders` instances into `ProviderManager`. Each `AuthenticationProvider` performs a specific type of authentication. For example, **`DaoAuthenticationProvider` supports username/password-based authentication, while `JwtAuthenticationProvider` supports authenticating a JWT token.**

`ProviderManager`可以设置一个父`AuthenticationManager`作为默认的认证方式。多个`ProviderManager`也可以可以共享父`AuthenticationManager`，比如spring security的多条`SecurityFilterChain`可以有有一些相同的认证机制：

**一旦认证完，验证了一个用户的身份，获取了它的权限，就可以把密码删了，以防止密码泄露。后面的认证流程基本权限就够用了**。通过`ProviderManager#eraseCredentialsAfterAuthentication`控制这一行为：

> **By default, `ProviderManager` tries to clear any sensitive credentials information from the `Authentication` object that is returned by a successful authentication request. This prevents information, such as passwords, being retained longer than necessary in the `HttpSession`.**

对于`User`，删除密码就意味着：
```
	@Override
	public void eraseCredentials() {
		this.password = null;
	}
```

# 权限认证filter
介绍spring security架构时说过，spring security提供了[很多filter](https://docs.spring.io/spring-security/reference/servlet/architecture.html#servlet-security-filters)放在自己的security filter chain上以完成各个功能。**`UsernamePasswordAuthenticationFilter`就是其中用`AuthenticationManager`来做用户名密码校验生成`Authentication`的filter**。

![abstractauthenticationprocessingfilter](/assets/screenshots/spring/security/abstractauthenticationprocessingfilter.png)

> `AbstractAuthenticationProcessingFilter`是`UsernamePasswordAuthenticationFilter`的抽象实现。

核心认证逻辑主要关心的是：**如何把用户提供的认证信息构造成spring security需要的authentication**。

`UsernamePasswordAuthenticationFilter`会把用户名密码信息构造成`UsernamePasswordAuthenticationToken`交给`AuthenticationManager`认证。`AuthenticationManager`则采用合适的`AuthenticationProvider`完成认证过程。

> When the user submits their credentials, the `AbstractAuthenticationProcessingFilter` creates an `Authentication` from the `HttpServletRequest` to be authenticated. The type of `Authentication` created depends on the subclass of `AbstractAuthenticationProcessingFilter`. For example, `UsernamePasswordAuthenticationFilter` creates a `UsernamePasswordAuthenticationToken` from a username and password that are submitted in the `HttpServletRequest`.

认证完毕后，会做一系列操作，比如重定向到原有的请求、如果配置了remember me，记下该认证信息等等。如果认证失败，也会有失败处理逻辑，返回相应异常。

## `AuthenticationEntryPoint`
一般情况下，尤其是对于前后端系统，用户一开始的请求是不带有认证信息的，所以需要重定向用户请求到登录页面。这一流程一般是在抛出认证异常之后，由`ExceptionTranslationFilter`做的。`ExceptionTranslationFilter`通过`AuthenticationEntryPoint`返回登录endpoint。可能是登录页、也可能是`WWW-Authenticate` header以让用户完成basic认证，等等。

> Used by `ExceptionTranslationFilter` to commence an authentication scheme.
>
> **The `AuthenticationEntryPoint` implementation might perform a redirect to a log in page, respond with an WWW-Authenticate header, or take other action.**

# 具体认证形式
认证方式是多种多样的，可以是登录页，也可以是basic认证，或者其他形式。

## 用户密码认证
有一点需要分清楚，**无论form登录还是basic认证，本质上都是用户名密码的认证方式，所以都可以用`UsernamePasswordAuthenticationFilter`实现**。

### form login
[表单登录](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/form.html)应该是最常见的流程了。

这个时序图完美展示了表单登录的流程：

![loginurlauthenticationentrypoint](/assets/screenshots/spring/security/loginurlauthenticationentrypoint.png)

`FilterSecurityInterceptor`，和`ExceptionTranslationFilter`也都是spring security提供的filter chain上的filter。

因为要让用户登录，要重定向到登录页，所以此时`ExceptionTranslationFilter`用来转换错误的`AuthenticationEntryPoint`是`LoginUrlAuthenticationEntryPoint`。从中也可以看到，返回的并非直接是登录页，而是`/login` endpoint，再有client发起`/login`请求，才重新通过自定义的controller返回登录页。

> In most cases, the `AuthenticationEntryPoint` is an instance of `LoginUrlAuthenticationEntryPoint`.

再次提交用户名密码之后，就是上一节讲的核心认证逻辑的内容了。不过[有几个地方就确定了](https://docs.spring.io/spring-security/reference/_images/servlet/authentication/unpwd/usernamepasswordauthenticationfilter.png)：
1. 构造的`Authentication`用的是`UsernamePasswordAuthenticationFilter`，构造成`UsernamePasswordAuthenticationToken`；
2. `AuthenticationManager` 里肯定有根据构造成`UsernamePasswordAuthenticationToken`存储的位置做相关验证的`AuthenticationProvider`;
3. `AuthenticationSuccessHandler`一般是`SimpleUrlAuthenticationSuccessHandler`，要在认证成功后把请求重定向到之前请求的资源url；

所以还会涉及到之前[Spring Security - 架构]({% post_url 2022-12-25-spring-security-architecture %})介绍的请求缓存和重定向的逻辑。

默认情况下，spring security已经设置好了登录页。也可以通过手动配置覆盖它：
```
public SecurityFilterChain filterChain(HttpSecurity http) {
	http
		.formLogin(withDefaults());
	// ...
}
```
比如通过设置form相关的supplier重定义它的行为：
```
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
```
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

![basicauthenticationentrypoint](/assets/screenshots/spring/security/basicauthenticationentrypoint.png)

不过此时处于filter chain上的filter不再是`UsernamePasswordAuthenticationToken`，而是`BasicAuthenticationFilter`，它创建的还是`UsernamePasswordAuthenticationToken`。后面的认证流程不变。

这个时候不像表单登录，认证前的请求是不缓存的，**因为客户端有能力重新发送之前的请求**！所以不需要server自动帮它做重定向。

> **The `RequestCache` is typically a `NullRequestCache` that does not save the request since the client is capable of replaying the requests it originally requested.**

> 666，原来是这样约定的……spring security属实把需求拿捏了。

同样，basic认证也是spring security默认支持的。也同样，如果使用了spring security自定义配置，就需要手动配置basic认证。

> Spring Security’s HTTP Basic Authentication support in is enabled by default. However, as soon as any servlet based configuration is provided, HTTP Basic must be explicitly provided.

```
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
```
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
```
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

**最终，认证通过的authentication（`UsernamePasswordAuthenticationToken`）被设置到了全局`SecurityContextHolder`里。**

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

因此，在不同request间持久化context用`HttpSessionSecurityContextRepository`，为了防止单个request报错后依然要访问context，用`RequestAttributeSecurityContextRepository`。它俩场景不同，不如一起用了。所以spring security提供了`DelegatingSecurityContextRepository`，默认把context同时使用这两种方式持久化。

**security filter chain里的`SecurityContextPersistenceFilter`是用来做context的持久化的**。

# 并发session控制
一个比较有意思的问题：[一个账户最多能多少人同时使用](https://docs.spring.io/spring-security/reference/5.8/servlet/authentication/session-management.html#ns-concurrent-sessions)？比如一个账号同时间只能登陆一次（同一时刻只能有一个关于这个账号的session）。第二次登陆默认踢掉第一次，或者直接禁止第二次登陆。

慎用第二种策略。。。

> Note that if you are using the second approach, a user who has not explicitly logged out (but who has just closed their browser, for example) will not be able to log in again until their original session expires.

# remember me
之前介绍的Authentication持久化是同session的不同request之间的持久化。而 **remember me是不同session之间的持久化**。也就是说，关掉浏览器之后，下次再还能在不提供用户名密码的情况下直接通过认证。

**同一session的不同request可以通过session共享数据，但是不同session之间没法共享数据，怎么办？现在只剩下cookie了**。可以给浏览器发送个cookie，服务记录下这个cookie关联的Authentication。让浏览器下一次的请求带上这个cookie，就能找到这个Authentication，则本次请求对应的session都不用认证了，就实现了跨session的认证。

> This is typically accomplished by sending a cookie to the browser, with the cookie being detected during future sessions and causing automated login to take place. 

## 基于hash的token
cookie指明了以下两部分信息：
1. 明文：给谁用什么算法加密的，过期时间是什么时候；
2. 密文：加密后的值；
```
base64(username + ":" + expirationTime + ":" + algorithmName + ":"
algorithmHex(username + ":" + expirationTime + ":" password + ":" + key))
```

> key: A private key to prevent modification of the remember-me token

但是这个cookie要是被偷了就凉了……

> Notably, this has a potential security issue in that a captured remember-me token will be usable from any user agent until such time as the token expires. This is the same issue as with digest authentication.

## 基于数据库的token
也差不多，不过存到数据库里了，而不是服务器里，所以服务重启也不会丢失。

## 实现
实现在`UsernamePasswordAuthenticationFilter`/`BasicAuthenticationFilter`里了。会调用`RememberMeServices`，它有两个实现，对应上面两种方式：
- `TokenBasedRememberMeServices`
- `PersistentTokenBasedRememberMeServices`

# logout
[logout是必须提供的功能](https://docs.spring.io/spring-security/reference/servlet/authentication/logout.html)。它主要做两件事：让http session失效，让remember me也失效（因为明确说了要退出）。spring security还会默认重定向到登录页：
- Invalidating the HTTP Session
- Cleaning up any RememberMe authentication that was configured
- Clearing the `SecurityContextHolder`
- Redirecting to `/login?logout`

# 感想
spring security对需求拿捏得是真准啊。我反而是通过功能在认识需求了:D

spirng security确实6，这么多功能，尤其是对请求的缓存、对认证消息的缓存、remember me，看得我越来越通透了。

