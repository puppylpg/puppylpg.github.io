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
接口是JDBC的核心，明白了接口，就明白了jdbc的设计理念。每一个jdbc的实现者无非就是具体的实现细节罢了。
- `Connection`：首先要有`Connection`代表程序和数据库的连接，**其实就是在配置数据库信息**；
- `Statement`：Statement用于执行SQL，它相当于一个**有状态的client**，因为它需要维护与数据库的连接和**执行状态**；
- `ResultSet`：代表返回结果，相当于response；

示例代码：
```java
Connection conn = ...
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery("SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'");

while (rs.next()) {
    int id = rs.getInt("id");
    ...
}
```

在介绍`Connection`和jdbc的设计之前，先简单介绍这些接口的作用。

## `Connection`
每个`Connection`对象都代表一个到MySQL数据库的物理连接。当我们通过JDBC连接到MySQL数据库时，会话（Session）是在连接建立时创建的。因此，每个JDBC连接都会创建一个新的MySQL会话。

如果需要设置session variable或者global variable，可以设置到`Connection`上：
```java
Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/my_database", "username", "password");
Statement stmt = conn.createStatement();
stmt.execute("SET @my_variable = 'my_value'");
// 或者
stmt.execute("SET SESSION my_variable = 'my_value'");
```

```java
Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/my_database", "username", "password");
Statement stmt = conn.createStatement();
stmt.execute("SET GLOBAL my_variable = 'my_value'");
```
**一种更简单的方案是把session变量直接加到jdbc的url上，比如`jdbc:mysql://localhost:3306/my_database?sessionVariables=k1=v1,k2=v2&other_param=value`。这样创建出来的每一个`Statement`都已经设置了session variable**。

> 但是我觉得这种方法可能容易遗忘，抄url的时候可能抄的不是这一条，session variable就忘了设置了。

## `Statement`/`PreparedStatement`
它代表了一个sql语句的执行者，如上例所示。但是因为它是有状态的，要维护当前sql的执行状态，所以不能并发执行sql。**如果想并发，那就创建多个`Statement`对象，每个对象执行一个sql**。如果在没处理完数据之前就再次发起`execute`动作，会清掉上一次的`ResultSet`：
> All execution methods in the Statement interface implicitly close a current ResultSet object of the statement if an open one exists.

由于它主要用来执行sql，因此它的主要方法是：
- `boolean execute(String sql) throws SQLException`

代表执行sql，所以拿sql作为参数。

### 有状态
关于`Statement`是有状态的，其实看它的方法签名就能感受到了。`execute`方法执行完后，返回的是boolean，它的javadoc说明如下：
> true if the first result is a `ResultSet` object; false if it is an update count or there are no results
> 
> The execute method executes an SQL statement and indicates the form of the first result. You must then use the methods `getResultSet` or `getUpdateCount` to retrieve the result, and `getMoreResults` to move to any subsequent result(s).

所以**要根据boolean值决定接下来通过`Statement#getResultSet`获取结果集，或者获取数据更新的行数`Statement#getUpdateCount`**。很明显`Statement`是要保存这些状态的。

### sql注入
**使用`Statement`有被sql注入的风险**！比如上面的例子：
```java
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery("SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'");
```
如果用户输入的username为`'; DROP TABLE users; --`，拼接出来的sql语句就成了：
```sql
SELECT * FROM users WHERE username = ''; DROP TABLE users; --' AND password = '';
```
1. 执行一个select操作，过滤条件是username为空；
2. drop users表；
3. 后面的部分被`--`注释掉了；

所以好好的一个select语句，变成了drop table，执行完之后，users表没了……

**被sql攻击的主要原因是`Statement`没有区分清楚哪里是sql语句，哪里是sql参数，因为他们被拼到一起传给`Statement`了**。

