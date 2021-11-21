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
- 连接点（`Joinpoint`）：可以用来注入代码的地方，比如类初始化前后，方法调用前后，异常抛出后。**Spring仅支持方法层面的连接点**，所以对spring aop来说，连接点就是方法；
    > **哪里可以注入**
- 切点（`Pointcut`）：符合一定条件的连接点。一般并不会对所有连接点都注入代码，只对感兴趣的连接点注入。而切点就是符合一定条件的连接点；
    > **在哪里注入**
- 增强（`Advice`）：叫增强（Enhancer）更合适，指需要注入的代码；
    > **注入什么**。增强为什么叫advice？难道是给你提出新的“建议”，从而让你变得更强？？？
- 引介（`Introduction`）：**一种特殊的增强。一般增强只能给原生类的某些方法增加一些代码（即只能修改方法），但是它可以为原生类添加属性、添加方法**；
    > 所以通过引介，可以让原生类 **新实现一些本没有实现的接口，拥有全新的功能**
- 切面（Aspect）：增强 + 切点；
    > **切面直接回答了所有问题：在哪里，注入什么**
- 织入（Weaving）：将advice注入joinpoint。一般按照织入的时机，分为：
    + 编译时：通过特殊java编译器，**在生成字节码文件时**，多产生一部分字节码（增强的内容）；
    + 类加载：字节码文件没问题，但是classloader在加载字节码之后，手动添加一些内容。需要特殊的类加载器；
    + 运行时：即动态代理，在运行时为目标类生成具有增强代码的子类；
- 代理（Proxy）：注入增强代码后的类，称为代理类。生成的对象为代理对象。和原生类具有相同的接口；

# AOP的实现者
## AspectJ
AspectJ拓展了Java语法，新增了AOP语法，所以需要新的具有拓展功能的Java编译器。但是编译后的字节码是完全符合原生Java规范的。

所以AspectJ是编译器织入增强代码。

## Spring AOP
纯Java实现，在运行期使用动态代理给目标类织入增强代码。spring用到的动态代理有两种：
- JDK自带的动态代理：**仅可以代理接口，即动态产生一个接口的实现类，具有增强的功能**；
- 基于CGLib的动态代理：**可以代理类，即动态产生一个代理类的子类，该子类具有增强的功能**；

# AOP接口
AOP的接口由AOP联盟制作。

按照增强注入到连接点的位置，分为：
- 前置增强 `BeforeAdvice`
    + spring仅有一个子接口 `MethodBeforeAdvice`，因为只能对方法注入增强
- 后置增强 `AfterReturningAdvice`
- 环绕增强 `MethodInterceptor`：前置 + 后置；
- 异常抛出增强 `ThrowsAdvice`：仅在抛出异常后执行增强代码；

还有一个：
- 引介增强 `IntroductionInterceptor`

# 手动组装
还是之前的两个问题：
1. 在哪儿注入：切点
2. 注入什么：增强

所以需要手动指定这两点。

接口：一个要考试、要玩耍的学生
```
public interface Student {
   void examine(String name);
   void play(String name);
}
```
原生类：一个正常的学生实现
```
public class NaiveStudent implements Student {

	public void examine(String name) {
		System.out.println("Start to examine for: " + name);
	}
	
	public void play(String name){
		System.out.println("Start to play: " + name);
	}
}
```
但这还不够。一个优秀的学生，考前要知道复习，考后要记得放松休息。

考前复习增强：
```
public class PrepareBeforeAdvice implements MethodBeforeAdvice {

	public void before(Method method, Object[] args, Object obj) throws Throwable {
		String name = (String)args[0];
		System.out.println("[before]prepare for :" + name);
	}
}
```

考后放松增强：
```
public class RelaxAfterAdvice implements AfterReturningAdvice {

	public void afterReturning(Object returnObj, Method method, Object[] args, Object obj) throws Throwable {
		String name = (String) args[0];
		System.out.println("[after]relax for :" + name);
	}
}
```

