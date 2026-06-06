---
layout: post
title: "Spring - Data Access & Transaction"
date: 2022-08-01 01:56:11 +0800
categories: spring jdbc orm
tags: spring jdbc orm
---

Java定义了jdbc（Java Database Connectivity）规范作为数据库的访问标准。虽然DataSource的实现交给了各个数据库厂商，我们只需要引入相应的包就可以获取相应的DataSource实现类进行数据库的访问工作，但是jdbc整套流程还是太过刻板了。

> 关于JDBC规范和实现，参考：[JDBC与SPI]({% post_url 2021-09-12-jdbc-and-spi %})

1. Table of Contents, ordered
{:toc}

# 刻板的JDBC
jdbc的标准步骤比较多，主要是因为要处理的事情比较多：
- 定义数据源；
- 从数据源获取连接；
- 准备sql语句；
- 开启事务；
- 在事务中进行数据访问操作；
- 如果是分阶段提交的事务，可能还要设置savepoint；
- 提交事务，或者在异常的情况下回滚事务，也可能只回滚到某个savepoint而非回滚整个事务；
- 关闭资源，关闭的时候还可能发生异常，记得处理；

假设定义好了DataSource：
```java
    @Bean("hikari")
    public DataSource hikari() {
        HikariConfig config = new HikariConfig();
        // 启动h2时初始化sql脚本
        config.setJdbcUrl("jdbc:h2:mem:pokemon;DB_CLOSE_DELAY=-1;MODE=MySQL;INIT=RUNSCRIPT FROM 'classpath:scripts/init.sql'");
        config.setUsername("sa");
        config.setPassword("password");
        config.setDriverClassName(org.h2.Driver.class.getName());
        return new HikariDataSource(config);
    }

    /**
     * 写demo其实用spring自带的就行了，就不用引入hikari了
     */
    @Bean("spring")
    public DataSource spring() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setUrl("jdbc:h2:mem:pokemon;DB_CLOSE_DELAY=-1;MODE=MySQL;INIT=RUNSCRIPT FROM 'classpath:scripts/init.sql'");
        dataSource.setUsername("sa");
        dataSource.setPassword("password");
        dataSource.setDriverClassName(org.h2.Driver.class.getName());
        return dataSource;
    }
```
jdbc的流程：
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
因为要处理的事情多，所以定义这么多步骤并非不合理，**但是把这些步骤全都暴露给程序猿就有点儿离谱了**。每次写个最简单的查询也要有这么多步骤，非常影响开发效率。

# spring的改进
spring针对jdbc的上述问题进行了改进，主要是两方面：
1. **使用模板类，封装冗杂的步骤，只暴露和业务相关的步骤**，供程序猿自定义；
2. 设计了统一的异常体系；

**可以把这套体系称为spring DAO（Data Access Object），dao类似于接口，定义数据访问方法，具体数据访问的实现，可能是jdbc、hibernate、mybatis、jpa等等。所以它还不能叫spring jdbc，只有基于jdbc实现时，spring这套改进体系才能叫spring jdbc。**

这套体系根据具体的实现不同，有：
- spring jdbc
- spring mybatis（其实也是spring jdbc）
- spring hibernate
- spring jpa

等等。

## spring DAO异常体系
**想把各种DAO的实现技术封装为同一套模板体系，首先要构建一套通用的异常体系，以屏蔽各个实现技术独有的异常，不然是不可能设计一套通用的模板的。**

> 每种技术都抛自己的异常，接口模板怎么定义嘛！总不能在接口方法上throw Exception吧。

