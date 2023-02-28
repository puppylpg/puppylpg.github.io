---
layout: post
title: "序列化 - protobuf"
date: 2020-5-15 03:09:06 +0800
categories: protobuf serialization
tags: protobuf Serialization
---

https://developers.google.com/protocol-buffers/docs/overview

protobuf比xml更快、更小。

顺便探讨一下序列化的机制。

1. Table of Contents, ordered                    
{:toc}

# 语言规范
https://developers.google.com/protocol-buffers/docs/proto3

# Java使用
- https://developers.google.com/protocol-buffers/docs/javatutorial
- https://developers.google.com/protocol-buffers/docs/reference/java-generated

# Encoding
## 普通的序列化
一个简单的直接逐个字段序列化的例子：
```java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ApkInfo implements IWritable {

    /**
     * ad content id
     */
    private Long adContentId;

    /**
     * app name
     */
    private String appName;

    /**
     * app package name
     */
    private String packageName;

    /**
     * app version
     */
    private String appVersion;

    /**
     * app size(bytes)
     */
    private long appSizeByte;

    /**
     * md5 of this app
     */
    private String appMd5;

    @Override
    public void writeFields(DataOutput out) throws IOException {
        out.writeLong(adContentId);
        StringWritable.writeStringNull(out, appName);
        StringWritable.writeStringNull(out, packageName);
        StringWritable.writeStringNull(out, appVersion);
        out.writeLong(appSizeByte);
        StringWritable.writeStringNull(out, appMd5);
    }

    @Override
    public void readFields(DataInput in) throws IOException {
        adContentId = in.readLong();
        appName = StringWritable.readStringNull(in);
        packageName = StringWritable.readStringNull(in);
        appVersion = StringWritable.readStringNull(in);
        appSizeByte = in.readLong();
        appMd5 = StringWritable.readStringNull(in);
    }

    @Override
    public IWritable copyFields(IWritable value) {
        throw new UnsupportedOperationException();
    }
}
```
这个序列化有以下特点：
1. read和write必须按照固定的顺序，二者必须一致，否则凉凉。因为实际上**二者默认了都按某个顺序序列化反序列化**，这种默认不能出现不一致；
2. 不管某个field有没有数据，都要写一个数据。比如long类型的adContentId，如果不存在，也必须写个0；
3. 这个写String，代码如下，具体实现是先写个boolean标识String是否存在，如果存在再写个长度，这个长度是String按照**某种编码方式**编码后的字节数，最后再写字节；
```
    public static int writeString(DataOutput out, String s) throws IOException {
        if (s.length() == 0) {
            return CDataOutputStream.writeVInt(0, out);
        } else {
            int targetLength = s.length() * 3;
            byte[] bytes = Limit.createBuffer(targetLength);
            int length = encode(s, bytes, 0);
            int lengthSize = CDataOutputStream.writeVInt(length, out);
            out.write(bytes, 0, length);
            return lengthSize + length;
        }
    }
```

具体每一个对象（long，int等）是怎么被写到DataOutput里的，有赖于DataOutput的实现。如果用DataOutputStream的话，它的writeLong方法实际是这么做的：
```
    /**
     * Writes a <code>long</code> to the underlying output stream as eight
     * bytes, high byte first. In no exception is thrown, the counter
     * <code>written</code> is incremented by <code>8</code>.
     *
     * @param      v   a <code>long</code> to be written.
     * @exception  IOException  if an I/O error occurs.
     * @see        java.io.FilterOutputStream#out
     */
    public final void writeLong(long v) throws IOException {
        writeBuffer[0] = (byte)(v >>> 56);
        writeBuffer[1] = (byte)(v >>> 48);
        writeBuffer[2] = (byte)(v >>> 40);
        writeBuffer[3] = (byte)(v >>> 32);
        writeBuffer[4] = (byte)(v >>> 24);
        writeBuffer[5] = (byte)(v >>> 16);
        writeBuffer[6] = (byte)(v >>>  8);
        writeBuffer[7] = (byte)(v >>>  0);
        out.write(writeBuffer, 0, 8);
        incCount(8);
    }
```
把long的八个字节转成byte，再把byte数组（8 byte）交给底层的OutputStream。

> 题外话：如果DataOutputStream包裹的底层OutputStream是ByteArrayOutputStream，那么就是把这个字节数组使用`System.arraycopy`拷到自己内部的byte array里。

这样的话，相当于根本没有long值，但还是写了8byte：
1. 占地方；
2. 根本不知道long字段的确就是0，还是默认值0；

## protobuf序列化
https://developers.google.com/protocol-buffers/docs/encoding
### 序列化数字 - Varint
**int32, int64, uint32, uint64, sint32, sint64, bool, enum这些，protobuf全都序列化为自定义的Varint（可变int）。**

具体为：
- 字节最高有效位（Most Significant Bit, msb）为1，代表数还没序列化完，后面的字节还是该数字的内容；
- msb为0，代表结束。

取出这些字节，去掉msb，再逆序（因为protobuf采用Little-Endian编码），拼接字节，翻译成数字即可。

所以一个字节有7bit是来编码数字的。对于int32来讲，一个数字如果小于128，1byte就够了。如果很大，需要5byte（原本4byte能表示的数，每个byte都有一个用来当作msb了，自然得5byte来表示）。

所以除非全是很大的数值，否则Varint平均下来肯定是比恒定4byte的int要短的。
> 又是定长编码 vs. 变长编码。

**如果确定全都是大于2^28的数（需要5 byte），建议用fixed32类型，恒定4byte，和普通int一样。fixed64同理。**

### key-value pair
protobuf序列化的是key-value pair。

