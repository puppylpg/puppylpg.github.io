---
layout: post
title: "（四）How Tomcat Works - Tomcat servlet容器Container"
date: 2020-10-08 12:08:33 +0800
categories: Tomcat Http web servlet
tags: Tomcat Http web servlet
---

上一节讲了半天，经历了“client request -> server http connector -> processor -> parse http request”，终于才提到“使用servlet处理请求”。

而处理请求的代码就两行——使用container处理请求：
```
                ((HttpServletResponse) response).setHeader
                    ("Date", FastHttpDateFormat.getCurrentDate());
                if (ok) {
                    connector.getContainer().invoke(request, response);
                }
```
> 这里的request和response参数是tomcat自定义的接口，不过tomcat也说了：A `Request` is the Catalina-internal facade for a ServletRequest that is to be processed, in order to produce the corresponding `Response`。所以把他们直接当做`ServletRequest`和`ServletResponse`也没啥大问题。

Tomcat的servlet容器部分的 **核心工作** 就是处理servlet相关内容：
1. 加载servlet，调用servlet的service方法处理请求；
2. 填充response响应，作为返回给web client的内容；

servlet在哪儿？被tomcat用Container接口管理起来了。

1. Table of Contents, ordered
{:toc}

# `org.apache.catalina.Container`：servlet的容器
Container是Tomcat的servlet容器必须实现的接口。

Container在Tomcat里细分为了四种角色，引入四个Container的子接口：
- Engine（yd事业部）：整个Cataline servlet引擎；
- Host（广告组）：包含多个Context容器的虚拟主机；
- Context（研发组）：一个Web应用，包含多个Wrapper；
- Wrapper（puppylpg）：一个独立的servlet；

他们都是容器Container，层层包含，上级Container可以有子Container。**Wrapper代表最基础的servlet，所以不能再含有子容器；Engine作为顶级Container，不能再有父容器**。Container的addChild/removeChild/findChild方法对Wrapper不适用，直接抛出异常。
- **addChild：很重要，container之间相互关联的方式**；
- removeChild
- findChild

既然Container可以包含子Container，比如一个Context能够包含多个Wrapper，那么**一个请求应该用哪个Wrapper去处理**？Tomcat4的Container有一个map方法，根据请求的内容获取一个子Container，即使用对应的Wrapper去处理对应的请求。

上回说到，HttpProcessor处理http请求后，会处理请求。处理的方式是：**获取HttpConnector里的Container，调用Container的invoke方法**。所以Container要有invoke方法。
- **invoke：很重要，任务执行逻辑**；

另外Container里支持一堆组件，比如loader、logger、manager、realm、resource。**就像Connector关联Container一样，所谓“关联”，就是Container里包含这些对象，有一堆关于这些对象的get/set方法**。比如getLoader/setLoader。
- getLoader
- setLoader
- ...

# 为什么Tomcat Container有这么多层级
干里凉！Tomcat为什么给Container搞了这么多层级？

看一下Tomcat默认的配置文件差不多能略知一二（windows版Tomcat 9.0.58的`/conf/server.xml`）：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- Note:  A "Server" is not itself a "Container", so you may not
     define subcomponents such as "Valves" at this level.
     Documentation at /docs/config/server.html
 -->
