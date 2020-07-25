---
layout: post
title: "序列化 - Java"
date: 2020-07-25 22:50:06 +0800
categories: java serialization
tags: java serialization
---

Java序列化框架是一种Java专有的非通用的序列化方案，这是和protobuf、avro、json等通用序列号框架的根本区别。除此之外，Java的序列化更慢、序列化后的体积更大，所以即使是在Java里，应用也没以上通用序列框架广泛。

1. Table of Contents, ordered
{:toc}

# Java如何序列化反序列化
## 序列化 - write
- DataOutput：定义了写基本类型的接口，比如writeChar/Int/Boolean/Byte等；
- ObjectOutput：定义了写Object的接口，继承DataOutput接口；
- ObjectOutputStream：实现了ObjectOutput接口，拥有writeObject的实现。

那就看这个writeObject怎么实现的：
1. writeObject(Object)
2. writeObject0
3. writeOrdinaryObject
4. writeSerialData
5. invokeWriteObject或者defaultWriteFields

玄机都藏在这几步里：

### 为什么想要序列化的类必须实现Serializable接口
在writeObject0里有以下几步：
```
            // remaining cases
            if (obj instanceof String) {
                writeString((String) obj, unshared);
            } else if (cl.isArray()) {
                writeArray(obj, desc, unshared);
            } else if (obj instanceof Enum) {
                writeEnum((Enum<?>) obj, desc, unshared);
            } else if (obj instanceof Serializable) {
                writeOrdinaryObject(obj, desc, unshared);
            } else {
                if (extendedDebugInfo) {
                    throw new NotSerializableException(
                        cl.getName() + "\n" + debugInfoStack.toString());
                } else {
                    throw new NotSerializableException(cl.getName());
                }
            }
```
所以一个类如果不实现Serializable接口，最终会落到else里，抛出NotSerializableException。

### 都序列化了什么东西
在writeOrdinaryObject里，有如下代码：
```
            desc.checkSerialize();

            bout.writeByte(TC_OBJECT);
            writeClassDesc(desc, false);
            handles.assign(unshared ? null : obj);
            if (desc.isExternalizable() && !desc.isProxy()) {
                writeExternalData((Externalizable) obj);
            } else {
                writeSerialData(obj, desc);
            }
```
所以写了：
- 一个专属于Object的magic byte（String、Enum之类的用其他的magic byte）；
- 类描述信息；
- 真实数据信息；

其中，类描述信息是ObjectStreamClass类，它里面放了要序列化的对象的类信息，比如：
```
    /** class associated with this descriptor (if any) */
    private Class<?> cl;
    /** name of class represented by this descriptor */
    private String name;
    /** serialVersionUID of represented class (null if not computed yet) */
    private volatile Long suid;

    /** true if represents dynamic proxy class */
    private boolean isProxy;
    /** true if represents enum type */
    private boolean isEnum;
    /** true if represented class implements Serializable */
    private boolean serializable;
    /** true if represented class implements Externalizable */
    private boolean externalizable;
    /** true if desc has data written by class-defined writeObject method */
    private boolean hasWriteObjectData;
    ...
```
大致有：
- 类名；
- 类的serial version id（实现了Serializable接口，就得有这个id）；
- 其他很多辅助信息；

所以：
- Java序列化后的体积为什么比其他序列化（avro、protobuf、json）框架大？**因为写了很多额外信息**；
- Java序列化的速度为什么比其他序列化框架慢？**因为写的东西多，做的检查多，执行步骤多**；
- **Java序列化为什么不能跨语言**？因为不止写了数据信息，还加入了乱七八糟的只有Java才有的信息；

其他序列化框架写了啥？
- json一般就写了属性和对应的数据。当然也可能加入其他metadata，比如fastjson还可能写入了属性的实际类型信息（方便对多态反序列化）；
- avro、protobuf一类的写的是字节，而且写的东西更少。比如protobuf只写属性代号和属性值，连属性名都不序列化。属性名在反序列化的时候根据代号去schema里查。所以序列化后的一坨字节很小，而且只有他们这些框架本身能理解；

Ref：
- protobuf序列化：https://puppylpg.github.io/protobuf/serialization/2020/05/15/serialization-protobuf.html
- fastjson的一些序列化：https://hollis.blog.csdn.net/article/details/107150646；
- Java原生序列化为什么慢：https://my.oschina.net/u/1787735/blog/1919855

### 自定义序列化方式
在序列化最后真正写数据的时候，invokeWriteObject里还有这样的代码：
```
writeObjectMethod.invoke(obj, new Object[]{ out })
```
调用了一个反射去写对象。方法是：
```
    /** class-defined writeObject method, or null if none */
    private Method writeObjectMethod;
```
该方法来自于：
```
                        writeObjectMethod = getPrivateMethod(cl, "writeObject",
                            new Class<?>[] { ObjectOutputStream.class },
                            Void.TYPE);
```
被写对象的writeObject！

所以Java序列化框架给了序列化对象自己序列化自己的机会！

有什么用呢？比如ArrayList底层用的数组，快满时会扩容。序列化的时候最好只写已存放的数据。如果把整个数组都序列化了，岂不是存了一大堆null……所以自己如何序列化自己最清楚。

如果自己没定义writeObject方法呢？
那writeSerialData就会调用defaultWriteFields方法，进行Java序列化框架默认的序列化。

Ref:
- Java序列化：https://www.hollischuang.com/archives/1140

## 反序列化 - read
- DataInput
- ObjectInput
- ObjectInputStream

# 总结
1. Java序列化不能跨语言；
2. Java序列化体积大速度慢是有原因的；
3. Java序列化为Java的自主序列化和反序列化做了很多事情，远不是其他序列化平台那样直接写数据那么简单。

