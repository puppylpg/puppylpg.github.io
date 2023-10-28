---
layout: post
title: "（七）How Tomcat Works - Tomcat Session"
date: 2020-10-08 17:17:44 +0800
categories: Tomcat Http web session cookie JWT SSO
tags: Tomcat Http web session cookie JWT SSO
---

http是无状态的，但是很多应用都要记住不同的请求来自同一个用户，比如需要登录的网站。servlet规范定义了`javax.servlet.http.HttpSession`来做这件事：Provides a way to **identify a user** across more than one page request or visit to a Web site and to **store information about that user**。Tomcat作为servlet容器，需要完成HttpSession的构建。

1. Table of Contents, ordered
{:toc}

# `javax.servlet.http.HttpSession` & `org.apache.catalina.Session`
HttpSession在最简单的实现情况下，可以理解为里面有一个map，存放各种key、value，通过`public Object getAttribute(String name)`方法可以获取任意存放在HttpSession里的值。

> **所以servlet容器在内部存储的其实是map in map：先根据一个id获取session，session本身也是map，根据自定义的key获取对应的value**。

Tomcat内部还定义了一个Session接口，算是对servlet提供的HttpSession接口的一种扩充。它的标准实现StandardSession同时实现了Session接口和HttpSession接口，StandardSession仅在Tomcat内部使用，当用户需要获取HttpSession时，通过一个facade将StandardSession创建成一个HttpSession的view，供外部使用。

Session扩充的地方比如可以添加listener：`addSessionListener`。可以关联一个保存Session的`org.apache.catalina.Manager`等：`public Manager getManager()`。

# session开发分工
理解session最关键的地方是理解servlet程序猿和servlet容器在session的创建和使用上的不同分工。

- 谁创建session？**servlet容器，或者说Tomcat**。
- 谁使用session？对servlet的处理流程里会用到session，**也就是说程序猿用session存储一些自定义的东西**。
- 怎么获取session？servlet规范里，`HttpServletRequest#getSession()`会返回一个HttpSession，而开发servlet时，servlet的service方法入参就有HttpServletRequest，所以可以从HttpServletRequest里直接获取session使用。
- 什么时候创建session？**servlet容器收到http请求之后需要根据http信息创建session**，在调用servlet的service方法时，通过HttpServletRequest（带有session信息）将session传入servlet，供servlet使用。

**session就像一张身份证，记录了http请求来自于谁，同时记录了各种各样的自定义key、value信息**。这个身份证是由servlet容器自己匹配http请求并创建的，并提供给servlet使用。**servlet程序猿尽管享受servlet容器提供的这一便利即可**。

## servlet——使用session
比如现在要创建一个关于购物车的servlet，开发该servlet的时候直接从HttpServletRequest中取得session，用户每放置一件东西进购物车，就在session里记录好，session存在服务端。下次查看购物车内容的请求过来时，直接根据客户端宣称的session id从内存/数据库等获取session，从里面获取之前存放好的内容即可。

下面就是一个servlet，模拟这个使用session的过程。第一次用户可以设置一个值，第二次用户再访问该url的时候将他上次设置的值返回给他：
```
  public void doGet(HttpServletRequest request, HttpServletResponse response)
    throws ServletException, IOException {
    System.out.println("SessionServlet -- service");
    response.setContentType("text/html");
    PrintWriter out = response.getWriter();
    out.println("<html>");
    out.println("<head><title>SessionServlet</title></head>");
    out.println("<body>");
    String value = request.getParameter("value");
    
    // 获取session
    HttpSession session = request.getSession(true);
    
    // 获取上次设置的值
    out.println("<br>the previous value is " + 
      (String) session.getAttribute("value"));
    
    out.println("<br>the current value is " + value);
    
    // 保存本次设置的值
    session.setAttribute("value", value);
    
    out.println("<br><hr>");
    out.println("<form>");
    out.println("New Value: <input name=value>");
    out.println("<input type=submit>");
    out.println("</form>");
    out.println("</body>");
    out.println("</html>");
  }
```
获取上次的值，核心就在于获取session，从session里获取上次存进去的值，并把本次设置的值保存进去。

