---
layout: post
title: "序列化 - Json多态的序列化"
date: 2020-07-30 22:33:06 +0800
categories: java serialization jackson json
tags: java serialization jackson json
---

使用json序列化对象是一个很常见的方式，和其他字节方式序列化框架protobuf、avro、Java自带序列化相比，使用json的一个显而易见的好处就是可读性。

1. Table of Contents, ordered
{:toc}

json序列化可以使用的依赖有很多，比如fastjson，最常用的应该还是Jackson。Jackson有很多强大的定制功能，比如通过注解决定哪些字段需要序列化、序列化顺序、别名等等，具体可以参考参考：
- https://www.baeldung.com/jackson-annotations

这里主要从前一段看到的fastjson的例子，聊聊json对多态的序列化。

# 多态
在将一个对象序列化为json时，如果对象的某属性涉及到多态，需要加一些额外的信息，用来指示该字段实际是哪个子类型。否则，无法将其反序列化为正确的子类型。

比如fastjson是在字段前加上`@autotype`，指示该字段实际的子类型：
```json
{
    "@type":"com.hollis.lab.fastjson.test.Store",
    "fruit":{
        "@type":"com.hollis.lab.fastjson.test.Apple",
        "price":0.5
    },
    "name":"Hollis"
}
```

- https://hollis.blog.csdn.net/article/details/107150646

这么做可能有些地方让你感到奇怪：fastjson序列化出来的json岂不是改变原有对象的内容了——加了额外的东西。

# Jackson
先看看另一个更流行的json序列化框架Jackson怎么搞的。

其实jackson类似，不过功能更灵活一些，可以使用注解自定义这些额外信息的行为。一般使用Jackson序列化多态一定要用到两个注解：

## `@JsonTypeInfo`

> Annotation used for configuring details of if and how type information is used with JSON serialization and deserialization, to preserve information about actual class of Object instances. This is necessarily for polymorphic types, and may also be needed to link abstract declared types and matching concrete implementation.

主要用来配置序列化为json的时候，如何保留对象的实际class信息。对于多态类型，必须配置。

主要配置它的三个属性：
- use：序列化时用什么格式保存metadata
- include：如果将metadata包含入json，用那种方式
- property：如果将metadata以property的形式包含入json，property叫什么名字

比如：
```
    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "custom-type-name")
    @JsonSubTypes(value = {
            @JsonSubTypes.Type(value = Son1.class, name = "FirstSon"),
            @JsonSubTypes.Type(value = Son2.class, name = "SecondSon")
    })
```
生成（代码见后面，Father是父类，Son1和Son2是两个子类）：
```
{"list":[{"custom-type-name":"SecondSon","a":5,"c":"10"},{"custom-type-name":"FirstSon","a":5,"b":0}]}
```
metadata（即类信息）以property的形式存入json（`include = JsonTypeInfo.As.PROPERTY`），property的value使用逻辑名字(`use = JsonTypeInfo.Id.NAME`)，即`JsonSubTypes`里定义的类的别名`SecondSon`/`FirstSon`，property的key则自定义为custom-type-name(` property = "custom-type-name"`)。

如果`use = JsonTypeInfo.Id.CLASS`，会使用class类名作为metadata的value，序列化为：
```
{"list":[{"custom-type-name":"example.jackson.Family$Son2","a":5,"c":"10"},{"custom-type-name":"example.jackson.Family$Son1","a":5,"b":0}]}
```
不过**使用class name会使代码的可移植性变差**。比如代码修改包名后，再按照json里的metadata反序列化，发现找不到类了。

`include = JsonTypeInfo.As.WRAPPER_OBJECT`或者`include = JsonTypeInfo.As.WRAPPER_ARRAY`无非是修改保存metadata的格式，分别为：
```
{"list":[{"SecondSon":{"a":5,"c":"10"}},{"FirstSon":{"a":5,"b":0}}]}
```
或者
```
{"list":[["SecondSon",{"a":5,"c":"10"}],["FirstSon",{"a":5,"b":0}]]}
```
此时由于field直接作为value，key直接使用`use = JsonTypeInfo.Id.NAME`，即类的别名`SecondSon`/`FirstSon`，所以自定义的property的keycustom-type-name不再被需要了。

## `@JsonSubTypes`

> Annotation used with JsonTypeInfo to indicate sub-types of serializable polymorphic types, and to associate logical names used within JSON content (which is more portable than using physical Java class names).

和`JsonTypeInfo`一起用的注解，用来指示子类序列化入json里的逻辑名。

它的Type子类有两个属性，可以定义一个类的别名：
- value：给哪个子类起名字
- name：起啥名字

```
    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "custom-type-name")
    @JsonSubTypes(value = {
            @JsonSubTypes.Type(value = Son1.class, name = "FirstSon"),
            @JsonSubTypes.Type(value = Son2.class, name = "SecondSon")
    })
```
再看一开始的注解，就很清晰了：
1. `JsonSubTypes`：两个子类类型会被序列化入json，一个是Son1.class，序列化后的名字叫FirstSon，另一个同理；
2. `JsonTypeInfo`：以property的形式保存序列化前的子类的metadata，记录的是名字（use = JsonTypeInfo.Id.NAME），自定义property的key为custom-type-name。

