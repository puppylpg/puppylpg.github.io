---
layout: post
title: "Spring - AOP"
date: 2021-11-22 01:14:49 +0800
categories: spring AOP
tags: spring AOP
---

`AOP`，Aspect Oriented Programing，面向切面编程。
- OOP，面向对象，适用于有相同逻辑的情况：把相同逻辑抽到父类中实现；
- AOP，面向切面，适用于有横向相同逻辑的情况：只适合具有横切逻辑的场合，比如：
    - 性能检测
    - 访问控制
    - 事务管理
    - 日志记录

1. Table of Contents, ordered
{:toc}

# AOP的概念
AOP有一些相关概念：
- 连接点（`Joinpoint`）：可以用来注入代码的地方，比如类初始化前后，方法调用前后，异常抛出后。**Spring仅支持方法层面的连接点**，所以对spring aop来说，**连接点就是方法**；
    > **哪里可以注入**
- 切点（`Pointcut`）：符合一定条件的连接点。一般并不会对所有连接点都注入代码，只对感兴趣的连接点注入。而切点就是符合一定条件的连接点；
    > **在哪里注入，但是注意：切点只定位方法，不定位到方法调用前还是方法调用后（这是属于advice干的事儿）**
- 增强（`Advice`）：叫增强（Enhancer）更合适，指需要注入的代码；
    > **注入什么**。增强为什么叫advice？难道是给你提出新的“建议”，从而让你变得更强？？？
- 引介（`Introduction`）：**一种特殊的增强。一般增强只能给原生类的某些方法增加一些代码（即只能修改方法），但是它可以为原生类添加属性、添加方法**；
    > 所以通过引介，可以让原生类 **新实现一些本没有实现的接口，拥有全新的功能**
- 切面（Aspect）：增强 + 切点；
    > **切面直接回答了所有问题：在哪里，注入什么**
- 织入（Weaving）：将advice注入joinpoint。一般按照织入的时机，分为：
    + 编译时（AspectJ）：通过特殊java编译器，**在生成字节码文件时**，多产生一部分字节码（增强的内容）；
    + 类加载：字节码文件没问题，但是classloader在加载字节码之后，手动添加一些内容。需要特殊的类加载器；
    + 运行时（**java动态代理、cglib**）：即动态代理，在运行时为目标类生成具有增强代码的子类；
- 代理（Proxy）：注入增强代码后的类，称为代理类。生成的对象为代理对象。和原生类具有相同的接口；

# AOP的实现者
## AspectJ
AspectJ拓展了Java语法，新增了AOP语法，所以需要新的具有拓展功能的Java编译器去编译用AspectJ写的代码。但是编译后的字节码是完全符合原生Java规范的。

所以AspectJ是编译器织入增强代码。

## Spring AOP
纯Java实现，在 **运行期** 使用动态代理给目标类织入增强代码。spring用到的动态代理有两种：
- JDK自带的动态代理：**仅可以代理接口，即动态产生一个接口的实现类，具有增强的功能**；
- 基于CGLib的动态代理：**可以代理类，即动态产生一个代理类的子类，该子类具有增强的功能**；

> 关于dk动态代理和cglib动态代理：[Java反射与动态代理]({% post_url 2020-08-02-java-reflection-dynamic-proxy %})

# AOP接口
AOP的接口由AOP联盟制作。

按照增强注入到连接点的位置，分为：
- 前置增强 `BeforeAdvice`：在调用之前加点儿东西；
    + spring仅有一个子接口 `MethodBeforeAdvice`，因为只能对方法注入增强
- 后置增强 `AfterReturningAdvice`：在调用之后加点儿东西；
- 环绕增强 `MethodInterceptor`：前置 + 后置；
- 异常抛出增强 `ThrowsAdvice`：仅在抛出异常后执行增强代码，**所以可以把处理异常的逻辑单独抽出去**；

还有一个：
- 引介增强 `IntroductionInterceptor`

# 手动组装
## 仅使用增强
还是之前的两个问题：
1. 在哪儿注入：切点
2. 注入什么：增强

所以需要手动指定这两点。

接口：一个要考试、要玩耍、会崩溃的学生：
```java
public interface Student {
   void examine(String name);
   void play(String name);
   void breakdown(String name) throws RuntimeException;
}
```
原生类：一个正常的学生实现：
```java
public class NaiveStudent implements Student {

	@Override
	public void examine(String name) {
		System.out.println("Start to examine for: " + name);
	}

	@Override
	public void play(String name){
		System.out.println("Start to play: " + name);
	}

	@Override
	public void breakdown(String name) throws RuntimeException {
		System.out.println("I break down: " + name);
		throw new RuntimeException("<exit>");
	}
}
```
但这还不够——一个优秀的学生，考前要知道复习，考后要记得放松休息。

