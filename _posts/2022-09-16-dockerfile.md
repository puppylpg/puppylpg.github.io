---
layout: post
title: "Dockerfile"
date: 2022-09-16 02:50:28 +0800
categories: docker Linux Debian
tags: docker Linux Debian
---

打一个docker镜像。

1. Table of Contents, ordered
{:toc}

# Dockerfile
Dockerfile规范：
- https://docs.docker.com/engine/reference/builder/

**其实也没几个指令。**

介绍一下常用的几个——

## WORKDIR
设置后续命令的working directory，没有则创建。

> 很像cd和mkdir。

一般打包应用镜像的时候会先设置WORKDIR，比较整洁：
```
WORKDIR /app
```
WORKDING和cd真的很像，支持相对和绝对路径：
```
WORKDIR
Learn more about the "WORKDIR" Dockerfile command.
 /a
WORKDIR b
WORKDIR c
RUN pwd
```
输出为`/a/b/c`。

## ENV
设置全局环境变量，k=v格式：
- https://docs.docker.com/engine/reference/builder/#env

**ENV变量会在容器运行的时候依然存在**，所以和在linux shell里设置环境变量没啥区别。但是ARG变量只在build的时候存在。

**ENV设置的变量可以在`docker run`运行容器的时候使用`--env`或`-e`覆盖掉。**

If an environment variable is only needed during build, and not in the final image, consider setting a value for a single command instead:
```
RUN DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y ...
```
Or using ARG, which is **not persisted in the final image**:
```
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y ...
```

## ARG
`docker build`可以使用`--build-arg <varname>=<value>`覆盖掉ARG变量，相当于build时候的一个占位符。

```
FROM busybox
USER ${user:-some_user}
ARG user
USER $user
# ...
```
A user builds this file by calling:
```
docker build --build-arg user=what_user .
```
## EXPOSE
**仅具有标记作用**：告知容器使用者，开发者打算用哪个端口发布。但并没有发布作用，真要发布还得使用`-p`参数：
- https://docs.docker.com/engine/reference/builder/#expose

> **The EXPOSE instruction does not actually publish the port. It functions as a type of documentation between the person who builds the image and the person who runs the container, about which ports are intended to be published.** To actually publish the port when running the container, use the -p flag on docker run to publish and map one or more ports, or the -P flag to publish all exposed ports and map them to high-order ports.

可以EXPOSE多个：
```
EXPOSE 80 443
```

## ADD vs. COPY
copy文件到镜像里。**如果是压缩包，它拷过去的时候直接就解压了**：
If `<src>` is a local tar archive in a recognized compression format (identity, gzip, bzip2 or xz) then it is unpacked as a directory. 

ADD和COPY有啥区别？ADD比COPY功能强大，毕竟ADD能解压压缩包：
- https://stackoverflow.com/a/24958548/7676237

官方建议，在用不到ADD的额外功能的时候，使用COPY：
- https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#add-or-copy

# RUN
**RUN会执行指令，并给镜像增加一层layer**：The RUN instruction will execute any commands in a new layer on top of the current image and commit the results. The resulting committed image will be used for the next step in the Dockerfile.

# ENTRYPOINT & CMD [exec form]
ENTRYPOINT和CMD指定了：**启动一个容器的时候，运行什么指令**。实际启动的指令，是 **entrypoint + cmd**。

1. 如果entrypoint已经是一个完整的指令，那么cmd可以为空；
2. 反之亦然；
2. **但是如果entrypoint和cmd都为空，就没有可执行命令了，这是不允许的**；
3. **docker有个默认的entrypoint（`/bin/sh -c`），但没有默认的cmd**，显然这是一条不完整的指令，所以仅有默认的entrypoint也是不行的；

**因此Dockerfile里至少指定ENTRYPOINT和CMD中的一个**。

既然二者都可以定义为一条完整的命令，怎么选择用哪一个？主要记住一点：**CMD是比较好覆盖的**，所以：
- 如果是可执行镜像，用ENTRYPOINT；
- CMD应该用作ENTRYPOINT的默认参数，**在运行容器的时候，Dockerfile里指定的默认CMD能很方便地被覆盖掉**；

**`docker run`命令可以指定容器的cmd和args：`docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`，`[COMMAND] [ARG...]`和默认的entrypoint一起，组成执行命令**。
- https://docs.docker.com/engine/reference/commandline/run/

