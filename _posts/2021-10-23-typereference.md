---
layout: post
title: "序列化 - 泛型TypeReference"
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

# 传的信息不够

但是如果要反序列化的是一个泛型类该怎么办？

想把一个list json反序列化为java对象：
```java
List<Student> list = new ObjectMapper().readValue(studentStr, List<Student>.class);
```
编译器会报错：`Cannot select from parameterized type`，即没有`List<Student>.class`这种写法。

> **因为Java的泛型是伪泛型，所以实际上不存在`List<Student>`这个类型，自然也不可能对一个不存在的类调用它的`class`属性**。

直接使用`List.class`作为要反序列化的类型？
```java
List<Student> list = new ObjectMapper().readValue(studentStr, List.class);
```
会有警告：`Unchecked assignment: 'java.util.List' to 'java.util.List<Student>'`，因为这里的List是擦除了类型信息的List，但是接收的list却是`List<Student>`。

归根结底，**我们只能提供`List.class`（不能手写`List<Student>.class`），但是我们需要告诉Jackson的是`List<Student>.class`**。所以核心就是一个问题：**怎么获取`List<Student>.class`这个东西**？

# 用非手写的方式获取`List<Student>.class`
Jackson还提供了和上述方法对应的另一种反序列化方法，专门来解决这个问题：
```java
public <T> T readValue(String content, TypeReference valueTypeRef)
```
传入一个`TypeReference`：
```java
List<Student> list = new ObjectMapper().readValue(studentStr, new TypeReference<List<Student>>(){});
```
相当于我们通过一个TypeReference同时把List和Student这两点信息都告诉了Jackson。

TypeReference是怎么做到的？

## prerequisite 1: anonymous class
先看看创建TypeReference时用到的匿名类语法。

匿名类的语法：
```java
new class-name ( [ argument-list ] ) { class-body }
```
or:
```java
new interface-name () { class-body }
```

- docstore.mik.ua/orelly/java-ent/jnut/ch03_12.htm

**匿名类也可以说是匿名子类，因为匿名类实际上是原有类的子类**。

常见接口的匿名类写法都是针对接口的：
```java
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
a的类型是A的**匿名子类**。

其实对类也可以：
```java
Object s = new Object() {
    String t = "a";

    @Override
    public String toString() {
        return t + " --- " + super.toString();
    }
};
```
对象s的class**是Object的一个匿名子类，也就是说它的父类是Object**。

上述代码如果写在`com.puppylpg.generic.GenericTypeDemo`类里，会有以下输出：
```java
// 它的toString输出：a --- com.puppylpg.generic.GenericTypeDemo$5@548c4f57
System.out.println(s);

// 它的类型是：class com.puppylpg.generic.GenericTypeDemo$1
System.out.println(s.getClass());

// 它的父类是：class java.lang.Object
System.out.println(s.getClass().getSuperclass());

// 父类的父类是：null，因为Object已经是顶级类，不存在父类
System.out.println(s.getClass().getSuperclass().getSuperclass());

// null
System.out.println(Object.class.getSuperclass());
```
**s是extends Object的一个子类（但是没有名字，所以是匿名的）**，它的父类是Object，Object的父类是null。

> 注意s本身的class的名称，**和父类是什么无关，只和自己被定义时所在的位置有关：因为它是在`GenericTypeDemo`里定义的匿名类，所以它的类名为`GenericTypeDemo$1`**。

- https://stackoverflow.com/questions/10468806/curly-braces-in-new-expression-e-g-new-myclass

## prerequisite 2: `ParameterizedType`
java中的`Class.class`是`Type.class`的子类：
```java
public final class Class<T> implements java.io.Serializable,
                              GenericDeclaration,
                              Type,
                              AnnotatedElement
```
Class是Type的子类，有Type的功能。

Type描述的是类型，有一个子接口是ParameterizedType。**对于泛型类来说，它是Class，同时也是`ParameterizedType`**。

Class是Type的子类，有Type的功能，所以Class类有以下方法：
- `getClass`：获取当前class；
- `getSuperClass`：获取父类class，对于Object，它的父类是null；
- `getGenericSuperclass`：获取带泛型信息的父类class。**如果父类本身不带泛型信息，那就和getSuperClass效果一样**；

所以我们只需要：
1. 构造一个泛型类的匿名子类，泛型类为父类；
2. 然后对子类调用`getGenericSuperclass`方法，就可以获取这个泛型类（父类）的类型了。

比如这个类它是HashMap的匿名子类：
```java
Map<String, Integer> intMap = new HashMap<String, Integer>(){};
```
它的父类信息：
```java
// class java.util.HashMap
System.out.println(intMap.getClass().getSuperclass());