所以就有了`PreparedStatement`接口，**它代表一条预编译的sql执行者，和一条sql强绑定**。它的用法如下：
```java
String sql = "SELECT * FROM users WHERE username = ? AND password = ?";
PreparedStatement pstmt = connection.prepareStatement(sql);

pstmt.setString(1, username);
pstmt.setString(2, password);

ResultSet rs = stmt.executeQuery();
```
1. 创建`PreparedStatement`的时候，必须提供sql模板，参数部分用问号代替；
2. 通过`PreparedStatement`提供的方法设置值，1代表第0个参数，**不是从0开始数的，有点儿反程序员了**；

执行的时候不再像`Statement`一样需要提供sql，所以它的执行方法是无参的：
- `ResultSet executeQuery() throws SQLException`

它和普通`Statement`最大的不同是：**sql模板和sql参数分次提供，所以二者能区分开来，确保参数值不会被误认为sql代码**。如果用户输入的username是`'; DROP TABLE users; --`，`PreparedStatement`知道它是参数，会给它加上引号，sql语句变成：
```sql
SELECT * FROM users WHERE username = "'; DROP TABLE users; --" AND password = '';
```
1. 执行一条select语句，username为`"'; DROP TABLE users; --"`，password为空；

这样就不会发生sql注入问题了。所以**建议使用`PreparedStatement`而非`Statement`**。

`PreparedStatement`的另一个好处就是性能比较高：预编译 SQL 查询语句可以避免重复编译和优化 SQL 查询语句的开销，从而提高查询的执行效率。

# JDBC设计理念
## `Connection`的获取
`Connection`对象的创建取决于不同的实现者，比如mysql：
```java
properties info = new Properties();
info.put("host", "localhost");
...
Connection conn = new MySQLConnectionImpl(info);
```
这里`MySQLConnectionImpl`代表MySQL提供的Connection接口的具体实现。

或者h2：
```java
Connection conn = new org.h2.jdbc.JdbcConnection(String url, Properties info, String user, Object password, boolean forbidCreation);
```
其实他们的入参都差不多，和使用`mysql` cli客户端相似，无非就是：
- host
- port
- user
- password

或者也可以用一个完整的url体现出来：`jdbc:mysql://localhost:3306/<db_name>?param1=value1&param2=value2`。

**但是直接在代码里new一个`Connection`出来并不明智，这样的话代码就和依赖的具体driver绑定了**，即使一直使用MySQL，不会换成其他的数据库，依然在升级driver版本后有编译不过的风险。比如**上面的`com.mysql.jdbc.MySQLConnectionImpl`，在`mysql-connector-java.jar`的8.0+版本里，名字改成了`com.mysql.cj.jdbc.ConnectionImpl`，包名类名都变了**。也就是说一个程序如果之前用的低版本mysql jdbc driver，升级到8之后，程序就编译不过了。所以不能直接拿第三方依赖里的实现名作为写代码的标准。

> 其实更准确的说，没有一个接口来屏蔽这个具体实现的细节，说明这套接口设计的有缺陷。升级了一下mysql driver的版本，代码编译不过了，崩溃不？

## `Driver` - 屏蔽实现细节
所以JDBC还定义了`Driver`接口，MySQL实现这个接口，返回一个自己的driver，能直接用这个driver获取到`Connection`。至于mysql用啥实现`Connection`的，我们不关心：
```java
interface Driver {

    Connection getConnection(Properties info);
}
```
在`mysql-connector-java-xxx.jar`中：
```java
public class MysqlDriver implements Driver {

    public Connection getConnection(Properties info) {
        // 实现细节被屏蔽在这里了！
        return new MySqlConnectionImpl(info);
    }
}
```
当然，其他比如`oracle-jdbc.jar`等也类似。

此时程序可以使用驱动包实例化driver：
```java
Driver driver = new MysqlDriver(info);
```
现在，升级各个版本的mysql driver都能保证编译通过。但是，这只做到了mysql层面的依赖解耦。如果想从mysql切换到oracle，这又要改代码啊：把`new MysqlDriver(info)`改成`new OracleDriver(info)`，并不能无缝切换。