<Server port="8005" shutdown="SHUTDOWN">
  <Listener className="org.apache.catalina.startup.VersionLoggerListener" />
  <!-- Security listener. Documentation at /docs/config/listeners.html
  <Listener className="org.apache.catalina.security.SecurityListener" />
  -->
  <!-- APR library loader. Documentation at /docs/apr.html -->
  <Listener className="org.apache.catalina.core.AprLifecycleListener" SSLEngine="on" />
  <!-- Prevent memory leaks due to use of particular java/javax APIs-->
  <Listener className="org.apache.catalina.core.JreMemoryLeakPreventionListener" />
  <Listener className="org.apache.catalina.mbeans.GlobalResourcesLifecycleListener" />
  <Listener className="org.apache.catalina.core.ThreadLocalLeakPreventionListener" />

  <!-- Global JNDI resources
       Documentation at /docs/jndi-resources-howto.html
  -->
  <GlobalNamingResources>
    <!-- Editable user database that can also be used by
         UserDatabaseRealm to authenticate users
    -->
    <Resource name="UserDatabase" auth="Container"
              type="org.apache.catalina.UserDatabase"
              description="User database that can be updated and saved"
              factory="org.apache.catalina.users.MemoryUserDatabaseFactory"
              pathname="conf/tomcat-users.xml" />
  </GlobalNamingResources>

  <!-- A "Service" is a collection of one or more "Connectors" that share
       a single "Container" Note:  A "Service" is not itself a "Container",
       so you may not define subcomponents such as "Valves" at this level.
       Documentation at /docs/config/service.html
   -->
  <Service name="Catalina">

    <!--The connectors can use a shared executor, you can define one or more named thread pools-->
    <!--
    <Executor name="tomcatThreadPool" namePrefix="catalina-exec-"
        maxThreads="150" minSpareThreads="4"/>
    -->


    <!-- A "Connector" represents an endpoint by which requests are received
         and responses are returned. Documentation at :
         Java HTTP Connector: /docs/config/http.html
         Java AJP  Connector: /docs/config/ajp.html
         APR (HTTP/AJP) Connector: /docs/apr.html
         Define a non-SSL/TLS HTTP/1.1 Connector on port 8080
    -->
    <Connector port="8080" protocol="HTTP/1.1"
               connectionTimeout="20000"
               redirectPort="8443" />
    <!-- A "Connector" using the shared thread pool-->
    <!--
    <Connector executor="tomcatThreadPool"
               port="8080" protocol="HTTP/1.1"
               connectionTimeout="20000"
               redirectPort="8443" />
    -->
    <!--
    <Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"
               maxThreads="150" SSLEnabled="true">
        <SSLHostConfig>
            <Certificate certificateKeystoreFile="conf/localhost-rsa.jks"
                         type="RSA" />
        </SSLHostConfig>
    </Connector>
    -->
    <!--
    <Connector port="8443" protocol="org.apache.coyote.http11.Http11AprProtocol"
               maxThreads="150" SSLEnabled="true" >
        <UpgradeProtocol className="org.apache.coyote.http2.Http2Protocol" />
        <SSLHostConfig>
            <Certificate certificateKeyFile="conf/localhost-rsa-key.pem"
                         certificateFile="conf/localhost-rsa-cert.pem"
                         certificateChainFile="conf/localhost-rsa-chain.pem"
                         type="RSA" />
        </SSLHostConfig>
    </Connector>
    -->

    <!-- Define an AJP 1.3 Connector on port 8009 -->
    <!--
    <Connector protocol="AJP/1.3"
               address="::1"
               port="8009"
               redirectPort="8443" />
    -->

    <!-- An Engine represents the entry point (within Catalina) that processes
         every request.  The Engine implementation for Tomcat stand alone
         analyzes the HTTP headers included with the request, and passes them
         on to the appropriate Host (virtual host).
         Documentation at /docs/config/engine.html -->

    <!-- You should set jvmRoute to support load-balancing via AJP ie :
    <Engine name="Catalina" defaultHost="localhost" jvmRoute="jvm1">
    -->
    <Engine name="Catalina" defaultHost="localhost">

      <!--For clustering, please take a look at documentation at:
          /docs/cluster-howto.html  (simple how to)
          /docs/config/cluster.html (reference documentation) -->
      <!--
      <Cluster className="org.apache.catalina.ha.tcp.SimpleTcpCluster"/>
      -->

      <!-- Use the LockOutRealm to prevent attempts to guess user passwords
           via a brute-force attack -->
      <Realm className="org.apache.catalina.realm.LockOutRealm">
        <!-- This Realm uses the UserDatabase configured in the global JNDI
             resources under the key "UserDatabase".  Any edits
             that are performed against this UserDatabase are immediately
             available for use by the Realm.  -->
        <Realm className="org.apache.catalina.realm.UserDatabaseRealm"
               resourceName="UserDatabase"/>
      </Realm>

      <Host name="localhost"  appBase="webapps"
            unpackWARs="true" autoDeploy="true">

        <!-- SingleSignOn valve, share authentication between web applications
             Documentation at: /docs/config/valve.html -->
        <!--
        <Valve className="org.apache.catalina.authenticator.SingleSignOn" />
        -->

        <!-- Access log processes all example.
             Documentation at: /docs/config/valve.html
             Note: The pattern used is equivalent to using pattern="common" -->
        <Valve className="org.apache.catalina.valves.AccessLogValve" directory="logs"
               prefix="localhost_access_log" suffix=".txt"
               pattern="%h %l %u %t &quot;%r&quot; %s %b" />

      </Host>
    </Engine>
  </Service>
</Server>
```
把骨干标签抽出来，大致层级如下：
```
<Server>
    <Service>
        <Connector />
        <Connector />
        <Engine>
            <Host>
                <Context />
            </Host>
        </Engine>        
    </Service>
</Server>
```
可以看到，除了顶层的server和service，里面就是connector和engine（最高层级的container）。engine下面还能容纳比较低级的host container，但是不见更低级的context和wrapper container。

我们先不考虑service，把视线专注于内层的Connector和Container（也就是Engine和Host）——

## connector
Connector上一节刚介绍过。Tomcat可以配置多种connector，默认的自然是监听8080端口的http请求。但是看注释掉的配置，它还能监听其他端口，使用其他协议：
```
    <!-- A "Connector" using the shared thread pool-->
    <!--
    <Connector executor="tomcatThreadPool"
               port="8080" protocol="HTTP/1.1"
               connectionTimeout="20000"
               redirectPort="8443" />
    -->
    <!--
    <Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"
               maxThreads="150" SSLEnabled="true">
        <SSLHostConfig>
            <Certificate certificateKeystoreFile="conf/localhost-rsa.jks"
                         type="RSA" />
        </SSLHostConfig>
    </Connector>
    -->
    <!--
    <Connector port="8443" protocol="org.apache.coyote.http11.Http11AprProtocol"
               maxThreads="150" SSLEnabled="true" >
        <UpgradeProtocol className="org.apache.coyote.http2.Http2Protocol" />
        <SSLHostConfig>
            <Certificate certificateKeyFile="conf/localhost-rsa-key.pem"
                         certificateFile="conf/localhost-rsa-cert.pem"
                         certificateChainFile="conf/localhost-rsa-chain.pem"
                         type="RSA" />
        </SSLHostConfig>
    </Connector>
    -->

    <!-- Define an AJP 1.3 Connector on port 8009 -->
    <!--
    <Connector protocol="AJP/1.3"
               address="::1"
               port="8009"
               redirectPort="8443" />
    -->