再来个环绕增强，考前放松，考后休息一步到位：
```
public class PrepareRelaxAroundInterceptor implements MethodInterceptor {

	public Object invoke(MethodInvocation invocation) throws Throwable {
		Object[] args = invocation.getArguments();
		String name = (String)args[0];
		System.out.println("[around]prepare for: " + name);
		
		Object obj = invocation.proceed();

		System.out.println("[around]relax for: " + name);
		return obj;
	}
}
```
把这些都配置为容器里的bean：
```
<?xml version="1.0" encoding="UTF-8" ?>
<beans xmlns="http://www.springframework.org/schema/beans"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:p="http://www.springframework.org/schema/p"
	xsi:schemaLocation="http://www.springframework.org/schema/beans 
     http://www.springframework.org/schema/beans/spring-beans-4.0.xsd">

	<bean id="prepareBefore" class="com.smart.advice.PrepareBeforeAdvice" />
	<bean id="relaxAfter" class="com.smart.advice.RelaxAfterAdvice" />
	<bean id="prepareRelaxAround" class="com.smart.advice.PrepareRelaxAroundInterceptor" />
	
	<bean id="naiveStudent" class="com.smart.advice.NaiveStudent" />

    <!-- weaving -->
	<bean id="strengthenStudent" class="org.springframework.aop.framework.ProxyFactoryBean"
		  p:proxyInterfaces="com.smart.advice.Student" p:target-ref="naiveStudent"
		  p:interceptorNames="prepareRelaxAround,prepareBefore,relaxAfter" />

</beans>
```

获取加强版学生：
```
	@Test
	public void advice() {
		String configPath = "com/smart/advice/beans.xml";
		ApplicationContext ctx = new ClassPathXmlApplicationContext(configPath);
		
		Student strengthen = (Student)ctx.getBean("strengthenStudent");
		strengthen.examine("math");
		strengthen.play("halo");
	}
```
输出：
```
[around]prepare for: math
[before]prepare for :math
Start to examine for: math
[after]relax for :math
[around]relax for: math

[around]prepare for: halo
[before]prepare for :halo
Start to play: halo
[after]relax for :halo
[around]relax for: halo
```
examine和play都织入了增强。

不过有两个问题：
1. examine前需要复习，play前还需要复习吗？**如果想只对examine注入增强怎么办？这是一个指定切点的问题**；
2. 怎么配置组装出strengthen student的？

## 怎么配置组装
配置里，先给三种增强配置了bean，很正常。

配置了一个navieStudent，作为原生对象。然后再配置一个strengthenStudent，后者是naiveStudent + 三个增强：
```
    <!-- weaving -->
	<bean id="strengthenStudent" class="org.springframework.aop.framework.ProxyFactoryBean"
		  p:proxyInterfaces="com.smart.advice.Student" p:target-ref="naiveStudent"
		  p:interceptorNames="prepareRelaxAround,prepareBefore,relaxAfter" />
```
首先，**不存在strengthen student这个类，所以获取这个对象的地方是：`ProxyFactoryBean`**：
1. `FactoryBean`是一种特殊的bean，是使用一个自定义的工厂组装bean。当调用getBean获取bean的时候，返回的并不是factory bean本身，而是调用了`FactoryBean#getObject`方法，返回了这个factory用自定义的方法造出的bean；
2. `ProxyFactoryBean`是一种`FactoryBean`，它使用`ProxyFactory`来生成代理类。

`ProxyFactoryBean`可以设置一下几个属性：
- target：基于谁进行增强，即被代理对象；
- proxyInterfaces：代理要实现哪些接口。其实就是被代理类的接口；
- proxyTargetClass：代理哪个类。和上面的属性二选一。如果是代理类，只能CGLib；
- interceptorNames：织入哪些东西；
- optimize：如果优化，就是用CGLib，毕竟CGLib生成的代理类运行效率更高；
- singleton：默认为true。如果不是singleton，就别用CGLib了；

# 切面：只增强特定切点
其实，在哪儿注入，注入什么，这两个问题合起来就是切面。