这个时候就会想到配置，把要使用的数据库写到配置里！

比如，**把mysql的`Driver`类名写在配置里**，然后使用反射new出相应driver的实现类，这样代码又变成通用的了：
```java
driverName = "com.mysql.jdbc.Driver"
...

Class<?> clazz = Class.forName(driverName);
Driver driver = (Driver)clazz.newInstance();
Connection conn = driver.getConnection(info);
```
配置是肯定免不了的，毕竟用哪个数据库只有我们自己知道，总需要在一个地方体现出来。

> **除非像spring boot一样，发现有哪个数据库的lib，就自动创建那个数据库的driver，通过引入的lib来标识自己想用的数据库**。但jdk又没有“自动装配”这种东西。

但是必须得用反射就很不合理了，一个好的设计应该把这些屏蔽起来！

## `DriverManager` - 注册中心
**jdk虽然不像spring boot能搞bean的自动装配，但英雄所见略同**：用一个容器管理所有数据库的 driver，需要用哪个直接写到配置里，按照配置来容器里取`Driver`就行了。

这个db driver的容器，或者说注册中心，就是`DriverManager`，一个manage driver的地方：
- `getDriver`
- `getConnection`，或者先`getDriver`，再调用driver的`connect`获取`Connection`；

`DriverManager`逻辑实现示例：
```java
public class DriverManager {
    private static List<Driver> registeredDrivers = new ArrayList<>();
    
    // 从注册中心选择合适的driver返回connection。这里给个很弱的实现：遍历注册中心
    public static Connection getConnection(Properties info) {
        for (Driver driver : registeredDrivers) {
            
            // 判断driver是否符合条件
            // 一般是通过info里配置的db url，判断driver能否解析该url
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

此时`mysql-connector-java-xxx.jar`中MysqlDriver的实现，主要是负责把自己注册到`DriverManager`上：
```java
public class MysqlDriver implements Driver {

    // 如果类加载，就注册（安装）该driver
    static {
        DriverManager.register(new MysqlDriver());
    }

    // 判断url是否符合mysql driver的要求
    public Connection getConnection(Properties info) {
        if (info.get("url").startsWith("jdbc:mysql")) {
            return new MySqlConnectionImpl(info);
        }
    }
}
```
**如果我们想用mysql driver，就调用`Class.forName(xxx)`，这样就会加载这个Driver类，与此同时，静态代码块里的代码就会被执行，mysql driver被注册到`DriverManager`**：
```java
Class.forName("com.mysql.jdbc.Driver");
Connection conn = DriverManager.getConnection(info);
```

如果是spring boot，一般只需要如下配置：
- `spring.datasource.driverClassName=com.mysql.jdbc.Driver`
- `spring.datasource.url=jdbc:mysql://localhost:3306/dbName?characterEncoding=UTF-8`
- `spring.datasource.username=xxx`
- `spring.datasource.password=xxx`

总结：jdk做不到**自动加载bean**，所以就需要程序猿通过**显式手动**调用（`Class.forName("com.mysql.jdbc.Driver")`）的方式，达到注册driver的目的。

# SPI - 自动发现、自动注册
jdk：我真的不能自动注册吗？

也未必。

自动注册，本质上就是有一个约定好的东西，只要这东西存在，框架就执行相关逻辑，加载、组装一些bean。

这个“约定好的东西”，在spring boot里是classpath上的包（或者说相关class）。而jdk 1.6起，则是定义了一套SPI（Service Provider Interface）机制，**这里“约定好的东西”，就是`META-INF/services/<类名>`文件**。

SPI机制相当简单：
1. jdk提供接口`S`；
2. 供应商提供：
    1. 实现类`S1`；
    2. jar包里提供`META-INF/services/<类名S>`文件，文件内容为具体的实现类的类名`S1`、`S2`等，可以有多个；