比如，Ubuntu镜像的Dockerfile没指定ENTRYPOINT，指定了`CMD ["bash"]`。那么：
1. 如果运行ubuntu容器的指令带有command和args：
    ```
    > docker run -it ubuntu ls -lhb /
    total 48K
    lrwxrwxrwx   1 root root    7 Sep 21  2021 bin -> usr/bin
    drwxr-xr-x   2 root root 4.0K Apr 15  2020 boot
    drwxr-xr-x   5 root root  360 Sep 15 18:27 dev
    drwxr-xr-x   1 root root 4.0K Sep 15 18:27 etc
    drwxr-xr-x   2 root root 4.0K Apr 15  2020 home
    lrwxrwxrwx   1 root root    7 Sep 21  2021 lib -> usr/lib
    lrwxrwxrwx   1 root root    9 Sep 21  2021 lib32 -> usr/lib32
    lrwxrwxrwx   1 root root    9 Sep 21  2021 lib64 -> usr/lib64
    lrwxrwxrwx   1 root root   10 Sep 21  2021 libx32 -> usr/libx32
    drwxr-xr-x   2 root root 4.0K Sep 21  2021 media
    drwxr-xr-x   2 root root 4.0K Sep 21  2021 mnt
    drwxr-xr-x   2 root root 4.0K Sep 21  2021 opt
    dr-xr-xr-x 222 root root    0 Sep 15 18:27 proc
    drwx------   2 root root 4.0K Sep 21  2021 root
    drwxr-xr-x   5 root root 4.0K Sep 21  2021 run
    lrwxrwxrwx   1 root root    8 Sep 21  2021 sbin -> usr/sbin
    drwxr-xr-x   2 root root 4.0K Sep 21  2021 srv
    dr-xr-xr-x  11 root root    0 Sep 15 18:27 sys
    drwxrwxrwt   2 root root 4.0K Sep 21  2021 tmp
    drwxr-xr-x  13 root root 4.0K Sep 21  2021 usr
    drwxr-xr-x  11 root root 4.0K Sep 21  2021 var
    ```
    相当于手动指定了了一个CMD，`ls -lhb /`，命令为`ls`，两个参数为`-lhb /`。此时Dockerfile里的CMD就会被忽略，最终实际执行的是`/bin/sh -c "ls -lhb /"`。
1. 如果CMD只有command，没有args，比如`docker run -it ubuntu bash`，bash是command，那么实际执行命令为`/bin/sh -c "bash"`。
2. **如果什么都没指定，就会用Dockerfile指定的CMD。所以`docker run -it ubuntu`实际执行的命令还是`/bin/sh -c "bash"`**。

既然CMD可以被覆盖，**entrypoint也可以被覆盖，只不过没有覆盖CMD那么方便：通过docker run的`--entrypoint`参数**，overwrite the default ENTRYPOINT of the image：
- https://stackoverflow.com/a/21564990/7676237

比如：
```
docker run --entrypoint /bin/zsh xxx:1.0.0 -c tree
```
实际执行的是`/bin/zsh -c tree`，而不是`/bin/sh -c "-c tree"`。

> 注意最后的命令一定要使用`-c tree`，才行，`/bin/zsh tree`是直接把tree作为文件读取，而不是把他们当做指令解释。**这也是为什么docker默认的ENTRYPOINT是`/bin/sh -c`，而非`/bin/sh`**。
>
> -c     Take the first argument as a command to execute, rather than reading commands from a script or standard input.  If any further arguments are given, the first one is assigned to $0, rather than being used as a positional parameter.

- 官方也有类似的示例：https://docs.docker.com/engine/reference/run/#entrypoint-default-command-to-execute-at-runtime

## `/bin/sh -c`
sh是什么？在Debian里，它是dash：
```
~ ll `which sh`
lrwxrwxrwx 1 root root 4  8月 18  2021 /bin/sh -> dash
```
dash是POSIX + Berkeley拓展。

`-c`是什么？在上面刚刚提过，**是把后面的字符串（inline script）当命令去解释，并能手动指定inline script的参数`$0`/`$1`**：
```
-c               Read commands from the command_string operand instead of from the standard input.  Special parameter 0 will be set from the command_name operand and the positional parameters
                ($1, $2, etc.)  set from the remaining argument operands.
```

