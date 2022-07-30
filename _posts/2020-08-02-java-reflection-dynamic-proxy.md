---
layout: post
title: "Java反射与动态代理"
date: 2020-08-02 23:59:06 +0800
categories: java proxy reflection
tags: java proxy reflection
---

Java在运行时，能够实时获取对象的类型信息：RTTI（RealTime Type Identification，实时类型识别）。比如多态，父类引用引用子类对象，在调用方法时也能准确地调用子类的override方法。本文从RTTI谈到反射，再聊一聊反射相关的一大应用——动态代理。

1. Table of Contents, ordered
{:toc}

# Class对象
Java想知道对象的类型信息，肯定得将类型信息存储在某个地方：
- `.java`文件是类的源代码，运行时肯定用不上；
- `.class`文件是源代码编译后的字节码，也是静态存储，运行时用不上；

不过**jvm在加载java类（class文件）的时候，会生成一个特殊的对象：Class对象**。该对象记录了与类相关的信息，具体信息类型可以在java的Class.java中查看。比如有个类叫Father，加载后会生成一个Father的Class对象`Class<Father>`。

和Father new出来的其他对象相比，Class对象是个特殊的对象，且对于每个类，Class对象都是单例的。一个类new出来的每一个对象都有指向该类Class对象的指针，这样对于每一个对象，都能通过找到它的Class对象，在运行时获取该对象的结构：属性、方法、类信息等。

## `getClass()`
每个对象都有一个指向该类的Class对象的指针，反映在代码层面，就是在Object对象里，有获取该Class对象的方法：
```
public final native Class<?> getClass();
```

> 实际上Java将Class类设计为一个泛型类`Class<T>`，即T类型的Class对象。Object的getClass方法返回的是`Class<?>`，意为“任意类型的Class对象”。`?`表示任何事物，所以`Class<?>`等价于`Class`，但是**使用`Class<?>`的好处是可以明确说明你不是因为疏忽而使用了非具体的类引用，你就是选择了非具体的版本**。对于Object超类来讲，它是任意类型的父类，可能返回任意类型的Class对象，所以使用`Class<?>`作为返回值。

## `Class.forName(String)`
在Java中获取Class对象的另一种方法就是使用Class类提供的静态方法：
```
public static Class<?> forName(String className) throws ClassNotFoundException
```
只要给出完整的类名（带包名的类名），就可以获取该类的Class对象。

# 反射：获取运行时的类信息
类对象记录了类的信息。对于每一个对象，可以通过它的类对象获取哪些信息？看一下Class类的内容就明白了。

- getFields：获取属性；
- getConstructors：获取构造方法；
- getDeclaredMethods：获取普通方法；
- getAnnotations：获取注解；
- getClasses：获取该类的所有类信息（比如该类的父类、接口等）；

还有其他辅助方法，总之，通过类对象，就可以知道这个类的类名、继承关系、定义了哪些属性、方法、构造函数、注解等等。基本把一个类的信息全部拆解了。

Field、Method、Annotation、Constructor等类，就是以上数据结构的实现。他们都是反射包（`java.lang.reflect.*`）里的核心类。

# 动态代理：反射的一大应用
代理是个很常见的概念，比如房屋中介可简单理解为房东的代理，租房人有租房请求，不是直接和房东打交道，而是和代理沟通，至于代理是直接解决租房者的问题，还是和房东沟通后解决租房者的问题，那就是代理自己内部的事情了。

## 静态代理
假设有一个接口Coder：
```
public interface Coder {

    /**
     * finish a demand.
     * @param demand demand
     */
    void implementDemands(String demand);

    /**
     * estimate the time of a demand.
     * @param demand demand
     */
    void estimateTime(String demand);

    /**
     * say something
     * @return
     */
    String comment();
}
```
这个接口是程序猿要做的事情。现在有一个Java程序猿：
```
import lombok.AllArgsConstructor;
import org.apache.commons.lang3.RandomUtils;

/**
 * @author liuhaibo on 2018/04/18
 */
@AllArgsConstructor
public class JavaCoder implements Coder {

    String name;

    @Override
    public void implementDemands(String demand) {
        System.out.println(name + ": I use Java to finish " + demand);
    }

    @Override
    public void estimateTime(String demand) {
        System.out.println(name + ": I'll use " + (demand.length() + RandomUtils.nextInt(3, 9)) + " hours.");
    }

    @Override
    public String comment() {
        return "Java is perfect!";
    }

    /**
     * 这是个没卵用的方法，因为它不在协议内，所以也不会被调用到。。。
     */
    public void showAngry() {
        System.out.println(name + ": I'm very ANGRY!!!");
    }
}
```
它实现了程序猿接口所规定的任务。

