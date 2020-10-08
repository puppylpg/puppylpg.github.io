---
layout: post
title: "（四）How Tomcat Works - Tomcat servlet容器Container"
date: 2020-10-08 12:08:33 +0800
categories: Tomcat Http web servlet
tags: Tomcat Http web servlet
---

Tomcat的servlet容器部分主要就是处理servlet相关内容：
1. 加载servlet，调用servlet的service方法处理请求；
2. 填充response响应，作为返回给web client的内容；

以上是servlet容器所做的核心内容。但作为一个成熟的servlet容器，Tomcat做出了更细致的架构划分，使得Tomcat的servlet容器更加强大，当然也会更加复杂。

1. Table of Contents, ordered
{:toc}

# `org.apache.catalina.Container`
Tomcat的servlet容器必须实现的接口。

## 层次
Container在Tomcat里细分为了四种角色，引入四个Container的子接口：
- Engine：整个Cataline servlet引擎；
- Host：包含多个Context容器的虚拟主机；
- Context：一个Web应用，包含多个Wrapper；
- Wrapper：一个独立的servlet；

他们都是容器Container，层层包含，上级Container可以有子Container。**Wrapper代表最基础的servlet，所以不能再含有子容器；Engine作为顶级Container，不能再有父容器**。Container的addChild/removeChild/findChild方法对Wrapper不适用，直接抛出异常。

既然Container可以包含子Container，比如一个Context能够包含多个Wrapper，那么**一个请求应该用哪个Wrapper去处理**？Tomcat4的Container有一个map方法，根据请求的内容获取一个子Container，即使用对应的Wrapper去处理对应的请求。

上回说到，HttpProcessor处理http请求后，会处理请求。处理的方式是：**获取HttpConnector里的Container，调用Container的invoke方法**。所以Container要有invoke方法。

另外Container里支持一堆组件，比如loader、logger、manager、realm、resource。**就像Connector关联Container一样，所谓“关联”，就是Container里包含这些对象，有一堆关于这些对象的get/set方法**。比如getLoader/setLoader。

## 顺序
在调用servlet时，Tomcat设计了Pipeline接口，用于保证一连串链式调用。

Pipeline接口有一个基础Valve，除此之外可以添加许多自定义的Valve，调用servlet的时候，先调用自定义valve，最后调用basic value。valve就像pipeline里的过滤器，如果某一个valve不允许请求通过（比如权限认证valve），就结束了。

伪代码：
```
for valve in valves:
    valve.invoke
    
basicValve.invoke
```
所以Pipeline接口很清晰，都是和value以及basic valve关联的方法：
```
public interface Pipeline {

    public Valve getBasic();

    public void setBasic(Valve valve);

    public void addValve(Valve valve);

    public Valve[] getValves();

    public void invoke(Request request, Response response) throws IOException, ServletException;

    public void removeValve(Valve valve);
}
```

# `org.apache.catalina.Context`
Context包含Wrapper，很重要的一个功能就是根据request找到一个合适的servlet（Wrapper）。

Context的addServletMapping方法，**将一个url和一个servlet相关联**：
```
    /**
     * Add a new servlet mapping, replacing any existing mapping for
     * the specified pattern.
     *
     * @param pattern URL pattern to be mapped
     * @param name Name of the corresponding servlet to execute
     */
    public void addServletMapping(String pattern, String name);
```

map方法（在父接口Container里）实现了根据request寻找servlet的功能：
```
    /**
     * Return the child Container that should be used to process this Request,
     * based upon its characteristics.  If no such child Container can be
     * identified, return <code>null</code> instead.
     *
     * @param request Request being processed
     * @param update Update the Request to reflect the mapping selection?
     */
    public Container map(Request request, boolean update);
```
寻找的过程一般依赖于一个Mapper，所以Container里还有一个addMapper方法：
```
    /**
     * Add the specified Mapper associated with this Container.
     *
     * @param mapper The corresponding Mapper implementation
     *
     * @exception IllegalArgumentException if this exception is thrown by
     *  the <code>setContainer()</code> method of the Mapper
     */
    public void addMapper(Mapper mapper);
```

