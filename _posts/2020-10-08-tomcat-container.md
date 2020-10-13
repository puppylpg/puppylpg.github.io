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

# Container: `org.apache.catalina.Container`
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

# Context: `org.apache.catalina.Context`
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

# Wrapper: `org.apache.catalina.Wrapper`
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

# Host: `org.apache.catalina.Host`
和Context几乎是镜像的流程。

## app base & doc base
Context可以`setDocBase`，作为web application的context path，Host可以`setAppBase`，作为application的root path。

这些path指定了从哪里加载应用。

在正式Tomcat部署时，app base默认是`webapps`，context的doc base就是应用所在的文件夹名称。这些都配置在Tomcat的`conf/server.xml`里。app是程序猿自己写的，配置也由程序猿决定，一般配置在`webapps/<app>/WEB-INF/web.xml`。

# 根据uri匹配Context和Wrapper
Host找Context，Context找Wrapper，都是根据uri去找的。

## 匹配Host
Context有个setPath，实际实现就是在为Context设置名称setName。因为Host在按照uri匹配Context的时候，是**按照uri和Context的名字做匹配的**。

详见`StandardHostMapper#map`匹配时调用的`StandardHost#map`：
```
        Context context = null;
        String mapuri = uri;
        while (true) {
            context = (Context) findChild(mapuri);
            if (context != null)
                break;
            int slash = mapuri.lastIndexOf('/');
            if (slash < 0)
                break;
            mapuri = mapuri.substring(0, slash);
        }

        // If no Context matches, select the default Context
        if (context == null) {
            if (debug > 1)
                log("  Trying the default context");
            context = (Context) findChild("");
        }

        // Complain if no Context has been selected
        if (context == null) {
            log(sm.getString("standardHost.mappingError", uri));
            return (null);
        }
```
1. 先将整个uri和Context的名字匹配，看能不能找到Context；
2. 找不到就去掉当前最后一个slash后的部分，继续匹配，找不到继续删，直到uri删没了，或者找到了；
3. 找到就返回Context，找不到就返回默认Context（名称为空的Context），没有默认则返回null；

比如一个`a/b/c/hello`的请求，hello作为servlet name用于在Context里匹配Wrapper，`a/b/c`去匹配Context。匹不到就用`a/b`，再匹不到就用`a`，还不行看看有没有名为空`""`的Context。

但是，**假设Context名为a，Wrapper名为hello，一个请求uri为`a/b/c/hello`，它可以匹配到默认的Context，却匹配不到Wrapper**，因为**uri里刨掉Context path `a`，剩下的`b/c/hello`全用于servlet匹配**。具体实现分为两部分：

首先，Host在为Request匹配到Context后，**会将Request和Context关联，同时会将Context的path设置到Request里**。详见`StandardHostMapper#map`：
```
        // Perform mapping on our request URI
        String uri = ((HttpRequest) request).getDecodedRequestURI();
        Context context = host.map(uri);

        // Update the request (if requested) and return the selected Context
        if (update) {
            request.setContext(context);
            if (context != null)
                ((HttpRequest) request).setContextPath(context.getPath());
            else
                ((HttpRequest) request).setContextPath(null);
        }
        return (context);
```

## 匹配servlet
第二部分实现在匹配Wrapper时。