静态代理：
```
/**
 * @author liuhaibo on 2018/04/18
 */
@NoArgsConstructor
@AllArgsConstructor
public class StaticProxy implements Coder {

    @Setter
    private Coder coder;

    @Override
    public void implementDemands(String demand) {
        // 代理要挡一些不合理需求，给程序猿最纯粹的任务
        if ("illegal".equals(demand)) {
            System.out.println("No! ILLEGAL demand!");
            return;
        }
        System.out.println("OK, I'll find a coder to do that.");
        coder.implementDemands(demand);
    }

    @Override
    public void estimateTime(String demand) {
        coder.estimateTime(demand);
    }

    @Override
    public String comment() {
        return coder.comment();
    }

}
```
这个静态代理和程序猿有相同的接口，外部给需求的时候，由它来搞定，但实际上，它只是调用Java程序猿来做事情，这是个假程序员，只是一个代理。当然这个代理也做了一些额外的事情，比如外部需求是“illegal”时，由代理直接拒绝该需求，可以避免程序猿的一些琐事：
```
        Coder coder = new JavaCoder("Tom");
        Coder staticProxy = new StaticProxy(coder);

        staticProxy.estimateTime("Hello, world");
        staticProxy.implementDemands("Send an ad");
        staticProxy.implementDemands("illegal");
```
输出：
```
Tom: I'll use 19 hours.
OK, I'll find a coder to do that.
Tom: I use Java to finish Send an ad
No! ILLEGAL demand!
```

## 动态代理
静态代理挺好，但就是太麻烦了。如果想搞一个代理，就要写一个代理类，实现每一个方法。如果有一个统一的需求：在程序猿执行每一个方法前后，都输出一下当前时间，那写一个代理可太烦了，显得重复又无意义。

### 函数f(x)与函数的函数g(x)
说动态代理之前先说一下函数：

为什么要有函数？可以把模板化的代码封装起来，复用逻辑，输入x，输出y。

如果要在函数前后做相同的逻辑呢？比如在每一个方法执行前后，都输出一下当前时间。那就需要函数的函数g(x)：输入f(x)，输出g(f(x))。

**动态代理就是g(x)，我们要做的就是写出g(x)的逻辑。而g(x)的入参是一个函数。**

Java规定，每一个gx都要实现`InvocationHandler`接口：
```
public interface InvocationHandler {

    public Object invoke(Object proxy, Method method, Object[] args)
        throws Throwable;
}
```
而这个接口的入参正是一个函数：
- **`Method`就是那个函数f(x)**；
- **`Object[]`是它的入参的值，也就是f(x)的x的值。为了调用这个函数，得知道它的入参是啥**；
- object proxy是生成的动态代理类。把它作为入参纯粹为了多给出一些信息，其实一般情况下用不到它。

**但是java调用一个method需要有对象才行，所以动态代理少传入了一个原始object，也就是被代理的object**。
因此一般实现InvocationHandler（或者说g(x)）的时候，都传入一个被代理的object作为构造函数的参数。

**有了g(x)，动态代理就是由jvm按照g(x)的逻辑自动生成一个代理对象，把代理对象的每一个函数都按照g(x)处理一遍，而不是让开发者按照静态代理的笨方法，把每一个函数都按照g(x)写一遍**。

Java创建动态代理的流程：
1. 开发者写一个g(x)，它必须是InvocationHandler的实现类；
2. 开发者指定一个接口，这个接口的所有方法都会被应用g(x)；
2. jvm根据指定的接口，自己动态生成一个类，实现该接口；
2. 接口里每一个方法都是这么实现的：每一个方法都调用g(x)；
3. g(x)的返回值，将作为该动态代理对象的相应方法的返回值。

所以理解Java动态代理，还要区分好Java会做什么，开发者要做什么。开发者做好自己的事情就好了，其他的都会由Java按照契约搞定。

开发者实际只需要操心两件事：
1. 为哪个接口创建动态代理；
2. g(x)怎么写：动态代理调用handler时要做什么；

