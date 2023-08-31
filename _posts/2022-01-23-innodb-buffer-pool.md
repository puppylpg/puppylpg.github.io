---
layout: post
title: "Innodb - Buffer Pool"
date: 2022-01-23 22:29:42 +0800
categories: mysql innodb pagecache
tags: mysql innodb pagecache
---

Innodb以磁盘作为存储介质，所以用的时候需要加载到内存。Innodb管理数据的基本单位是页，每次都加载一页数据到内存里。

innodb按页加载数据，是为了读下一条数据的时候能够直接从内存里的同一页取，而不用再次从磁盘取，减少一次磁盘IO。同样的思想，innodb如果能在内存中放很多个页，就能减少很多从磁盘加载页的IO开销。理想情况下，如果内存足够大，能放下所有表的所有索引的所有页，取数据就再也不用去磁盘取了，全是内存操作，Innodb的速度就蹭蹭的了~

> 在[Innodb - 表]({% post_url 2022-01-23-innodb-table %})里介绍过，innodb申请存储空间时按区分配，是为了从磁盘连续取页的时候，尽量是连续IO。innodb做了这么多优化读取速度的操作，自然不会放过缓存这个提速的方法。

1. Table of Contents, ordered
{:toc}

# Buffer Pool
本质上，这个存放innodb页的连续内存就是页的缓存，称为buffer pool。

## 大小
默认情况下，buffer pool大小为128M：
```
MySQL [(none)]> show variables like 'innodb_buffer_pool_size';
+-------------------------+-----------+
| Variable_name           | Value     |
+-------------------------+-----------+
| innodb_buffer_pool_size | 134217728 |
+-------------------------+-----------+
1 row in set (0.011 sec)
```

> 单位是bit。

如果有足够大的内存，建议buffer pool分配大一些，比如几百GB，能提高MySQL的性能。或者专门搞一台内存比较大的服务器用来提供mysql服务，不要再部署其他服务。

> buffer pool也不能太小，无论如何配置，都不会小于5MB。

因为访问buffer pool是并发的，所以对buffer pool的各种链表加锁争用会比较激烈。可以考虑 **创建多个buffer pool实例**，分散争用的请求，从而提升并发能力。

默认只有一个buffer pool：
```
MySQL [(none)]> show variables like 'innodb_buffer_pool_instances';
+------------------------------+-------+
| Variable_name                | Value |
+------------------------------+-------+
| innodb_buffer_pool_instances | 1     |
+------------------------------+-------+
1 row in set (0.001 sec)
```
上述`innodb_buffer_pool_instances`是所有pool的总大小。

## 缓冲页
buffer pool肯定也是分页的，因为innodb加载数据是以page为单位的，buffer pool也要划分为页来放置这些从磁盘上加载的数据页。buffer pool的页被称为缓冲页。

每个缓冲页都有一个对应的数据结构，称为控制块。每个控制块存储着对应的缓冲页的metadata，比如该页是否已经被占用等。

> 缓冲池占用的空间，和缓冲页的控制块占用的内存空间，不是同一个空间。也就是说 **MySQL申请的内存空间不只是buffer pool那么大**，还要申请一些内存放置其他信息。

# 用法
buffer pool的使用流程应该是这样的：
1. 需要用到某个页，先看看这个页在不在buffer pool里，如果在就直接用了；
2. 如果不在buffer pool里，把页从磁盘上加载到buffer pool的哪个页里？

## hash
怎么知道某个页是否在buffer pool里？遍历buffer pool？遍历是不可能遍历的，O(n)复杂度的操作是要尽量避免的。

hash是拥有着O(1)复杂度的查找算法，所以innodb使用页所在的表id和页id作为key，页的内容作为value，构建了hash表。判断一个页是否在buffer pool里，查一下就知道了。

## 又是链表
如果要加载一个页到buffer pool，需要找到一个空闲的缓冲页。怎么知道哪个缓冲页被占用了，哪个没有被占用呢？

遍历所有的数据页是可以的，但遍历是不可能遍历的。

想想[Innodb - 表]({% post_url 2022-01-23-innodb-table %})的段怎么确定哪些区是空闲的？free链表、free_frag链表、full_frag链表。

同样，为了标记缓冲池里的哪些缓冲页是空闲的，innodb也维护了一个 **free链表**。所有空闲的缓冲页的控制块都在这个链表上。