spring DAO的异常体系有以下特点：
1. 全面！分门别类考虑了各种可能涉及到的异常类别。**jdbc的异常体系其实不完善，比如所有的数据操作几乎都会抛同一个`SqlException`，还要通过`getErrorCode`/`getSqlState`获取错误码，然后判断具体错在什么地方。spring则给这些错误码定义了合适的异常**；
2. 通用！异常分好几个层级，低级别的异常是和不同的实现框架相关的，但是高级的异常是通用的，这些高级的异常就可以写到模板类里；
3. 基于`RuntimeException`！很多异常强制让程序猿catch也没用，不可恢复，还是解决不了（比如sql语法错误），所以即使强制程序猿catch住它，又有什么用呢？spring则大量使用`RuntimeException`，防止不必要的catch侵入业务代码。

> 当然spring的异常也不能保证把任何异常全都涵盖了，所以它还有个默认异常：`UncategorizedDataAccessException`。当不知道底层框架的异常应该转为spring的哪个异常时，就转为它吧。

### `SqlExceptionTranslator`
那么问题来了，怎么把底层框架的独有异常翻译成spring的异常？当然是spring先catch住他们，再re-throw spring对应的异常。

这些异常转换操作就是由异常转换器`SqlExceptionTranslator`来做的。接口就一个方法：
- `DataAccessException translate(String task, String sql, SQLException ex)`;

它的两个实现类：
- `SQLStateSQLExceptionTranslator`：按照state转换异常；
- `SQLErrorCodeSQLExceptionTranslator`：按照error code转换异常；

不同技术对应不同的异常转换器：
- jdbc：`DataSourceUtils`；
- mybatis：`DataSourceUtils`，**和jdbc一样，因为mybatis基于jdbc的`Connection`**，他们抛出的异常也一样，都是`SqlException`；
- hibernate：`SessionFactoryUtils`；
- jpa：`EntityManagerFactoryUtils`；

## 模板类
异常统一了，spring DAO的模板类的数据访问方法就可以统一定义了。

spring DAO封装了繁杂的操作流程，只暴露业务相关的操作让程序猿设置（感觉jdbc一开始就该这么定义接口的）。**这些数据的业务逻辑操作经常使用回调的方式实现**，比如程序猿写一个callback，用于数据获取之后的处理工作。

同样，不同的持久化技术对应不同的模板类：
- jdbc：`JdbcTemplate`；
- hibername：`HibernateTemplate`；
- jpa：`JpaTemplate`；

### `JdbcTemplate`丰富的模板方法
就不说了。

### 从线程不安全到线程安全
jdbc的`Connection`是不是线程安全的？好像没有定论：
- https://stackoverflow.com/questions/1531073/is-java-sql-connection-thread-safe

**但应该不是线程安全的**，Connection是有`connection.setAutoCommit(boolean)`方法的，所以看起来它应该是个有状态的对象的。如果一个线程set false，另一个set true，那`Connection`到底是不是auto commit？

所以`Connection`的使用环境都是：一个线程一个`Connection`，每个线程操作自己的`Connection`。

这就意味着，使用`Connection`的DAO应该不是线程安全的：
```java
public class xxDao {
    private Connection connection = ...;
    
    public void update() {
        Statement stat = connection.createStatement();
    }
}
```
为了使用这个Dao，应该是每个线程new一个Dao对象的。

同理，包裹`Connection`的`JdbcTemplate`“应该”也不是线程安全的：
```java
public class JdbcTemplate {
    private DataSource dataSource = ...;
    
    public void update() {
        dataSource.getConnection().createStatement().execute...
    }
}
```
**但事实是，JdbcTemplate是线程安全的，由它构建的Dao也是线程安全的，所以我们只需要这一个dao就行了！**

为什么`JdbcTemplate`是线程安全的？它做了什么改装？**它通过`ThreadLocal`把每个线程自己的`Connection`封装起来了！每次获取`Connection`的时候，都是获取的这个线程自己的`Connection`，所以依然是一个线程一个`Connection`**！因此`JdbcTemplate`就线程安全了！

> **`ThreadLocal`其实是以空间换时间**：每个线程操作一个对象，线程之间就不会相互干涉了。**同理，多线程的同步机制就是以时间换空间**：共享变量就一个，空间是省了，但是访问的时候要互斥、串行化，整体访问事件变久了。
>
> Innodb MVCC也是以空间换时间。

