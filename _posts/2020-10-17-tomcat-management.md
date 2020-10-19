---
layout: post
title: "（十二）How Tomcat Works - Tomcat管理"
date: 2020-10-17 22:48:28 +0800
categories: Tomcat Http web jmx
tags: Tomcat Http web jmx
---

一个应用想要受欢迎，除了强大的功能，还要有用户友好的可管理方式。这里介绍Tomcat的两种管理方式：
- manager：用户界面；
- JMX：程序接口；

1. Table of Contents, ordered
{:toc}

# manager web app
Tomcat可以让用户在webapps目录下部署web app，刚下载下来的Tomcat默认就部署了几个app。有docs、examples，可以帮助用户更好地了解Tomcat。还有一个manager，可以给用户呈现当前Tomcat的部署情况。

> 我服务我自己 :D

看看manager的`web.xml`——

定义了servlet：
```
  <servlet>
    <servlet-name>Manager</servlet-name>
    <servlet-class>org.apache.catalina.manager.ManagerServlet</servlet-class>
    <init-param>
      <param-name>debug</param-name>
      <param-value>2</param-value>
    </init-param>
  </servlet>
  <servlet>
    <servlet-name>HTMLManager</servlet-name>
    <servlet-class>org.apache.catalina.manager.HTMLManagerServlet</servlet-class>
    <init-param>
      <param-name>debug</param-name>
      <param-value>2</param-value>
    </init-param>
    <!-- Uncomment this to show proxy sessions from the Backup manager or a
         StoreManager in the sessions list for an application
    <init-param>
      <param-name>showProxySessions</param-name>
      <param-value>true</param-value>
    </init-param>
    -->
    <multipart-config>
      <!-- 50MB max -->
      <max-file-size>52428800</max-file-size>
      <max-request-size>52428800</max-request-size>
      <file-size-threshold>0</file-size-threshold>
    </multipart-config>
  </servlet>
  <servlet>
    <servlet-name>Status</servlet-name>
    <servlet-class>org.apache.catalina.manager.StatusManagerServlet</servlet-class>
    <init-param>
      <param-name>debug</param-name>
      <param-value>0</param-value>
    </init-param>
  </servlet>

  <servlet>
    <servlet-name>JMXProxy</servlet-name>
    <servlet-class>org.apache.catalina.manager.JMXProxyServlet</servlet-class>
  </servlet>
```

定义了servlet mapping，即访问这些servlet的url路径：
```
  <!-- Define the Manager Servlet Mapping -->
  <servlet-mapping>
    <servlet-name>Manager</servlet-name>
      <url-pattern>/text/*</url-pattern>
  </servlet-mapping>
  <servlet-mapping>
    <servlet-name>Status</servlet-name>
    <url-pattern>/status/*</url-pattern>
  </servlet-mapping>
  <servlet-mapping>
    <servlet-name>JMXProxy</servlet-name>
      <url-pattern>/jmxproxy/*</url-pattern>
  </servlet-mapping>
  <servlet-mapping>
    <servlet-name>HTMLManager</servlet-name>
    <url-pattern>/html/*</url-pattern>
  </servlet-mapping>
```

定义了一些**身份role**：
```
  <!-- Security roles referenced by this web application -->
  <security-role>
    <description>
      The role that is required to access the HTML Manager pages
    </description>
    <role-name>manager-gui</role-name>
  </security-role>
  <security-role>
    <description>
      The role that is required to access the text Manager pages
    </description>
    <role-name>manager-script</role-name>
  </security-role>
  <security-role>
    <description>
      The role that is required to access the HTML JMX Proxy
    </description>
    <role-name>manager-jmx</role-name>
  </security-role>
  <security-role>
    <description>
      The role that is required to access to the Manager Status pages
    </description>
    <role-name>manager-status</role-name>
  </security-role>
```

