---
layout: post
title: "序列化 - Avro"
date: 2020-07-25 21:27:30 +0800
categories: avro serialization
tags: avro serialization
---

Avro结合Java使用，主要有：
- avsc编译为Java代码；
- 使用生成的代码序列化反序列化对象；

1. Table of Contents, ordered
{:toc}

# 编译avsc
可以使用avro-tools手动编译avsc生成Java代码，也可以使用avro-maven-plugin。

```
java -jar avro-tools-1.10.0.jar compile schema user.avsc .
```
会在当前目录下生成package目录，里面有生成的Java类。

# 创建对象

一般用builder，但也可以用constructor。

使用constructor创建对象可以只设置需要的属性，但是using a builder requires setting all fields, even if they are null。

# Avro null value

> 以avro 1.7.7为例。

avro允许null，只要field type定义为null或union类型（union里有null）就行。定义好之后，不管是显式设置null，还是设置了default为null，都是可以的。**avro不允许的是没有设置default，同时也没有显式设置值。null不null倒不是问题的关键。**

avro有一个boolean flag数组，标志每一个field是否已经被显式赋值了。每次set一个field的时候，它对应的flag就会被设为true。**如果没有赋值，会检查有没有default，如果没有default，就会报错。**

假设一个field为普通类型，int，也可以为null，那么可以定义type为union，`["null", "int"]`，default可以设置成`null`：
```
  {
    "doc": "range condition",
    "namespace": "com.puppylpg",
    "type": "record",
    "name": "Range",
    "fields": [
      {
        "name": "min",
        "type": [
          "null",
          "int"
        ],
        "default": null
      },
      {
        "name": "max",
        "type": [
          "null",
          "int"
        ],
        "default": null
      }
    ]
  }
```
需要注意的是，在union里，null一定要放在int前面：
- https://stackoverflow.com/a/23387590/7676237
- https://avro.apache.org/docs/1.7.7/spec.html#Unions

如果类型为record，一样的道理，它的类型可以为上面定义的Range或null：
```
            {
              "name": "avgView30Day",
              "type": [
                "null",
                "Range"
              ],
              "default": null,
              "doc": "最近30天media平均观看量"
            },
```
这样的话，它就可以set null值，也可以不设置值，使用默认的null值。

## 代码分析
上述定义中，max是这个record的第二个值，fields()[1]就是指max：
```
    public com.youdao.quipu.avro.schema.Range.Builder setMax(java.lang.Integer value) {
      validate(fields()[1], value);
      this.max = value;
      fieldSetFlags()[1] = true;
      return this; 
    }
```
只要设置值了，flag就是true。

最后build的时候，会检查有没有显式设置值，如果没有就取default：
```
    public Range build() {
      try {
        Range record = new Range();
        record.min = fieldSetFlags()[0] ? this.min : (java.lang.Integer) defaultValue(fields()[0]);
        record.max = fieldSetFlags()[1] ? this.max : (java.lang.Integer) defaultValue(fields()[1]);
        return record;
      } catch (Exception e) {
        throw new org.apache.avro.AvroRuntimeException(e);
      }
    }
```
**此时如果这个field没设置default，`field.defaultValue()`就会返回null，会抛AvroRuntimeException**：Field xxx not set and has no default value
```
  public Object getDefaultValue(Field field) {    
    JsonNode json = field.defaultValue();
    if (json == null)
      throw new AvroRuntimeException("Field " + field
                                     + " not set and has no default value");
    if (json.isNull()
        && (field.schema().getType() == Type.NULL
            || (field.schema().getType() == Type.UNION
                && field.schema().getTypes().get(0).getType() == Type.NULL))) {
      return null;
    }
    
    // Check the cache
    Object defaultValue = defaultValueCache.get(field);
    
    // If not cached, get the default Java value by encoding the default JSON
    // value and then decoding it:
    if (defaultValue == null)
      try {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        BinaryEncoder encoder = EncoderFactory.get().binaryEncoder(baos, null);
        ResolvingGrammarGenerator.encode(encoder, field.schema(), json);
        encoder.flush();
        BinaryDecoder decoder =
          DecoderFactory.get().binaryDecoder(baos.toByteArray(), null);
        defaultValue =
          createDatumReader(field.schema()).read(null, decoder);

        defaultValueCache.put(field, defaultValue);
      } catch (IOException e) {
        throw new AvroRuntimeException(e);
      }

    return defaultValue;
  }
```

**那如果给max设置个null呢？只要max的定义里允许接受null，那么设置null就相当于设置了值，flag=true**。这一切都由setMax里的validate方法校验：
```
 protected void validate(Field field, Object value) {
    if (isValidValue(field, value)) {
      return;
    }
    else if (field.defaultValue() != null) {
      return;
    }
    else {
      throw new AvroRuntimeException(
          "Field " + field + " does not accept null values");
    }
  }
  
  protected static boolean isValidValue(Field f, Object value) {
    if (value != null) {
      return true;
    }
    
    Schema schema = f.schema();
    Type type = schema.getType();
    
    // If the type is null, any value is valid
    if (type == Type.NULL) {
      return true;
    }

    // If the type is a union that allows nulls, any value is valid
    if (type == Type.UNION) {
      for (Schema s : schema.getTypes()) {
        if (s.getType() == Type.NULL) {
          return true;
        }
      }
    }
    
    // The value is null but the type does not allow nulls
    return false;
  }
```
**如果field的类型是Type.NULL，或者类型是Type.UNION，且UNION里允许Type.NULL，那么avro就可以设置null，这个值就是合法的。**

**所以avro报错的依据就一条：值没设置，且没有默认值**。跟null不null没关系。