## 切点
注入代码的地方用切点表示。spring用`Pointcut`表示切点，有两种过滤方式：类符不符合要求、方法符不符合要求。所以Pointcut里有两种filter：
```
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

> 虽然好像可以在实现增强的时候先判断一下类和方法是不是目标类和方法，但是这样对开发者的负担过重了。如果框架能提前让开发者指定只给特定的方法注入增强，也就是切点，那么开发者的开发工作会清晰简洁很多。这一点很像spring容器提供的事件触发机制：只有接收相应事件的listener才能收到事件，而不是所有的listener。

## `Advisor`
spring用`Advisor`接口表示切面，用这个词大概是因为提出advice（增强）的人（advisor）会告诉你在哪里（pointcut）注入哪些（advice）？可能是吧。**反正没有Aspect这个接口**。

切面接口类型：
- `Advisor`：**只包含一个Advice**，默认对所有切入点生效。也就是上面举的例子。**因为太宽泛，一般不会直接使用**；
    + 主要方法：`Advice getAdvice()`
- `PointcutAdvisor`：含有切点的切面。指定特定的地方注入advice；
    + 新增方法：`Pointcut getPointcut()`

**所以一般主要用的就是`PointcutAdvisor`**。

## `PointcutAdvisor`
`PointcutAdvisor`的实现类有很多种，分别对应不同的指定切面的策略：
- `DefaultPointcutAdvisor`：自定义`Pointcut`和`Advice`；
- `NameMatchMethodPointcutAdvisor`：通过方法名指定切点的切面；
- `RegexpMethodPointcutAdvisor`：通过正则指定切点的切面；
- `StaticMethodMatcherPointcutAdvisor`：静态方法匹配切点定义的切面；

等等。

### `StaticMethodMatcherPointcutAdvisor`
先试试静态方法匹配。是通过方法名来定义切点的。

还是上文的NaiveStudent。新增一个NaiveTeacher，也是不知道考前复习的老师：
```
public class NaiveTeacher {

	public void examine(String name) {
		System.out.println("Start to examine as teacher for: " + name);
	}
```

还是上文的考前提前准备增强，不过这次输出信息里多加了类信息，用以明确被增强的类：
```
public class PrepareBeforeAdvice implements MethodBeforeAdvice {

	public void before(Method method, Object[] args, Object obj) throws Throwable {
		String name = (String)args[0];
		System.out.println("[before]prepare for :" + name + " in: " + obj.getClass().getName()+"."+method.getName());
	}
}
```

定义切面，使用静态方法名匹配。只给examine方法加增强，play方法就不必了（玩儿halo有啥好提前复习的……）：
```
public class PrepareAdvisor extends StaticMethodMatcherPointcutAdvisor {

	public boolean matches(Method method, Class clazz) {
		return "examine".equals(method.getName());
	}

	@Override
	public ClassFilter getClassFilter(){
		return new ClassFilter(){
			public boolean matches(Class clazz){
				return NaiveStudent.class.isAssignableFrom(clazz);
			}
		};
	}
}
```
同时override了父类方法进行了类过滤，只给学生加这个增强，不给老师加。默认是给所有类加的。

配置：
```
<?xml version="1.0" encoding="UTF-8" ?>
<beans xmlns="http://www.springframework.org/schema/beans"
	   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:p="http://www.springframework.org/schema/p"
	   xsi:schemaLocation="http://www.springframework.org/schema/beans
	http://www.springframework.org/schema/beans/spring-beans-4.0.xsd">

	<bean id="naiveStudent" class="com.smart.advisor.NaiveStudent" />
	<bean id="naiveTeacher" class="com.smart.advisor.NaiveTeacher" />
	
	<bean id="prepareBeforeAdvice" class="com.smart.advisor.PrepareBeforeAdvice" />
	<bean id="prepareAdvisor" class="com.smart.advisor.PrepareAdvisor"
		  p:advice-ref="prepareBeforeAdvice" />