第一步很简单，第二步才是核心。

### InvocationHandler
先来看第二步。

InvocationHandler就是java和开发者之间最核心的契约：
1. **对于java动态生成的接口的实现类，每次对它的方法调用，都转为对指定的InvocationHandler的调用**。
2. **且该handler的返回值，将作为动态代理方法的返回值**。

比如下面的InvocationHandler实现，在方法调用前后都会输出当前时间：
```
import lombok.AllArgsConstructor;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.time.LocalDateTime;

/**
 * 负责在代理对象的方法调用前后bibi一番.
 *
 * @author liuhaibo on 2018/04/19
 */
@AllArgsConstructor
public class BibiAroundInvocationHandler implements InvocationHandler {

    /**
     * 被代理的对象。之所以要用它，是因为毕竟要调用原始方法。
     * 如果用不到被代理对象，就不用把它放进来了
     */
    private Coder coder;

    /**
     * 代理对象在被调用方法时，都会交给该handler（回调该handle的invoke方法）
     *
     * @param proxy jvm生成的代理对象，如果对生成的代理对象不关系，可以不用该参数
     * @param method 要调用的代理对象的方法
     * @param args 要调用的代理对象的方法的参数。method + args才能确定下来要调用哪个方法
     * @return 如果调用的方法会返回值，一般将返回值原封不动的返回回去，当然也可以改改再返回回去
     * @throws Throwable
     */
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {

        System.out.println(">>> Before: " + LocalDateTime.now());
        // 就是通过反射，由函数名、对象、函数参数，去调用此函数。
        Object result = method.invoke(coder, args);
        System.out.println("<<< After: " + LocalDateTime.now());
        return "(Proxy) " + result;
    }
}
```

1. 首先，我们不关心实际的动态代理对象，所以proxy参数没有被用到；
2. 既然我们想在被代理对象的方法被调用前后bibi一番，那一定分为三步：
    - 在方法被调用前，逼逼一下；
    - 调用被代理对象的方法。所以创建BibiAroundInvocationHandler的时候会传入一个被代理的对象Coder，就是为了调用它的方法。调用时使用的是反射：`Method#invoke(object, args)`；
    - 在方法被调用后，逼逼一下；
3. 设置invoke函数的返回值。首先要知道BibiAroundInvocationHandler#invoke的返回值会被Java用作动态代理类的方法调用后的返回值。这里我们只想在方法调用前后bibi一下，无意改变被代理对象方法的返回值，所以对于被代理对象，我们应该将它的返回值作为BibiAroundInvocationHandler#invoke的返回值。不过最后返回前我还是给返回值加上了一个“(Proxy) ”前缀，作为一个demo，我们就能更明显地看到，动态代理对象的返回值被我们刻意改变了，比被代理对象的返回值多加了个前缀。

### Proxy
解决了InvocationHandler实现的核心问题，另一个简单的问题还没解决：为哪个接口生成动态代理类。

Java的Proxy类提供了创建动态代理类的方法，有两个方法比较重要：

- `public static Class<?> getProxyClass(ClassLoader loader, Class<?>... interfaces)`：用于生成给定接口的动态代理类。需要传入接口和该接口的ClassLoader，ClassLoader一般直接传入接口的ClassLoader即可；
- `public static Object newProxyInstance(ClassLoader loader, Class<?>[] interfaces, InvocationHandler h) throws IllegalArgumentException`：用于生成给定借口的动态代理对象。其实这个方法包含了上一个方法，毕竟想生成对象，首先得生成代理类，然后再new一个对象。所以该方法大致有三步：
    + 生成动态代理类：`Class<?> cl = getProxyClass0(loader, intfs)`；
    + 获取动态代理类的构造函数：`private static final Class<?>[] constructorParams = { InvocationHandler.class }; final Constructor<?> cons = cl.getConstructor(constructorParams)`；
    + 生成动态代理对象：`cons.newInstance(new Object[]{h})`；

值得关注的是生成对象的那一步。首先使用反射获取生成的动态代理类的构造函数，该构造函数的参数是InvocationHandler。然后给构造函数传入开发者定义好的InvocationHandler实例，生成动态代理对象。所以我们可以推测，**Java在生成动态代理类的时候，除了要实现接口中给定的方法，一定也添加了一个参数是InvocationHandler的构造方法**。

