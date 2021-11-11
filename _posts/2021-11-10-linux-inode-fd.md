---
layout: post
title: "Linux - inode与文件描述符"
date: 2021-11-10 20:46:42 +0800
categories: Linux inode fd
tags: Linux inode fd
---

编程、理解各种组件的一些原理（比如redis），都涉及到os上的很多概念。梳理一下常用的概念。

1. Table of Contents, ordered
{:toc}

# inode
## 是什么
文件系统有最小块block设定，比如4k，读磁盘一次最少读一个block，不然这儿读1byte，那儿读1byte，慢死了……一个文件最少得占用一块，正常会占用很多块。所以需要一个东西记录下来文件所有的metadata，比如这些块在磁盘上的位置。这个东西就是inode。

> inode还会记录下文件owner、权限、ctime/mtime/atime等。

## 放哪儿
inode放哪儿？也得放磁盘上……那inode岂不也是文件？它如果是文件，文件又需要inode，所以inode又需要inode？套娃？？？

实际上为了防止上述套娃现象，**Linux将磁盘一劈两块，一块放inode，一块放文件**。放文件的那一块才是我们理解的能进行存储的硬盘。放inode的那一块对我们不可见。

一个inode要保存的数据结构是确定的，所以inode要占用的空间也是固定的，比如128byte。

问题来了：两块按照什么样的比例瓜分硬盘空间？

首先，硬盘是用来存文件的。分给inode的部分越大，可用存储空间越小。所以存文件的部分是要远大于存inode的部分的。

但是，如果使劲压榨硬盘的inode部分，比如只分给128k，那么只能创建一个inode，只有一个inode意味着整个硬盘只能存一个文件！即使一个文件并不能占满整个硬盘的文件存储部分，也不能创建第二个文件了。

所以**inode区域分小了，文件可存储的文件数量受限**。inode区域分大了，买个硬盘回来大部分区域都不是用来存文件的，你又该骂奸商了……

这个比例是系统划分的，我们可以计算一下。比如inode大小为256byte，block大小为4kb，inode数量有3932160，block数量有15728384，所以：
- `15728384 * 4kb / 3932160 = 16kb/个`，**系统每16kb分配了一个inode**，也就是说，系统期望每个inode对应16kb空间。如果每个文件大小都是16kb，正好inode和磁盘存储文件的空间同时用完；如果存的是平均大于16kb的文件，inode会剩下；如果存的是平均小于16kb的文件，就算硬盘实际没满（硬盘的文件存储区域还有空间），inode用完了，也存不下文件了；
- `3932160 * 256b= 960M`，inode占用硬盘960M空间，同理，文件区域空间为60G；

> 可以重新分配inode，比如使用ext4格式去格式化磁盘`mkfs.ext4 - i <bytes-per-inode> <dev>`，具体参考`man mkfs.ext4`：
> - https://chenjiehua.me/linux/linux-ext4fs-disk-inode.html

Ref：
- https://www.ruanyifeng.com/blog/2011/12/inode.html

# 文件描述符（opened file） vs. inode（disk file）
**文件描述符是一个数字**，进程可以遍历自己打开的所有文件，通过该数字找到文件信息`file`。

进程中的`file`其实是**所打开的文件在进程（内存）中的一种记录，inode则是文件在disk上的记录**。

- `file`是个运行时数据结构，包含inode信息，因为想读写文件，最终还是需要通过inode从disk上读；
- `file`还存了其他信息，比如这个本进程读取该文件的offset。显然读同一个文件，每个进程读到的位置并不相同，这些是需要记录在`file`数据结构里的，而不是inode；

# 目录和文件名
目录其实也是文件，目录文件。

**目录文件的内容可以理解为一个dict，记录着文件名和inode号码的映射**。

所以**inode并不记录也不需要文件名**！对于系统来说，文件是不需要文件名的，只需要告诉它读几号inode就可以了。文件名仅仅是给人看的！

> 就好像文件名是inode number的alias一样。

如果对目录文件有只有r权限，**可以读取目录文件的内容（也就是看目录下有哪些文件）**，可以看到他们的文件名，但是**无法获取其他信息（比如文件的权限、修改日期）**，因为其他信息都是从inode里获取的。**想读取inode信息需要x权限**。

比如，有一个hello文件夹，下面有一个world.txt：
```
win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> ll
total 0
drwxr-xr-x 1 win-pichu win-pichu 512 Jan 15 00:32 hello

win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> ll hello
total 0
-rw-r--r-- 1 win-pichu win-pichu 13 Jan 15 00:32 world.txt
```
因为对hello目录文件有r和x权限，所以可以获取hello目录文件记录的world文件的inode信息，进而获取其内容：
```
win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> cat hello/world.txt
pikapika
```
去掉用户在hello目录文件的x权限：
```
win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> chmod -x hello

win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> ll
total 0
drw-r--r-- 1 win-pichu win-pichu 512 Jan 15 00:32 hello
```
只能看到hello目录文件记录了一个world.txt的文件，但是它的信息不明，不知道它的权限、大小、修改日期等（都记录在inode里）：
```
win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> ll hello
ls: cannot access 'hello/world.txt': Permission denied
total 0
-????????? ? ? ? ?            ? world.txt
```

> 所以说`ls -l`的内容都记录在inode里！

自然也看不了world.txt的内容（需要读取inode，获取其在磁盘上的位置，才能读出其内容）：
```
win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> cat hello/world.txt
cat: hello/world.txt: Permission denied
```
如果现在把r权限也删了：
```
win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> chmod -r hello

win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> ll
total 0
d-w------- 1 win-pichu win-pichu 512 Jan 15 00:32 hello
```
连读hello目录文件的权限都没了，自然不知道都有哪些子文件（不知道记录了哪些文件名到inode的映射）：
```
win-pichu@DESKTOP-T467619:/tmp/liuhaibo
> ll hello
ls: cannot open directory 'hello': Permission denied
```
现在觉得，**`ls -li`才是读取完整目录文件内容的方法**，既显示文件名，又显示它的inode的信息：
```
> ls -li hello
total 0
14918173766753660 -rw-r--r-- 1 win-pichu win-pichu 13 Jan 15 00:32 world.txt
```

> 不如以后用`ls -lhbi`，哈哈哈

# 硬链接
inode是唯一的，文件名不是。多个文件名可以指向一个文件。

**这个道理用dict来理解更直观**：dict的key必须是不同的（不能有相同的文件名），但是value可以是同一个（不同的文件名可以对应同一个inode）。

> inode会记录有多少个文件名指向该文件。



