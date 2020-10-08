---
layout: post
title: "（五）How Tomcat Works - Tomcat Lifecycle"
date: 2020-10-08 14:09:52 +0800
categories: Tomcat Http web
tags: Tomcat Http web
---

servlet是有生命周期的，需要在不同的阶段调用init/destory等。同时Tomcat包含有很多组件，他们的启动必然是有先后顺序的，也是有联系的，某些组件要依次启动，不能遗漏。为了统一启动关闭这些组件，最好的办法就是给组件都加上生命周期。

1. Table of Contents, ordered
{:toc}

# `org.apache.catalina.Lifecycle`
Lifecycle是一个简单明了的接口：
```
public interface Lifecycle {

    public static final String START_EVENT = "start";
    public static final String BEFORE_START_EVENT = "before_start";
    public static final String AFTER_START_EVENT = "after_start";
    public static final String STOP_EVENT = "stop";
    public static final String BEFORE_STOP_EVENT = "before_stop";
    public static final String AFTER_STOP_EVENT = "after_stop";

    public void addLifecycleListener(LifecycleListener listener);
    public LifecycleListener[] findLifecycleListeners();
    public void removeLifecycleListener(LifecycleListener listener);

    /**
     * Prepare for the beginning of active use of the public methods of this
     * component.  This method should be called before any of the public
     * methods of this component are utilized.  It should also send a
     * LifecycleEvent of type START_EVENT to any registered listeners.
     *
     * @exception LifecycleException if this component detects a fatal error
     *  that prevents this component from being used
     */
    public void start() throws LifecycleException;


    /**
     * Gracefully terminate the active use of the public methods of this
     * component.  This method should be the last one called on a given
     * instance of this component.  It should also send a LifecycleEvent
     * of type STOP_EVENT to any registered listeners.
     *
     * @exception LifecycleException if this component detects a fatal error
     *  that needs to be reported
     */
    public void stop() throws LifecycleException;
}
```
方法可以分为两部分：
1. 负责处理监听器listener的方法；
2. 负责启动停止组件的方法。

所有的组件一旦实现了Lifecycle接口，**就有了开关的功能。在调用组件所有的public方法之前，必须先调用start方法**，做一些初始化工作，同时发送启动事件。

stop同理，应该被最后调用，回收资源，同时发送关闭事件。

事件分为两组：启动前、启动、启动后，关闭前、关闭、关闭后。

# `org.apache.catalina.LifecycleListener`
Listener根据LifecycleEvent决定做哪些事情：
```
public interface LifecycleListener {

    /**
     * Acknowledge the occurrence of the specified event.
     *
     * @param event LifecycleEvent that has occurred
     */
    public void lifecycleEvent(LifecycleEvent event);
}
```
LifecycleEvent是简单的对象聚合：Lifecycle（**实现了Lifecycle接口的组件**）、event(Lifecycle接口中的plain String)、data(optional)。

# `org.apache.catalina.LifecycleSupport`
每一个实现了Lifecycle的组件，都需要能够注册listener。**最简单的方法就是使用一个list存储listener，事件发生时遍历list执行每一个listener**。

LifecycleSupport提供了list的封装，同时封装了遍历list的过程，所有实现了Lifecycle的组件只需要简单地把LifecycleSupport放入其中：
1. 注册listener的时候就调用LifecycleSupport的注册listener的方法；
2. 启动/关闭组件，需要遍历触发listener时，就使用`LifecycleSupport#fireLifecycleEvent(String type, Object data)`，LifecycleSupport会在方法里自动去遍历；

比如：
```
  protected LifecycleSupport lifecycle = new LifecycleSupport(this);

  public void addLifecycleListener(LifecycleListener listener) {
    lifecycle.addLifecycleListener(listener);
  }
```
很方便。

# 带有Lifecycle的servlet容器
**Tomcat的组件允许包含其他组件，启动/关闭父组件的时候要启动/关闭它所包含的子组件，就可以做到整个servlet容器依次被启动/关闭。**

