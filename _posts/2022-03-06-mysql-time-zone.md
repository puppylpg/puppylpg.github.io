---
layout: post
title: "MySQL的时间类型和时区"
date: 2022-03-05 02:55:03 +0800
categories: mysql
tags: mysql
---

最近set timestamp的值，栽了一波跟头┓( ´∀` )┏

> mysql的时间类型就和Java的时间类型一样，看起来好像不是很重要，但是如果你不了解它，就会处处被绊。而由于mysql的一种类型不可能呈现出Java那么多的接口，所以更需要好好了解一些背景知识。

1. Table of Contents, ordered
{:toc}

# 类型
- https://dev.mysql.com/doc/refman/8.0/en/datetime.html

MySQL的三种时间类型：
- `DATE`：格式`YYYY-MM-DD`;
- `DATETIME`：格式`YYYY-MM-DD hh:mm:ss`;
- `TIMESTAMP`：格式同DATETIME，也是`YYYY-MM-DD hh:mm:ss`;

> 还有一个`TIME`类型，应该不常用，存储格式`hh:mm:ss` format (or `hhh:mm:ss` format for large hours values)，主要存储**两个事件间的时间间隔**，所以可以大于24小时，也可以是负的。

# 奇怪的默认行为
在创建时间类的字段时，最好设好默认值，否则mysql根据版本不同，会有完全不同的行为。

在比较新的版本里，比如8.0.27，timestamp不设默认值，默认就是null。但是在旧版本，比如5.7，等价于 **`NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`**，这就非常坑！意味着它会随着这一行数据的变更而变更，导致原始设置的时间被覆盖……而公司里的mysql一般还停留在比较老旧的版本，所以还是会遇到这些问题的。

> 没有人会去主动升级公司mysql的版本的……除非想不开了……

# 赋值方式
以上三种类型有着相同的两种赋值方式：
1. **使用字符串**：比如`'2020-01-01 11:22:33'`；
2. **还是使用字符串**……不过mysql有时间戳转字符串的函数`from_unixtime`，所以也可以认为可以通过时间戳设置：比如`from_unixtime(1)`；

使用时间戳需要注意：
1. **时间戳的单位是秒，不是毫秒**；
2. timestamp不能设置`from_unixtime(0)`，至少从1开始。这就导致了timestamp能表示的最小值是`1970-01-01 00:00:01`；

# 表示的时间范围不同
- DATETIME：`1000-01-01 00:00:00` to `9999-12-31 23:59:59`；
- TIMESTAMP：`1970-01-01 00:00:01` UTC to `2038-01-09 03:14:07` UTC；

timestamp实际是使用4 byte表示的signed number。所以最大值是`2^23 - 1 = 2147483647`，也就是UTC `2038-01-09 03:14:07`，或者东八区`2038-01-09 11:14:07`。

**设置超过2147483647的数字作为timestamp的值，数据库显示存了个null值**。

# 保留毫秒
> @since 5.6.4

mysql后来对TIME/DATETIME/TIMESTAMP增加了毫秒、微秒支持。支持方式为另加新的字节，存储秒后面的小数值。新的表示方式为：**在类型后面括号里加数字，代表小数的位数**。

三者都一样，所以这里仅以timestamp举例：
- 存储到秒：TIMESTAMP，或者TIMESTAMP(0);
- 存储到毫秒：TIMESTAMP(3)，比如xx.123s；
- 存储到微秒：TIMESTAMP(6)，比如xx.021103s；
- 存储到十分之一毫秒：TIMESTAMP(4)，比如xx.1204s；

**但是`FROM_UNIXTIME()`接收的参数还是秒，所以设置毫秒其实就是设置一个小数值**。比如`from_unixtime(1.001)`代表`1970-01-01 00:00:01.001`。

**如果类型的精度不够，会默认丢掉多余的精度**。比如给TIMESTAMP(3)设置微秒级别`from_unixtime(1.001001)`的时间，最终存储的值只到毫秒级`1970-01-01 00:00:01.001`。

# 是否时区相关
**TIMESTAMP是时区相关的，其他两个在存的时候是时区相关的，存完之后取的时候是时区无关的**。

也就是说：
1. 在东八区，如果给TIMESTAMP和DATETIME同时设置`from_unixtime(1)`，二者都显示为`1970-01-01 08:00:01`，说明存的时候都会注意时区；
2. 将时区切换为UTC，TIMESTAMP显示的是`1970-01-01 00:00:01`，DATETIME依然显示`1970-01-01 08:00:01`，说明前者取的时候按照时区转换了，后者没有；

所以，
1. 如果以时间戳的形式存储：
    1. 在存储的时候：timestamp**将时间戳存为UTC时间**，datetime**将时间戳存为本时区时间**；
    2. 在查询的时候：timestamp**将UTC时间按照时区转为本时区的时间**，datetime**直接取**。
2. 如果以时间字符串的形式存储：
    1. 在存储的时候：timestamp**将时间存为UTC时间**，datetime**直接存**；
    2. 在查询的时候：timestamp**将UTC时间按照时区转为本时区的时间**，datetime**直接取**。

**既然timestamp时间戳最小为1，所以如果在东八区以字符串存储时间，字符串表示的时间不得小于`1970-01-01 08:00:01`，否则翻译成时间戳就是负值了**。

- https://stackoverflow.com/a/7137276/7676237

# 时区
## 时区层级
- 系统时区：机器操作系统的时区，MySQL启动时尝试根据系统时区初始化自己的时区；
- MySQL全局时区：全局变量`time_zone`，默认是`SYSTEM`，代表和系统时区一致；
- session时区：每个客户端连接所使用的时区，session变量`time_zone`，默认是`SYSTEM`；

> `time_zone`设置为`SYSTEM`有弊端，每次调用时区相关的函数的时候，都要使用系统库决定当前时区，可能需要锁，resulting in contention。

## 显示时区
```
mysql root@localhost:pokemon> show variables like '%time_zone%';
+------------------+--------+
| Variable_name    | Value  |
+------------------+--------+
| system_time_zone | UTC    |
| time_zone        | +00:00 |
+------------------+--------+
```
或者：
```
SELECT @@global.time_zone;
SELECT @@session.time_zone;
```

## 变更时区
- https://stackoverflow.com/a/19069310/7676237

设置全局时区：
```
SET GLOBAL time_zone = '+8:00';
SET GLOBAL time_zone = 'Europe/Helsinki';
SET @@global.time_zone = '+00:00';
```

设置当前会话的时区：
```
SET time_zone = 'Europe/Helsinki';
SET time_zone = "+00:00";
SET @@session.time_zone = "+00:00";
```

## 值的格式
- `SYSTEM`，默认值;
- `[H]H:MM`，比如+05:30，+6:00等。range  **'-12:59' to '+13:00'**。这种格式**可以精确到分钟**！
- 命名时区，如`Europe/Helsinki`。（但是需要MySQL启用 time zone information table）；

建议使用时间偏移设置时区，好记。

## 时区的影响
时区不会影响这两种：
- 本身就返回UTC的函数，比如UTC_TIMESTAMP；
- 存储为DATE/TIME/DATETIME类型的值；

但是会影响current_xxx等返回当前时间的函数，也会影响timestamp类型。

# 相关时间函数
## 返回时间
MySQL有三个获取时间的函数，分别获取日期、时间、日期加时间：
```
mysql> select CURRENT_DATE, CURRENT_TIME, CURRENT_TIMESTAMP;
+--------------+--------------+---------------------+
| CURRENT_DATE | CURRENT_TIME | CURRENT_TIMESTAMP   |
+--------------+--------------+---------------------+
| 2019-12-24   | 15:34:12     | 2019-12-24 15:34:12 | 
+--------------+--------------+---------------------+
1 row in set (0.00 sec)
```
具体返回的时间用哪个类型去存储，都行。

> 即，CURRENT_TIME并非一定要和TIMESTAMP类型对应，也可以用DATETIME类型存储其返回值。

> 所以不存在CURRENT_DATETIME这个函数也就不奇怪了。

- CURRENT_DATE
- CURRENT_TIME
- CURRENT_TIMESTAMP
- NOW()

## 返回时间戳
```
mysql root@localhost:pokemon> select unix_timestamp();
+------------------+
| unix_timestamp() |
+------------------+
| 1646571888       |
+------------------+
```

- unix_timestamp();

## 转换
- 时间戳转时间：`from_unixtime(x)`；

## 处理时间
还有其他很多处理时间的函数，功能丰富：
- https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html
- https://www.runoob.com/mysql/mysql-functions.html