考前复习增强：
```java
/**
 * 考前要知道复习
 */
@Component
public class PrepareBeforeExam implements MethodBeforeAdvice {
    @Override
    public void before(Method method, Object[] args, Object target) throws Throwable {
        if ("examine".equals(method.getName())) {
            String name = (String) args[0];
            System.out.println("[before] prepare for: " + name + " in: " + target.getClass().getName() + "." + method.getName());
        } else {
            System.out.println("[WRONG before] only 'examine' can be proxied");
        }
    }
}
```

考后放松增强：
```java
/**
 * 玩后要知道休息
 */
@Component
public class SleepAfterPlay implements AfterReturningAdvice {

	@Override
	public void afterReturning(Object returnObj, Method method, Object[] args, Object target) throws Throwable {
		if ("play".equals(method.getName())) {
			String name = (String) args[0];
			System.out.println("[after] sleep for: " + name + " in: " + target.getClass().getName() + "." + method.getName());
		} else {
			System.out.println("[WRONG after] only 'play' can be proxied");
		}
	}
}
```

其实来个环绕增强，可以一步搞定前面的两种增强。考前放松，考后休息一步到位：
```java
/**
 * 考前复习 + 考后放松
 */
@Component
public class PrepareThenRelaxAroundExam implements MethodInterceptor {

	public Object invoke(MethodInvocation invocation) throws Throwable {
		if ("examine".equals(invocation.getMethod().getName())) {
			Object[] args = invocation.getArguments();
			String name = (String) args[0];
			// 获取前置后置增强接口里的信息
			Method method = invocation.getMethod();
			Object target = invocation.getThis();
			System.out.println("[around] prepare for: " + name + " in: " + target.getClass().getName() + "." + method.getName());

			Object obj = invocation.proceed();

			System.out.println("[around] relax for: " + name);
			return obj;
		} else {
			System.out.println("[WRONG around] only 'examine' can be proxied");

			// 不在前后做什么东西
			return invocation.proceed();
		}
	}
}
```

异常处理的增强：
```java
/**
 * 一般处理异常的都叫xxxManager。它能把处理异常的代码从主代码中分离出来。
 * 但是这个处理异常的代码只是在异常发生后，像拦截器一样被调用一下，它并不能阻止异常被继续抛出。
 *
 * 另外这个接口是一个签名接口。方法自己定义，并需要符合某几个格式，比如这里写的这个格式。
 *
 * @author puppylpg on 2022/07/04
 */
@Component
public class BreakdownManager implements ThrowsAdvice {

    public void afterThrowing(Method method, Object[] args, Object target, Exception ex) throws Throwable {
        System.out.println("    -----------");
        System.out.println("method: " + method.getName());
        System.out.println("exception catched: " + ex.getMessage());
        System.out.println("Handle student's exception successfully~");
        System.out.println("    -----------");
    }
}
```
异常处理ThrowsAdvice只是一个标记接口，没有定义函数，但是有一些默认的规范，有好几种写法，上面是其中一种。

> 小心一个思维误区：**异常处理增强会处理异常，并不意味着不需要管异常了。在处理完exception之后，会继续把异常往外抛：它不会直接把异常吞掉**。它只是在发生异常之后做一些事情，比如spring @Transaction处理增强，是在发生异常之后完成事务回滚的要求：删掉事务中已插入的数据。处理完之后，异常还会继续抛出去，需要调用者处理（比如打log）。
>
> 换个角度想想，如果spring在增强里把异常吞掉了，虽然事务的确回滚了，但是程序猿却不知道曾发生过这个异常，这就很离谱。

把advice和target组装起来：
```java
/**
 * @author puppylpg on 2022/07/04
 */
public class Config {

    @Bean
    public Student naiveStudent() {
        return new NaiveStudent();
    }
}

/**
 * @author puppylpg on 2022/07/04
 */
@ComponentScan(basePackages = {"io.puppylpg.aop.advice"})
@Configuration
@Import(Config.class)
public class OnlyAdvice {

    /**
     * 如果一个bean是{@link org.springframework.beans.factory.FactoryBean}，getBean的时候，
     * get的不是这个factory bean本身，而是它产生的bean。
     *
     * 所以这里get到的实际是一个{@link Student}。
     */
    @Bean(name = "strengthenStudent")
    public ProxyFactoryBean proxyFactoryBean(Student student) {
        ProxyFactoryBean proxyFactoryBean = new ProxyFactoryBean();
        // 和下面的target二选一
//        proxyFactoryBean.addInterface(Student.class);
        // 如果代理的是个类，那只能cglib
        proxyFactoryBean.setTarget(student);
        proxyFactoryBean.setInterceptorNames("prepareBeforeExam", "sleepAfterPlay", "prepareThenRelaxAroundExam", "breakdownManager");
        return proxyFactoryBean;
    }
}
```
组装的方式和jdk动态代理或者cglib差不多简单：
1. 指定要代理的对象/接口：如果指定的是对象，就只能使用cglib以子类的方式生成代理；
2. 指定要进行的增强；

