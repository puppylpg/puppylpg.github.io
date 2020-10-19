---
layout: post
title: "（十）How Tomcat Works - Tomcat部署"
date: 2020-10-17 17:42:19 +0800
categories: Tomcat Http web classloader
tags: Tomcat Http web classloader
---

回顾之前所说的“关联”，比如Server关联Service，Service关联Connector和Container，Container关联子Container等等，都是通过setXXX方法将后者放入前者，使前者持有后者的引用，以此达成“关联”的效果。

Tomcat作为一个servlet容器，让用户部署web应用，这些“关联”应该由用户来决定，用户怎么告诉Tomcat哪个组件关联哪个组件？像之前的demo一样直接硬编码在Tomcat的代码里显然是不可能的。所以Tomcat为用户提供了一套配置服务，用户只要按照规则在配置文件里配置组件之间的关联关系即可。

1. Table of Contents, ordered
{:toc}

# 配置文件解析 - Digester
接触过Spring的用户对这种xml配置的方式其实都不陌生，比如：
```
<?xml version="1.0" encoding="ISO-8859-1"?>
<employee firstName="Freddie" lastName="Mercury">
  <office description="Headquarters">
    <address streetName="Wellington Avenue" streetNumber="223"/>
  </office>
  <office description="Client site">
    <address streetName="Downing Street" streetNumber="10"/>
  </office>
</employee>
```
实际相当于实例化了一个employee，设置firstName和lastName属性，并set两个office对象，每个office对象内含一个address。

这种配置方式和Spring的xml配置并不完全相同，但大致都表达了一个意思。

对类似xml的解析是由Apache的Digester库来做的，通过定义元素标签并添加行为，可以让Digester**在碰到对应配置文件的时候，将xml配置转换为Java对象，并做一些init/set之类的动作**，以达到new Java对象并调用响应方法的目的。

> 实际上和开头说到的类似互相set的行为没什么区别。

具体Digester怎么做到这些的就不再展开了。只是学习Tomcat的架构其实不需要太关心Digester的细节，知道它对Tomcat起到了什么作用就行了。

通过这种配置，对象之间的关联关系不再硬编码到代码里，可以灵活部署服务。（Spring实际做的不也是这种解耦嘛）

# Tomcat的配置文件
## `conf/server.xml`
Tomcat对自己基本组件的配置放在`conf/server.xml`里，可以看一下Tomcat9的配置文件内容：
```
<!-- Note:  A "Server" is not itself a "Container", so you may not
     define subcomponents such as "Valves" at this level.
     Documentation at /docs/config/server.html
 -->
<Server port="8005" shutdown="SHUTDOWN">
  <Listener className="org.apache.catalina.startup.VersionLoggerListener" />
  <!-- Security listener. Documentation at /docs/config/listeners.html
  <Listener className="org.apache.catalina.security.SecurityListener" />
  -->
  <!--APR library loader. Documentation at /docs/apr.html -->
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
    <!-- Define an SSL/TLS HTTP/1.1 Connector on port 8443
         This connector uses the NIO implementation. The default
         SSLImplementation will depend on the presence of the APR/native
         library and the useOpenSSL attribute of the
         AprLifecycleListener.
         Either JSSE or OpenSSL style configuration may be used regardless of
         the SSLImplementation selected. JSSE style configuration is used below.
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
    <!-- Define an SSL/TLS HTTP/1.1 Connector on port 8443 with HTTP/2
         This connector uses the APR/native implementation which always uses
         OpenSSL for TLS.
         Either JSSE or OpenSSL style configuration may be used. OpenSSL style
         configuration is used below.
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
实际就是：
- 实例化一个Server对象，监听端口8005，接收到"SHUTDOWN"内容即关闭；
- Server里面设置一个Service对象，后者关联了一个Connector和一个Engine；
- Connector监听8080端口，接收HTTP请求；
- Engine里关联了一个Host；
- Host设置appBase为webapps，用户在该文件夹下部署web应用，同时支持自动解压war包，并自动部署web应用；
- Host里配置了一个输出accesslog的Valve。

> **Engine的base默认为`catalina.base`，后者默认为`catalina.home`。**

## `conf/web.xml`
Tomcat使用`web.xml`定义web应用里的一些组件。Tomcat默认也有自己的一些servlet（和用户部署的servlet相区别），这些servlet的配置是在`conf/web.xml`里配置的。

主要是这些servlet，以及servlet的mapping：
```
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee
                      http://xmlns.jcp.org/xml/ns/javaee/web-app_4_0.xsd"
  version="4.0">
  
    <servlet>
        <servlet-name>default</servlet-name>
        <servlet-class>org.apache.catalina.servlets.DefaultServlet</servlet-class>
        <init-param>
            <param-name>debug</param-name>
            <param-value>0</param-value>
        </init-param>
        <init-param>
            <param-name>listings</param-name>
            <param-value>false</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet>
        <servlet-name>jsp</servlet-name>
        <servlet-class>org.apache.jasper.servlet.JspServlet</servlet-class>
        <init-param>
            <param-name>fork</param-name>
            <param-value>false</param-value>
        </init-param>
        <init-param>
            <param-name>xpoweredBy</param-name>
            <param-value>false</param-value>
        </init-param>
        <load-on-startup>3</load-on-startup>
    </servlet>

    <!-- The mapping for the default servlet -->
    <servlet-mapping>
        <servlet-name>default</servlet-name>
        <url-pattern>/</url-pattern>
    </servlet-mapping>

    <!-- The mappings for the JSP servlet -->
    <servlet-mapping>
        <servlet-name>jsp</servlet-name>
        <url-pattern>*.jsp</url-pattern>
        <url-pattern>*.jspx</url-pattern>
    </servlet-mapping>
    
