---
layout: post
title: "（九）How Tomcat Works - Tomcat Service"
date: 2020-10-09 01:51:47 +0800
categories: Tomcat Http web session
tags: Tomcat Http web session
---

之前定义完Connector和Container，直接手动分别启动二者，并使用read来阻止主线程退出，过于简陋，不能算是一个生产环境的Tomcat。至少存在三个不太好的地方：
- 手动启动Connector和Container，启动方式不够优雅；
- 关闭方式不够优雅；
- 只有一个Connector，如果有多个Connector，就可以一个处理http请求，一个处理https请求；

1. Table of Contents, ordered
{:toc}

# `org.apache.catalina.Server`
Server接口是Tomcat提供的服务器的原型。可以向里面添加`org.apache.catalina.Service`。

## 启动
StandardServer是Server的标准实现，它做的事情很单纯：init时，init所有的Service；start时，start所有的service；stop时，stop所有的service。

## 关闭
另一个方法就是await，它类似于Connector，只不过Connector等待接收8080端口上的请求，而await等待接收8050上的请求：一旦改端口收到请求，内容为"SHUTDOWN"，就关闭server，否则就一直阻塞主线程。以此达到优雅关闭的目的。

比如，可以启动另一个程序，向8050发送"SHUTDOWN"来达到关闭服务器的目的：
```
  public static void main(String[] args) {
    // the following code is taken from the Stop method of
    // the org.apache.catalina.startup.Catalina class
    int port = 8005;
    try {
      Socket socket = new Socket("127.0.0.1", port);
      OutputStream stream = socket.getOutputStream();
      String shutdown = "SHUTDOWN";
      for (int i = 0; i < shutdown.length(); i++)
        stream.write(shutdown.charAt(i));
      stream.flush();
      stream.close();
      socket.close();
      System.out.println("The server was successfully shut down.");
    }
    catch (IOException e) {
      System.out.println("Error. The server has not been started.");
    }
  }
```

# `org.apache.catalina.Service`
之前启动一个server是分别启动Connector和Container，现在只要启动Service就行了。所以Service是什么？大胆猜测，**Service就是Connector和Container的聚合体**！

实际上在Service接口里，就有addConnector和setContainer方法。由这两个方法可以知道，**一个Service可以包括多个Connector和一个Container**。

当添加一个Connector或者Container的时候，Service会将内部的Connectors和Container相互关联。

比如addConnector实现：
```
    public void addConnector(Connector connector) {

        synchronized (connectors) {
            connector.setContainer(this.container);
            connector.setService(this);
            Connector results[] = new Connector[connectors.length + 1];
            System.arraycopy(connectors, 0, results, 0, connectors.length);
            results[connectors.length] = connector;
            connectors = results;

            if (initialized) {
                try {
                    connector.initialize();
                } catch (LifecycleException e) {
                    e.printStackTrace(System.err);
                }
            }

            if (started && (connector instanceof Lifecycle)) {
                try {
                    ((Lifecycle) connector).start();
                } catch (LifecycleException e) {
                    ;
                }
            }

            // Report this property change to interested listeners
            support.firePropertyChange("connector", null, connector);
        }

    }
```
先把新的connector和container关联起来。如果container已经启动了，就把新的connector也启动。

> 当然也有removeConnector方法，无非就是先停掉connector，再从connector列表里删掉它。

setContainer考虑的事情更多一些：
```
    public void setContainer(Container container) {

        Container oldContainer = this.container;
        if ((oldContainer != null) && (oldContainer instanceof Engine))
            ((Engine) oldContainer).setService(null);
        this.container = container;
        if ((this.container != null) && (this.container instanceof Engine))
            ((Engine) this.container).setService(this);
        if (started && (this.container != null) &&
            (this.container instanceof Lifecycle)) {
            try {
                ((Lifecycle) this.container).start();
            } catch (LifecycleException e) {
                ;
            }
        }
        synchronized (connectors) {
            for (int i = 0; i < connectors.length; i++)
                connectors[i].setContainer(this.container);
        }
        if (started && (oldContainer != null) &&
            (oldContainer instanceof Lifecycle)) {
            try {
                ((Lifecycle) oldContainer).stop();
            } catch (LifecycleException e) {
                ;
            }
        }

        // Report this property change to interested listeners
        support.firePropertyChange("container", oldContainer, this.container);

    }
```
1. **只有顶级容器Engine才能和Service相关联**；
2. 所有的connector都要和新的Container相关联；
3. 如果已经启动了，要启动新的容器，关闭旧的容器；

**如果设置的Container不是顶级容器Engine会有什么结果？结果就是Service没法和该Container相关联，启动Service的时候没法启动该Container**。

StandardService是Service的标准实现，它还实现了Lifecycle接口。所以在它的start方法里，start Service里所有的connector和一个container就行了。很好理解。

# 使用Server接口，使用Service启动的servlet容器
```
public final class Bootstrap {
  public static void main(String[] args) {

    System.setProperty("catalina.base", System.getProperty("user.dir"));
    Connector connector = new HttpConnector();

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

    LifecycleListener listener = new SimpleContextConfig();
    ((Lifecycle) context).addLifecycleListener(listener);

    Host host = new StandardHost();
    host.addChild(context);
    host.setName("localhost");
    host.setAppBase("webapps");

    Loader loader = new WebappLoader();
    context.setLoader(loader);
    // context.addServletMapping(pattern, name);
    context.addServletMapping("/Primitive", "Primitive");
    context.addServletMapping("/Modern", "Modern");

    Engine engine = new StandardEngine();
    engine.addChild(host);
    engine.setDefaultHost("localhost");

    Service service = new StandardService();
    service.setName("Stand-alone Service");
    Server server = new StandardServer();
    server.addService(service);
    service.addConnector(connector);

    //StandardService class's setContainer will call all its connector's setContainer method
    service.setContainer(engine);

    // Start the new server
    if (server instanceof Lifecycle) {
      try {
        server.initialize();
        ((Lifecycle) server).start();
        server.await();
        // the program waits until the await method returns,
        // i.e. until a shutdown command is received.
      }
      catch (LifecycleException e) {
        e.printStackTrace(System.out);
      }
    }

    // Shut down the server
    if (server instanceof Lifecycle) {
      try {
        ((Lifecycle) server).stop();
      }
      catch (LifecycleException e) {
        e.printStackTrace(System.out);
      }
    }
  }
}
```
总结一下使用Server和Service的好处：
1. 一个Server里可以有多个Service，一个Service里可以有多个Connector和一个Container，所以Tomcat可以有多个Engine（因为有多个Service），每个Engine里可以有多个Connector；
2. Connector和Container交由Service，使得二者都组件化，可以随时通过Service的接口替换、增删；

