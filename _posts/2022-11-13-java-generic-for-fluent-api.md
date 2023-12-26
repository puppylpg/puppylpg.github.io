---
layout: post
title: "用泛型实现父子类的fluent api"
date: 2022-11-13 21:29:29 +0800
categories: Java
tags: Java
---

今天在看assertj的实现时，看到了一个很好玩的东西：用泛型实现父子类的fluent api。它引用的一篇文章，回答了我之前很多次看到这种泛型写法时的满头问号。

1. Table of Contents, ordered
{:toc}

# fluent api
fluent api并不陌生，比如builder模式就是一种最常见的fluent api。

```java
Student s = Student.builder()
    .name(xxx)
    .age(xxx)
    .interests(xxx)
    .build();
```
fluent api写法的关键在于各种函数在处理完数据后，一定要返回`this`，这样才能在调用的时候形成链式，看起来很fluent。

```java
public Student name(String name) {
    this.name = name;
    return this;
}
```

fluent api简单又好用，但这只是普通实体类的fluent api实现。如果想实现父子类的fluent api，是没办法这样写的！

# 父类的this
让我恍然大悟的是这篇文章：[Emulating "self types" using Java Generics to simplify fluent API implementation](https://web.archive.org/web/20130721224442/http:/passion.forco.de/content/emulating-self-types-using-java-generics-simplify-fluent-api-implementation)，**翻译的详细一点儿就是：用泛型模拟一个能感知父子类具体类型的this**。

> 原文写的很清晰明了，我就直接贴了，只在适当的地方啰嗦两句。

## isNotNull在不同子类里抄了好多遍

The Java programming language does not support the notion of "self types", that is "type of this". When implementing fluent APIs, this lack of support can lead to significant duplication of boilerplate code. Taking FEST Assertions as an example, this article shows how "self types" can be emulated in Java using Generics.

> fest assertions的类结构和[AssertJ]({% post_url 2022-11-13-assertj %})基本一样，所以可以将下面的示例视为assertj。

Why bother?
FEST Assertions provide a beautiful API to write assertions in Java code:
```java
Collection<Item> myItems = orderService.getItems(orderId);
assertThat(myItems).isNotNull().contains(expectedItem);
```
assertThat() acts as an overloaded factory for Assertion objects of different type. There are roughly 34 XxxAssert classes in FEST-Assert 1.x at the time of writing. Each of these classes implement a number of assertion methods, which check whether the actual value myItems satisfies the condition indicated by the method's name, like isNotNull or contains. If the check fails, the methods throw an AssertionError, otherwise they return `this` to allow chaining of method calls in a fluent manner.

Let's take CollectionAssert as an example. It provides both isNotNull() and contains(). The relevant method signatures look like this:
```java
public class CollectionAssert /* ... */ {

  @Override public CollectionAssert isNotNull() {
    assertNotNull();
    return this;
  }

  @Override public CollectionAssert contains(Object... objects) {
    assertContains(objects);
    return this;
  }
```
**You might ask why isNotNull() is implemented in class CollectionAssert, and not in some more generic superclass? If it's in CollectionAssert, is it also in all the other concrete assertion classes? Bad news is: yes, it is.**

## 为什么不写到父类里？
Of course, there actually is a superclass which might be a candidate to move the implementation of isNotNull() into, it's called GenericAssert. In it, we find:
```java
public abstract class GenericAssert<T> /* ... */ {

  protected abstract GenericAssert<T> isNotNull();
}
```
This method is declared abstract, and it has 31 concrete implementations. They all look nearly the same:
```java
// from class BigDecimalAssert:
@Override public BigDecimalAssert isNotNull() {
  assertNotNull();
  return this;
}

// from class FileAssert:
@Override public FileAssert isNotNull() {
  assertNotNull();
  return this;
}

// from class ImageAssert:
@Override public ImageAssert isNotNull() {
  assertNotNull();
  return this;
}

// many more, all looking alike... 
```
The only thing which differs is the return type, which is always the class implementing the overridden isNotNull. This is necessary because otherwise it would not be possible to add methods to a call chain which are defined in the concrete assertion class, but not in the more generic superclass where isNotNull is implemented. 

**If we moved the concrete implementation to GenericAssert, we would get a GenericAssert instance as return value of isNotNull()**, and GenericAssert certainly does not provide contains (as CollectionAssert does) or isDirectory (as FileAssert does). So the following code would not compile any more:
```java
assertThat(actualCollection).isNotNull().contains(expectedItem); 
assertThat(actualFile).isNotNull().isDirectory();
```
**所以为了让子类返回属于自己类型的this，只能把这种通用方法写到子实现类里。原本父子类的作用就是把通用方法写到父类里，结果通用方法还是只能写到子类里**。尽管fest assertions已经尽量做到了精简，但这就跟没使用父类的缺点是一样的——代码爆炸：the original version of GenericAssert contained 14 protected abstract assertion methods, which had to be implemented in each of the 34 concrete subclasses. This sums up to 476 methods which are not required any more and existed purely to support the fluent API syntax. And this is only for GenericAssert, there are certainly some more occurrences of protected abstract methods which had to be overridden in each concrete subclass for exactly the same purpose!

## 自界泛型
自界泛型可以拯救这种情况。

> 其实之前经常在一些开源组件里看到自界泛型，不过每次看到都满头问号就是了……因为它的确不是很好理解。

先看看普通泛型：
```java
class Person<T> {
    T love;
}
```
类型T可以是任何类型，所以一个人可以love任何东西，小猫小狗，花花草草。
```java
class Student extends Person<Animal> {}
class Student extends Person<Plant> {}
```

有界泛型也很好理解：
```java
class Person<T extends Animal> {
    T love;
}
```
类型T做了一些限制，只能是Animal的子类型。所以现在一个人只能love猫猫狗狗了，必须是动物，花花草草不行了。

自界泛型更抽象一些：
```java
class Person<T extends Person<T>> {
    T love;
}
```
`Person`里的类型T必须是`Person`的子类型（或Person本身），也就是说，一个人只能love另一个人或者人的子类（比如学生），人兽非法:D 玩笑归玩笑，让我们记住如此定义后的**Person类的等价含义：人只能`love()`人**。

> **其实可以看成`class Person<T extends Person>`，这样就好理解很多了。之所以写成`class Person<T extends Person<T>>`，是因为Person本身是泛型类，所以要把它的定义写全，但是看起来迷惑性就增强了。**

看起来有点儿循环定义的意思：定义了一个Person，它的泛型类型必须也是Person。

其实这种循环有两种循环方式，上面的循环定义只是第一种，可以说是“直接循环”：
```java
class Man extends Person<Man> {}
```
Man是Person的子类，一个男人只能love一个男人……它符合**人只能`love()`人**这一原始含义。

另一种循环可以称为“间接循环”：
```java
class Woman extends Person<Man> {}
```
Woman是Person的子类，一个女人可以love一个男人，它也符合**人只能`love()`人**这一原始含义。**因为Man属于Person的子类，所以Woman这个新的Person子类的定义没有超出“一个Person只能love Person或其子类”的限定（`Person<T extends Person<T>>`）**。

但是这样定义是不行的：
```java
class Animal {}
class Woman extends Person<Animal> {}
```
因为Animal不属于Person子类，所以非法。

可以看看这篇介绍自界泛型的文章：[Self-bounding generics](https://web.archive.org/web/20130525013111/http://www.artima.com/weblogs/viewpost.jsp?thread=136394)

> 自界泛型、直接循环、间接循环，都是我自己起的定义，不必当真……

## 用泛型模拟一个能感知父子类具体类型的this
其实上面的例子就是父子类，所以很明显可以看到自界泛型的一大用途：**它可以把泛型类型T定义的love属性限定为“本族类型”的对象（Person或Person的子类），因此，假设知道子类类型，在父类里把love强制转型为该子类对象的话，是没有问题的。**

那么现在就用泛型，强制把父类的this转为相应子类型！

不过下面的例子还有比较特殊的一点：**这些类本身就是泛型类（需要一个泛型参数`ELEMENT_TYPE`**），现在又要用泛型做this的强制转换，所以出现了两个泛型参数：
1. SELF_TYPE：上述用来转this的自界泛型；
2. ELEMENT_TYPE：assertion类本身就可以断言任意类型（Double/String/File等等）的对象，所以这个actual对象需要定义成泛型；

Generics to the rescue...
The most fundamental part of the solution is to pass SELF_TYPE as type parameter to each (super) type which declares assertion methods. As an example, let's compare the two different variants of GenericAssert, without and with SELF_TYPE:
```java
// without SELF_TYPE

public abstract class GenericAssert<ELEMENT_TYPE> extends Assert {

  protected final ELEMENT_TYPE actual;

  protected GenericAssert(ELEMENT_TYPE actual) {
    this.actual = actual;
  }

  // ...

  protected abstract GenericAssert<ELEMENT_TYPE> isNotNull();

  // ...

}
```
How to actually introduce SELF_TYPE into the code?
Now we change this to:
```java
// WITH SELF_TYPE

public abstract class GenericAssert<SELF_TYPE extends GenericAssert<SELF_TYPE, ELEMENT_TYPE>, ELEMENT_TYPE> 
extends Assert {

  protected final ELEMENT_TYPE actual;

  @SuppressWarnings("unchecked")    
  protected final SELF_TYPE self() {
    return (SELF_TYPE) this;
  }

  protected GenericAssert(ELEMENT_TYPE actual) {
    this.actual = actual;
  }

  public final SELF_TYPE isNotNull() {
    failIfActualIsNull(customErrorMessage(), rawDescription(), actual);
    return self();
  }

  // ...
```

> **如果感觉晕，可以按照之前说的简化一下它的定义：`class GenericAssert<SELF_TYPE extends GenericAssert, ELEMENT_TYPE>`**，好多了。

There are a few things to notice:
- We introduced a new type parameter called SELF_TYPE, which must fullfill `SELF_TYPE extends GenericAssert<SELF_TYPE, ELEMENT_TYPE>`. This ensures that concrete generic instances must extend the currently defined class GenericAssert, **in other words: only subclasses of GenericAssert are allowed as SELF_TYPE**. This is sometimes called a **self-bounded generic**. Here, GenericAssert is self-bounded in SELF_TYPE.
- We introduced a new final method self(), which basically just returns this cast to SELF_TYPE.
- The assertion method's implementation is not abstract any more, instead, we declare it to return SELF_TYPE. The implementation calls the relevant check code and returns self().
- The self() method is a very convenient way of **returning this, but with a cast to the correct return type already applied**.
- Since SELF_TYPE is a type variable, this could be any matching type a derived class might potentially pass as the type variable's value.

半天劲不是白费的，再看子类，不用实现那些common方法了：

Defining concrete implementation classes
This is where the whole effort really pays off. Let's look at a variant of FileAssert which exploits the SELF_TYPE in GenericAssert:
```java
// SELF_TYPE is set to FileAssert here:
public class FileAssert extends GenericAssert<FileAssert, File> {

  // NO overriden isNotNull method any more!
  // We can use the inherited one!

  // same is true for *all* of the protected abstract
  // assertion methods in *all* of the classes derived 
  // from GenericAssert!

}
```
**注意子类是怎么定义泛型参数的**：虽然`GenericAssert`的定义是`GenericAssert<SELF_TYPE extends GenericAssert<SELF_TYPE, ELEMENT_TYPE>, ELEMENT_TYPE>`，**但其实它就两个泛型参数**，前者是子类型，后者是泛型本身所包含的类型。**所以`FileAssert`只需要传两个实际的类型**，前者是它自己（它是子类型），后者是它的泛型参数的实际类型`File`。所以子类的定义看起来是很简单的。

所有的common方法，比如isNotNull，都定义在父类里，子类里不用写了。而且父类里isNotNull的写法已经将它们转为了子类型，所以现在FileAssert在写fluent api的时候：`assertThat(new File("")).is...`，IDE会自动提示isNotNull方法，且标注了该方法的返回值为FileAssert。

> As you can see, the return type of all the assertion methods like isNotNull() in the concrete class automatically gets substituted with the concrete class name (FileAssert in this case).

这一波，省下了无数代码。

# AssertJ的实现
最后看看assertj的实现，几乎一模一样：

顶级接口：
```java
public interface ExtensionPoints<SELF extends ExtensionPoints<SELF, ACTUAL>, ACTUAL>

public interface Descriptable<SELF>

public interface Assert<SELF extends Assert<SELF, ACTUAL>, ACTUAL> extends Descriptable<SELF>, ExtensionPoints<SELF, ACTUAL>
```

> **和上面的定义子类型类似，这里的子接口`Assert`在继承`ExtensionPoints`的时候，也只需要传两个参数**，所以是`extends ExtensionPoints<SELF, ACTUAL>`。

顶级基类：
```java
public abstract class AbstractAssert<SELF extends AbstractAssert<SELF, ACTUAL>, ACTUAL> implements Assert<SELF, ACTUAL>
```
`ObjectAssert`的基类：
```java
public abstract class AbstractObjectAssert<SELF extends AbstractObjectAssert<SELF, ACTUAL>, ACTUAL>
    extends AbstractAssert<SELF, ACTUAL>
```
顶级`ComparableAssert`的基类：
```java
public abstract class AbstractComparableAssert<SELF extends AbstractComparableAssert<SELF, ACTUAL>, ACTUAL extends Comparable<? super ACTUAL>>
    extends AbstractObjectAssert<SELF, ACTUAL> implements ComparableAssert<SELF, ACTUAL>
```
它看起来更麻烦一些，除了SELF是自界泛型，ACTUAL还是有界泛型，因为它必须是comparable才能进行比较。

`DoubleAssert`的基类：
```java
public abstract class AbstractDoubleAssert<SELF extends AbstractDoubleAssert<SELF>> extends
    AbstractComparableAssert<SELF, Double> implements FloatingPointNumberAssert<SELF, Double>
```
最终的`DoubleAssert`：
```java
public class DoubleAssert extends AbstractDoubleAssert<DoubleAssert>
```

或者看个继承链条短点儿的：
```java
public abstract class AbstractFileAssert<SELF extends AbstractFileAssert<SELF>> extends AbstractAssert<SELF, File>

public class FileAssert extends AbstractFileAssert<FileAssert>
```

和FEST assertion不同的是，assertj的实现类的构造函数必须传入两个参数：
```java
public class FileAssert extends AbstractFileAssert<FileAssert> {

  public FileAssert(File actual) {
    super(actual, FileAssert.class);
  }
}
```
因为AbstractAssert基类没有直接像fest assertion一样做直接强制转型`(SELF_TYPE) this`，而是使用传进来的class先`Class#cast`一波，再使用类定义里的`SELF`强制转换：
```java
  protected AbstractAssert(ACTUAL actual, Class<?> selfType) {
    myself = (SELF) selfType.cast(this);
    this.actual = actual;
    info = new WritableAssertionInfo(customRepresentation);
    assertionErrorCreator = new AssertionErrorCreator();
  }
```
大同小异。

# 感想
其实之前也不是没翻过开源代码，只是翻看开源代码比较少。没有这个习惯，也不太有这个能力。或者说因为没有这个能力，所以才没有养成这个习惯。但是今年不太一样，感觉像开窍了一般，所有学的东西都串起来了。从翻spring系列源码开始，看到什么比较有意思的东西就想翻翻看大概是怎么实现的。大概是因为能力变强了，所以不再满足于知其然了。但是又很难说难道不是因为老想知其所以然所以能力才变强了？这本就是一个互相促进的过程吧。

今天随手翻翻assertj的源码，没想到就解决了之前经常看到的不知所云的自界泛型，还挺幸运的。果然流行的开源代码，都是精华。武林秘籍就摆在那儿，如果现代社会出了一个鸠摩智，他一定愿称这个时代是最好的时代吧。