</web-app>
```
配置了两个servlet。

## `webapps/META-INF/web.xml`
用户自己搞的web app，放在tomcat的appBase（默认是webapps）下，可以是一个war包，也可以是一个文件夹。文件夹应该包含WEB-INF子文件夹，其下的web.xml就是用户对该app的配置。这个`web.xml`类似于Tomcat自己的`conf/web.xml`，配置一些servlet。

# 启动Tomcat
Tomcat的启动分为两个类：
- `org.apache.catalina.startup.Bootstrap`：main函数所在的类。启动一个Catalina实例，调用其process方法；
- `org.apache.catalina.startup.Catalina`：处理启动参数，根据参数执行动作：
    + 如果是`start`，就调用start方法；
    + 如果是`stop`，就调用stop方法；

二者其实可以合成一个类，不过为了支持Tomcat的多种运行模式，拆出来了不同的bootstrap，比如：
- Bootstrap：独立的Tomcat程序；
- BootstrapService：以Windows NT服务运行Tomcat；

等等。

## Bootstrap创建的classloader
Tomcat4搞了这些classloader来加载不同的类：
```
      Bootstrap
          |
       System
          |
       Common
      /      \
 Catalina   Shared
             /   \
        Webapp1  Webapp2 ...
```
jdk的classloader：
- Bootstrap：加载基本的jre源码的bootstrap classloader和加载`$JAVA_HOME/jre/lib/ext`的ExtClassLoader的合称，数据jdk的classloader，和Tomcat无关；
- System：jdk的AppClassLoader，加载`CLASSPATH`环境变量指定的目录下的类。不过Tomcat在启动脚本`catalina.sh`里把`CLASSPATH`强行置为空了，即不用用户指定的`CLASSPATH`。不过其实一般执行java程序时，很少使用全局的`CLASSPATH`，基本都是手动`-cp`命令指定classpath；

> System classloader对一般的程序比较重要，它是加载我们写的代码（非jvm代码）的classloader。**但是对Tomcat来说它并不重要**，因为Tomcat还有一堆自定义的classloader用来加载Tomcat自身的类和用户部署的web app的类。**所以Tomcat启动脚本里把`CLASSPATH`置为空了，System classloader就没有要加载的类了。**

其他都是Tomcat自定义的classloader。

首先需要明确的一点是，按照classloader的树状结构，子classloader可以将寻找类的任务委托为父classloader。无论是jdk默认的父classloader优先策略，还是Tomcat自己搞的子classloader优先策略，只要类能被子classloader或者父classloader找到，这个类对该classloader就是可见的。

所以，子classloader能访问的类范围包含父classloader能访问的类范围。由此可以得出结论：
- Webapp1可以访问的类范围：它自己能访问的类，加上Shared/Common/System/Bootstrap能访问到的类；
- 但是Webapp1访问不到Catalina能访问的类（Catalina不是webapp1的父classloader）；
- Webapp2能访问的类范围：它自己能访问的类，加上Shared/Common/System/Bootstrap能访问到的类；
- 但是Webapp2访问不了仅Webapp1能访问到的类，Webapp1页访问不了仅Webapp2能访问到的类；

所以Tomcat搞这么多classloader的目的就显而易见了：
- Common：Tomcat里的全局类classloader，它能访问到的类所有Tomcat的classloader都能访问到；
- Catalina：专门用来加载Tomcat自己的类，它访问不了各个webapp专有的类；
- Shared：各个webapp共有的类；
- WebappX：用户部署的各个webapp私有的类，只有他们的classloader能访问到；

Tomcat6变成了这样：
```
      Bootstrap
          |
       System
          |
       Common
       /     \
  Webapp1   Webapp2 ...
