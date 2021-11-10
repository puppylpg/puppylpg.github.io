---
layout: post
title: "连接服务器上的jmx"
date: 2021-11-10日20:06:19 +0800
categories: JMX
tags: JMX
---

在有公网ip的服务器上，部署一个Java服务，开启jmx端口，但是却不能通过公网ip访问。为什么呢？

1. Table of Contents, ordered
{:toc}

# 方法一：java.rmi.server.hostname
查到的第一种解决方式：使用`java.rmi.server.hostname`参数手动绑定到外网ip：
- https://docs.oracle.com/javase/8/docs/technotes/guides/rmi/javarmiproperties.html
- https://stackoverflow.com/a/11988590/7676237
- https://stackoverflow.com/a/39345042/7676237

即：
```
-Djava.rmi.server.hostname=<external ip>
```

# 方法二：修改hostname为外网ip
远程访问，就是得设定hostname：
- https://segmentfault.com/a/1190000016636787
- https://www.mscharhag.com/java/java-rmi-things-to-remember

一整篇都在讨论这个问题，我猜是
- https://stackoverflow.com/questions/834581/remote-jmx-connection/11654322

按照这个人说的把hostname改成ip而非loop ip后，无需再指定`java.rmi.server.hostname`参数也能远程访问jmx：
- https://stackoverflow.com/a/27245447/7676237

修改hostname为ip：
```
sudo hostname <external ip>
```

所以猜想：其实jmx默认是绑定到hostname上的。所以要么让hostname是外网可用的ip，要么让jmx不绑定到默认的hostname上，使用参数手动指定一个。


