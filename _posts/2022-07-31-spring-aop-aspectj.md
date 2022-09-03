---
layout: post
title: "Spring - 用AspectJ定义切面"
date: 2022-07-31 03:50:10 +0800
categories: spring AOP AspectJ
tags: spring AOP AspectJ
---

[Spring - AOP]({% post_url 2021-11-22-spring-aop %})使用动态代理（jdk或者cglib）实现aop，非常强大，对于程序猿来讲，大部分aop的工作其实就是定义切面，极大简化了开发难度。但是相比于AspectJ，spring aop在定义切面上还是比较麻烦的。所以spring aop想进一步降低程序猿的开发难度。

1. Table of Contents, ordered
{:toc}

# 切面定义的优劣
使用spring aop定义的切面有几个问题：
1. 增强：必须实现spring aop的Advice接口（或其子接口，比如AfterReturningAdvice），耦合了；
    ```
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
2. 切点：切点定义在切面里，且切点定义太麻烦了，指定类和方法需要override相应的函数，看起来臃肿；
    ```
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
    ```
3. 切面：切面不能把切点和增强直接定义在一起，还要在配置里进行组装，麻烦；
    ```
    @Bean
    public PlayAdvisor afterPlayAdvisor(SleepAfterPlay sleepAfterPlay) {
        PlayAdvisor playAdvisor = new PlayAdvisor();
        playAdvisor.setAdvice(sleepAfterPlay);
        return playAdvisor;
    }
    ```

所以spring aop的配置看起来不够优雅。

AspectJ的配置则很简单：
1. 一个切面类 = 切点 + 增强，放在一起；
2. 切面类是普通的pojo！多出来的annotation只是配置，不影响代码执行，所以这个类依然是POJO；
3. 切点定义很方便！当然，缺点是必须得学学切点表达式……

所以spring兼容了AspectJ定义切面的方式，简化了切面配置，其他保持不变。**这里说的AspectJ（包括使用xml定义AspectJ切面、使用@AspectJ注解定义切面），仅仅是替换了spring aop的切面定义方式，底层还是spring aop原有的基于动态代理（jdk、cglib）的方式实现的！**

> spring也可以集成整个AspectJ，但那就是另一块内容了。不再是spring aop，而是在spring里使用AspectJ aop。

其他的：
1. 怎么写增强；
2. 怎么获取连接点信息（spring aop是一堆散参数，AspectJ是JoinPoint/ProceedingJoinPoint）;
3. 怎么获取异常、返回值；

二者大同小异。其中在获取异常方面，AspectJ似乎还更强一些。

**所以spring aop选择直接集成“AspectJ定义切面”的方式**：
- 定义切面可以完全由AspectJ来定义；
- 把AspectJ的切面作为bean由自己来管理； 

这样，二者就强强联合了。

**管理的方式也是一样的：spring声明一个AspectJ相关的BeanPostProcessor`（AspectJAwareAdvisorAutoProxyCreator`），只要发现bean和切面相符合，就给这个bean生成动态代理！**

> 在[Spring - AOP]({% post_url 2021-11-22-spring-aop %})里，spring aop使用的是`DefaultAdvisorAutoProxyCreator`，它和`AspectJAwareAdvisorAutoProxyCreator`一样都是`AbstractAdvisorAutoProxyCreator`的子类。

# @AspectJ定义切面
依然使用[Spring - AOP]({% post_url 2021-11-22-spring-aop %})里相同的接口和实例，区别仅在于切面的定义和动态代理对象的自动生成上。

AspectJ定义切面相关的注解：
- @Aspect：切面，**等同于spring aop里的Advisor，但是好听多了**；
- @Pointcut：切点；
- 增强：**增强里可以使用value或者pointcut通过切点表达式定义切点（匿名切点），所以可能用不到@Pointcut定义切点**
    + @Before
    + @AfterReturning
    + @Around
    + @AfterThrowing
    + @After：相当于Java的finally语法，一般用于释放资源

增强和spring aop的几个增强接口相对应。

前置增强切面：
```
/**
 * @author puppylpg on 2022/07/05
 */
