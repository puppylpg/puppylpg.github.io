---
layout: post
title: "（八）How Tomcat Works - Tomcat Authentication"
date: 2020-10-08 20:52:58 +0800
categories: Tomcat Http web session
tags: Tomcat Http web session
---

session可以让Tomcat识别多个请求来自于同一个用户，既然涉及到用户，就涉及到权限。比如有的servlet只有管理员才能访问，其他的普通用户也可以访问。

1. Table of Contents, ordered
{:toc}

# `org.apache.catalina.Realm`
Tomcat使用Realm代表用户的认证信息，**可简单理解为Realm里存储着所有的用户名和密码**。

> Realm，领域对象，This is my house!

Realm中最重要的一个方法就是authenticate：
```
    /**
     * Return the Principal associated with the specified username and
     * credentials, if there is one; otherwise return <code>null</code>.
     *
     * @param username Username of the Principal to look up
     * @param credentials Password or other credentials to use in
     *  authenticating this username
     */
    public Principal authenticate(String username, String credentials);
```
如果用户名和密码正确，就返回Principal对象。Principal只有一个getName方法，感觉不太足以代表一个人的所有信息，所以Tomcat在其实现类GenericPrincipal中加入了许多其他方法，比如getPassword、getRealm、getRole等。

之前介绍Container时说过，Container里有很多组件，Realm就是其中一个。所以Container里有get/setRealm，Realm里也有get/SetContainer，二者互相关联。

Realm的实现有很多，可以是简单的用户名密码都在内存里的MemoryRealm、从数据库查询的JDBCRealm、UserDatabaseRealm、JNDIRealm等等。无论哪种realm，流程都是一样的，无非是最终获取用户名和密码的介质不同，所以它们有着共同的抽象基类RealmBase。

# `org.apache.catalina.Authenticator`
验证器的接口，奇怪的是它只作为标记性接口，里面并没有一个方法。

Authenticator根据实现方式，有BasicAuthenticator、DigestAuthenticator等。

**Authenticator在Tomcat中是作为valve存在的，所以Authenticator的抽象实现类AuthenticatorBase同时实现了Value接口**。由于Tomcat规定Authenticator只能有一个，所以开启Authenticator时，先遍历检查pipeline的所有valve有没有Authenticator，没有的话就new一个，作为value添加到pipeline里。

**如果Authenticator认证不过，直接return，不再执行后续的value。所以也不会执行到basic valve，不会调用servlet的service方法，response里不会有severlet执行的返回结果。**