```
Catalina专有的classloader被取消了。貌似交由Common classloader加载了。所以一个common classloader就够了，删掉了原有的Shared classloader。但是各个webapp要隔离的思想还在。


Tomcat自己实现的classloader也是URLClassLoader的子类，但是改变了jdk赋予classloader的“父classloader优先”原则，而是：
1. Bootstrap classes of your JVM
2. /WEB-INF/classes of your web application
3. /WEB-INF/lib/*.jar of your web application
4. System class loader classes (described above)
5. Common class loader classes (described above)

首先，破坏父classloader优先原则并不会破坏jdk的bootstrap classloader和ext classloader的父classloader优先原则，因为他们的实现在jdk里写好了，Tomcat也改不了。

所以Tomcat只能从自定义的URLClassLoader的子类`org.apache.catalina.loader.StandardClassLoader`开始修改规则，也就是说对于Tomcat自身的Common classloader和WebappX classloader，他俩遵循子classloader优先，只有他俩的类加载顺序是反的。

所以bootstrap永远第一，其次是WebappX，最后是Common。


Tomcat还提供了配置项`<Loader delegate="true"/>`让自定义的classloader采用父classloader优先原则，又回到了正常状态：
1. Bootstrap classes of your JVM
2. System class loader classes (described above)
3. Common class loader classes (described above)
4. /WEB-INF/classes of your web application
5. /WEB-INF/lib/*.jar of your web application

因为父classloader优先，所以这就是树状结构从root到叶子的顺序。

- Tomcat4: https://tomcat.apache.org/tomcat-4.1-doc/class-loader-howto.html
- Tomcat8: https://tomcat.apache.org/tomcat-8.0-doc/class-loader-howto.html

## Catalina
调用Catalina的方法，做不同的事情：

### Catalina#start：顶级关联
实例化一个Digester，解析`conf/web.xml`，创建里面定义的Server。启动Server也会启动后续一系列的组件：Service、Connector、Engine、Host。

### Catalina#stop
实例化一个Digester，解析`conf/web.xml`，不过只解析出Server监听的端口8005就行了（不是Connector监听的端口8080），毕竟只需要知道Server在哪儿运行着。然后连上Server的端口发送一个"SHUTDOWN"用来关闭Server。

> `shutdown.sh`脚本调用`Bootstrap#main`，其实是又启动了一个jvm，给之前启动的jvm发送了关闭命令，然后退出了。之前的jvm收到命令自然也退出了。

# 关联Host和Context
Tomcat启动的时候自己解析了自己的配置：`conf/server.xml`，启动了Connector和容器Engine、Host。Context和Wrapper呢？

用户部署一个web app，其实就是写了各种servlet，部署到Tomcat里，并在`WEB-INF/web.xml`里配置servlet的信息。怎么把这些servlet转换为Wrapper，关联到Context，并将Context挂载到Tomcat已经启动的Host上，就是Tomcat的事儿了。

## HostConfig监听器
Catalina启动，使用Digester解析`conf/server.xml`，如果发现Host，会实例化一个Host，并给它添加一个监听器HostConfig。后者先根据Host的配置，设置一些参数：
```
setDeployXML(((StandardHost) host).isDeployXML());
setLiveDeploy(((StandardHost) host).getLiveDeploy());
setUnpackWARs(((StandardHost) host).isUnpackWARs());
```
- Should we deploy XML Context config files?
- Should we monitor the `appBase` directory for new applications and automatically deploy them?
- Set the unpack WARs flag.

