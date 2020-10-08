---
layout: post
title: "（二）How Tomcat Works - 原始Servlet服务器"
date: 2020-10-07 22:40:02 +0800
categories: Tomcat Http web servlet
tags: Tomcat Http web servlet
---

web server搭建完成了，servlet server（或者说servlet容器）又是什么东西？和web server又有什么区别？

1. Table of Contents, ordered
{:toc}

# javax.servlet.Servlet
servlet说白了就是我们平时写代码的时候创建的一个service，比如使用spring创建一个`@Service`标记的类，它是一个单例，同时有能够提供服务的方法可以调用。

servlet相当于规范化了这个service，定义了一套标准的接口：
```
public interface Servlet {

    public void init(ServletConfig config) throws ServletException;

    public void service(ServletRequest req, ServletResponse res)
            throws ServletException, IOException;

    public ServletConfig getServletConfig();
    
    public String getServletInfo();

    public void destroy();
}
```
关于init、service、destroy的调用时机这里不再多提。

关键的地方在于，**约定了协议，就能够分工合作了**：
- servlet容器：比如tomcat，首先是一个web server，根据收到的http请求，决定加载某个servlet，调用servlet它的service方法，返回一个http响应；
- servlet程序猿：按照Servlet协议，实现一个自己的servlet，直接放到servlet容器里，启动容器就可以工作了！

所以现在看出来了，**servlet server本质上就是一个web server，只不过使用servlet这一套标准之后，程序猿再也不用从头写一个web server了，只需要简简单单写一个servlet实现，就可以使用现成的servlet容器启动一个web服务了（servlet server，也是webserver）** （当然，启动前多少还要进行一些配置）。

> 看`javax.servlet.Servlet`的包名就知道，这是个javax开头的类，不在jdk里，属于java extension，开发的时候需要引入额外的包才能获取这些类。比如：https://mvnrepository.com/artifact/javax.servlet/javax.servlet-api/4.0.1


# `javax.servlet.ServletRequest` & `javax.servlet.ServletResponse`
Servlet标准显然不是只定义一个`javax.servlet.Servlet`类就完成了。而是一整个`javax.servlet`包里的类。这些类一起协作，构成了servlet的标准。

Servlet类最重要的方法service需要传入两个参数：ServletRequest和ServletResponse。而web server收到的其实是http请求，返回的是http响应。**http的请求响应和servlet的请求响应又有什么关系？**

首先，既然servlet server本质上是一个web server，那么一定和上一章中说的一样，从Socket的InputStream中读取一个http请求的字节流，之后向Socket的OutputStream中写入一个http响应的字节流。servlet server一定也是这么和Socket交互的。所以servlet的service方法的入参出参本质上就是http请求和http响应——从前者中获取信息，进行处理，然后返回后者，以完成服务内容。但是http的请求和响应都是plain text，总不能定义service方法的入参和出参都是String吧？那样处理起来就太费劲了。所以servlet定义了两个类ServletRequest和ServletResponse，方便servlet处理数据。

比如ServletResponse里有一个`getWriter`方法：
```
PrintWriter getWriter() throws IOException;
```
Java doc:

> Returns a PrintWriter object that can send character text to the client. The PrintWriter uses the character encoding returned by getCharacterEncoding. If the response's character encoding has not been specified as described in getCharacterEncoding (i.e., the method just returns the default value ISO-8859-1), getWriter updates it to ISO-8859-1.
Calling flush() on the PrintWriter commits the response.
Either this method or getOutputStream may be called to write the body, not both.

所以，servlet程序猿只需要调用`ServletResponse#getWriter`就可以写返回内容了，这也就意味着，servlet容器（tomcat）的任务就是在创建ServletResponse的时候，让`ServletResponse#getWriter`方法返回Socket的OutputStream。后面的代码示例可以看到这一点。

> “返回OutputStream”指的是返回由OutputStream构建的PrintWriter。简述。

> 上面的javadoc还提到了ServletResponse的另一个方法`ServletOutputStream getOutputStream() throws IOException`，效果类似，只不过又把OutputStream多封装了一下，搞成了一个ServletOutputStream。

