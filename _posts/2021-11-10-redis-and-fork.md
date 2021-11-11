---
layout: post
title: "redis与linux fork"
date: 2021-11-10 20:44:57 +0800
categories: Redis fork Linux
tags: Redis fork Linux
---

Redis进程的fork并不会导致redis内存占用量翻倍，需要深入了解一下fork。

1. Table of Contents, ordered
{:toc}

# redis and linux `fork()`
`fork()`在parent process里返回child process的pid，在child process里返回0，如果失败返回-1，比如父进程内存占用量超出系统剩余内存，就不足以fork出一个子进程来，会失败返回-1。

那岂不是意味着**部署redis的机器内存使用量不能超过一半，不然redis就启动不了后台进程了？**

是的！

但内存复制并不是简单的copy一份，让内存占用double：
1. 上古Unix的fork()实现，的确是让子进程整个复制一遍父进程的地址空间；
2. 但现代操作系统都不会傻傻复制一遍，子进程的结构是要创建的，但是内存占用只需要指向父进程的内存空间就行了。从os的层面来讲，内存是一页页的，页表就是指向页的指针，所以子进程“将指针指向父进程的内存”本质上就是**复制一份父进程的页表**。也就是说，**子进程和父进程本质上共享一份内存**，所以**fork实际上并不会导致内存占用被double**，实际上，无论父进程内存占用多大，子进程**真正占用**的内存特别小；
3. 但是新的问题来了，父子进程本不该共享内存的！他们**逻辑上**应该是互相独立的内存空间，各自修改自己的内存内容。如果**实现上**为了节省内存，用了共享的空间，逻辑上怎么保证二者是独立的？
4. copy on write！新的fork使用了copy on write，写时复制，即子进程需要写内存的时候，把**这块内存**复制一份，写入复制后的区域，并让子进程指向新的区域。其他没变的内存区域继续共享。从os层面来讲，这块内存对应的是某一页或某几页，复制后，让子进程的页表指向新的页就行了。所以，**通过copy on write，逻辑上父子进程的内存区域是完全分离且相同的内容，但实现上又做到了fork一个子进程也并不会让内存double**；
5. 但是，如果redis进程占用系统内存50%+，依然会fork失败！copy on write只是缓解了内存占用，但是最不理想的情况下，如果子进程需要把copy出的所有父进程内存全都修改一遍，copy on write的结果其实也是子进程要完全开辟一份和父进程一样大的内存空间，用来存储自己的内容。所以如果父进程内存占用51%，子进程最多也会再占用51%，**操作系统不能保证能给子进程allocate这么多内存，所以fork失败**。

综上，部署redis的机器内存使用量不能超过一半，不然redis的确不能启动后台进程！

不过Linux还提供了一个选项：`sysctl vm.overcommit_memory=1`，只要这么设置，在内存真正耗尽之前，系统总认为内存是够的，此时fork不会因为内存不足失败。

这也是为什么，在redis的admin里：
- https://redis.io/topics/admin

redis第一条就是让配置Linux的上述选项：
> Make sure to set the Linux kernel overcommit memory setting to 1. Add `vm.overcommit_memory = 1` to `/etc/sysctl.conf` and then reboot or run the command `sysctl vm.overcommit_memory=1` for this to take effect immediately.

如果不配置，redis server启动的时候会报warning：
> 462:M 12 Jan 2021 02:09:50.804 # WARNING overcommit_memory is set to 0! Background save may fail under low memory condition. To fix this issue add 'vm.overcommit_memory = 1' to /etc/sysctl.conf and then reboot or run the command 'sysctl vm.overcommit_memory=1' for this to take effect.

redis强烈要求用户配置该选项，不然使用内存超过系统的一半redis就功能不正常了，用户可要骂街了……

## Ref
fork使用copy on write：
- https://man7.org/linux/man-pages/man2/fork.2.html#NOTES

> Under Linux, fork() is implemented using copy-on-write pages, so
       the only penalty that it incurs is the time and memory required
       to duplicate the parent's page tables, and to create a unique
       task structure for the child.

整体参考：
- https://engineering.zalando.com/posts/2019/05/understanding-redis-background-memory-usage.html