# 关于认证的知识
## 权限配置
认证信息一般配置在[web.xml](https://docs.oracle.com/cd/E13222_01/wls/docs81/webapp/web_xml.html)中，比如：
- `<web-resource-collection>`：定义web资源，比如所有get请求的/。
- [`<security-constraint>`](https://docs.oracle.com/cd/E13222_01/wls/docs81/webapp/web_xml.html#1017885)：定义对web资源的限制。谁有权限访问这些资源。
- [`<login-config>`](https://docs.oracle.com/cd/E13222_01/wls/docs81/webapp/web_xml.html#1019996)：如何认证用户。默认是BASIC。

以上合起来就是：如何认证用户以获取用户的role；什么样的role能访问什么样的资源。由此就能决定某用户能不能访问某资源。

## http认证过程
1. client请求server（get请求）；
2. server返回401（Unauthorized），并通过`WWW-Authenticate` header告诉client怎么进行认证（比如Basic）；
3. client在请求里使用`Authorization` header包含认证信息；

比如Tomcat发送如下response，header为：
```
WWW-Authenticate: Basic realm=realm name
```
表明想要进行Basic认证。

client（如果是浏览器，会让用户填写用户名和密码），然后将`base64(username:password)`（假设值为abcdefg）的形式，放到header里：
```
Authorization: Basic abcdefg
```

- [HTTP authentication](https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication)
- [WWW-Authenticate](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/WWW-Authenticate)
- [Authorization](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Authorization)
- [Basic](https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication#Basic_authentication_scheme)

# 带验证的servlet容器
```
public final class Bootstrap1 {
  public static void main(String[] args) {

  //invoke: http://localhost:8080/Modern or  http://localhost:8080/Primitive

    System.setProperty("catalina.base", System.getProperty("user.dir"));
    Connector connector = new HttpConnector();
    Wrapper wrapper1 = new SimpleWrapper();
    wrapper1.setName("Primitive");
    wrapper1.setServletClass("PrimitiveServlet");
    Wrapper wrapper2 = new SimpleWrapper();
    wrapper2.setName("Modern");
    wrapper2.setServletClass("ModernServlet");

    Context context = new StandardContext();
    // StandardContext's start method adds a default mapper
    context.setPath("/myApp");
    context.setDocBase("myApp");
    
    // 一个listener，Context启动时，注册Authenticator
    LifecycleListener listener = new SimpleContextConfig();
    ((Lifecycle) context).addLifecycleListener(listener);

    context.addChild(wrapper1);
    context.addChild(wrapper2);
    // for simplicity, we don't add a valve, but you can add
    // valves to context or wrapper just as you did in Chapter 6

    Loader loader = new WebappLoader();
    context.setLoader(loader);
    // context.addServletMapping(pattern, name);
    context.addServletMapping("/Primitive", "Primitive");
    context.addServletMapping("/Modern", "Modern");
    // add ContextConfig. This listener is important because it configures
    // StandardContext (sets configured to true), otherwise StandardContext
    // won't start

    // add constraint
    SecurityCollection securityCollection = new SecurityCollection();
    securityCollection.addPattern("/");
    securityCollection.addMethod("GET");

    SecurityConstraint constraint = new SecurityConstraint();
    constraint.addCollection(securityCollection);
    constraint.addAuthRole("manager");
    
    // 登录配置
    LoginConfig loginConfig = new LoginConfig();
    loginConfig.setRealmName("Simple Realm");
    
    // realm领域对象
    Realm realm = new SimpleRealm();
    context.setRealm(realm);
    context.addConstraint(constraint);
    context.setLoginConfig(loginConfig);

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
server和之前基本一样，多了：
- SimpleContextConfig：用于监听context start事件，注册Authenticator valve；
- LoginConfig；
- Realm；
- SecurityConstraint & SecurityCollection；

> Context不仅关联Realm，还关联SecurityConstraint、SecurityCollection。

## 监听context启动，注册Authenticator
```
  public void lifecycleEvent(LifecycleEvent event) {
    if (Lifecycle.START_EVENT.equals(event.getType())) {
      context = (Context) event.getLifecycle();
      authenticatorConfig();
      context.setConfigured(true);
    }
  }

  private synchronized void authenticatorConfig() {
    // Does this Context require an Authenticator?
    SecurityConstraint constraints[] = context.findConstraints();
    if ((constraints == null) || (constraints.length == 0))
      return;
    LoginConfig loginConfig = context.getLoginConfig();
    if (loginConfig == null) {
      loginConfig = new LoginConfig("NONE", null, null, null);
      context.setLoginConfig(loginConfig);
    }

    // Has an authenticator been configured already?
    Pipeline pipeline = ((StandardContext) context).getPipeline();
    if (pipeline != null) {
      Valve basic = pipeline.getBasic();
      if ((basic != null) && (basic instanceof Authenticator))
        return;
      Valve valves[] = pipeline.getValves();
      for (int i = 0; i < valves.length; i++) {
        if (valves[i] instanceof Authenticator)
        return;
      }
    }
    else { // no Pipeline, cannot install authenticator valve
      return;
    }

    // Has a Realm been configured for us to authenticate against?
    if (context.getRealm() == null) {
      return;
    }

    // Identify the class name of the Valve we should configure
    String authenticatorName = "org.apache.catalina.authenticator.BasicAuthenticator";
    // Instantiate and install an Authenticator of the requested class
    Valve authenticator = null;
    try {
      Class authenticatorClass = Class.forName(authenticatorName);
      authenticator = (Valve) authenticatorClass.newInstance();
      ((StandardContext) context).addValve(authenticator);
      System.out.println("Added authenticator valve to Context");
    }
    catch (Throwable t) {
    }
  }
```
当Context启动时，会触发start事件，调用所有的listener。该listener就在此时注册Authenticator valve：
1. Context没有constraint，无需认证；
2. Context没有LoginConfig，搞一个无需认证的`LoginConfig("NONE", null, null, null)`；
3. 检查pipeline里是否已经有Authenticator valve了，有了就不注册了；
4. Context没有Realm对象，无从认证，也不认证了；
5. 以上都通过，注册一个BasicAuthenticator到pipeline的value；

具体BasicAuthenticator验证的细节，可以参考`BasicAuthenticator#invoke`。

## realm配置
Realm是自定义的一个SimpleRealm，为了简单直接将用户名密码和对应的role（plain text）直接写到了代码里：
```
public class SimpleRealm implements Realm {

  public SimpleRealm() {
    createUserDatabase();
  }

  private Container container;
  private ArrayList users = new ArrayList();

  public Container getContainer() {
    return container;
  }

  public void setContainer(Container container) {
    this.container = container;
  }

  public String getInfo() {
    return "A simple Realm implementation";
  }

  public void addPropertyChangeListener(PropertyChangeListener listener) {
  }

  public Principal authenticate(String username, String credentials) {
    System.out.println("SimpleRealm.authenticate()");
    if (username==null || credentials==null)
      return null;
    User user = getUser(username, credentials);
    if (user==null)
      return null;
    return new GenericPrincipal(this, user.username, user.password, user.getRoles());
  }

  public Principal authenticate(String username, byte[] credentials) {
    return null;
  }

  public Principal authenticate(String username, String digest, String nonce,
    String nc, String cnonce, String qop, String realm, String md5a2) {
    return null;
  }

  public Principal authenticate(X509Certificate certs[]) {
    return null;
  }

  public boolean hasRole(Principal principal, String role) {
    if ((principal == null) || (role == null) ||
      !(principal instanceof GenericPrincipal))
      return (false);
    GenericPrincipal gp = (GenericPrincipal) principal;
    if (!(gp.getRealm() == this))
      return (false);
    boolean result = gp.hasRole(role);
    return result;
  }

  public void removePropertyChangeListener(PropertyChangeListener listener) {
  }

  private User getUser(String username, String password) {
    Iterator iterator = users.iterator();
    while (iterator.hasNext()) {
      User user = (User) iterator.next();
      if (user.username.equals(username) && user.password.equals(password))
        return user;
    }
    return null;
  }

  private void createUserDatabase() {
    User user1 = new User("ken", "blackcomb");
    user1.addRole("manager");
    user1.addRole("programmer");
    User user2 = new User("cindy", "bamboo");
    user2.addRole("programmer");

    users.add(user1);
    users.add(user2);
  }

  class User {

    public User(String username, String password) {
      this.username = username;
      this.password = password;
    }

    public String username;
    public ArrayList roles = new ArrayList();
    public String password;

    public void addRole(String role) {
      roles.add(role);
    }
    public ArrayList getRoles() {
      return roles;
    }
  }
}
```
它实现的authenticate方法就是根据用户名和密码获取Principal（其实就是获取role）。

> 正常应该解析`tomcat-user.xml`或者从数据库获取。

## SecurityConstraint & SecurityCollection & LoginConfig
其实就是web.xml里的`<security-constraint>`、`<web-resource-collection>`和`<login-config>`，**声明哪些资源只有哪些身份能访问**，声明用户如何认证role。

> 正常应该解析`web.xml`获取。


