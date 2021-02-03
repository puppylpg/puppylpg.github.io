---
layout: post
title: "jar与maven打包"
date: 2021-02-04 00:12:38 +0800
categories: Java jar maven spring-boot
tags: Java jar maven spring-boot
---

jar是Java ARchive的缩写，将Java文件归档，其实和zip的原理类似，只不过加了一些java执行独有的功能。

1. Table of Contents, ordered
{:toc}

# zip
JAR files are packaged with the ZIP file format.所以jar的选项和zip基本一致：
```
$ jar                                                                                                                            ⏎
Usage: jar {ctxui}[vfmn0PMe] [jar-file] [manifest-file] [entry-point] [-C dir] files ...
Options:
    -c  create new archive
    -t  list table of contents for archive
    -x  extract named (or all) files from archive
    -u  update existing archive
    -v  generate verbose output on standard output
    -f  specify archive file name
    -m  include manifest information from specified manifest file
    -n  perform Pack200 normalization after creating a new archive
    -e  specify application entry point for stand-alone application
        bundled into an executable jar file
    -0  store only; use no ZIP compression
    -P  preserve leading '/' (absolute path) and ".." (parent directory) components from file names
    -M  do not create a manifest file for the entries
    -i  generate index information for the specified jar files
    -C  change to the specified directory and include the following file
If any file is a directory then it is processed recursively.
The manifest file name, the archive file name and the entry point name are
specified in the same order as the 'm', 'f' and 'e' flags.

Example 1: to archive two class files into an archive called classes.jar:
       jar cvf classes.jar Foo.class Bar.class
Example 2: use an existing manifest file 'mymanifest' and archive all the
           files in the foo/ directory into 'classes.jar':
       jar cvfm classes.jar mymanifest -C foo/ .
```

xvf、c、-0（不压缩只存储），和zip都一毛一样。

`C`是打包的时候不打包directory，直接进到directory里，把里面的内容打进jar包，所以看起来就和这些文件没有在文件夹里一样。这个功能是模仿的tar。

所以jar打包时，也在做压缩，除非明确指定不压缩，否则都是压缩的。比如：
```
$ jar cvf TicTacToe.jar TicTacToe.class audio images

adding: TicTacToe.class (in=3825) (out=2222) (deflated 41%)
adding: audio/ (in=0) (out=0) (stored 0%)
adding: audio/beep.au (in=4032) (out=3572) (deflated 11%)
adding: audio/ding.au (in=2566) (out=2055) (deflated 19%)
adding: audio/return.au (in=6558) (out=4401) (deflated 32%)
adding: audio/yahoo1.au (in=7834) (out=6985) (deflated 10%)
adding: audio/yahoo2.au (in=7463) (out=4607) (deflated 38%)
adding: images/ (in=0) (out=0) (stored 0%)
adding: images/cross.gif (in=157) (out=160) (deflated -1%)
adding: images/not.gif (in=158) (out=161) (deflated -1%)
```
打包进去的class文件和普通文件都会被压缩。

# view
显示jar内的文件 - `t`，也是模仿的tar：
```
jar tf xxx.jar
```

# manifest - META-INF/MANIFEST.MF
`m`/`M`选项比较特殊，和manifest相关。**默认jar是会自动生成一个manifest的：`META-INF/MANIFEST.MF`**。

或者手动添加自己写的manifest：
```
jar cmf <jar-file-name> <existing-manifest> <input-files>
```

**m选项是在merge manifest，而不是replace原有的manifest**。

manifest是jar的metadata的集合，因为它，jar才丰富多彩。默认manifest类似：
```
Manifest-Version: 1.0
Created-By: 1.7.0_06 (Oracle Corporation)
```

manifest规范定义了很多kv对。用户也可以自定义kv对，下面的spring-boot manifest会说到。

## entry point - `Main-Class`
**一个能启动的jar被称为executable jar，它的manifest必须使用`Main-Class`表明整个application的entry point**：
```
Main-Class <some-class-name>
```
当然，该class必须包含`public static void main(String[] args)`，要不然也没法启动。

启动jar：
```
java -jar <jar-file>
```

除了上述手动merge manifest设定entry point，还可以使用`e`选项（entrypoint）：
```
jar cef <jar-file-name> <entrypoint-class-name> <input-files>
```
**文件最后一行不被解析，所以最后一行要加一个回车。**

- https://docs.oracle.com/javase/tutorial/deployment/jar/appman.html

## other jar - `Class-Path`
如果jar里的类想要引用其他jar，需要在manifest里指定其他jar的路径：
```
Class-Path: xx/xxx.jar
```
但是引用的jar**只能是本地的jar，不能是internet上的jar，也不能是jar里嵌套的jar**。使用`Class-Path`唯一的好处就是，在命令行里执行jar的时候，不需要使用`-classpath`指定jar里的类引用的jar了。