结合起来就是：
```
{"list":[{"custom-type-name":"SecondSon","a":5,"c":"10"},{"custom-type-name":"FirstSon","a":5,"b":0}]}
```
这样就知道list有两个对象，第一个是SecondSon，其类为Son1.class，第二个类是Son2.class。

我觉得使用NAME+PERPERTY的方式是Jackson比较好的序列化多态的一种方式。也方便移植。

# 必须记录的多态类型
回到一开始的那个问题：从json的角度来看，就好像是对象除了a、c，还有一个custom-type-name属性一样。如果直接看json，这种新增了metadata的行为岂不是会让人产生误会？

先反过来想，如果不加metadata会怎样？

不加多态信息也能直接序列化，且不带metadata：
```
{"list":[{"a":5,"c":"10"},{"a":5,"b":0}]}
```
这的确是原汁原味的对象内容！但是反序列化的时候，发现反序列化不回来了：
```
Exception in thread "main" com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException: Unrecognized field "c" (class example.jackson.Family$Father), not marked as ignorable (one known property: "a"])
 at [Source: (String)"{"list":[{"a":5,"c":"10"},{"a":5,"b":0}]}"; line: 1, column: 22] (through reference chain: example.jackson.Family$D["list"]->java.util.ArrayList[0]->example.jackson.Family$Father["c"])
```
因为序列化的时候记录的信息不足，导致不知道究竟是哪个子类。

所以说，这个类型信息是必须被记录的，不管使用`@autotype`还是以普通property的形式去记录，总之都要记下来，然后用相对应的处理metadata的反序列化方法将json反序列化为对象。

但是这样序列化出来的json看起来会比较奇怪，总感觉不是“纯正的json”。json的好处就是可读，这么搞可读性稍稍下降了一些。json序列化框架使用了一种略微影响可读性的方式完成了对多态的序列化。

其他序列化方式（比如protobuf、avro）呢？可想而知，因为他们本身就是序列化为字节，不是给人看的，人们也不关心他们写了啥字节，他们自然想写啥写啥。比如protobuf可以用oneof指代一个field，至于这个field是Son1还是Son2，肯定通过字节标识出来了，要不然protobuf也是不可能发序列化回来的。

所以说，只要人类看不见，就不会逼逼赖赖了:D

说到这里，不禁想到了Java多态的本身：运行时，如果一个Son1赋值给Father的引用，理论上来讲只知道这是一个Father对象，实际上它可能是Son1也可能是Son2，那么调用具体的方法时，为什么Java能准确地调用Son1的override方法呢？

根据上面序列化的经验，可以猜想Java一定像json序列化一样，将子类型也记录了下来，才能在调用的时候找到真正的子类型：
1. 每个.class字节码文件在被ClassLoader加载之后都会在jvm中生成一个唯一的Class对象，该Class类型的对象含有该类的所有信息，比如类名、方法、field、构造函数等；
2. 每一个该类new出来的对象，都有一个指向上述Class对象的引用。可通过Object的`public final native Class<?> getClass()`方法获得Class对象；
3. 获取到了一个object的Class对象之后，关于这个object的一切类相关的信息都可以通过Class对象取得了。

> 这不是多态的实际实现，但说明了一个对象的实际类型实际上都是可以被检索到的。

所以Java也是通过记录所有对象的类信息，以在运行时实时决定该对象类型，并在多态时调用合适的override方法。

**因此，解决多态问题的唯一途径就是记录下该对象究竟是哪一个子类型，无论是序列化时的多态还是运行时的多态！**

# 附：示例代码
```
package example.jackson;

import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.ToString;

/**
 * @author liuhaibo on 2017/11/29
 */
public class Family {

    public static void main(String[] args) throws Exception {
        List<Father> dataList = new ArrayList<>();
        dataList.add(new Son2("10", 5));
        dataList.add(new Son1(8, 5));
        D d = new D();
        d.setList(dataList);

        ObjectMapper mapper = new ObjectMapper();

        String data = mapper.writeValueAsString(d);
        System.out.println(data);
        D result = mapper.readValue(data, D.class);

        System.out.println(result.getList());
    }

    public static class D {
        List<Father> list;

        public List<Father> getList() {
            return list;
        }

        public void setList(List<Father> list) {
            this.list = list;
        }

    }

    @ToString
    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "custom-type-name")
    @JsonSubTypes(value = {
            @JsonSubTypes.Type(value = Son1.class, name = "FirstSon"),
            @JsonSubTypes.Type(value = Son2.class, name = "SecondSon")
    })
    public static class Father {
        protected int a;

        public Father() {
        }

        public Father(int a) {
            this.a = a;
        }

        public int getA() {
            return a;
        }

        public void setA(int a) {
            this.a = a;
        }

    }

    @ToString(callSuper = true)
    public static class Son1 extends Father {
        public Son1() {
        }

        public Son1(int b, int a) {
            super(a);
        }

        private int b;

        public int getB() {
            return b;
        }

        public void setB(int b) {
            this.b = b;
        }
    }

    @ToString(callSuper = true)
    public static class Son2 extends Father {
        private String c;

        public Son2() {
        }

        public Son2(String c, int a) {
            super(a);
            this.c = c;
        }

        public String getC() {
            return c;
        }

        public void setC(String c) {
            this.c = c;
        }

    }
}
```


