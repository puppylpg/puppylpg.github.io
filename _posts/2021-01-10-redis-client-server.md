---
layout: post
title: "Redis - Client & Server"
date: 2021-01-15 01:10:27 +0800
categories: Redis Linux process thread inode fd
tags: Redis Linux process thread inode fd
---

之前总结了server的模型架构，采取nio进行IO多路复用，主要用一个主线程不断进行loop来完成所有的请求处理。那么处理client和server是如何交互的？

1. Table of Contents, ordered
{:toc}

# client在server中的数据表示
**每个与server连接的client，server都为其创建一个对象，保存在redisServer struct中。这些对象使用redisClient struct表示**：
- `list *clients`：用一个数组保存所有连接到该server的client，**数组类型为redisClient struct**；

## 文件描述符
redisClient struct中很重要的一个属性是：
- `int fd`，记录了client正在使用的socket描述符；

socket也是文件，所以socket描述符也是文件描述符，是一个非负整数。

为什么文件描述符是一个数字？数字能表示什么信息？**数字只能表示一个数字，文件那么多信息，一个数字显然不能涵盖。所以它必然类似于指针，指向某个记录着文件信息的东西。**

Linux中的进程使用`struct task_struct`表示，包含：
- `struct files_struct *files`：一个指针，用这个结构体**表示该进程打开的所有文件的信息**。

这个结构体是啥？`struct files_struct`保存着该进程打开的所有的文件信息：
- count：打开的文件数；
- `struct fdtable *fdt`：**文件描述符表**！这个表记录了进程打开的所有文件；

文件描述符表`struct fdtable`：
- `int max_fds`：文件描述符的最大值；
- `struct file **fd`：指针数组，这个数组里都是指针，每个位置都指向`file`。`file`就是文件信息的结构体；

**文件描述符就是这个数组的下标**！！！通过文件描述符这个数字，进程可以找到具体的`file`，进而知道它代表的文件的信息。

比如：
- `open`打开一个文件，返回一个int，就是这个文件描述符；
- `read`/`write`/`close`都需要传入这个int，其实就是根据文件描述符，从数组中取出这个文件的信息，进而操作文件；

程序打开一个文件，**它的文件描述符永远从3开始**。因为这个数组的0已经存了standard input的文件信息，也就是键盘。1和2分别存了standard output和standard error的文件信息，也就是显示器。所以说，键盘和显示器在Linux中也是文件，没有异议吧！

重定向，管道，现在也很好理解了：
```
$ command < file1.txt
```
其实就是command本来要从第0个file也就是键盘读数据，现在从第N个file也就是file1.txt读数据了。读数据来源从数组的一个位置换到了另一个位置而已。

```
$ command1 | command2 | command3
```
管道其实就是进程1的输出不输出到第1个file（显示器），而是输出给第N个file，进程2的输入不是第0个file（键盘），而是第N个file。相当于两个进程之间插了一个管，直接传送输入输出数据。

Ref：
- 很形象，但是对文件描述符表表述有误，过于简单：https://zhuanlan.zhihu.com/p/105086274
- 用代码输出文件描述符：https://zhuanlan.zhihu.com/p/160853278
- https://zhuanlan.zhihu.com/p/34280875

# 附
（正文开始 :D）

编程、理解各种组件，都涉及到os上的很多概念。梳理一下常用的概念。

## 文件描述符 vs. inode - open file vs. disk file
文件描述符是一个数字，进程可以遍历自己打开的所有文件，通过该数字找到文件信息`file`。

### inode
文件系统有最小块block设定，比如4k，读磁盘一次最少读一个block，不然这儿读1byte，那儿读1byte，慢死了……一个文件最少得占用一块，正常会占用很多块。所以需要一个东西记录下来文件所有的metadata，比如这些块在磁盘上的位置。这个东西就是inode。

> inode还会记录下文件owner、权限、ctime/mtime/atime等。

inode放哪儿？也得放磁盘上……那inode岂不也是文件？它如果是文件，文件又需要inode，所以inode又需要inode？套娃？？？

实际上为了防止上述套娃现象，**Linux将磁盘一劈两块，一块放inode，一块放文件**。放文件的那一块才是我们理解的能进行存储的硬盘。放inode的那一块对我们不可见。

一个inode要保存的数据结构是确定的，所以inode要占用的空间也是固定的，比如128byte。

问题来了：两块按照什么样的比例瓜分硬盘空间？

首先，硬盘是用来存文件的。分给inode的部分越大，可用存储空间越小。所以存文件的部分是要远大于存inode的部分的。

但是，如果使劲压榨硬盘的inode部分，比如只分给128k，那么只能创建一个inode，只有一个inode意味着整个硬盘只能存一个文件！即使一个文件并不能占满整个硬盘的文件存储部分，也不能创建第二个文件了。

所以**inode区域分小了，文件可存储的文件数量受限**。inode区域分大了，买个硬盘回来大部分区域都不是用来存文件的，你又该骂奸商了……