// java.util.HashMap<java.lang.String, java.lang.Integer>
System.out.println(intMap.getClass().getGenericSuperclass());
```
最终，**我们通过`intMap.getClass().getGenericSuperclass()`获取了无法手写出来的`java.util.HashMap<java.lang.String, java.lang.Integer>`**。

## 之后呢？

Jackson拿到的`java.util.HashMap<java.lang.String, java.lang.Integer>`实际类型为`ParameterizedType`，该接口比`Type`多了以下两个泛型相关的方法：
- `Type[] getActualTypeArguments()`：获取泛型参数的类型；
- `Type getRawType()`：获取擦除了泛型信息的类的raw type，比如`HashMap.class`；

**Jackson就可以通过这些方法获取`java.util.HashMap`和`java.lang.String`、`java.lang.Integer`**。只要有`ParameterizedType`，就既能知道泛型类的类型，也知道泛型的形参类型。

所以jackson内部大致可以做以下操作：
```java
// 强制转型
ParameterizedType pType = (ParameterizedType) intMap.getClass().getGenericSuperclass();

// 获取泛型类的泛型参数类型
// [class java.lang.String, class java.lang.Integer]
System.out.println(Arrays.toString((pType).getActualTypeArguments()));

// class java.util.HashMap
System.out.println(pType.getRawType());
```
对于泛型类来说，`getClass().getSuperClass() == getClass().getGenericSuperClass().getRawType()`。

这是一个典型的用法：**泛型的匿名子类 + ParameterizedType**。jackson的`TypeReference`就是这么使用的典型。

# `TypeReference`：`getType()`

> 所有塞到形参里的东西，都可以用`TypeReference#getType()`取出来。

**实际上可以把`TypeReference`理解为`HashMap`或`List`。构建一个`TypeReference`的匿名对象，就可以通过`getClass().getGenericSuperclass()`和`((ParameterizedType) getClass().getGenericSuperclass()).getActualTypeArguments()[0]`获取它包含的真正的类型**。不过`TypeReference`为了方便把这些代码简单包装了一下：
```java
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
```java
    TypeReference<List<String>> type = new TypeReference<List<String>>() {
    };
    
    // 输出：java.util.List<java.lang.String>
    System.out.println(type.getType());
```
**TypeReference的意义就是：无论想要什么类型，管他是`String.class`还是`List<Student>.class`，只要放到TypeReference的形参里，现在一个`getType()`方法就都能取得了**。

它的java doc是这么举例的：

> Usage is by sub-classing: here is one way to instantiate reference to generic type `List<Integer>`:
>
>    `TypeReference ref = new TypeReference<List<Integer>>() { };`

**以（匿名）子类的方式，获取一个想要的泛型类的类型**。

有了这个`ParameterizedType`之后，Jackson自然能抽出它的raw type和arguments，用于反序列化：
```java
    ParameterizedType parameterizedType = (ParameterizedType) type.getType();
    
    // 输出：interface java.util.List
    System.out.println(parameterizedType.getRawType());
    
    // 输出：class java.lang.String
    System.out.println(parameterizedType.getActualTypeArguments()[0]);
```

所以`ObjectMapper`反序列化字符串提供了以下两种方式：
- `public <T> T readValue(String content, Class<T> valueType)`：有了Class描述，就能反序列化出一个类；
- `public <T> T readValue(String content, TypeReference<T> valueTypeRef)`：有了TypeReference，就能getType()，**就能获取它的raw Class和参数类型**，也能反序列化出一个类；

# 其他类似的实现
## spring: `ParameterizedTypeReference`
Sping里的`org.springframework.core.ParameterizedTypeReference`则和jackson的`com.fasterxml.jackson.core.type.TypeReference`几乎一毛一样。

两者的相互转换也非常简单，因为两者的getType方法返回的是同一个东西：
- https://stackoverflow.com/a/47360676/7676237

`RestTemplate`的exchange方法和jackson反序列化一样，在反序列化出的参数类型上也是两套：
- `public <T> ResponseEntity<T> exchange(RequestEntity<?> requestEntity, Class<T> responseType)`
- `public <T> ResponseEntity<T> exchange(RequestEntity<?> requestEntity, ParameterizedTypeReference<T> responseType)`

## gson：`TypeToken`
```java
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        TypeToken<List<Student>> token = new TypeToken<List<Student>>() {};
        Type type = token.getType();
        // `java.util.List<Student>`
        System.out.println(type);
    }
}

class Student {
    private String name;
    private int age;
    // getter and setter methods
}
```

## 自己实现
自己照着他们的思路抄一遍也不是不行：
```java
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        Type type = new MyClass<List<Student>>().getType();
        System.out.println(type);
    }
}

class MyClass<T> {
    public Type getType() {
        Type superClass = getClass().getGenericSuperclass();
        Type[] typeArgs = ((ParameterizedType) superClass).getActualTypeArguments();
        return typeArgs[0];
    }
}

class Student {
    private String name;
    private int age;
    // getter and setter methods
}
```
需要哪个泛型签名，就通过创建`MyClass`的匿名子类，再`MyClass#getType`即可。