map功能实际就是Mapper里的map接口实现的：
```
    /**
     * Return the child Container that should be used to process this Request,
     * based upon its characteristics.  If no such child Container can be
     * identified, return <code>null</code> instead.
     *
     * @param request Request being processed
     * @param update Update the Request to reflect the mapping selection?
     */
    public Container map(Request request, boolean update);
```

看一个简化版的Context里的Mapper实现的map方法：
```
  public Container map(Request request, boolean update) {
    // Identify the context-relative URI to be mapped
    String contextPath =
      ((HttpServletRequest) request.getRequest()).getContextPath();
    String requestURI = ((HttpRequest) request).getDecodedRequestURI();
    String relativeURI = requestURI.substring(contextPath.length());
    // Apply the standard request URI mapping rules from the specification
    Wrapper wrapper = null;
    String servletPath = relativeURI;
    String pathInfo = null;
    String name = context.findServletMapping(relativeURI);
    if (name != null)
      wrapper = (Wrapper) context.findChild(name);
    return (wrapper);
  }
```
1. 获取request的uri；
2. 根据servlet mapping，找到uri对应的servlet name；
3. 根据servlet name，找到servlet（Wrapper）；

> uri和Servlet类名通过servlet name进行对应，**所以uri和servlet类名并不需要有直接关系，二者解耦**。

# `org.apache.catalina.Wrapper`
Wrapper代表一个servlet，要负责管理servlet，最重要的方法是：
- `allocate`：实例化一个Servlet对象，之后就可以调用它的service方法提供服务了；

Wrapper还有一个方法很重要：
- `setServletClass(String)`：**设置该Wrapper代表的servlet的类名。之后要根据这个类名加载servlet类，实例化servlet**；

看一个简化版的allocate实现：
```
  public Servlet allocate() throws ServletException {
    // Load and initialize our instance if necessary
    if (instance==null) {
      try {
        instance = loadServlet();
      }
      catch (ServletException e) {
        throw e;
      }
      catch (Throwable e) {
        throw new ServletException("Cannot allocate a servlet instance", e);
      }
    }
    return instance;
  }

  private Servlet loadServlet() throws ServletException {
    if (instance!=null)
      return instance;

    Servlet servlet = null;
    String actualClass = servletClass;
    if (actualClass == null) {
      throw new ServletException("servlet class has not been specified");
    }

    Loader loader = getLoader();
    // Acquire an instance of the class loader to be used
    if (loader==null) {
      throw new ServletException("No loader.");
    }
    ClassLoader classLoader = loader.getClassLoader();

    // Load the specified servlet class from the appropriate class loader
    Class classClass = null;
    try {
      if (classLoader!=null) {
        classClass = classLoader.loadClass(actualClass);
      }
    }
    catch (ClassNotFoundException e) {
      throw new ServletException("Servlet class not found");
    }
    // Instantiate and initialize an instance of the servlet class itself
    try {
      servlet = (Servlet) classClass.newInstance();
    }
    catch (Throwable e) {
      throw new ServletException("Failed to instantiate servlet");
    }

    // Call the initialization method of this servlet
    try {
      servlet.init(null);
    }
    catch (Throwable f) {
      throw new ServletException("Failed initialize servlet.");
    }
    return servlet;
  }
```
根据servlet的类名，加载并实例化servlet，然后调用servlet的init初始化该servlet。

# 单servlet的servlet容器——仅使用Wrapper
server启动connector，同时将connector和wrapper关联起来。wrapper添加两个简单的valve，做一些header、ip相关的事情：
```
public final class Bootstrap1 {
  public static void main(String[] args) {

/* call by using http://localhost:8080/ModernServlet,
   but could be invoked by any name */

    HttpConnector connector = new HttpConnector();
    Wrapper wrapper = new SimpleWrapper();
    wrapper.setServletClass("ModernServlet");
    Loader loader = new SimpleLoader();
    Valve valve1 = new HeaderLoggerValve();
    Valve valve2 = new ClientIPLoggerValve();

    wrapper.setLoader(loader);
    ((Pipeline) wrapper).addValve(valve1);
    ((Pipeline) wrapper).addValve(valve2);

    connector.setContainer(wrapper);

    try {
      connector.initialize();
      connector.start();

      // make the application wait until we press a key.
      System.in.read();
    }
    catch (Exception e) {
      e.printStackTrace();
    }
  }
}
```