inline script：
```
~ % echo hello > hello.txt

~ % wc hello.txt
1 1 6 hello.txt

~ % wc < hello.txt
1 1 6

~ % sh -c 'wc < ${1}' wtf hello.txt
1 1 6

~ % sh -c 'wc < ${1}' hello.txt wtf
hello.txt: 1: cannot open wtf: No such file

~ % sh -c 'wc < ${1}' hello.txt
hello.txt: 1: cannot open : No such file
```

- https://unix.stackexchange.com/a/152396/283488

## exec form vs. shell form
ENTRYPOINT/CMD/RUN都有两种格式：
- exec格式：`ENTRYPOINT ["executable", "param1", "param2"]`
- shell格式：`ENTRYPOINT <command> <param1> <param2>`，**shell form, the command is run in a shell, which by default is `/bin/sh -c` on Linux**

### shell格式
`ENTRYPOINT <command> <param1> <param2>`

**使用shell格式，所有的指令都会当做一个字符串，交给`sh -c`执行**，ENTRYPOINT使用shell格式最大的影响是：**The shell form prevents any `CMD` or `docker run` command line arguments from being used，用了shell格式就不能再使用任何形式的CMD了，统统无效**。

**对于ENTRYPOINT来说，如果使用shell格式，那么PID 1将会是`/bin/sh`，而非executable。从`docker stop`命令收到SIGTERM的也是shell，但是由于shell不会转发unix信号，所以容器不会停止，直到10s后docker发送SIGKILL强行kill掉shell**：
- https://docs.docker.com/engine/reference/builder/#entrypoint

> This means that the executable will not be the container’s PID 1 - and will not receive Unix signals - so your executable will not receive a SIGTERM from docker stop <container>.

使用rancher之后，其表现就是重启pod的时候，docker stop不能让pod立刻停止，需要10s之后才能启停pod。

### exec格式
`ENTRYPOINT ["executable", "param1", "param2"]`

> **exec格式传的是一个json array**，所以必须用双引号而非单引号。

exec格式直接执行executable，而且不用解析字符串了。**只有使用exec form，才能在后面拼接CMD**。

另外Unlike the shell form, the exec form does not invoke a command shell，所以：
- **没法解释shell变量**，比如`$HOME`（~~但是能解释`ENV`定义的变量，比如`$XXX`~~，也不能解释ENV变量）；
- **没法使用shell相关的功能**：sub commands, piping output, chaining commands, I/O redirection, and more
- **不再是sh fork出的子进程**；

pid=1的就是命令本身，而不是`/bin/sh`。

> CMD还有第三种格式：`CMD ["param1", "param2"]` (as default parameters to ENTRYPOINT)，直接作为ENTRYPOINT的参数。

### 终极指南
entrypoint + cmd的组合示例（**ENTRYPOINT和CMD都选用exec形式**）文档：
- https://docs.docker.com/engine/reference/builder/#understand-how-cmd-and-entrypoint-interact

其中很明确表明：**ENTRYPOINT采用shell格式的时候，就没有CMD的事儿了**。

> 另外，如果当前image设置了ENTRYPOINT，base image的CMD会被清空。

### 格式选择
所以：
- RUN：选shell form；
- ENTRYPOINT和CMD：
    + 优先选exec form；
    + 如果需要使用变量，使用shell form；

## 一个示例：ENTRYPOINT/CMD
示例来自 **一个失败的Dockerfile**，但或许是解释ENTRYPOINT和CMD更好的方式。

一开始以为`JAVA_OPTS`可以在执行的时候起到作用，所以写了下面的Dockerfile：
```
ENV JAVA_OPTS="-Xms2048m -Xmx8192m verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution -Xloggc:gc.log.%t"

ENTRYPOINT ["java", "org.springframework.boot.loader.JarLauncher"]
```
**但实际上，`JAVA_OPTS`并非标准的java environment variable，所以设置了之后什么用也没有**。相当于仅仅执行了`java org.springframework.boot.loader.JarLauncher`。

对于这个镜像，如果想增加debug参数，在rancher覆盖`JAVA_OPTS`变量并没有任何作用，因为这个变量并没有被用到。

### override ENTRYPOINT
如果真的想对这个镜像debug，执行的时候可以覆盖entrypoint，以达到debug的目的：
> java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=9327 org.springframework.boot.loader.JarLauncher