@Aspect
@Component
public class BeforeExamAspect {

    @Before("execution (* examine(..))")
    public void beforeExam(JoinPoint joinPoint) {
        String name = (String) joinPoint.getArgs()[0];
        Object target = joinPoint.getTarget();
        // 获取Method有点儿隐晦
        Method method = ((MethodSignature) joinPoint.getSignature()).getMethod();
        System.out.println("[before] prepare for: " + name + " in: " + target.getClass().getName() + "." + method.getName());
    }
}
```
**直接定义一个切面：切点 + 增强**，非常方便且集中。 而且，它是一个POJO！（多出来的annotation只是配置，不影响代码执行，所以这个类依然是POJO

它比spring aop需要实现特有的切面接口要好得多！ （而且它不再叫org.springframework.aop.Advisor了，直接叫org.aspectj.lang.annotation.Aspect，顺口！） 

当然，得学学aspectj的切点表达式。

后置增强切面：
```
/**
 * @author puppylpg on 2022/07/05
 */
@Aspect
@Component
public class AfterPlayAspect {

    @AfterReturning(value = "execution (* play(..))")
    public void aroundExam(JoinPoint pjp) {
        String name = (String) pjp.getArgs()[0];
        Object target = pjp.getTarget();
        Method method = ((MethodSignature) pjp.getSignature()).getMethod();

        System.out.println("[after] sleep for: " + name + " in: " + target.getClass().getName() + "." + method.getName());
    }
}
```
**在后置增强中，可以使用AfterReturning.returning()绑定连接点方法的返回值**。不过play方法没有返回值，所以没法使用了。

环绕增强切面：
```
/**
 * @author puppylpg on 2022/07/05
 */
@Aspect
@Component
public class AroundExamAspect {

    @Around("execution (* examine(..))")
    public Object aroundExam(ProceedingJoinPoint pjp) throws Throwable {
        String name = (String) pjp.getArgs()[0];
        Object target = pjp.getTarget();
        Method method = ((MethodSignature) pjp.getSignature()).getMethod();
        System.out.println("[around] prepare for: " + name + " in: " + target.getClass().getName() + "." + method.getName());

        Object obj = pjp.proceed();

        System.out.println("[around] relax for: " + name);
        return obj;
    }
}
```
环绕增强的ProceedingJoinPoint比前后增强org.aspectj.lang.JoinPoint 多了ProceedingJoinPoint.proceed()，因为要执行连接点的方法。 

异常处理切面：
```
/**
 * @author puppylpg on 2022/07/05
 */
@Aspect
@Component
public class AfterBreakdownAspect {

    @AfterThrowing(value = "execution (* breakdown(..))", throwing = "ex")
    public void aroundExam(JoinPoint pjp, Exception ex) {
        String name = (String) pjp.getArgs()[0];
        Object target = pjp.getTarget();
        Method method = ((MethodSignature) pjp.getSignature()).getMethod();

        System.out.println("    -----------");
        System.out.println("method: " + method.getName());
        System.out.println("exception catched: " + ex.getMessage());
        System.out.println("Handle student's exception successfully~");
        System.out.println("    -----------");
    }
}
```
通过AfterThrowing.throwing()可以绑定异常，而非spring aop定义切面时候靠着约定帮你注入exception。

# 自动创建代理
```
    /**
     * 类似于aop模块里配置的自动检测切面的{@link DefaultAdvisorAutoProxyCreator}。
     */
    @Bean
    public AnnotationAwareAspectJAutoProxyCreator annotationAwareAspectJAutoProxyCreator() {
        AnnotationAwareAspectJAutoProxyCreator creator = new AnnotationAwareAspectJAutoProxyCreator();

        // 使用cglib。现在会给实现类NaiveStudent织入增强，所以@DebugLog的时候，能打印它的方法签名中在接口里没有的注解
        creator.setProxyTargetClass(true);
        return creator;
    }
