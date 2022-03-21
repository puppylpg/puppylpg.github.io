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

# javax.servlet.Servlet：servlet是什么

> servlet的名字是两个词的组合：Server + Applet = Servlet。当然applet这东西早凉了。

servlet说白了就是我们平时写代码的时候创建的一个service，比如使用spring创建一个`@Service`标记的类，它是一个单例，同时有能够提供服务的方法可以调用。

servlet相当于一套“关于这种service”的规范，它定义了一套标准的接口：
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

> 关于init、service、destroy的调用时机这里不再多提。

关键的地方在于，**约定了协议，就能够分工合作了**：
- servlet容器做什么：比如tomcat，首先是一个web server，根据收到的http请求，决定加载某个servlet，调用servlet它的service方法，返回一个http响应；
- servlet程序猿做什么：按照Servlet协议，实现一个自己的servlet，直接放到servlet容器里，启动容器就可以工作了！

所以现在看出来了，**servlet server本质上就是一个web server，只不过使用servlet这一套标准之后，程序猿再也不用从头写一个web server了！不用再考虑怎么收请求、怎么返回响应，只需要专注于处理请求的业务逻辑就好了！这个业务逻辑的处理代码，就是一个servlet的实现。然后就可以使用现成的servlet容器启动一个web服务了**。

所以，servlet server，也是webserver。

**Servlet规范将处理逻辑的输入输出参数标准化为：ServletRequest，ServletResponse**。

## 引入servlet
看`javax.servlet.Servlet`的包名就知道，这是个javax开头的类，不在jdk里，属于java extension，开发的时候需要引入额外的包才能获取这些类。比如：
```
<!-- https://mvnrepository.com/artifact/javax.servlet/javax.servlet-api -->
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
    <version>4.0.1</version>
    <scope>provided</scope>
</dependency>
```
maven默认给servlet包加了provided scope：因为servlet最终会被部署到servlet容器中，而servlet容器肯定是引入了servlet相关的包的，所以我们引入的servlet包只在编译的时候用就行了，打包的时候没必要也打进去。

# `javax.servlet.ServletRequest` & `javax.servlet.ServletResponse`：标准化的输入输出
Servlet标准显然不是只定义一个`javax.servlet.Servlet`类就完成了。而是一整个`javax.servlet`包里的类。这些类一起协作，构成了servlet的标准。

Servlet类最重要的方法service需要传入两个参数：ServletRequest和ServletResponse。而web server收到的其实是http请求，返回的是http响应。**http的请求响应和servlet的请求响应又有什么关系？**

首先，既然servlet server本质上是一个web server，那么一定和上一章中说的一样，从Socket的InputStream中读取一个http请求的字节流，之后向Socket的OutputStream中写入一个http响应的字节流。servlet server一定也是这么和Socket交互的。所以servlet的service方法的入参出参本质上就是http请求和http响应——从前者中获取信息，进行处理，然后返回后者，以完成服务内容。**但是http的请求和响应都是plain text，总不能定义service方法的入参和出参都是String吧？那样处理起来就太费劲了。所以servlet定义了两个类ServletRequest和ServletResponse，方便servlet处理数据。**

## servlet容器处理http请求为ServletRequest
一个将plain http request处理为ServletRequest的示例。

首先从input stream里读取字节，转为字符：
```
  public void parse() {
    // Read a set of characters from the socket
    StringBuffer request = new StringBuffer(2048);
    int i;
    byte[] buffer = new byte[2048];
    try {
      i = input.read(buffer);
    }
    catch (IOException e) {
      e.printStackTrace();
      i = -1;
    }
    for (int j=0; j<i; j++) {
      request.append((char) buffer[j]);
    }
    System.out.print(request.toString());
    uri = parseUri(request.toString());
  }
```
然后按照http request的规范肢解http请求。比如获取请求路径：
```
  private String parseUri(String requestString) {
    int index1, index2;
    index1 = requestString.indexOf(' ');
    if (index1 != -1) {
      index2 = requestString.indexOf(' ', index1 + 1);
      if (index2 > index1)
        return requestString.substring(index1 + 1, index2);
    }
    return null;
  }
```
其实就是获取两个空格之间的部分（去掉开头的斜杠）：`GET /puppylpg HTTP/1.1`，这里路径就是`puppylpg`。

## servlet容器处理http响应
ServletResponse里有一个`getWriter`方法：
```
PrintWriter getWriter() throws IOException;
```
Java doc:

> Returns a PrintWriter object that can send character text to the client. The PrintWriter uses the character encoding returned by getCharacterEncoding. If the response's character encoding has not been specified as described in getCharacterEncoding (i.e., the method just returns the default value ISO-8859-1), getWriter updates it to ISO-8859-1.
Calling flush() on the PrintWriter commits the response.
Either this method or getOutputStream may be called to write the body, not both.

**往这个里面写，就是在往http客户端写数据流**。

所以，servlet程序猿只需要在写servlet的时候，调用`ServletResponse#getWriter`，就可以写返回内容了。

这也就意味着，servlet容器（tomcat）的任务就是在创建ServletResponse的时候，**让`ServletResponse#getWriter`方法返回包装有Socket的OutputStream的PrintWriter**。