比如.proto里定义的是`int32 number = 5;`，实际number值为1024，那么在语义上存储的就是**key为5 + （value的类型）Varint**（int32属于Varint），**value为1024**的pair。

value：1024的序列化就是上面的Varint。

key：怎么既标识field number是5，又标识value是Varint？

#### key
首先，定义key的值为：`(field_number << 3) | wire_type`，即：
- 末尾3bit用来标识value的类型（所以protobuf实际序列化时的value只能有8种类型）；
- 前面的bit代表field_number；

这样的话只要读到key，就能知道这个字段的field number，也能按照所标识的value的类型取到value值并序列化。

**其次，由于key本身是作为一个数字存储，所以key的字节是以Varint来存储的。**

这样就可以读出key-value pair的内容：field number，value值。

此时只有两个东西不知道：
- 这个字段的名称。这个需要在.proto源文件里根据field number找到。
- 这个字段的实际类型（eg: Varint到底是int还是long）。这个也需要在源文件里找到。

> 所以如果一个新protobuf（新增了字段）协议序列化后的字节被一个老protobuf（没有新增字段）反序列化的话，新增字段也能被反序列化出来，但是如果显示为肉眼可见的json，就是“field number : value”，因为不知道该字段的名字。类型的话基本能确定（虽然到底是long还是int分不清，倒是无所谓了）

**因为用的是key-value pair，如果一个field没有值，就不用序列化它了。而且，序列化和反序列化也不需要都按照相同的field顺序。**

### int32 vs. sint32 - ZigZag编码
**负数如果看做原码，实际是很大的一个数，所以如果用protobuf的int32存储负数，是需要5个字节的。ZigZag编码能解决这个问题，它能把所有的负数映射为非负数**：0 = 0, -1 = 1, 1 = 2, -2 = 3, 2 = 4, -3 = 5, 3 = 6 ... **output为自然数，input为所有整数，但是input的映射规则从0开始不断左右左右横跳**，很zigzag！

这么映射下来：
1. 非负数x全都映射为非负偶数2x：0、2、4、6、8；
2. 负数则全部映射为非负奇数：1、3、5、7、9；

**所有的负数都用正数表示了，-1就不需要用5byte表示，1byte就够了。**

zigzag用函数表示很简单：
```
return v < 0 ? (- 2 * v  - 1) : 2 * v
```
但是用补码表示更高效：[`(n << 1) ^ (n >> 31)`](https://gist.github.com/mfuerstenau/ba870a29e16536fdbaba)

sint32就是使用ZigZag将数值全变为正数，再用变长编码序列化为字节。

**所以当数值会出现大量负值时，使用sint32/sint64，会明显优于int32/int64。**

### field number
https://developers.google.com/protocol-buffers/docs/proto3#reserved

所以对于protobuf来说，field number是相当重要的。如果一个field number不用了，可以删掉，但必须声明为reserved，也别让后来人用了。否则如果用新协议反序列化老协议的字节，同样的field number的含义、类型都变了，就出错了。

> field name最好也reserved了，别让后来人用了。主要是如果转成json用，json是按照名字来标志字段的，同名字段在新老协议里含义却不一样，相互转换时又尴尬了。

### packed
https://developers.google.com/protocol-buffers/docs/encoding#optional

field number如此重要，那么新协议把旧协议的一个repeated string的repeated直接删掉了，旧协议序列化后的字节能不能被新协议（相同field number，却是optional string）反序列化？可以的！

**protobuf规定repeated字段存储的时候，可以一个key后面跟上所有的value（packed模式），也可以分开成多个key-value pair存储。二者逻辑上等效。**

所以假设repeated字段作为多个key-value pair存储，取一个pair，正好反序列化为一个string。如果再取一个pair，protobuf实现为覆盖之前的string了。所以反序列化之后，repeated的值相当于只留了最后一个。

**protobuf3默认对repeated primitive type进行packed存储。省得写多个key费空间。**

# 优点
所以，protobuf：
- 省空间
    + Varint；
    + ZigZag的sint32（signed int32）存负数；
    + fixed32存大数（大于2^28）；
    + 一个字段没有值就不需要序列化了：key-value pair；
- 序列化和反序列化每一个字段的顺序不用相同：key-value pair不需要在意顺序；
- 速度快：直接读字节、翻译字节就够了，不用像xml一样读完所有字节，构建结构树。

# 感想
## 数据结构决定灵活度 - List vs. Map
序列化的决策方式，决定了实现的优缺点：
1. 上面举例的普通序列化方式，共同保持了相同的字段顺序，**保存字段的方式有点儿像数组**，字段顺序不可变更。而且，字段没有值的时候也必须write一个值，比如false，代表这个字段值不存在；
2. json使用name-value pair作为序列化反序列化的约定，**保存字段的方式类似于map**。所以不存在字段的顺序问题。同name就是同一个field，但是一个name如果不用了，不能删掉。否则如果后续别人新加了同样的一个name字段，新老协议在相互转换的时候name的含义不一致了，其实就出错了；
3. protobuf使用field number-value作为序列化反序列化的约定，**保存字段的方式类似于map**，也不存在字段的顺序问题。同样field number如果不用了，也不要删，或者说可以删，但必须声明为reserved也不让后来者用。

## 数据结构决定效率
在同样存储一个数字的实现上，不同的实现方式差别也很大：
1. 普通序列化方式在存储数字时，就是直接序列化该数字；
2. protobuf使用了自定义的Varint，用变长编码存储数字，平均下来体积要小很多。使用sint32采用ZigZag的方式存储负值，又是一个很大的改进。

这些对序列化的灵活度和存储效率影响极大。

还有一个不错的中文参阅：
- https://www.ibm.com/developerworks/cn/linux/l-cn-gpb/