# Servlet容器处理请求流程
总结一下servlet容器处理http请求的流程：
1. 作为一个web server，监听地址，接收client的http请求；
2. 决定使用哪个servlet（一般是根据程序员的配置决定的）；
3. 加载servlet；
4. 创建一个ServletRequest和一个ServletResponse，将二者作为`Servlet#service`方法的参数；
5. 调用`Servlet#service`方法，提供服务，返回http响应；
6. 继续监听，等待下一个请求；

基本上就是web server的流程，多了一个加载并调用servlet的过程。

# 一个原始的Servlet容器
主要做两件事：
1. 如果http请求的uri是以servlet开头的，就将uri出去servlet的后半部分作为servlet的类名，加载servlet，返回servlet服务的内容；
2. 否则就当做一个普通http请求，直接返回一个普通http响应；

server代码基本没变，最重要的是创建的Request和Response都是ServletRequest和ServletResponse的实现：
```
public class HttpServer1 {

  /** WEB_ROOT is the directory where our HTML and other files reside.
   *  For this package, WEB_ROOT is the "webroot" directory under the working
   *  directory.
   *  The working directory is the location in the file system
   *  from where the java command was invoked.
   */
  // shutdown command
  private static final String SHUTDOWN_COMMAND = "/SHUTDOWN";

  // the shutdown command received
  private boolean shutdown = false;

  public static void main(String[] args) {
    HttpServer1 server = new HttpServer1();
    server.await();
  }

  public void await() {
    ServerSocket serverSocket = null;
    int port = 8080;
    try {
      serverSocket =  new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1"));
    }
    catch (IOException e) {
      e.printStackTrace();
      System.exit(1);
    }

    // Loop waiting for a request
    while (!shutdown) {
      Socket socket = null;
      InputStream input = null;
      OutputStream output = null;
      try {
        socket = serverSocket.accept();
        input = socket.getInputStream();
        output = socket.getOutputStream();

        // create Request object and parse
        Request request = new Request(input);
        request.parse();

        // create Response object
        Response response = new Response(output);
        response.setRequest(request);

        // check if this is a request for a servlet or a static resource
        // a request for a servlet begins with "/servlet/"
        if (request.getUri().startsWith("/servlet/")) {
          ServletProcessor1 processor = new ServletProcessor1();
          processor.process(request, response);
        }
        else {
          StaticResourceProcessor processor = new StaticResourceProcessor();
          processor.process(request, response);
        }

        // Close the socket
        socket.close();
        //check if the previous URI is a shutdown command
        shutdown = request.getUri().equals(SHUTDOWN_COMMAND);
      }
      catch (Exception e) {
        e.printStackTrace();
        System.exit(1);
      }
    }
  }
}
```
注意这里的Response，是一个ServletResponse实现，如前所述，创建的时候传入了Socket的OutputStream：
```
        // create Response object
        Response response = new Response(output);
        response.setRequest(request);
```
`Response#getWriter`返回的就是这个OutputStream：
```
  Request request;
  OutputStream output;
  PrintWriter writer;

  public Response(OutputStream output) {
    this.output = output;
  }
  
  public PrintWriter getWriter() throws IOException {
    // autoflush is true, println() will flush,
    // but print() will not.
    writer = new PrintWriter(output, true);
    return writer;
  }
```