4. jdk使用`ServiceLoader#load(Class<S>)`寻找`S`这个接口对应的上述文件，读取内容，实例化里面记录的具体实现类`S1`、`S2`等；
5. 之后就可以从`ServiceLoader#iterator`获取`S1`、`S2`对象了；

对于`Driver`接口而言，现在可以这么操作：
1. 引入mysql的jar包；
2. 里面有`META-INF/services/java.sql.Driver`这个文件，记录了`com.mysql.cj.jdbc.Driver`；
3. `DriverManager`根据SPI规范，使用`ServiceLoader`读取该文件，实例化mysql提供的`Driver`实现类：`com.mysql.cj.jdbc.Driver`；

所以`DriverManager`就“自动注册”了mysql提供的driver实现。

当然如果使用了多个driver供应商，会有多个这种文件，`DriverManager`就能通过`ServiceLoader`把他们全扒拉出来，持有他们的实例。

`DriverManager`比较特殊，它利用了spi机制，但又没有使用`ServiceLoader`。它通过spi找到了driver实现类，并new了实例，然后并没有保存到`ServiceLoader`里。因为在有`ServiceLoader`之前，每个`Driver`接口的实现类都有静态代码块，通过`registerDriver`将自己主动注册到`DriverManager`上，而只要new他们，就一定会在此之前触发静态代码块里的自动注册driver到`DriverManager`的逻辑。既然如此，还接着用`DriverManager`就行了，`ServiceLoader`就没必要用了：
```java
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

> 通过静态代码块注册，只要new这个实例，肯定就加载了这个类，执行了静态代码块，注册行为也就完成了。

**所以`DriverManager`相当于只是通过`ServiceLoader`自动触发了所有的driver实现类的类加载**，所有的Driver还是注册到了`DriverManager`上，`ServiceLoader`只是当了个工具人。**`Driver`并没有被它所持有**，它通用的`iterator`方法获取所持有的实例的功能，在这里也没有派上用场。

## ~~`Class.forName("com.mysql.cj.jdbc.Driver")`~~
**在JDBC4.0之前，因为没有`ServiceLoader`，这种触发行为必须是手动的**：
```java
Class.forName("com.mysql.cj.jdbc.Driver")
```
**在JDBC 4之后（同时搭配jdk 1.6+），这个必须手写的操作就过时了，注册行为可以按照SPI标准自动完成了**。

- https://stackoverflow.com/a/18297412/7676237

## JDBC 4
2006年，JSR221，Java SE6。

java6才开始有`ServiceLoader`，所以能实现自动注册行为的触发了。

JDBC4新特性：
> **Autoloading of JDBC drivers**: In earlier versions of JDBC, applications had to manually register drivers before requesting Connections. With JDBC 4.0, applications no longer need to issue a Class.forName() on the driver name; instead, the DriverManager will find an appropriate JDBC driver when the application requests a Connection.

# `DataSource` - JDBC连接池
事情到了`DriverManager`，JDBC似乎已经结束了：这个容器能注册`Driver`（甚至能通过spi机制自动注册），拥有了获取`Driver`（或者`Connection`）的能力，好像从功能上来讲已经完备了。

但性能上，还有很多可以做文章的地方。

## 性能
数据库连接创建一个不容易，又要socket建立TCP连接，又要应用层握手协议，还有些用了`PreparedStatement`，得提前通知数据库做预编译，结果用一次就关了？？？wtf！还有的干脆关都不关……

为了提升性能，可以模仿线程池，搞一个jdbc连接池，常驻一些数据库连接：
1. 不用无限制创建数据库链接了……总不能连10000次就创建10000次吧……
2. 访问数据库更快了，省了很多创建连接的时间；
3. 复用之前`Connection`的`PreparedStatement`，不用老是找数据库预编译了；

## `DataSource`：`DriverManager`的替代者
所以jdk 1.4起，又引入了一个新接口`DataSource`。看它的doc就明白了：
> 代表和实体数据库连接的`Connection`的工厂，可以从里面取`Connection`。是`DriverManager`的替代品。它和`DriverManager`都有`getConnection`方法。

`DataSource`说白了**就是把`DriverManager`再封装一层，增加一个池化的功能，同时只暴露`getConnection`接口。**

> `DataSource`可以有基础实现，也可以是池化实现，还可以是分布式实现。一般用得最多的就是池化的。

它的接口比`DriverManager`更简单，就一套方法：
- `getConnection`

## 实现
这个`Connection`是怎么得到的？

**最简单最简单的实现，就是`DataSource`封装一个`DriverManager`**，`Connection`最初从`DriverManager`里得到（`DriverManager`是从`Driver#connect`得到`Connection`的），然后这个`Connection`留着，别释放，放到池里（**最简陋的实现：拿一个list当池就行**），下次再用的时候就不从`DriverManager`获取了，而是直接从池里获取。