为什么配置ProxyFactoryBean？因为创建proxy object的流程比较复杂，所以以FactoryBean的形式封装起来了。对于程序猿来讲，只需要设置接口/对象、增强就行了。

> `FactoryBean`是一种特殊的bean，是使用一个自定义的工厂组装bean。当调用getBean获取bean的时候，返回的并不是factory bean本身，而是调用了`FactoryBean#getObject`方法，返回了这个factory用自定义的方法造出的bean。

`ProxyFactoryBean`可以设置以下几个属性：
- target：基于谁进行增强，即被代理对象；
- proxyInterfaces：代理要实现哪些接口。其实就是被代理类的接口；
- proxyTargetClass：代理哪个类。和上面的属性二选一。如果是代理类，只能CGLib；
- interceptorNames：织入哪些东西；
- optimize：如果优化，就是用CGLib，毕竟CGLib生成的代理类运行效率更高；
- singleton：默认为true。如果不是singleton，就别用CGLib了；

获取加强版学生：
```java
    private static void run(Class<?>... annotatedClasses) {
        ApplicationContext applicationContext = new AnnotationConfigApplicationContext(annotatedClasses);

        // 这里必须使用bean名称获取Student bean，因为ProxyFactoryBean在创建bean的时候会生成一个Student类型的bean
        // NoUniqueBeanDefinitionException: No qualifying bean of type 'io.puppylpg.aop.Student' available: expected single matching bean but found 2: naiveStudent,strengthenStudent
        Student strengthen = applicationContext.getBean("strengthenStudent", Student.class);

        System.out.println("========= examine =========");
        strengthen.examine("math");
        System.out.println("========= play =========");
        strengthen.play("halo");
        System.out.println("========= break down =========");
        try {
            strengthen.breakdown("wtf");
        } catch (RuntimeException e) {
            System.out.println("BUT THE EXCEPTION STILL THROW");
        }
    }
```
输出：
```
========= examine =========
[before] prepare for: math in: io.puppylpg.aop.NaiveStudent.examine
[around] prepare for: math in: io.puppylpg.aop.NaiveStudent.examine
Start to examine for: math
[around] relax for: math
[WRONG after] only 'play' can be proxied
========= play =========
[WRONG before] only 'examine' can be proxied
[WRONG around] only 'examine' can be proxied
Start to play: halo
[after] sleep for: halo in: io.puppylpg.aop.NaiveStudent.play
========= break down =========
[WRONG before] only 'examine' can be proxied
[WRONG around] only 'examine' can be proxied
I break down: wtf
    -----------
method: breakdown
exception catched: <exit>
Handle student's exception successfully~
    -----------
BUT THE EXCEPTION STILL THROW
```
examine和play都织入了增强。

不过有个问题：examine前需要复习，play前还需要复习吗？**如果只想对examine注入增强怎么办？这是一个指定切点的问题**。

这也是上面的“[WRONG after]/[WRONG before]/[WRONG around]”输出的原因。

显然，如果像上面一样只用增强，还要在增强之前判断一下该方法是不是我们要增强的方法`if ("examine".equals(method.getName()))`，非常啰嗦，在接口里再抽象出一个统一的match方法会更好，而这就是在判断切点。

## 切面advisor：只增强特定切点
**在哪儿注入，注入什么，这两个问题加起来就是切面**。

### 切点
注入代码的地方用切点表示。spring用`Pointcut`表示切点，有两种过滤方式：类符不符合要求、方法符不符合要求。所以Pointcut里有两种filter：
```java
public interface Pointcut {

	/**
	 * Return the ClassFilter for this pointcut.
	 * @return the ClassFilter (never {@code null})
	 */
	ClassFilter getClassFilter();

	/**
	 * Return the MethodMatcher for this pointcut.
	 * @return the MethodMatcher (never {@code null})
	 */
	MethodMatcher getMethodMatcher();


	/**
	 * Canonical Pointcut instance that always matches.
	 */
	Pointcut TRUE = TruePointcut.INSTANCE;

}
```