ServletProcessor的主要作用就是将uri作为类名，从webroot文件夹下加载servlet类的字节码，并调用其service方法，传入的是之前创建的ServletRequest和ServletResponse：
```
public class ServletProcessor1 {

  public void process(Request request, Response response) {

    String uri = request.getUri();
    String servletName = uri.substring(uri.lastIndexOf("/") + 1);
    URLClassLoader loader = null;

    try {
      // create a URLClassLoader
      URL[] urls = new URL[1];
      URLStreamHandler streamHandler = null;
      File classPath = new File(Constants.WEB_ROOT);
      // the forming of repository is taken from the createClassLoader method in
      // org.apache.catalina.startup.ClassLoaderFactory
      String repository = (new URL("file", null, classPath.getCanonicalPath() + File.separator)).toString() ;
      // the code for forming the URL is taken from the addRepository method in
      // org.apache.catalina.loader.StandardClassLoader class.
      urls[0] = new URL(null, repository, streamHandler);
      loader = new URLClassLoader(urls);
    }
    catch (IOException e) {
      System.out.println(e.toString() );
    }
    Class myClass = null;
    try {
      myClass = loader.loadClass(servletName);
    }
    catch (ClassNotFoundException e) {
      System.out.println(e.toString());
    }

    Servlet servlet = null;

    try {
      servlet = (Servlet) myClass.newInstance();
      servlet.service((ServletRequest) request, (ServletResponse) response);
    }
    catch (Exception e) {
      System.out.println(e.toString());
    }
    catch (Throwable e) {
      System.out.println(e.toString());
    }

  }
}
```

最后，说一下servlet的加载。

servlet哪来的？程序猿写的。所以servlet容器并不创建servlet类，只需要能找到servlet类所在的位置，需要用它的时候把它load到jvm里就行了。

**程序里，servlet容器是从webroot文件夹里找servlet类的字节码的，所以在部署程序的时候，只需要把自己写的servlet类编译后的.class文件放在webroot文件夹下就行了。**

# `javax.servlet.http.HttpServlet`
Servlet可以和任何cs模型的协议通信，但显然最经常用的就是http协议。所以Servlet的一个最火的实现类就是HttpServlet。

HttpServlet要实现Servlet接口的service()方法：
```
    @Override
    public void service(ServletRequest req, ServletResponse res)
        throws ServletException, IOException {

        HttpServletRequest  request;
        HttpServletResponse response;

        try {
            request = (HttpServletRequest) req;
            response = (HttpServletResponse) res;
        } catch (ClassCastException e) {
            throw new ServletException(lStrings.getString("http.non_http"));
        }
        service(request, response);
    }
```
首先将ServletRequest和ServletResponse转成 **`HttpServletRequest`和`HttpServletResponse`（相比于其父类，多了一些http特定的方法，比如getHeader、getCookie等）**，然后相当暴力地根据请求的方法类型（`req.getMethod`），调用了不同的方法进行处理：
```
    protected void service(HttpServletRequest req, HttpServletResponse resp)
        throws ServletException, IOException {

        String method = req.getMethod();

        if (method.equals(METHOD_GET)) {

            // ...

        } else if (method.equals(METHOD_HEAD)) {
            long lastModified = getLastModified(req);
            maybeSetLastModified(resp, lastModified);
            doHead(req, resp);

        } else if (method.equals(METHOD_POST)) {
            doPost(req, resp);

        } else if (method.equals(METHOD_PUT)) {
            doPut(req, resp);

        } else if (method.equals(METHOD_DELETE)) {
            doDelete(req, resp);

        } else if (method.equals(METHOD_OPTIONS)) {
            doOptions(req,resp);

        } else if (method.equals(METHOD_TRACE)) {
            doTrace(req,resp);

        } else {
            //
            // Note that this means NO servlet supports whatever
            // method was requested, anywhere on this server.
            //

            String errMsg = lStrings.getString("http.method_not_implemented");
            Object[] errArgs = new Object[1];
            errArgs[0] = method;
            errMsg = MessageFormat.format(errMsg, errArgs);

            resp.sendError(HttpServletResponse.SC_NOT_IMPLEMENTED, errMsg);
        }
    }
```
所以servlet开发者开发关于Http的servlet更简单：**只需要extends HttpServlet，并根据自己要处理的内容，overrider相应的doGet/doPost/...方法就行了，service方法都不需要写了**。

