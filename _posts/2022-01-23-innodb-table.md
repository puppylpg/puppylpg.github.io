---
layout: post
title: "Innodb - 表"
date: 2022-01-23 01:43:48 +0800
categories: mysql innodb
tags: mysql innodb
---

[Innodb - 行]({% post_url 2022-01-13-innodb-row %})组成[Innodb - 页]({% post_url 2022-01-14-innodb-page %})，页组成了innodb的表。页是innodb管理存储空间的基本单位，但是表才是逻辑上对一堆相同结构的数据管理的基本单位。

1. Table of Contents, ordered
{:toc}

表可以认为是由一大堆页再加上一些metadata组成：当需要存储数据的时候，挑一个空闲页，把数据放进去。

# 表遍历的性能问题
表确实可以理解为直接由一大堆页组成，页和页之间组成双向链表，主键相邻的页在逻辑上也是挨着的。**但是实际上，两个页在磁盘上的物理位置可能相差很远**。此时，**如果有一个遍历数据的操作，或者按照range取数据的请求，因为要读的两个页不在连续的磁盘上，就会产生随机磁盘IO，而不是连续的IO**，这注定会影响innodb的性能。

咋办？那就让页在物理上也挨着存放呗。

但是一开始就想让整个表的所有页都连续存放是不可能的——一个表是不断增长的，到底要预留多大空间才能真正的够用？

而实际上，也没必要保证整个表的所有页都连续存放，只要保证一定数量的一堆页连续存放就行了：所取的数据只要不超出这些页，就能连续IO。即使超出了，需要随机IO，随机IO的次数也远少于页在磁盘上随机存放的情况。只要这一堆连续存放的页能达到一定的大小，就能保证大部分情况下，IO都是连续的。

> 这实际上又是一种折中。

# 区（extent）
这一堆物理上连续的页，就构成了一个区。innodb定义的一个区是连续的64个页，由于一个页16KB，一个区就是1MB的空间。

**innodb在分配页的时候，是按照区申请的，一次申请64个页**，这些页连续存放，能消除很多随机IO。

> 管理存储空间是以页为单位，申请空间是以区为单位。

# 段（segment）
innodb索引即数据，有两种page：存放数据记录的叶子节点page、存放目录的非叶子节点page。遍历操作，遍历的是叶子节点，如果非叶子节点和叶子节点放一起，非叶子节点也会影响遍历效果。

所以innodb还有段的概念，作为区的集合：一个段的所有区的所有page只存放非叶子节点，另一个段的所有区的所有page只存放叶子节点。遍历的时候就能把叶子节点和非叶子节点分开了。

所以默认情况下，一个表就是一个聚簇索引，会有两个段，段内仍然以区为单位申请空间。

# 碎片区（fragment）
一个表至少有聚簇索引，一个聚簇索引至少两个段，一个段至少一个区，一个区1MB，那岂不是只要创建个表就得占用2MB？哪怕只存储一条数据也要占2MB，这也太浪费了。

所以这里又有了一个折中：innodb创建的第一个区叫碎片区，这个区不属于任何段。在这个区里，page既可以做叶子节点也可以做非叶子节点。当需要存储数据的时候，就从碎片区分配一页。只有当一个段拥有超过32个碎片区页面（0.5MB）之后，才开始以区为单位为段分配空间。

> 所以段可以由区组成，也可以由页组成（碎片区的页）。

# 段链表
现在一个区可能属于以下几种类型：
- free：空闲；
- free_frag：fragment代表碎片区，所以这个是有空闲页面的碎片区；
- full_frag：同理，没有空闲页面的碎片区；
- fseg：seg代表segment，所以这个是属于某个段的区；

每个区都对应一个被称为xdes entry（x是extent，des是description）的数据结构，用来表述这个区的metadata，它里面有一些属性：
- segment id：区所属的段；
- node：区指向上一个、下一个区的指针。**通过指针，区和区之间能够成链表**；
- status：就是上面说的区的类型；
- bitmap：一个区64个页，innodb用bit对应这些页，表明页是否空闲；

每一个段都有三个区构成的链表：
- free list：空闲的区构成的链表；
- full list：填满数据的区构成的链表；
- not_full list：介于二者之间的区构成的链表；

插入数据的时候就从相应的区取page。

> 聚簇索引有两个段，所以有2×3=6个链表。