这是`JdbcTemplate`的另一个非常大的帮助！具体封装流程见下文事务的部分。

# spring事务
对数据库的访问离不开事务这一概念。[Innodb - 有关事务的一切]({% post_url 2022-01-27-innodb-transaction %})详细解读了事务，jdbc规范也对事务进行了支持。但是显然，事务使用起来是繁琐的，通过上面的jdbc样板代码可以看到：
- 要定义事务是否自动提交；
- 要手动提交事务；
- 要处理事务异常回滚，或回滚到savepoint；

这些操作不仅麻烦，而且对业务代码侵入极大。

**spring transaction则把对事务的支持抽象出来，让程序猿仅关注业务逻辑。它基于spring dao，也是spring在处理数据库数据时被用到的最多最广的功能。**

> 身位一名程序员（虽然很少会涉及到CRUD），再次向spring致谢！

## jdbc的事务支持
jdbc规范中，`Connection#getMetaData`可以获取`DatabaseMetaData`，可以处理事务相关的信息：
- `supportsTransactions`：db是否支持事务；
- `supportsTransactionIsolationLevel(int level)`：是否支持某级别的事务；

等等。

**事务的操作由`Connection`负责**：
- `commit`
- `rollback`
- `rollback(Savepoint savepoint)`
- `setAutoCommit`

## spring对事务的支持
- `TransactionDefinition`接口：何谓事务
    + getIsolationLevel
    + getName
    + isReadOnly
    + getPropagationBehavior：事务传播行为，见后文
- `TransactionStatus`接口：事务的运行状态
    + isCompleted
    + isRollbackOnly
    + flush
    + createSavepoint
    + rollbackToSavepoint
    + hasSavepoint
- `PlatformTransactionManager`接口：管理事务，是核心接口。**怎么管理？要么提交，要么回滚。它操作的参数也都是上面两个接口**
    + commit(TransactionStatus status) throws
    + rollback(TransactionStatus status)
    + getTransaction(TransactionDefinition definition)

同样，spring为不同的持久化技术提供了不同的事务管理器：
- jdbc：`DataSourceTransactionManager`；
- mybatis：同上；
- hibername：`HibernateTransactionManager`；
- jpa：`JpaTransactionManager`；

## 框架的事务管理器配置
**想要有事务管理，首先得配置事务管理器**。

不同的框架侧重点不同：
- jdbc：最灵活，同时也最底层。代价是代码繁杂；
- mybatis：也是基于jdbc的技术，同时也算是半个orm框架。它屏蔽了jdbc的繁杂细节，方便控制sql，在灵活度和复杂度上得到了折中。但复杂查询不易做到；
- orm框架：比如hibernate，非常强大高效，但是不方便直接使用底层sql。可以说不够灵活。

**mybatis和jdbc都是基于`Connection`访问数据库**：db -> `DataSource` -> `Connection`

**hibernate虽然说到底也是基于`Connection`的，但是它在`Connection`之上进行了进一步包装**: db -> `DataSource` -> `Connection` -> `Session` -> `SessionFactory`

所以 **mybatis可以和jdbc共用事务管理器**：**但它的transaction是直接从`DataSource`的`Connection`创建的**，虽然mybatis也有和hibernate类似的`SqlSession`，但这和事务没什么关系。

```java
    /**
     * mybatis和jdbc一样，用的是{@link DataSourceTransactionManager}
     */
    @Bean
    public DataSourceTransactionManager dataSourceTransactionManager(DataSource dataSource) {
        return new DataSourceTransactionManager(dataSource);
    }
```

**hibernate必须使用spring为它写的`HibernateTransactionManager`事务管理器：hibernate的transaction是通过自己的`SessionFactory`创建的（`SessionFactory`需要传入`Connection`）**。