## servlet容器——创建session
Tomcat对HttpServletRequest的实现是HttpRequestBase，实现了getSession方法：
```
    /**
     * Return the session associated with this Request, creating one
     * if necessary.
     */
    public HttpSession getSession() {
        return (getSession(true));
    }

    /**
     * Return the session associated with this Request, creating one
     * if necessary and requested.
     *
     * @param create Create a new session if one does not exist
     */
    public HttpSession getSession(boolean create) {
        if( System.getSecurityManager() != null ) {
            PrivilegedGetSession dp = new PrivilegedGetSession(create);
            return (HttpSession)AccessController.doPrivileged(dp);
        }
        return doGetSession(create);
    }

    private HttpSession doGetSession(boolean create) {
        // There cannot be a session if no context has been assigned yet
        if (context == null)
            return (null);

        // Return the current session if it exists and is valid
        if ((session != null) && !session.isValid())
            session = null;
        if (session != null)
            return (session.getSession());


        // Return the requested session if it exists and is valid
        Manager manager = null;
        if (context != null)
            manager = context.getManager();

        if (manager == null)
            return (null);      // Sessions are not supported

        if (requestedSessionId != null) {
            try {
                session = manager.findSession(requestedSessionId);
            } catch (IOException e) {
                session = null;
            }
            if ((session != null) && !session.isValid())
                session = null;
            if (session != null) {
                return (session.getSession());
            }
        }

        // Create a new session if requested and the response is not committed
        if (!create)
            return (null);
        if ((context != null) && (response != null) &&
            context.getCookies() &&
            response.getResponse().isCommitted()) {
            throw new IllegalStateException
              (sm.getString("httpRequestBase.createCommitted"));
        }

        session = manager.createSession();
        if (session != null)
            return (session.getSession());
        else
            return (null);

    }
```
1. 如果该request已经有`org.apache.cataline.Session`了，直接获取`javax.servlet.http.HttpSession`；
2. 如果没有session，看看有没有sessionId，有的话使用Manager根据id找到一个现有的session；
3. 如果没有sessionId，使用Manager创建一个session。**Tomcat管理这一堆session，简单理解就是维护一个map in map**；

HttpServletRequest的实例是Connector在调用servlet Container之前就创建好的，所以session自然也是那时就创建好了。

**那么sessionId是什么时候设置到HttpServletRequest里的**？

查看代码，发现有Tomcat会在两处地方设置session id：
1. 解析header的时候，如果发现cookie里有`JSESSIONID`，取它对应的value，该value就是sessionId；
2. 解析uri的时候，如果uri里有`;jsessionid=`，取它后面的值，该值就是sessionId；

也就是说http请求发过来的时候已经表明了自己的session id。**为什么http请求发的时候会带上session id？client怎么会知道自己的session id是什么？**

继续查看代码，发现Tomcat里HttpServletResponse的基础实现HttpResponseBase，在sendHeaders的有如下代码：
```
        if ((session != null) && session.isNew() && (getContext() != null)
            && getContext().getCookies()) {
            Cookie cookie = new Cookie(Globals.SESSION_COOKIE_NAME,
                                       session.getId());
            // ...
        }
```
也就是说，当一个从未出现的用户第一次请求Tomcat时，Tomcat会为他创建一个session，并将session以cookie的形式发送给client。比如：
```
Set-Cookie: JSESSIONID=xxx;Path=/hello
```
Set-Cookie可以参考：https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie

有了这个header，client再发过来的请求就会把JSESSIONID放到header里。

# session交互流程
1. 一个全新的client发送http请求到Tomcat server；
2. Tomcat发现这是一个全新的请求，为它创建session，分配session id，并在response里设置Set-Cookie header，让client下次请求带上这个session id；
3. Tomcat或者servlet可能在session里存放了某些内容；
3. client再次请求，cookie header里带上session id；
4. Tomcat发现请求带有session id，根据id匹配到session，并取出之前存放在session里的内容；

这样就相当于请求之间是有状态的了，Tomcat也可以**通过session“记住”这个用户之前做过哪些事情了**。

> session未必是仅基于cookie的。比如Tomcat也支持在uri里带上session id。如果session仅基于cookie，同时浏览器又禁用cookie（相当于client不配合server了，你让我在cookie里设置session id，我偏不），那server就彻底不知道请求是哪个了，每一次都会为请求重新创建一个session。

