---
layout: post
title: "Redis - 数据库功能和持久化"
date: 2021-01-12 01:59:11 +0800
categories: Redis fork
tags: Redis fork
---

Redis的数据库功能，和数据库的持久化。

1. Table of Contents, ordered
{:toc}

# DB
## db number
redis使用redisServer struct保存服务器结构。
- `redisDb *db`：redis数据库数组，默认有16个，默认情况client使用0号db，可以使用SELECT命令切换；

其实就是client的数据结构redisClient struct里有个`redisDb *db`，指向当前使用的db。

redis没有查询当前client所使用的db的指令……所以如果用了不同的数据库，用之前最好先多加一个SELECT命令，省得用错了db。

## dict
**redis的数据库本质上是一个dict**，从redisDb struct里可以看到：
- `dict *dict`；

dict里如果有一对key value，value的类型是hash，那就是dict套dict，开始套娃……

## 增删改查
不同类型使用不同的命令：
- 增：SET；
- 删：DEL；
- 改：SET/HSET等；
- 查：GET/HGET/LRANGE等；

**都是根据value的类型选用的命令，因为key永远是string**。

## 过期时间
可以设置键的过期时间。redis使用unix timestamp表示时间，所以和时区无关。
- EXPIRE key ttl：相对时间，s；
- PEXPIRE key ttl：相对时间，ms；
- EXPIREAT key timestamp：绝对时间，s；
- PEXPIREAT key timestamp：绝对时间，ms；

> SETEX：SET一个key，同时设置EXPIRE

> TIME：返回当前unix timestamp，是个数组，分别是unix timestamp in seconds、microsecond in this second。

- TTL：多久后过期，s；
- PTTL：多久后过期，MS；
- PERSIST key：移出过期时间；

## 过期键删除
实现：redisDb struct里除了有`dict *dict`，还有一个`dict *expires`的dict，用来存储要过期的key和过期时间。

删除策略至少可以有：
- 定时删除：搞一个定时任务，到点执行一次删除操作。需要额外消耗CPU；
- 惰性删除：用到的时候检查一下，发现过期了就删。对内存不友好，key一直用不到就一直不会删，相当于内存泄漏；

redis的策略是结合二者。

**redis数据库本质上是dict和expires两个字典**。

# 持久化
redis是内存型数据库，不持久化一旦崩溃数据会丢失。

redis有两种持久化：
- RDB：redis db，redis里的kv存为一个.db文件；
- AOF：Append Only File，记录redis所执行的**写命令**，一个全新的redis照着别人的AOF文件把所记录的命令执行一遍，数据状态自然就一致了；

## RDB
使用SAVE/BGSAVE生成RDB文件。

BGSAVE是background行为，由主进程fork出一个**子进程**做这件事，所以不阻塞主进程。

> 但是众所周知，`fork()`出的进程几乎就是父进程的copy，而redis是内存型数据库，redis的db所占的空间都算作父进程的内存占用，**那岂不是子进程也有一份一模一样的db内容**？**如果db超过机器总内存的50%，岂不是没办法fork()子进程了**？具体参见“附：redis and linux `fork()`”。




RDB文件只能在启动时自动载入，因为redis不提供类似load的指令。

### 配置BGSAVE
**因为BGSAVE不阻塞主进程，所以可以周期性执行**。一旦满足配置条件，即可执行BGSAVE。

配置条件在redis.conf里，格式为`save <duration seconds> <modification times>`。比如`save 100 10`，代表100s内db只要修改过10次，就执行一次BGSAVE。**这种配置可以配置无数条，任何一个被触发就会执行BGSAVE**。

配置条件的内部实现：
在redisServer struct里，有一个`struct saveparam *saveparams`属性，可看到是一个数组，将配置里的无数条save转为数组的saveparam对象。每次周期任务启动时遍历一下整个数组检查是否有满足的条件即可。

触发条件的记录：
同样是redisServer struct里，有`time_t lastsave`和`long long dirty`属性，分别记录了上次BGSAVE的时间，和这之后db修改的次数。

> redis有周期性操作函数serverCron，每100ms执行一次。