这个比例是系统划分的，我们可以计算一下。比如inode大小为256byte，block大小为4kb，inode数量有3932160，block数量有15728384，所以：
- `15728384 * 4kb / 3932160 = 16kb/个`，**系统每16kb分配了一个inode**，也就是说，系统期望每个inode对应16kb空间。如果每个文件大小都是16kb，正好inode和磁盘存储文件的空间同时用完；如果存的是平均大于16kb的文件，inode会剩下；如果存的是平均小于16kb的文件，就算赢盘实际没满，inode用完了，也存不下文件了；
- `3932160 * 256b= `
- inode和文件区域空间占比为960M：60G；

> 可以重新分配inode，比如使用ext4格式去格式化磁盘`mkfs.ext4 - i <bytes-per-inode> <dev>`，具体参考`man mkfs.ext4`：
> - https://chenjiehua.me/linux/linux-ext4fs-disk-inode.html

了解完inode，回到文件描述符。现在明确了，进程中的`file`其实是**所打开的文件在进程（内存）中的一种记录，inode则是文件在disk上的记录**。

- `file`包含inode信息，因为想读写文件，最终还是需要通过inode从disk上读；
- `file`还存了其他信息，比如这个本进程读取该文件的offset。显然读同一个文件，每个进程读到的位置并不相同，这些是需要记录在`file`里的，而不是inode；

Ref：
- https://www.ruanyifeng.com/blog/2011/12/inode.html

## 目录：文件名 vs. inode
目录其实是文件，目录文件。**目录文件的内容可以理解为一个dict，记录着文件名和inode号码的映射**。

所以**inode并不记录也不需要文件名**！对于系统来说，文件是不需要文件名的，只需要告诉它读几号inode就可以了。文件名仅仅是给人看的！

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

## 硬链接
inode是唯一的，文件名不是。多个文件名可以指向一个文件。

**这个道理用dict来理解更直观**：dict的key必须是不同的（不能有相同的文件名），但是value可以是同一个（不同的文件名可以对应同一个inode）。

> inode会记录有多少个文件名指向该文件。

## 进程和线程的区别
在Linux，进程和线程共用了同一个struct：`task_struct`。它有两个重要属性：
- `struct mm_struct *mm`：记录进程的（虚拟）内存结构体；
- `struct fs_struct *fs`：记录进程所有打开的文件信息（文件描述符表）的结构体；

进程和线程的区别在于：
- 线程共用内存，所以**使用`pthread()`创建线程时，两个线程指向同一个`mm`**；进程不公用，所以**使用`fork()`创建进程时，`mm`会被复制一份**。当然之前介绍redis创建子进程的时候说过，进程复制是copy on write，需要写的时候才复制，所以并不是完全复制一个，不会很慢；
- 线程共用文件描述符表，同理进程也是复制一份。

**共享所以节约资源，换句话说，可用的资源少，所以会竞争，所以多线程要加锁啊**！

> 进程和线程都对应到实际代码，形象不？

Ref：
- https://zhuanlan.zhihu.com/p/105086274

## 孤儿进程 vs. 僵尸进程
从`task_struct`的结构可以看出，进程持有一堆资源。当进程退出，资源（fd、memory）会被释放（close会被调用），但仍然会保留基本信息（pid、status）等，**需要父进程使用wait/waitpid手动释放掉这些东西**。

**核心问题**：
- 父进程先于子进程结束了呢？
- 父进程怎么知道子进程结束了呢？

以上两个问题都会导致父进程没法使用wait/waitpid处理残留的子进程信息。

孤儿进程：父进程先挂了，子进程就是孤儿了。没关系，init进程会收留它，并接替原来父进程的工作，使用wait/waitpid在子进程结束后释放子进程的资源。

僵尸进程：子进程结束了，父进程没有那些处理步骤，残余信息永远释放不掉了。

- 子进程**一定会先经过僵尸进程状态**（进程结束后，没有被wait前），然后如果有一个好爸爸，就会彻底消失，如果父进程不wait，就成了永远的僵尸进程；
- 如果父进程先结束，子进程最终一定不会变成僵尸进程，因为init这个新的爸爸一定会处理好子进程；


所以：
- 父进程先于子进程结束了，没问题，不用管；
- 父进程怎么知道子进程结束了呢？**子进程退出时向父进程发送SIGCHILD信号**，父进程处理SIGCHILD信号就行了。

### 危害
僵尸进程的危害很明显：占着pid，时间长了，没法创建新进程了。这不是危言耸听，Linux经常好几年不关机，一天创建几个僵尸进程出来，慢慢就挂了。

### 如何规避
规避方法就是父进程一定要调用waitpid。调用时机有两个：
1. **父进程监听子进程退出信号**。这就涉及到父进程怎么知道子进程结束了的问题。使用`signal`，类似回调函数。父进程接收`SIGCHLD`信号，调用waitpid；
2. **double fork**。父进程fork子进程，子进程fork孙子进程，然后子进程啥也不干，结束。**父进程在子进程结束的代码后面串行调用waitpid**（此时子进程肯定结束了）。至于孙子进程，才是真正干原来的子进程该干的活的进程。它现在已经是孤儿进程，自会有新的爸爸init收留它，跟父进程已经无关了，不用操心了。

### 产生僵尸进程怎么办
生产环境中碰到不断产生的子进程怎么办？一定是因为它的父进程写挫了，找到他的父进程，kill。

Ref:
- https://www.cnblogs.com/Anker/p/3271773.html