> 虽然可以在实现增强的时候先判断一下类和方法是不是目标类和方法，但是这样对开发者的负担过重了。如果框架能提前让开发者指定只给特定的方法注入增强，也就是切点，那么开发者的开发工作会清晰简洁很多。这一点很像spring容器提供的事件触发机制：只有接收相应事件的listener才能收到事件，而不是所有的listener。

### 切面`Advisor`
spring用`Advisor`接口表示切面，用这个词大概是因为提出advice（增强）的人（advisor）会告诉你在哪里（pointcut）注入什么东西（advice）？可能是吧。**反正没有Aspect这个接口**。

切面接口类型：
- `Advisor`：**只包含一个增强Advice**，但是没定义切点，所以默认对所有切入点生效。也就是上面举的例子。**因为太宽泛，一般不会直接使用**；
    + 主要方法：`Advice getAdvice()`
- `PointcutAdvisor`：含有切点的切面。指定特定的地方注入advice；
    + 新增方法：`Pointcut getPointcut()`

**所以一般主要用的就是`PointcutAdvisor`**。

### `PointcutAdvisor`
`PointcutAdvisor`的实现类有很多种，分别对应不同的指定切面的策略：
- `DefaultPointcutAdvisor`：自定义`Pointcut`和`Advice`；
- `NameMatchMethodPointcutAdvisor`：通过方法名指定切点的切面；
- `RegexpMethodPointcutAdvisor`：通过正则指定切点的切面；
- `StaticMethodMatcherPointcutAdvisor`：静态方法匹配切点定义的切面；

等等。

### `StaticMethodMatcherPointcutAdvisor`
**是通过方法名来定义切点的。**

搞一个只会给examine方法（但没说方法调用前还是方法调用后）进行增强的切面：
```java
/**
 * {@link NaiveStudent#examine(String)}切面，但是advice还没决定，需要后期{@link #setAdvice(Advice)}。
 *
 * @author puppylpg on 2022/07/04
 */
public class ExamAdvisor extends StaticMethodMatcherPointcutAdvisor {

    @Override
    public boolean matches(Method method, Class<?> targetClass) {
        return "examine".equals(method.getName());
    }

    @Override
    public ClassFilter getClassFilter(){
        return NaiveStudent.class::isAssignableFrom;
    }
}
```
**切面所定义的切点只是“在哪个方法”，但是在方法“之前”还是“之后”则由增强决定**。比如上面说的AfterReturnAdvice。

同理，其他两个切面：
```java
/**
 * {@link NaiveStudent#play(String)}切面，但是advice还没决定，需要后期{@link #setAdvice(Advice)}。
 *
 * @author puppylpg on 2022/07/04
 */
@Component
public class PlayAdvisor extends StaticMethodMatcherPointcutAdvisor {

    @Override
    public boolean matches(Method method, Class<?> targetClass) {
        return "play".equals(method.getName());
    }

    @Override
    public ClassFilter getClassFilter(){
        return NaiveStudent.class::isAssignableFrom;
    }
}

/**
 * {@link NaiveStudent#breakdown(String)}切面，但是advice还没决定，需要后期{@link #setAdvice(Advice)}。
 *
 * @author puppylpg on 2022/07/04
 */
@Component
public class BreakdownAdvisor extends StaticMethodMatcherPointcutAdvisor {

    @Override
    public boolean matches(Method method, Class<?> targetClass) {
        return "breakdown".equals(method.getName());
    }

    @Override
    public ClassFilter getClassFilter(){
        return NaiveStudent.class::isAssignableFrom;
    }
}
```