对于html、text、jmx、status等这些servlet产出的资源，定义了**哪些身份可以访问可以访问哪些资源**：
```
  <!-- Define a Security Constraint on this Application -->
  <!-- NOTE:  None of these roles are present in the default users file -->
  <security-constraint>
    <web-resource-collection>
      <web-resource-name>HTML Manager interface (for humans)</web-resource-name>
      <url-pattern>/html/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
       <role-name>manager-gui</role-name>
    </auth-constraint>
  </security-constraint>
  <security-constraint>
    <web-resource-collection>
      <web-resource-name>Text Manager interface (for scripts)</web-resource-name>
      <url-pattern>/text/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
       <role-name>manager-script</role-name>
    </auth-constraint>
  </security-constraint>
  <security-constraint>
    <web-resource-collection>
      <web-resource-name>JMX Proxy interface</web-resource-name>
      <url-pattern>/jmxproxy/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
       <role-name>manager-jmx</role-name>
    </auth-constraint>
  </security-constraint>
  <security-constraint>
    <web-resource-collection>
      <web-resource-name>Status interface</web-resource-name>
      <url-pattern>/status/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
       <role-name>manager-gui</role-name>
       <role-name>manager-script</role-name>
       <role-name>manager-jmx</role-name>
       <role-name>manager-status</role-name>
    </auth-constraint>
  </security-constraint>
```

定义了**验证用户身份**的方式：
```
  <!-- Define the Login Configuration for this Application -->
  <login-config>
    <auth-method>BASIC</auth-method>
    <realm-name>Tomcat Manager Application</realm-name>
  </login-config>
```

比如，想访问`localhost:8080/html`资源，就是要一个拥有manager-gui身份的用户才能使用BASIC认证方式访问。

为此，需要在Tomcat的`conf/tomcat-users.xml`里定义拥有manager-gui身份的用户（Tomcat默认没添加任何用户），才能访问：
```
<tomcat-users xmlns="http://tomcat.apache.org/xml"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xsi:schemaLocation="http://tomcat.apache.org/xml tomcat-users.xsd"
              version="1.0">
<!--
  NOTE:  By default, no user is included in the "manager-gui" role required
  to operate the "/manager/html" web application.  If you wish to use this app,
  you must define such a user - the username and password are arbitrary. It is
  strongly recommended that you do NOT use one of the users in the commented out
  section below since they are intended for use with the examples web
  application.
-->
<!--
  NOTE:  The sample user and role entries below are intended for use with the
  examples web application. They are wrapped in a comment and thus are ignored
  when reading this file. If you wish to configure these users for use with the
  examples web application, do not forget to remove the <!.. ..> that surrounds
  them. You will also need to set the passwords to something appropriate.
-->
<!--
  <role rolename="tomcat"/>
  <role rolename="role1"/>
  <user username="tomcat" password="<must-be-changed>" roles="tomcat"/>
  <user username="both" password="<must-be-changed>" roles="tomcat,role1"/>
  <user username="role1" password="<must-be-changed>" roles="role1"/>
-->
  <role rolename="manager-gui"/>
  <user username="puppylpg" password="pikachu" roles="manager-gui,manager-script,manager-jmx,manager-status"/>

</tomcat-users>
```
这里添加了一个密码为pikachu的用户puppylpg，身份为manager-gui,manager-script,manager-jmx,manager-status。使用这个用户名和密码就可以访问上述资源了。

## ContainerServlet
但是Tomcat不同的web app有不同的classloader，manager也是一个web app，既然它能管理别的app，它是怎么获取别的web app的信息的？

显然，Tomcat会给自己的web app开后门。Tomcat自己写的servlet，会实现ContainerServlet接口：

```
public interface ContainerServlet {

    /**
     * Return the Wrapper with which this Servlet is associated.
     */
    public Wrapper getWrapper();


    /**
     * Set the Wrapper with which this Servlet is associated.
     *
     * @param wrapper The new associated Wrapper
     */
    public void setWrapper(Wrapper wrapper);
}
```
这个接口特别简单，就是和一个Wrapper关联起来。

Tomcat自己的ManagerServlet就实现了这一接口。它的setWrapper实现为：
```
    public void setWrapper(Wrapper wrapper) {
        this.wrapper = wrapper;
        if (wrapper == null) {
            context = null;
            deployer = null;
        } else {
            context = (Context) wrapper.getParent();
            deployer = (Deployer) context.getParent();
        }

    }
```
ManagerServlet不仅拥有了Wrapper，还拥有了Context和Host的信息。有了这些Host（只需要它的Deployer功能），自然可以获取`deployer.findDeployedApps()`获取所有部署的app的信息。

