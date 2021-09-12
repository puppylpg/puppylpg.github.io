---
layout: post
title: "JDBC与SPI"
date: 2021-09-12 23:35:02 +0800
categories: Java jdbc spi
tags: Java jdbc spi
---

JDBC（Java Database Connectivity）是一套Java访问数据库的标准。想了解标准，主要看一下JDBC定义的一套接口，以及这套接口是怎么和具体实现绑定起来的。

> Java很多东西都是“只定义接口，具体实现由各个厂商负责”。JDBC就是一个接口，实现都由各大数据库提供。

1. Table of Contents, ordered
{:toc}

# 底层访问：socket
MySQL有ip和端口号，Java通过socket和MySQL建立TCP连接，发送约定好的协议（应用层协议），得到数据。

但是直接通过socket编程太低级：
1. 各个数据库的应用层协议可能根本不兼容；
2. socket编程有太多协议细节要处理；

所以需要有一个抽象层屏蔽这些细节，否则无法做到各数据库之间使用同一套代码。

这个抽象层就是JDBC的接口。

# 接口
- `Connection`;
- `Statement`;
- `ResultSet`;

要有Connection代表程序和数据库的连接，能创建Statement执行SQL，还得有代表返回结果的ResultSet。

```
Connection conn = ...
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery("select * from xxx");

while (rs.next()) {
    int id = rs.getInt("id");
    ...
}
```

## `Connection`的获取
```
properties info = new Properties();
info.put("host", "localhost");
...
Connection conn = new MySQLConnectionImpl(info);
```
这里`MySQLConnectionImpl`代表MySQL提供的Connection接口的具体实现。这么一来，代码就和依赖的mysql driver包绑定了，如果MySQL提供的lib实现在新版本中把`MySQLConnectionImpl`的名字改了，程序就编译不过了。所以不能直接拿第三方依赖里的实现名作为编码标准。

> 其实更准确的说，没有一个接口来屏蔽这个具体实现的细节，说明这套接口设计的有缺陷。升级了一下mysql driver的版本，代码编译不过了，崩溃不？

## `Driver` - 屏蔽实现细节
所以jdk定义了Driver接口，MySQL实现这个接口，返回一个自己的driver，能直接用这个driver获取到Connection。至于mysql用啥实现Connection的，我们不关心：
```
interface Driver {
    Connection getConnection(Properties info);
}
```
在`mysql-connector-java-xxx.jar`中：
```
public class MysqlDriver implements Driver {
    public Connection getConnection(Properties info) {
        // 看，实现细节被屏蔽在这里了！
        return new MySqlConnectionImpl(info);
    }
}
```
当然，其他比如`oracle-jdbc.jar`等也类似。

此时程序可以使用驱动包实例化driver：
```
Driver driver = new MysqlDriver(info);
```
现在，升级各个版本的mysql driver都能保证编译通过。但是，这只做到了mysql层面的依赖解耦。

如果想从mysql切换到oracle，这又要改代码啊：把`new MysqlDriver(info)`改成`new OracleDriver(info)`，并不能无缝切换。

配置？把要使用的数据库写到配置里！

把需要用的类名写在配置里，然后使用反射new出相应driver的实现类，这样代码又变成通用的了：
```
driverName = "com.mysql.jdbc.Driver"
...

Class<?> clazz = Class.forName(driverName);
Driver driver = (Driver)clazz.newInstance();
Connection conn = driver.getConnection(info);
```
配置是肯定免不了的，毕竟用哪个数据库只有我们自己知道，总需要在一个地方体现出来。**除非像spring boot一样，发现有哪个数据库的lib，就自动创建那个数据库的driver，通过引入的lib来标识自己想用的数据库**。但jdk又没有“自动装配”这种东西。

但是必须得用反射就很不合理了，一个好的设计应该把这些屏蔽起来！

## `DriverManager` - 注册中心
**jdk虽然不像spring boot能搞bean的自动装配，但英雄所见略同**：用一个容器管理所有的db driver，需要用哪个直接写到配置里，按照配置来容器里取就行了。

这个db driver的容器，或者说注册中心，就是`DriverManager`，一个manage driver的地方：
- `getDriver`
- `getConnection`，或者先`getDriver`，再调用driver的`connect`获取connection；

