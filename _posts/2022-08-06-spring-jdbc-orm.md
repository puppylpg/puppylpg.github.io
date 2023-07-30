---
layout: post
title: "Spring - JDBC & ORM"
date: 2022-08-06 20:46:31 +0800
categories: spring jdbc orm hibernate mybatis
tags: spring jdbc orm hibernate mybatis
---

[Spring - Data Access & Transaction]({% post_url 2022-08-01-spring-dao-transaction %})主要从设计理念和关键实现原理上介绍了spring aop对spring jdbc和整合其他orm框架的支持。本文介绍一下具体的实现。

1. Table of Contents, ordered
{:toc}

# JDBC
介绍实体类是blog：
```java
/**
 * @author puppylpg on 2022/05/31
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Blog {

    private int id;
    private String title;
    private long words;
}
```

serivce类就是增删改查blog：
```java
/**
 * @author puppylpg on 2022/07/09
 */
public interface BlogService {

    void addOne(Blog blog);

    void addOneFail(Blog blog);

    void showAll();
}
```

## DAO
对于spring jdbc来讲，DAO基本是用`JdbcTemplate`实现的，毕竟它不能orm，只能相对底层手撸sql：
```java
/**
 * @author puppylpg on 2022/07/09
 */
@Repository
public class BlogDao {

    private final JdbcTemplate jdbcTemplate;

    private final NamedParameterJdbcTemplate namedParameterJdbcTemplate;

    public BlogDao(JdbcTemplate jdbcTemplate, NamedParameterJdbcTemplate namedParameterJdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        this.namedParameterJdbcTemplate = namedParameterJdbcTemplate;
    }

    public void insert(Blog blog) {
        // 命名参数sql
        String sql = "insert into BLOG(ID, TITLE, WORDS) values(:id, :title, :words)";

        // 用哪个都行
        SqlParameterSource sqlParameterSource = new BeanPropertySqlParameterSource(blog);
        MapSqlParameterSource mapSqlParameterSource = new MapSqlParameterSource()
                .addValue("id", blog.getId())
                .addValue("title", blog.getTitle())
                .addValue("words", blog.getWords());
        namedParameterJdbcTemplate.update(sql, sqlParameterSource);
    }

    public List<Blog> getAllBlogs() {
        return jdbcTemplate.query("select * from BLOG",
                (rs, rowNum) -> Blog.builder()
                        .id(rs.getInt("ID"))
                        .title(rs.getString("TITLE"))
                        .words(rs.getLong("WORDS"))
                        .build()
        );
    }

    public void insertError() {
        throw new RuntimeException(":sigh");
    }
}
```

service实现：
```java
/**
 * @author puppylpg on 2022/07/09
 */
@Service
public class BlogServiceImpl implements BlogService {

    private final BlogDao blogDao;

    public BlogServiceImpl(BlogDao blogDao) {
        this.blogDao = blogDao;
    }

    @Override
    public void addOne(Blog blog) {
        blogDao.insert(blog);
    }

    @Override
    public void addOneFail(Blog blog) {
        addOne(blog);
        showAll();
        blogDao.insertError();
    }

    @Override
    public void showAll() {
        System.out.println(blogDao.getAllBlogs());
    }
}
```