```
- https协议；可以选择nio，或者apr，后者是apache搞的用于做异步io的东西。想想Tomcat4的时候用的还是bio；
- ajp协议：Apache JServ Protocol，Apache搞的；

多种connector监听到的连接请求，都可以（把socket）交给container里的servlet处理。

## engine & host
engine是Tomcat顶级的container：
```
<Engine name="Catalina" defaultHost="localhost">
```
它里面还有host：
```
<Host name="localhost"  appBase="webapps"
            unpackWARs="true" autoDeploy="true">
```
**engine收到的socket必须交给一个host处理，找不到就交给defaultHost，也就是这里配置的唯一host，一个名为localhost的host**。

> 类比一下：engine就是yd事业部，是公司的一个增长引擎:D engine收到的业务请求得交给某个组来处理。

**请求怎么和host匹配的？和nginx类似，使用ip或者http协议里的Host header**：待 Service 被选定之后，Tomcat 将在 Service 中寻找与 HTTP 请求头中指定的域名或 IP 地址匹配的 Host 来处理该请求。如果没有匹配成功，则采用 Engine 中配置的默认虚拟主机 defaultHost 来处理该请求。

host还有其他属性：
- `appBase`： 指定 Web 应用所在的目录，默认值是 webapps，**这是一个相对路径**，标识 Tomcat 安装根目录下的 webapps 文件夹；
- `unpackWARs`： 指定是否将 Web 应用的 WAR 文件解压。如果取值为 true，Tomcat 将以解压后的文件结构运行该 Web 应用；如果为 false，Tomcat 将直接使用 WAR 文件运行 Web 应用；
- `autoDeploy`： 指定是否自动部署 Web 应用；

**从unpackWARs也可以看出，host下面就是部署了一堆war包（一堆context，或者说一堆web应用）**。这下清楚了，**我们部署的war包，就是context**！

> Engine和Host都怎么配？配置文件在哪儿（`conf/server.xml`）？**详情查看Engine和Host的配置说明**：
> - Engine：https://tomcat.apache.org/tomcat-8.0-doc/config/engine.html
> - Host：https://tomcat.apache.org/tomcat-8.0-doc/config/host.html

## context - web应用/war包
**context就是一个war包，或者war展开后的文件夹**。

> 类比：context就是研发组。这个才是我这个servlet每天真正工作时一直在打交道的组织。对我来说公司其实就是这些人。所以它相对独立。war包就是这个context，就是这么独立，所以也挺相似。

但是context这个container的配置在哪儿？`conf/server.xml`里并没有配置。因为war包是我们自己部署的，所以context container也要由我们自己来设置。

那么请求如何匹配上我们的context（war包）？**根据 URI 选定 Context，URI 中的 context-path 指定了 HTTP 请求将要访问的 Web 应用**。

当请求抵达时，Tomcat 将根据 Context 的属性 path 取值与 URI 中的 context-path 的匹配程度来选择 Web 应用处理相应请求，例如：Web 应用 spring-demo 的 path 属性是”/spring-demo”，那么请求“/spring-demo/user/register”将交由 spring-demo 来处理。

**但是！Context不是在Host里配置的嘛，上面的`conf/server.xml`里怎么没见到Context标签啊？**

Context的详情配置，和放置的文件夹，查看官方文档：
- Context：https://tomcat.apache.org/tomcat-8.0-doc/config/context.html

在[Defining_a_context](https://tomcat.apache.org/tomcat-8.0-doc/config/context.html#Defining_a_context)里提到：
> It is NOT recommended to place <Context> elements directly in the server.xml file. This is because it makes modifying the Context configuration more invasive since the main conf/server.xml file cannot be reloaded without restarting Tomcat.

**所以Context的配置一般放在：`$CATALINA_BASE/conf/[enginename]/[hostname]/<app-name>.xml`里面**。

比如Debian安装的tomcat，$CATALINA_BASE=/var/lib/tomcat9，它下面的conf/Catalina/localhost/examples.xml就是examples这个app的Context配置：
```
<Context path="/examples"
         docBase="/usr/share/tomcat9-examples/examples">
  <!-- Enable symlinks for the jars linked from /usr/share/java -->
  <Resources allowLinking="true"/>