# user相同，session一定相同吗？
session只保证用户使用这个浏览器登录后，接下来发的请求都是同一个session id。换句话说，**session只识别接下来来自同一个浏览器的请求都是同一个人**。

如果用户换了个浏览器，继续用相同的账户登录，此时这个浏览器的session和刚刚的一样吗？感觉这个全看实现，**一般是不一样的。也就是说一个账户此时同时存在两个session**。对于购物车之类的需求，为了让两个浏览器里的同一个账户数据互通，应该使用的不是session，而是redis、mysql之类的。

其实哪怕是同一个账户，下次登录产生的session和上次登录的session也不一样。

**所以我觉得账户和session并没有什么关系，是完全两码事，要不要把二者关联起来，完全取决于server实现**：session只负责把你接下来同一个浏览器发的请求识别为同一个人发的，从而使http具有状态。至于要不要把账户和session绑定起来，完全是两码事。最典型的例子就是不需要账户登录的系统，访问server会使用一个session，无论访问多少次都会使用这个session。关掉浏览器再打开，再访问，就是另一个session。

# `org.apache.catalina.Manager` - 管理session
Manager是用来manage session的。Manager最简单的实现也可以把它理解为一个存放session的map，可以增删改查session，同时session不存在时还能自主创建session。**manger的另一个功能是持久化session**。

Manager接口有很多实现，主要是因为存放session的策略不同。比如**当服务器停机时，session要持久化起来吗？一般是要的，这样Tomcat重启后，session还可以从持久化存储里恢复到内存中。**

**Tomcat里`StandardSession`实现了Serializable接口，所以可以用Java自带的持久化方法持久化session对象**。

- `StandardManager`：**把session序列化到`SESSION.ser`文件中**；
- `PersistentManager`：把session持久化到文件或者数据库里；

由于持久化到文件或者数据库仅在于存储介质的不同，流程都是一样的，所以Tomcat抽象出了一个Store接口，实现类有FileStore和JDBCStore。看具体实现，前者就是在写文件，后者就是在使用sql语句将session insert到db。

`StandardManager`持久化session的路径默认是`servletContext.getAttribute(ServletContext.TEMPDIR)` + `SESSION.ser`：
- https://stackoverflow.com/a/57739111/7676237
- https://tomcat.apache.org/tomcat-9.0-doc/config/manager.html#Persistence_Across_Restarts

但是实际使用springboot内嵌的tomcat时，发现tempdir是`/tmp/tomcat.8081.1430510583086709566/work/Tomcat/localhost/wtf`，但是持久化的位置确是`/tmp/7D61FD3B9F0EDBBC7FE2B09FF58494DEB1D82D5F/servlet-sessions/SESSIONS.ser`

> `SESSION.ser`只有在tomcat关闭之后才有。tomcat重启之后，该文件会被删除。

Manager的实现还有一个`DistributedManager`，用于分布式Tomcat集群使用。用户在一个服务器上发起了请求，**该Tomcat创建完session后要把session发送到整个Tomcat集群**，要不然下次请求打到另一台Tomcat就不被识别了。至于发送方式，可以是创建session的Tomcat将session发送到共享队列，其他Tomcat周期性从队列中同步session。

存储session的好处：
- 持久化、备份：宕机不丢失；
- 省内存：如果session过多，可以将不常用的session swap到外存里，防止内存占用过大；