这里以hikari `DataSource`为例，看看它的实现：
1. **`DriverDataSource`，一个最最基本的`DataSource`实现**，需要`Connection`就从`Driver`里拿：
    1. driver是从`DriverManager`里拿到的（jdbc4规范规定的取法）；
    2. 如果没从`DriverManager`里拿到，同时配置了driver class name，就直接使用反射获取driver实现类（jdbc4之前的取法）；
2. hikari的`PoolBase`就是hikari的连接池的基础抽象实现。需要`Connection`的时候，它的`newConnection`方法就是通过上述`DriverDataSource`获取一个`Connection`，然后将它封装为`PoolEntry`；
3. `HikariPool`作为`PoolBase`的实现，管理`PoolEntry`；
4. 最终，`HikariDataSource`作为`DataSource`的实现，实际上功能基本都委托给`HikariPool`了，实现池化的`DataSource`；

**所以hikari真正需要白手起家创建`Connection`的时候，就找`DriverManager`获取`Driver`，创建`Connection`；有了`Connection`之后，留下来，以一个`HikariPool`保存它，下次要用`Connection`了直接从里面拿，不再去求`DriverManager`了。** 现在起，`Connection`是一个能复用的东西了！

> 从`HikariPool`中返回的是一个由`ProxyFactory`创建的`ProxyConnection`，**它的close方法不是关闭`Connection`，而是把`Connection`还给pool**。

所以`DataSource`和`DriverManager`一样，都得设置jdbcurl，username，password。本质上这些都是为`DriverManager`设置的。

> 题外话：`mysql-connector-java.jar`里，也有一个不池化的`DataSource`实现：`MySQLDataSource`。
>
> 它还有一个池化的实现：`MySQLConnectionPoolDataSource`，不过用的是自定义的`getPooledConnection`，而不是标准的jdk `DataSource`接口。

所以，现在大家都配置`DataSource`了，`DriverManager`就被`DataSource`隐藏了。