</Context>
```
- **path：也就是上面的context-path。Host使用context path匹配Context**；
- docBase：war或展开后的文件夹对应的位置，**从这个位置加载该app的文件，比如servlet .class文件**。可以是绝对路径，**也可以是他所在的host目录（appBase）的相对路径**；

**context path和url相关，docBase和url无关**！

> docBase用的是绝对路径，所以不需要放在它所在的host的目录下。

它的访问url是：http://localhost:8080/examples/

以tomcat自带的web app：examples举例——
1. examples位于tomcat的webapps下；
2. 当访问`http://localhost:8080/examples/`时，engine就把请求给到了host，host按照路径`/examples/`匹配，把请求给到了examples这个app；

Windows没有在`$CATALINA_BASE/conf/[enginename]/[hostname]/<app-name>.xml`里面配置Context。所以examples的根目录下有`web.xml`，META-INF下有`context.xml`，内容为：
```
<Context>
  <CookieProcessor className="org.apache.tomcat.util.http.Rfc6265CookieProcessor"
                   sameSiteCookies="strict" />
</Context>
```
这就是examples app配置的context。**这个context已经不需要配置path和docBase了，因为tomcat就是按照默认的path和docBase找到的它……它再配path和docBase有什么用？**

> 为什么在META-INF下？查阅：https://tomcat.apache.org/tomcat-9.0-doc/appdev/deployment.html
>
> A /META-INF/context.xml file can be used to define Tomcat specific configuration options, such as an access log, data sources, session manager configuration and more. This XML file must contain one Context element, which will be considered as if it was the child of the Host element corresponding to the Host to which the web application is being deployed. The Tomcat configuration documentation contains information on the Context element.


## container为什么要有engine/host/context这些层级？
> 从上述体系结构剖析来看，Tomcat 这款 Java Web 应用服务器的功能还是非常强大的，它可以在一个实例进程当中同时支持多种协议，同时支持多个虚拟主机，每个虚拟主机下还支持部署多款应用，具备强大的扩展性和灵活性。为什么它具备这样一种体系结构呢？

**这其实跟 Tomcat 诞生时的基础架构相匹配的，当时服务器是以小型机或 PC 服务器为主，缺乏现在容器这种切分资源的虚拟技术，进程是系统资源分配的最小单元**。

> 为了更加充分地利用每台计算机上的资源，我们通常要在同一台计算机上部署多款应用，但是在一台计算机上运行多个 Tomcat 实例所带来的复杂度是非常高的，不如在同一个 Tomcat 实例中部署多款 Web 应用，这样在配置运维等管理上面更加便利。
>
> 在这种架构下，Tomcat 处理 HTTP 请求就需要经过上述复杂的过程，这也再次印证老兵哥我坚信的一个观点：不存在绝对好或坏的架构，匹配当时业务场景的架构就是好架构！随着互联网业务的发展和云计算的兴起，为了更好地管理大规模应用集群，我们需要借助容器等虚拟化技术将大颗粒资源分割成更小的、标准的单元，每个容器中只安装一个 Web 容器，每个 Web 容器中只部署一个应用，在标装化下我们就可以采用云计算的自动化操作。
>
> 按照这个趋势发展下去，Web 容器的架构用不着这么复杂了，其价值也会不断弱化。以前，Tomcat 都是需要单独安装的，应用是后续再部署到 Tomcat 当中的。但目前在 Spring Boot 的开发模式下，Tomcat 是以 Starter 方式作为内嵌 Web 容器，它已经不再需要独立安装部署了。在越来越标装化的趋势下，Tomcat 基本上采用默认配置，用户基本上不用太关注它了。剖析了解它的原因，就是老兵哥我在开题中所说的：知其然，知其所以然。

强烈推荐：
- https://segmentfault.com/a/1190000021168133

所以按照现在springboot使用tomcat的方式，它就变成了：广告研发事业部-广告研发组-研发组-我。**现在如果springboot不设置`server.servlet.context-path`，url直接就到servlet地址了**。

## tomcat内请求处理流程
一个http请求的：
- **协议+端口号决定engine**：根据协议类型和端口号选定 Service 和 Engine：Service 下属的 Connector 组件负责监听接收特定协议和特定端口的请求。因此，当 Tomcat 启动时，Service 组件就开始监听特定的端口，如前文配置文件示例，Catalina 这个 Service 监听了 HTTP 协议 8080 端口和 AJP 协议的 8009 端口。当 HTTP 请求抵达主机网卡的特定端口之后，Tomcat 就会根据协议类型和端口号选定处理请求的 Service，随即 Engine 也就确定了。通过在 Server 中配置多个 Service，可以实现通过不同端口访问同一主机上的不同应用。
- **ip或域名决定host**：根据域名或 IP 地址选定 Host：待 Service 被选定之后，Tomcat 将在 Service 中寻找与 HTTP 请求头中指定的域名或 IP 地址匹配的 Host 来处理该请求。如果没有匹配成功，则采用 Engine 中配置的默认虚拟主机 defaultHost 来处理该请求。
- **路径决定context**：根据 URI 选定 Context：URI 中的 context-path 指定了 HTTP 请求将要访问的 Web 应用。当请求抵达时，Tomcat 将根据 Context 的属性 path 取值与 URI 中的 context-path 的匹配程度来选择 Web 应用处理相应请求，例如：Web 应用 spring-demo 的 path 属性是”/spring-demo”，那么请求“/spring-demo/user/register”将交由 spring-demo 来处理。

