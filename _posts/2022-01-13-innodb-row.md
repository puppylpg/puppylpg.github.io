---
layout: post
title: "Innodb - 行"
date: 2022-01-13 00:43:36 +0800
categories: mysql innodb
tags: mysql innodb
---

Innodb给使用者的抽象，大致就是表，每个表有很多行，每个行可能有很多列。

1. Table of Contents, ordered
{:toc}

一行是怎么存储的？逻辑上，它拥有多个格子分别代表多个列，实际上，它是一堆非常紧凑的二进制。

innodb有好几种存储行的方案：
- compact：听起来就很紧凑，省空间；
- redundant；
- dynamic；
- compressed；

主要介绍一下compact。

# COMPACT
首先要知道，一行的字节，存的可不只是这一行的各个列的数据，还有一些metadata。

## 怎么存储列数据
一列一列挨着存呗：第一列的值、第二列的值、第三列的值……

**MySQL是有表结构的，所以取数据的时候，可以照着MySQL的schema反序列化每一列**。

## 列定界
问题来了，列与列之间怎么定界？

1. 定长列很好定界：定长列的 **字节数** 是固定的，读一个列的时候按照表结构的定义，读特定个字节的数据，再往后就是下一列的数据了；
2. 变长列不知道到底有多长，所以每个列都要记录一个长度信息，标志这个列的长度，再记录这一列的内容。compact格式把所有变长列的长度统一都放到了一列的开头部分。

关于变长列，有两点需要注意：
1. varchar/varbinary，text/blob显然是变长列。char(3)是变长列吗？不一定。**它代表能存储三个字符，至于这三个字符是不是占用固定的字节数，要由这一列的字符集决定**！
    - 如果是ascii编码，3个字符固定占用3 byte；
    - 如果是utf8这种变长字符集，一个字符可能由1-3个字节表示（mysql的utf8不是真正的utf8，真正的utf8在mysql里是utf8mb4，一个字符由1-4个字节表示），所以3个字符实际占多少个字节也是不确定的。**这种情况下，char(3)也是变长列**；
1. 变长列的长度肯定不是用int（4 byte）来表示的。列数据还不一定放4 byte那么大，长度却要放4 byte，mysql肯定不会这么浪费。毕竟这是mysql的协议，不是平时我们用protobuf定义的协议。**变长列最多占多少字节，根据这一列的schema和字符集就可以确定**，如果这一列最大字节数不超过255，那用1 byte就可以表示这一列的长度了。这不比4 byte省多了！

## null值
所有非primary key、非not null修饰的列，都有可能为null。null值按照上面的做法也是可以存的：
1. 变长列：长度表示为0，实际数据就不用存了；
2. 定长列：bit位全0表示；

但是这么做有点儿浪费。compact使用“位图”来标志每一列是否为null：有多少列，就使用多少bit，bit为1代表为null，为0代表非null。

假设一个表有10列，其中8列可以为null，就需要额外使用1 byte表示这8列每一列是否为null。看起来多浪费了1 byte，但只要有一列为null，就可以不存储它了，至少省了1 byte。所以这1 byte的额外代价妥妥合算

## metadata
比如一些标志位：
- deleted_flag：1 bit，标志这一列是否被删除；
- heap_no：13 bit，该列在页中的位置；
- record_type：3 bit：
    + 0：普通记录（数据项）；
    + 1：这一行是B+树索引的目录项；
    + 2：infimum，表示排序最小的记录；
    + 3：supremum：表示排序最大的记录
- next_record：16 bit，下一条记录的相对位置，其实就是指针；

等等。

## 隐藏列
除了我们自己定义的列，mysql还会自动生成一些列：

- row_id：id。**如果我们自己不定义primary key，mysql会选取一个unique not null的列作为主键。如果连这样的列都没有，mysql就自己定义一个隐藏列，代表主键，列名就叫row_id**。为什么？因为B+树要使用primary key。后面介绍；
- trx_id：事务id。为mvcc、数据库事务隔离级别所用。后面介绍；
- roll_pointer：回滚指针。事务回滚需要知道回滚那些内容，指针指的就是这些要回滚的内容。后面介绍；

# 语法
行格式可以在定义表的时候指定：
```
CREATE TABLE t1 (
    c1 INT
) CHARSET=utf8mb4 ENGINE=INNODB ROW_FORMAT=COMPACT;
```
创建表的时候默认行格式也是compact。