配置的时候，先把advice放入advisor，这样切面就完整了（切点 + 增强）：
```java
    @Bean
    @Scope(value = ConfigurableBeanFactory.SCOPE_PROTOTYPE)
    public ExamAdvisor examAdvisor() {
        return new ExamAdvisor();
    }

    /**
     * 添加完增强的切面才是完整的切面
     */
    @Bean
    public ExamAdvisor beforeExamAdvisor(ExamAdvisor examAdvisor, PrepareBeforeExam prepareBeforeExam) {
//        ExamAdvisor examAdvisor = new ExamAdvisor();
        examAdvisor.setAdvice(prepareBeforeExam);
        return examAdvisor;
    }

    /**
     * 绑定另一个增强，则又是一个新的切面
     */
    @Bean
    public ExamAdvisor aroundExamAdvisor(ExamAdvisor examAdvisor, PrepareThenRelaxAroundExam prepareThenRelaxAroundExam) {
//        ExamAdvisor examAdvisor = new ExamAdvisor();
        examAdvisor.setAdvice(prepareThenRelaxAroundExam);
        return examAdvisor;
    }

    @Bean
    public PlayAdvisor afterPlayAdvisor(SleepAfterPlay sleepAfterPlay) {
        PlayAdvisor playAdvisor = new PlayAdvisor();
        playAdvisor.setAdvice(sleepAfterPlay);
        return playAdvisor;
    }

    @Bean
    public BreakdownAdvisor afterThrowBreakdownAdvisor(BreakdownManager breakdownManager) {
        BreakdownAdvisor breakdownAdvisor = new BreakdownAdvisor();
        breakdownAdvisor.setAdvice(breakdownManager);
        return breakdownAdvisor;
    }
```
切面定义好了，和之前一样，配置一个ProxyFactoryBean用于生成代理对象bean就行了：
```java
    /**
     * 如果一个bean是{@link org.springframework.beans.factory.FactoryBean}，getBean的时候，
     * get的不是这个factory bean本身，而是它产生的bean。
     *
     * 所以这里get到的实际是一个{@link Student}。
     */
    @Bean(name = "strengthenStudent")
    public ProxyFactoryBean proxyFactoryBean(Student student) {
        ProxyFactoryBean proxyFactoryBean = new ProxyFactoryBean();
        // 和下面的target二选一DefaultAdvisorAutoProxyCreator
//        proxyFactoryBean.addInterface(Student.class);
        // 如果代理的是个类，那只能cglib
        proxyFactoryBean.setTarget(student);
        proxyFactoryBean.setInterceptorNames("beforeExamAdvisor", "afterPlayAdvisor", "aroundExamAdvisor", "afterThrowBreakdownAdvisor");
        return proxyFactoryBean;
    }
```
这次`setInterceptorNames`方法里设置的是advisor，之前设置的是advice。

输出结果：
```
========= examine =========
[before] prepare for: math in: io.puppylpg.aop.NaiveStudent.examine
[around] prepare for: math in: io.puppylpg.aop.NaiveStudent.examine
Start to examine for: math
[around] relax for: math
========= play =========
Start to play: halo
[after] sleep for: halo in: io.puppylpg.aop.NaiveStudent.play
========= break down =========
I break down: wtf
    -----------
method: breakdown
exception catched: <exit>
Handle student's exception successfully~
    -----------
BUT THE EXCEPTION STILL THROW
```
输出里没有了“[WRONG after]/[WRONG before]/[WRONG around]”，说明增强只在指定的切点生效了。

### `RegexpMethodPointcutAdvisor`
regex匹配切点的切面只需要配置一下想要的正则就行了，切点为所有play方法：
```java
    /**
     * 能正则匹配的切面
     */
    @Bean
    public RegexpMethodPointcutAdvisor gexpMethodPointcutAdvisor(SleepAfterPlay sleepAfterPlay) {
        RegexpMethodPointcutAdvisor advisor = new RegexpMethodPointcutAdvisor();
        advisor.setAdvice(sleepAfterPlay);
        advisor.setPattern(".*play.*");
        return advisor;
    }
```

- 好处：自然是比直接静态方法名匹配功能强大；
- 坏处：后期添加新方法的时候，没准儿就和正则匹配上了，导致添加了毫无预期的增强，有点儿不可控。

> 我怎么突然变强了？原来是冥冥之中被之前的正则选中了。

## 一些其他类型的切面
### 动态切面：支持判断参数
`StaticMethodMatcherPointcutAdvisor`通过判断类、方法名是否符合条件，从而决定是否织入。所以是一种静态的切面。

如果判断到入参级别呢？入参只有运行的时候才知道入参是什么，此时的判断相当于是动态判断了。

spring之前提供了一种 ~~`DynamicMethodMatcherPointcutAdvisor`~~，不过后来弃用了。可以通过动态切点`DynamicMethodMatcherPointcut` + `DefaultPointcutAdvisor`的方式，组成一个动态切面。

之前说过，`Pointcut`判断类是否符合，用的是`ClassFilter`：
```java
public interface ClassFilter {

	/**
	 * Should the pointcut apply to the given interface or target class?
	 * @param clazz the candidate target class
	 * @return whether the advice should apply to the given target class
	 */
	boolean matches(Class<?> clazz);


	/**
	 * Canonical instance of a ClassFilter that matches all classes.
	 */
	ClassFilter TRUE = TrueClassFilter.INSTANCE;

}
```
就是简单和类名匹配一下，看类名是不是自己想增强的类。不是的话就不是pointcut。

