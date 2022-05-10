---
layout: post
title: "Innodb：索引的正确使用与拉胯的limit"
date: 2022-05-10 00:43:13 +0800
categories: mysql innodb
tags: mysql innodb
---

最近使用limit对数据库进行分页遍历查询，发现越来越慢。所以进行了一番优化探究，结果极其因吹斯听，深刻重新认识了一波索引。

1. Table of Contents, ordered
{:toc}

# 查询分析
表结构：
- ID为主键；
- USER_ID为二级索引；
- URL          为二级索引；
- 还有其他50+各种类型的列；

1. Query1：
    ```
    select * from TestTable limit 1000000, 1000
    ```
2. Query2：
    ```
    select * from TestTable
    where ID >
    (select ID from TestTable limit 1000000, 1)
    limit 1000;
    ```
3. Query3：
    ```
    select * from TestTable
    where ID > {LAST_FETCHED_ID}
    limit 1000;
    ```

整篇分析依托于[Innodb - 索引]({% post_url 2022-01-15-innodb-index %})介绍的聚簇索引和二级索引。

## Query1 - O(n)
query1是最先使用的版本，每页1000条数据，通过不停改变limit，从而遍历整个数据库。

它不使用索引：
```
select * from TestTable limit 1000000, 1000;
```
越翻页越慢，后面每一页的获取时间，和之前相比都线性增加。

从explain也可以看出，`type=ALL`，它就是一个纯遍历：
```
MySQL [test_db]> explain select * from TestTable limit 1000000, 1000;
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
| id | select_type | table     | partitions | type | possible_keys | key  | key_len | ref  | rows    | filtered | Extra |
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
|  1 | SIMPLE      | TestTable | NULL       | ALL  | NULL          | NULL | NULL    | NULL | 1650764 |   100.00 | NULL  |
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
1 row in set, 1 warning (0.01 sec)
```
这个没太多疑虑，对聚簇索引从前往后遍历，：
1. 肯定越往后需要遍历的行越多，获取一页越慢；
2. **更主要的时间开销：需要转换的列变多**，这个不容易想到，后面介绍limit的时候再说；

## Query2 - O(n)
这个是一个比较畸形的优化，**乍一看确实快了，仔细一想其实还是O(n)的复杂度，所以只做了常量上的优化，没有做复杂度上的优化**，比较有迷惑性。


```
select * from TestTable
where ID >
    (select ID from TestTable limit 1000000, 1)
limit 1000;
```
看看它的执行计划：
```
MySQL [test_db]> explain select * from TestTable
    -> where ID >
    ->     (select ID from TestTable limit 1000000, 1);
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
| id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref  | rows    | filtered | Extra       |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
|  1 | PRIMARY     | TestTable | NULL       | range | PRIMARY       | PRIMARY | 8       | NULL |  825382 |   100.00 | Using where |
|  2 | SUBQUERY    | TestTable | NULL       | index | NULL          | USER_ID | 8       | NULL | 1650764 |   100.00 | Using index |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
```
1. 外查询在获取ID的情况下，直接插了聚簇索引，没有问题；
2. 内查询，**为什么用的是USER_ID index？为什么使用这个二级索引，而不使用聚簇索引？明明是用主键查的**

这个也比较好理解：**仅仅是因为这个secondary index含有ID列，而且更短（另一列就是USER_ID列，再也没别的列了）。所以遍历这个索引的页更快。但本质上它还是在翻页……并不是真正使用了索引，所以时间也是O(n)**。

像这种覆盖所有select column的索引，叫做 **覆盖索引（covering index）**。它的好处是：**不用回表**！所有需要的列碰巧它都有，同时它又比聚簇索引小，所以如果可以，mysql先使用它的优先级高于聚簇索引。

比如查USER_ID列，查的还是这个二级聚簇索引：
```
MySQL [test_db]> explain select URL           from TestTable limit 1000000, 1;                                                                                           
+----+-------------+-----------+------------+-------+---------------+------------------+---------+------+---------+----------+-------------+
| id | select_type | table     | partitions | type  | possible_keys | key              | key_len | ref  | rows    | filtered | Extra       |
+----+-------------+-----------+------------+-------+---------------+------------------+---------+------+---------+----------+-------------+
|  1 | SIMPLE      | TestTable | NULL       | index | NULL          | uk_URL           | 2002    | NULL | 1650764 |   100.00 | Using index |
+----+-------------+-----------+------------+-------+---------------+------------------+---------+------+---------+----------+-------------+
1 row in set, 1 warning (0.00 sec)
```
所以Query2之所以更快，是因为遍历的数据量相对聚簇索引变小了，但本质还是在遍历，时间复杂度不变。

### 强制MySQL换索引
当然也可以强制mysql在查ID的时候走primary index，只要让查询条件按照ID排序就行了：
```
MySQL [test_db]> explain select ID from TestTable order by ID limit 1000000, 1;
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
| id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref  | rows    | filtered | Extra       |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
|  1 | SIMPLE      | TestTable | NULL       | index | NULL          | PRIMARY | 8       | NULL | 1000001 |   100.00 | Using index |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
1 row in set, 1 warning (0.00 sec)
```
USER_ID这个二级索引是按照USER_ID排序的，所以在这样的查询条件下没法使用。这时候只能退而求其次，聚簇索引是按照ID排序的，虽然数据量比二级索引大，但还是可以利用上索引的，所以查的是聚簇索引。