> 由动态代理的方法只能传入interface参数可知，Java的动态代理**只能为接口生成代理，不能为具体类生成代理**。

生成动态代理类并执行方法的代码：
```
    InvocationHandler handler = new BibiAroundInvocationHandler(coder);
    
    // 直接生成一个代理对象实例（实际上也是两步：先在jvm中生成一个代理类Class的对象，再使用该Class对象生成代理对象）
    Coder proxy = (Coder) Proxy.newProxyInstance(coder.getClass().getClassLoader(), coder.getClass().getInterfaces(), handler);
    
    proxy.estimateTime("Hello, world");
    proxy.implementDemands("Send an ad");

    System.out.println(proxy.comment());
```
输出结果：
```
>>> Before: 2020-08-02T22:44:18.720
Tom: I'll use 20 hours.
<<< After: 2020-08-02T22:44:18.721
>>> Before: 2020-08-02T22:44:18.721
Tom: I use Java to finish Send an ad
<<< After: 2020-08-02T22:44:18.721
>>> Before: 2020-08-02T22:44:18.721
<<< After: 2020-08-02T22:44:18.721
(Proxy) Java is perfect!
```
前两个方法，调用前后都输出了时间。第三个方法，也输出了时间，然后输出方法的返回值：一个加了“(Proxy) ”前缀的原返回值。

# 动态代理Internal
上面分析了Java动态代理架构设计上，Java和开发者之间的契约。现在来看看，Java生成的代理类究竟长什么样。

首先，使用java提供的ProxyGenerator类，生成一个Coder接口的动态代理类，名为DynamicCoder。然后把这个类的字节码写到一个文件里：
```
/**
 * @author liuhaibo on 2018/04/19
 */
public class ProxyUtil {

    public static void main(String[] args) throws IOException {
        byte[] classFile = ProxyGenerator.generateProxyClass("DynamicCoder", JavaCoder.class.getInterfaces());
        File file = new File("/tmp/DynamicCoder.class");
        FileOutputStream fos = new FileOutputStream(file);
        fos.write(classFile);
        fos.flush();
        fos.close();
    }
}
```
然后使用IDE反编译字节码，大致看看生成的动态代理类的代码长啥样：
```
import example.proxy.Coder;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.lang.reflect.UndeclaredThrowableException;

public final class DynamicCoder extends Proxy implements Coder {
    private static Method m1;
    private static Method m5;
    private static Method m4;
    private static Method m3;
    private static Method m2;
    private static Method m0;

    public DynamicCoder(InvocationHandler var1) {
        super(var1);
    }

    public final boolean equals(Object var1) {
        try {
            return (Boolean) super.h.invoke(this, m1, new Object[]{var1});
        } catch (RuntimeException | Error var3) {
            throw var3;
        } catch (Throwable var4) {
            throw new UndeclaredThrowableException(var4);
        }
    }

    public final void estimateTime(String var1) {
        try {
            super.h.invoke(this, m5, new Object[]{var1});
        } catch (RuntimeException | Error var3) {
            throw var3;
        } catch (Throwable var4) {
            throw new UndeclaredThrowableException(var4);
        }
    }

    public final void implementDemands(String var1) {
        try {
            super.h.invoke(this, m4, new Object[]{var1});
        } catch (RuntimeException | Error var3) {
            throw var3;
        } catch (Throwable var4) {
            throw new UndeclaredThrowableException(var4);
        }
    }

    public final String comment() {
        try {
            return (String) super.h.invoke(this, m3, (Object[]) null);
        } catch (RuntimeException | Error var2) {
            throw var2;
        } catch (Throwable var3) {
            throw new UndeclaredThrowableException(var3);
        }
    }

    public final String toString() {
        try {
            return (String) super.h.invoke(this, m2, (Object[]) null);
        } catch (RuntimeException | Error var2) {
            throw var2;
        } catch (Throwable var3) {
            throw new UndeclaredThrowableException(var3);
        }
    }

    public final int hashCode() {
        try {
            return (Integer) super.h.invoke(this, m0, (Object[]) null);
        } catch (RuntimeException | Error var2) {
            throw var2;
        } catch (Throwable var3) {
            throw new UndeclaredThrowableException(var3);
        }
    }

    static {
        try {
            m1 = Class.forName("java.lang.Object").getMethod("equals", Class.forName("java.lang.Object"));
            m5 = Class.forName("example.proxy.Coder").getMethod("estimateTime", Class.forName("java.lang.String"));
            m4 = Class.forName("example.proxy.Coder").getMethod("implementDemands", Class.forName("java.lang.String"));
            m3 = Class.forName("example.proxy.Coder").getMethod("comment");
            m2 = Class.forName("java.lang.Object").getMethod("toString");
            m0 = Class.forName("java.lang.Object").getMethod("hashCode");
        } catch (NoSuchMethodException var2) {
            throw new NoSuchMethodError(var2.getMessage());
        } catch (ClassNotFoundException var3) {
            throw new NoClassDefFoundError(var3.getMessage());
        }
    }
}
```
1. 首先，该动态生成的代理类实现了Coder接口中的方法；
2. 该动态代理类的确拥有一个以InvocationHandler为参数的构造方法；
3. 对于每一个方法，该动态代理都是交由InvocationHandler去做的。调用InvocationHandler的invoke的时候，正如契约所约定的，传入了三个参数：动态代理对象自己、方法名、方法参数。
4. 最后每一个方法的返回值都是调用完invoke之后的返回值。