	<bean id="parent" abstract="true"
		class="org.springframework.aop.framework.ProxyFactoryBean"
		p:interceptorNames="prepareAdvisor" p:proxyTargetClass="true" />
	<bean id="strengthenStudent" parent="parent" p:target-ref="naiveStudent" />
	<bean id="strengthenTeacher" parent="parent" p:target-ref="naiveTeacher" />
</beans>
```
配置了两个naive学生和老师、考前增强、**仅加到学生身上的考前增强切面**。还配置了用该切面增强的代理学生和代理老师（以父子bean的方式简化配置）。

看看加强版学生和老师表现如何：
```
	@Test
	public void staticMethod(){
		String configPath = "com/smart/advisor/beans.xml";
		ApplicationContext ctx = new ClassPathXmlApplicationContext(configPath);
		NaiveStudent strengthenStudent = (NaiveStudent)ctx.getBean("strengthenStudent");
		NaiveTeacher strengthenTeacher = (NaiveTeacher)ctx.getBean("strengthenTeacher");
		strengthenStudent.examine("math");
		strengthenStudent.play("halo");
		strengthenTeacher.examine("math");
	}
```

输出结果：
```
[before]prepare for :math in: com.smart.advisor.NaiveStudent.examine
Start to examine as student for: math

Start to play as student for: halo

Start to examine as teacher for: math
```
1. 增强：加强版学生果然加强了，考前知道复习了；
2. 切点：加强版学生并没有影响到play，play之前并没有增强；
3. 加强版老师什么效果都没有，因为加强对它根本不适用。所以它还是一个考前不会复习的老师；

### `RegexpMethodPointcutAdvisor`
regex匹配切点的切面只需要配置一下想要的正则就行了，只对examine增强，无论学生老师：
```
	<bean id="regexpAdvisor"
		class="org.springframework.aop.support.RegexpMethodPointcutAdvisor"
		p:advice-ref="prepareBeforeAdvice">
		<property name="patterns">
			<list>
				<value>.*examine.*</value>
			</list>
		</property>
	</bean>
```
然后用该切面实例化一个加强版学生：
```
	<bean id="strengthenByRegexStudent" class="org.springframework.aop.framework.ProxyFactoryBean"
		p:interceptorNames="regexpAdvisor" p:target-ref="naiveStudent"
		p:proxyTargetClass="true" />
```

- 好处：自然是比直接静态方法名匹配功能强大；
- 坏处：后期添加新方法的时候，没准儿就和正则匹配上了，导致添加了毫无预期的增强，有点儿不可控。

> 我怎么突然变强了？原来是冥冥之中被之前的正则选中了。

## 动态切面
`StaticMethodMatcherPointcutAdvisor`通过判断类、方法名是否符合条件，从而决定是否织入。所以是一种静态的切面。

如果判断到入参级别呢？入参只有运行的时候才知道入参是什么，此时的判断相当于是动态判断了。

spring之前提供了一种 ~~`DynamicMethodMatcherPointcutAdvisor`~~，不过后来弃用了。可以通过动态切点`DynamicMethodMatcherPointcut` + advise的方式，使用`DefaultPointcutAdvisor`组成一个动态切面。

之前说过，`Pointcut`判断类是否符合，用的是`ClassFilter`：
```
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
```
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
但是这个东西出了判断方法名，还有一个重载方法，**判断args。这就是运行时动态判断了**。所以接口里还有一个`isRuntime()`方法，直接挑明究竟用不用动态匹配。

动态匹配和静态匹配的区别是什么：
- 静态匹配是获取代理bean的时候，就能决定要不要织入增强，所以不影响后续代码的性能；
- 动态匹配时每次执行目标方法的时候，都要检查一下是不是需要织入，所以影响性能。

**但我其实不是很理解**：干脆提前织入，然后织入代码放在if else里，条件就是判断入参是否条件。这样的话，对性能不就没啥影响了？不过也有弊端，那就是所有的方法都织入，生成的类也太大了。是不是处于这个考量，每次都要运行时判断？

**不过我还是不理解**：一个代理对象，还能来回来去决定织不织入？？？那这个代理对象也太惨了……反复鞭尸……所以“织入”难道不是类似于直接“写入字节码”了吗？还能再擦掉？

说回代码，增强内容不变：提前复习。需要判断到入参的动态pointcut：
```
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
1. 首先，只有学生类才有可能织入；
2. 其次，只有examine才有可能织入；
3. 最后，只有考数学课和物理才值得复习：只有入参是数学和物理才织入增强；

把增强内容和pointcut组合起来，生成一个切面advisor：
```
	<bean id="dynamicAdvisor" class="org.springframework.aop.support.DefaultPointcutAdvisor">
		<property name="pointcut">
			<bean class="com.smart.advisor.PrepareDynamicPointcut" />
		</property>
		<property name="advice">
			<bean class="com.smart.advisor.PrepareBeforeAdvice" />
		</property>
	</bean>
```
配置一个加强版学生：
```
	<bean id="strengthenByDynamicStudent" class="org.springframework.aop.framework.ProxyFactoryBean"
		p:interceptorNames="dynamicAdvisor" p:target-ref="naiveStudent"
		p:proxyTargetClass="true" />
```
获取加强版学生，看一下效果：
```
	@Test
	public void dynamic() {
		String configPath = "com/smart/advisor/beans.xml";
		ApplicationContext ctx = new ClassPathXmlApplicationContext(configPath);
		NaiveStudent strengthenByDynamicStudent = (NaiveStudent) ctx.getBean("strengthenByDynamicStudent");

		System.out.println("==========");

		strengthenByDynamicStudent.examine("math");
		strengthenByDynamicStudent.play("halo");
		strengthenByDynamicStudent.examine("english");
		strengthenByDynamicStudent.play("minecraft");
	}
```
输出结果：
```
// 1
STATIC check - prepare or not for class: com.smart.advisor.NaiveStudent
result is: true
STATIC check - prepare or not for method: com.smart.advisor.NaiveStudent.examine
result is: true
STATIC check - prepare or not for class: com.smart.advisor.NaiveStudent
result is: true
STATIC check - prepare or not for method: com.smart.advisor.NaiveStudent.play
result is: false
STATIC check - prepare or not for class: com.smart.advisor.NaiveStudent
result is: true
STATIC check - prepare or not for method: com.smart.advisor.NaiveStudent.toString
result is: false
STATIC check - prepare or not for class: com.smart.advisor.NaiveStudent
result is: true
STATIC check - prepare or not for method: com.smart.advisor.NaiveStudent.clone
result is: false
==========

// 2
STATIC check - prepare or not for class: com.smart.advisor.NaiveStudent
result is: true
STATIC check - prepare or not for method: com.smart.advisor.NaiveStudent.examine
result is: true
DYNAMIC check - prepare or not for: math in: com.smart.advisor.NaiveStudent.examine
result is: true
[before]prepare for :math in: com.smart.advisor.NaiveStudent.examine
Start to examine as student for: math

// 3
STATIC check - prepare or not for class: com.smart.advisor.NaiveStudent
result is: true
STATIC check - prepare or not for method: com.smart.advisor.NaiveStudent.play
result is: false
Start to play as student for: halo

// 4
DYNAMIC check - prepare or not for: english in: com.smart.advisor.NaiveStudent.examine
result is: false
Start to examine as student for: english

// 5
Start to play as student for: minecraft
```
1. 织入前，spring对目标类的所有方法进行静态检查：从静态检查的角度，看哪些有可能需要织入，哪些一定不需要织入；
2. 第一次调用考数学，先静态检查类和方法，再动态检查入参，发现需要增强，于是考数学是带复习了的增强形态；
3. 第一次玩halo，静态检查到play方法就已经不匹配了，说明不需要增强了。没必要再动态匹配入参了；
4. 第一次考英语。因为examine之前静态检查通过了，这里直接开始动态检查。当然动态检查发现，英语不需要提前准备，所以没必要注入增强；
5. 第一次玩Minecraft，因为之前已经静态检查过play方法了，不需要增强，这里直接就不增强了。

## 组合切面
`ComposablePointcut`，它也是一个`Pointcut`，**可以无限intersection或者union其他切面，所以它是一个切面的交并集**。因此，使用`DefaultPointcutAdvisor`的时候，切点使用组合切点，其实就是一个组合的切面。

# 自动创建代理
无论是自己手动指定切点和advice，还是把切点和advice组合成切面，本质上都是把他们交给`ProxyFactoryBean`，让`ProxyFactoryBean`去生成代理bean。最大的问题是：**每需要一个代理对象，就要这么配置一次bean** ……如果系统需要一堆代理bean，这样扛不住啊。

spring能不能根据某些条件，自动创建出一批代理bean？当然可以。

spring实现了一些`BeanPostProcessor`，只要发现要创建的bean满足某些规则，就会自动为这个bean创建代理bean。

## 条件怎么设定
### `BeanNameAutoProxyCreator` - 根据bean名称设定条件
凡是满足相应名称的bean，通通生成代理bean。

只要名称是Teacher结尾的bean，通通注入“提前复习”这一增强：
```
	<bean id="naiveStudent" class="com.smart.advisor.NaiveStudent" />
	<bean id="naiveTeacher" class="com.smart.advisor.NaiveTeacher" />
	<bean id="prepareAdvice" class="com.smart.advisor.PrepareBeforeAdvice" />

	<!-- 通过Bean名称自动创建代理 -->
	<bean class="org.springframework.aop.framework.autoproxy.BeanNameAutoProxyCreator"
		p:beanNames="*Teacher" p:interceptorNames="prepareAdvice"
		p:optimize="true"/>
```
然后我们就不用手动配置加强版学生和老师的bean了。**所以获取bean也只能获取naiveStudent/naiveTeacher了，因为配置里只写了它们的名字**，不过最终获取到的bean不全是navie版的了，有可能是加强版的：
```
	@Test
	public void autoProxy() {
		String configPath = "com/smart/autoproxy/beans.xml";
		ApplicationContext ctx = new ClassPathXmlApplicationContext(configPath);
		NaiveStudent naiveStudent = (NaiveStudent) ctx.getBean("naiveStudent");
		NaiveTeacher naiveTeacher = (NaiveTeacher) ctx.getBean("naiveTeacher");
		naiveStudent.play("halo");
		naiveStudent.examine("math");
		naiveTeacher.examine("english");
	}
```
结果：
```
Start to play for: halo
Start to examine for: math

[before]prepare for :english in: com.smart.advisor.NaiveTeacher.examine
Start to examine as teacher for: english
```
果然，懂复习的老师，和傻呵呵不懂复习的学生。

> **注意：这么配置非常坑，因为spring本身也有很多bean，很可能他们就和正则名称匹配上了。** 一开始我配置的正则是`*er`，直接导致spring启动失败了，因为它内部的某些bean也是er结尾的，在注入增强的时候，增强的逻辑是把入参强转为string（见上面的PrepareAdvice代码），而他们的入参不能强制转为string，报错了。

### `DefaultAdvisorAutoProxyCreator` - 按照切面配置增强
上面花里胡哨讲了一大堆切面，不就是想说：增强代表着切点和advice，有了增强，既知道在哪里注入，又知道要注入什么。既然如此，切面不就指明了所有要代理的bean的信息吗？

是的。所以我们只需要配置切面就行了：
```
	<bean id="naiveStudent" class="com.smart.advisor.NaiveStudent" />
	
	<!-- 增强 -->
	<bean id="prepareAdvice" class="com.smart.advisor.PrepareBeforeAdvice" />
	
	<!-- 切面 -->
	<bean id="regexpAdvisor"
		class="org.springframework.aop.support.RegexpMethodPointcutAdvisor"
		p:patterns=".*examine.*" p:advice-ref="prepareAdvice"  />
	
	<!-- 通过Advisor自动创建代理 -->
	<bean class="org.springframework.aop.framework.autoproxy.DefaultAdvisorAutoProxyCreator"  p:proxyTargetClass="true" />
```
配置了一个给所有examine增强的切面。

获取naive学生（实际是加强学生）：
```
	@Test
	public void autoProxy() {
		String configPath = "com/smart/autoproxy/beans-aware.xml";
		ApplicationContext ctx = new ClassPathXmlApplicationContext(configPath);
		NaiveStudent naiveStudent = (NaiveStudent) ctx.getBean("naiveStudent");
		naiveStudent.play("halo");
		naiveStudent.examine("math");
	}
```
输出：
```
Start to play for: halo

[before]prepare for :math in: com.smart.advisor.NaiveStudent.examine
Start to examine for: math
```
play不增强，examine增强。

## 这些`BeanPostProcessor`是谁
TODO

# `ProxyFactoryBean` & `ProxyFactory`
TODO