### RDB结构
RDB是二进制文件，从前到后分别是
- "REDIS"：常量，标志着这是一个RDB文件；
- version：记录RDB文件版本，4byte；
- databases：redis默认有16个db，如果某个db不为空，会被依次序列化在此。**如果都为空，这部分不存在**。每个db按照下列格式序列化：
    + "SELECTDB"：1byte；
    + db_number：数据库号码；
    + key_value_pairs：该db的所有kv数据，RDB文件最核心的内容。每个kv按照下列各式序列化；
        - "EXPIRETIME_MS"：1byte，常量，代表这个kv是拥有过期时间的；
        - ms：过期时间，8byte，以ms为单位的unix timestamp；
        - type：该kv的value的类型，1byte；
        - key：按照redis string object规定的方式去序列化；
        - value：根据具体类型的不同，按照该类型redis object规定的方式去序列化；
- "EOF"：常量，1byte，标志正文结束；
- checksum：8byte，由前四部分计算得出，用于验证文件没有损坏；

至于每一个type对应的序列化方式，就不详细了解了……根据之前序列化的经验，每种type（总共也没几种type）有一个自己的序列化方式，根据前方标记的type，使用对应的方法反序列化后面的数据。比如序列化list的时候，写先一个type标记，再写下list的长度，再写下第一个item的长度，再写下第一个item的内容，同理依次写下后面的item。

> 序列化的时候不会序列化过期key，反序列化的时候不会反序列化过期key。

redis编译后src目录下有`redis-check-rdb`，可以检查RDB文件，比如：
```
 % ./redis-check-rdb dump.rdb
[offset 0] Checking RDB file dump.rdb
[offset 26] AUX FIELD redis-ver = '6.0.9'
[offset 40] AUX FIELD redis-bits = '64'
[offset 52] AUX FIELD ctime = '1610279241'
[offset 67] AUX FIELD used-mem = '845432'
[offset 83] AUX FIELD aof-preamble = '0'
[offset 85] Selecting DB ID 0
[offset 139] Checksum OK
[offset 139] \o/ RDB looks OK! \o/
[info] 2 keys read
[info] 0 expires
[info] 0 already expired
```

## AOF
AOF是记录下每一条写redis的命令。

redis启动时，**优先使用AOF文件恢复数据，AOF功能关闭时才使用RDB。因为AOF文件的更新频率通常高于RDB，所以更不容易丢失数据**。

开启AOF，要设置`redis.conf`里的`appendonly yes`。

### 写策略
但是也并不是每有一条写命令，redis就往AOF文件里记录下该命令，毕竟写文件需要系统调用，开销大，影响redis性能。所以redisServer struct里有一个`aof_buf`属性，作为AOF的缓冲区，写命令会先被放到这里。

redis server的主进程是一个event loop，不断循环。每次循环都会：
1. 处理文件事件，接收redis指令，发送回复，在此期间写命令会先写到aof缓冲区；
2. 处理时间事件，比如serverCron函数；
3. flush buffer to AOF；

所以**每次一个循环的结束，写命令会被一起flush到AOF里**。

但是众所周知，调用写命令时，操作系统为了降低写开销，**也会在**os层面搞个缓冲区，所有的写先写到这个缓冲区里，一定条件之后再flush到disk上。Linux也提供了`fsync`和`fdatasync`两个函数，强制flush，立刻写到disk上。

redis写AOF的时候，要不要调用fsync/fdatasync呢？redis将问题丢给了用户，通过配置文件的`appendfsync`配置redis的写行为：
- always：write & fsync，显然性能最差，但每次写都不会丢，真真正正写到了disk上；
- no：just write，什么时候flush到disk上，你os自己决定吧。使用了os搞的缓冲区，写的最快，操作系统挂了/停电了，这些数据并没有同步到disk上，丢了；
- everysec：显然，上面两种的折中方案，如果上次写的内容flush到disk上已经是1s前的事儿了，这次一定调用fsync强制flush到disk上；

显然everysec是最合适的：性能没问题，最多要么丢1s内写的内容，或者最后一次写的内容。