比如访问：http://201.187.10.21:8080/spring-demo/user/register——

1. 客户端（或浏览器）发送请求至主机（201.187.10.21）的端口 8080，被在该端口上监听的 Coyote HTTP/1.1 Connector 所接收。Connector 将该请求交给它所在 Service 的 Engine 来负责处理，并等待 Engine 的回应。
2. Engine 获得请求之后从报文头中提取主机名称（201.187.10.21），在所有虚拟主机 Host 当中寻找匹配。
3. 在未匹配到同名虚拟主机的情况下，Engine 将该请求交给名为 localhost 的默认虚拟主机 Host 处理。
4. Host 获得请求之后将根据 URI（/spring-demo/user/register）中的 context-path 的取值“/spring-demo” 去匹配它所拥有的所有 Context，将请求交给代表应用 spring-demo 的 Context 来处理。
5. Context 构建 HttpServletRequest、HttpServletResponse 对象，将其作为参数调用应用 spring-demo，由应用完成业务逻辑执行、结果数据存储等过程，等待应答数据。
6. Context 接收到应用返回的 HttpServletResponse 对象之后将其返回给 Host。
7. Host 将 HttpServletResponse 对象返回给 Engine。
8. Engine 将 HttpServletResponse 对象返回 Connector。
9. Connector 将 HttpServletResponse 对象返回给客户端（或浏览器）。

## `web.xml`
请求到了web应用（war包），再被谁处理，就是`web.xml`说了算了。

**下文的Context mapping会介绍url和servlet的映射关系！所以也可以说，`web.xml`是用来配置Context的这个映射的！**

- https://segmentfault.com/a/1190000021177809

## wrapper去哪了？
container不是有四个层级嘛，怎么只提到了engine/host/context，wrapper呢？

Wrapper就是servlet啊。Engine用ip/Host header匹配Host，Host用context path匹配Context，Context用剩下的url匹配Servlet（Wrapper），Wrapper就到底了，不需要再去匹配谁，所以不用配置Wrapper去匹配谁，只需要匹配Wrapper本身就行了。比如可以在`web.xml`中配置：
```
    <servlet>
      <servlet-name>ServletToJsp</servlet-name>
      <servlet-class>ServletToJsp</servlet-class>
    </servlet>
```

## `CATALINA_HOME`和`CATALINA_BASE`
多澄清一点：**其实Host里配置的`appBase`是相对于`CATALINA_HOME`的**！

`CATALINA_HOME`代表tomcat的安装目录。比如在windows版的tomcat目录下，我们可以看到`bin/catalina.sh`里对其设置如下：
```
# Only set CATALINA_HOME if not already set
[ -z "$CATALINA_HOME" ] && CATALINA_HOME=`cd "$PRGDIR/.." >/dev/null; pwd`
```
其实就是设为tomcat的目录。

还有一个变量叫`CATALINA_BASE`：
- https://stackoverflow.com/a/8584730/7676237

它是为了同一机器部署多个Tomcat实例而生的。所有tomcat实例可共用的部分位于`CATALINA_HOME`下，每个实例单独的部署的东西位于`CATALINA_BASE`下。当然如果只部署一个示例，则`CATALINA_BASE`默认等于`CATALINA_HOME`。

## 多Tomcat实例部署
在Windows下载Tomcat的话，tomcat是作为单体的正常形态存在的。tomcat的上述特性完全体现不出来：
```
apache-tomcat-9.0.58 $ tree -L 1
.
├── bin
├── BUILDING.txt
├── conf
├── CONTRIBUTING.md
├── lib
├── LICENSE
├── logs
├── NOTICE
├── README.md
├── RELEASE-NOTES
├── RUNNING.txt
├── temp
├── webapps
└── work

7 directories, 7 files
```
其中examples位于webapps下。

但是到了Debian上，tomcat9的结构立刻嚣张了起来……Debian上，tomcat默认就是多tomcat实例的形态。所以感觉Tomcat部署的支离破碎，令新手极其迷惑：
- `CATALINA_HOME`: `/usr/share/tomcat9`（果然`CATALINA_HOME`是共享的，位于/usr/share下……可真严谨……）
- `CATALINA_BASE`: `/var/lib/tomcat9`

