---
title: "JAR 文件读取原理：ZIP 协议与随机访问"
date: 2026-04-12 00:00:00 +0800
categories: [java, jvm]
tags: [jar, zip, classloader, random-access]
description: "JAR 不就是磁盘上一个文件吗，getResourceAsStream 怎么能读到里面？答案在 ZIP 二进制协议和 Central Directory 索引——不需解压，直接寻址。"
---

JAR 不就是磁盘上一个文件吗，那 `getResourceAsStream("config.properties")` 怎么能读到"里面"的东西？

1. Table of Contents, ordered
{:toc}

# 读取 JAR 内资源的三种姿势

```java
// 1. ClassLoader（最常见）
InputStream is = MyClass.class.getResourceAsStream("/config.properties");

// 2. 直接操作 JarFile
try (JarFile jar = new JarFile("myapp.jar")) {
    JarEntry entry = jar.getEntry("config/app.properties");
    InputStream is = jar.getInputStream(entry);
}

// 3. NIO FileSystem（Java 9+）
FileSystem fs = FileSystems.newFileSystem(Path.of("myapp.jar"), (ClassLoader) null);
Path inside = fs.getPath("/config.properties");
String content = Files.readString(inside);
```

为什么不能用 `new File("config/app.properties")`？因为 JAR 内的路径是虚拟路径，不存在于磁盘文件系统。

# 不解压怎么读？直接解析 ZIP 二进制字节

上面三种方式虽然 API 不同，但底层做的是同一件事：**不把 JAR 解压到磁盘，直接从文件内部定位并读取目标字节。** 怎么做到的？JAR 本质上就是 ZIP 格式，所以答案是按 ZIP 协议直接解析二进制字节。

## ZIP 文件结构

```plain
[Local File Header + Data] ... [Central Directory] [End of Central Directory]
```

关键是末尾的 **Central Directory（中央目录）**，它是一个索引，记录每个 entry 的：

- 文件名
- 压缩方式（stored / deflated）
- **在文件中的字节偏移量（offset）**
- 压缩后/原始大小

## 读取过程

```plain
1. open JAR 文件（一次 syscall）
2. seek 到文件末尾，找到 End of Central Directory
3. 解析 Central Directory，建立"文件名 → offset"内存索引
4. 需要某个 entry 时，直接 seek 到对应 offset
5. 按压缩方式（通常 Deflate）解压那段字节，返回流
```

## 示意图

```plain
myapp.jar
├─ offset 0:     [Local Header] [Main.class deflate 压缩数据]
├─ offset 4096:  [Local Header] [app.properties 数据]
│
└─ offset 98304: [Central Directory]
                   "com/example/Main.class"    → offset=0,    size=2048
                   "config/app.properties"     → offset=4096, size=512
```

读 `config/app.properties`：查索引 → `lseek(fd, 4096)` → 读 512 字节 → inflate → 返回流。

# 本质类比

> **随机文件访问 + 内存索引**，和数据库 B-Tree 索引思路一样。

不需要扫描整个文件，直接跳到目标位置读字节。ZIP 格式本身就是为随机访问而设计的——Central Directory 存在的意义就是支持这种"不解压、直接寻址"的访问模式。

JDK 的 `ZipFile` 底层用 C 实现（`zip_util.c`），`getEntry` 是 O(1) 哈希查找，`getInputStream` 做的是 seek + inflate。