> 上面的javadoc还提到了ServletResponse的另一个方法`ServletOutputStream getOutputStream() throws IOException`，效果类似，只不过把socket的OutputStream封装成了一个ServletOutputStream。

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

ServletProcessor的主要作用就是将uri作为类名，**从webroot文件夹下** 加载servlet类的字节码，并调用其service方法，传入的是之前创建的ServletRequest和ServletResponse：
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
webroot是什么？是作者自定义的一个工程下的名为webroot的文件夹：
```
public static final String WEB_ROOT = System.getProperty("user.dir") + File.separator  + "webroot";
```
**它里面放置了程序猿提前写好并编译过的servlet的.class文件**。真正的tomcat也是有一个类似的约定好的放置servlet的地方的，我们就把写好的servlet放在那里。

**所以servlet容器并不创建servlet类，只需要能找到servlet类所在的位置，需要用它的时候把它load到jvm里就行了**。

# `javax.servlet.http.HttpServlet`：处理http的servlet
Servlet可以和任何cs模型的协议通信，但显然最经常用的就是http协议。**所以Servlet的一个最火的实现类就是HttpServlet，用于处理http请求**。

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

# Tomcat里的Facade
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

# 前后端进化史
有了servlet容器，现在处理http请求就方便多了：写个servlet就行了。

## 刀耕火种：在servlet里写html
servlet主要处理http请求，而http主要返回的是html网页。所以写http servlet最经常干的一个很麻烦的事情就是：**在servlet里手撸html的代码，即在Java代码里手写html代码**，很丑很麻烦：
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

## JSP：动态页面
为了解决代码里嵌入html的问题，一个很朴素的思想就是：用占位符写一个可编译的html，然后动态去渲染它，生成完整的html。

JSP就是这么干的，写出来很像html，但又有类似java代码的逻辑控制语句。这些逻辑控制语句配合上一些看起来像占位符的东西：
```
<p>Counting to three:</p>
<% for (int i=1; i<4; i++) { %>
    <p>This number is <%= i %>.</p>
<% } %>
<p>OK.</p>
```
然后JSP可以被编译为servlet。这样程序猿只需要写jsp就行了，servlet自动编译生成，生成的servlet就像之前刀耕火种版手撸html的servlet一样。

JSP的编译过程：JSP引擎从磁盘中载入JSP文件，然后将它们转化为Servlet。**这种转化只是简单地将所有模板文本改用 println() 语句，并且将所有的 JSP 元素转化成 Java 代码。**

所以：JSP的出现，**java里写html变成了html里写“java”**（类似java的控制逻辑）。

## 模板引擎：专注于view，ignore servlet
jsp也有很多问题：
1. JSP最大的问题就是里面可以写任意java代码，写多了会很乱，就像在java代码里写html一样乱。这么一想，好像并没有比在java里写html好太多？
2. jsp虽然看起来像html，但并不能直接被浏览器渲染；
3. jsp和servlet规范紧耦合，所以只能用在servlet容器中；

template engine则把jsp的功能进一步进行了拆分，**只做模板渲染方面的工作**：
1. **不能在里面任意加代码**，只能通过一些标签库写一些简单的逻辑控制；
2. **它只是一个缺乏数据的模板**，所以可以被浏览器渲染，长得和填充数据后一样；
3. 它只是一套模板规范，**并不涉及servlet相关的东西**，所以应用场景更大，比如做邮件模板等。

常用的模板引擎比如thymeleaf/freemaker/velocity：
- https://en.wikipedia.org/wiki/Comparison_of_web_template_engines

正因为模板引擎制作view相关的工作（所以和servlet无关），我们又得写servlet了。不过这次写的是纯servlet，不带任何view逻辑的servlet，**然后调用模板引擎渲染数据，由他们把数据渲染为html**。

## JavaScript：前后端分离，这活由我前端包了
虽然模板引擎把渲染数据的逻辑单独摘出来了，**但是模板引擎还是在后端的，生成视图的活儿还是在后端的，最终后端返回给前端的还是一个渲染过的html**。

js的出现改变了这一点：**它是能在浏览器中运行的脚本，可以从浏览器端直接发出异步的http调用**。比如jQuery框架。

本来前端的拿手绝活就是制作页面，现在前端又可以直接发起请求从后端获取数据，那前端自己写个模板，不就可以做渲染数据的活了！**这样一来，数据直接在前端组装、渲染就行了**！基于此，渲染数据的活从后端挪到了前端。

现在后端只需要返回数据就行了！所以restful接口现在在后端很流行——通过json或xml返回纯数据。这些接口由前端使用js调用。

**后端终于可以专注于数据处理，不用再考虑以什么样子展示出来了**！这样就真正做到了前后端分离！对后端简直是一大解脱！

> 前提是要有前端同学。否则还是要自己使用模板引擎写模板，自己渲染成html，然后陷入头疼的页面细节调整……所以后端同学一定要对前端好一点！

前后端分离：渲染的活儿终于全都交给了前端，后端不用考虑页面的样子了。