`CATALINA_HOME`下只有bin和lib等可被共享的东西：
```
☁  tomcat9  pwd
/usr/share/tomcat9
☁  tomcat9  tree -L 1
.
├── bin
├── default.template
├── etc
├── lib
└── logrotate.template

3 directories, 2 files
```
> 它的`CATALINA_BASE/conf/Catalina/localhost/examples.xml`指明了examples这个web app的位置：`docBase="/usr/share/tomcat9-examples/examples"`。既不在CATALINA_HOME下，也不在CATALINA_BASE下，而是另一个独立的地方。所以Debian的tomcat就非常的支离破碎……分到了好几个不同的地方……

tomcat的官网有一个重要的文件：https://tomcat.apache.org/tomcat-9.0-doc/RUNNING.txt

它的“Advanced Configuration - Multiple Tomcat Instances”一节指明了这些概念：
- CATALINA_HOME：tomcat的安装目录，主要是tomcat的bin、lib。**即使部署多个tomcat实例，这些文件也是可以共用的，节约了空间**；
- CATALINA_BASE：部署多实例时不可共用的文件，比如webapps，每个实例都有自己管理的一堆war包，所以不能共用。所以CATALINA_BASE代表的是一个tomcat实例的部署地址；

当然CATALINA_BASE下也会有lib，**且该lib优先级高于CATALINA_HOME下的lib。不过官方建议还是把lib放到war下专属的WEB-INF/lib，它有最高优先级**。

> servlet-api.jar就在CATALINA_HOME/lib下。所以打war包的时候就不用打到WEB-INF/lib里了。
>
> 学tomcat，还是看囫囵版的吧。Debian默认装的这个太草了！

# Container的管道：container的任务执行顺序
Tomcat为Container设计了Pipeline接口，用于保证一连串链式任务的顺次调用。

**一个Container有一个Pipeline，一个Pipeline由一堆Valve组成，一个valve代表一个任务**：可添加一堆普通valve，和一个basic valve，basic在在管道的末尾执行。

> 可以把Pipeline想象成一个list，valve是上面的过滤器。如果某一个valve不允许请求通过（比如权限认证valve），就结束了。

每个valve都有invoke方法，执行pipeline可以理解为执行下面的伪代码：
```
for valve in valves:
    valve.invoke
    
basicValve.invoke
```
所以Pipeline接口很清晰，都是和valve以及basic valve关联的方法：
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
再回看connector调用container处理请求的代码：
```
                ((HttpServletResponse) response).setHeader
                    ("Date", FastHttpDateFormat.getCurrentDate());
                if (ok) {
                    connector.getContainer().invoke(request, response);
                }
```
**当connector调用container的invoke方法时，实际上是触发了container的pipeline，顺次执行了很多valve任务**。

**为什么container要添加valve？把任务拆分**。或者说添加一些不相干任务，做到任务之间解耦。

比如Wrapper这个最低级的container，它的任务是什么？
1. 实例化servlet；
2. 并调用其service方法处理request。

**那么就可以把这个任务实现到Wrapper实例的basic valve里**。在它之前，可以添加一些其他自定义valve，以实现自定义任务的执行，比如把请求的header打到log里。

再比如Context这个container，它的任务是什么？
1. 从mapping里根据uri找到对应的servlet（wrapper）；
2. **并调用wrapper的invoke方法**。

**那么就可以把这个任务实现到Context实例的basic valve里**。在它之前，可以添加一些其他自定义valve，以实现自定义任务的执行。

> 具体实例见下文的实现代码。

# 子Container
了解完上面的概念之后，再来看这些子Container的实现，就舒服多了：

## Context: `org.apache.catalina.Context`
### 任务
1. 从mapping里根据uri找到对应的servlet（wrapper）；
2. **并调用wrapper的invoke方法**。

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
1. 获取request的uri：contextPath和relativeURI；
    1. contextPath：是用来匹配context的；
    2. **relativeURI：去掉contextPath之后的URL，这个url才是用来匹配Wrapper的**；
2. 根据servlet mapping，**找到relative uri对应的servlet name**；
3. 根据servlet name，找到servlet（Wrapper）；

> uri和Servlet类名通过servlet name进行对应，**所以uri和servlet类名并不需要有直接关系，二者解耦**。

## Wrapper: `org.apache.catalina.Wrapper`
### 任务
1. 实例化servlet；
2. 并调用其service方法处理request。

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
```
加载servlet分三步：
```java
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
1. 根据servlet的类名，加载servlet .class文件；
2. 实例化servlet；
3. **调用servlet的init初始化该servlet**。

## 单servlet的servlet容器——仅使用Wrapper
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

**因为服务用的container直接是Wrapper，所以没有Engine（协议+端口）、Host（ip或host）、Context（context path）的匹配逻辑，url直接对应servlet：`http://localhost:8080/ModernServlet`**。

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

## 多servlet的servlet容器——使用Context
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

**这个服务虽然用了Context作为container，~~但因为Context没有设置context path，~~ 但因为没有Host，所以没有根据context path匹配Context的逻辑（和Context是否设置context path没有关系）**。url直接查mapping对应servlet：
- `http://localhost:8080/Primitive`
- `http://localhost:8080/Modern`