hibernate要先创建一个`SessionFactory`：
```java
    /**
     * 取代hibernate.cfg.xml，其实目的一样，都是为了获取{@link org.hibernate.SessionFactory}
     */
    @Bean
    public AnnotationSessionFactoryBean localSessionFactoryBean(@Qualifier("hikari") DataSource dataSource) {
        AnnotationSessionFactoryBean annotationSessionFactoryBean = new AnnotationSessionFactoryBean();

        // 设置DataSource
        annotationSessionFactoryBean.setDataSource(dataSource);

        // 可以一个一个设置mapper
//        annotationSessionFactoryBean.setAnnotatedClasses(Blog.class);
        // 也可以直接扫描package
        annotationSessionFactoryBean.setAnnotatedPackages(Blog.class.getPackage().getName());

        // 设置hibernate属性
        Properties properties = new Properties();
        properties.setProperty("hibernate.dialect", org.hibernate.dialect.MySQL5Dialect.class.getName());
        properties.setProperty("hibernate.show_sql", "true");
        annotationSessionFactoryBean.setHibernateProperties(properties);
        return annotationSessionFactoryBean;
    }
```
再通过`SessionFactory`创建hibernate的事务管理器：
```java
    @Bean
    public HibernateTransactionManager hibernateTransactionManager(SessionFactory sessionFactory) {
        return new HibernateTransactionManager(sessionFactory);
    }
```

但是spring很聪明，既然 **Hibernate的`Session`就是对`Connection`的封装**，那么就可以通过让`Session`封装`Connection`，从而通过hibernate的事务管理器`HibernateTransactionManager`实现了对`Connection`的事务管理！（表面上管理的还是`Session`，实际管理的是`Connection`）。**所以Hibernate和mybatis/jdbc共用的时候，只配置`HibernateTransactionManager`就行了**！（jpa + jdbc/mybatis同理，只配置`JpaTransactionManager`就行）。

## 事务同步管理器：`TransactionSynchronizationManager`
上文说到，`JdbcTemplate`是线程安全的，因为使用`ThreadLocal`为每一个线程封装了自己的`Connection`等资源（别的template是别的资源，比如hibernate `Session`）。**实际上，这一封装是在`TransactionSynchronizationManager`里实现的**。

看它的名字“synchronization”，**它使用`ThreadLocal`为每一个线程保存一份独立的资源副本、事务状态**，就是为了让事务有“同步”（线程安全）的效果！它是spring事务管理的基石。

它按照不同持久化技术对应的实现类，因为也兼具异常转换的功能，所以就是上面提到的一堆异常转换器：
- jdbc：`DataSourceUtils`；
- mybatis：`DataSourceUtils`，**和jdbc一样，因为mybatis基于jdbc的`Connection`**，他们抛出的异常也一样，都是`SqlException`；
- hibernate：`SessionFactoryUtils`；
- jpa：`EntityManagerFactoryUtils`；