null是另一个问题：如果schema里定义了null，null就是可设置的合法值（无论显式设置还是使用default设置），否则设置null就会报错。

## null定义的特例
上面的schema，如果field能接受null，我们就定义了default为null，这样写很规范。但是根据实验，假设schema的type里没有null，也是可以定义default为null的：在编译时可以过，编译avro会报警，但不会报错。

但用起来会不会错就不一定了：
1. 这种情况下显式设置null是可以的。avro认为既然default允许null，显式设置null也行；
2. 但如果没有显式设置值，default为null，取default时就会报错，因为schema不允许null。

这个就有点儿抽象了。

所以还是像之前的schema一样写规范点儿比较好：
1. 如果允许null（default为null说明这个field就需要允许null），field设置为union类型，老老实实加上null；
1. 老老实实给所有的field设好默认值。

按照这两个准则使用avro准没错！

# 序列化反序列化
avro序列化的时候，会先在文件里写当前对象的schema，再写对象。

反序列化的时候，文件里记录的有writer（DatumWriter）写时的schema，reader（DatumReader）会有读时的schema：
- writer的schema告诉avro writer当时写字段的时候是按照什么顺序写的；
- reader的schema告诉avro转成对象的时候都需要哪些字段，以及对于新增的writer写时还不存在的字段，使用哪些默认值；

如果两套schema不一样，按照[Schema Resolutin](http://avro.apache.org/docs/current/spec.html#Schema+Resolution)来搞。

## 使用生成的代码
```
// Serialize user1, user2 and user3 to disk
DatumWriter<User> userDatumWriter = new SpecificDatumWriter<User>(User.class);

DataFileWriter<User> dataFileWriter = new DataFileWriter<User>(userDatumWriter);

dataFileWriter.create(user1.getSchema(), new File("users.avro"));
dataFileWriter.append(user1);
dataFileWriter.append(user2);
dataFileWriter.append(user3);
dataFileWriter.close();
```
如果已经编译avsc生成了特定的类的代码，可以创建特定的类（这里指User）的writer，**特定的类的DatumWriter使用SpecificDatumWriter**。

接着创建一个DataFileWriter写入file。先写schema，再append对象。这个DataFileWriter封装了写时的内部细节，其实还是用DatumWriter往file里写的。

```
// Deserialize Users from disk
DatumReader<User> userDatumReader = new SpecificDatumReader<User>(User.class);

DataFileReader<User> dataFileReader = new DataFileReader<User>(file, userDatumReader);

User user = null;
while (dataFileReader.hasNext()) {
// Reuse user object by passing it to next(). This saves us from
// allocating and garbage collecting many objects for files with
// many items.
user = dataFileReader.next(user);
System.out.println(user);
}
```
读的时候类似，DatumReader使用的是SpecificDatumReader。使用迭代器读数据。

需要注意的是这里的标准读法：**传入一个User的引用，avro会始终复用这个对象，对这个对象的属性赋值，从而避免创建多个对象。** 如果数据量不大，则没有必要这么复用，可以直接使用：
```
for (User user :dataFileReader)
```
每次new一个新的User。

> Hadoop读对象的时候也是这么搞的，kafka貌似也是。处理大量数据的时候，基本都是这么复用对象。

同样，这个DataFileReader也是封装了读时的内部细节，实际肯定也是用DatumReader从file里反序列化的。

总结：
- DatumWriter -> SpecificDatumWriter
- DatumReader -> SpecificDatumReader
- DataFileReader/DataFileWriter

## 不使用生成的代码
也可以不使用生成的代码，直接用通用的方式写对象。

首先，因为没有编译avsc生成Java代码，所以没法用constructor或者builder创建对象：
```
Schema schema = new Schema.Parser().parse(new File("user.avsc"));

GenericRecord user1 = new GenericData.Record(schema);
user1.put("name", "Alyssa");
user1.put("favorite_number", 256);
// Leave favorite color null

GenericRecord user2 = new GenericData.Record(schema);
user2.put("name", "Ben");
user2.put("favorite_number", 7);
user2.put("favorite_color", "red");
```
只能使用GenericRecord，按照一个Schema（avsc）操作，以k-v的形式摄入数据，如果schema里没有这个属性，会抛出运行时错误AvroRuntimeException。

序列化的时候，也没法使用SpecificDatumWriter，而是GenericDatumWriter（就像GenericRecord一样），同时传入Schema（avsc）：
```
// Serialize user1 and user2 to disk
DatumWriter<GenericRecord> datumWriter = new GenericDatumWriter<GenericRecord>(schema);

DataFileWriter<GenericRecord> dataFileWriter = new DataFileWriter<GenericRecord>(datumWriter);

dataFileWriter.create(schema, new File("users.avro"));
dataFileWriter.append(user1);
dataFileWriter.append(user2);
dataFileWriter.close();
```
同样还是用DataFileWriter去写，这点没变，只不过封装的DatumWriter是GenericDatumWriter。

```
// Deserialize users from disk
DatumReader<GenericRecord> datumReader = new GenericDatumReader<GenericRecord>(schema);

DataFileReader<GenericRecord> dataFileReader = new DataFileReader<GenericRecord>(file, datumReader);

GenericRecord user = null;
while (dataFileReader.hasNext()) {
// Reuse user object by passing it to next(). This saves us from
// allocating and garbage collecting many objects for files with
// many items.
user = dataFileReader.next(user);
System.out.println(user);
```
读的时候类似，使用的是GenericDatumReader。

总结：
- DatumWriter -> GenericDatumWriter
- DatumReader -> GenericDatumWriter
- DataFileWriter/DataFileReader

# Ref
- Avro Java开发：http://avro.apache.org/docs/current/gettingstartedjava.html
- spec: http://avro.apache.org/docs/current/spec.html

