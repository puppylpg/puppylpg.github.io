---
layout: post
title: "Java - classloader"
date: 2020-09-17 00:06:04 +0800
categories: Java classloader
tags: Java classloader
---

看到Tomcat自定义的classloader有感而发，总结一下Java里的classloader。

1. Table of Contents, ordered
{:toc}

# classloader概述
## classloader做什么
ClassLoader类的javadoc：
> Given the binary name of a class, a class loader should attempt to locate or generate data that constitutes a definition for the class. A typical strategy is to transform the name into a file name and then read a "class file" of that name from a file system.

所以classloader的任务是：根据一个类的名称，找到这个类的类定义的数据，并把它加载为一个Class对象。

**一般情况下，是从文件系统上加载文件，所以ClassLoader要做的就是将一个类名转换为文件名，再去找到并读取这个文件。**

被ClassLoader读出来的Class对象，都要有一个指向该ClassLoader的指针：
> Every Class object contains a reference(Class#getClassLoader()) to the ClassLoader that defined it.

## classloader加载类的流程
> Normally, the Java virtual machine loads classes from the local file system in a platform-dependent manner. For example, on UNIX systems, the virtual machine loads classes from the directory defined by the `CLASSPATH` environment variable.
>
> However, some classes may not originate from a file; they may originate from other sources, such as the network, or they could be constructed by an application. The method `defineClass` converts an array of bytes into an instance of class `Class`. Instances of this newly defined class can be created using `Class.newInstance`.

一般是从文件里读定义类的字节码，但是也可以通过网络远程获取字节码，然后使用`defineClass`将获取到的二进制转换为Class对象。最后就可以使用Class对象的`newInstance`方法创建该对象的实例了。

> 关于Class对象，可以参考[Java反射与动态代理]({% post_url 2020-08-02-java-reflection-dynamic-proxy %})里对Class对象的介绍。

# Java的ClassLoader体系
Java一共定义了三个classloader，层级严格，分工明确：
- `BootstrapClassLoader`：load最核心的Java类，比如rt.jar，jdk里的那些类大部分都在这个包里面，比如String；
- `ExtClassLoader`：load一些其他的拓展类；
- `AppClassLoader`：load用户自己指定的类；

## 位置
Java规定了这三个类加载器所加载类的位置：
### `sun.boot.class.path`
BootstrapClassLoader从`sun.boot.class.path`指定的位置加载java核心类。**这个位置不应该被随意修改**。

可以看一下他的默认值：
```java
System.out.println("sun.boot.class.path: " + System.getProperty("sun.boot.class.path"));
```
或者通过Launcher获取：
```java
        URL[] urLs = sun.misc.Launcher.getBootstrapClassPath().getURLs();
        for (URL url : urLs) {
            System.out.println(url.toExternalForm());
        }
```
结果为冒号分隔的字符串。为了方便观看，将冒号处理成了换行：
```
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/resources.jar
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/rt.jar
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/sunrsasign.jar
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/jsse.jar
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/jce.jar
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/charsets.jar
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/jfr.jar
/usr/lib/jvm/java-8-openjdk-amd64/jre/classes
```

如果启动程序的时候，恶意指定一个不存在jdk的位置，比`-Dsun.boot.class.path=/tmp`，让java从`/tmp`文件夹下load java核心类（实际上`/tmp`文件夹下并没有这些类），程序直接会挂掉：
```
Error occurred during initialization of VM
java/lang/NoClassDefFoundError: java/lang/Object
```

当然，`sub.boot.class.path`也不是完全不能改。比如搞个骚操作：
1. 用系统的java启动程序；
2. 但是加载jvm的时候，不想用系统的jre，而是我自己下载的另一个jre；

先看一下系统java：
```
pichu@Archer ~ $ which java       
/usr/bin/java
pichu@Archer ~ $ ll `!!`
pichu@Archer ~ $ ll `which java`
lrwxrwxrwx 1 root root 22 9月  27  2017 /usr/bin/java -> /etc/alternatives/java
pichu@Archer ~ $ ll /etc/alternatives/java
lrwxrwxrwx 1 root root 46 11月  8  2017 /etc/alternatives/java -> /usr/lib/jvm/java-8-openjdk-amd64/jre/bin/java
```
我用的Debian，所以稍微麻烦点儿，最终确定用的系统java在`/usr/lib/jvm/java-8-openjdk-amd64/jre/bin/java`，版本是：
```
pichu@Archer ~ $ java -version
openjdk version "1.8.0_265"
OpenJDK Runtime Environment (build 1.8.0_265-8u265-b01-0+deb9u1-b01)
OpenJDK 64-Bit Server VM (build 25.265-b01, mixed mode)
```
然后我去[清华镜像源](https://mirror.tuna.tsinghua.edu.cn/AdoptOpenJDK/8/jdk/x64/linux/)下载了另一个openJDK，也是8u265版本，解压到`/home/pichu/Downloads/jdk8u265-b01`位置。

然后启动程序的时候，指定`-Dsun.boot.class.path=/home/pichu/Downloads/jdk8u265-b01/jre/lib/resources.jar:/home/pichu/Downloads/jdk8u265-b01/jre/lib/rt.jar:/home/pichu/Downloads/jdk8u265-b01/jre/lib/sunrsasign.jar:/home/pichu/Downloads/jdk8u265-b01/jre/lib/jsse.jar:/home/pichu/Downloads/jdk8u265-b01/jre/lib/jce.jar:/home/pichu/Downloads/jdk8u265-b01/jre/lib/charsets.jar:/home/pichu/Downloads/jdk8u265-b01/jre/lib/jfr.jar:/home/pichu/Downloads/jdk8u265-b01/jre/classes`，其实就是让系统的java使用我自己下载的另一个jre启动jvm。

结果成功了，因为我下载的openJDK和系统的openJDK实际是同一个版本的openJDK，二者的类内容应该是完全一样的，所以理论上是应该成功。

我的系统上还装了一个oracle的jdk：
```
pichu@Archer ~ $ /usr/lib/jvm/oracle-java8-jdk-amd64/jre/bin/java -version
java version "1.8.0_131"
Java(TM) SE Runtime Environment (build 1.8.0_131-b11)
Java HotSpot(TM) 64-Bit Server VM (build 25.131-b11, mixed mode)
```
版本要低于openJDK。我尝试用openJDK启动程序，同时指定`sun.boot.class.path`为oracle jdk里的jre，结果挂了：
```
FATAL ERROR in native method: processing of -javaagent failed
```
查了一下原因大概是编译代码的jdk（oracle jdk）版本低于运行程序的jre（openJDK）。

所以我又从[jdk.java.net](https://jdk.java.net/java-se-ri/8-MR3)下载了一个openJDK 8u41版本，使用系统openJDK启动程序，指定`sun.boot.class.path`为openJDK 8u41的jre位置，一些类加载成功了，但还是有一些挂了，细节如下：
```
[Opened /home/pichu/Downloads/java-se-8u41-ri/jre/lib/resources.jar]
[Opened /home/pichu/Downloads/java-se-8u41-ri/jre/lib/rt.jar]
[Loaded java.lang.Object from /home/pichu/Downloads/java-se-8u41-ri/jre/lib/rt.jar]
[Loaded java.io.Serializable from /home/pichu/Downloads/java-se-8u41-ri/jre/lib/rt.jar]

// 中间省略百余行

[Loaded java.lang.NullPointerException from /home/pichu/Downloads/java-se-8u41-ri/jre/lib/rt.jar]
[Loaded java.lang.ArithmeticException from /home/pichu/Downloads/java-se-8u41-ri/jre/lib/rt.jar]
Invalid layout of java.lang.Thread at name
Error occurred during initialization of VM
Invalid layout of preloaded class: use -XX:+TraceClassLoading to see the origin of the problem class
```
可看到Object、NullPointerException等等类都加载成功了，但是Thread类挂了。这都和java内部的编译类校验机制有关系吧，之前看jvm相关书籍有一些介绍，不过忘了。反正这东西不要乱改，否则启动jvm很可能在类加载时挂掉。

### `java.ext.dirs`
ExtClassLoader从`java.ext.dirs`指定的位置加载一些额外依赖，查看这些路径：
```java
System.out.println("java.ext.dirs: " + System.getProperty("java.ext.dirs"));
```
默认是：
```
/usr/lib/jvm/java-8-openjdk-amd64/jre/lib/ext:/usr/java/packages/lib/ext
```
jre下的`lib/ext`和系统的`/usr/java/packages/lib/ext`两个位置。

extension机制的好处就是，只要把一些依赖放到上述位置，该jre启动的所有Java程序都能够访问这些依赖，有种“扩充jre”的感觉，相当于给jre插上了一些插件，可以参考[Trail: The Extension Mechanism](https://docs.oracle.com/javase/tutorial/ext/)。

但是个人感觉有些坑啊……毕竟换个jre，程序就因为缺依赖跑不起来了。ext机制的唯一优点，大概就是不同java程序在同一个机器上共用ext里的依赖？不过现在使用maven管理依赖非常方便，也能共用maven local repo下的依赖，同时不存在换机器时换个jre就导致缺依赖程序跑不起来的致命问题。所以可能这个东西是时代的产物吧，放现在应该不太会用到了。

### `java.class.path`
AppClassLoader从`java.class.path`指定的位置加载用户自定义的类。

这才是我们开发者最常配置的选项：classpath！默认就是启动程序的当前文件夹`.`，因为太常用，所以java还提供了环境变量`CLASSPATH`或者命令行选项`-classpath`/`-cp`，用于启动java时自定义classpath路径。

> 当然也可以像指定bootstrap或者ext的路径一样，使用`-Djava.class.path`命令行参数。不过java命令已经提供了更简单的`-cp`参数了，为什么还要用这么麻烦的东西呢？

从命令行启动时，默认的classpath是启动时所在的文件夹。当用idea在IDE里按执行按钮启动程序时，idea已经帮忙将jdk和maven的依赖全都放入classpath里了：
```java
 System.out.println("java.class.path: " + System.getProperty("java.class.path"));
```
可看到结果包含几部分：

第一部分是jre下的一些类：
```
/usr/java/jdk1.8.0_66/jre/lib/charsets.jar

...

/usr/java/jdk1.8.0_66/jre/lib/ext/zipfs.jar
/usr/java/jdk1.8.0_66/jre/lib/jce.jar
/usr/java/jdk1.8.0_66/jre/lib/jsse.jar
/usr/java/jdk1.8.0_66/jre/lib/management-agent.jar
/usr/java/jdk1.8.0_66/jre/lib/resources.jar
/usr/java/jdk1.8.0_66/jre/lib/rt.jar
```
其实不是很明白为什么还要将java的核心类加入classpath，毕竟加载核心类是BootstrapClassLoader的事儿，跟`java.class.path`参数的内容并没有什么关系。

第二部分是程序猿自己写的代码编译后的位置：
```
/home/pichu/Codes/Java/mine/java-examples/target/classes
```
第三部分是用到的maven的各种依赖所在的位置：
```
/home/pichu/.m2/repository/com/yammer/metrics/metrics-core/2.2.0/metrics-core-2.2.0.jar

...

/home/pichu/.m2/repository/org/apache/commons/commons-math3/3.2/commons-math3-3.2.jar
```
最后还加入了idea自己的一个jar：
```
/usr/local/share/idea-IU-201.7846.76/lib/idea_rt.jar
```

所以之所以我们在IDE里只是点一下程序就能跑起来，实际上是因为IDE已经帮我们配置好了所有需要的依赖到classpath里。

> 双刃剑吧。懂了之后会享受IDE带来的这份简单，不懂的人又不去探究的话，就成为了永远不懂的小菜鸡……

## delegation体系
当一个classloader要加载一个类时，始终秉承“父classloader优先”的原则：
> The delegation model requires that any request for a class loader to load a given class is first delegated to its parent class loader before the requested class loader tries to load the class itself. The parent class loader, in turn, goes through the same process of asking its parent. This chain of delegation continues through to the bootstrap class loader (also known as the primordial or system class loader). If a class loader's parent can load a given class, it returns that class. Otherwise, the class loader attempts to load the class itself.

比如AppClassLoader加载一个类时，会优先让自己的爸爸ExtClassLoader去加载，ExtClassLoader会先交给自己的爸爸BootstrapClassLoader去加载。只有爸爸在他的一亩三分地里没找到时，子classloader再亲自动手从自己的一亩三分地里找。

这么做主要是安全问题：从上到下，类加载的位置越来越宽泛，可信度也越低。比如从用户指定的classpath上加载一个String类，显然没有从jre里加载String类安全。classpath上的String类有可能是一个被修改过的有毒的String类。但是只要classloader先让自己的父classloader加载类，层层委托最终一定会先让BootstrapClassLoader去找String，BootstrapClassLoader一定会从jre里找String，所以一定会加载到真正的String类。而一旦父classloader找到了类，子classloader直接返回该类就行了，一定轮不到classpath里的那个冒牌货。

> jre里能找到的类，就不会去ext里找；ext里能找到的类，就不会去classpath里找。

可以参考IBM的[The parent-delegation model](https://www.ibm.com/support/knowledgecenter/en/SSYKE2_7.1.0/com.ibm.java.lnx.71.doc/diag/understanding/cl_delegation.html)。

关于java类加载顺序，还可以参考[How Classes are Found](https://docs.oracle.com/javase/8/docs/technotes/tools/findingclasses.html)。

在介绍ext类加载方式的文章[Understanding Extension Class Loading](https://docs.oracle.com/javase/tutorial/ext/basics/load.html)里也讲到了类加载顺序。

# ClassLoader体系的实现
现在来看看在代码上又是怎么实现上述具体细节的。

- classloader的抽象父类是ClassLoader，具体的实现类是URLClassLoader；
- ExtClassLoader和AppClassLoader是URLClassLoader的子类，依托于URLClassLoader实现了classloader的功能；
- BootstrapClassLoader并不是使用java写的（要不然用哪个classloader去load它呢？）；

一个一个剖析：

## ClassLoader
ClassLoader是顶级基类，提供了加载一个class的流程：
- `public Class<?> loadClass(String name) throws ClassNotFoundException`：这个方法是classloader的核心方法；

在该方法里，定义了“根据类名加载类”的顺序问题：
1. **cache**：如果该类加载器已经加载过该类名对应的类，直接返回该Class对象；
2. **find class**：否则获取该classloader的parent（父ClassLoader），使用parent加载类；
    1. 如果parent不为空，使用parent去**findClass**；
    2. 如果parent为空，说明该类的父类是BootstrapClassLoader，找到BootstrapClassLoader，让它去**findClass**；
1. 找不到就throw ClassNotFoundException；
2. **resolve class**：找到就**resolve class**，[做一些Class的解析工作](https://docs.oracle.com/javase/specs/jls/se7/html/jls-12.html)，比如符号引用的解析。最终返回Class对象；

因此，**正是`loadClass()`方法实现了classloader的delegation机制。如果我们要自定义一个classloader，如果不是刻意修改掉双亲委派的模型，就不应该override `loadClass()`，而是应该override `findClass()`**，自定义类的查找逻辑即可。

> 事实上ClassLoader父类也将findClass设为protected，交给子类去实现。

一般，load class是从jvm所在的机器上去load的，比如从unix文件系统加载。但也可以从远程加载一个class，只需要子类在实现`findClass`方法时通过网络获取class binary字节码就行了。

## URLClassLoader
URLClassLoader是ClassLoader最常用的一个实现：从URL资源中加载类。

至于URL资源那就很丰富了，可以是本地的，也可以是远程的，具体细节需要参考URL类的实现。

> URL是对资源的封装，指定资源的protocol、host、port、path，相应的URL实现类会根据protocol类型，处理不同资源获取InputStream的细节。比如对于http协议，就要开启一个socket获取资源的InputStream，对于file协议，直接使用系统打开本地文件的方式，获取资源的InputStream。有了InputStream，开发者就可以直接读取资源了，不用关心太多底层细节。

URLClassLoader的javadoc：
> This class loader is used to load classes and resources from a search path of URLs referring to both JAR files and directories. Any URL that ends with a '/' is assumed to refer to a directory. Otherwise, the URL is assumed to refer to a JAR file which will be opened as needed.

URLClassLoader实现`findClass`方法很简单：
```java
    String path = name.replace('.', '/').concat(".class");
    Resource res = ucp.getResource(path, false);
    if (res != null) {
        try {
            return defineClass(name, res);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    } else {
        return null;
    }
```
1. 处理一下要加载的类的名字，从package name转换为文件路径格式的名字；
2. 使用URLClassPath寻找这个类的Resource（binary）；
3. 使用**defindClass**方法，将binary构建为Class对象；

**主要的“寻找”工作都封装在URLClassPath里了**，大致为：
1. URLClassPath根据目标类的名称，从一堆URL里，找到一个匹配项，返回`Resource`；
2. Resource类似于URL类，也是对资源的封装，不过方法更丰富一些。比如`Resource#getBytes()`直接就完成了读取InputStream，返回byte数组的细节；

> URLClassLoader里的URLs怎么来的？或者说URLClassPath里的URLs怎么来的？可以参考ExtClassLoader或者AppClassLoader的实现。

### defineClass
寻找到class二进制之后，要defineClass：解析一坨byte，生成一个Class对象。即，将二进制按照class协议规范去解析，翻译为类定义。**这一步骤最终是由jvm实现的，所以`ClassLoader#defineClass(String name, byte[] b, int off, int len)`是一个native调用**。

## ExtClassLoader
URLClassLoader完成了一个classloader应该有的所有功能。ExtClassLoader和AppClassLoader是两个在URLClassLoader基础上的具体classloader实现。

这两个类需要注意的实现如下：
- 两个类都是单例模式，不让用户自己创建实例。所以类不是public的，而是Launcher类的静态内部类；
- Launcher在构造函数里，调用了两个类的创建方法，创建出了两个类的实例；
- Launcher对外提供了获取AppClassLoader的方法；

Launcher创建ExtClassLoader：
```java
ClassLoader extcl = ExtClassLoader.getExtClassLoader();
```
刨除其他代码，最核心的创建ExtClassLoader的代码为：
```java
    final File[] dirs = getExtDirs();
    int len = dirs.length;
    for (int i = 0; i < len; i++) {
        MetaIndex.registerDirectory(dirs[i]);
    }
    return new ExtClassLoader(dirs);
```
所以ExtClassLoader只传入了`dirs`作为ClassLoader的构造参数，没有传入parent参数，所以它的父ClassLoader指向null，即它的父ClassLoader是BootstrapClassLoader。

> 注意区分**父类（super）**和**父classloader**的区别。**在代码实现上**，ExtClassLoader继承了父类URLClassLoader，但是**在业务逻辑上**，它的父classloader是null（BootstrapClassLoader）

dirs的获取方式在`getExtDirs()`里：
```java
    private static File[] getExtDirs() {
        String s = System.getProperty("java.ext.dirs");
        File[] dirs;
        if (s != null) {
            StringTokenizer st =
                new StringTokenizer(s, File.pathSeparator);
            int count = st.countTokens();
            dirs = new File[count];
            for (int i = 0; i < count; i++) {
                dirs[i] = new File(st.nextToken());
            }
        } else {
            dirs = new File[0];
        }
        return dirs;
    }
```
所以ExtClassLoader检索class的路径就是`java.ext.dirs`指定的位置。

这些路径（File数组）最终会被处理为URL数组，作为构造URLClassLoader的参数：
```java
    /*
     * Creates a new ExtClassLoader for the specified directories.
     */
    public ExtClassLoader(File[] dirs) throws IOException {
        super(getExtURLs(dirs), null, factory);
        SharedSecrets.getJavaNetAccess().
            getURLClassPath(this).initLookupCache(this);
    }
```
如果对怎么把File处理为URL感兴趣，可以看一下`getExtURLs`的内部实现，尤其是`getFileURL(File)`方法：
```java
    static URL getFileURL(File file) {
        try {
            file = file.getCanonicalFile();
        } catch (IOException e) {}

        try {
            return ParseUtil.fileToEncodedURL(file);
        } catch (MalformedURLException e) {
            // Should never happen since we specify the protocol...
            throw new InternalError(e);
        }
    }
```

最终会发现，**每一个文件都通过file协议被封装为一个URL资源：`new URL("file", "", path)`**，这些URLs成为了URLClassPath检索资源的地方。

> 关于URL所支持的file协议，可以参考：https://en.wikipedia.org/wiki/File_URI_scheme

### accessible?
ExtClassLoader唯一的获取方式就是`ExtClassLoader#getExtClassLoader()`，然而由于ExtClassLoader是default权限，只有`sun.misc.Launcher`所在的包`sun.misc`里的类能够访问该方法，我们是不能获取ExtClassLoader的：
```java
ClassLoader extcl = ExtClassLoader.getExtClassLoader();
private ClassLoader loader = AppClassLoader.getAppClassLoader(extcl);
```
Launcher并没有提供外部访问创建好的extcl的方法，所以（这个全局唯一的）ExtClassLoader无法被外部访问。

## AppClassLoader
AppClassLoader的创建流程和ExtClassLoader倒是如出一辙：
```java
    public static ClassLoader getAppClassLoader(final ClassLoader extcl)
        throws IOException
    {
        final String s = System.getProperty("java.class.path");
        final File[] path = (s == null) ? new File[0] : getClassPath(s);

        // Note: on bugid 4256530
        // Prior implementations of this doPrivileged() block supplied
        // a rather restrictive ACC via a call to the private method
        // AppClassLoader.getContext(). This proved overly restrictive
        // when loading  classes. Specifically it prevent
        // accessClassInPackage.sun.* grants from being honored.
        //
        return AccessController.doPrivileged(
            new PrivilegedAction<AppClassLoader>() {
                public AppClassLoader run() {
                URL[] urls =
                    (s == null) ? new URL[0] : pathToURLs(path);
                return new AppClassLoader(urls, extcl);
            }
        });
    }
```
从`java.class.path`获取路径，作为检索class的位置。同时创建AppClassLoader时，将ExtClassLoader作为自己的parent classloader。

这里将File转为URL用了和ExtClassLoader同样的`getFileURL(File)`方法。

Launcher创建完ExtClassLoader之后，**拿ExtClassLoader创建了AppClassLoader**：
```java
ClassLoader extcl = ExtClassLoader.getExtClassLoader();
private ClassLoader loader = AppClassLoader.getAppClassLoader(extcl);
```
**所以ExtClassLoader就是AppClassLoader的parent**。

> **二者是一种逻辑上的组合机制，不是代码结构上的继承，别混淆了**。

### accessible?
和ExtClassLoader不同的是，Launcher对外提供了访问AppClassLoader的方法：
```
    /*
     * Returns the class loader used to launch the main application.
     */
    public ClassLoader getClassLoader() {
        return loader;
    }
```
通过`Launcher#getClassLoader()`可以获得这个全局唯一的AppClassLoader。

## system class loader
由于AppClassLoader使用的场合特别广泛：给定一个类的plain name，就可以使用AppClassLoader从classpath下load该class，获取Class对象，生成class实例。所以ClassLoader提供了一个static方法`getSystemClassLoader`，方便我们获取AppClassLoader：
```java
    public static ClassLoader getSystemClassLoader() {
        initSystemClassLoader();
        if (scl == null) {
            return null;
        }
        SecurityManager sm = System.getSecurityManager();
        if (sm != null) {
            checkClassLoaderPermission(scl, Reflection.getCallerClass());
        }
        return scl;
    }
```
该方法在`initSystemClassLoader`里通过调用`Launcher#getClassLoader()`获取AppClassLoader，然后返回获取到的AppClassLoader。所以所有需要获取AppClassLoader的时候，直接调用`ClassLoader#getSystemClassLoader()`即可。

> AppClassLoader是默认加载所有用户类的类加载器（除非用户自定义了一个classloader，并用该classloader加载类），所以一定要方便获取。

所以system class loader和AppClassLoader指的是同一个classloader：
- https://stackoverflow.com/questions/34650568/difference-between-appclassloader-and-systemclassloader

# ClassLoader创建对象的方式

另一个问题：`Class.forName('x') vs. ClassLoader.getSystemClassLoader().loadClass('x')`，二者都能根据一个类名获取Class，创建对象，有什么区别呢？

`Class#forName`方法是使用调用该方法的类的classloader（一般也是AppClassLoader）去load类x，这点和直接用`ClassLoader#getSystemClassLoader('x')`没什么区别。不过前者在load的时候会初始化Class x的static静态代码块里的代码。后者不会，只有根据Class去newInstance的时候才会初始化static代码块。

参阅：
- https://stackoverflow.com/a/7099453/7676237
- https://stackoverflow.com/a/8100407/7676237

这篇文章总结的比较全面：
- https://javabeat.net/class-forname-classloader-loadclass-difference/


# 自定义classloader

## 为什么要自定义classloader
既然Java已经提供了一套classloader，为什么还要自定义classloader？

显然，Java提供的classloader的功能是强大的，但代码也是写死的。如果开发者有自己独特的需求，显然是要在已提供的classloader的基础上做一些额外的操作的。

Tomcat自定义了自己的类加载器，比如可以做一些优化：类缓存。所有已加载的类都保存起来，防止不用时被垃圾回收掉。下次再需要这些类是就不用再去加载解析类的字节码了。比如可以做一些安全验证：禁止用户加载`javax`开头的包，这样就算用户造了一个假的`javax.servlet.Servlet`类，也不会被Tomcat加载进来。其他比如说类预载入、动态载入等都是一些Java已有的classloader不具备的功能，这些都需要自定义的classloader去实现。

## 怎么自定义ClassLoader
首先肯定是依托URLClassLoader或者ClassLoader类实现自定义的classloader。**一般是override它的`findClass`方法**。

### 自定义一个符合双亲委派的ClassLoader
比如，假设要实现一个从网络获取字节码的classloader，起名为NetworkClassLoader：
```java
   ClassLoader loader = new NetworkClassLoader(host, port);
   Object main = loader.loadClass("Main", true).newInstance();
        . . .
```
NetworkClassLoader可以**使用`ClassLoader#loadClass`去load一个class，该方法是符合双亲委派的。我们只需要在自己内部处理`findClass`的问题**：
```java
     class NetworkClassLoader extends ClassLoader {
         String host;
         int port;

         public Class findClass(String name) {
             byte[] b = loadClassData(name);
             return defineClass(name, b, 0, b.length);
         }

         private byte[] loadClassData(String name) {
             // load the class data from the connection
              . . .
         }
     }
```
这里的findClass可以是通过socket读取一堆字节流，再`defineClass`将字节流解析为Class对象。

### 自定义一个不双亲委派的ClassLoader
**但是，双亲委派机制也是Java 1.2之后才出现的，只是一个推荐，并非强制要求！**

假设我现在有一个很奇怪的需求：工程里所有以"example.classloader"开头的类，都用自定义的classloader加载，其他类都用系统的classloader去加载，且加载每一个类之前都要输出提示，该怎么做？这个需求改变了class load的delegation机制：并不是所有的class都先交给parent去load，如果是"example.classloader"开头的类，自己亲自去load。而这个delegation逻辑是在`loadClass`里实现的，**所以这里必须要override `loadClass`方法**。

```java
public class CustomClassLoader extends ClassLoader {

    private static final String USER_LOADED_PACKAGE_PREFIX = "example.classloader";

    /**
     * Parent ClassLoader passed to this constructor
     * will be used if this ClassLoader can not resolve a
     * particular class.
     *
     * @param parent Parent ClassLoader
     *               (may be from getClass().getClassLoader())
     */
    public CustomClassLoader(ClassLoader parent) {
        super(parent);
    }

    /**
     * Every request for a class passes through this method.
     * If the requested class is in {@link #USER_LOADED_PACKAGE_PREFIX} package,
     * it will load it using the
     * {@link CustomClassLoader#getClass()} method.
     * If not, it will use the super.loadClass() method
     * which in turn will pass the request to the parent.
     *
     * @param name Full class name
     */
    @Override
    public Class<?> loadClass(String name) throws ClassNotFoundException {
        if (name.startsWith(USER_LOADED_PACKAGE_PREFIX)) {
            System.out.println("loading class '" + name + "' by custom classloader: " + CustomClassLoader.class);
            return getClass(name);
        }
        System.out.println("loading class '" + name + "' by papa classloader: " + CustomClassLoader.class.getClassLoader());
        return super.loadClass(name);
    }

    /**
     * Loads a given class from .class file just like
     * the default ClassLoader. This method could be
     * changed to load the class over network from some
     * other server or from the database.
     *
     * @param name Full class name
     */
    private Class<?> getClass(String name) {
        // We are getting a name that looks like
        // a.b.SomeClass and we have to convert it
        // into the .class file name like a/b/SomeClass.class
        String file = name.replace('.', File.separatorChar) + ".class";
        byte[] b;
        try {
            // This loads the byte code data from the file
            b = loadClassData(file);
            // defineClass is inherited from the ClassLoader class
            // and converts the byte array into a Class
            Class<?> c = defineClass(name, b, 0, b.length);
            resolveClass(c);
            return c;
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    /**
     * Loads a given file (presumably .class) into a byte array.
     * The file should be accessible as a resource, for example
     * it could be located on the classpath.
     *
     * @param name File name to load
     * @return Byte array read from the file
     * @throws IOException thrown when there was problem reading the file
     */
    private byte[] loadClassData(String name) throws IOException {
        // Opening the file
        InputStream stream = getClass().getClassLoader().getResourceAsStream(name);
        int size = stream.available();
        byte buff[] = new byte[size];
        DataInputStream in = new DataInputStream(stream);
        // Reading the binary data
        in.readFully(buff);
        in.close();
        return buff;
    }

    /**
     * 在加载{@link Foooo}的时候，{@link Foooo}所依赖的类也将由我们自定义的类加载器加载。
     * 具体来说，在调用{@link ClassLoader#defineClass(String, byte[], int, int)}的时候，
     * 又把{@link Foooo}里面用到的类load了一遍，所以有了{@link Object}、{@link System}和{@link java.io.PrintStream}：
     *
     * Parent of CustomClassLoader:sun.misc.Launcher$AppClassLoader@18b4aac2
     * loading class 'example.classloader.Foooo' by custom classloader: class example.classloader.CustomClassLoader
     * loading class 'java.lang.Object' by papa classloader: sun.misc.Launcher$AppClassLoader@18b4aac2
     * loading class 'java.lang.System' by papa classloader: sun.misc.Launcher$AppClassLoader@18b4aac2
     * loading class 'java.io.PrintStream' by papa classloader: sun.misc.Launcher$AppClassLoader@18b4aac2
     * bar
     * static bar
     *
     * <p>
     * Please note, that if you were about to write a real-world class loader, you would probably extend the URLClassLoader,
     * because the part of loading a class from a file is there already implemented.
     * Also, real class loaders normally ask their parent to load a class BEFORE trying to load it themselves.
     * In our example, for the classes in {@link #USER_LOADED_PACKAGE_PREFIX} package, we do load them without asking the parent.
     */
    public static void main(String[] args) throws Exception {
        CustomClassLoader customClassLoader = new CustomClassLoader(ClassLoader.getSystemClassLoader());
        System.out.println("Parent of CustomClassLoader:" + customClassLoader.getClass().getClassLoader());
        Class<?> classFoo = customClassLoader.loadClass("example.classloader.Foooo");

        // invoke instance method
        Object instance = classFoo.newInstance();
        classFoo.getMethod("bar").invoke(instance);
        // invoke class method
        classFoo.getMethod("staticBar").invoke(null);
    }
}
```
首先需要知道，jvm启动后，load CustomClassLoader的classloader一定是AppClassLoader，所以：
```
System.out.println("Parent of CustomClassLoader:" + customClassLoader.getClass().getClassLoader());
```
可以验证`CustomClassLoader#getClassLoader()`返回的一定是AppClassLoader。

另外，创建CustomClassLoader的时候，传给它的父classloader是`ClassLoader.getSystemClassLoader()`，其实还是AppClassLoader。

> CustomClassLoader有指向AppClassLoader的指针，因为是AppClassLoader加载了它。CustomClassLoader的parent classloader是AppClassLoader，因为创建CustomClassLoader的时候，我们给它的构造函数传递的是AppClassLoader。**这是两件事，不要混为一谈**！

再看`loadClass`方法：如果不以"example.classloader"开头，交给super去读，实际就是交给AppClassLoader去读。如果以"example.classloader"开头，直接自己读了。但它所谓的“自己读”其实很讨巧：`InputStream stream = getClass().getClassLoader().getResourceAsStream(name)`，私底下还是让自己的classloader去读的，所以最终还是交给了AppClassLoader。不过这不重要，重点是所有"example.classloader"开头的类都是通过CustomClassLoader去读的就行了。

# 其他
## Tomcat的classloader

## `Thread#contextClassLoader`
线程的上下文类加载器是在线程创建时由创建线程的线程（即父线程）设置的。

> 线程的上下文类加载器通常是父线程的类加载器，但也可以通过Thread构造函数中的contextClassLoader参数来指定。

为什么要给线程设置个类加载器？

在Java应用程序中，**线程的上下文类加载器通常会被用来加载一些非系统类库的类或资源，例如SPI机制中的服务实现类**。因为服务实现类通常由Java虚拟机提供的扩展类加载器或系统类加载器来加载，这些类加载器并不知道应用程序的类加载器，因此需要使用线程的上下文类加载器来加载应用程序的类或资源。

**即：在线程里放一个AppClassLoader，以加载classpath上的用户类。这样系统类（由高层级ClassLoader比如BootstrapClassLoader加载）就可以去加载classpath上的用户类了。不然用自己的ClassLoader（`Class#getClassLoader()`，即BootstrapClassLoader）加载不了classpath上的类啊**！比如SPI——

> [JDBC与SPI]({% post_url 2021-09-12-jdbc-and-spi %})

假设我们有一个应用程序，它提供一个服务接口com.example.Service，并在classpath中定义了一个META-INF/services目录，目录下有一个文件com.example.Service，其中包含了服务接口的实现类名com.example.impl.ServiceImpl。

现在，我们需要在应用程序中使用这个服务，我们可以通过以下代码来获取服务实例：
```java
ServiceLoader<Service> loader = ServiceLoader.load(Service.class);
for (Service service : loader) {
    service.doSomething();
}
```
在上述代码中，ServiceLoader.load(Service.class)方法会返回一个ServiceLoader对象，它会根据META-INF/services目录中的服务实现类名，动态地加载服务实现类并返回一个可迭代的Service对象集合。

在服务实现类中，如果需要调用应用程序中的类或资源，就需要使用应用程序的类加载器来加载。**但是，服务实现类通常是由Java虚拟机提供的扩展类加载器（ext classloader）或系统类加载器（bootstrap classloader）来加载的，它们并不知道应用程序的类加载器。这时候，就需要使用线程的上下文类加载器来加载应用程序的类或资源**，例如：
```java
Thread.currentThread().getContextClassLoader().getResourceAsStream("config.properties");
```
上述代码中，Thread.currentThread().getContextClassLoader()方法返回线程的上下文类加载器，getResourceAsStream("config.properties")方法会使用该类加载器来加载应用程序的配置文件。这样，服务实现类就可以使用应用程序的类加载器来加载应用程序的类或资源了。

**我们看一下JDK里`ServiceLoader.load(Service.class)`的源代码，确实是用的thread context class loader在加载SPI的实现类**：
```java
    public static <S> ServiceLoader<S> load(Class<S> service) {
        ClassLoader cl = Thread.currentThread().getContextClassLoader();
        return ServiceLoader.load(service, cl);
    }
```

**这其实是对双亲委派机制的一种“破坏”，或者说一种逆向应用——父加载器委托子加载器去加载子加载器才能找到的类**！

> 此处的“破坏”无贬义色彩，仅指不再是纯粹的双亲委派机制。