> 这里用的是链表，也可以认为是用了hash，key就两种状态：空闲、非空闲，所以value就会大量冲突，其结果就是每个key都对应一个链表。一个叫free链表，一个叫非free链表。

# 放哪些页？
buffer pool再大也是有限的，不存在理想的情况，能够真的放下所有的数据页。所以buffer pool的缓冲页肯定存在不够用的情况，也就是free链表为空了。这种情况下，只好把一些缓冲页踢出去，把要使用到的数据页加载到缓冲页。

怎么踢？一般都是使用LRU，**Least Recently Used，差不多就是二八定律的感觉**：只要把经常访问到的数据留下来，就能解决80%的访问需求了。

**innodb也用了LRU，但又没有完全用LRU**。因为数据库有个特殊的场景：全表扫描。**LRU最怕全表扫描**，每个页都要加载一次，且只加载一次，也就没有什么热数据之说了。**在这种场景下，页的访问不是二八定律，而是平均律（我瞎起的）**。所以刚加载进来不久的页，又需要被后来的页踢出去，几乎完全没起到复用的效果。那缓冲池的作用也微乎其微了。

为了解决这种特殊的场景，innodb对LRU进行了魔改，LRU链表分两块：
1. 一块是热数据，占链表长度的37%；
2. 一块是冷数据，占链表长度的剩余部分；

新加载进来的数据，放入冷数据区，只有多次被访问到，才允许放入热数据区。这样，**全表扫描的操作不停洗刷的是冷数据区的数据，并不会把热数据刷出去**，不影响后面的使用。

热数据叫young，冷数据叫old，和JVM的old gen、young gen的概念正好反过来。大概innodb认为，从LRU的角度出发，刚被访问到的数据是young，长时间无人问津的是old？
```
MySQL [(none)]> show variables like 'innodb_old_blocks_pct';
+-----------------------+-------+
| Variable_name         | Value |
+-----------------------+-------+
| innodb_old_blocks_pct | 37    |
+-----------------------+-------+
1 row in set (0.002 sec)
```

全表扫描还有一个特点：要访问一页里所有的数据。而页的存在就是为了减少磁盘IO，访问前后数据的时候能够直接命中。全表扫描从该页的第一条数据开始，到这一页的最后一条数据为止，全都算命中该页了。那么该页算热数据了吗？不能算。为了让这种情况不算热数据，innodb又设置了一个时间间隔，默认是1s，1s内多次访问某个页算一次：
```
MySQL [(none)]> show variables like 'innodb_old_blocks_time';
+------------------------+-------+
| Variable_name          | Value |
+------------------------+-------+
| innodb_old_blocks_time | 1000  |
+------------------------+-------+
1 row in set (0.001 sec)
```
**由此可见，使用场景决定实现方式**。LRU代表二八定律，而世上很多事情都符合二八定律，所以LRU大部分情况是很合适的。但对这种有全表扫描需求的场景，LRU性能就差了。那就只能因地制宜，做出调整。

> 所以也别认为LRU就比FIFO好，只不过LRU适用的场景多罢了。

# 脏页写回
Inoodb毕竟是需要持久化的engine，不是一个纯内存型engine，所以还是要考虑写回磁盘的问题的。

什么样的page需要写回？被修改的page，也就是脏页dirty page。如果没有任何改动，也就没有写回的必要了。

那么什么时候写回呢？一有改动就写回？可以，但是频繁写回磁盘需要频繁进行磁盘IO，太慢了。

如果当时不立即写回，后面再写回的时候，怎么知道哪个页是脏页呢？所以为了把他们标记出来，innodb搞了个 **flush链表**：暂时不写回脏页，但会把脏页标记出来，以后写回的时候直接从脏页里取数据页刷新回磁盘。

至于“以后”是什么时候，innodb有以下几种写回方式，代表不同的时机：
- BUF_FLUSH_LIST：定时异步从flush链表刷新页面到磁盘；
- BUF_FLUSH_LRU：定时异步从LRU冷数据写回脏页到磁盘；
- BUF_FLUSH_SINGLE_PAGE：定时任务还没来得及刷呢，buffer pool已经实在没有可用的空闲缓冲页了，那就从LRU尾部找一个脏页刷新到磁盘吧。这种刷新是用户线程同步操作的，所以会影响用户线程的响应时间；