这一接口的调用时StandardWrapper#loadServlet的时候实现的：普通的servlet就实例化一下，如果是`org.apache.catalina`开头且实现了ContainerServlet接口的servlet，就调用它的setWrapper方法，关联一下。

# JMX
JMX（Java Management Extensions）规范提供了程序化地暴露/控制程序内部Java对象的方法。通过jmx，不仅能获取Java对象的状态，还能控制Java对象的行为。

- MBean class：实现了jmx标准的Java class，相当于普通Java class + jmx的内容；
- MBean对象：MBean class new出的对象，MBean对象拥有普通Java对象 + jmx的功能；
- MBeanServer：注册、管理MBean对象的地方；

## MBeanServer
1. 获取MBeanServer：`ManagementFactory.getPlatformMBeanServer()`；
2. 将创建出的MBean对象注册到MBeanServer上，注册的时候需要一个ObjectName对象，用来描述该MBean的名称：`public ObjectInstance registerMBean(Object object, ObjectName name)`；

MBeanServer就像一个map一样，维护着一堆MBean，ObjectName就像是他们的key，可以按照key查询MBean：
```
public Set<ObjectInstance> queryMBeans(ObjectName name, QueryExp query);
public Set<ObjectName> queryNames(ObjectName name, QueryExp query);
```
使用ObjectName（想象为正则表达式）查询MBean，获取一堆具体的ObjectName。query指定过滤条件，过滤返回的ObjectName。

还能通过invoke接口直接调用MBean的某些方法：
```
public Object invoke(ObjectName name, String operationName, Object params[], String signature[])
```

还能直接修改MBean的属性：
```
public Object getAttribute(ObjectName name, String attribute)
public void setAttribute(ObjectName name, Attribute attribute)
```

### ObjectName
一个具体的ObjectName对象唯一表示一个MBean。

ObjectName格式：`<domain>:<k1>=<v1>,<k2>=<v2>,...`

模糊的ObjectName可以模糊匹配一堆MBean（queryMBeans方法就可以用模糊ObjectName作为参数）。姑且把它当作类似于正则的东西。具体参考其javadoc。

## MBean
### 标准MBean
MBean有很多种，最简单的是“标准MBean”。这种MBean需要让普通Java class实现一个拥有特定名字的接口。比如`class Car implements CarMBean`，这样所有在`CarMBean`接口里定义的方法都可以暴露出去。

这样的MBean写起来最简单，但它的缺点也很明显：
- 继承的这个自定义接口感觉相当不正规，全靠用户自己按照命名规范“class + MBean”去起名；
- 该接口会暴力入侵原class，直接硬编码入其中；

后者是最大的缺陷。

### 模型MBean
无需修改原有类。**原有普通Java类和MBean解耦**。

1. 搞一个MBean类，implements ModelMBean接口（一般是extends 其默认实现RequiredModelMBean）；
2. 创建一个ModelMBeanInfo的实现（一般是extends 其默认实现ModelMBeanInfoSupport），描述要托管的class，暴露哪些方法；
3. 关联ModelMBean和ModelMBeanInfo，比如set进去；

此时，原有class是原有class，没有动，ModelMBean是ModelMBean，只有jmx的相关功能。二者没有耦合。

缺点：ModelMBeanInfo写起来相对麻烦。比如每一个要暴露的方法都要这么描述：
```
      attributes[0] = new ModelMBeanAttributeInfo("Color", "java.lang.String",
        "the color.", true, true, false, null);
      operations[0] = new ModelMBeanOperationInfo("drive", "the drive method",
        null, "void", MBeanOperationInfo.ACTION, null);
      operations[1] = new ModelMBeanOperationInfo("getColor", "get color attribute",
        null, "java.lang.String", MBeanOperationInfo.ACTION, null);
      
      Descriptor setColorDesc = new DescriptorSupport(new String[] {
        "name=setColor", "descriptorType=operation", 
        "class=" + MANAGED_CLASS_NAME, "role=operation"});
      MBeanParameterInfo[] setColorParams = new MBeanParameterInfo[] { 
        (new MBeanParameterInfo("new color", "java.lang.String",
        "new Color value") )} ;
      operations[2] = new ModelMBeanOperationInfo("setColor",
        "set Color attribute", setColorParams, "void",
        MBeanOperationInfo.ACTION, setColorDesc);
      
      mBeanInfo  = new ModelMBeanInfoSupport(MANAGED_CLASS_NAME,
        null, attributes, null, operations, null);
```