# 表的物理存储
行、页、区、段，最后构成表。表是以什么物理形式存在呢？

> 使用docker在windows上启动mysql，版本：`mysql  Ver 8.0.27 for Linux on x86_64 (MySQL Community Server - GPL)`。

在windows powershell里下载最新版的mysql镜像，创建container，启动，并映射为系统的3306端口：
```
PS C:\Users\puppylpg> docker run --name demo-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=password -d mysql:latest
```

## mysql的数据存放位置
可以查看`datadir`变量了解mysql的数据存储位置：
```
MySQL [(none)]> show variables like 'datadir';
+---------------+-----------------+
| Variable_name | Value           |
+---------------+-----------------+
| datadir       | /var/lib/mysql/ |
+---------------+-----------------+
1 row in set (0.003 sec)
```

## 连接mysql
因为使用的是WSL里的mysql client连接windows docker里的mysql server，比较好玩，所以介绍一下连接过程。

### 远程tcp连接
使用WSL（Debian）里的mysql client连接docker里的mysql。**默认linux的mysql客户端用的是unix domain socket连接mysql**，docker里的mysql server和WSL相当于不在同一个系统上，所以WSL里自然没有`/run/mysqld/mysqld.sock`。因此直接启动WSL里的mysql client是连不上的docker里的mysql的：
```
ERROR 2002 (HY000): Can't connect to local MySQL server through socket '/run/mysqld/mysqld.sock' (2)
```
**只能通过`--protocol=TCP`显式指定使用tcp连接，WSL里的mysql client才会使用tcp通过3306端口连接上docker里的mysql**：
```
╰─○ mysql -hlocalhost -uroot -ppassword --protocol=TCP
Welcome to the MariaDB monitor.  Commands end with ; or \g.
Your MySQL connection id is 11
Server version: 8.0.27 MySQL Community Server - GPL

Copyright (c) 2000, 2018, Oracle, MariaDB Corporation Ab and others.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

MySQL [(none)]> 
```

### 本地socket连接
mysql是在docker里启动的，所以会在这个container里创建socket。可以去docker里求证。

首先使用bash打开这个container：
```
PS C:\Users\puppylpg> docker exec -it demo-mysql /bin/bash
```
然后查看mysql server创建的socket的确存在：
```
root@cc38467fca81:/# which mysql
/usr/bin/mysql
root@cc38467fca81:/# ls -lhb /run/mysqld/mysqld.sock
srwxrwxrwx 1 mysql mysql 0 Jan 22 15:57 /run/mysqld/mysqld.sock
```

接着在container里使用mysql client连接container里的mysql server。为了确认的确是通过socket连接的，显式指定协议使用socket：
```
root@cc38467fca81:/# mysql -hlocalhost -uroot -proot --protocol=socket
mysql: [Warning] Using a password on the command line interface can be insecure.
Welcome to the MySQL monitor.  Commands end with ; or \g.
Your MySQL connection id is 16
Server version: 8.0.27 MySQL Community Server - GPL

Copyright (c) 2000, 2021, Oracle and/or its affiliates.

Oracle is a registered trademark of Oracle Corporation and/or its
affiliates. Other names may be trademarks of their respective
owners.

Type 'help;' or '\h' for help. Type '\c' to clear the current input statement.

mysql>
```
的确连上了。

## 数据库的位置
在WSL的mysql client里，创建一个叫pokemon的数据库：
```
MySQL [(none)]> show databases;
+--------------------+
| Database           |
+--------------------+
| information_schema |
| mysql              |
| performance_schema |
| sys                |
+--------------------+
4 rows in set (0.001 sec)

MySQL [(none)]> create database pokemon;
Query OK, 1 row affected (0.009 sec)

MySQL [(none)]> show databases;
+--------------------+
| Database           |
+--------------------+
| information_schema |
| mysql              |
| performance_schema |
| pokemon            |
| sys                |
+--------------------+
5 rows in set (0.001 sec)

MySQL [(none)]> use pokemon;
Database changed
```
查看`/var/lib/mysql`下的数据：
```
root@cc38467fca81:/var/lib/mysql# ls -lhb | grep pokemon
drwxr-x--- 2 mysql mysql 4.0K Jan 22 07:06 pokemon
```
创建了一个叫pokemon的文件夹。**所以一个database在物理上就对应一个文件夹**。