完全覆盖Dockerfile里的命令，另起炉灶。

### exec form不替换变量
既然JAVA_OPTS变量没什么作用，如果想使用这些jvm变量，就要把变量放到java指令后面。于是修改Dockerfile，把参数放进去：
```
ENV JVM_ARGS="-Xms2048m -Xmx8192m -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution -Xloggc:gc.log.%t"

ENTRYPOINT ["java", "$JVM_ARGS", "org.springframework.boot.loader.JarLauncher"]
```
这样打出来的镜像启动直接报错：
```
错误: 找不到或无法加载主类 $JVM_ARGS
```
说明`$JVM_ARGS`根本没被替换为真正的jvm参数，而是把它当做了字面量：**ENTRYPOINT不替换变量！只有shell会替换！**

### shell form会替换变量
把上面的的exec form换成shell form就行了：
```
ENV JVM_ARGS="-Xms2048m -Xmx8192m -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution -Xloggc:gc.log.%t"

ENTRYPOINT java $JVM_ARGS org.springframework.boot.loader.JarLauncher
```

> 把ENTRYPOINT换成CMD也是可以的。

想debug的时候，rancher设置JVM_ARGS变量就行了：
```
JVM_ARGS = -Xms2048m -Xmx8192m -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution -Xloggc:gc.log.%t -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=9327
```

因为用了shell form，所以容器里java的pid就不是1了：
```
➜  /app jps -m
7 JarLauncher
93 Jps -m
```
pid=7，且参数确实作为VM Flags了：
```
➜  /app jinfo 7     
Attaching to process ID 7, please wait...
Debugger attached successfully.
Server compiler detected.
JVM version is 25.202-b08
Java System Properties:

java.runtime.name = Java(TM) SE Runtime Environment
java.vm.version = 25.202-b08
sun.boot.library.path = /usr/java/jdk1.8.0_202/jre/lib/amd64
java.vendor.url = http://java.oracle.com/
java.vm.vendor = Oracle Corporation
path.separator = :
file.encoding.pkg = sun.io
java.vm.name = Java HotSpot(TM) 64-Bit Server VM
sun.os.patch.level = unknown
sun.java.launcher = SUN_STANDARD
user.country = CN
user.dir = /app
java.vm.specification.name = Java Virtual Machine Specification
PID = 7
java.runtime.version = 1.8.0_202-b08
java.awt.graphicsenv = sun.awt.X11GraphicsEnvironment
os.arch = amd64
java.endorsed.dirs = /usr/java/jdk1.8.0_202/jre/lib/endorsed
CONSOLE_LOG_CHARSET = UTF-8
line.separator = 

java.io.tmpdir = /tmp
java.vm.specification.vendor = Oracle Corporation
os.name = Linux
FILE_LOG_CHARSET = UTF-8
sun.jnu.encoding = UTF-8
java.library.path = /usr/java/packages/lib/amd64:/usr/lib64:/lib64:/lib:/usr/lib
spring.beaninfo.ignore = true
java.specification.name = Java Platform API Specification
java.class.version = 52.0
sun.management.compiler = HotSpot 64-Bit Tiered Compilers
os.version = 5.4.139-1.el8.elrepo.x86_64
user.home = /root
user.timezone = Asia/Shanghai
java.awt.printerjob = sun.print.PSPrinterJob
file.encoding = UTF-8
java.specification.version = 1.8
user.name = root
java.class.path = .
java.vm.specification.version = 1.8
sun.arch.data.model = 64
sun.java.command = org.springframework.boot.loader.JarLauncher
java.home = /usr/java/jdk1.8.0_202/jre
user.language = zh
java.specification.vendor = Oracle Corporation
awt.toolkit = sun.awt.X11.XToolkit
java.vm.info = mixed mode
java.version = 1.8.0_202
java.ext.dirs = /usr/java/jdk1.8.0_202/jre/lib/ext:/usr/java/packages/lib/ext
sun.boot.class.path = /usr/java/jdk1.8.0_202/jre/lib/resources.jar:/usr/java/jdk1.8.0_202/jre/lib/rt.jar:/usr/java/jdk1.8.0_202/jre/lib/sunrsasign.jar:/usr/java/jdk1.8.0_202/jre/lib/jsse.jar:/usr/java/jdk1.8.0_202/jre/lib/jce.jar:/usr/java/jdk1.8.0_202/jre/lib/charsets.jar:/usr/java/jdk1.8.0_202/jre/lib/jfr.jar:/usr/java/jdk1.8.0_202/jre/classes
java.awt.headless = true
java.vendor = Oracle Corporation
file.separator = /
java.vendor.url.bug = http://bugreport.sun.com/bugreport/
sun.io.unicode.encoding = UnicodeLittle
sun.cpu.endian = little
sun.cpu.isalist = 

VM Flags:
Non-default VM flags: -XX:CICompilerCount=3 -XX:InitialHeapSize=2147483648 -XX:MaxHeapSize=8589934592 -XX:MaxNewSize=2863136768 -XX:MinHeapDeltaBytes=524288 -XX:NewSize=715653120 -XX:OldSize=1431830528 -XX:+PrintAdaptiveSizePolicy -XX:+PrintGC -XX:+PrintGCDateStamps -XX:+PrintGCDetails -XX:+PrintGCTimeStamps -XX:+PrintTenuringDistribution -XX:+UseCompressedClassPointers -XX:+UseCompressedOops -XX:+UseFastUnorderedTimeStamps -XX:+UseParallelGC 
Command line:  -Xms2048m -Xmx8192m -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution -Xloggc:logs/gc.log.%t -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=9327
```