> **设置context path：`Context#setPath(String path)`**。context path可以设置为多路径的情况，比如：`context.setPath("/a/b/c/d")`。

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

## Host: `org.apache.catalina.Host`
和Context几乎是镜像的流程。

### 任务
1. 根据context path匹配Context；

### 三个路径
- app base：Host可以`setAppBase`，作为 **所有web应用** 的根目录。**默认是`<catalina home>` + webapps**；
- doc base：Context可以`setDocBase`，作为 **该web应用** 的根目录。**所以某应用的根目录是app base + doc base，即`<catalina home>` + webapps + doc base**；
- context path：Context可以`setPath`，作为Host匹配Context的依据；

**前两个path无关url，只决定加载应用的位置。context path体现在url里**。

> Context的setPath，还有一个功能：实际实现就是在为Context设置名称setName。

### 根据uri匹配Context和Wrapper
- Host找Context，用的是uri的前半段：context path；
- Context找Wrapper，**用的是uri的后半段：去掉context path的uri**。

**但问题在于，怎么知道前后半段的分界点在哪儿？二者是用哪个slash分界的？**

比如`/a/b/c/d`：
1. Tomcat默认把uri里最后一个slash前的部分当做context path：`/a/b/c`；
2. 找不到对应context就再往前找一个slash，这个slash前的部分作为context path：`/a/b`；
3. 还找不到，继续：`/a`；
3. 如果还找不到，就尝试用empty作为context path：`""`，看看有没有名为空`""`的Context。。

具体代码详见`StandardHostMapper#map`
```
    /**
     * Return the child Container that should be used to process this Request,
     * based upon its characteristics.  If no such child Container can be
     * identified, return <code>null</code> instead.
     *
     * @param request Request being processed
     * @param update Update the Request to reflect the mapping selection?
     */
    public Container map(Request request, boolean update) {
        // Has this request already been mapped?
        if (update && (request.getContext() != null))
            return (request.getContext());

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

    }
```
先说最后几行有一个非常重要的内容：**context path是设置在http request里面的！！！因为每个http request映射到的context是不同的，至于这个request是通过上述多少个slash才找到对应的context的，只有这个request知道！所以request不但会持有context container，还会存下来该request是通过那个path找到这个context的！后面在context里找映射的servlet的时候，使用的是该request的uri减去这个context path。**

其实照理说，这个request所持有的context本身就设置了path（context path），需要的时候把这个path取出来不就行了吗，为什么还要设置到`request#setContextPath`里呢？
```
    /**
     * Set the context path for this Request.  This will normally be called
     * when the associated Context is mapping the Request to a particular
     * Wrapper.
     *
     * @param path The context path
     */
    public void setContextPath(String path);
```
我觉得有两点：
1. 方便一些；
2. **当存在Host的时候，确实没必要给request单独设置，request的context path其实就是它匹配上的context的path。但是当Host不存在时，就没有Host给request设置这个context path了。request的context path永远为空字符串……** 这是一种非常规用法，但是可以增加理解。详见[（七）How Tomcat Works - Tomcat Session]({% post_url 2020-10-08-tomcat-session %})的cookie's path部分。


现在再往前，看上述匹配的`host#map`匹配时调用的`StandardHost#map`：
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
如果最后还找不到，就返回null了。

但是，**假设Context名为a，Wrapper名为hello，一个请求uri为`a/b/c/hello`，它可以匹配到名为a的Context，却匹配不到Wrapper**，因为**uri里刨掉context path `a`，剩下的`b/c/hello`作为匹配servlet的uri**。事实上，这个uri并没有对应任何Wrapper。

具体实现分为两部分——

首先，Host在为Request匹配到Context后，**会将Request和Context关联，同时会将context path设置到Request里**。详见`StandardHostMapper#map`：
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

第二部分实现在匹配Wrapper时。匹配servlet，就是**整个uri去掉context path后和Wrapper的mapping做匹配（通过`Context#addServletMapping`添加的），找到mapping后，再找mapping对应的Wrapper name**。详见`StandardContextMapper#map`：
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

### servlet配置实例
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

