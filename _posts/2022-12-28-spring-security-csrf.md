---
layout: post
title: "Spring Security - CSRF"
date: 2022-12-28 22:42:14 +0800
categories: spring security
tags: spring security
---

spring security的另一个功能是[保护一些常用的恶意攻击](https://docs.spring.io/spring-security/reference/features/exploits/index.html)，且默认开启。主要防护的是CSRF，Cross Site Request Forgery，跨站请求伪造。

1. Table of Contents, ordered
{:toc}

CSRF指的是[这样的场景](https://docs.spring.io/spring-security/reference/features/exploits/csrf.html#csrf-explained)：**别的网站向你的服务器发送请求，浏览器会默认带上同站的cookie。如果你的浏览器是通过cookie认证的，比如cookie里的session id，那该请求也是通过了认证的。如果该请求会修改数据，那就相当于别的网站有了修改你数据的权限。而你分不清这个请求来自于你的网站还是别的网站**。

伪造的关键在于：它虽然不能解析你的cookie，但浏览器发来的请求会默认带上之前的cookie。
> while the evil website cannot see your cookies, the cookies associated with your bank are still sent along with the request.

所以CSRF本质上是：
1. **别的网站操纵浏览器给你的服务器发送了一个请求**；
2. **该请求未经用户授权（不是用户在你的网站上亲手操作的）**；
3. **而你的服务器不知道这个请求是不是你的网站发过来的**，因为请求本身是合法的。

**The reason that a CSRF attack is possible is that the HTTP request from the victim’s website and the request from the attacker’s website are exactly the same.**

而操纵浏览器给你的服务器发送请求这一行为，甚至都不需要用户介入，只要打开了恶意网站它就能使用JavaScript自动完成请求发送：
> Worse yet, this whole process could have been automated by using JavaScript. This means you did not even need to click on the button. Furthermore, it could just as easily happen when visiting an honest site that is a victim of a XSS attack.

总结一下：
- 病灶：分不清请求究竟是不是你的网站发来的，因为别的网站可以发一个一样的http请求；
- 解决方案：让请求里包含一些别的网站提供不了的东西，这样就能分清请求是不是来自自己的网站了；

To protect against CSRF attacks, we need to ensure there is something in the request that the evil site is unable to provide so we can differentiate the two requests.

# 为什么不把来自其他网站的请求禁了？
只要把来自其他网站的请求禁了，是不是就不会csrf了？

referer可以标记请求来自其他网站，如果referer/origin的来源不是本网站，我们就不处理这些请求，何如？这是可行且简单的，[但问题在于这两个header是可以伪造的](https://zh.wikipedia.org/wiki/%E8%B7%A8%E7%AB%99%E8%AF%B7%E6%B1%82%E4%BC%AA%E9%80%A0#%E6%AA%A2%E6%9F%A5Referer%E5%AD%97%E6%AE%B5)，高度依赖浏览器，而浏览器未必安全。

> referer其实是referrer的误写。。。

而且CORS就是配置跨站策略的，讲CORS的时候就说了，互联网的多姿多彩，就是靠跨域完成的。所以直接禁了不可取。想象一下：你的网站可能会发送营销邮件，但是因为你把来自别的网站的请求禁了，所以从邮件里点不开你的网站……

# 解决方案
**spring security提供了两种CSRF攻击的解决方案，但每一种都要求“[safe method](https://www.rfc-editor.org/rfc/rfc7231#section-4.2.1)”（readonly method，指http `GET`, `HEAD`, `OPTIONS`, and `TRACE`）必须只读，不应该改变app状态。**

> For either protection against CSRF to work, the application must ensure that "safe" HTTP methods are idempotent. This means that requests with the HTTP GET, HEAD, OPTIONS, and TRACE methods should not change the state of the application. **这里感觉文档说错了，只读就行了，[幂等](https://www.rfc-editor.org/rfc/rfc7231#section-4.2.2)是另一回事儿。spring security要求的应该是“safe method必须实现为只读的”。**

**既然出bug的地方在于浏览器会默认给来自外站的（访问本站的）请求带上本站的cookie，所以两个CSRF的防御策略都围绕这一点展开，但思路不同**：
1. STP：**在除了cookie的地方加上一点儿验证信息**，外站请求就没法把验证信息带过来了；
2. `SameSite`：**不允许来自外站的请求带上本站的cookie**；

## STP: Synchronizer Token Pattern
同步token，指的是：
1. **服务器返回response，指定一个token**；
2. **下次请求必须把token带上**；

所以说是同步token。

**token可以是http的parameter，也可以是http的一个header，但不能是cookie，因为cookie是发送请求的时候由浏览器自动加上的**。恶意网站发送请求的时候，浏览器也会给它自动带上cookie，如果token在cookie里，恶意网站的请求也有token了，又分不清了。

> **The key to this working is that the actual CSRF token should be in a part of the HTTP request that is not automatically included by the browser**. For example, requiring the actual CSRF token in an HTTP parameter or an HTTP header will protect against CSRF attacks. Requiring the actual CSRF token in a cookie does not work because cookies are automatically included in the HTTP request by the browser.

**不改变app状态的请求（safe method）可以不使用CSRF防护，所以safe method必须实现为不改变app状态的请求**。如果GET请求实现为非只读、可以改变app状态的请求，且配置了safe method不使用CSRF保护，那这种请求也可以被CSRF攻击了。

> **We can relax the expectations to require only the actual CSRF token for each HTTP request that updates the state of the application. For that to work, our application must ensure that safe HTTP methods are idempotent.**

### token放在post表单里
如果请求是有body的，比如使用表单提交一些信息，那就可以在表单里有塞一些只有本站才能提供的东西，这样就能防止表单相关的csrf攻击。

**我们让服务器返回的响应里包含一个csrf token，所有的表单都包含
`_csrf`的标签，服务渲染网页的时候，会自动把`_csrf`标签替换为csrf token值，放在表单里。提交post请求的时候就带上token了。**

- [跨站请求伪造#令牌同步模式](https://zh.wikipedia.org/wiki/%E8%B7%A8%E7%AB%99%E8%AF%B7%E6%B1%82%E4%BC%AA%E9%80%A0#%E4%BB%A4%E7%89%8C%E5%90%8C%E6%AD%A5%E6%A8%A1%E5%BC%8F)

**可以一个session生成一个token**，恶意网站无法读取跨站响应，所以它得不到这个刚刚生成的token。

> The form now contains a hidden input with the value of the CSRF token. External sites cannot read the CSRF token since the same origin policy ensures the evil site cannot read the response.

**token存在哪里？可以存在服务器里，和session绑定。也可以直接放在cookie的session信息里。因为恶意网站虽然能让浏览器发送该cookie，但它无法读取cookie的session值，所以也没法知道怎么在request body里加上一个和session里一样的token。**

> Please note, **that HTTP session is used in order to store CSRF token. When the request is sent, Spring compares generated token with the token stored in the session**, in order to confirm that the user is not hacked.

**注意：这不是把token放在cookie里。把token放cookie指的是仅仅把token放cookie里。这里token放的位置是请求参数里，之所以顺带也放到了cookie，是为了方便做token的校验。**

页面上每一处的表单都会用这个csrf值渲染，比如这个退出的form：
```xml
<form class="form-signin" method="post" action="/logout">
<h2 class="form-signin-heading">Are you sure you want to log out?</h2>
<input name="_csrf" type="hidden" value="431853ef-77fe-450c-9dd0-ab69ed52b68b" />
<button class="btn btn-lg btn-primary btn-block" type="submit">Log Out</button>
</form>
```

### token放在header里
如果请求不来自表单呢？

如果post的请求体是json，就没办法这么搞了，只能放到header里。

- [跨站请求伪造#添加校驗token](https://zh.wikipedia.org/wiki/%E8%B7%A8%E7%AB%99%E8%AF%B7%E6%B1%82%E4%BC%AA%E9%80%A0#%E6%B7%BB%E5%8A%A0%E6%A0%A1%E9%A9%97token)

同样，来自外站发起的本站请求，能自动带上的header只有cookie，不会带上我们自定义的这个header。

## `SameSite`
**另一个思路是禁止浏览器给来自其他网站的请求带上本站的cookie。**

> An emerging way to protect against CSRF Attacks is to specify the `SameSite` Attribute on cookies. **A server can specify the `SameSite` attribute when setting a cookie to indicate that the cookie should not be sent when coming from external sites.**

cookie的`SameSite`：
```
Set-Cookie: JSESSIONID=randomid; Domain=bank.example.com; Secure; HttpOnly; SameSite=Lax
```
`SameSite`可以设置为两个值：
- `Strict`: 严格策略，只有cookie对应的同站发送请求时，才会给请求带上cookie；
- `Lax`: 宽松策略，除了同站发送请求之外，一部分非同站（[比如top-level navigations](https://datatracker.ietf.org/doc/html/draft-west-first-party-cookies-07#section-5)）发送请求时也能带上cookie；

`Strict`策略虽然安全，但是也会造成一些困惑，所以`Lax`策略可能更好：比如一个用户已经登陆twitter了，此时从google邮箱点击twitter主页地址，如果twitter用了strict策略，这个从邮箱发送的请求不会带上cookie信息，用户打开的twitter还是未登录状态，就比较迷惑。
> Setting the `SameSite` attribute to Strict provides a stronger defense but can confuse users. Consider a user who stays logged into a social media site hosted at social.example.com. The user receives an email at email.example.org that includes a link to the social media site. If the user clicks on the link, they would rightfully expect to be authenticated to the social media site. However, if the SameSite attribute is Strict, the cookie would not be sent and so the user would not be authenticated.

这个策略的另一个问题是老浏览器不一定支持`SameSite`，所以会忽视该策略，依然给其他网站发送的请求带上cookie：
> Another obvious consideration is that, in order for the `SameSite` attribute to protect users, the browser must support the `SameSite` attribute. Most modern browsers do support the SameSite attribute. However, older browsers that are still in use may not.

所以这个策略一般都是辅助策略。

# 如果不使用cookie？
CSRF的关键点就是：浏览器会自动给来自非同站发起的（访问本站的）请求带上同站的cookie。

**如果不使用cookie保存信息，使用一个自定义的header保存这些信息，服务器校验这个自定义header而非cookie，是不是就不怕别人盗用cookie了？是不是也能防止csrf？**

> 只要我不用cookie，就不怕别人偷cookie :D

还真有人这么想：
- https://security.stackexchange.com/questions/62080/is-csrf-possible-if-i-dont-even-use-cookies

但是并不完全能防止csrf：
- https://stackoverflow.com/questions/3732087/is-csrf-possible-without-cookies

因为认证未必只是通过cookie，也可能是http basic等。比如浏览器保存了http basic，下次发请求直接就带上了。**所以csrf的关键不只在于cookie，在于浏览器默认会提供相关认证方式凭据。只要能以你的名义把请求发出去，且server接受了，那csrf就完成了**。

# 如果服务不面向浏览器
**说来说去，都是浏览器默认把我的认证方式带上了！那服务如果没有前端，是不是就不用防止CSRF攻击了？**

还真可以！“浏览器默认把我的认证方式带上了”确实是csrf能成功的原因！

> When should you use CSRF protection? Our recommendation is to use CSRF protection for any request that could be processed by a browser by normal users. **If you are creating a service that is used only by non-browser clients, you likely want to disable CSRF protection.**

# 感想
我就随便看看开开眼，网络攻击这一块儿，你说啥就是啥。