**其实这个特性用处不大**，毕竟没有把被引用的jar打包到这个jar里，所以他们之间是一种很松散的引用关系，一旦文件位置移动，这种关系就会被破坏。所以`Class-Path`其实很鸡肋，基本没见它被用到过。

- https://docs.oracle.com/javase/tutorial/deployment/jar/downman.html

**如果想引用jar里嵌套的jar，必须自己写代码来实现这套逻辑**。就像`spring-boot-loader`做的一样：
- https://stackoverflow.com/questions/66023001/does-jar-manifest-support-class-path-why-use-spring-boot-loader-instead

# 冷知识：Jar-related API
java有一套关于jar的这套逻辑的代码实现，比如：
- 关于jar的`java.util.jar`：
    + java.util.jar.Manifest；
    + java.util.jar.JarEntry；
- 关于jar远程访问的URLConnection：`java.net.JarURLConnection`；

如果有兴趣，可以看看一个demo：
- https://docs.oracle.com/javase/tutorial/deployment/jar/apiindex.html

1. 根据url，开启一个JarURLConnection，远程获取jar；
1. 根据manife的Main-Class获取entry class；
1. 使用classloader加载该类，反射获取main方法；
1. invoke main；

当需要自定义一些jar相关的功能的时候，就会用到这些类。比如下面将要介绍的spring-boot-loader。

# maven打jar包
（这是一个热知识）

从上面可以知道，jar的manifest最核心的配置项是：
- Main-Class：entry point；

现在基本不会有用`jar`命令手动打包的场景了，一般用maven打包。

## maven-jar-plugin - dependency jar
编译一个工程后，maven会把`${basedir}/src/main/resources`下的资源直接扔到`target/classes`下，也会把`${basedir}/src/main/java`下的类编译后的class文件扔到`target/classes`下。所以资源和class文件是在同一个文件下的。

打包的时候，直接把`target/classes`下的内容打成jar包。然后按照jar的规范，会额外生成一个`META-INF/MANIFEST.MF`

假设生成的jar为target.jar，这样的jar并不能使用`java -jar target.jar`执行，因为**MANIFESE.MF里不含`Main-Class`文件**。

所以，只能使用：
```
java -cp target.jar <entry-class>
```
把jar放在classpath下，java自然会去classpath的jar里寻找entry class，和其他需要的类。

但是未必能执行成功。如果引入了第三方依赖，**maven的jar插件并不会将第三方jar包也打进来**，程序执行的时候就会找不到相应的类，挂掉。除非把第三方的jar也放到classpath下：
```
java -cp target.jar:dependency1.jar:dependency2.jar <entry-class>
```

意义：jar plugin**不是为了打一个可执行的jar包，而是为了打一个包，让别人依赖这个包**，因为这样打包只会打该工程自己的class文件，不会把第三方依赖的class也打进来。

## maven-assembly-plugin - executable jar
assembly插件就更全面一些：
1. 可以指定main class，给manifest加上`Main-Class`指定entry class；
1. 会把第三方依赖打进来，**但不是以内嵌jar的形式，而是将所有的第三方jar unzip成一个个的class，把这些class和自己写的class一起打包进jar**。

assembly plugin之所以这么做，当然是因为jar本身不支持嵌套jar读取，把第三方jar全都拆开，再打包进jar，简单粗暴又有效。

assembly插件打的包可以直接`java -jar`执行。**当然也可以使用`java -cp target.jar <entry-class>`的方式执行**。

意义：assembly插件就是为了打一个可执行jar包，简单粗暴有效。

## maven-shaed-plugin - executable jar
assembly插件是很方便，但是有一个致命问题：假设工程依赖了某依赖A的1.0版，另一个依赖B依赖了A的2.0版，而A的1.0和2.0并不兼容，必须同时存在。且A的1.0和2.0的类名一样，那assembly打包的时候就会类名冲突，相互覆盖了。（其实程序执行的时候也可能在找1.0的某个类时错找为2.0的类，导致某个方法not found）。