判断方法是否符合也是一样的，`MethodMatcher`：
```java
public interface MethodMatcher {

	/**
	 * Perform static checking whether the given method matches. If this
	 * returns {@code false} or if the {@link #isRuntime()} method
	 * returns {@code false}, no runtime check (i.e. no.
	 * {@link #matches(java.lang.reflect.Method, Class, Object[])} call) will be made.
	 * @param method the candidate method
	 * @param targetClass the target class (may be {@code null}, in which case
	 * the candidate class must be taken to be the method's declaring class)
	 * @return whether or not this method matches statically
	 */
	boolean matches(Method method, Class<?> targetClass);

	/**
	 * Is this MethodMatcher dynamic, that is, must a final call be made on the
	 * {@link #matches(java.lang.reflect.Method, Class, Object[])} method at
	 * runtime even if the 2-arg matches method returns {@code true}?
	 * <p>Can be invoked when an AOP proxy is created, and need not be invoked
	 * again before each method invocation,
	 * @return whether or not a runtime match via the 3-arg
	 * {@link #matches(java.lang.reflect.Method, Class, Object[])} method
	 * is required if static matching passed
	 */
	boolean isRuntime();

	/**
	 * Check whether there a runtime (dynamic) match for this method,
	 * which must have matched statically.
	 * <p>This method is invoked only if the 2-arg matches method returns
	 * {@code true} for the given method and target class, and if the
	 * {@link #isRuntime()} method returns {@code true}. Invoked
	 * immediately before potential running of the advice, after any
	 * advice earlier in the advice chain has run.
	 * @param method the candidate method
	 * @param targetClass the target class (may be {@code null}, in which case
	 * the candidate class must be taken to be the method's declaring class)
	 * @param args arguments to the method
	 * @return whether there's a runtime match
	 * @see MethodMatcher#matches(Method, Class)
	 */
	boolean matches(Method method, Class<?> targetClass, Object[] args);


	/**
	 * Canonical instance that matches all methods.
	 */
	MethodMatcher TRUE = TrueMethodMatcher.INSTANCE;

}
```
但是这个东西除了判断方法名，还有一个重载方法，**判断args。这就是运行时动态判断了**。所以接口里还有一个`isRuntime()`方法，直接挑明究竟用不用动态匹配。

动态匹配和静态匹配的区别是什么：
- 静态匹配是创建代理bean的时候，就能决定要不要织入增强，所以不影响后续代码的性能；
- 动态匹配是创建代理bean的时候，不能决定要不要织入增强，所以要给所有的代理bean都织入一个if...else...增强。这样那些实际上不需要增强的bean（比如参数不匹配的bean），也要进行这些if...else...的判断。**而判断就意味着spring在运行时要通过反射先获取这些方法、参数，所以影响性能**。

所以`boolean matches(Method method, Class<?> targetClass, Object[] args)`的Javadoc说的很清楚：**This method is invoked only if the 2-arg matches method returns true for the given method and target class, and if the isRuntime() method returns true.**

所以想用动态切面，除了要实现`boolean matches(Method method, Class<?> targetClass, Object[] args)`，还要实现`boolean matches(Method method, Class<?> targetClass)`和`boolean isRuntime()`，**先使用后两个方法进行“剪枝”**。

一个示例实现（DynamicMethodMatcherPointcut已经实现isRuntime方法恒为true了）：
```java
public class PrepareDynamicPointcut extends DynamicMethodMatcherPointcut {
	private static List<String> toPrepare = new ArrayList<String>();

	static {
		toPrepare.add("math");
		toPrepare.add("physics");
	}

	@Override
	public ClassFilter getClassFilter() {
		return new ClassFilter() {
			public boolean matches(Class clazz) {
				boolean result = NaiveStudent.class.isAssignableFrom(clazz);
				System.out.println("STATIC check - prepare or not for class: " + clazz.getName());
				System.out.println("result is: " + result);
				return result;
			}
		};
	}

	@Override
	public boolean matches(Method method, Class clazz) {
		boolean result = "examine".equals(method.getName());
		System.out.println("STATIC check - prepare or not for method: " + clazz.getName() + "." + method.getName());
		System.out.println("result is: " + result);
		return result;
	}

	public boolean matches(Method method, Class clazz, Object[] args) {
		String name = (String) args[0];
		boolean result = toPrepare.contains(name);
		System.out.println("DYNAMIC check - prepare or not for: " + name + " in: " + clazz.getName() + "." + method.getName());
		System.out.println("result is: " + result);
		return result;
	}
}
```

### 组合切面
`ComposablePointcut`，它也是一个`Pointcut`，**可以无限intersection或者union其他切面，所以它是一个切面的交并集**。因此，使用`DefaultPointcutAdvisor`的时候，切点使用组合切点，其实就是一个组合的切面。