```
因为用了AspectJ定义切面，所以使用`AspectJAwareAdvisorAutoProxyCreator`（的子类`AnnotationAwareAspectJAutoProxyCreator`）按照AspectJ的切面自动为相应bean创建动态代理对象。

> 当然这里的对象还是spring aop的动态代理对象，和AspectJ创建代理对象完全没关系。

执行：
```
    private static void run(Class<?>... annotatedClasses) {
        ApplicationContext applicationContext = new AnnotationConfigApplicationContext(annotatedClasses);

        Student strengthen = applicationContext.getBean(Student.class);

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
[around] prepare for: math in: .puppylpg.aspectj.NaiveStudent.examine
[before] prepare for: math in: .puppylpg.aspectj.NaiveStudent.examine
Start to examine for: math
[around] relax for: math
========= play =========
Start to play: halo
[after] sleep for: halo in: .puppylpg.aspectj.NaiveStudent.play
========= break down =========
I break down: wtf
    -----------
method: breakdown
exception catched: <exit>
Handle student's exception successfully~
    -----------
BUT THE EXCEPTION STILL THROW
```
输出跟之前的spring aop没什么区别。

# AspectJ切面中语法
## 切点表达式
咱也不太会，用的时候现学现卖吧。既然享受了AspectJ定义切面带来的福利，就得学人家定义切点的语言呀。

- https://www.baeldung.com/spring-aop-pointcut-tutorial

## 命名切点
增强注解里定义的匿名切点无法复用，类似于Java的匿名类。所以导致切点定义重复了，怎么复用呢？使用@Pointcut注解和切面类方法定义切点。

```
/**
 * 命名切点。调用者需要使用fully qualified class name引用pointcut，
 * 因为是以string的形式调用的
 *
 * @author puppylpg on 2022/07/31
 */
public class ExaminePointcut {

    @Pointcut("execution (* examine(..))")
    public void examine() {}
}
```
调用起来费劲一些，需要使用"io.puppylpg.aspectj.pointcut.ExaminePointcut.examine()"，但是没办法，毕竟是以string的形式调用的：
```
@Aspect
@Component
public class BeforeExamAspect {

    @Before("io.puppylpg.aspectj.pointcut.ExaminePointcut.examine()")
    public void beforeExam(JoinPoint joinPoint) {
        String name = (String) joinPoint.getArgs()[0];
        Object target = joinPoint.getTarget();
        // 获取Method有点儿隐晦
        Method method = ((MethodSignature) joinPoint.getSignature()).getMethod();
        System.out.println("[before] prepare for: " + name + " in: " + target.getClass().getName() + "." + method.getName());
    }
}
```

## 连接点JoinPoint/ProceedingJoinPoint
spring aop的增强接口是传了一堆散参数（method、returnObject、args、target），而AspectJ则是集中放到了JoinPoint/ProceedingJoinPoint里。

JoinPoint：
- getArgs
- getSignature
- getTarget
- getThis

ProceedingJoinPoint继承了JoinPoint，增加了用来执行切点方法的两个接口方法：
- proceed
- proceed(args)：可以骚操作一下，传入新的args，替换原来的args；

具体使用可以参考上面@Aspect里的增强。

# jdk和cglib做动态代理的区别
自定义一个方法注解@DebugLog，使用AspectJ定义环绕增强切面，在方法调用前后打debug log。

```
/**
 * 标记在方法上，给标注的方法增加debug log。
 *
 * @see io.puppylpg.aspectj.advisor.DebugLogAspect
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD})
public @interface DebugLog {
}
```
切面：
```
/**
 * @author puppylpg on 2022/07/06
 */
@Aspect
@Component
public class DebugLogAspect {

    private static final String DEBUG_PROMPT = "[debug log] ";

    /**
     * 用注解定义切点：标注{@link io.puppylpg.aspectj.annotation.DebugLog}的方法就是切点
     */
    @Pointcut("@annotation(io.puppylpg.aspectj.annotation.DebugLog))")
    public void debugLogPointCut(){

    }

    @Around("debugLogPointCut()")
    public Object logDebugInfo(ProceedingJoinPoint joinPoint) throws Throwable {
        StringBuilder message = new StringBuilder(DEBUG_PROMPT + joinPoint.getSignature().getName() + " is called!" + System.lineSeparator());

        // 获取join point的静态信息。方法签名可以获取方法的各种相关信息！
        MethodSignature methodSignature = (MethodSignature) joinPoint.getStaticPart().getSignature();

        // 获取method中的所有注解变量
        Annotation[][] paramsAnnotations = methodSignature.getMethod().getParameterAnnotations();
        Object[] args = joinPoint.getArgs();

        message.append(allArgInfos(paramsAnnotations, args));
        System.out.println(message);

        Object ret = null;
        try {
            ret = joinPoint.proceed();
            return ret;
        } finally {
            System.out.println(DEBUG_PROMPT + joinPoint.getSignature().getName() + " returned. return value=" + ret);
        }
    }

    private String allArgInfos(Annotation[][] paramsAnnotations, Object[] args) {
        StringBuilder message = new StringBuilder();
        List<String> argInfos = new ArrayList<>();
        if (args != null && paramsAnnotations.length == args.length) {
            for (int index = 0; index < paramsAnnotations.length; index++) {
                String param = oneArgInfo(paramsAnnotations[index], args[index], index);
                if (StringUtils.isNotEmpty(param)) {
                    argInfos.add(param);
                }
            }
            message.append(StringUtils.join(argInfos, System.lineSeparator()));
        }
        return message.toString();
    }

    private String oneArgInfo(Annotation[] annotations, Object arg, int index) {
        StringBuilder oneArgInfo = new StringBuilder();
        oneArgInfo.append(DEBUG_PROMPT).append("arg ").append(index).append(":").append(System.lineSeparator());
        for (Annotation annotation : annotations) {
            // 添加arg的annotations
            oneArgInfo.append(DEBUG_PROMPT).append("annotation: ").append(annotation).append(System.lineSeparator());
        }
        // 添加arg的值
        oneArgInfo.append(DEBUG_PROMPT).append("arg value: ").append(arg).append(System.lineSeparator());
        return oneArgInfo.toString();
    }
}
```
接口，没标记任何注解：
```
public interface Student {
   void examine(String name);
   void play(String name);
   void breakdown(String name) throws RuntimeException;
}
```

给实现类的play方法加上@DebugLog注解，**同时给参数新增了一个@NonNull注解**：
```
public class NaiveStudent implements Student {

	@Override
	public void examine(String name) {
		System.out.println("Start to examine for: " + name);
	}

	/**
	 * 这个@NonNull只在实现类里有，在接口里没有
	 * 如果是cglib代理，能基于该实现类生成基于子类的代理对象，{@link DebugLog}就能打印这个@NonNull，
	 * 如果是jdk代理，只能基于{@link Student}接口生成代理对象，就无法打印接口里没有定义的@NonNull
	 */
	@DebugLog
	@Override
	public void play(@NonNull String name){
		System.out.println("Start to play: " + name);
	}

	@Override
	public void breakdown(String name) throws RuntimeException {
		System.out.println("I break down: " + name);
		throw new RuntimeException("<exit>");
	}
}
```
一个好玩的现象是——

如果生成动态代理的AnnotationAwareAspectJAutoProxyCreator使用jdk动态代理（`setProxyTargetClass(false)`），输出：
```
[debug log] play is called!
[debug log] arg 0:
[debug log] arg value: halo
```
如果使用cglib动态代理，输出：
```
[debug log] play is called!
[debug log] arg 0:
[debug log] annotation: @org.springframework.lang.NonNull()
[debug log] arg value: halo
```
所以使用cglib能把实现类函数签名里的@NonNull打出来，而jdk动态代理不行。

这充分说明了：**cglib是基于子类生成的代理，所以代理对象里有@NonNull；而jdk动态代理是基于接口生成的动态代理，所以代理对象里没有@NonNull。**

同理，如果反过来，接口里加了@NonNull但是实现类里没加，那么jdk动态代理生成的bean能输出这个注解，而cglib动态代理不行。

## 注解标注在接口上：等于白标
如果给接口里的play增加@DebugLog，但是不给实现类里的play加@DebugLog，结果再也无法输出debug log了。

这让我很费解，因为在@Transaction里也提到了注解标注的位置：如果标注到接口上，只有基于接口的jdk动态代理才能织入事务支持。所以spring建议把注解加到实现类上：
- https://docs.spring.io/spring-framework/docs/current/reference/html/data-access.html#transaction-declarative-annotations

> The Spring team recommends that you annotate only concrete classes (and methods of concrete classes) with the @Transactional annotation, as opposed to annotating interfaces. You certainly can place the @Transactional annotation on an interface (or an interface method), but this works only as you would expect it to if you use interface-based proxies. The fact that Java annotations are not inherited from interfaces means that, if you use class-based proxies (proxy-target-class="true") or the weaving-based aspect (mode="aspectj"), the transaction settings are not recognized by the proxying and weaving infrastructure, and the object is not wrapped in a transactional proxy.

但是在接口上标记@DebugLog的现象却是：不管用jdk还是cglib，都无法像@Transactional一样织入。为什么？

后来，终于在一个陈年issue中找到了答案：
- 太牛逼了：https://github.com/spring-projects/spring-framework/issues/12320

原因：根据Java标准，任何标注在接口上的注解都不会被检测到（这个我试了，确实如此）
> "AspectJ follows Java's rule that annotations on interfaces are not inherited". Actually all non-type annotations, so method/field/constructor/package annotations, are not inherited

所以，**在AspectJ中使用注解检测切点，如果注解标注在接口上，AspectJ会返回不匹配**。标注在实现类的方法上则会返回匹配。
> So, for pointcut targeting execution of class method annotated with given annotation AspectJ will return that method does not match pointcut expression if the annotation is not on the method implementation being executed - e.g. if it's only on method declaration in interface like in your example.

顺便好心提醒，如果父实现类方法上标注了注解，子类override方法上没标注，也不会有这个注解：
> Even if abstract class had method annotated, and concrete class did overide that method without annotation - that method would not match expression.

而给自己的自定义注解加上`java.lang.annotation.@Inherited`元注解，也只在“class级别”子类会inherit父类的注解。方法上都不会inherit。

**所以想在接口上标记注解作为切点，的确是没卵用的！**

那@Transactional为什么可以？因为spring团队自己为@Transactional注解提供了额外支持，没有只靠AspectJ检测注解定义的切点：
> So framework enables this different behaviour for it's own annotations/aspects. For user/custom aspects it relies on what AspectJ/Java support, but it doesn't prevent you from adding custom logic where/if needed.

所以我们自己定义的注解想标记切点，要么也想spring团队一样模仿@Transactional自己提供支持，要么就把注解老老实实标注到实现类上！

> spring还不如不加这个支持……加了反而让人混淆，以为只要加到接口上并使用jdk基于接口的动态代理就都可以。

# 感想
spring真的是兼收并蓄！毫不吝啬地将已有的成熟方案接入自己的体系，大大方方接纳别人，更是进一步成就了自己！

> 做人又何尝不是这样。大度容人，也是在成就自己。

有更优秀方案，spring就主动接入，也不重复造轮子，确实很不错！不得不说，spring之所以优秀，是因为首先它的心态就很优秀！