匹配servlet，就是**整个uri去掉context path后和Wrapper的mapping做匹配（通过`Context#addServletMapping`添加的），找到mapping后，再找mapping对应的Wrapper name**。详见`StandardContextMapper#map`：
```
    public Container map(Request request, boolean update) {


        int debug = context.getDebug();

        // Has this request already been mapped?
        if (update && (request.getWrapper() != null))
            return (request.getWrapper());

        // Identify the context-relative URI to be mapped
        String contextPath =
            ((HttpServletRequest) request.getRequest()).getContextPath();
        String requestURI = ((HttpRequest) request).getDecodedRequestURI();
        String relativeURI = requestURI.substring(contextPath.length());


        if (debug >= 1)
            context.log("Mapping contextPath='" + contextPath +
                        "' with requestURI='" + requestURI +
                        "' and relativeURI='" + relativeURI + "'");

        // Apply the standard request URI mapping rules from the specification
        Wrapper wrapper = null;
        String servletPath = relativeURI;
        String pathInfo = null;
        String name = null;

        // Rule 1 -- Exact Match
        if (wrapper == null) {
            if (debug >= 2)
                context.log("  Trying exact match");
            if (!(relativeURI.equals("/")))
                name = context.findServletMapping(relativeURI);
            if (name != null)
                wrapper = (Wrapper) context.findChild(name);
            if (wrapper != null) {
                servletPath = relativeURI;
                pathInfo = null;
            }
        }

        // Rule 2 -- Prefix Match
        if (wrapper == null) {
            if (debug >= 2)
                context.log("  Trying prefix match");
            servletPath = relativeURI;
            while (true) {
                name = context.findServletMapping(servletPath + "/*");
                if (name != null)
                    wrapper = (Wrapper) context.findChild(name);
                if (wrapper != null) {
                    pathInfo = relativeURI.substring(servletPath.length());
                    if (pathInfo.length() == 0)
                        pathInfo = null;
                    break;
                }
                int slash = servletPath.lastIndexOf('/');
                if (slash < 0)
                    break;
                servletPath = servletPath.substring(0, slash);
            }
        }

        // Rule 3 -- Extension Match
        if (wrapper == null) {
            if (debug >= 2)
                context.log("  Trying extension match");
            int slash = relativeURI.lastIndexOf('/');
            if (slash >= 0) {
                String last = relativeURI.substring(slash);
                int period = last.lastIndexOf('.');
                if (period >= 0) {
                    String pattern = "*" + last.substring(period);
                    name = context.findServletMapping(pattern);
                    if (name != null)
                        wrapper = (Wrapper) context.findChild(name);
                    if (wrapper != null) {
                        servletPath = relativeURI;
                        pathInfo = null;
                    }
                }
            }
        }

        // Rule 4 -- Default Match
        if (wrapper == null) {
            if (debug >= 2)
                context.log("  Trying default match");
            name = context.findServletMapping("/");
            if (name != null)
                wrapper = (Wrapper) context.findChild(name);
            if (wrapper != null) {
                servletPath = relativeURI;
                pathInfo = null;
            }
        }

        // Update the Request (if requested) and return this Wrapper
        if ((debug >= 1) && (wrapper != null))
            context.log(" Mapped to servlet '" + wrapper.getName() +
                        "' with servlet path '" + servletPath +
                        "' and path info '" + pathInfo +
                        "' and update=" + update);
        if (update) {
            request.setWrapper(wrapper);
            ((HttpRequest) request).setServletPath(servletPath);
            ((HttpRequest) request).setPathInfo(pathInfo);
        }
        return (wrapper);

    }
```
1. 首先url去掉context path后，剩下的用来匹配servlet；
2. 先直接匹配；
3. 再像Host匹配Context一样，使用前缀路径匹配，即扔最后一个slash后的内容；
4. 再拓展匹配，拓展名去匹配，比如`*.jsp`；
5. 最后默认匹配，即mapping为`/`的servlet；
6. 找到就把servlet和request绑定起来，毕竟匹配流程挺麻烦的；

所以对于匹配servlet，**精确匹配 > 前缀路径匹配 > 拓展名匹配 > 默认servlet**。

匹配都是匹配mapping，再根据mapping找Wrapper的name。

**匹配时，query string不会被当作uri的一部分。**

> Host匹配Context用的是url找Context name，也就是Context的path。Context匹配Wrapper用的是url找Context的mapping，再根据mapping找Wrapper name。

## servlet配置实例
仅为Context中Wrapper和uri的匹配设置，和Host匹配Context无关。

精确匹配：
```
<servlet-mapping>
    <servlet-name>MyServlet</servlet-name>
    <url-pattern>/puppy/detail.html</url-pattern>
    <url-pattern>/demo.html</url-pattern>
    <url-pattern>/table</url-pattern>
</servlet-mapping>
```

路径匹配
```
<servlet-mapping>
    <servlet-name>MyServlet</servlet-name>
    <url-pattern>/user/*</url-pattern>
</servlet-mapping>
```