# Cookie's Path
在手动启动简化版Tomcat的代码里：
```
public final class Bootstrap {
  public static void main(String[] args) {

    //invoke: http://localhost:8080/myApp/Session

    System.setProperty("catalina.base", System.getProperty("user.dir"));
    Connector connector = new HttpConnector();
    Wrapper wrapper1 = new SimpleWrapper();
    wrapper1.setName("Session");
    wrapper1.setServletClass("SessionServlet");

    Context context = new StandardContext();
    // StandardContext's start method adds a default mapper
    // 这里设置context path丝毫不影响uri。因为没有Host，而Host才会去使用context path匹配context
    // 所以这里的context path只影响下面说到的cookie中的Path。cookie中的path就是context的path！
    context.setPath("/puppy");
    context.setDocBase("myApp");

    context.addChild(wrapper1);

    // context.addServletMapping(pattern, name);
    // note that we must use /puppy/Session, not just /Session
    // because the /puppy section must be the same as the path, so the cookie will
    // be sent back.
    // request的contextPath为空字符串，所以这个servlet对应的uri是"" + "/puppy/Session" = "/puppy/Session"
    context.addServletMapping("/puppy/Session", "Session");
    // add ContextConfig. This listener is important because it configures
    // StandardContext (sets configured to true), otherwise StandardContext
    // won't start
    LifecycleListener listener = new SimpleContextConfig();
    ((Lifecycle) context).addLifecycleListener(listener);

    // here is our loader
    Loader loader = new WebappLoader();
    // associate the loader with the Context
    context.setLoader(loader);

    connector.setContainer(context);

    // add a Manager
    Manager manager = new StandardManager();
    context.setManager(manager);

    try {
      connector.initialize();
      ((Lifecycle) connector).start();

      ((Lifecycle) context).start();

      // make the application wait until we press a key.
      System.in.read();
      ((Lifecycle) context).stop();
    }
    catch (Exception e) {
      e.printStackTrace();
    }
  }
}
```
- 设置context的doc base为/myApp，从myApp目录下寻找servlet；
- **设置context的path为/puppy，但是并不影响uri。因为没有Host，而Host才会去使用context path匹配context。所以这里的context path只影响下面说到的cookie中的Path**；
- **context里设置servlet mapping为"/puppy/Session"，request的contextPath为空字符串（因为没有Host通过context path找到对应的context，并给http request设置这个context path，所以request里的context path就是默认值，空字符串），所以这个servlet对应的uri是"" + "/puppy/Session" = "/puppy/Session"**。详见[（四）How Tomcat Works - Tomcat servlet容器Container]({% post_url 2020-10-08-tomcat-container %})的“三个路径”部分。

另外可以看出，**cookie的path就是context的path**！
> Path 标识指定了主机下的哪些路径可以接受 Cookie（该 URL 路径必须存在于请求 URL 中）。以字符 %x2F ("/") 作为路径分隔符，**子路径也会被匹配。**

**这个“子路径也会被匹配”，大概是因为context就是一个web app。只有隶属于该app内的请求可以共享cookie**。所以不在context path下的路径，就不共享这个cookie了。

> **如果是正常的应用，会有Host，就会使得context的path、cookie里的Path、request里的contextPath，三者一致**。这里没有Host，就只有前两个是一致的。

Ref:
- https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Cookies

# cookie vs. session
- https://idbeny.com/2020/11/20/network-cors-cookie-session/

> 如果说Cookie机制是通过检查客户身上的“通行证”来确定客户身份的话，那么Session机制就是通过检查服务器上的“客户明细表”来确认客户身份。Session相当于程序在服务器上建立的一份客户档案，客户来访的时候只需要查询客户档案表就可以了。

- cookie：我说我是某个人；
- session：tomcat会拿着cookie里的信息，找到对应的session，从而获取一大堆关于这个人的kv键值对；

**URL地址重写**：
> URL地址重写是对客户端不支持Cookie的解决方案。URL地址重写的原理是将该用户Session的id信息重写到URL地址中。服务器能够解析重写后的URL获取Session的id。这样即使客户端不支持Cookie，也可以使用Session来记录用户状态。

大概就是上面说的在url里带上JSESSIONID。

# session vs. jwt
所以可以看出来了，session是servlet容器存储的一个map in map。缺点如下：
1. 用户多了，session多到爆炸。如果存db里，那这个所有系统共用的db无疑成了瓶颈；
2. 系统不好水平拓展。因为必须保证请求得一直打到同一台机器上，要不别的机器没有这个session。要么就是使用上面说的分布式管理方案，但是会比较复杂；

JWT就是把server-side session挪到了client。client发送一个凭证，说我是xxx。server直接用其中的信息就行。但是必须保证这个信息client不能伪造，所以一般：
1. 使用server的私钥加密，保证client无法伪造；
2. 使用https传输，保证JWT不会被别人拦截复用；