# 自动创建代理
无论是自己手动指定切点和advice，还是把切点和advice组合成切面，本质上都是把他们交给`ProxyFactoryBean`，让`ProxyFactoryBean`去生成代理bean。最大的问题是：**每需要一个代理对象，就要这么配置一次bean** ……如果系统需要一堆代理bean，这样扛不住啊。

spring能不能根据某些条件，自动创建出一批代理bean？当然可以。

spring实现了一些`BeanPostProcessor`，只要发现要创建的bean满足某些规则，就会自动为这个bean创建代理bean。

## 给哪些bean自动创建动态代理
### `BeanNameAutoProxyCreator` - 根据bean名称设定条件
凡是满足相应名称的bean，通通生成代理bean。

只要名称是Teacher结尾的bean，通通注入“提前复习”这一增强：
```xml
	<bean id="naiveStudent" class="com.smart.advisor.NaiveStudent" />
	<bean id="naiveTeacher" class="com.smart.advisor.NaiveTeacher" />
	<bean id="prepareAdvice" class="com.smart.advisor.PrepareBeforeAdvice" />

	<!-- 通过Bean名称自动创建代理 -->
	<bean class="org.springframework.aop.framework.autoproxy.BeanNameAutoProxyCreator"
		p:beanNames="*Teacher" p:interceptorNames="prepareAdvice"
		p:optimize="true"/>
```
然后我们就不用手动配置加强版学生和老师的bean了。**所以获取bean也只能获取naiveStudent/naiveTeacher了，因为配置里只写了它们的名字**。

> **注意：同理，使用正则配置非常坑，因为spring本身也有很多bean，很可能他们就和正则名称匹配上了。** 一开始我配置的正则是`*er`，直接导致spring启动失败了，因为它内部的某些bean也是er结尾的，在注入增强的时候，增强的逻辑是把入参强转为string（见上面的PrepareAdvice代码），而他们的入参不能强制转为string，报错了。

### `DefaultAdvisorAutoProxyCreator` - 按照切面配置增强
上面花里胡哨讲了一大堆切面，不就是想说：切面代表着切点和增强嘛，有了切面，既知道在哪里注入，又知道要注入什么。**既然如此，切面不就指明了所有要代理的bean的信息吗？**

所以定义一堆切面之后：
```java
    /**
     * 不能再用这个了，这是一个不完善的切面，会被{@link #defaultAdvisorAutoProxyCreator()}
     * 检测到，用的时候发现这个切面不完整：UnknownAdviceTypeException
     */
//    @Bean
//    @Scope(value = ConfigurableBeanFactory.SCOPE_PROTOTYPE)
//    public ExamAdvisor examAdvisor() {
//        return new ExamAdvisor();
//    }
//
    /**
     * 添加完增强的切面才是完整的切面
     */
    @Bean
    public ExamAdvisor beforeExamAdvisor(PrepareBeforeExam prepareBeforeExam) {
        ExamAdvisor examAdvisor = new ExamAdvisor();
        examAdvisor.setAdvice(prepareBeforeExam);
        return examAdvisor;
    }

    /**
     * 绑定另一个增强，则又是一个新的切面
     */
    @Bean
    public ExamAdvisor aroundExamAdvisor(PrepareThenRelaxAroundExam prepareThenRelaxAroundExam) {
        ExamAdvisor examAdvisor = new ExamAdvisor();
        examAdvisor.setAdvice(prepareThenRelaxAroundExam);
        return examAdvisor;
    }

    @Bean
    public PlayAdvisor afterPlayAdvisor(SleepAfterPlay sleepAfterPlay) {
        PlayAdvisor playAdvisor = new PlayAdvisor();
        playAdvisor.setAdvice(sleepAfterPlay);
        return playAdvisor;
    }

    @Bean
    public BreakdownAdvisor afterThrowBreakdownAdvisor(BreakdownManager breakdownManager) {
        BreakdownAdvisor breakdownAdvisor = new BreakdownAdvisor();
        breakdownAdvisor.setAdvice(breakdownManager);
        return breakdownAdvisor;
    }
```
就可以自动给符合这些切面的bean创建动态代理了：
```java
    /**
     * 一个{@link org.springframework.beans.factory.config.BeanPostProcessor}，能自动检测所有的切面bean，
     * 所有被该切面匹配的bean都会生成代理对象。
     */
    @Bean
    public DefaultAdvisorAutoProxyCreator defaultAdvisorAutoProxyCreator() {
        return new DefaultAdvisorAutoProxyCreator();
    }
}
```