DriverManager逻辑实现示例：
```
public class DriverManager {
    private static List<Driver> registeredDrivers = new ArrayList<>();
    
    // 一个个看driver能不能返回合适的Connection
    public static Connection getConnection(Properties info) {
        for (Driver driver : registeredDrivers) {
            // 一般是通过info里配置的db url，判断能不能找到一个能解析该url的driver
            Connection conn = driver.getConnection(info);
            if (conn != null) {
                return conn;
            }
        }
        // 如果一个合适的driver都没有
        throw new RuntimeException("木有你想要的driver")；
    }
    
    public static void reigster(Driver driver) {
        if (!registeredDrivers.contains(driver)) {
            registeredDrivers.add(driver);
        }
    }
}
```
**DriverManager通过所配置的db的url**，从注册到自己上面的drivers里检索出一个匹配的，创建Connection。

关键在于：**driver是怎么注册到DriverManager上的**？

此时`mysql-connector-java-xxx.jar`中MysqlDriver的实现，主要是负责把自己注册到DriverManager上：
```
public class MysqlDriver implements Driver {

    // 如果类加载，就注册（安装）该driver
    static {
        DriverManager.register(new MysqlDriver());
    }

    // 是MySQL，我就返回Connection
    public Connection getConnection(Properties info) {
        if (info.get("url").startsWith("jdbc:mysql")) {
            return new MySqlConnectionImpl(info);
        }
    }
}
```
如果我们想用mysql driver，就调用`Class.forName(xxx)`，**这样就会加载这个Driver类，与此同时，静态代码块里的代码就会被执行，mysql driver被注册到DriverManager**：
```
Class.forName("com.mysql.jdbc.Driver");
Connection conn = DriverManager.getConnection(info);
```

一般的配置：
> mysql.driver.class=com.mysql.cj.jdbc.Driver
>
> mysql.online.db.url=jdbc:mysql://host:3306/dbName?characterEncoding=UTF-8

总结：jdk做不到 **自动** 加载bean，所以就需要程序猿通过 **显式手动** 调用的方式，达到注册driver的目的。

# SPI - 自动发现、自动注册
jdk：我真的不能自动注册吗？

也未必。

自动注册，本质上就是有一个约定好的东西，这东西只要存在，框架就执行相关逻辑，加载、组装一些bean。

这个“约定好的东西”，在spring boot里是classpath上的包（或者说相关class）。而jdk 1.6起，则是定义了一套SPI（Service Provider Interface）机制，这里“约定好的东西”，就是`META-INF/services/<类名>`文件。

SPI机制相当简单：
1. jdk提供接口`S`；
2. 供应商提供实现类`S'`；
3. 供应商的jar包提供`META-INF/services/<类名S>`的文件，文件内容为具体的实现类的类名`S'`、`S''`等，可以有多个；
4. jdk使用`ServiceLoader#load(Class<S>)`寻找`S`这个接口对应的上述文件，读取内容，实例化里面记录的具体实现类；
5. 之后就可以从`ServiceLoader#iterator`获取类了；

对于Driver接口而言，现在可以这么操作：
1. 我们引入mysql的jar包；
2. 里面有`META-INF/services/java.sql.Driver`这个文件，记录了`com.mysql.cj.jdbc.Driver`；
3. DriverManager根据SPI规范，使用ServiceLoader读取该文件，实例化mysql提供的Driver实现类：`com.mysql.cj.jdbc.Driver`；

所以DriverManager就“自动注册”了mysql提供的driver实现。

当然如果使用了多个driver供应商，会有多个这种文件，DriverManager就能通过ServiceLoader把他们全扒拉出来，持有他们的实例。

但是DriverManager特殊的地方在于，它实际上并没有保留ServiceLoader获取到的driver，相当于只是new了一下每个driver就扔了。因为如前文所述，在有ServiceLoader之前，每个Driver接口的实现类都有静态代码块，通过`registerDriver`将自己主动注册到DriverManager上：

```
public class Driver extends NonRegisteringDriver implements java.sql.Driver {
    //
    // Register ourselves with the DriverManager
    //
    static {
        try {
            java.sql.DriverManager.registerDriver(new Driver());
        } catch (SQLException E) {
            throw new RuntimeException("Can't register driver!");
        }
    }

    /**
     * Construct a new driver and register it with DriverManager
     * 
     * @throws SQLException
     *             if a database error occurs.
     */
    public Driver() throws SQLException {
        // Required for Class.forName().newInstance()
    }
}
```
通过静态代码块注册，所以只要new这个实例，肯定就加载了这个类，执行了静态代码块，注册行为也就完成了。

**所以DriverManager相当于只是通过ServiceLoader自动触发了所有的driver实现类的类加载**，所有的Driver还是注册到了DriverManager上，ServiceLoader只是当了个工具人。**Driver并没有被它所持有**，它通用的`iterator`方法获取所持有的实例的功能，在这里也没有派上用场。

