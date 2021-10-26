---
layout: post
title: "序列化 - 泛型 TypeReference"
date: 2021-10-23 16:42:02 +0800
categories: java serialization jackson json
tags: java serialization jackson json
---

在使用Jackson反序列化json的时候，需要两个基本条件：
1. json字符串；
2. 要反序列化的类型；

也就是Jackson的ObjectMapper提供的如下方法：
- `public <T> T readValue(String content, Class<T> valueType)`

获取一个类的的类型很简单，也有两种基本的办法。以String为例：
1. String.class；
2. new String().getClass()；

在反序列化普通类的时候，这些操作非常顺手且合理。

1. Table of Contents, ordered
{:toc}

# 传的信息不够：不能手写`List<Student>.class`
但是如果要反序列化的是一个泛型类该怎么办？

想把一个list json反序列化为java对象：
```
List<Student> list = new ObjectMapper().readValue(studentStr, List<Student>.class);
```
编译器会报错：`Cannot select from parameterized type`，即没有`List<Student>.class`这种写法。

直接使用List.class作为要反序列化的类型？
```
List<Student> list = new ObjectMapper().readValue(studentStr, List.class);
```
会有警告：`Unchecked assignment: 'java.util.List' to 'java.util.List<Student>'`，因为这里的List是擦除了类型信息的List，但是接收的list却是`List<Student>`。

归根结底，是上述方法只能让我们提供类型信息，但因为我们要告诉Jackson两点信息：
1. 我要反序列化的是一个List；
2. List的实际类型是Student；

第二点是因为List是个泛型类，它的实际类型是额外需要告知Jackson的。

所以核心就是一个问题：**怎么获取`List<Student>.class`这个东西**！

# Jackson的解决办法：用非手写的方式获取`List<Student>.class`
Jackson还提供了和上述方法对应的另一个中方法：
```
public <T> T readValue(String content, TypeReference valueTypeRef)
```
传入一个TypeReference。而TypeReference是List和Student的结合：
```
List<Student> list = new ObjectMapper().readValue(studentStr, new TypeReference<List<Student>>(){});
```
相当于我们通过一个TypeReference同时把List和Student这两点信息都告诉了Jackson。

所以TypeReference是怎么回事？

# prerequisite 1: anonymous class
先看看创建TypeReference时用到的匿名类语法。

匿名类的语法：
```
new class-name ( [ argument-list ] ) { class-body }
```
or:
```
new interface-name () { class-body } docstore.mik.ua/orelly/java-ent/jnut/ch03_12.htm
```

**匿名类也可以说是匿名子类，因为匿名类实际上是原有类的子类**。

常见接口的匿名类写法都是针对接口的：
```
public interface A {
    String B();
}

A a = new A {
    @Override
    String B() {
        // xxx
    }
}
```
a的类型是A的 **匿名子类**。

其实对类也可以：
```
Object s = new Object() {
    String t = "a";

    @Override
    public String toString() {
        return t + " --- " + super.toString();
    }
};
```
这个类s，它是Object的一个匿名子类，**也就是说它的父类是Object**。

上述代码写在com.puppylpg.generic.GenericTypeDemo类里，所以有以下输出：
```
// 它的toString输出：a --- com.puppylpg.generic.GenericTypeDemo$5@548c4f57
System.out.println(s);

// 它的类型是：class com.puppylpg.generic.GenericTypeDemo$5
System.out.println(s.getClass());

// 它的父类是：class java.lang.Object
System.out.println(s.getClass().getSuperclass());

// 父类的父类是：null，因为Object已经是顶级类，不存在父类
System.out.println(s.getClass().getSuperclass().getSuperclass());

// null
System.out.println(Object.class.getSuperclass());
```
**s是extends Object的一个匿名子类**，它的父类是Object，Object的父类是null。

- https://stackoverflow.com/questions/10468806/curly-braces-in-new-expression-e-g-new-myclass

# prerequisite 2: ParameterizedType
java中的Class.class是Type.class的子类：
```
public final class Class<T> implements java.io.Serializable,
                              GenericDeclaration,
                              Type,
                              AnnotatedElement
```
Class是Type的子类，有Type的功能。

Type描述的是类型，有一个子接口是ParameterizedType。**对于泛型类来说，它是Class，同时也是一个ParameterizedType**。

所以Class类有以下方法：
- `getClass`：获取当前class；
- `getSuperClass`：获取父类class，对于Object，它的父类是null；
- `getGenericSuperclass`：获取带泛型信息的父类class。**如果父类本身不带泛型信息，那就和getSuperClass效果一样**；