> 使用`System.in.read()` block main thread真的是编程鬼才！正常应该用`Thread#join`，让主线程等待。

Wrapper内含一个pipeline，添加valve就是添加到pipeline里。那么basic valve在哪儿？
```
  public SimpleWrapper() {
    pipeline.setBasic(new SimpleWrapperValve());
  }
```
创建SimpleWrapper实例的时候，会直接创建一个SimpleWrapperValve作为basic valve。

wrapper作为一个container，它的invoke实现就是使用pipeline处理request/response：
```
  public void invoke(Request request, Response response)
    throws IOException, ServletException {
    pipeline.invoke(request, response);
  }
```
pipeline的invoke实现就是上面的伪代码那样，依次调用每一个valve，最后调用basic valve。

**basic valve是要负责加载servlet并调用service方法的**，所以它的invoke实现为：
```
  public void invoke(Request request, Response response, ValveContext valveContext)
    throws IOException, ServletException {

    SimpleWrapper wrapper = (SimpleWrapper) getContainer();
    ServletRequest sreq = request.getRequest();
    ServletResponse sres = response.getResponse();
    Servlet servlet = null;
    HttpServletRequest hreq = null;
    if (sreq instanceof HttpServletRequest)
      hreq = (HttpServletRequest) sreq;
    HttpServletResponse hres = null;
    if (sres instanceof HttpServletResponse)
      hres = (HttpServletResponse) sres;

    // Allocate a servlet instance to process this request
    try {
      servlet = wrapper.allocate();
      if (hres!=null && hreq!=null) {
        servlet.service(hreq, hres);
      }
      else {
        servlet.service(sreq, sres);
      }
    }
    catch (ServletException e) {
    }
  }
```
之前说过，**Wrapper的allocate负责实例化一个servlet**，所以basic valve调用了`Wrapper#allocate`，获取一个servlet，然后调用service方法。

# 多servlet的servlet容器——使用Context
相比只有一个servlet的servlet容器，多个servlet才是更常见的场景，需要使用Context将多个Wrapper管理起来：
```
public final class Bootstrap2 {
  public static void main(String[] args) {
    HttpConnector connector = new HttpConnector();
    Wrapper wrapper1 = new SimpleWrapper();
    wrapper1.setName("Primitive");
    wrapper1.setServletClass("PrimitiveServlet");
    Wrapper wrapper2 = new SimpleWrapper();
    wrapper2.setName("Modern");
    wrapper2.setServletClass("ModernServlet");

    Context context = new SimpleContext();
    context.addChild(wrapper1);
    context.addChild(wrapper2);

    Valve valve1 = new HeaderLoggerValve();
    Valve valve2 = new ClientIPLoggerValve();

    ((Pipeline) context).addValve(valve1);
    ((Pipeline) context).addValve(valve2);

    Mapper mapper = new SimpleContextMapper();
    mapper.setProtocol("http");
    context.addMapper(mapper);
    Loader loader = new SimpleLoader();
    context.setLoader(loader);
    // context.addServletMapping(pattern, name);
    context.addServletMapping("/Primitive", "Primitive");
    context.addServletMapping("/Modern", "Modern");
    connector.setContainer(context);
    try {
      connector.initialize();
      connector.start();

      // make the application wait until we press a key.
      System.in.read();
    }
    catch (Exception e) {
      e.printStackTrace();
    }
  }
}
```
此时和connector关联的container是Context。

**和单servlet相比，最大的变化无疑就是mapper**：url和servlet名称的映射。这个映射由Context管理，比如将"/Primitive"和名为"Primitive"的servlet关联起来（wrapper1），它的servlet class为"PrimitiveServlet"。