# 写servlet还能更简单——JSP
写servlet最大的一个问题就是**Servlet需要将html的代码嵌入Java代码**，很丑很麻烦：
```
    public void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        response.setContentType("text/html;charset=UTF-8");

        // 返回一个PrintWriter对象，Servlet使用它来输出字符串形式的正文数据
        PrintWriter out = response.getWriter();

        String title = "HTTP Header 请求实例";
        String docType =
            "<!DOCTYPE html> \n";
            out.println(docType +
            "<html>\n" +
            "<head><meta charset=\"utf-8\"><title>" + title + "</title></head>\n"+
            "<body bgcolor=\"#f0f0f0\">\n" +
            "<h1 align=\"center\">" + title + "</h1>\n" +
            "<table width=\"100%\" border=\"1\" align=\"center\">\n" +
            "<tr bgcolor=\"#949494\">\n" +
            "<th>Header 名称</th><th>Header 值</th>\n"+
            "</tr>\n");

        // headers
        Enumeration<String> headerNames = request.getHeaderNames();
        while(headerNames.hasMoreElements()) {
            String paramName = headerNames.nextElement();
            out.print("<tr><td>" + paramName + "</td>\n");
            String paramValue = request.getHeader(paramName);
            out.println("<td> " + paramValue + "</td></tr>\n");
        }

        // parameters: the content of form will be passed by k&v, just like http get,
        // so `request.getParameter(key)` can also be used.
        final String NAME = "name";
        out.print("<tr><td>" + NAME + ": " + "</td>\n");
        String paramValue = request.getParameter(NAME);
        out.println("<td> " + paramValue + "</td></tr>\n");

        out.println("</table>\n</body></html>");

        out.flush();
        out.close();
    }
```
就有了JSP——**Servlet类可以由JSP自动生成，变成了JSP将Java代码嵌入html**，然后编译成Servlet类，写起来servlet就舒服多了。比如：
```
<html>
    <head>
           <title>第一个 JSP 程序</title>
    </head>
    <body>
           <%
                  out.println("Hello World！");
           %>
    </body>
</html>
```

> 编译过程：
>
> JSP 引擎从磁盘中载入 JSP 文件，然后将它们转化为 Servlet。**这种转化只是简单地将所有模板文本改用 println() 语句，并且将所有的 JSP 元素转化成 Java 代码。**

# JSP的发展史
https://mp.weixin.qq.com/s?__biz=MzAxOTc0NzExNg==&mid=2665513417&idx=1&sn=f0cb88ff56e47acef1b3d378911073c4&chksm=80d6798ab7a1f09cd79c1e7caec1ebbf325ead0cd60a657c050db3231c1cc62e7f87dff84b6e&scene=21#wechat_redirect
## 手撸html
## 动态页面jsp
html上嵌Java代码
## 标签库
Servlet可以当Controller，Java类当Model，JSP当View，mvc，防止逻辑写的太乱。

但是for循环，if判断，总得写。

所以有了标签库，用`<c:if>`取代for，`<c:forEach>`取代for。

有了JSTL，JSP看起来清爽多了。

## js & css
后来网页模板都不在后端装配了，后端只返回json给前端，由前端的js和css取数据渲染成html。

前后端分离了！！！

# 其他：Facade
Tomcat里用到了大量的facade，类似于装饰器模式。

比如Animal接口只有一个方法eat，Person类是Animal接口的实现，eat方法一定要有，但它还有一个work方法。

假设此时有一个方法`handle(Animal animal)`，把Person传进去自然是没问题的：`handle(person)`。关键在于传进去的毕竟是个Person实例，别人有可能在handle里做出以下操作：
```
    if (animal instanceof Person) {
        ((Person) animal).work
    }
```
这就不符合handle方法将Animal作为参数的初衷（只让调用eat）了。

可以创建一个PersonFacade，实现Animal接口，只有一个eat方法：
```
public class PersonFacade implements Animal {
    Person person;
    public PersonFacade(Person person) {
        this.person = person;
    }
    
    @Override
    public void eat() {
        person.eat();
    }
}
```
实际上PersonFacade对eat方法的实现还是由Person对象完成的，只不过在handle方法里，PersonFacade只是一个Animal类型，不可能被强制转型为Person类型，也无法获取它内部的Person对象，也就没法调用Person对象的work方法。起到了保护作用。