- **这篇文章也解释了这个现象**：https://mariadb.com/resources/blog/innodb-primary-key-versus-secondary-index-an-interesting-lesson-from-explain/

## Query3 - O(1)
真正的优化，应该是这样的：
```
select * from TestTable
where ID > {LAST_FETCHED_ID}
limit 1000;
```
每次记录下上一页的最后一条记录的ID，然后下次直接使用ID通过聚簇索引定位到这条记录。**这个定位是常量级的，不随翻页的深度变大而变慢**。

用的是聚簇索引，range：
```
MySQL [test_db]> explain select * from TestTable where ID > 123456 limit 1000;
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+--------+----------+-------------+
| id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref  | rows   | filtered | Extra       |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+--------+----------+-------------+
|  1 | SIMPLE      | TestTable | NULL       | range | PRIMARY       | PRIMARY | 8       | NULL | 825382 |   100.00 | Using where |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+--------+----------+-------------+
1 row in set, 1 warning (0.00 sec)
```

# explain `type`
explain的[`type`](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html#explain_type)能清晰地告诉我们最终使用的是哪些索引，怎么用的:
- [`range`](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html#jointype_range)：使用索引，获取某些单点扫描区间。**这是我真正的我们所理解的使用索引**；
- **[`index`](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html#jointype_index)：使用索引，但它是“全表扫描”二级索引！！！这个并不是我们通常所理解的使用索引**；
- **[`all`](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html#jointype_all)：真正的全表扫描。扫的是聚簇索引！和上面的`index`是对应的**；

## range
使用不等式查索引：
```
MySQL [test_db]> explain select * from TestTable where USER_ID > 123456 limit 1000;                                                                                      
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+--------+----------+-----------------------+
| id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref  | rows   | filtered | Extra                 |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+--------+----------+-----------------------+
|  1 | SIMPLE      | TestTable | NULL       | range | USER_ID       | USER_ID | 8       | NULL | 825382 |   100.00 | Using index condition |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+--------+----------+-----------------------+
```

## index
遍历整个索引，这里遍历的是二级索引USER_ID：
```
MySQL [test_db]> explain select ID from TestTable limit 1000000, 1;                                                                                                      
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
| id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref  | rows    | filtered | Extra       |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
|  1 | SIMPLE      | TestTable | NULL       | index | NULL          | USER_ID | 8       | NULL | 1650764 |   100.00 | Using index |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------------+
1 row in set, 1 warning (0.01 sec)
```

## all
遍历聚簇索引：
```
MySQL [test_db]> explain select * from TestTable limit 1000000, 1000;
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
| id | select_type | table     | partitions | type | possible_keys | key  | key_len | ref  | rows    | filtered | Extra |
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
|  1 | SIMPLE      | TestTable | NULL       | ALL  | NULL          | NULL | NULL    | NULL | 1650764 |   100.00 | NULL  |
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
1 row in set, 1 warning (0.01 sec)
```

所以像`select id from test`这种语句（id为主键），默认使用的是二级索引的遍历。

Ref:
- https://stackoverflow.com/a/72161700/7676237

# 拉胯的limit
如果两个查询都走聚簇索引，他们应该是一样快的：
```
MySQL [test_db]> select * from TestTable limit 1000000, 1;                                
1 row in set (2.16 sec)

MySQL [test_db]> select * from TestTable order by ID limit 1000000, 1;
1 row in set (2.19 sec)
```
的确如此。

**前者type=ALL，是遍历聚簇索引，后者type=index且key=PRIMARY，所以它也是遍历聚簇索引**：
```
MySQL [test_db]> explain select * from TestTable limit 1000000, 1;             
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
| id | select_type | table     | partitions | type | possible_keys | key  | key_len | ref  | rows    | filtered | Extra |
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
|  1 | SIMPLE      | TestTable | NULL       | ALL  | NULL          | NULL | NULL    | NULL | 1650816 |   100.00 | NULL  |
+----+-------------+-----------+------------+------+---------------+------+---------+------+---------+----------+-------+
1 row in set, 1 warning (0.00 sec)

MySQL [test_db]> explain select * from TestTable order by ID limit 1000000, 1;   
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------+
| id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref  | rows    | filtered | Extra |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------+
|  1 | SIMPLE      | TestTable | NULL       | index | NULL          | PRIMARY | 8       | NULL | 1000001 |   100.00 | NULL  |
+----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+----------+-------+
1 row in set, 1 warning (0.00 sec)
```

**但同样是遍历聚簇索引，却因为select的column少了，就快了很多**：
```
MySQL [test_db]> select ID from TestTable order by ID limit 1000000, 1;                   
+---------+
| ID      |
+---------+
| 2052794 |
+---------+
1 row in set (0.59 sec)
```
0.59s，上面的查询是2.10s+。

尝试把`select *`去掉，换成`select col1, col2, ...`，删掉了那些text、varchar列，果然也快了一些，大概1.5s+。所以删减一些列确实会变快！为什么？难道大家不都是遍历聚簇索引，最后获取第1000001条数据吗？这条数据获取几个field，不应该对最终的查询时间影响这么大啊！

> 我一度怀疑`select ID from TestTable order by ID`走的不是聚簇索引……要不它为啥比走聚簇索引的快……不过这显然不可能。
> 
> 也一度产生幻觉：难道还有一个基于primary key的secondary index……走的是这个索引，所以快了？不过这个假定很快被推翻了，因为`select ID, <col1> from TestTable order by ID`也很快。
>
> 还有人告诉我`select ID`没有走聚簇索引的leaf page，只走了inner page……我不信。事实证明确实不可能不走leaf page。只要遍历，遍历的就是leaf page。

**最后终于发现被告知是[limit的实现](https://mp.weixin.qq.com/s/CM7a6XageZEZ4008Ha8bew)的锅**……limit并不是我们想象中的先找到第n条记录，再获取它的field。而是先把第一条数据转为结果，转完了发现不对，后面还有个limit条件，这行数据，不满足limit……然后丢掉这条数据，再去转第二条……直到转换到第n条……**这么多条转换的开销叠加起来，`select *`可不得比`select ID`慢一大截嘛**……

Ref：
- https://stackoverflow.com/a/72173942/7676237

> Q：各位大佬，同样是遍历聚簇索引（通过强制使用主键排序达到该目的），为什么query1（500ms）要比query2（2000ms）快很多呢：
> - select ID, URL from TABLE order by ID limit 1000000, 1
> - select * from TABLE order by ID limit 1000000, 1
>
> ID是主键，URL是一个非索引字段。
>
> 感觉是和选择的column有关，但实在不知道具体该怎么解释。非常感谢~
>
> A：“将存储引擎记录转换为mysql格式记录也需要时间，转的字段越多，自然花费时间越多”
>
> Q：为什么不先找到第1000001条记录，再转呢？我一直是这么理解的，所以感觉最后的转换那一步转的field多点儿少点儿都不影响
>
> A：“mysql就是这么实现的，我们之前有一篇讲limit如何工作的文章，可以找出来看看”

## 开销比较
当然，论快还是convering index快，毕竟人家比聚簇索引小，转换的field又少：
```
MySQL [test_db]> select ID from TestTable limit 1000000, 1;                               
+---------+
| ID      |
+---------+
| 2052794 |
+---------+
1 row in set (0.19 sec)
```

把上面关于limit查询的开销记录一下：
1. 二级索引，只转换ID：0.19s；
2. 聚簇索引，只转换ID：0.59s；
3. 聚簇索引，转换所有field：2.19s；

所以聚簇索引比二级索引大，导致找到第1000001条，开销多了0.4s。但是转一个ID列和转所有的field列，开销多了1.6s！**所以limit不要和`select *`一起用，太窒息了**……

## limit总结
limit离谱的原因：MySQL是在server层准备向客户端发送记录的时候才会去处理LIMIT子句中的内容（mysql：诶，刚看到，这里还有个limit）；

**limit和`select *`一起使用：极大的浪费**！和limit一起用的时候，select选的column越少越好，最好能让二级索引变成覆盖索引。即使要使用聚簇索引，也尽量选择少量的field（**此时选择id和选择其他field区别不大了，毕竟聚簇索引是一个绝对的covering index，但是field选的多少会影响效率**）

优化策略：limit不和`select *`一起用，但是又的确需要所有field，**那就内层limit+only id field，外层根据id选`select *`**。
```
select * from t where id = (select id from t order by id limit 1000000, 1)
```
或者：
```
SELECT * FROM t, (SELECT id FROM t ORDER BY key1 LIMIT 5000, 1) AS d
    WHERE t.id = d.id;
```

> 由于该子查询的查询列表只有一个id列，MySQL可以通过仅扫描二级索引idx_key1执行该子查询，然后再根据子查询中获得到的主键值去表t中进行查找。

- 如果查的是聚簇索引，就省去了前n条记录全部field转换的开销（**一般人不易发现**）；
- 如果查的是二级索引，这样就省去了前n条记录的回表操作，从而大大提升了查询效率（**这个又要回表又要全部field转换，开销就容易被人意识到了**）；


# 索引冷启动
第一次使用索引的时候，速度是很慢的：
```
MySQL [test_db]> select URL           from TestTable limit 1000000, 1;
+----------------------------------------------------------+
| URL                                                      |
+----------------------------------------------------------+
| https://www.youtube.com/channel/UC4cDp-MuRZGcwSW3NA |
+----------------------------------------------------------+
1 row in set (1.32 sec)
```
一开始我以为是这个索引的查询速度太慢了……但第二次执行之后，我才意识到是这个索引没有被用过……第一次加载到buffer pool，显然慢。

所以测试索引速度的时候，别忘了把这个因素考虑在内。