ParameterizedType接口比Type多了以下两个泛型相关的方法：
- `Type[] getActualTypeArguments()`：获取泛型参数的类型；
- `Type getRawType()`：获取擦除了泛型信息的类的raw type，比如HashMap.class；

**说到这里大致明白了，只要有ParameterizedType，就既知道泛型类，也知道泛型的形参类型了**。

关键在于：**ParameterizedType怎么获得**？

**构造一个泛型类的匿名子类，然后使用`getGenericSuperclass`方法再获取这个泛型类的类型，它就是个ParameterizedType**。

比如这个类它是一个HashMap的匿名子类：
```
Map<String, Integer> intMap = new HashMap<String, Integer>(){};
```
它的父类信息：
```
// class java.util.HashMap
System.out.println(intMap.getClass().getSuperclass());

// java.util.HashMap<java.lang.String, java.lang.Integer>
System.out.println(intMap.getClass().getGenericSuperclass());
```

可以强制转型：
```
ParameterizedType pType = (ParameterizedType) intMap.getClass().getGenericSuperclass();
```

所以可以获取泛型类的泛型参数类型：
```
// [class java.lang.String, class java.lang.Integer]
System.out.println(Arrays.toString((pType).getActualTypeArguments()));

// class java.util.HashMap
System.out.println(pType.getRawType());
```
所以`getClass().getSuperClass() == getClass().getGenericSuperClass().getRawType()`。

这就是一个典型的用法：**泛型的匿名子类 + ParameterizedType**。

# TypeReference：所有塞到我形参里的东西，都可以用`getType()`取出来
jackson的TypeReference就是这么使用的典型。它的java doc是这么举例的：

> Usage is by sub-classing: here is one way to instantiate reference to generic type `List<Integer>`:
>
>    `TypeReference ref = new TypeReference<List<Integer>>() { };`

**以（匿名）子类的方式，获取一个想要的泛型类的类型**。

TypeReference只不过是把上述获取泛型参数的代码简单包装了一下：
```
    protected final Type _type;
    
    protected TypeReference()
    {
        Type superClass = getClass().getGenericSuperclass();

        _type = ((ParameterizedType) superClass).getActualTypeArguments()[0];
    }

    public Type getType() { return _type; }
```
它的初始化方法，就是利用了上面的知识：
1. 先获取匿名子类的带泛型的父类：`TypeReference<xxx>`；
2. 然后获取它的泛型参数`xxx`，把这个参数存到`_type`属性里；
3. 只要调用`getType()`，就能获取`xxx`。

示例：
```
        TypeReference<List<String>> type = new TypeReference<List<String>>() {
        };
        
        // 输出：java.util.List<java.lang.String>
        System.out.println(type.getType());
```
**TypeReference的意义就是：无论想要什么类型，管他是`String.class`还是`List<Student>.class`，只要放到TypeReference的形参里，现在一个`getType()`方法就都能取得了**。

有了这个ParameterizedType之后，Jackson自然能抽出它的raw type和arguments，用于反序列化：
```
        ParameterizedType parameterizedType = (ParameterizedType) type.getType();
        
        // 输出：interface java.util.List
        System.out.println(parameterizedType.getRawType());
        
        // 输出：class java.lang.String
        System.out.println(parameterizedType.getActualTypeArguments()[0]);
```

所以ObjectMapper反序列化字符串提供了以下两种方式：
- `public <T> T readValue(String content, Class<T> valueType)`：有了Class描述，就能反序列化出一个类；
- `public <T> T readValue(String content, TypeReference<T> valueTypeRef)`：有了TypeReference，就能getType()，**就能获取它的raw Class和参数类型**，也能反序列化出一个类；

# ParameterizedTypeReference
Sping里的`org.springframework.core.ParameterizedTypeReference`则和jackson的`com.fasterxml.jackson.core.type.TypeReference`几乎一毛一样。

两者的相互转换也非常简单，因为两者的getType方法返回的是同一个东西：
- https://stackoverflow.com/a/47360676/7676237

restTemplate的exchange方法和jackson反序列化一样，在反序列化出的参数类型上也是两套：
- `public <T> ResponseEntity<T> exchange(RequestEntity<?> requestEntity, Class<T> responseType)`
- `public <T> ResponseEntity<T> exchange(RequestEntity<?> requestEntity, ParameterizedTypeReference<T> responseType)`