**JWT因为是json，所以灵活性很高。也可以让JWT只发个user id，服务器去db里取这个用户的信息。甚至可以让jwt和session共存，jwt发来一个id，server去session里取这个用户的信息……**

JWT也有缺点，比如：
1. 不好invalid。如果token被别人盗了，只要token没过期，什么时候访问server都是可以的，因为token不在server端保存。session就很好过期，只要用户退出了就可以过期了。所以即便别人盗了session也没用；

> 上面的场景其实就是使用[oddish爬虫](https://github.com/puppylpg/oddish)的时候，每次爬之前都要先登录网站获取cookie贴过来，其实就是每次退出后就过期了。

jwt怎么发过来？
1. 可以放到Authentication header里；
2. 可以放到自定义header里；
3. **甚至可以放到cookie里**；

> **It is also not Cookies vs Tokens. Cookies is a mechanism for storing and transporting bits of information and can be used to store and transport JWT tokens too.**

所以这更印证了上面说的cookie和session的区别：cookie只是client存储信息、发给server的东西。**它就像一辆运输小车。至于运的是JSESSIONID还是JWT，或者只运送UA给server，完全取决于server实现。**

- https://stackoverflow.com/a/45214431/7676237
- https://www.loginradius.com/blog/engineering/guest-post/jwt-vs-sessions/

# SSO: Single Sign-on
有了上面的只是，再扯一扯单点登录。

上面提到了分布式session，主要用途是多节点服务，在一个节点上登陆了，其他节点也要认可它登陆了。它们本质上是一个服务。

sso指的是多个系统，只要登录其中一个，其他的系统都不用再登陆了，它是跨系统的概念。

## cookie同域共用
一种同域下的伪sso用到的方式和上面的分布式session类似。为什么强调同域？因为同一个cookie可以设置为在同域下共享。

> cookie复用只能发生在本域名或者它的父域名，也就是上面说的cookie的Path。

假设多个系统如下：
1. app1：app1.puppylpg.com；
1. app2：app2.puppylpg.com；
1. 搞一个sso系统：sso.puppylpg.com；
 
步骤：
1. 登录app1或app2，都让先登录sso系统；
2. sso就会产生一个session，可以使用Set-Cookie让用户使用的cookie带上session id，并设置cookie的可使用范围是父域名puppylpg.com，同时sso系统记录下该session为已登录状态；
3. 然后把app1、app2、sso系统的session共享（可以通过spring session共享）。

> Spring Session makes it easy to share session data between services in the cloud without being tied to a single container (i.e. Tomcat). Additionally, it supports multiple sessions in the same browser and sending sessions in a header.

这样app1和app2也有这个已登录的session了。同时client会使用同域的cookie，里面有这个session id。所以app1和app2都知道用户已经登录了。

但这个是“伪sso”，只适用于同域。

## 跨域sso
以cas提供的开源sso实现为例：
![cas-sso]({{ site.url }}/pics/sso/cas-sso.png)

**只要图看完了，啥都懂了！**

> 一图胜千言，如果感觉图很复杂，那说明言起来会更复杂。

1. 用户登录app1、app2，都重定向到sso系统；
2. **sso系统认证用户登录，并给用户set-cookie，cookie里放上TGT，其实就和普通的session id一样，只要有这个cookie，sso系统就认为用户是登陆了的**；
3. sso还给用户下发一个ticket；
4. 用户拿着ticket继续登录app1；
5. app1拿着ticket找sso认证；
6. sso说它确实登陆了；
7. app1也认为它登陆了，给用户下发自己的session id，让用户cookie带上这个id；
8. 用户后面访问app1时都用属于app1的cookie，里面有这个session id，app1就知道还是它。

访问app2时，**也重定向到sso。因为用户使用的是sso的cookie，里面的TGT还没过期，sso认为它登陆过了**，所以再下发个新的ticket用于敲开app2的大门。后面的事情就一样了：用户用ticket登录app2，app2找sso认证，sso说确实登陆了，app2给用户下发自己的session id，用户后面访问app2时都用属于app2的cookie，里面有这个session id，app2就知道还是它。

> 有点儿像oauth。

- 单点登录：https://developer.aliyun.com/article/636281
- cas项目提供一种sso开源实现：https://www.apereo.org/projects/cas/about-cas