由此，我们亲眼看到了Java的确是按照契约，在jvm运行时，为我们生成了一个动态代理类。

## 正向梳理
**现在，让我们正向理一理动态代理调用的全过程**：
1. 当使用动态代理类，调用`proxy.estimateTime("Hello, world")`时；
2. 动态代理类调用它的方法：
    ```
        public final void estimateTime(String var1) {
            try {
                super.h.invoke(this, m5, new Object[]{var1});
            } catch (RuntimeException | Error var3) {
                throw var3;
            } catch (Throwable var4) {
                throw new UndeclaredThrowableException(var4);
            }
        }
    ```
3. 此时`var1`是hello world字符串，然后执行`super.h.invoke(this, m5, new Object[]{var1})`；
4. `h`是我们的handler：`BibiAroundInvocationHandler`；
5. 所以调用`h.invoke`，就是在调用：
    ```
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {

        System.out.println(">>> Before: " + LocalDateTime.now());
        // 就是通过反射，由函数名、对象、函数参数，去调用此函数。
        Object result = method.invoke(coder, args);
        System.out.println("<<< After: " + LocalDateTime.now());
        return "(Proxy) " + result;
    }
    ```
6. 而调用这个方法，就是：
    1. 先调用一个output；
    2. 再调用`method.invoke(coder, args)`，这个其实就是使用反射调用被代理的对象coder的estimateTime方法，方法参数为hello world字符串，假设范围值为X；
    3. 再调用output；
    4. 最后返回结果X，并在其前面加上`(Proxy)`前缀；
7. 最后代理对象的`super.h.invoke(this, m5, new Object[]{var1})`执行结束，并返回，没有return刚刚的`(Proxy)`+ X返回值。

至此，我们可以得出一个结论：Java的动态代理并不神秘，其实也是像静态代理一样，创建一个类，所有的方法都一一实现一遍。这个实现可以像简单的静态代理类StaticProxy一样，直接交由被代理对象去做，也可以像Java生成出来的DynamicCoder一样，交由InvocationHandler去做。

**他们的本质都是一样的：无论如何都要有一个这样的代理类，产生代理对象。**

**他们的创建时机和创建者是不一样的：静态代理类由开发者在编译前写好；动态代理类由jvm在运行时生成。**

# cglib
cglib和jdk的动态代理都是在运行时生成代理类，原理上是一致的，但是cglib写起来比jdk的动态代理要舒服很多——

本质上，我们用cglib写的g(x)和用jdk proxy写g(x)的写法一样，也是在调用被代理类的方法。**但是，cglib是给代理类生成了子类，所以在写g(x)的时候， cglib不需要我们自己传入被代理类（jdk的动态代理需要自己传入被代理对象，调用它的方法），直接调用`super.<method>`就行了**！它接口方法签名里的MethodProxy，拥有invokeSuper方法，可以直接调用“生成的代理类的super class”的方法， 也就是“被代理类”的方法。这也说明了，cglib生成的代理类，都是被代理类的子类。

