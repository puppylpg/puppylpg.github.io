---
layout: post
title: "Spring - Data Access"
date: 2022-07-31 23:41:33 +0800
categories: spring jdbc
tags: spring jdbc
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
```
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
```
        ApplicationContext applicationContext = new AnnotationConfigApplicationContext(DataSourceConfig.class);
        // 获取DataSource
        DataSource dataSource = applicationContext.getBean("spring", DataSource.class);

        Connection connection = null;
        PreparedStatement statement = null;

        Savepoint afterInsert = null;

        try {
            // 从DataSource获取Connection
            connection = dataSource.getConnection();
            // 手动开启事务。默认一条修改是一次事务
            connection.setAutoCommit(false);

            // 查看数据库metadata
            DatabaseMetaData databaseMetaData = connection.getMetaData();
            System.out.println("support savepoint? " + databaseMetaData.supportsSavepoints());

            statement = connection.prepareStatement("insert into BLOG(ID, TITLE, WORDS) values (?, ?, ?)");
            statement.setInt(1, 1);
            statement.setString(2, "first");
            statement.setLong(3, 100);
            statement.execute();

            afterInsert = connection.setSavepoint("sp1");

            statement = connection.prepareStatement("select * from BLOG");
            ResultSet resultSet = statement.executeQuery();
            // 处理结果
            while (resultSet.next()) {
                Blog blog = Blog.builder()
                        .id(resultSet.getInt("ID"))
                        .title(resultSet.getString("TITLE"))
                        .words(resultSet.getLong("WORDS"))
                        .build();
                System.out.println(blog);
            }

            // 提交事务
            connection.commit();
        } catch (SQLException e) {
            e.printStackTrace();

            // 回滚事务，可以回滚到某个保存点（部分回滚）
            try {
//                Objects.requireNonNull(connection).rollback();
                Objects.requireNonNull(connection).rollback(afterInsert);
            } catch (SQLException ex) {
                ex.printStackTrace();
            }
        } finally {
            // 释放资源
            try {
                Objects.requireNonNull(statement).close();
                connection.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
    }
```
因为要处理的事情多，所以定义这么多步骤并非不合理，**但是把这些步骤全都暴露给程序猿就有点儿离谱了**。每次写个最简单的查询也要有这么多步骤，非常影响开发效率。

# spring的改进
spring针对jdbc的上述问题进行了改进，主要是两方面：
1. 使用模板类，封装冗杂的步骤，只暴露和业务相关的步骤，供程序猿自定义；
2. 设计了统一的异常体系；

**可以把这套体系称为spring DAO，dao类似于接口，定义数据访问方法，具体数据访问的实现，可能是jdbc、hibernate、mybatis、jpa等等。**

> 但改进后的方案并不叫spring jdbc，它只是spring这套改进体系基于jdbc的实现。

这套体系根据具体的实现不同，有：
- spring jdbc
- spring mybatis（其实也是spring jdbc）
- spring hibernate
- spring jpa
- 等等

## spring DAO异常体系
**想把各种DAO的实现技术封装为同一套模板体系，首先要构建一套通用的异常体系，以屏蔽各个实现技术独有的异常，不然是不可能设计一套通用的模板的。**

> 每种技术都抛自己的异常，接口模板怎么定义嘛！总不能在接口方法上throw Exception吧。

spring DAO的异常体系有以下特点：
1. 全面！分门别类考虑了各种可能涉及到的异常类别。**jdbc的异常体系其实不完善，比如所有的数据操作几乎都会抛同一个SqlException，还要通过getErrorCode/getSqlState获取错误码，然后判断具体错在什么地方。spring则给这些错误码定义了合适的异常**；
2. 通用！异常分好几个层级，低级别的异常是和不同的实现框架相关的，但是高级的异常是通用的，这些高级的异常就可以写到模板类里；
3. 基于RuntimeException！很多异常强制让程序猿catch也没用，不可恢复，还是解决不了（比如sql语法错误），所以即使强制程序猿catch住它，又有什么用呢？spring则大量使用RuntimeException，防止不必要的catch侵入业务代码。

> 当然spring的异常也不能保证把任何异常全都涵盖了，所以它还有个默认异常：UncategorizedDataAccessException。当不知道底层框架的异常应该转为spring的哪个异常时，就转为它吧。

### SqlExceptionTranslator
那么问题来了，怎么把底层框架的独有异常翻译成spring的异常？当然是spring先catch住他们，在re-throw spring对应的异常。

这些异常转换操作就是由异常转换器来做的。这个接口就一个方法：
- DataAccessException translate(String task, String sql, SQLException ex);

它的两个实现类：
- SQLStateSQLExceptionTranslator：按照state转换异常；
- SQLErrorCodeSQLExceptionTranslator：按照error code转换异常；

不同技术对应不同的异常转换器：
- jdbc：DataSourceUtils；
- mybatis：DataSourceUtils，**和jdbc一样，因为mybatis基于jdbc的Connection**，他们抛出的异常也一样，都是SqlException；
- hibernate：SessionFactoryUtils；
- jpa：EntityManagerFactoryUtils；

## 模板类
异常统一了，spring DAO的模板类的数据访问方法就可以统一定义了。

spring DAO封装了繁杂的操作流程，只暴露业务相关的操作让程序猿设置（感觉jdbc一开始就该这么定义接口的）。**这些数据的业务逻辑操作经常使用回调的方式实现**，比如程序猿写一个callback，用于数据获取到之后的处理工作。

同样，不同的持久化技术对应不同的模板类：
- jdbc：JdbcTemplate；
- hibername：HibernateTemplate；
- jpa：JpaTemplate；

### JdbcTemplate丰富的模板方法
就不说了。

### 线程安全问题
jdbc的Connection是不是线程安全的？好像没有定论：
- https://stackoverflow.com/questions/1531073/is-java-sql-connection-thread-safe

**但应该不是线程安全的**，Connection是有`connection.setAutoCommit(boolean)`方法的，所以看起来它应该是个有状态的对象的。如果一个线程set false，另一个set true，那Connection到底是不是auto commit？

所以Connection的使用环境都是：一个线程一个Connection，每个线程操作自己的Connection。

这就意味着，使用Connection的DAO应该不是线程安全的：
```
public class xxDao {
    private Connection connection = ...;
    
    public void update() {
        Statement stat = connection.createStatement();
    }
}
```
为了使用这个Dao，应该是每个线程new一个Dao对象的。

同理，包裹Connection的JdbcTemplate“应该”也不是线程安全的：
```
public class xxDao {
    private JdbcTemplate jdbcTemplate = ...;
    
    public void update() {
        jdbcTemplate.xxx;
    }
}
```
**但事实是，JdbcTemplate是线程安全的，由它构建的Dao也是线程安全的，所以我们只需这一个dao就行了！**

为什么JdbcTemplate是线程安全的？它做了什么改装？**它通过ThreadLocal把每个线程自己的Connection封装起来了！每次获取Connection的时候，都是获取的这个线程自己的Connection**！所以JdbcTemplate就线程安全了！

这是JdbcTemplate的另一个非常大的帮助！