这是使用`CMD java $JVM_ARGS org.springframework.boot.loader.JarLauncher`时的进程示例，jvm pid=8：
```
➜  /app ps aux 
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.0   1072    76 pts/0    Ss   12月22   0:04 /sbin/docker-init -- /bin/sh -c java $JVM_ARGS org.springframework.boot.loader.JarLauncher
root           7  0.0  0.0   2484   168 pts/0    S+   12月22   0:00 /bin/sh -c java $JVM_ARGS org.springframework.boot.loader.JarLauncher
root           8  3.4  0.4 37387940 2549672 pts/0 Sl+ 12月22 204:02 java -Xms256m -Xmx4096m -XX:+UseG1GC -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution -Xloggc:logs/gc.log.%t org.springframework.boot.loader.JarLauncher
```

# `docker run` vs. `docker exec`
二者格式类似：
- `docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`
- `docker exec [OPTIONS] CONTAINER COMMAND [ARG...]`

**run的对象是镜像IMAGE，exec的对象是容器CONTAINER，而且容器必须已经启动了才能执行exec**：The command started using docker exec only runs while the container's primary process (PID 1) is running, and it is not restarted if the container is restarted.

run和entrypoint组合使用，而且可以不指定command，因为有了CMD作为默认值。但是exec必须指定command，而且应该是一个executable，**它不和entrypoint配合使用，没有entrypoint的概念**。

# 打一个基础镜像
打包一个尽量小，但功能比较全的jdk8和maven镜像，添加一些好用的日志查看和问题诊断工具，比如`zsh`/`which`/`ip`/`less`等。