第三种情况很像JVM线程池的caller run策略：实在没有空闲的异步线程能帮你执行任务了，要不你就自己执行吧。

# 虚拟内存
innodb管理buffer pool的方式，总有一种似曾相识的感觉。

脏页、写回、LRU，上一个提及这些名词的地方，还是计算机组成原理学习 **虚拟内存** 的时候——当时为了弥补CPU速度和主存速度的差异，添加了一个叫cache的东西。这种场景像极了为了弥补CPU和磁盘速度的差异，添加了buffer pool的innodb。

## 共性
所有作为缓存的东西，必然是：
- 比原有的存储快；
- （所以比原有的存储贵）；
- （所以）比原有的存储小；

小就会不够用，不够用就要进行替换：把要用到的放进来，把用不到的先放回去（也不一定要放回去，如果没有被修改，直接被覆盖就好了，没必要再写回去）。

对冷数据做替换就会涉及到LRU，就会出现写回脏数据的概念。**而如果他们都是块存储**，就会涉及到page的概念：
- **cache和主存就是这样的关系**，所以：cache作为主存的缓存。cache中的page指的就是主存中的page；
- **主存和磁盘就是这样的关系**，所以：主存用来存放正在使用的那部分虚拟内存数据，磁盘用来存放暂时用不到的虚拟内存数据。主存中的page，指的就是虚拟内存的一部分（一页）；
    > https://zh.wikipedia.org/wiki/%E8%99%9A%E6%8B%9F%E5%86%85%E5%AD%98
- **innodb放主存里的buffer pool和放磁盘上的页也是这样的关系**，所以：buffer pool放当前用到的页，磁盘用来放暂时用不到的页。buffer pool的page，就是磁盘上innodb存储的一页，16k；

磁盘用的不是“页”的概念，而是“块”，所以磁盘读写使用的是磁盘块，大小为4KB：
```
$ sudo stat /boot
  File: /boot
  Size: 4096            Blocks: 8          IO Block: 4096   directory
Device: 810h/2064d      Inode: 8193        Links: 2
Access: (0755/drwxr-xr-x)  Uid: (    0/    root)   Gid: (    0/    root)
Access: 2021-10-13 23:05:35.000000000 +0800
Modify: 2021-04-11 04:15:00.000000000 +0800
Change: 2021-10-13 23:05:36.665214900 +0800
 Birth: 2021-10-13 23:05:35.435214900 +0800
```

为了方便读磁盘，内存页是磁盘块大小的2^n倍，默认也是4k：
```
$ sudo getconf PAGE_SIZE
4096
```

## 特性
虚拟内存和buffer pool的场景比较像，虽然都用了page的概念，但是两个page的含义是完全不同的：
- 虚拟内存的page代表的是虚拟内存的一部分，是对内存数据的抽象；
- innodb的page代表的是mysql表数据的一部分，是对磁盘数据的抽象；

可以参考两个相关问题：
- https://dba.stackexchange.com/a/305894/245984
- https://www.zhihu.com/question/447918756/answer/1783879900

# page cache(disk cache)
虚拟内存的场景很像buffer pool，但还有一个和虚拟内存、buffer pool类似，比虚拟内存更像buffer pool的例子——page cache：
- https://en.wikipedia.org/wiki/Page_cache

page cache就是常说的 **disk cache，它是磁盘数据在主存中的缓存**（光看这个描述就很像buffer pool了）：当主存空闲的时候，os会把磁盘文件装入主存，当读写磁盘的时候，如果相应的块已经在主存里了，就不需要从磁盘上读了，从而减少了磁盘IO，加快数据的访问速度。

> 但是这些内存还是会被系统标记位available，一旦程序需要申请内存，os立马把这些内存腾出来给程序用。

因为修改数据实际也是写disk cache里的内容，所以disk cache也有脏页，也涉及脏页的刷新。所以它和buffer pool不能说很像，只能说一模一样了！

page cache脏数据写回也有自己的时机：
- https://blog.csdn.net/rikeyone/article/details/105783596

系统也提供了不同的写入策略：
1. **write back**：写数据的时候，写到page cache就行，等刷新脏页的时候才会同步到磁盘里；
2. **write through**：必须写到磁盘里。所以会比write back慢，但更保险；