`JdbcTemplate`不直接从`DataSource`获取（new）`Connection`（`DataSource#getConnection()`），而是使用了`DataSourceUtils`：
```java
    private <T> T execute(StatementCallback<T> action, boolean closeResources) throws DataAccessException {
        Assert.notNull(action, "Callback object must not be null");
        
        // 没有使用`dataSource.getConnection()`
        Connection con = DataSourceUtils.getConnection(obtainDataSource());
        Statement stmt = null;
        try {
        	stmt = con.createStatement();
        	applyStatementSettings(stmt);
        	T result = action.doInStatement(stmt);
        	handleWarnings(stmt);
        	return result;
    }
```
看一下`DataSourceUtils#getConnection(DataSource)`是怎么获取`Connection`的：
```java
        Connection con = dataSource.getConnection();

        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            logger.debug("Registering transaction synchronization for JDBC Connection");
            // Use same Connection for further JDBC actions within the transaction.
            // Thread-bound object will get removed by synchronization at transaction completion.
            ConnectionHolder holderToUse = conHolder;
            if (holderToUse == null) {
                holderToUse = new ConnectionHolder(con);
            } else {
                holderToUse.setConnection(con);
            }
            holderToUse.requested();
            TransactionSynchronizationManager.registerSynchronization(
                    new ConnectionSynchronization(holderToUse, dataSource));
            holderToUse.setSynchronizedWithTransaction(true);
            if (holderToUse != conHolder) {
                TransactionSynchronizationManager.bindResource(dataSource, holderToUse);
            }
        }
```
获取一个`Connection`，放到`ConnectionHolder`里，并把后者注册到`TransactionSynchronizationManager`里：
```java
TransactionSynchronizationManager.registerSynchronization(new ConnectionSynchronization(holderToUse, dataSource));
```
所谓的注册，就是放到`TransactionSynchronizationManager`的`ThreadLocal`变量`synchronizations`里：
```java
	private static final ThreadLocal<Set<TransactionSynchronization>> synchronizations =
			new NamedThreadLocal<Set<TransactionSynchronization>>("Transaction synchronizations");

	public static void registerSynchronization(TransactionSynchronization synchronization)
			throws IllegalStateException {

		Assert.notNull(synchronization, "TransactionSynchronization must not be null");
		if (!isSynchronizationActive()) {
			throw new IllegalStateException("Transaction synchronization is not active");
		}
		synchronizations.get().add(synchronization);
	}
```
这么一来，spring jdbc通过`DataSourceUtils`获取到的`Connection`就是该线程独有的`Connection`，线程安全！**`JdbcTemplate`的方法在执行之前都要先获取`Connection`，就是这么获取的**！比如：
```java
    @Override
    public <T> T execute(ConnectionCallback<T> action) throws DataAccessException {
        Assert.notNull(action, "Callback object must not be null");

        // 获取Connection！
        Connection con = DataSourceUtils.getConnection(getDataSource());
        try {
            Connection conToUse = con;
            if (this.nativeJdbcExtractor != null) {
                // Extract native JDBC Connection, castable to OracleConnection or the like.
                conToUse = this.nativeJdbcExtractor.getNativeConnection(con);
            } else {
                // Create close-suppressing Connection proxy, also preparing returned Statements.
                conToUse = createConnectionProxy(con);
            }
            return action.doInConnection(conToUse);
        } catch (SQLException ex) {
            // Release Connection early, to avoid potential connection pool deadlock
            // in the case when the exception translator hasn't been initialized yet.
            DataSourceUtils.releaseConnection(con, getDataSource());
            con = null;
            throw getExceptionTranslator().translate("ConnectionCallback", getSql(action), ex);
        } finally {

            // 释放Connection也是通过DataSourceUtils做的
            DataSourceUtils.releaseConnection(con, getDataSource());
        }
    }
```
释放`Connection`也是通过`DataSourceUtils`做的：`DataSourceUtils.releaseConnection(con, getDataSource())`。如果当前`Connection`还在被事务使用，就会先不关，否则关掉`Connection`。

> 这里并不会池化`Connection`。如果使用了连接池，比如hikari `DataSource`，此时的`Connection`是由hikari封装过的`Connection`，它的close行为其实是放回hikari pool。所以spring不管这些，想池化还得加连接池。

**从此，`JdbcTemplate`、DAO（基于`JdbcTemplate`）、Service都变成线程安全的了**！所以说`TransactionSynchronizationManager`是整个spring事务管理的基石！

如果自己写的DAO不基于spring的`JdbcTemplate`，那就享受不到这种线程安全了。也不能使用spring的事务管理。而我们之前只管写service singleton，其实并没有注意到线程安全问题。实际上如果使用最朴素的jdbc，每次都是要new新的`Connection`的。

> **线程安全小技巧：把不能线程间并发使用的东西（比如`Connection`），用一个全局的static `ThreadLocal`装起来**。

## 事务传播
Service的方法如果都通过这种方式实现了事务支持，那么一个方法调用另一个方法，两个方法的事务会怎样？这就是spring定义的事务传播行为：**默认是`PROPAGATION.REQUIRED`，如果事务已存在，则加入到这个事务中**！而不是创建两个事务。