然后在收到Host的start事件时，然后会触发start方法：
```
    protected void start() {

        if (debug >= 1)
            log(sm.getString("hostConfig.start"));

        if (host.getAutoDeploy()) {
            deployApps();
        }

        if (isLiveDeploy()) {
            threadStart();
        }

    }
```
deployApps，它包含三个主要行为：
```
    /**
     * Deploy applications for any directories or WAR files that are found
     * in our "application root" directory.
     */
    protected void deployApps() {

        if (!(host instanceof Deployer))
            return;
        if (debug >= 1)
            log(sm.getString("hostConfig.deploying"));

        File appBase = appBase();
        if (!appBase.exists() || !appBase.isDirectory())
            return;
        String files[] = appBase.list();

        deployDescriptors(appBase, files);
        deployWARs(appBase, files);
        deployDirectories(appBase, files);

    }
```
- deployDescriptors：按照一个裸xml的定义，去部署一个Context；
- deployWARs：按照war包，去部署一个Context；
- deployDirectories：按照目录，去部署一个Context；

一般是war包，或者目录部署。

以部署war包为例，可以理解为解压war包为文件夹。文件夹名称为Context的path。Context会被关联到Host里。

> 如果contextPath是"ROOT"，设为空。所以实际上Tomcat的webapps下的ROOT目录直接对应url的root。

## Deployer: `org.apache.catalina.Deployer`
看StandardHost的类签名：`class StandardHost extends ContainerBase implements Deployer, Host`。

Host的标准实现StandardHost不仅仅是个Host，还是个Deployer，还拥有Deployer的功能。

Deployer是啥？

> A Deployer is a specialized Container into which web applications can be deployed and undeployed. Such a Container will create and install child Context instances for each deployed application. The unique key for each web application will be the context path to which it is attached.

它是部署Context到Container（其实就是Host）的一套接口，定义了install/remove一个Context的行为。其实就是把真正部署/卸载一个Context的逻辑抽象出来到Deployer里。

StandardHost有关Deployer的行为都是委托给StandardHostDeployer去做的，比如install方法，它的核心逻辑在于：
```
        // Install the new web application
        try {
            Class clazz = Class.forName("org.apache.catalina.core.StandardContext");
            Context context = (Context) clazz.newInstance();
            context.setPath(contextPath);
            
            context.setDocBase(docBase);
            if (context instanceof Lifecycle) {
                clazz = Class.forName("org.apache.catalina.startup.ContextConfig");
                LifecycleListener listener =
                    (LifecycleListener) clazz.newInstance();
                ((Lifecycle) context).addLifecycleListener(listener);
            }
            host.fireContainerEvent(PRE_INSTALL_EVENT, context);
            host.addChild(context);
            host.fireContainerEvent(INSTALL_EVENT, context);
        } catch (Exception e) {
            host.log(sm.getString("standardHost.installError", contextPath),
                     e);
            throw new IOException(e.toString());
        }
```
1. new一个StandardContext；
2. 和Host关联起来；
3. **给这个Context设置一个ContextConfig作为Context的监听器**；
4. 发送install context事件；

其实就是关联Host和Context的逻辑。

# 关联Context和Wrapper
Context和Wrapper又是怎么关联起来的？

## ContextConfig
**Host使用HostConfig完成和Context的关联，同时会给Context加一个ContextConfig，这就是一套类似的逻辑，显然可以猜出ContextConfig完成了Context和Wrapper的关联。**

HostConfig和ContextConfig都是以监听器的形式存在的，所以ContextConfig也是响应Context的start事件。主要做的事情是：
```
        // Process the default and application web.xml files
        defaultConfig();
        applicationConfig();
        
        validateSecurityRoles();
        certificatesConfig();
        authenticatorConfig();
        
        context.setConfigured(true);
```
1. 解析`conf/web.xml`，将里面的servlet关联到Context上。**所以Tomcat配置的全局servlet会被添加到各个web app里**；
2. 解析`WEB-INF/web.xml`，将里面的servlet关联到Context上。这是用户在这个web app里定义的servlet，关联到这个web app上；
3. `web.xml`里还会配置认证信息等等，全都解析了；
4. 最后如果没出错，设置`configured`变量为true，代表按照`web.xml`配置完毕。