**在JDBC4.0之前，因为没有ServiceLoader，这种触发行为必须是手动的**：
```
Class.forName("com.mysql.cj.jdbc.Driver")
```
**JDBC 4之后（同时搭配jdk 1.6+），这个必须手写的操作就过时了，注册行为可以按照SPI标准自动完成了**。

- https://stackoverflow.com/a/18297412/7676237

## JDBC 4
2006年，JSR221，Java SE6。

java6才开始有ServiceLoader，所以能实现自动注册行为的触发了。

JDBC4新特性：
> **Autoloading of JDBC drivers**: In earlier versions of JDBC, applications had to manually register drivers before requesting Connections. With JDBC 4.0, applications no longer need to issue a Class.forName() on the driver name; instead, the DriverManager will find an appropriate JDBC driver when the application requests a Connection.

# `DataSource` - JDBC连接池
事情到了DriverManager，JDBC似乎已经结束了：这个容器能注册Driver（甚至能通过ServiceLoader自动注册），拥有了获取Driver（或者Connection）的功能，好像从功能上来讲已经完备了。

但性能上，还有很多可以做文章的地方。

## 性能
数据库连接创建一个不容易，又要socket建立TCP连接，又要应用层握手协议，还有些用了PreparedStatement，得提前通知数据库做预编译，结果用一次就关了？？？wtf！还有的干脆关都不关……

为了提升性能，可以模仿线程池，搞一个jdbc连接池，常驻一些数据库连接：
1. 不用无限制创建数据库链接了……总不能连10000次就创建10000次吧……
2. 访问数据库更快了，省了很多创建连接的时间；
3. 复用之前Connection的PreparedStatement，不用老是找数据库预编译了；

## DriverManager的替代者
所以jdk 1.4起，又引入了一个新接口`DataSource`。看它的doc就明白了：
> 代表和实体数据库连接的connection的工厂，可以从里面取connection。是DriverManager的替代品。它和DriverManager都有getConnection方法。

DataSource可以有基础实现，也可以是池化实现，还可以是分布式实现。一般用得最多的就是池化的。

DataSource说白了**就是把DriverManager再封装一层，增加一个池化的功能，同时只暴露getConnection接口。**

接口比DriverManager更简单，就一套方法：
- `getConnection`

## 实现
这个connection是怎么得到的？

**最简单最简单的实现，就是DataSource封装一个DriverManager**，connection最初从DriverManager里得到（DriverManager是从Driver#connect得到connection的），然后这个connection留着，别释放，放到池里（**最简陋的实现：拿一个list当池就行**），下次再用的时候就不从DriverManager获取了，而是直接从池里获取。

这里以hikari DataSource为例，看看它的实现：
1. **DriverDataSource，一个最最基本的DataSource实现**，需要connection就从Driver里拿：
    1. driver是从DriverManager里拿到的（jdbc4规范规定的取法）；
    2. 如果没从DriverManager里拿到，同时配置了driver class name，就直接使用反射获取driver实现类（jdbc4之前的取法）；
2. hikari的PoolBase就是hikari的连接池的基础抽象实现。需要connection的时候，它的`newConnection`方法就是通过上述DriverDataSource获取一个connection，然后将它封装为PoolEntry；
3. HikariPool作为PoolBase的实现，管理PoolEntry；
4. 最终，HikariDataSource作为DataSource的实现，实际上功能基本都委托给HikariPool了，实现池化的DataSource；

**所以hikari真正需要白手起家创建Connection的时候，就找DriverManager获取Driver，创建Connection；有了Connection之后，留下来，以一个HikariPool保存它，下次要用Connection了直接从里面拿，不再去求DriverManager了。** 现在起，Connection是一个能复用的东西了！

> 从HikariPool中返回的是一个由ProxyFactory创建的`ProxyConnection`，而它的close方法就是把Connection还回pool。

所以DataSource和DriverManager一样，都得设置jdbcurl，username，password。本质上这些都是为DriverManager设置的。

> 题外话：mysql-connector-java包里，也有一个不池化的DataSource实现：MySQLDataSource。
>
> 它还有一个池化的实现：MySQLConnectionPoolDataSource，不过用的是自定义的getPooledConnection，而不是标准的jdk DataSource接口。

所以，现在大家都配置DataSource了，DriverManager就被DataSource隐藏了。

一些关于jdbc的不错文章：
- jdbc：https://www.marcobehler.com/guides/jdbc
- 更高级的框架：https://www.marcobehler.com/guides/java-databases