Context的invoke也是交由它的pipeline实现的，**它的basic valve只负责找到Wrapper，Wrapper要做的事情由Wrapper自己去处理**：
```
  public void invoke(Request request, Response response, ValveContext valveContext)
    throws IOException, ServletException {
    // Validate the request and response object types
    if (!(request.getRequest() instanceof HttpServletRequest) ||
      !(response.getResponse() instanceof HttpServletResponse)) {
      return;     // NOTE - Not much else we can do generically
    }

    // Disallow any direct access to resources under WEB-INF or META-INF
    HttpServletRequest hreq = (HttpServletRequest) request.getRequest();
    String contextPath = hreq.getContextPath();
    String requestURI = ((HttpRequest) request).getDecodedRequestURI();
    String relativeURI =
      requestURI.substring(contextPath.length()).toUpperCase();

    Context context = (Context) getContainer();
    // Select the Wrapper to be used for this Request
    Wrapper wrapper = null;
    try {
      wrapper = (Wrapper) context.map(request, true);
    }
    catch (IllegalArgumentException e) {
      badRequest(requestURI, (HttpServletResponse) response.getResponse());
      return;
    }
    if (wrapper == null) {
      notFound(requestURI, (HttpServletResponse) response.getResponse());
      return;
    }
    // Ask this Wrapper to process this Request
    response.setContext(context);
    wrapper.invoke(request, response);
  }
```
所以Tomcat将Container分层的好处就显示出来了：
- Context通过自己的pipeline的basic valve，寻找到request对应的Wrapper；
- Wrapper通过自己的pipeline的basic valve，加载servlet并提供服务；

流程：Context -> Context's pipeline -> Context's basic valve -> find Wrapper -> Wrapper's pipeline -> Wrapper's basic valve -> init servlet, service

**Tomcat的父子组件都有相互指向的指针，所以给人的感觉就像一棵树。**

# `org.apache.catalina.Host` & `org.apache.catalina.Engine`
和Context几乎是镜像的流程。

**Context可以`setPath`，作为web application的context path，Host可以`setAppBase`，作为application的root path**。

比如：
```
    Wrapper wrapper1 = new StandardWrapper();
    wrapper1.setName("Primitive");
    wrapper1.setServletClass("PrimitiveServlet");
    Wrapper wrapper2 = new StandardWrapper();
    wrapper2.setName("Modern");
    wrapper2.setServletClass("ModernServlet");

    Context context = new StandardContext();
    // StandardContext's start method adds a default mapper
    context.setPath("/app1");
    context.setDocBase("app1");

    context.addChild(wrapper1);
    context.addChild(wrapper2);

    Host host = new StandardHost();
    host.addChild(context);
    host.setName("localhost");
    host.setAppBase("webapps");
    
    context.addServletMapping("/Primitive", "Primitive");
    context.addServletMapping("/Modern", "Modern");
```
此时整个web app的路径是当前working directory的`webapps`，该context的路径是`webapps/app1`，web.xml应该在`webapps/app1/WEB-INF/web.xml`，servlet应该在`webapps/app1/WEB-INF/classes`，lib应该在`webapps/app1/WEB-INF/lib`。

Context接口里有map方法，根据uri找到对应的Wrapper的name，再通过name找到Wrapper。Host接口也有map方法，也是根据uri找到对应的Context的name，最后通过name找到Context。不过有两点不同：
1. `Context#setPath`会同时设置name为同一个值，比如/app1；
2. Host按照uri找不到Context的name，会扔掉最后的slash后的内容，继续找，直到找到Context或者uri全扔完了为止。

启动时启动connector和host就行了：
```
    connector.setContainer(host);
    connector.initialize();
    ((Lifecycle) connector).start();
    ((Lifecycle) host).start();
```



Engine则不存在path了，启动时启动connector和engine：
```
    Engine engine = new StandardEngine();
    engine.addChild(host);
    engine.setDefaultHost("localhost");

    connector.setContainer(engine);
    connector.initialize();
    ((Lifecycle) connector).start();
    ((Lifecycle) engine).start();
```