## 配置
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

    @Bean
    public JdbcTemplate jdbcTemplate(@Qualifier("hikari") DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean
    public NamedParameterJdbcTemplate namedParameterJdbcTemplate(@Qualifier("hikari") DataSource dataSource) {
        return new NamedParameterJdbcTemplate(dataSource);
    }
```
当然，事务管理器必须得有：
```java
    /**
     * jdbc的transaction manager，相当于advice增强的角色
     */
    @Bean
    public DataSourceTransactionManager transactionManager(@Qualifier("hikari") DataSource dataSource) {
        return new DataSourceTransactionManager(dataSource);
    }
```

## 手动事务支持
在`TransactionProxyFactoryBean`中手动组装事务：
- target：给谁增强事务；
- advice：哪个事务管理器；
- pointcut：切点；
```java
    @Bean("blogService")
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
它和`ProxyFactoryBean`一样（[Spring - AOP]({% post_url 2021-11-22-spring-aop %})），只能代理一个bean，不能代理所有的bean。

## 自动事务支持
直接使用`@Transactional`注解即可。比如：
```java
    @Transactional
    @Override
    public void addOneFail(Blog blog) {
        addOne(blog);
        showAll();
        blogDao.insertError();
    }
```
别忘了在配置里加上`@EnableTransactionManagement`注解以开启事务。

配置完了┓( ´∀` )┏

## 事务执行
可以开启debug日志观察事务的启动信息：
```
23:41:42.081 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Creating new ansaction with name [io.puppylpg.jdbc.spring.service.BlogServiceImpl.addOneFail]: OPAGATION_REQUIRED,ISOLATION_DEFAULT
23:41:42.082 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Acquired Connection ikariProxyConnection@1486726131 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA] for JDBC transaction
23:41:42.085 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Switching JDBC nnection [HikariProxyConnection@1486726131 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA] to manual commit
23:41:42.090 [main] DEBUG org.springframework.jdbc.core.JdbcTemplate - Executing prepared SQL update
23:41:42.090 [main] DEBUG org.springframework.jdbc.core.JdbcTemplate - Executing prepared SQL statement [insert to BLOG(ID, TITLE, WORDS) values(?, ?, ?)]
23:41:42.103 [main] DEBUG org.springframework.jdbc.core.JdbcTemplate - Executing SQL query [select * from BLOG]
[Blog(id=99998, title=come on, words=10086), Blog(id=99999, title=the last, words=10087), Blog(id=1, title=fail, rds=0)]
23:41:42.120 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Initiating ansaction rollback
23:41:42.120 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Rolling back JDBC ansaction on Connection [HikariProxyConnection@1486726131 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA]
23:41:42.121 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Releasing JDBC Connection [HikariProxyConnection@1486726131 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA] after transaction
```
1. 开启线程；
2. 插入数据；
3. showAll，看到插入成功了；
3. 碰到Runtime异常，回滚了；

事务回滚之后，把插入的数据又删掉了。

主程序：
```java
public class SpringJdbcWithTransactionMain {

    public static void main(String... args) {
        ApplicationContext applicationContext = new AnnotationConfigApplicationContext(TransactionalConfig.class);
        BlogService blogService = applicationContext.getBean(BlogService.class);
        Blog blog = Blog.builder().id(1).title("fail").words(0).build();

        // 给bean织入事务增强，碰到异常会执行rollback（类似于在finally里），但是并不会处理异常，而是会把异常抛出来
        // 如果spring不把异常抛出来，给吞了，估计会被程序猿喷死……
        // 所以异常还是要我们自己处理
        try {
            blogService.addOneFail(blog);
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 最后再查一下，还是初始化时插入的那些记录，中间事务里插入的记录被回滚掉了
        blogService.showAll();
    }
}
```
主要注意一点：事务支持只在发生异常的时候保证事务性，异常本身还是会被spring transaction抛出来的，**所以在代码层面还是要处理异常**，并不是连异常都不用处理了。

> 事实上如果spring不把异常抛出来，给吞了，估计会被程序猿喷死……

# ORM
不同的orm框架，主要体现在DAO的写法不同。jdbc用sql，hibernate则已经有一些现成的save方法了，复杂的就写写hql。spring orm对他们提供了同样的事务管理抽象，**所有的细节都屏蔽在手动组装事务的factory bean里了**（比如jdbc的TransactionProxyFactoryBean）。**而如果使用@Transactional注解，连factory bean都不用写了**。

# hibernate
hibernate是orm框架，**所以一定要提前定义好object relational怎么mapping**。

## xml hibernate
传统hibernate使用xml定义映射，也使用xml定义hibernate配置`hibernate.cfg.xml`。

映射配置`Blog.hbm.xml`：
```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE hibernate-mapping PUBLIC "-//Hibernate/Hibernate Mapping DTD//EN"
        "http://hibernate.sourceforge.net/hibernate-mapping-3.0.dtd">
<hibernate-mapping auto-import="true" default-lazy="false">
    <class name="io.puppylpg.hibernate.entity.Blog" table="BLOG">
        <id name="id" column="ID">
            <generator class="assigned" />
        </id>
        <property name="title" column="TITLE" />
        <property name="words" column="WORDS" />
    </class>
</hibernate-mapping>
```

配置文件：
```
<?xml version='1.0' encoding='utf-8'?>

<!DOCTYPE hibernate-configuration PUBLIC
        "-//Hibernate/Hibernate Configuration DTD 3.0//EN"
        "http://www.hibernate.org/dtd/hibernate-configuration-3.0.dtd">
<hibernate-configuration>
	<session-factory>
		<!-- 1. 数据源 -->
		<property name="connection.driver_class">
			org.h2.Driver
		</property>
		<property name="connection.url">
			jdbc:h2:mem:pokemon;DB_CLOSE_DELAY=-1;MODE=MySQL;INIT=RUNSCRIPT FROM 'classpath:scripts/init.sql'
		</property>
		<property name="connection.username">sa</property>
		<property name="connection.password">password</property>

		<!-- 2. hibernate控制属性 -->
		<property name="dialect">
			org.hibernate.dialect.MySQLDialect
		</property>
		<property name="show_sql">true</property>
		<property name="format_sql">true</property>
		<property name="current_session_context_class">thread</property>

		<!-- 3. 映射文件 -->
		<mapping resource="io/puppylpg/hibernate/entity/Blog.hbm.xml" />
	</session-factory>
</hibernate-configuration>
```
配置文件主要声明：
1. 数据源，从数据源中才能获取Connection，进而封装为Session；
2. hibernate自身的属性配置，比如要不要输出sql等；
3. 加载orm的映射文件；

主程序：
```
public class RawHibernateMain {

    public static void main(String... args) {
        Configuration configuration = new Configuration().configure("hibernate.cfg.xml");
        SessionFactory sessionFactory = configuration.buildSessionFactory();

        Session session= sessionFactory.getCurrentSession();
        Transaction transaction = session.beginTransaction();

        Blog blog = Blog.builder().id(1).title("hibernate is awesome").words(10000).build();
        session.save(blog);

        List<Blog> list = sessionFactory.getCurrentSession()
                // HQL：使用的是java class name和property，而不是db里的table和column
                .createQuery("from Blog b where b.id > ?")
                .setInteger(0, 0)
                .list();
        System.out.println(list);
        transaction.commit();

        sessionFactory.close();
    }
}
```
从配置里构建SessionFactory，就可以获取Session，直接用Session的save等方法操作对象。如果复杂一些，可以使用hql操作对象。总之，不用再操心sql了。

> 真正的orm。

如果结合spring，定义一个LocalSessionFactoryBean，他就能自动产生SessionFactory了：
```
    @Bean
    public LocalSessionFactoryBean localSessionFactoryBean() {
        LocalSessionFactoryBean localSessionFactoryBean = new LocalSessionFactoryBean();
        localSessionFactoryBean.setConfigLocation(new ClassPathResource("hibernate.cfg.xml"));
        return localSessionFactoryBean;
    }
```
获取SessionFactory：
```
        ApplicationContext applicationContext = new AnnotationConfigApplicationContext(SpringUseRawHibernateXmlConfig.class);
        SessionFactory sessionFactory = applicationContext.getBean(SessionFactory.class);
```

## jpa hibernate
hibernate本身也支持使用JPA注解定义mapper：
```
@Entity
@Table(name = "BLOG")
public class Blog {

    @Id
    @Column(name = "ID")
    private int id;
    @Column(name = "TITLE")
    private String title;
    @Column(name = "WORDS")
    private long words;
}
```

> hibernate支持JSR-220 JPA注解

## 不使用xml配置
比如这样配置hibernate：
```
    /**
     * 取代hibernate.cfg.xml，其实目的一样，都是为了获取{@link org.hibernate.SessionFactory}
     */
    @Bean
    public LocalSessionFactoryBean localSessionFactoryBean(@Qualifier("hikari") DataSource dataSource) {
        LocalSessionFactoryBean localSessionFactoryBean = new LocalSessionFactoryBean();

        // 设置DataSource
        localSessionFactoryBean.setDataSource(dataSource);

        // 设置mapper
        localSessionFactoryBean.setMappingLocations(new ClassPathResource("/io/puppylpg/hibernate/entity/Blog.hbm.xml"));

        // 设置hibernate属性
        Properties properties = new Properties();
        properties.setProperty("hibernate.dialect", org.hibernate.dialect.MySQL5Dialect.class.getName());
        properties.setProperty("hibernate.show_sql", "true");
        localSessionFactoryBean.setHibernateProperties(properties);
        return localSessionFactoryBean;
    }
```

更进一步，spring还提供了AnnotationSessionFactoryBean，和LocalSessionFactoryBean相比，它连xml的mapper也省了，使用jpa：
```
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
**可以一个个添加jpa实体，也可以直接指定整个包**。

## HibernateTemplate
spring orm也提供了HibernateTemplate，和JdbcTemplate类似：
```
/**
 * @author puppylpg on 2022/07/10
 */
@Repository
public class BlogDao {

    /**
     * 封装了{@link org.hibernate.Session}的方法
     */
    @Autowired
    private HibernateTemplate hibernateTemplate;

    /**
     * Failed to instantiate [io.puppylpg.hibernate.spring.dao.BlogDao]: No default constructor found
     */
    public BlogDao() {
    }

//    @Autowired
//    public BlogDao(HibernateTemplate hibernateTemplate) {
//        this.hibernateTemplate = hibernateTemplate;
//    }

    public void insert(Blog blog) {
        hibernateTemplate.save(blog);
    }

    public List<Blog> getAllBlogs() {
        // orm框架都是以回调的方式处理数据
        return hibernateTemplate.execute(
                (HibernateCallback<List<Blog>>) session -> session
                        // HQL：使用的是java class name和property，而不是db里的table和column
                        .createQuery("from Blog b where b.id > ?")
                        .setInteger(0, 0)
                        .list()
        );
    }

    public void insertError() {
        throw new RuntimeException(":sigh");
    }
}
```
JdbcTemplate来自DataSource，HibernateTemplate则是来自SessionFactory（封装了DataSource）：
```
    @Bean
    public HibernateTemplate hibernateTemplate(SessionFactory sessionFactory) {
        return new HibernateTemplate(sessionFactory);
    }
```

## 事务
和jdbc的事务一样，配置好hibernate的事务管理器并使用注解开启事务就行了：
```
/**
 * @author puppylpg on 2022/07/10
 */
@Configuration
@EnableTransactionManagement
public class TransactionManagerConfig {

    @Bean
    public HibernateTransactionManager hibernateTransactionManager(SessionFactory sessionFactory) {
        return new HibernateTransactionManager(sessionFactory);
    }
}
```

spring5只支持hibernate5了，spring4看起来支持hibernate 3/4/5，要注意spring和hibernate的版本兼容问题。导入spring的hibernate相关类的时候也要注意导入的是3的还是4的还是5的。

# mybatis
mybatis算半orm框架吧，简单的orm和hibernate没什么区别，复杂的orm（比如join）可能需要写sql。但是这也让复杂的操作变得清晰可控起来。hibernate虽然很强大，但有时候了解的不够深入会让人云里雾里。

> mybatis和hibernate，同样作为orm框架，**半自动 vs. 全自动**

> mybatis的前身是ibatis，所以包名还都是ibatis。

mybatis已经自己接入spring了，有mybatis-spring包，所以spring不再需要自己提供mybatis的spring支持类了。

> 你接入我 vs. 我接入你。

## xml mybatis
同样作为orm，同样需要定义object relational映射。可以用xml定义，也可以用mybatis的注解定义。这些注解不是JPA规定的注解。
```java
@Table(name="BLOG")
public class Blog {

    @Id
    @Column(name = "ID")
    private int id;
    @Column(name = "TITME")
    private String title;
    @Column(name = "WORDS")
    private long words;
}
```

不过因为它是半自动的orm，所以除了默认的方法，其他方法都要自己去定义执行方式。大概率是用sql定义。

比如`BlogDao.xml`：
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="io.puppylpg.mybatis.raw.mapper.BlogDao">
    <select id="getAllBlogs" resultType="Blog">
        SELECT * FROM BLOG b
    </select>
    <insert id="insert" parameterType="Blog">
        INSERT INTO BLOG(ID, TITLE, WORDS)
        VALUES(#{id},#{title}, #{words})
    </insert>
    <insert id="insertError">
-- 模拟一个错误……
        SELECT * FROM NOT_EXIST_TABLE
    </insert>
</mapper>
```

> **在mybatis里，DAO一般指mapper。**

一开始的mybatis也是通过xml定义配置。`mybatis-config`：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE configuration
    PUBLIC "-//mybatis.org//DTD Config 3.0//EN"
    "http://mybatis.org/dtd/mybatis-3-config.dtd">
<configuration>
	<settings>
		<setting name="lazyLoadingEnabled" value="false" />
	</settings>
	<typeAliases>
		<typeAlias alias="Blog" type="io.puppylpg.mybatis.entity.Blog" />
	</typeAliases>

	<mappers>
		<mapper resource="io/puppylpg/mybatis/mapper/BlogDao.xml" />
	</mappers>

</configuration>
```
简直和`hibernate.cfg.xml`一模一样：
1. 数据源：不过这个文件里没定义数据源，后期才进行组装的，见main函数；
2. mybatis相关设置；
3. 加载orm映射文件，也就是entity和mapper；

hibernate用的是`SessionFactory`，mybatis用的是`SqlSessionFactory`。结合spring的话，配置个`SqlSessionFactoryBean`就行了：
```java
    @Bean
    public SqlSessionFactoryBean sessionFactoryBean(DataSource dataSource) throws IOException {
        SqlSessionFactoryBean sqlSessionFactoryBean = new SqlSessionFactoryBean();
        sqlSessionFactoryBean.setDataSource(dataSource);
        sqlSessionFactoryBean.setConfigLocation(new ClassPathResource("mybatis-config.xml"));

        // 也可以通过这个设置要扫描的mapper的位置
        // 但是如果mybatis-config.xml里配置了mapper，这里又设置了mapper，如果mapper重了，就会报错
//        sqlSessionFactoryBean.setMapperLocations(new PathMatchingResourcePatternResolver().getResources("classpath:io/puppylpg/mybatis/entity/*.xml"));
        return sqlSessionFactoryBean;
    }
```

执行：
```java
    public static void main(String... args) {
        ApplicationContext applicationContext = new AnnotationConfigApplicationContext(SpringUseRawMybatisXmlConfig.class);
        SqlSessionFactory sqlSessionFactory = applicationContext.getBean(SqlSessionFactory.class);

        try (SqlSession session= sqlSessionFactory.openSession()) {

            Blog blog = Blog.builder().id(1).title("mybatis is awesome").words(10000).build();
            // 定义的xml mapper，只能这么去执行……
            session.insert("io.puppylpg.mybatis.raw.mapper.BlogDao.insert", blog);
            // 如果是类mapper，就能这么执行
//            BlogMapper mapper = session.getMapper(BlogMapper.class);
//            mapper.insert(elasticsearch);

            List<Blog> list = session.selectList("io.puppylpg.mybatis.raw.mapper.BlogDao.getAllBlogs");
            System.out.println(list);
        }
    }
```

## xml mapper的注册和使用
因为mybatis是半自动的，所以怎么注册xml mapper成为了一个问题:
- 可以在`mybatis-config.xml`里通过`<mapper>`手动注册xml mapper；
- 也可以在声明`SqlSessionFactoryBean`的时候手动`setMapperLocations`注册xml mapper；

**使用xml mapper，必须指定statement，以声明用的是xml mapper里定义的哪个statement**：
```java
            // 定义的xml mapper，只能这么去执行……
            session.insert("io.puppylpg.mybatis.raw.mapper.BlogDao.insert", blog);
```

**xml mapper也可以使用namespace关联一个interface，使用interface mapper有一个好处：方法都定义的是Java的接口方法，所以可以直接调用**。比如：
```java
            // 如果是类mapper，就能这么执行
            BlogMapper mapper = session.getMapper(BlogMapper.class);
            mapper.insert(elasticsearch);
```

## mapper bean
**注册好xml mapper之后**，虽然可以从`SqlSession`里获取mapper类进行调用，但还是不够方便。**mybatis-spring提供了`MapperScannerConfigurer`**，设置扫描mapper的路径`setBasePackage`，**可以把包里所有的interface注册为一个bean（`MapperFactoryBean`）**，需要用的时候直接@Autowire就行了，远比使用`SqlSession#getMapper`方便！

**`MapperFactoryBean`的自定义获取bean的方式，其实还是`SqlSession#getMapper`**：
```java
  @Override
  public T getObject() throws Exception {
    return getSqlSession().getMapper(this.mapperInterface);
  }
```

配置`MapperScannerConfigurer`也很简单，指定好要用的`SqlSessionFactory`，设定好package就行了：
```java
    @Bean
    public MapperScannerConfigurer mapperScannerConfigurer(SqlSessionFactory sqlSessionFactory) {
        MapperScannerConfigurer mapperScannerConfigurer = new MapperScannerConfigurer();
        mapperScannerConfigurer.setSqlSessionFactory(sqlSessionFactory);


        mapperScannerConfigurer.setBasePackage(BlogDao.class.getPackage().getName());
        return mapperScannerConfigurer;
    }
```
它实现了`BeanDefinitionRegistryPostProcessor`接口，会在该bean实例化之后，将mapper扫描为bean，注册到`SqlSessionFactory`里：
```java
  public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
    if (this.processPropertyPlaceHolders) {
      processPropertyPlaceHolders();
    }

    ClassPathMapperScanner scanner = new ClassPathMapperScanner(registry);
    scanner.setAddToConfig(this.addToConfig);
    scanner.setAnnotationClass(this.annotationClass);
    scanner.setMarkerInterface(this.markerInterface);
    scanner.setSqlSessionFactory(this.sqlSessionFactory);
    scanner.setSqlSessionTemplate(this.sqlSessionTemplate);
    scanner.setSqlSessionFactoryBeanName(this.sqlSessionFactoryBeanName);
    scanner.setSqlSessionTemplateBeanName(this.sqlSessionTemplateBeanName);
    scanner.setResourceLoader(this.applicationContext);
    scanner.setBeanNameGenerator(this.nameGenerator);
    scanner.registerFilters();
    scanner.scan(StringUtils.tokenizeToStringArray(this.basePackage, ConfigurableApplicationContext.CONFIG_LOCATION_DELIMITERS));
  }
```
它的Javadoc有很多有用信息，主要阐述了哪些接口能被注册为bean：
- **只有（有方法存在）的接口才符合条件，实体类不可以**：Note that only interfaces with at least one method will be registered; concrete classes will be ignored.
- **可以用注解或者标记接口对扫描类做筛选**：This class supports filtering the mappers created by either specifying a marker interface or an annotation. The annotationClass property specifies an annotation to search for. The markerInterface property specifies a parent interface to search for. If both properties are specified, mappers are added for interfaces that match either criteria. By default, these two properties are null, so all interfaces in the given basePackage are added as mappers.

**mybatis-spring还提供了`@MapperScan`注解，配置的内容其实和MapperScannerConfigurer是一样的**。如果查看@MapperScan的处理类MapperScannerRegistrar，**就会发现mybatis-spring其实是读取前者的配置，然后构造出后者。所以他俩其实是一个东西**。

mybatis本身提供了一个标记接口`@Mapper`，没有实际用处。**不过在mybatis-spring-boot-starter里，所有用@Mapper标记的接口都直接生成mapper bean。但是一旦配置了@MapperScan，@Mapper就又失效了**，又没用了。为什么？**因为springboot的auto config（`AutoConfiguredMapperScannerRegistrar`）和@MapperScan一样也是构造出一个MapperScannerConfigurer，设置它的`annotationClass=Mapper.class`**。所以如果用了@MapperScan，就已经有一个MapperScannerConfigurer，springboot也就不再自动配置了。

> 把“站在前人的肩膀上”玩得明明白白。这就是框架的堆叠啊！一个不明白，步步不明白！

> 看这些自动配置类，又一次很明显地看出来：springboot的确就是把别人在开发项目的时候写到项目里的配置放到了auto config类里。

## `SqlSessionTemplate`
同样mybatis-spring提供了`SqlSessionTemplate`，通过`SqlSessionFactory`构建：
```java
    @Bean
    public SqlSessionTemplate sqlSessionTemplate(SqlSessionFactory sqlSessionFactory) {
        return new SqlSessionTemplate(sqlSessionFactory);
    }
```
使用`SqlSessionTemplate`：
```java
/**
 * @author puppylpg on 2022/07/12
 */
@Repository
public class BlogMybatisTemplateDao {

    /**
     * 封装了{@link org.apache.ibatis.session.SqlSession}的方法
     */
    @Autowired
    private SqlSessionTemplate sqlSessionTemplate;

    public void insert(Blog blog) {
        // 要么调xml里定义的“BlogDao空间下的”insert方法
        sqlSessionTemplate.insert("io.puppylpg.mybatis.raw.mapper.BlogDao.insert", blog);

        // 要么获取一个xml（作为实现）对应的接口的实例，再调用实例的方法
        BlogDao blogDao = sqlSessionTemplate.getMapper(BlogDao.class);
        blogDao.insert(blog);
    }

    public List<Blog> getAllBlogs() {
        // orm框架都是以回调的方式处理数据
        BlogDao blogDao = sqlSessionTemplate.getMapper(BlogDao.class);
        return blogDao.getAllBlogs();
    }

    public void insertError() {
        throw new RuntimeException(":sigh");
    }
}
```
`SqlSessionTemplate`支持上述两种mapper用法：
1. xml mapper，需要指定statement；
2. interface mapper，需要先`getMapper`再使用；

但是不如`MapperScannerConfigurer`直接把mapper interface注册成spring bean方便。

## 事务
跟之前一样，配置好jdbc的`DataSourceTransactionManager`，使用`@Transactional`标记一下就行了：
```java
    @Transactional
    @Override
    public void addOneFail(Blog blog) {
        addOne(blog);
        showAll();
        blogMybatisTemplateDao.insertError();
    }
```

debug日志：
```
00:21:08.443 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Creating new ansaction with name [io.puppylpg.mybatis.spring.service.BlogServiceImpl.addOneFail]: OPAGATION_REQUIRED,ISOLATION_DEFAULT
00:21:08.446 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Acquired nnection [HikariProxyConnection@586358252 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA] for JDBC ansaction
00:21:08.448 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Switching JDBC nnection [HikariProxyConnection@586358252 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA] to manual commit
00:21:08.451 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Creating a new SqlSession
00:21:08.456 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Registering transaction synchronization for lSession [org.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e]
00:21:08.461 [main] DEBUG org.mybatis.spring.transaction.SpringManagedTransaction - JDBC Connection ikariProxyConnection@586358252 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA] will be managed by Spring
00:21:08.464 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.insert - ==>  Preparing: INSERT INTO BLOG(ID, TLE, WORDS) VALUES(?,?, ?)
00:21:08.482 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.insert - ==> Parameters: 1(Integer), il(String), 0(Long)
00:21:08.484 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.insert - <==    Updates: 1
00:21:08.485 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Releasing transactional SqlSession rg.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e]
00:21:08.488 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Fetched SqlSession rg.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e] from current transaction
00:21:08.491 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.insert - ==>  Preparing: INSERT INTO BLOG(ID, TLE, WORDS) VALUES(?,?, ?)
00:21:08.491 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.insert - ==> Parameters: 1(Integer), il(String), 0(Long)
00:21:08.491 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.insert - <==    Updates: 1
00:21:08.491 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Releasing transactional SqlSession rg.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e]
00:21:08.491 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Fetched SqlSession rg.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e] from current transaction
00:21:08.492 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.getAllBlogs - ==>  Preparing: SELECT * FROM OG b
00:21:08.502 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.getAllBlogs - ==> Parameters:
00:21:08.525 [main] DEBUG io.puppylpg.mybatis.raw.dao.BlogDao.getAllBlogs - <==      Total: 22
00:21:08.528 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Releasing transactional SqlSession rg.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e]
[Blog(id=99998, title=come on, words=10086), Blog(id=99999, title=the last, words=10087), Blog(id=99998, tle=come on, words=10086), Blog(id=99999, title=the last, words=10087), Blog(id=99998, title=come on, rds=10086), Blog(id=99999, title=the last, words=10087), Blog(id=99998, title=come on, words=10086), og(id=99999, title=the last, words=10087), Blog(id=99998, title=come on, words=10086), Blog(id=99999, tle=the last, words=10087), Blog(id=99998, title=come on, words=10086), Blog(id=99999, title=the last, rds=10087), Blog(id=99998, title=come on, words=10086), Blog(id=99999, title=the last, words=10087), og(id=99998, title=come on, words=10086), Blog(id=99999, title=the last, words=10087), Blog(id=99998, tle=come on, words=10086), Blog(id=99999, title=the last, words=10087), Blog(id=99998, title=come on, rds=10086), Blog(id=99999, title=the last, words=10087), Blog(id=1, title=fail, words=0), Blog(id=1, tle=fail, words=0)]
00:21:08.528 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Transaction synchronization deregistering lSession [org.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e]
00:21:08.528 [main] DEBUG org.mybatis.spring.SqlSessionUtils - Transaction synchronization closing SqlSession rg.apache.ibatis.session.defaults.DefaultSqlSession@8c3619e]
00:21:08.528 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Initiating ansaction rollback
00:21:08.528 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Rolling back BC transaction on Connection [HikariProxyConnection@586358252 wrapping conn0: url=jdbc:h2:mem:pokemon er=SA]
00:21:08.529 [main] DEBUG org.springframework.jdbc.datasource.DataSourceTransactionManager - Releasing JDBC Connection [HikariProxyConnection@586358252 wrapping conn0: url=jdbc:h2:mem:pokemon user=SA] after transaction
```

# 对比
- jdbc：低级但灵活；
- mybatis：半自动orm，既可以做简单的orm，又可以在复杂的场景下使用sql。当然，用sql就很难离开xml。所以基本无法摆脱xml mapper；
- hibernate：全自动orm，用着简单，但是复杂操作不一定能玩明白，需要好好练；

# 感想
spring对事务的支持太强了！不再赘述。

mybatis的@Mapper，mybatis-spring的@MapperScan、MapperScannerRegistrar，springboot对@Mapper的支持，真的是把框架的堆叠体现的淋漓尽致！框架就像知识的递进，和学习一样，也是需要一步一步踩过来的。断层了后面的就学不扎实了。