关于写入的系统调用：
- `sync`：**把数据写到page cache就结束了**，最快；
- `fsync`：必须将数据写到磁盘里再返回，**包括文件的数据部分和metadata**，最慢但最保险；
- `fdatasync`：**必须将数据部分写到磁盘里**，如果没啥影响，就不等文件的metadata写入了，所以比fsync快一些，同时保险。

参阅：
- https://www.jb51.net/article/101062.htm

## 两个写回
buffer pool和disk cache很像，但他们不是并列的概念。disk cache是更底层的操作系统层面的机制，所以对更上层的应用层的buffer pool是透明的。**当buffer pool在写磁盘的时候，可能就用到了disk cache**。

**但disk cache的写回和buffer pool的写回是两码事，发生在不同的时刻**：
1. 当数据有修改，innodb决定不写回磁盘，只把修改写到内存里的buffer pool；
2. 一段时间后，innodb决定 **写回** 磁盘，所以调用了os的写磁盘方法；
3. **对于innodb把数据从内存（buffer pool）写到磁盘的请求，os决定不写磁盘，而是写入内存的page cache**；
4. 一段时间后，os决定 **写回** 磁盘，把数据从内存写入磁盘；

## 到底写入磁盘没有？
无论是innodb的写回，还是os的写回，在真正写回磁盘之前，写入主存的数据都是可能会在主机断电、程序崩溃等意外时丢的。对于innodb来说：
- 如果它只写入了buffer pool，没决定写入磁盘，那丢了就丢了，相当于这个修改数据的操作没有做；
- 如果它从buffer pool写入磁盘，**那就必须是写入了**，否则会出差错。

比如innodb调用os的写磁盘，认为redo日志已经写入了，但数据有可能被os写入disk cache了，实际并没有写入磁盘，之后崩了。再重启之后，redo日志不完整，事务无法恢复，那mysql就出错了。**所以mysql不允许这种情况发生，它决定使用write through，不使用write back策略**。

MySQL有个关于[优化innodb使用磁盘io](https://dev.mysql.com/doc/refman/8.0/en/optimizing-innodb-diskio.html)的文档，里面提到了能使用`fdatasync`就不使用`fsync`，同理能使用`O_DSYNC`就不使用`O_SYNC`，都是为了加快写入。**但无论用哪个，都没提使用`sync()`**。
- [优先使用`fdatasync`](https://dev.mysql.com/doc/refman/8.0/en/innodb-parameters.html#sysvar_innodb_use_fdatasync)
- [**flush选项里压根没有sync()方法**](https://dev.mysql.com/doc/refman/8.0/en/innodb-parameters.html#sysvar_innodb_flush_method)

> 有个nosync方法，但是只在内部测试用，而且已经不被支持了。所以最最基本也得fsync()。

在[这里](https://www.jb51.net/article/101062.htm)也着重强调了这一点：
- **对于提供事务支持的数据库，在事务提交时，都要确保事务日志（包含该事务所有的修改操作以及一个提交记录）完全写到硬盘上，才认定事务提交成功并返回给应用层**；
- **对于需要保证事务的持久化（durability）和一致性（consistency）的数据库程序来说，write()所提供的“松散的异步语义”是不够的，通常需要操作系统提供的同步IO（synchronized-IO）原语来保证（`fsync`）**；

> **但是es就不这样：只要胆子大，redo log也敢不fsync**！[Elasticsearch：分片读写]({% post_url 2022-05-05-es-deep-dive %})

# disk buffer
还有一个叫disk buffer的东西，和disk cache听起来很像：
- https://en.wikipedia.org/wiki/Disk_buffer

之所以和disk cache听起来像，是因为它的目标和disk cache几乎一致——加快磁盘写入速度。只不过它使用的是硬盘上自带的一块嵌入式内存。比如西数2TB蓝盘，标明“缓存：256MB”，当写入文件的时候，前256M会写的特别快，其实是写到这个缓存里了。

page cache和disk buffer虽然理念几乎一致，但是两个完全不同的东西：**前者是os做的事情，后者是磁盘本身做的事情**。

每一层都在做优化磁盘读写速度的事情，每一层的行为都对上层透明：
- buffer pool：应用层；
- page cache：os层；
- disk buffer：硬件层；

所以Wikipedia特意注明page cache(disk cache)和disk buffer是两种东西，不要混淆：
- https://en.wikipedia.org/wiki/Disk_cache