## 带Host的servlet容器
```
public final class Bootstrap1 {
  public static void main(String[] args) {
    //invoke: http://localhost:8080/a/b/e/Primitive or http://localhost:8080/a/b/Modern
    System.setProperty("catalina.base", System.getProperty("user.dir"));
    // catalina.base被设为了当前工程根目录（程序从根目录执行的）
    System.out.println("catalina.base is set to: " + System.getProperty("user.dir"));
    Connector connector = new HttpConnector();

    Wrapper wrapper1 = new StandardWrapper();
    wrapper1.setName("Primitive");
    wrapper1.setServletClass("PrimitiveServlet");
    Wrapper wrapper2 = new StandardWrapper();
    wrapper2.setName("Modern");
    wrapper2.setServletClass("ModernServlet");

    Context context = new StandardContext();
    // StandardContext's start method adds a default mapper
    context.setPath("/a/b");
    // 去webapps（下文host设置了app base）下的app1加载文件（包括servlet文件）
    // 这个是加载文件的位置，跟uri没关系
    context.setDocBase("app1");

    context.addChild(wrapper1);
    context.addChild(wrapper2);

    LifecycleListener listener = new SimpleContextConfig();
    ((Lifecycle) context).addLifecycleListener(listener);

    Host host = new StandardHost();
    host.addChild(context);
    host.setName("localhost");
    // <catalina.base>/webapps作为寻找context的目录
    host.setAppBase("webapps");

    Loader loader = new WebappLoader();
    context.setLoader(loader);
    // context.addServletMapping(pattern, name);
    // "/e/Primitive"是除去context path的uri，是servlet的映射路径
    context.addServletMapping("/e/Primitive", "Primitive");
    context.addServletMapping("/Modern", "Modern");

    connector.setContainer(host);
    try {
      connector.initialize();
      ((Lifecycle) connector).start();
      ((Lifecycle) host).start();
  
      // make the application wait until we press a key.
      System.in.read();
      ((Lifecycle) host).stop();
    }
    catch (Exception e) {
      e.printStackTrace();
    }
  }
}
```
两个servlet的访问url分别是：
- http://localhost:8080/a/b/e/Primitive
- http://localhost:8080/a/b/Modern

代码里的配置 **相当于配置了Tomcat的`conf/server.xml`**：
1. catalina.base = 工程根目录；
2. app base = webapps = 工程根目录下的webapps
3. doc path = /app1 = 工程根目录下的webapps/app1
3. context path = /a/b

同时 **相当于配置了`web.xml`**：
1. **配置了两个servlet：名为Primitive，对应类PrimitiveServlet、名为Modern，对应类ModernServlet**；
1. 配置了servlet mapping = /e/Primitive 或 /Modern

**如果不用上述代码配置**，通过`conf/server.xml`配置，此时：
1. 所有的web app从`webapps`下加载；
2. 该context（app）放置文件的路径是`webapps/app1`，**`web.xml`应该在`webapps/app1/WEB-INF/web.xml`**；
3. **servlet应该在`webapps/app1/WEB-INF/classes`下**；
4. **lib应该在`webapps/app1/WEB-INF/lib`**。

同时 **servlet和mapping需要通过`web.xml`配置**：
```
<?xml version="1.0" encoding="ISO-8859-1"?>

<!DOCTYPE web-app
    PUBLIC "-//Sun Microsystems, Inc.//DTD Web Application 2.3//EN"
    "http://java.sun.com/dtd/web-app_2_3.dtd">

<web-app>
  <servlet>
    <servlet-name>Modern</servlet-name>
    <servlet-class>ModernServlet</servlet-class>
  </servlet>
  <servlet>
    <servlet-name>Primitive</servlet-name>
    <servlet-class>PrimitiveServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>Modern</servlet-name>
    <url-pattern>/e/Modern</url-pattern>
  </servlet-mapping>
  <servlet-mapping>
    <servlet-name>Primitive</servlet-name>
    <url-pattern>/Primitive</url-pattern>
  </servlet-mapping>
</web-app>
```

## Engine: `org.apache.catalina.Engine`
### 任务
Engine包含一个或多个Host。所以Engine也有找Host的过程。

1. 根据ip或Host header寻找host container；
2. 如果找不到，把请求交给defaultHost配置的那个host container；

Engine匹配Host和uri无关，使用的是request的serverName：
> `ServletRequest#getServerName()`: Returns the host name of the server to which the request was sent. 其实就是Host header。

> 实际上每一级的Container的mapper都用到了Container本身的`findChild`方法，每个Container的该方法都使用了`ContainerBase#findChild`这一默认实现，所以findChild时都是和Container的name去匹配。Context找Wrapper之所以用到了mapping，实际是在findChild前加了一层mapping。实际找到mapping之后，还是使用findChild找mapping对应的Wrapper。

参考`StandardEngineMapper#map`实现：
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

## 带Engine的servlet容器
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

## 第四个路径
Context有一个docBase。Host有一个appBase，Engine有一个engineBase。

Tomcat加载类、资源等，就是**按照`<engine base>/<app base>/<doc base>`的层级**确定资源位置。

记住tomcat的三个base，一个路径：
- engine base；
- app base；
- doc base；
- context path；

# 总结
在[图解 Spring：HTTP 请求的处理流程与机制【2】](https://segmentfault.com/a/1190000021168133)的帮助下，终于梳理清楚了Tomcat的请求处理逻辑！再配合上代码，一目了然！

接下来就是`web.xml`的处理逻辑了：[图解 Spring：HTTP 请求的处理流程与机制【3】](https://segmentfault.com/a/1190000021177809)。从这里开始，请求就正式来到了spring的领地——一个叫DispatcherServlet的servlet！

把受益匪浅的四篇系列文章都贴到这里：
- https://segmentfault.com/a/1190000021137583
- https://segmentfault.com/a/1190000021168133
- https://segmentfault.com/a/1190000021177809
- https://segmentfault.com/a/1190000021177945

