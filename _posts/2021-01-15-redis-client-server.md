---
layout: post
title: "Redis - Client & Server"
date: 2021-01-15 01:10:27 +0800
categories: Redis inode fd
tags: Redis inode fd
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