后缀匹配：
```
<servlet-mapping>
    <servlet-name>MyServlet</servlet-name>
    <url-pattern>*.jsp</url-pattern>
    <url-pattern>*.action</url-pattern>
</servlet-mapping>
```

# 带Host的servlet容器
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
此时所有的web app从`webapps`下加载，该context（app）的路径是`webapps/app1`，web.xml应该在`webapps/app1/WEB-INF/web.xml`，servlet应该在`webapps/app1/WEB-INF/classes`，lib应该在`webapps/app1/WEB-INF/lib`。

Context接口里有map方法，根据uri找到对应的Wrapper的name，再通过name找到Wrapper。Host接口也有map方法，也是根据uri找到对应的Context的name，最后通过name找到Context。不过有两点不同：
1. `Context#setPath`会同时设置name为同一个值，比如/app1；
2. Host按照uri找不到Context的name，会扔掉最后一个slash后的内容，继续找，直到找到Context或者uri全扔完了为止。

启动时启动connector和host就行了：
```
    connector.setContainer(host);
    connector.initialize();
    ((Lifecycle) connector).start();
    ((Lifecycle) host).start();
```

# Engine: `org.apache.catalina.Engine`
Engine包含一个或多个Host。所以Engine也有找Host的过程。

Engine匹配Host和uri无关，使用的是request的serverName。

> 在`javax.servlet.ServletRequest`中有`String getServerName()`方法。

Engine匹配Host是用server name和host的name匹配。

> 实际上每一级的Container的mapper都用到了Container本身的`findChild`方法，每个Container的该方法都使用了`ContainerBase#findChild`这一默认实现，所以findChild时都是和Container的name去匹配。Context找Wrapper之所以用到了mapping，实际是在findChild前加了一层mapping。实际找到mapping之后，还是使用findChild找mapping对应的Wrapper。

Engine也有默认匹配的server，一般设置为localhost。参考`StandardEngineMapper#map`实现：
```
    public Container map(Request request, boolean update) {

        int debug = engine.getDebug();

        // Extract the requested server name
        String server = request.getRequest().getServerName();
        if (server == null) {
            server = engine.getDefaultHost();
            if (update)
                request.setServerName(server);
        }
        if (server == null)
            return (null);
        server = server.toLowerCase();
        if (debug >= 1)
            engine.log("Mapping server name '" + server + "'");

        // Find the matching child Host directly
        if (debug >= 2)
            engine.log(" Trying a direct match");
        Host host = (Host) engine.findChild(server);

        // Find a matching Host by alias.  FIXME - Optimize this!
        if (host == null) {
            if (debug >= 2)
                engine.log(" Trying an alias match");
            Container children[] = engine.findChildren();
            for (int i = 0; i < children.length; i++) {
                String aliases[] = ((Host) children[i]).findAliases();
                for (int j = 0; j < aliases.length; j++) {
                    if (server.equals(aliases[j])) {
                        host = (Host) children[i];
                        break;
                    }
                }
                if (host != null)
                    break;
            }
        }

        // Trying the "default" host if any
        if (host == null) {
            if (debug >= 2)
                engine.log(" Trying the default host");
            host = (Host) engine.findChild(engine.getDefaultHost());
        }

        // Update the Request if requested, and return the selected Host
        ;       // No update to the Request is required
        return (host);

    }
```
1. 如果request没有server name，给它设置成默认host的地址，它至少一定能匹配上默认host；
2. 如果request有server name，看哪个host name和server name相匹配；
3. 那些有server name有又没找到host的request，试试他们的server name是不是哪个host的alias。因为没有设置alias倒排，所以要遍历所有host查询；
4. 还没找到host？得嘞，您就用默认的host吧。

# 带Engine的servlet容器
启动时启动connector和engine：
```
    Host host = new StandardHost();
    host.addChild(context);
    host.setName("localhost");
    host.setAppBase("webapps");
    
    Engine engine = new StandardEngine();
    engine.addChild(host);
    engine.setDefaultHost("localhost");

    connector.setContainer(engine);
    connector.initialize();
    ((Lifecycle) connector).start();
    ((Lifecycle) engine).start();
```
这里Engine的默认Host地址设置的是localhost，唯一的一个Host的name设置的也是localhost。所以这个Host就是默认host。