总结一下，这里涉及到**三个层次的性能权衡**：
1. 最底层，os为了性能，搞了个写缓冲区；
2. 最顶层，redis为了性能，仿照os搞了个写缓冲区，一次loop结束后才写AOF；
3. redis写AOF的时候，强制flush到disk还是不强制（或者说要不要使用os的写缓冲区），由用户配置决定；

> AOF的反序列化比较好玩：既然把AOF文件一条条执行一遍，最终db内容就恢复了，那就搞个fake client，读AOF文件，发送命令给redis server，让server依次执行这些指令……

### AOF重写
类似于关系型数据库log的重写，毕竟先写a，再写b，和直接一条命令写a、b效果是一样的。用这种方式可以合并AOF文件中的指令，大大缩小AOF文件体积。

但是，**AOF重写是一个有歧义的名字，并不是分析AOF文件合并指令，而是遍历redis的每一个db的每一个kv，写入新的AOF文件……** 这样就用不着实现一套分析AOF文件的逻辑了……真是个小机灵鬼……

和BGSAVE一样，重写AOF用的是BGREWRITEAOF，显然也要使用子进程来完成。也就是说，子进程**从逻辑上也拥有一份redis db的copy**（详情参考“附：redis and linux `fork()`”），所以redis使用进程相比使用线程，**有一个天然的优势：数据安全！数据都复制一份出来了，怎么操作都不会和原来的内容之间产生并发问题。**

重写AOF是需要时间的，在此期间，父进程里的redis db内容很可能又变了，所以redisServer struct里又定义了一个`list *aof_rewrite_buf_blocks`，**AOF重写缓冲区**，子进程重写新的AOF文件期间，父进程会将所有的写db命令往AOF重写缓冲区里记录一份，子进程重写完之后，父进程将AOF重写缓冲区的内容直接追加在新的AOF文件里。这样新的AOF文件和redis当前的db状态就一致了。

最后，删掉旧AOF，重命名新AOF文件就行了。

> AOF缓冲区和AOF重写缓冲区，目的完全不同。

## RDB vs. AOF
- 数据安全性：redis启动时默认从AOF恢复db，而不是RDB，说明AOF能带来更高的数据安全性。虽然保存RDB的BGSAVE任务每100ms周期执行一次，但未必就满足所配置的BGSAVE的条件。如果redis挂了，从上次保存之后的数据都丢了。AOF则不然，近似最多丢1s的写数据。
- 性能：但显然，AOF需要经常写文件，只有`appendfsync no`，即不写AOF，才比写RDB性能稍好些的。

又是一个性能和数据安全性的考量……

## 启动RDB/AOF
redis默认启动RDB，关闭AOF。

默认的RDB配置是：
```
save 900 1
save 300 10
save 60 10000

dbfilename dump.rdb
```
默认的AOF配置是：
```
# 默认不开启AOF，改成yes即可
appendonly no
appendfilename "appendonly.aof"
appendfsync everysec
```
默认的working directory是：
```
dir ./
```
所以如果RDB和AOF都开启，默认情况下`dump.rdb`和`appendonly.aof`都会写入启动server的当前文件夹。

关闭redis时会提示AOF和RDB都保存了：
```
796:M 12 Jan 2021 02:22:53.398 # User requested shutdown...
796:M 12 Jan 2021 02:22:53.399 * Calling fsync() on the AOF file.
796:M 12 Jan 2021 02:22:53.404 * Saving the final RDB snapshot before exiting.
796:M 12 Jan 2021 02:22:53.407 * DB saved on disk
```

启动redis时提示：
```
900:M 12 Jan 2021 02:28:56.908 * DB loaded from append only file: 0.000 seconds
```
只使用了AOF文件用于恢复db内容。

### 开启AOF配置为什么还是没有生成AOF文件？
**redis启动的时候要指定配置文件，否则就不会从配置文件load配置，直接使用默认配置**。默认配置是不开启AOF的。所以修改了某个配置文件也没用，因为启动的时候没有明确指定load它。

使用specific配置文件启动：
```
./src/redis-server redis.conf
```

# Finally
redis为了实现一种新功能，会不断往redisServer struct等结构里添加属性，让人更直观地感受到：功能都是靠代码堆起来的，靠增加各种数据结构，各种属性。