通过Apache commons的Modeler库，不再需要创建ModelMBeanInfo对象了，可以用一个xml描述要创建的MBean，要暴露的属性和方法。

Modeler库会使用Registry类加载xml，解析出ManagedBean对象（用于描述模型MBean，取代那个很难写的MBeanInfo），并使用ManagedBean创建出ModelMBean。

xml定义一个ModelMBean，它要暴露的是Car type的color属性和drive方法：
```
<mbeans-descriptors>

  <mbean name="myMBean"
    className="javax.management.modelmbean.RequiredModelMBean"
    description="The ModelMBean that manages our Car object"
    type="ex20.pyrmont.modelmbeantest.Car">

    <attribute name="color"
      description="The car color"
      type="java.lang.String"/>

    <operation name="drive"
      description="drive method"
      impact="ACTION"
      returnType="void">
      <parameter name="driver" description="the driver parameter"
        type="java.lang.String"/>
    </operation>

  </mbean>

</mbeans-descriptors>
```
使用名字myMBean就可以获取它。一个获取ModelMBean的方法：
```
  public ModelMBean createModelMBean(String mBeanName) throws Exception {
    ManagedBean managed = registry.findManagedBean(mBeanName);
    if (managed == null) {
      System.out.println("ManagedBean null");    
      return null;
    }
    ModelMBean mbean = managed.createMBean();
    return mbean;
  }
```
Registry -> ManagedBean -> ModelMBean，相当简单。

## Catalina中的MBean
### 注册一个MBean
Tomcat显然是用ModelMBean管理Tomcat内部的Java对象的，这样就不会侵入原有的Context、Host等类的实现。

比如，想为Context的实现StandardContext创建一个ModelMBean，xml配置为：
```
<mbean name="StandardContext"
        className="org.apache.catalina.mbeans.StandardContextMBean"
        description="Standard Context Component"
        domain="Catalina"
        group="Context"
        type="org.apache.catalina.core.StandardContext">
```
这个ModelMBean就是以StandardContext来命名。

为StandardContext创建ModelMBean，并将MBean注册到MBeanServer的代码是：
```
    public static ModelMBean createMBean(Context context) throws Exception {

        // 确定其在xml配置里的名称
        String mname = createManagedName(context);
        
        // 根据xml配置，解析为ManagedBean
        ManagedBean managed = registry.findManagedBean(mname);
        if (managed == null) {
            Exception e = new Exception("ManagedBean is not found with "+mname);
            throw new MBeanException(e);
        }
        String domain = managed.getDomain();
        if (domain == null)
            domain = mserver.getDefaultDomain();
            
        // 获取ModelMBean
        ModelMBean mbean = managed.createMBean(context);
        
        // 创建ObjectName
        ObjectName oname = createObjectName(domain, context);
        
        // 将MBean和ObjectName一起，注册到MBeanServer上
        mserver.registerMBean(mbean, oname);
        return (mbean);

    }
```
createManagedName简单来说，就是为了获取不含包名的类名：StandardContext。因为如上所述，Tomcat定义ModelMBean的时候就是以不含包名的类名来定义。

主要流程就是Modeler库根据xml获取ModelMBean的过程。

最后为当前Context对象创建一个独有的ObjectName，和ModelMBean一起注册到MBeanServer上。

为Context创建ObjectName的方法：
```
    public static ObjectName createObjectName(String domain, Context context) throws MalformedObjectNameException {

        ObjectName name = null;
        Host host = (Host)context.getParent();
        Service service = ((Engine)host.getParent()).getService();
        String path = context.getPath();
        if (path.length() < 1)
            path = "/";
        name = new ObjectName(domain + ":type=Context,path=" +
                              path + ",host=" +
                              host.getName() + ",service=" +
                              service.getName());
        return (name);
    }
```
使用了Context的path（也就是它的name），所以每一个Context的ObjectName都是独一无二的。

