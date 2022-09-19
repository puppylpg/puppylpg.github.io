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

# RUN（shell form） vs. CMD（exec form） vs. ENTRYPOINT（exec form）
都是执行命令，但意义不同。且都有两种格式：
- shell格式：`RUN <command>` (**shell form, the command is run in a shell, which by default is `/bin/sh -c` on Linux**)
- exec格式：`RUN ["executable", "param1", "param2"]` (exec form)

## shell格式
`RUN <command>`

**使用shell格式，所有的指令都会当做一个字符串，交给`sh -c`执行。**


### `sh -c`
sh是什么？在Debian里，它是dash：
```
~ ll `which sh`
lrwxrwxrwx 1 root root 4  8月 18  2021 /bin/sh -> dash
```
dash是POSIX + Berkeley拓展。

`-c`是什么？**是把后面的字符串（inline script）当命令去解释，并能手动指定inline script的参数`$0`/`$1`**：
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

## exec格式
`RUN ["executable", "param1", "param2"]`

> **exec格式传的是一个json array**，所以必须用双引号而非单引号。

exec格式直接执行executable，而且不用解析字符串了。它最大的作用就是 **Unlike the shell form, the exec form does not invoke a command shell**，所以：
- **没法解释shell变量**，比如`$HOME`（但是能解释`ENV`定义的变量，比如`$XXX`）；
- **没法使用shell相关的功能**：sub commands, piping output, chaining commands, I/O redirection, and more
- **不再是sh fork出的子进程**；

最后一点比较重要。**对于ENTRYPOINT来说，如果使用shell格式，那么PID 1将会是`/bin/sh`，而非executable。从`docker stop`命令收到SIGTERM的也是shell，但是由于shell不会转发unix信号，所以容器不会停止，直到10s后docker发送SIGKILL强行shell**：
- https://docs.docker.com/engine/reference/builder/#entrypoint

> This means that the executable will not be the container’s PID 1 - and will not receive Unix signals - so your executable will not receive a SIGTERM from docker stop <container>.

## 格式选择
所以：
- RUN：选shell form；
- ENTRYPOINT和CMD选exec form；

## RUN
**RUN会执行指令，并给镜像增加一层layer**：The RUN instruction will execute any commands in a new layer on top of the current image and commit the results. The resulting committed image will be used for the next step in the Dockerfile.

## CMD vs. ENTRYPOINT
对于一个executable container，**entrypoint + cmd构成了容器的执行命令**。

**docker有个默认的entrypoint（`/bin/sh -c`），但没有默认的cmd**，可以在Dockerfile里通过CMD指定。

**`docker run`命令可以指定容器的cmd和args**：`docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`，和默认的entrypoint一起，组成执行命令。
- https://docs.docker.com/engine/reference/commandline/run/

比如，**同时指定了command和args**：
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
实际执行的是`/bin/sh -c "ls -lhb /"`

**只指定了command**，比如`docker run -it ubuntu bash`，bash是command，实际执行命令为`/bin/sh -c bash`。

**在run的时候没指定command**，如果Dockerfile指定了CMD，就会用CMD指定的command。比如ubuntu镜像设置了`CMD ["bash"]`，所以`docker run -it ubuntu`实际执行的命令还是`/bin/sh -c bash`。

既然command可以设置默认值CMD，也可以自己指定，**那么entrypoint也可以自己指定：通过docker run的`--entrypoint`参数**，overwrite the default ENTRYPOINT of the image：

- https://stackoverflow.com/a/21564990/7676237

比如：
```
docker run --entrypoint /bin/zsh xxx:1.0.0 -c tree
```
注意最后的命令一定要使用`-c tree`，`/bin/zsh -c tree`才行，`/bin/zsh tree`是直接把tree作为文件读取
> -c     Take the first argument as a command to execute, rather than reading commands from a script or standard input.  If any further arguments are given, the first one is assigned to $0, rather than being used as a positional parameter.

- 在官方示例也能看到这一点：https://docs.docker.com/engine/reference/run/#entrypoint-default-command-to-execute-at-runtime

entrypoint + cmd的组合示例（**ENTRYPOINT和CMD都选用exec形式**）：
- https://docs.docker.com/engine/reference/builder/#understand-how-cmd-and-entrypoint-interact

> CMD还有第三种格式：`CMD ["param1","param2"]` (as default parameters to ENTRYPOINT)，直接作为ENTRYPOINT的参数。

# `docker run` vs. `docker exec`
二者格式类似：
- `docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`
- `docker exec [OPTIONS] CONTAINER COMMAND [ARG...]`

run的对象是镜像IMAGE，exec的对象是容器CONTAINER，而且容器必须已经启动了才能执行exec：The command started using docker exec only runs while the container’s primary process (PID 1) is running, and it is not restarted if the container is restarted.

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