> 大误：~~一个事务方法调用另一个事务方法，会产生两个事务~~。是加入第一个事务，最终也只产生一个事务。

# 配置事务管理增强：AOP
**spring通过AOP把事务管理织入业务类，使之自动具有事务管理的功能。这是spring aop的一大主要应用！**

## 手动配置织入
和[Spring - AOP]({% post_url 2021-11-22-spring-aop %})介绍的一样，一开始可以使用`TransactionProxyFactoryBean`手动配置aop：
- advice：事务管理器；
- pointcut：setTransactionAttributes；
- target：不具有事务管理功能的业务bean；

```java
    /**
     * 事务管理器是advice增强
     * attribute定义切点
     * target是被代理对象
     *
     * 只不过它和{@link ProxyFactoryBean}一样，只能代理一个bean，不能代理所有的bean
     */
//    @Bean("blogService")
    public TransactionProxyFactoryBean proxyBlogService(@Qualifier("blogServiceTarget") BlogService blogService,
                                                        DataSourceTransactionManager dataSourceTransactionManager) {
        TransactionProxyFactoryBean txProxy = new TransactionProxyFactoryBean();
        txProxy.setTransactionManager(dataSourceTransactionManager);
        txProxy.setTarget(blogService);
        Properties properties = new Properties();
        properties.setProperty("show*", "PROPAGATION_REQUIRED,readOnly");
        properties.setProperty("*", "PROPAGATION_REQUIRED");
        txProxy.setTransactionAttributes(properties);
        return txProxy;
    }
```
显然，每有一个需要事务支持的业务类，都要这么配置一个`FactoryBean`，得累死。

## `@Transactional`
使用`@Transactional`注解配置事务，是spring transaction的另外一大便利。

通过配置`@Transactional`注解的属性，就能设置个性化的事务行为：
- propagation：默认是`Propagation.REQUIRED`
- readOnly
- rollbackFor：**默认是RuntimeException和Error会rollback，checked异常不回滚**。
- transactionManager：**手动指定该事务的事务管理器。同时它也是value属性的alias，也就是说@Transactional里默认配置的字符串其实指的就是事务管理器的名称**；

使用该注解别忘了声明`@EnableTransactionManagement`。

### 注解加在哪儿
[Spring - 用AspectJ定义切面]({% post_url 2022-07-31-spring-aop-aspectj %})已经解释过了，注解加在接口上等于白加，所以要加在实现类上。

但是同时也提到了spring对`@Transactional`有额外支持，如果标记在接口上，同时使用jdk的动态代理生成代理bean，也是可以织入事务支持的。

但spring仍然[推荐写在实现类上](https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#transaction-declarative-annotations)。

### 事务传播？
在[Spring - AOP]({% post_url 2021-11-22-spring-aop %})提到：如果同一个类中的a方法没有事务，b方法使用`@Transactional`织入事务，则如果通过a调用b，b也不会有事务。这是因为使用了方法的内部调用，直接调用了b，而不是调用了增强后的b。**这和事务传播是两码事！这是压根没有启动事务！**

上面说的事务传播，指的是 **在已经开启一个事务的情况下**，后面的事务方法被调用时会发生什么：
- 如果调用的是 **另一个类里的事务方法**，则默认事务传播行为是后者加入前者；
- 如果调用的是 **同一个类里的事务方法**，**第二个方法直接就变成了内部调用，压根不涉及到事务传播**；

# 感想
spring太贴心了……它给的实在是太多了……
- 帮你写模板代码`JdbcTemplate`；
- 帮你统一数据访问的异常体系；
- 帮你把`Connection`的访问搞成线程安全的；
- 帮你管理事务；
- 帮你通过`@Transactional`织入事务管理；

还有什么里有不好好看看spring呢？看的越多，以后代码写的越少，越轻松。

> spring，谢谢你……