server包含两个组件：Connector和Container。所以server只需要负责其他他的两个子组件就行了（调用他们的start方法）：
```
public final class Bootstrap {
  public static void main(String[] args) {
    Connector connector = new HttpConnector();
    Wrapper wrapper1 = new SimpleWrapper();
    wrapper1.setName("Primitive");
    wrapper1.setServletClass("PrimitiveServlet");
    Wrapper wrapper2 = new SimpleWrapper();
    wrapper2.setName("Modern");
    wrapper2.setServletClass("ModernServlet");

    Context context = new SimpleContext();
    context.addChild(wrapper1);
    context.addChild(wrapper2);

    Mapper mapper = new SimpleContextMapper();
    mapper.setProtocol("http");
    LifecycleListener listener = new SimpleContextLifecycleListener();
    ((Lifecycle) context).addLifecycleListener(listener);
    context.addMapper(mapper);
    Loader loader = new SimpleLoader();
    context.setLoader(loader);
    // context.addServletMapping(pattern, name);
    context.addServletMapping("/Primitive", "Primitive");
    context.addServletMapping("/Modern", "Modern");
    connector.setContainer(context);
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

看一下Context的start方法，它启动后都做了什么：
```
  public synchronized void start() throws LifecycleException {
    if (started)
      throw new LifecycleException("SimpleContext has already started");

    // Notify our interested LifecycleListeners
    lifecycle.fireLifecycleEvent(BEFORE_START_EVENT, null);
    started = true;
    try {
      // Start our subordinate components, if any
      if ((loader != null) && (loader instanceof Lifecycle))
        ((Lifecycle) loader).start();

      // Start our child containers, if any
      Container children[] = findChildren();
      for (int i = 0; i < children.length; i++) {
        if (children[i] instanceof Lifecycle)
          ((Lifecycle) children[i]).start();
      }

      // Start the Valves in our pipeline (including the basic),
      // if any
      if (pipeline instanceof Lifecycle)
        ((Lifecycle) pipeline).start();
      // Notify our interested LifecycleListeners
      lifecycle.fireLifecycleEvent(START_EVENT, null);
    }
    catch (Exception e) {
      e.printStackTrace();
    }

    // Notify our interested LifecycleListeners
    lifecycle.fireLifecycleEvent(AFTER_START_EVENT, null);
  }
```
1. 启动前，发送BEFORE_START_EVENT给所有的listener；
2. 启动它自己包含的子组件，比如Loader、子Container（比如Wrapper）、Pipeline；
3. 发送START_EVENT；
4. 发送AFTER_START_EVENT；

> 注意**启动组件并不是组件提供服务**。比如Pipeline，只是开启了它，做了初始化工作（它的初始化也可能不需要做啥），并不是调用了它的invoke。invoke是Connector获取socket之后交给HttpProcessor处理时才调用了Container的invoke。
> 
> **一个组件start和这个组件提供服务的方法是两码事。如果非得说有什么关系，那就是一个组件只有start之后才能提供服务。**

每一个组件就这样一连串启动起来了。

同理，stop也是类似的：
```
  public void stop() throws LifecycleException {
    if (!started)
      throw new LifecycleException("SimpleContext has not been started");
    // Notify our interested LifecycleListeners
    lifecycle.fireLifecycleEvent(BEFORE_STOP_EVENT, null);
    lifecycle.fireLifecycleEvent(STOP_EVENT, null);
    started = false;
    try {
      // Stop the Valves in our pipeline (including the basic), if any
      if (pipeline instanceof Lifecycle) {
        ((Lifecycle) pipeline).stop();
      }

      // Stop our child containers, if any
      Container children[] = findChildren();
      for (int i = 0; i < children.length; i++) {
        if (children[i] instanceof Lifecycle)
          ((Lifecycle) children[i]).stop();
      }
      if ((loader != null) && (loader instanceof Lifecycle)) {
        ((Lifecycle) loader).stop();
      }
    }
    catch (Exception e) {
      e.printStackTrace();
    }
    // Notify our interested LifecycleListeners
    lifecycle.fireLifecycleEvent(AFTER_STOP_EVENT, null);
  }
```

SimpleWrapper的stop，还调用了servlet的destory：
```
  public void stop() throws LifecycleException {
    System.out.println("Stopping wrapper " + name);
    // Shut down our servlet instance (if it has been initialized)
    try {
      instance.destroy();
    }
    catch (Throwable t) {
    }
    instance = null;
    if (!started)
      throw new LifecycleException("Wrapper " + name + " not started");
    // Notify our interested LifecycleListeners
    lifecycle.fireLifecycleEvent(BEFORE_STOP_EVENT, null);

    // Notify our interested LifecycleListeners
    lifecycle.fireLifecycleEvent(STOP_EVENT, null);
    started = false;

    // Stop the Valves in our pipeline (including the basic), if any
    if (pipeline instanceof Lifecycle) {
      ((Lifecycle) pipeline).stop();
    }

    // Stop our subordinate components, if any
    if ((loader != null) && (loader instanceof Lifecycle)) {
      ((Lifecycle) loader).stop();
    }

    // Notify our interested LifecycleListeners
    lifecycle.fireLifecycleEvent(AFTER_STOP_EVENT, null);
  }
```