```
/**
 * @author puppylpg on 2022/07/03
 */
public class CglibBibiAroundInterceptor implements MethodInterceptor {

    @Override
    public Object intercept(Object obj, Method method, Object[] args, MethodProxy proxy) throws Throwable {
        System.out.println(">>> Before: " + LocalDateTime.now());
        // proxy是method的proxy，可以通过invokeSuper调用被代理对象（aka，生成的代理对象的super class）的方法
        Object result = proxy.invokeSuper(obj, args);
        System.out.println("<<< After: " + LocalDateTime.now());
        return "(CGlib Proxy) " + result;
    }
}
```

生成代理对象也非常直白：
```
        Enhancer enhancer =  new Enhancer();
        // cglib 不需要传入被代理的类，只需要给出要代理的类的class文件，它自己会创建
        enhancer.setSuperclass(JavaCoder.class);
        enhancer.setCallback(new CglibBibiAroundInterceptor());
        JavaCoder javaCoder = (JavaCoder) enhancer.create();

        javaCoder.estimateTime("Hello, world");
        javaCoder.implementDemands("Send an ad");

        System.out.println(javaCoder.comment());
```
1. 指定被代理的类（不用自己new出对象，cglib自己会new）；
2. 指定怎么代理它（cglib称为callback）；

然后就可以直接create出被代理的对象了。

```
>>> Before: 2022-07-03T22:35:46.623
《CGlib has one important restriction: the target class must provide a default constructor》: I'll use 17 urs.
<<< After: 2022-07-03T22:35:46.636
>>> Before: 2022-07-03T22:35:46.636
《CGlib has one important restriction: the target class must provide a default constructor》: I use Java to nish Send an ad
<<< After: 2022-07-03T22:35:46.636
>>> Before: 2022-07-03T22:35:46.636
<<< After: 2022-07-03T22:35:46.636
(CGlib Proxy) Java is perfect!
```

**不过cglib的一个额外的要求**：
```
    public JavaCoder() {
        this("《CGlib has one important restriction: the target class must provide a default constructor》");
    }
```

# JDK vs. CGLib
## 能力问题
Java的动态代理**只能为接口生成代理，不能为具体类生成代理。因为看内部实现，它已经`extends Proxy`了，Java只能单继承**。但接口可以实现好多个，所以可以代理接口。

而CGLib则可以为具体的类生成动态代理，它的思路大致是：
- 动态生成一个类的子类；
- 该子类能够拦截所有父类方法的调用，并在intercept方法中，完成在父类方法前后贴狗皮膏药的逻辑，正如JDK的InvocationHandler的invoke方法所做的事情。

**CGLib是通过底层字节码技术创建的子类，该子类即为被代理类的代理。jdk则是为接口生成一个具体实现类，使用该实现类代理另一个实现类。**

## 效率问题
CGLib创建动态代理比jdk慢，但是创建出的代理运行效率比jdk创建的动态代理高。**所以如果要代理singleton，最好用CGLib。因此，CGLib更适合spring使用singleton的场景**。但是如果要不断生成bean，那还是Java动态代理效率更高。

> 所以spring aop里，如果给proxy的创建者比如DefaultAdvisorAutoProxyCreator设置了`setOptimize=true`，就会使用cglib创建动态代理。

## 依赖引入
jdk动态代理的另一个好处是不需要引入额外依赖，有jdk就够了，CGLib技术则显然需要引入第三方CGLib依赖。

关于Spring的AOP：[Spring - AOP]({% post_url 2021-11-22-spring-aop %})。

# 动态代理的应用
动态代理最广泛的应用，应该就是在Spring中实现的面向切面编程（AOP，Aspect Oriented Programming）。

在上面的例子中，通过动态代理，我们简单地做到了在所有方法调用前后都输出时间。这就是一种“具有横切逻辑”的场景。

Java中的继承是一种“纵向”的体系，而方法前后分别输出时间，则像狗皮膏药一样贴在每一个方法的前后，无法通过继承来解决。如果把狗皮膏药和业务逻辑写在一起（正如静态代理），显然是比较混乱，且重复度很高的（每一块业务逻辑前后都要贴两块相同的膏药）。如果把方法抽为一块，狗皮膏药抽为一块，提供一种机制在调用业务逻辑代码前后自动调用狗皮膏药，**不仅实现了想要的功能，还分离了业务代码和“狗皮膏药代码”**（性能监测、访问控制、事务管理、日志记录etc）。**这是一种“横向抽取”的思路**，即AOP。动态代理显然可以很好地做到这一点。

当然Spring的AOP不止拥有Java动态代理的实现，还有使用CGLib实现动态代理的实现。

