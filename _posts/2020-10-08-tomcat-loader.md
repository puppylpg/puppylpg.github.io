---
layout: post
title: "（六）How Tomcat Works - Tomcat Loader"
date: 2020-10-08 15:12:34 +0800
categories: Tomcat Http web classloader
tags: Tomcat Http web classloader
---

Tomcat是一个servlet容器，要载入程序猿开发的servlet才能使用servlet的功能。servlet类的载入本质上使用的是jdk提供的ClassLoader，但是Tomcat很有必要制定一套自己的Loader，在load servlet class时制定一些规则。

1. Table of Contents, ordered
{:toc}

# `org.apache.catalina.Loader`
Tomcat定义自己的Loader的最大原因就是程序猿servlet不一定是健康的、无害的。Tomcat内部管理着很多servlet，如果直接用系统classloader加载一个servlet，那么这个servlet可以访问CLASSPATH下的所有的类、库。为了安全性，Tomcat只让servlet访问`WEB-INF/classes`和`WEB-INF/lib`。其他类，比如Tomcat本身的类，使用的是系统的classloader，和load servlet的classloader不是同一个，servlet便无法访问Tomcat自身的类。

```
public interface Loader {

    public ClassLoader getClassLoader();

    public Container getContainer();
    public void setContainer(Container container);

    public DefaultContext getDefaultContext();
    public void setDefaultContext(DefaultContext defaultContext);

    public boolean getDelegate();
    public void setDelegate(boolean delegate);

    public String getInfo();


    public boolean getReloadable();
    public void setReloadable(boolean reloadable);

    public void addRepository(String repository);
    public String[] findRepositories();

    /**
     * Has the internal repository associated with this Loader been modified,
     * such that the loaded classes should be reloaded?
     */
    public boolean modified();

    public void addPropertyChangeListener(PropertyChangeListener listener);
    public void removePropertyChangeListener(PropertyChangeListener listener);
}
```
Loader接口最重要的方法有：
- getClassLoader：返回一个ClassLoader，**用于加载类，是真正在加载类的时候干活的人**；
- addRepository：所谓repository，就是Loader里的ClassLoader寻找要加载的类的地方。换句话说，这就是这个ClassLoader的classpath；
- getREloadable/modified：前者表明是否支持reload，后者表明repository里的内容是不是被修改了，如果都为true，则重新加载repository里的类；

> 是否修改，首先看文件有没有增加，如果没有，再看**文件的时间戳**和上次记录的是不是一样。无需比较内容，也没法比较内容。
> 
> web.xml修改后也会reload。

## WebappLoader & WebappClassLoader
WebappLoader是Loader的实现类，它使用的ClassLoader是WebappClassLoader，URLClassLoader的子类。

WebappLoader也是一个Lifecycle组件，所以看他的start方法，做了以下几件事：
1. 创建一个ClassLoader，即WebappClassLoader；
2. 给WebappClassLoader设置repository（最终设置为WebappClassLoader的classpath）和jarPath；
3. 启动一个后台线程，周期性检查class是否变动；

**这里设置的repository就是`WEB-INF/classes`，jarPath就是`WEB-INF/lib`。和之前自定义的webroot基本是一个含义。**

> 现在终于知道servlet编译后为什么要放在`WEB-INF/classes`里了。

关于类加载，参考[Java - classloader]({% post_url 2020-09-17-classloader %})。

# 应用程序目录
Context的标准实现StandardContext支持设置path：
```
    /**
     * Set the context path for this web application.
     *
     * @param path The new context path
     */
    public void setPath(String path);
```
Loader从该目录下的`WEB-INF/classes`里寻找servlet。

Tomcat寻找应用程序目录是从`catalina.base`的目录下寻找的。一般设置为当前目录：
```
    System.setProperty("catalina.base", System.getProperty("user.dir"));
    context.setPath("/myApp");
```
此时，该Context的应用程序目录是当前working directory下的myApp，Loader会从./myApp/WEB-INF/classes下加载servlet。