其他为Host、Wrapper注册MBean的流程都相似。

### 为所有组件注册MBean
Tomcat定义了一个listener，监听Server start事件，如果发生，就为Server创建MBean（方法如上一节所述）。就像前面说的，Tomcat的各个组件就像是一颗树状结构，可以从Server获取Service、Connector、Engine、Host、Context、Wrapper。所以可以从Server开始遍历，为每一个组件创建MBean。

> 不过这里我觉得不太行，只是start，可能组件都还没起来。监听after_start_event是不是更好？或者除了Server，每一种组件都有一个listener分别注册它对应的MBean是不是更好？

### MBeanFactory
Tomcat注册MBean时，还会单独注册一个MBeanFactory类，它提供了管理组件的方法。

比如启动一个Context（感觉还应该注册到MBeanServer）：
```
   /**
     * Create a new StandardContext.
     *
     * @param parent MBean Name of the associated parent component
     * @param path The context path for this Context
     * @param docBase Document base directory (or WAR) for this Context
     *
     * @exception Exception if an MBean cannot be created or registered
     */
    public String createStandardContext(String parent, String path,
                                        String docBase)
        throws Exception {
        
        // Create a new StandardContext instance
        StandardContext context = new StandardContext();    
        path = getPathStr(path);
        context.setPath(path);
        context.setDocBase(docBase);
        ContextConfig contextConfig = new ContextConfig();
        context.addLifecycleListener(contextConfig);

        // Add the new instance to its parent component
        ObjectName pname = new ObjectName(parent);
        Server server = ServerFactory.getServer();
        Service service = server.findService(pname.getKeyProperty("service"));
        Engine engine = (Engine) service.getContainer();
        Host host = (Host) engine.findChild(pname.getKeyProperty("host"));

        // Add context to the host
        host.addChild(context);
        
        // Return the corresponding MBean name
        ManagedBean managed = registry.findManagedBean("StandardContext");

        ObjectName oname =
            MBeanUtils.createObjectName(managed.getDomain(), context);
        return (oname.toString());

    }
```
删除一个Context：
```
    /**
     * Remove an existing Context.
     *
     * @param name MBean Name of the comonent to remove
     *
     * @exception Exception if a component cannot be removed
     */
    public void removeContext(String name) throws Exception {
        // Acquire a reference to the component to be removed
        ObjectName oname = new ObjectName(name);
        String serviceName = oname.getKeyProperty("service");
        String hostName = oname.getKeyProperty("host");
        String contextName = getPathStr(oname.getKeyProperty("path"));
        Server server = ServerFactory.getServer();
        Service service = server.findService(serviceName);
        Engine engine = (Engine) service.getContainer();
        Host host = (Host) engine.findChild(hostName);
        Context context = (Context) host.findChild(contextName);

        // Remove this component from its parent component
        host.removeChild(context);
    }
```
**Tomcat往MBeanServer上注册MBeanFactory，相当于Tomcat自己往MBeanServer上注册了一个工具。可以通过jmx的MBeanServer获取MBeanFactory，再使用后者很方便地按照增删组件。**

> 这是一种不错的思路，**感觉进程间通过jmx通信时，提前往MBeanServer上注册一些其他进程可能会用到的顺手的工具，还是挺方便的。不需要在另一个工程里实现该工具了。**

## 实现一个管理Context的servlet
可以搞一个servlet，根据参数决定执行哪些动作，以此通过jmx来管理Tomcat组件。

比如列出所有的Context，就可以获取MBeanServer，用一个`ObjectName("Catalina:type=Context,*")`，query一下，遍历输出即可。

删除一个Context：获取MBeanServer，用一个`ObjectName("Catalina:type=MBeanFactory")`从上面取下Tomcat注册到MBeanServer上的工具MBeanFactory，然后调用MBeanFactory的`removeContext`方法即可。也可以直接使用MBeanServer的invoke方法，省去获取MBeanFactory这一步，直接执行其`removeContext`方法。