所以打了一个基础镜像，内容包括：
- java1.8.0_202, maven；
- 常用诊断工具，比如ping/ps/htop/ip等；
- 常用文件操作工具：less/vim/nano/tree等；
- 高效使用linux：**zsh及[oh-my-zsh](https://ohmyz.sh/)**，tmux等；
- 默认东八区；

现在bullseye已经没法默认安装jdk8了，最低也是jdk11（**所以该升级jdk了！！！**），所以自己下载一个jdk，比如`jdk-8u202-linux-x64.tar.gz`，手动添加到镜像里。


# 构建Dockerfile
```
FROM debian:bullseye
LABEL maintainer="puppylpg"
LABEL version="1.0.0"
LABEL description="Debian image for puppylpg, with jdk8 and maven. Many useful tools even zsh & oh-my-zsh are also included."

# 时区
ENV TZ=Asia/Shanghai

# java
ADD jdk-8u202-linux-x64.tar.gz /usr/java/
ENV JAVA_HOME=/usr/java/jdk1.8.0_202
ENV PATH=$JAVA_HOME/bin:$PATH

# 依赖
RUN apt update && apt install --no-install-recommends --yes htop zsh iproute2 less vim curl wget nano net-tools procps git tmux tree apt-transport-https ca-certificates locales iputils-ping

# 设置locale，防止zsh自动补全提示重复出现
# https://github.com/sindresorhus/pure/issues/300#issuecomment-386371460
# https://github.com/ohmyzsh/ohmyzsh/issues/7426#issuecomment-632832807
# https://unix.stackexchange.com/a/669735/283488
RUN sed -i 's/^# *\(zh_CN.UTF-8\)/\1/' /etc/locale.gen && locale-gen
ENV LC_CTYPE=zh_CN.UTF-8 LANG=zh_CN.UTF-8

# 安装zsh
COPY oh-my-zsh.sh .
RUN chmod +x oh-my-zsh.sh && ./oh-my-zsh.sh "" --unattended && rm oh-my-zsh.sh

CMD ["zsh"]
```

# oh-my-zsh
oh-my-zsh大概是里面最难装的（其实可以直接装fish，好像就不用配置了，对于在容器里执行命令够用了）。

本来omz应该这么装：
```
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```
但是不知为何脚本没法执行，所以索性`curl https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh`下载到本地，再添加到镜像里执行。

# TZ & Locale
timezone和locale其实是两个概念，之前没有仔细区分，混淆的原因大概就是locale也有日期格式的概念：
- 时区决定把epoch milli显示为几点；
- locale是一些常见领域的显示格式，包括时间格式；

二者是不冲突的。比如我生活在东八区，按照`zh_CN.UTF-8`显示日期。如果我搬到了西八区，仍然可以按照`zh_CN.UTF-8`显示日期。而原本生活在西八区的老外时区也是西八区，但是locale可能设置为`en_US.UTF-8`。

> 我们时间是一样的，只是显示格式不一样。

Debian wiki很好的解释了locale：
- https://wiki.debian.org/Locale

locale本质就是环境变量。支持locale的程序会读取这些环境变量，然后决定自己的行为。

locale设计多方面规范，常用的：
- `LC_TIME`：date and time格式；
- `LC_CTYPE`：Character classification and case conversion；
- **`LANG`：其他locale没设置时的默认值**；
- **`LC_ALL`：override所有locale**；

比如：
```
~ echo $LANG
en_US.UTF-8

~ date
Fri Sep 16 00:09:34 CST 2022
```
换locale：
```
~ LANG=zh_CN.UTF_8 date
2022年 09月 16日 星期五 00:11:28 CST
```

## locale不存在
但是前提是`zh_CN.UTF_8`这个locale必须已经装到电脑上了，否则设置为一个不存在的locale，没任何作用：
```
~ LANG=zh_CN.UTF_8 date
Fri Sep 16 00:09:46 CST 2022
```

可以查看当前已安装的locale：
```
~ locale -a
C
C.UTF-8
POSIX
en_US.utf8
```

## 安装locale
缺哪个就生成哪个：
```
~ sudo sed -i 's/^# *\(zh_CN.UTF-8\)/\1/' /etc/locale.gen && sudo locale-gen
[sudo] password for win-pichu:
Generating locales (this might take a while)...
  en_US.UTF-8... done
  zh_CN.UTF-8... done
Generation complete.
```

如果懒省事儿，Debian提供了`locale-all`，可以直接安装所有的locale：
```
$ apt install locales-all
```
但是这样会多占用大概200M+空间，对于docker镜像来说，这样做显然不合理。

## oh-my-zsh & locale
设置locale，是为了防止zsh自动补全提示重复出现：
- https://github.com/sindresorhus/pure/issues/300#issuecomment-386371460
- https://github.com/ohmyzsh/ohmyzsh/issues/7426#issuecomment-632832807
- https://unix.stackexchange.com/a/669735/283488

# 打包发布镜像
本地打包镜像：
```
$ VERSION=<你的版本>

# build，打一个本地的tag（也可以直接打harbor的tag）
$ docker build -t puppylpg-base:${VERSION} -t puppylpg-base:latest .

# 添加一个版本tag，一个latest tag，用于上传到harbor
$ docker tag puppylpg-base:${VERSION} <private docker hub>/puppylpg/puppylpg-base:${VERSION}
$ docker tag puppylpg-base:${VERSION} <private docker hub>/puppylpg/puppylpg-base:latest

# 或者直接在build的时候就打harbor的tag
$ docker build -t <private docker hub>/puppylpg/puppylpg-base:${VERSION} -t <private docker hub>/puppylpg/puppylpg-base:latest .
```

**本地测试镜像**：
```
$ docker run -it puppylpg-base
```
进入镜像测试新加功能是否可用。

上传镜像：
```
$ docker login http://<private docker hub>

$ docker push <private docker hub>/puppylpg/puppylpg-base:${VERSION}
$ docker push <private docker hub>/puppylpg/puppylpg-base:latest
```

## 镜像大小
镜像746MB，主要集中在：
- jdk：~400MB（只安装jre ~230MB，但是少了一些工具，感觉没必要）；
- `/usr/lib`：~100MB；
- `/usr/share`各种工具：~200MB；
```
➜  / du -h / | sort -hr| head -20
756M    /
698M    /usr
389M    /usr/java/jdk1.8.0_202
389M    /usr/java
225M    /usr/java/jdk1.8.0_202/jre
224M    /usr/java/jdk1.8.0_202/jre/lib
178M    /usr/share
136M    /usr/java/jdk1.8.0_202/lib
121M    /usr/java/jdk1.8.0_202/jre/lib/amd64
94M     /usr/lib
70M     /usr/lib/x86_64-linux-gnu
60M     /usr/java/jdk1.8.0_202/lib/missioncontrol
54M     /usr/java/jdk1.8.0_202/lib/missioncontrol/plugins
50M     /usr/share/locale
35M     /usr/share/vim/vim82
35M     /usr/share/vim
34M     /usr/java/jdk1.8.0_202/lib/visualvm
26M     /var
26M     /usr/java/jdk1.8.0_202/jre/lib/ext
26M     /usr/bin
```

# springboot Dockerfile
springboot开发的Java项目，Dockerfile非常好写。

虽然可以使用springboot提供的spring-boot-maven-plugin把项目打包为可执行jar，然后直接run jar：
```
FROM openjdk:8-jdk-alpine
EXPOSE 8080
ARG JAR_FILE=target/demo-app-1.0.0.jar
ADD ${JAR_FILE} app.jar
ENTRYPOINT ["java","-jar","/app.jar"]
```
但是spring-boot-maven-plugin对这个可执行jar提供了更进一步的支持，可以打出一个 **layered runnable jar**：
```
                <!-- 分layer打包spring boot项目 -->
                <plugin>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-maven-plugin</artifactId>
                    <configuration>
                        <layers>
                            <enabled>true</enabled>
                        </layers>
                    </configuration>
                    <executions>
                        <execution>
                            <goals>
                                <goal>repackage</goal>
                            </goals>
                        </execution>
                    </executions>
                </plugin>
```
分层有什么好处？**分层打出来的jar，依赖、snapshot依赖、springboot loader、项目代码各成一层，基本上依赖和springboot loader这两层是不会变的，所以多次打docker镜像的情况下，这两层可以一直复用！**

> springboot可谓把善于观察做到了极致！

此时再写Dockerfile，我们只需要把layered jar拆开（`java -Djarmode=layertools -jar ${TARGET_FILE} extract`），每一层分别打包为docker image的一个layer即可：
```
FROM harbor-registry.inner.youdao.com/ead/overseas-base:latest as builder

# 本地提前repackage好
ARG JAR_FILE=target/url-mapper-*.jar
ARG TARGET_FILE=app.jar
COPY ${JAR_FILE} ${TARGET_FILE}
RUN java -Djarmode=layertools -jar ${TARGET_FILE} extract

FROM harbor-registry.inner.youdao.com/ead/overseas-base:latest
LABEL maintainer="liuhaibo@rd.netease.com"
WORKDIR /app

COPY --from=builder dependencies/ ./
COPY --from=builder snapshot-dependencies/ ./
COPY --from=builder spring-boot-loader/ ./
COPY --from=builder application/ ./

RUN mkdir logs

EXPOSE 9326 8080

ENV JVM_ARGS="-Xms256m -Xmx4096m -XX:+UseG1GC -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintAdaptiveSizePolicy -XX:+PrintTenuringDistribution -Xloggc:logs/gc.log.%t"

CMD java $JVM_ARGS org.springframework.boot.loader.JarLauncher
```

> 甚至还用到了docker image的多阶段build！

参考：
- https://www.baeldung.com/spring-boot-docker-images


