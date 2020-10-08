---
layout: post
title: "（七）How Tomcat Works - Tomcat Session"
date: 2020-10-08 17:17:44 +0800
categories: Tomcat Http web session
tags: Tomcat Http web session
---

http是无状态的，但是很多应用都要记住不同的请求来自同一个用户，比如需要登录的网站。servlet规范定义了`javax.servlet.http.HttpSession`来做这件事：Provides a way to **identify a user** across more than one page request or visit to a Web site and to **store information about that user**。Tomcat作为servlet容器，需要完成HttpSession的构建。

1. Table of Contents, ordered
{:toc}

# `javax.servlet.http.HttpSession` & `org.apache.catalina.Session`
HttpSession在最简单的实现情况下，可以理解为里面有一个map，存放各种key、value，通过`public Object getAttribute(String name)`方法可以获取任意存放在HttpSession里的值。

Tomcat内部还定义了一个Session接口，算是对servlet提供的HttpSession接口的一种扩充。它的标准实现StandardSession同时实现了Session接口和HttpSession接口，StandardSession仅在Tomcat内部使用，当用户需要获取HttpSession时，通过一个facade将StandardSession创建成一个HttpSession的view，供外部使用。

Session扩充的地方比如可以添加listener：`addSessionListener`。可以关联一个保存Session的`org.apache.catalina.Manager`等：`public Manager getManager()`。

# session开发分工
理解session最关键的地方是理解servlet程序猿和servlet容器在session的创建和使用上的不同分工。

- 谁创建session？servlet容器，或者说Tomcat。
- 谁使用session？servlet里会用到session。
- 怎么获取session？servlet规范里，`HttpServletRequest#getSession()`会返回一个HttpSession，而开发servlet时，servlet的service方法入参就有HttpServletRequest，所以可以从HttpServletRequest里直接获取session使用。
- 什么时候创建session？servlet容器收到http请求之后需要根据http信息创建session，在调用servlet的service方法时，通过HttpServletRequest（带有session信息）将session传入servlet，供servlet使用。

**session就像一张身份证，记录了http请求来自于谁，同时记录了各种各样的自定义key、value信息**。这个身份证是由servlet容器自己匹配http请求并创建的，并提供给servlet使用。**servlet程序猿尽管享受servlet容器提供的这一便利即可**。

## servlet——使用session
比如现在要创建一个关于购物车的servlet，开发该servlet的时候直接从HttpServletRequest中取得session，用户没放置一件东西进购物车，就在session里记录好。下次查看购物车内容的请求过来时，直接从获取session，从里面获取之前存放好的内容即可。

再或者有一个servlet，第一次用户可以设置一个值，第二次用户再访问该url的时候将他上次设置的值返回给他：
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
3. 如果没有sessionId，使用Manager创建一个session；

HttpServletRequest的实例是Connector在调用servlet Container之前就创建好的，所以session自然也是那时就创建好了。

那么sessionId是什么时候设置到HttpServletRequest里的？

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
Set-Cookie: JSESSIONID=xxx;Path=/myApp
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

# `org.apache.catalina.Manager`
Manager是用来manage session的。Manager最简单的实现也可以把它理解为一个存放session的map，可以增删改查session，同时session不存在时还能自主创建session。

Manager接口有很多实现，主要是因为存放session的策略不同。比如**当服务器停机时，session要持久化起来吗？一般是要的，这样Tomcat重启后，session还可以从持久化存储里恢复到内存中。**

Tomcat里StandardSession实现了Serializable接口，所以可以用Java自带的持久化方法持久化session对象。

- StandardManager：把session序列化到`SESSION.ser`文件中；
- PersistentManager：把session持久化到文件或者数据库里；

由于持久化到文件或者数据库仅在于存储介质的不同，流程都是一样的，所以Tomcat抽象出了一个Store接口，实现类有FileStore和JDBCStore。看具体实现，前者就是在写文件，后者就是在使用sql语句将session insert到db。

Manager的实现还有一个DistributedManager，用于分布式Tomcat集群使用。用户在一个服务器上发起了请求，**该Tomcat创建完session后要把session发送到整个Tomcat集群**，要不然下次请求打到另一台Tomcat就不被识别了。至于发送方式，可以是创建session的Tomcat将session发送到共享队列，其他Tomcat周期性从队列中同步session。

存储session的好处：
- 持久化、备份：宕机不丢失；
- 省内存：如果session过多，可以将不常用的session swap到外存里，放置内存占用过大；