## 表的位置
接着创建三个表：
- user：innodb；
- player：innodb；
- enemy：MyISAM；

```
MySQL [pokemon]> create table user (id int auto_increment, name varchar(10), age tinyint, primary key (id), index (name));
Query OK, 0 rows affected (0.049 sec)

MySQL [pokemon]> show tables;
+-------------------+
| Tables_in_pokemon |
+-------------------+
| user              |
+-------------------+
1 row in set (0.001 sec)

MySQL [pokemon]> insert into user(name, age) values('pikachu', 1);
Query OK, 1 row affected (0.009 sec)

MySQL [pokemon]> select * from user;
+----+---------+------+
| id | name    | age  |
+----+---------+------+
|  1 | pikachu |    1 |
+----+---------+------+
1 row in set (0.001 sec)

MySQL [pokemon]> create table player (id int auto_increment, name varchar(10), age tinyint, primary key (id), index (nam
e));
Query OK, 0 rows affected (0.047 sec)

MySQL [pokemon]> create table enemy (id int auto_increment, name varchar(10), age tinyint, primary key (id), index (name
))
Query OK, 0 rows affected (0.010 sec)

MySQL [pokemon]>
```
查看pokemon文件夹：
```
root@cc38467fca81:/var/lib/mysql# ls -lhb pokemon/
total 264K
-rw-r----- 1 mysql mysql    0 Jan 22 07:06 enemy.MYD
-rw-r----- 1 mysql mysql 1.0K Jan 22 07:06 enemy.MYI
-rw-r----- 1 mysql mysql 3.9K Jan 22 07:06 enemy_364.sdi
-rw-r----- 1 mysql mysql 128K Jan 22 07:05 player.ibd
-rw-r----- 1 mysql mysql 128K Jan 22 07:02 user.ibd
```
- 每个innodb的表对应一个`<表名>.ibd`的二进制文件：
    + `.idb`：存储数据 + 表结构；
- 每个MyISAM的表对应三个文件，其中两个代表数据文件和索引文件，因为MyISAM数据和索引是分开的，所以存储的时候也是分开的：
    + `.sdi`：表信息；
    + `.MYD`：MyISAM Data文件；
    + `.MYI`：MyISAM Index文件；

mysql5的时候，存储表结构有一个单独的文件，是`<表名>.frm`，format，而ibd文件只存储数据。mysql8的时候，MyISAM的表结构不使用frm格式存储，而是sdi格式。innodb创建的表干脆没有这个文件了，表结构和数据一起存到ibd文件里了。