现在可以直接获取Student类型的bean了：之前的那些配置都会先创建普通的Student，再创建增强的Student，会有两个Student类型的bean，所以要使用名称作区分。现在spring只创建了增强后的Student，直接通过类型获取bean就可以了：
```java
        // 这里只需要使用类型就行了，因为只会有一个名为naiveStudent的bean，它在创建的时候会被BeanPostProcessor处理一下，变成增强bean，但名字没变
        Student strengthen = applicationContext.getBean(Student.class);
```
输出：
```
========= examine =========
[before] prepare for: math in: io.puppylpg.aop.NaiveStudent.examine
[around] prepare for: math in: io.puppylpg.aop.NaiveStudent.examine
Start to examine for: math
[around] relax for: math
========= play =========
Start to play: halo
[after] sleep for: halo in: io.puppylpg.aop.NaiveStudent.play
========= break down =========
I break down: wtf
    -----------
method: breakdown
exception catched: <exit>
Handle student's exception successfully~
    -----------
BUT THE EXCEPTION STILL THROW
```
输出和之前使用ProxyFactoryBean的时候一模一样，功能没什么区别。

## 这些`BeanPostProcessor`是谁
以`DefaultAdvisorAutoProxyCreator`为例。因为它是给所有符合切面的bean创建动态代理，所以在它的父类`AbstractAutoProxyCreator`的`postProcessBeforeInstantiation`里：
```java
		// Create proxy here if we have a custom TargetSource.
		// Suppresses unnecessary default instantiation of the target bean:
		// The TargetSource will handle target instances in a custom fashion.
		TargetSource targetSource = getCustomTargetSource(beanClass, beanName);
		if (targetSource != null) {
			if (StringUtils.hasLength(beanName)) {
				this.targetSourcedBeans.add(beanName);
			}
			Object[] specificInterceptors = getAdvicesAndAdvisorsForBean(beanClass, beanName, targetSource);
			Object proxy = createProxy(beanClass, beanName, specificInterceptors, targetSource);
			this.proxyTypes.put(cacheKey, proxy.getClass());
			return proxy;
		}
```
1. 获取这个bean相关的切面；
3. createProxy：创建的流程几乎等于之前手动配置ProxyFactoryBean。不过这里创建的是ProxyFactory；

而获取bean相关的切面也很直白：
```java
	protected List<Advisor> findEligibleAdvisors(Class<?> beanClass, String beanName) {
		List<Advisor> candidateAdvisors = findCandidateAdvisors();
		List<Advisor> eligibleAdvisors = findAdvisorsThatCanApply(candidateAdvisors, beanClass, beanName);
		extendAdvisors(eligibleAdvisors);
		if (!eligibleAdvisors.isEmpty()) {
			eligibleAdvisors = sortAdvisors(eligibleAdvisors);
		}
		return eligibleAdvisors;
	}
```
1. 获取所有的advisor：`advisors.add(this.beanFactory.getBean(name, Advisor.class))`；
2. 遍历advisor，找到符合该bean的advisor：通过advisor配置的class filter之类的进行判断；

# AOP同类方法调用不会增强
假设一个类有方法a和b，给a和b都进行了增强。

调用增强后的a：
```
...a before advice
...a
...a after advice
```

调用增强后的b：
```
---b before advice
---b
---b after advice
```

如果现在修改一下，在a的方法里调用b，则a的输出为：
```
...a before advice
...a
---b
...a after advice
```
而非：
```
...a before advice
...a
---b before advice
---b
---b after advice
...a after advice
```
也就是说，**此时a中调用的b并不是增强后的b**。

因为 **在同一个类方法内部进行调用的时候，不会使用被增强的代理类，而是直接调用了方法**。

## 无事务方法调用有事务增强方法
这个问题最常见的一个场景就是“无事务方法调用有事务增强方法，会导致有事务增强的方法得不到增强”：
```java
a() {
    b()
}

@Transactional
b()
```
如果方法a没有开启事务，b开启事务：
- 直接调用b是会得到AOP的事务增强的；
- 但是如果调用的是a，那么其实是同类中的方法调用，b也不会有事务增强。

同理，把@Transaction换成@Cacheable也都是一个道理，通过调用a间接调用b时，b产生的结果不会被缓存。

# 总结
spring IOC是spring的基础，但spring AOP才是spring的杀手锏！因为AOP，才有了：
- @Transaction事务管理；
- @Retry重试；
- @Cacheable缓存；
- @Async异步；
- spring data自动CRUD；

等等。

spring通过AOP让程序猿的开发变得简单了太多太多，隐藏了开发中的样板代码和苦力活，让开发变得有意思起来！spring aop是我爱上spring的关键！