# 总结
最后完整看一下使用jdbc访问数据库的代码：
```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public class JdbcExample {
    public static void main(String[] args) {
        Connection conn = null;
        PreparedStatement pstmt = null;
        ResultSet rs = null;

        try {
            // 注册JDBC驱动
            Class.forName("com.mysql.cj.jdbc.Driver");

            // 建立JDBC连接
            String url = "jdbc:mysql://localhost:3306/my_database";
            String user = "username";
            String password = "password";
            conn = DriverManager.getConnection(url, user, password);

            // 执行查询
            String sql = "SELECT column1, column2 FROM my_table WHERE id = ?";
            pstmt = conn.prepareStatement(sql);
            pstmt.setInt(1, 123);
            rs = pstmt.executeQuery();

            // 处理结果
            while (rs.next()) {
                String column1Value = rs.getString("column1");
                int column2Value = rs.getInt("column2");
                System.out.println("column1: " + column1Value + ", column2: " + column2Value);
            }
        } catch (ClassNotFoundException e) {
            e.printStackTrace();
        } catch (SQLException e) {
            e.printStackTrace();
        } finally {
            // 释放资源
            try {
                if (rs != null) {
                    rs.close();
                }
                if (pstmt != null) {
                    pstmt.close();
                }
                if (conn != null) {
                    conn.close();
                }
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
    }
}
```
或者用try-with-resources简化一下：
```java
try (Connection conn = DriverManager.getConnection(url, user, password);
     PreparedStatement pstmt = conn.prepareStatement(sql);
     ResultSet rs = pstmt.executeQuery()) {
    // 执行查询并处理结果
} catch (SQLException e) {
    e.printStackTrace();
}
```

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public class JdbcExample {
    public static void main(String[] args) {
        String url = "jdbc:mysql://localhost:3306/my_database";
        String user = "username";
        String password = "password";
        String sql = "SELECT column1, column2 FROM my_table WHERE id = ?";

        try (Connection conn = DriverManager.getConnection(url, user, password);
             PreparedStatement pstmt = conn.prepareStatement(sql)) {

            pstmt.setInt(1, 123);
            try (ResultSet rs = pstmt.executeQuery()) {
                while (rs.next()) {
                    String column1Value = rs.getString("column1");
                    int column2Value = rs.getInt("column2");
                    System.out.println("column1: " + column1Value + ", column2: " + column2Value);
                }
            }
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }
}
```
如果带上事务提交和回滚，就更麻烦了：
```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public class JdbcTransactionExample {
    public static void main(String[] args) {
        String url = "jdbc:mysql://localhost:3306/my_database";
        String user = "username";
        String password = "password";
        String insertSql = "INSERT INTO my_table (column1, column2) VALUES (?, ?)";

        try (Connection conn = DriverManager.getConnection(url, user, password);
             PreparedStatement pstmt = conn.prepareStatement(insertSql)) {

            conn.setAutoCommit(false); // 开启事务

            pstmt.setString(1, "value1");
            pstmt.setInt(2, 123);
            pstmt.executeUpdate();

            // 执行更多的数据库操作...

            // 多个步骤执行完毕，提交事务
            conn.commit();
        } catch (SQLException e) {
            e.printStackTrace();
            // 回滚事务
            try {
                if (conn != null) {
                    conn.rollback();
                }
            } catch (SQLException ex) {
                ex.printStackTrace();
            }
        }
    }
}
```
如果带上savepoint，再窒息一点儿：
```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Savepoint;

public class JdbcSavepointExample {
    public static void main(String[] args) {
        String url = "jdbc:mysql://localhost:3306/my_database";
        String user = "username";
        String password = "password";
        String insertSql = "INSERT INTO my_table (column1, column2) VALUES (?, ?)";

        try (Connection conn = DriverManager.getConnection(url, user, password);
             PreparedStatement pstmt = conn.prepareStatement(insertSql)) {

            conn.setAutoCommit(false); // 开启事务

            pstmt.setString(1, "value1");
            pstmt.setInt(2, 123);
            pstmt.executeUpdate();

            Savepoint savepoint = conn.setSavepoint("savepoint1"); // 设置保存点

            pstmt.setString(1, "value2");
            pstmt.setInt(2, 456);
            pstmt.executeUpdate();

            // 执行更多的数据库操作...

            conn.commit(); // 提交事务
        } catch (SQLException e) {
            e.printStackTrace();
            // 回滚到保存点或整个事务
            try {
                if (conn != null) {
                    if (savepoint != null) {
                        conn.rollback(savepoint);
                    } else {
                        conn.rollback();
                    }
                }
            } catch (SQLException ex) {
                ex.printStackTrace();
            }
        }
    }
}
```

虽然jdbc写出来的代码被诟病繁琐，并出现了很多基于jdbc的高层封装，比如spring jdbc、mybatis、hibernate等，但jdbc永远是其基石，这一点也就决定了jdbc是无可撼动的。

一些关于jdbc的不错文章：
- jdbc：https://www.marcobehler.com/guides/jdbc
- 更高级的框架：https://www.marcobehler.com/guides/java-databases