shade插件比assembly强的地方在于，用户打jar包的时候可以按照意愿，将一些依赖class所在的package改名（修改字节码）。这样修改后的类和原来的类就不会同包名了，可以做到同时存在。具体操作见[class relocation](http://maven.apache.org/plugins/maven-shade-plugin/examples/class-relocation.html)。

意义：和assembly一样打executable jar，同时可以通过改包名处理一下依赖冲突的问题。

## spring-boot-maven-plugin - executable jar
spring-boot + maven 开发的时候，可以直接使用这个插件，将包打成一个带依赖的可执行jar包。**而且并不会像assembly/shade插件一样把依赖unzip，而是以jar的形式打到jar包里的**。

- 优点：第三方以来以jar包的形式嵌入到jar里，看起来相当清晰；
- 缺点：需要实现一套从jar包里load嵌套的jar里的class的逻辑；

观察boot打包后的jar结构（只显示两层目录）：
```
$ tree -L 2
.
├── BOOT-INF
│   ├── classes
│   ├── classpath.idx
│   └── lib
├── META-INF
│   ├── MANIFEST.MF
│   └── maven
└── org
    └── springframework
```
分成三部分：
1. META-INF/MANIFEST.MF：jar规范，manifest文件；
1. BOOT-INF，它里面又分为两部分：
    1. `BOOT-INF/classes`：这个目录的内容基本等同于maven jar插件打包后的内容，就是自己写的类 + resources；
    1. `BOOT-INF/lib`：所有引入的第三方jar；
1. `org.springframework.loader`包，这一部分是spring boot自己塞进去的；

首先看manifest的内容：
```
Manifest-Version: 1.0
Spring-Boot-Classpath-Index: BOOT-INF/classpath.idx
Implementation-Title: restful
Implementation-Version: 1.0-SNAPSHOT
Start-Class: com.puppylpg.server.Application
Spring-Boot-Classes: BOOT-INF/classes/
Spring-Boot-Lib: BOOT-INF/lib/
Build-Jdk-Spec: 1.8
Spring-Boot-Version: 2.3.2.RELEASE
Created-By: Maven Jar Plugin 3.2.0
Main-Class: org.springframework.boot.loader.JarLauncher
```
最重要的自然是入口类：`Main-Class: org.springframework.boot.loader.JarLauncher`。

这个类并不是我们写的，而是`spring-boot-loader`包的内容，可以通过以下maven配置获取其内容：
```
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-loader</artifactId>
</dependency>
```
显然，spring boot自己把该包打了进来，并使用其中的`JarLauncher`作为整个程序的入口。

再看几个不在manifest规范里，看起来有很重要的项：
```
Start-Class: com.puppylpg.server.Application
Spring-Boot-Classes: BOOT-INF/classes/
Spring-Boot-Lib: BOOT-INF/lib/
Spring-Boot-Classpath-Index: BOOT-INF/classpath.idx
```
在`JarLauncher`的实现里，可以找到上述配置。

### `Start-Class`
spring boot构建的app启动类。平时在IDE里运行程序的时候，一般我们都是直接run这个类，整个服务就起来了。

```
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```
这个来也是有`public static void main`方法的，所以在不打jar包的时候，直接通过这个类就可以启动这个spring boot工程了。

打成jar包之后，`JarLauncher`是整个jar包的启动入口，它会根据`Start-Class`找到该类，然后反射调用其main方法，以启动整个spring boot工程。

### `Spring-Boot-Classes` & `Spring-Boot-Lib`
启动spring boot启动类的是JarLauncher，所以它会在启动启动类之前，把整个spring boot工程依赖的类（自己写的、第三方依赖）都找到。JarLauncher通过自己实现的逻辑，使用classloader加载`Spring-Boot-Classes`下的类，加载`Spring-Boot-Lib`下的jar包里的类，这样整个工程的类该classloader都能找到，最后再用这个classloader加载`Start-Class`就行了。

至于`Start-Class`，也就是spring boot的启动类，是怎么启动整个工程的，那就是spring和spring boot相关的内容了。

### `Spring-Boot-Classpath-Index`
这个其实就是`BOOT-INF/lib`下所有jar的名字，都写在了这个文件里。这些jar都会被classloader load，所以这个文件相当于起到了classpath的作用——为classloader指明要load的内容。

一开始我不是很理解，为什么一定要搞这个文件，直接看一下`BOOT-INF/lib`下有哪些jar不就可以了吗？后来想了想，可执行jar包在执行的时候，并没有unzip，所以没办法扫描`BOOT-INF/lib`下有哪些内容。有了`Spring-Boot-Classpath-Index`指定的文件，根据文件找出每一个jar的名字，可以直接读取它的内容。

**有一个classloader专门负责从directory里load class，从jar file里load class，它就是URLClassLoader**。所以spring-boot-loader里的classloader是基于URLClassLoader实现的：`public class LaunchedURLClassLoader extends URLClassLoader`。所有的class都由同一个classloader `LaunchedURLClassLoader`加载，spring boot启动类也被它加载，所以spring boot启动类需要依赖的其他类也可以通过该classloader找到。

关于这点，结合[Java - classloader]({% post_url 2020-09-17-classloader %})里对URLClassLoader一节的介绍，理解会更深刻。

- https://docs.spring.io/spring-boot/docs/current/reference/html/appendix-executable-jar-format.html

## 总结
- jar plugin：把工程打为依赖；
- assembly plugin：把工程以纯class文件的形式打成可执行jar包；
- shade plugin：同assembly，可以修改类的package name，解决类冲突；
- spring-boot-maven-plugin：把工程代码和第三方以来分类打成可执行jar包。为此，自己实现了从jar内的jar里load class的逻辑。

# Ref
- https://docs.oracle.com/javase/tutorial/deployment/jar/index.html