mysql提供了一个`ibd2sdi`程序，可以通过ibd文件查看表结构信息：
```
root@cc38467fca81:/var/lib/mysql/pokemon# ibd2sdi user.ibd
["ibd2sdi"
,
{
        "type": 1,
        "id": 362,
        "object":
                {
    "mysqld_version_id": 80027,
    "dd_version": 80023,
    "sdi_version": 80019,
    "dd_object_type": "Table",
    "dd_object": {
        "name": "user",
        "mysql_version_id": 80027,
        "created": 20220122065929,
        "last_altered": 20220122065929,
        "hidden": 1,
        "options": "avg_row_length=0;encrypt_type=N;key_block_size=0;keys_disabled=0;pack_record=1;stats_auto_recalc=0;stats_sample_pages=0;",
        "columns": [
            {
                "name": "id",
                "type": 4,
                "is_nullable": false,
                "is_zerofill": false,
                "is_unsigned": false,
                "is_auto_increment": true,
                "is_virtual": false,
                "hidden": 1,
                "ordinal_position": 1,
                "char_length": 11,
                "numeric_precision": 10,
                "numeric_scale": 0,
                "numeric_scale_null": false,
                "datetime_precision": 0,
                "datetime_precision_null": 1,
                "has_no_default": false,
                "default_value_null": false,
                "srs_id_null": true,
                "srs_id": 0,
                "default_value": "AAAAAA==",
                "default_value_utf8_null": true,
                "default_value_utf8": "",
                "default_option": "",
                "update_option": "",
                "comment": "",
                "generation_expression": "",
                "generation_expression_utf8": "",
                "options": "interval_count=0;",
                "se_private_data": "table_id=1067;",
                "engine_attribute": "",
                "secondary_engine_attribute": "",
                "column_key": 2,
                "column_type_utf8": "int",
                "elements": [],
                "collation_id": 255,
                "is_explicit_collation": false
            },
            {
                "name": "name",
                "type": 16,
                "is_nullable": true,
                "is_zerofill": false,
                "is_unsigned": false,
                "is_auto_increment": false,
                "is_virtual": false,
                "hidden": 1,
                "ordinal_position": 2,
                "char_length": 40,
                "numeric_precision": 0,
                "numeric_scale": 0,
                "numeric_scale_null": true,
                "datetime_precision": 0,
                "datetime_precision_null": 1,
                "has_no_default": false,
                "default_value_null": true,
                "srs_id_null": true,
                "srs_id": 0,
                "default_value": "",
                "default_value_utf8_null": true,
                "default_value_utf8": "",
                "default_option": "",
                "update_option": "",
                "comment": "",
                "generation_expression": "",
                "generation_expression_utf8": "",
                "options": "interval_count=0;",
                "se_private_data": "table_id=1067;",
                "engine_attribute": "",
                "secondary_engine_attribute": "",
                "column_key": 4,
                "column_type_utf8": "varchar(10)",
                "elements": [],
                "collation_id": 255,
                "is_explicit_collation": false
            },
            {
                "name": "age",
                "type": 2,
                "is_nullable": true,
                "is_zerofill": false,
                "is_unsigned": false,
                "is_auto_increment": false,
                "is_virtual": false,
                "hidden": 1,
                "ordinal_position": 3,
                "char_length": 4,
                "numeric_precision": 3,
                "numeric_scale": 0,
                "numeric_scale_null": false,
                "datetime_precision": 0,
                "datetime_precision_null": 1,
                "has_no_default": false,
                "default_value_null": true,
                "srs_id_null": true,
                "srs_id": 0,
                "default_value": "",
                "default_value_utf8_null": true,
                "default_value_utf8": "",
                "default_option": "",
                "update_option": "",
                "comment": "",
                "generation_expression": "",
                "generation_expression_utf8": "",
                "options": "interval_count=0;",
                "se_private_data": "table_id=1067;",
                "engine_attribute": "",
                "secondary_engine_attribute": "",
                "column_key": 1,
                "column_type_utf8": "tinyint",
                "elements": [],
                "collation_id": 255,
                "is_explicit_collation": false
            },
            {
                "name": "DB_TRX_ID",
                "type": 10,
                "is_nullable": false,
                "is_zerofill": false,
                "is_unsigned": false,
                "is_auto_increment": false,
                "is_virtual": false,
                "hidden": 2,
                "ordinal_position": 4,
                "char_length": 6,
                "numeric_precision": 0,
                "numeric_scale": 0,
                "numeric_scale_null": true,
                "datetime_precision": 0,
                "datetime_precision_null": 1,
                "has_no_default": false,
                "default_value_null": true,
                "srs_id_null": true,
                "srs_id": 0,
                "default_value": "",
                "default_value_utf8_null": true,
                "default_value_utf8": "",
                "default_option": "",
                "update_option": "",
                "comment": "",
                "generation_expression": "",
                "generation_expression_utf8": "",
                "options": "",
                "se_private_data": "table_id=1067;",
                "engine_attribute": "",
                "secondary_engine_attribute": "",
                "column_key": 1,
                "column_type_utf8": "",
                "elements": [],
                "collation_id": 63,
                "is_explicit_collation": false
            },
            {
                "name": "DB_ROLL_PTR",
                "type": 9,
                "is_nullable": false,
                "is_zerofill": false,
                "is_unsigned": false,
                "is_auto_increment": false,
                "is_virtual": false,
                "hidden": 2,
                "ordinal_position": 5,
                "char_length": 7,
                "numeric_precision": 0,
                "numeric_scale": 0,
                "numeric_scale_null": true,
                "datetime_precision": 0,
                "datetime_precision_null": 1,
                "has_no_default": false,
                "default_value_null": true,
                "srs_id_null": true,
                "srs_id": 0,
                "default_value": "",
                "default_value_utf8_null": true,
                "default_value_utf8": "",
                "default_option": "",
                "update_option": "",
                "comment": "",
                "generation_expression": "",
                "generation_expression_utf8": "",
                "options": "",
                "se_private_data": "table_id=1067;",
                "engine_attribute": "",
                "secondary_engine_attribute": "",
                "column_key": 1,
                "column_type_utf8": "",
                "elements": [],
                "collation_id": 63,
                "is_explicit_collation": false
            }
        ],
        "schema_ref": "pokemon",
        "se_private_id": 1067,
        "engine": "InnoDB",
        "last_checked_for_upgrade_version_id": 0,
        "comment": "",
        "se_private_data": "autoinc=0;version=0;",
        "engine_attribute": "",
        "secondary_engine_attribute": "",
        "row_format": 2,
        "partition_type": 0,
        "partition_expression": "",
        "partition_expression_utf8": "",
        "default_partitioning": 0,
        "subpartition_type": 0,
        "subpartition_expression": "",
        "subpartition_expression_utf8": "",
        "default_subpartitioning": 0,
        "indexes": [
            {
                "name": "PRIMARY",
                "hidden": false,
                "is_generated": false,
                "ordinal_position": 1,
                "comment": "",
                "options": "flags=0;",
                "se_private_data": "id=157;root=4;space_id=2;table_id=1067;trx_id=2316;",
                "type": 1,
                "algorithm": 2,
                "is_algorithm_explicit": false,
                "is_visible": true,
                "engine": "InnoDB",
                "engine_attribute": "",
                "secondary_engine_attribute": "",
                "elements": [
                    {
                        "ordinal_position": 1,
                        "length": 4,
                        "order": 2,
                        "hidden": false,
                        "column_opx": 0
                    },
                    {
                        "ordinal_position": 2,
                        "length": 4294967295,
                        "order": 2,
                        "hidden": true,
                        "column_opx": 3
                    },
                    {
                        "ordinal_position": 3,
                        "length": 4294967295,
                        "order": 2,
                        "hidden": true,
                        "column_opx": 4
                    },
                    {
                        "ordinal_position": 4,
                        "length": 4294967295,
                        "order": 2,
                        "hidden": true,
                        "column_opx": 1
                    },
                    {
                        "ordinal_position": 5,
                        "length": 4294967295,
                        "order": 2,
                        "hidden": true,
                        "column_opx": 2
                    }
                ],
                "tablespace_ref": "pokemon/user"
            },
            {
                "name": "name",
                "hidden": false,
                "is_generated": false,
                "ordinal_position": 2,
                "comment": "",
                "options": "flags=0;",
                "se_private_data": "id=158;root=5;space_id=2;table_id=1067;trx_id=2316;",
                "type": 3,
                "algorithm": 2,
                "is_algorithm_explicit": false,
                "is_visible": true,
                "engine": "InnoDB",
                "engine_attribute": "",
                "secondary_engine_attribute": "",
                "elements": [
                    {
                        "ordinal_position": 1,
                        "length": 40,
                        "order": 2,
                        "hidden": false,
                        "column_opx": 1
                    },
                    {
                        "ordinal_position": 2,
                        "length": 4294967295,
                        "order": 2,
                        "hidden": true,
                        "column_opx": 0
                    }
                ],
                "tablespace_ref": "pokemon/user"
            }
        ],
        "foreign_keys": [],
        "check_constraints": [],
        "partitions": [],
        "collation_id": 255
    }
}
}
,
{
        "type": 2,
        "id": 7,
        "object":
                {
    "mysqld_version_id": 80027,
    "dd_version": 80023,
    "sdi_version": 80019,
    "dd_object_type": "Tablespace",
    "dd_object": {
        "name": "pokemon/user",
        "comment": "",
        "options": "autoextend_size=0;encryption=N;",
        "se_private_data": "flags=16417;id=2;server_version=80027;space_version=1;state=normal;",
        "engine": "InnoDB",
        "engine_attribute": "",
        "files": [
            {
                "ordinal_position": 1,
                "filename": "./pokemon/user.ibd",
                "se_private_data": "id=2;"
            }
        ]
    }
}
}
]
```
从中可以找到列信息等。

## 系统数据库
mysql还有一些自己创建的的数据库，其实就是mysql用mysql来管理mysql自己的数据……

> 使用我自己的功能来管理我自己 ┓( ´∀` )┏

```
MySQL [(none)]> show databases;
+--------------------+
| Database           |
+--------------------+
| information_schema |
| mysql              |
| performance_schema |
| sys                |
+--------------------+
4 rows in set (0.001 sec)
```

