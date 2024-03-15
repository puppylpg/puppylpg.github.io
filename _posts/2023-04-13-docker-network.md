[toc]

---
layout: post
title: "Docker - network"
date: 2023-04-13 23:42:17 +0800
categories: docker
tags: docker
---

没想到docker的网络竟然用到了iptables。

1. Table of Contents, ordered
{:toc}

# network
docker网络用于：
1. 容器间通信；
2. 和非容器通信；

学习docker网络有两种视角：
1. 从容器的视角看：容器里的网络就和我们普通电脑上的网卡一样，至于另一端是和谁通信的，我们并不关心；
2. 从docker开发者的视角来看：docker网络底层是通过[操纵host主机上的`iptables`规则](https://docs.docker.com/network/packet-filtering-firewalls/)来实现的；

作为docker使用者，我们应该主要学习第一种视角。

## drivers
容器默认就有网络支持，可以和外部连接（相当于已经插上网卡了）。**不管是用哪种底层网络，从容器的视角看，他们都是一样的：容器只能看到它有一个带ip地址的网卡**，和一些其他网络细节（gateway、routing tables、dns service、so on），至于它连接的是哪一种网络、他们通信的另一端是容器还是非容器，对他们来说都是不可知的。这和我们对于电脑硬件网络的认知是一样的。

> Containers have networking enabled by default, and they can make outgoing connections. **A container has no information about what kind of network it's attached to, or whether their peers are also Docker workloads or not. A container only sees a network interface with an IP address, a gateway, a routing table, DNS services, and other networking details**. That is, unless the container uses the `none` network driver.

目前只需知道在单机上一般使用bridge类型的网络。

## 网络操作
不管用哪种driver，docker提供的[操作命令](https://docs.docker.com/network/)都是差不多的。

### 创建网络
**所有的容器都有网卡，所以会连接到一个网络（除非显式设置driver为`none`）**。

可以通过`docker network create`创建网络，并通过`--network=<network>`连接网络：
```bash
docker network create -d bridge my-net
docker run --network=my-net -itd --name=container3 busybox
```
所有接在同一个网络上的容器可以相互通信（局域网）。ip通信肯定是可以的，使用container name作为域名通信在`docker0`上不行，在其他用户创建的bridge网络上可以。

### `docker0`
为了方便，docker已经默认创建了一个名为`docker0`的bridge网络，如果启动容器的时候不指定网络信息，就会默认连接到`docker0`上。因此，**所有的容器如果不指定网络，都是能相互联通的**。

也可以在启动容器时使用`--network container:<container name|id>`直接连上另一个容器使用的网络。

### 发布端口
连接在docker网络上的容器**不能从网络外部访问**，只能从内部访问，所以容器间是可以相互通信的。**如果只需要容器间相互通信，没必要把端口发布出来**。

> 但是容器本身可以访问外部公网。**所以它就相当于一个局域网**。

如果需要从网络外部访问网络内部的容器（卧槽这不就是DNAT嘛！），需要使用`-p <host port>:<container port>`设置端口映射，这样就可以在主机上访问host port，以访问容器。**这分明就是DNAT啊！提前在路由上预设好端口映射，以从外部访问局域网！**

> 通过使用`-p|--publish`参数将容器的端口映射到主机的端口上，相当于在主机上设置了DNAT规则，使得外部可以通过主机的端口访问到容器内部的服务。这样就实现了从外部访问局域网内部的服务的功能。
>
> DNAT：Destination NAT，和NAT相反。NAT是从内部访问外部，访问的时候临时生成端口映射。DNAT是从外部访问内部，需要提前写死端口映射。

### ip和hostname
容器不仅可以认为自带网卡，还是多块网卡，所以容器可以接入很多网络，每一个网络都会给它分配一个ip。甚至还可以手动指定ip地址：
> You can connect a running container to multiple networks, either by passing the `--network` flag multiple times when creating the container, or using the `docker network connect` command for already running containers. In both cases, you can use the `--ip` or `--ip6` flags to specify the container's IP address on that particular network.

**container连接上的每个网络都会给container分配一个ip**，符合物理机——有多个网卡才能接入多个网络。

> By default, the container gets an IP address for every Docker network it attaches to. A container receives an IP address out of the IP pool of the network it attaches to. The Docker daemon effectively acts as a DHCP server for each container. Each network also has a default subnet mask and gateway.

hostname则是容器id，同样可以使用`--hostname`修改。

### DNS
容器的dns默认就是host的dns，可以使用`--dns`修改。自定义网络的dns是docker的内置dns服务器，如果需要查找外部域名，内置dns会把请求委托给host的dns（容器是可以访问外部公网服务的）。

### proxy
容器也是可以设置[代理](https://docs.docker.com/network/proxy/)的，有需要再翻阅。

# network drivers
- `bridge`：如果需要通信的容器都在同一个host上，他们之间应该使用bridge网络。**bridge相当于host（类似路由器）下挂的一个局域网段**；
- `host`：容器和host没有隔离，直接用host的网络。**容器没有自己的ip，直接占用host的端口**；
- `overlay`：跨节点网络。overlay network可以连接多个host上的docker daemon进行组网；
- `none`：没有网卡的容器，根本就没有网，无论外部访问它还是它访问外部都是不可能的；
- `macvlan`：**给容器分配一个mac地址，使得容器就像是网络上的一个物理设备**。为了**让host的一个网卡有一对多的效果**，此时host的网卡必须设置为**混杂模式**，让host能接收所有的mac地址包，然后**docker daemon把mac地址在macvlan里的包转发给挂在macvlan上的相应容器**；

## bridge

### bridge的本义
**bridge就是网桥，往后就发展成交换机了**。

bridge network在[Wikipedia](https://en.wikipedia.org/wiki/Network_bridge)的解释是：网桥是一种计算机**网络设备**，可**从多个通信网络或网段创建单个聚合网络**。
> A network bridge is a computer networking device that **creates a single, aggregate network from multiple communication networks or network segments**. This function is called network bridging.

所以bridge就是把多个设备，或者多个网段连起来，变成一个网络。**这是一个很形象的词，就好像桥一样连接多块陆地，把他们变成一块陆地**。或者从bridge的原始形态来理解，它就相当于把所有的设备都用网线连在一起了，变成一个局域网。

bridge和路由是不同的，因为它把多块网络或多个设备连起来之后，这些设备就可以畅通无阻通信了，**没有隔离功能**。路由器允许不同子网交流的同时，还能保证子网的网段也是隔离的：
> Bridging is distinct from routing. Routing allows multiple networks to communicate independently and yet remain separate, whereas bridging connects two separate networks as if they were a single network.

所以**bridge是工作在二层数据链路层的，路由器是工作在三层ip层（网络层）的**。

### linux的bridge
linux内核可以用`ip`命令创建虚拟的bridge，就像真实网络设备一样：
```bash
$ sudo ip link add puppy type bridge

$ sudo ip link delete puppy
```
之后可以继续使用`ip`命令把网卡接到bridge上。

**docker创建bridge其实就是调用的linux内核接口。**

### bridge的特性
**host相当于一个路由器，bridge相当于是host下的一个局域网，用于单机部署多个docker容器**。docker默认会创建一个bridge网络——`docker0`。

> **WSL也相当于host下的一个局域网**！WSL的ip就是host分配的WSL网段中的一个。

所有的container如果没有指定network，都会默认连接到docke-r0上，**因此他们之间默认是联通的，可以相互通信**。如果是生产环境，[建议使用自己创建的bridge网络](https://docs.docker.com/network/bridge/#differences-between-user-defined-bridges-and-the-default-bridge):
- 更好的隔离性。因为只有连上该网络才能通信，而docker0默认都连上，都可以相互通信；
- **自己创建的bridge网络支持自动DNS，可以直接用容器名通信**，而docker0只能用ip通信；
- 自己创建的bridge网络支持容器**热插拔**，不需要关闭容器，而docker0必须停掉容器，再重新创建一个不连接到docker0（`--network`）的容器……

### bridge网络上的连通性测试
测试一下docker0只能使用ip，而非容器名——

容器a：
```bash
PS C:\Users\puppylpg> docker run --rm -d --name a-in-docker0 alpine sleep 1h
f0b11987ef36b83fb7139cb097a2e7edebe7e5572429d47ae6505a7ffe257be6
```

容器b：
```bash
PS C:\Users\puppylpg> docker run --rm -it --name b-in-docker0 alpine sh

/ # ip addr
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
2: tunl0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN qlen 1000
    link/ipip 0.0.0.0 brd 0.0.0.0
3: sit0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN qlen 1000
    link/sit 0.0.0.0 brd 0.0.0.0
11: eth0@if12: <BROADCAST,MULTICAST,UP,LOWER_UP,M-DOWN> mtu 1500 qdisc noqueue state UP
    link/ether 02:42:ac:11:00:03 brd ff:ff:ff:ff:ff:ff
    inet 172.17.0.3/16 brd 172.17.255.255 scope global eth0
       valid_lft forever preferred_lft forever
       
/ # ping 172.17.0.2
PING 172.17.0.2 (172.17.0.2): 56 data bytes
64 bytes from 172.17.0.2: seq=0 ttl=64 time=0.136 ms
64 bytes from 172.17.0.2: seq=1 ttl=64 time=0.051 ms
^C
--- 172.17.0.2 ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 0.051/0.093/0.136 ms

/ # ping a-in-docker0
^C
/ #
```
无法使用a的容器名和a通信。

容器a（通过sh连上，不影响之前的sleep进程）：
```bash
PS C:\Users\puppylpg> docker exec -it a-in-docker0 sh

/ # ps aux
PID   USER     TIME  COMMAND
    1 root      0:00 sleep 1h
   18 root      0:00 sh
   24 root      0:00 ps aux

/ # ip addr
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
2: tunl0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN qlen 1000
    link/ipip 0.0.0.0 brd 0.0.0.0
3: sit0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN qlen 1000
    link/sit 0.0.0.0 brd 0.0.0.0
9: eth0@if10: <BROADCAST,MULTICAST,UP,LOWER_UP,M-DOWN> mtu 1500 qdisc noqueue state UP
    link/ether 02:42:ac:11:00:02 brd ff:ff:ff:ff:ff:ff
    inet 172.17.0.2/16 brd 172.17.255.255 scope global eth0
       valid_lft forever preferred_lft forever

/ # ping b-in-docker0
^C

/ # ping 172.17.0.3
PING 172.17.0.3 (172.17.0.3): 56 data bytes
64 bytes from 172.17.0.3: seq=0 ttl=64 time=0.054 ms
64 bytes from 172.17.0.3: seq=1 ttl=64 time=0.061 ms
^C
--- 172.17.0.3 ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 0.054/0.057/0.061 ms
/ #
```
同样只能通过ip通信。

## host
如果启动一个nginx：
```bash
docker run --rm -d --network=host --name nginx nginx
```
直接可以在host上通过`localhost:80`访问。使用`netstat`可以看到80端口被占用了，相当于直接在host上起了一个nginx服务。

可以再启动一个alpine，进去执行一下`ip addr`，会发现和在host上执行该命令的效果相同：
```bash
docker run --rm -it --network=host --name alpine alpine sh
```

host类型的网络的使用场景：**容器需要很高的网络传输速度，因为实际上少做了一层NAT。因此，`-p`参数也会失效，因为不需要NAT的端口映射了**。

> 这种模式的容器连接在docker提前创建的host类型的网络上（bridge类型的网络叫docker0）。

## none
这样的容器**根本就没有网卡**，只有loopback：
```bash
$ docker run --rm -it --network=none --name alpine alpine sh
/ # ping www.baidu.com
^C
/ # ip addr
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
/ #
```

## macvlan
在Debian上用docker装openwrt做旁路由的时候，接触到了macvlan。

> 失败很多次后才发现，必须在有线网卡上搞，无线网卡上不行。

首先给host的有线网卡开启混杂，因为macvlan就是一个mac映射为多个mac，所以要让网卡通过混杂模式接收所有的mac帧：
```bash
~ sudo ip link set enp2s0 promisc on
```
创建一个macvlan网络，子网和网关设置的和host一致，这样该网络上的容器的网卡相当于此子网下的一个真实的物理硬件：
```bash
~ docker network create -d macvlan \
  --subnet=192.168.0.0/24 \
  --gateway=192.168.0.1 \
  -o parent=enp2s0 mvlan
```
启动openwrt：
```bash
~ docker run -d --restart always --name openwrt --network mvlan --privileged sulinggg/openwrt:x86_64 /sbin/init

~ docker exec -it openwrt bash
# 修改openwrt网络配置
bash-5.1# vim /etc/config/network
```
配置interface为当前网段，设置ipaddr，给openwrt容器静态绑定一个ip：`192.168.0.198`
```
config interface 'lan'
        option ifname 'eth0'
        option proto 'static'
        option netmask '255.255.255.0'
        option ip6assign '60'
        option ipaddr '192.168.0.198'
        option gateway '192.168.0.1'
        option dns '192.168.0.1'
```
**查看openwrt容器的网卡，可以看到eth0的ip为`192.168.0.198`，虚拟出来的硬件地址为`02:42:c0:a8:00:02`**：
```bash
bash-5.1# ip addr
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
7: eth0@if2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default
    link/ether 02:42:c0:a8:00:02 brd ff:ff:ff:ff:ff:ff link-netnsid 0
    inet 192.168.0.198/24 brd 192.168.0.255 scope global eth0
       valid_lft forever preferred_lft forever
    inet6 fe80::42:c0ff:fea8:2/64 scope link
       valid_lft forever preferred_lft forever
```
**此时再去查看路由器的ip-mac记录，真看到了一条`192.168.0.198`和`02:42:c0:a8:00:02`的映射记录！**

而且，局域网内的设备可以和这个虚拟设备相互ping通！虚拟硬件ping局域网里的另一个硬件：
```bash
bash-5.1# ping 192.168.0.103
PING 192.168.0.103 (192.168.0.103): 56 data bytes
64 bytes from 192.168.0.103: seq=0 ttl=128 time=0.557 ms
64 bytes from 192.168.0.103: seq=1 ttl=128 time=0.364 ms
^C
--- 192.168.0.103 ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 0.364/0.460/0.557 ms
```

反过来：
```bash
Ξ ~ → ping 192.168.0.198
PING 192.168.0.198 (192.168.0.198): 56 data bytes
64 bytes from 192.168.0.198: icmp_seq=0 ttl=63 time=0.688 ms
64 bytes from 192.168.0.198: icmp_seq=1 ttl=63 time=0.482 ms
^C--- 192.168.0.198 ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max/stddev = 0.482/0.585/0.688/0.103 ms
```
但是openwrt容器和它的host无法ping通，不知道为啥。

## 教程
不同类型网络的官方教程：
- [bridge](https://docs.docker.com/network/network-tutorial-standalone/)
- [host](https://docs.docker.com/network/network-tutorial-host/)
- [macvlan](https://docs.docker.com/network/network-tutorial-macvlan/)

# 从开发者视角看docker network
docker的网络隔离是[通过`iptables`实现的](https://docs.docker.com/network/packet-filtering-firewalls/)！（也离不开虚拟网络设备）

## iptables
什么是iptables？先看一下[Docker - 虚拟化网络设备]({% post_url 2023-05-28-docker-network-virtualizization %})里关于netfilter框架的示意图，再直接参考我大三下写的笔记[《Linux上使用iptables设置防火墙》](https://blog.csdn.net/puppylpg/article/details/51173505)——

因为老师留作业要对Netfilter内核模块进行扩展编程，因此在此之前先学习了一下iptables的用法，笔记一下，忘了就来看看。

首先推荐一篇[不错的博客](http://www.cnblogs.com/JemBai/archive/2009/03/19/1416364.html)，作为参考补充。

### iptables和netfilter
先说一下iptables和netfilter的关系：

netfilter在内核空间的代码根据table中的rules，完成对packet的分析和处置。但是这些table中的具体的防火墙rules，还是必须由系统管理员亲自编写。内核中的netfilter只是提供了一个机制，它并不知道该怎样利用这个机制，写出合适的rules，来实现一个网络防火墙。

那么，系统管理员编写的rules，怎样进入位于内核空间中的netfilter维护的table中去呢？这个任务是由iptables这个工具来完成的。

**说白了就是netfilter是位于内核里的，iptables是位于用户空间的管理工具。有了iptables，用户空间就可以和内核中的netfilter进行交流，维护table中的防火墙rules了。**

### iptables的一丁点儿基本知识
#### 表 （tables）
iptables 包含 5 张表（tables）:
- raw 用于配置数据包，raw 中的数据包不会被系统跟踪。
- filter 是用于存放所有与防火墙相关操作的默认表。
- nat 用于 网络地址转换（例如：端口转发）。
- mangle 用于对特定数据包的修改（参考 损坏数据包）。
- security 用于 强制访问控制 网络规则。
大部分情况仅需要使用 filter 和 nat。其他表用于更复杂的情况——包括多路由和路由判定。

#### 链 （chains）
我们暂时主要了解一下filter的过滤好了。

表由链组成，链是一些按顺序排列的规则的列表。**默认的 filter 表包含 INPUT， OUTPUT 和 FORWARD 3条内建的链，这3条链用于数据包过滤**。

#### 规则 （rules）
数据包的过滤基于规则。规则由一个目标（数据包包匹配所有条件后的动作）和很多匹配（导致该规则可以应用的数据包所满足的条件）指定。一个规则的典型匹配事项是数据包进入的网卡（例如：eth0 或者 eth1）、数据包的类型（ICMP, TCP, 或者 UDP）和数据包的目的端口。

### 配置filter表的具体操作
在我的Arch上，执行iptables的话需要root权限，毕竟是对内核功能的操作。

**查看当前iptables的设置**
```bash
pArch# iptables -nvL
Chain INPUT (policy ACCEPT 1 packets, 52 bytes)
 pkts bytes target     prot opt in     out     source               destination         

Chain FORWARD (policy ACCEPT 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination         

Chain OUTPUT (policy ACCEPT 1 packets, 52 bytes)
 pkts bytes target     prot opt in     out     source               destination 
```
默认三条链都是ACCEPT。

以上参数的意义：
```
-L, --list [chain]
              List all rules in the selected chain.  If no chain is selected, all chains are listed. 
              
-n, --numeric
              Numeric output.  IP addresses and port numbers will be printed in numeric format.  By default, the program will  try to display them as host names, network names, or services (whenever applicable).

-v, --verbose
              Verbose output.  This option makes the list command show the interface name, the rule options (if any), and the  TOS masks.   The  packet  and  byte  counters  are  also listed, with the suffix 'K', 'M' or 'G' for 1000, 1,000,000 and 1,000,000,000 multipliers respectively.
```
上面的三条链INPUT/FORWARD/OUTPUT全为空，表明还没有配置规则。没有数据包被阻止，均被接受。

**清除原有规则**

```
pArch# iptables -F  #清除预设表filter中的所有规则链的规则
pArch# iptables -X  #清除预设表filter中使用者自定链中的规则
```
如果已经有了过滤规则，可以通过以上命令清空，然后再一步步设置。

**预设规则**

比如将INPUT（所有接收的包）默认都丢掉，禁止一切来客：
```bash
pArch# iptables -P INPUT DROP
pArch# iptables -nvL         
Chain INPUT (policy DROP 26 packets, 3074 bytes)
 pkts bytes target     prot opt in     out     source               destination         

Chain FORWARD (policy ACCEPT 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination         

Chain OUTPUT (policy ACCEPT 22 packets, 1626 bytes)
 pkts bytes target     prot opt in     out     source               destination      
```
其中参数：
```
-P, --policy chain target
              Set  the  policy  for  the chain to the given target. Only built-in (non-user-defined) chains can have policies, and neither built-in nor user-defined chains can be policy targets.
```
可以看到，INPUT的policy已经变成DROP了，而立刻就有妄图发到我的电脑的26 packets, 3074 bytes被丢弃了。

*注：如果你是远程SSH登陆的话，当你输入第一个命令回车的时候就应该掉了，因为设置完默认丢弃所有包之后，没有设置任何可以接收的包。掉线了怎么办呢,只能去本机操作了=.=!*

**添加规则**

由于刚刚我们默认INPUT为DROP，则所有进入计算机的包都会被防火墙丢掉，本机收不到任何包。也就是说此时如果进行`ping www.baidu.com`的话是不会成功的，**因为icmp的echo request报文（OUTPUT）虽然发出去了，但是echo response报文（INPUT）被drop了**。

为了能ping通，我们需要设置icmp报文为可接受状态：
```bash
pArch# iptables -A INPUT -p icmp -j ACCEPT
pArch# iptables -nvL --line-numbers       
Chain INPUT (policy DROP 227 packets, 36248 bytes)
num   pkts bytes target     prot opt in     out     source               destination         
1       18  1869 ACCEPT     icmp --  *      *       0.0.0.0/0            0.0.0.0/0     
```
其中：
```
-A, --append chain rule-specification
              Append one or more rules to the end of the selected chain.  When the source and/or destination names resolve to more than one address, a rule will be added for each possible address combination.

[!] -p, --protocol protocol
              The  protocol  of the rule or of the packet to check.  The specified protocol can be one of tcp, udp, udplite, icmp, icmpv6,esp, ah, sctp, mh or the special keyword "all", or it can be a numeric value, representing one of these  pro‐tocols or a different one.  

-j, --jump target
              This specifies the target of the rule; i.e., what to do if the packet matches it.  
```
所以`iptables -A INPUT -p icmp -j ACCEPT`的意思就是给INPUT链添加一条规则，对于所有的icmp协议，都ACCEPT。

这样的话ping就可以执行了。

#### 小实验
我们都知道访问服务器的80端口可以上网，所以我们使用iptables对自己的防火墙进行设置：除了上网的报文，其余所有出去的报文均被拦截。

设置之后的效果：
```bash
pArch# iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT
pArch# iptables -nvL --line-numbers
Chain INPUT (policy ACCEPT 1 packets, 52 bytes)
num   pkts bytes target     prot opt in     out     source               destination         

Chain FORWARD (policy ACCEPT 0 packets, 0 bytes)
num   pkts bytes target     prot opt in     out     source               destination         

Chain OUTPUT (policy DROP 0 packets, 0 bytes)
num   pkts bytes target     prot opt in     out     source               destination         
1     171K   11M ACCEPT     tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:80
```
其中`--dport`代表destination port，目的端口号；`--sport`代表source port，源端口号。

上面的设置就是说我的电脑对访问外部服务器的80端口的tcp协议报文是放行的，即对请求网页的报文是放行的，再说白点儿就是允许上网。

然后当我在浏览器中上百度的时候却发现无论如何都上不去。这不科学！应该是可以上网的啊，我已经把通往外网80端口的数据包默认放行了啊！

后来找了半天原因，才发现百度的网址是https://www.baidu.com/，是https而不是http，而https所对应的端口是443（443/TCP	HTTPS - HTTP over TLS/SSL（加密传输）），不是80（80/TCP	HTTP（超文本传输协议）- 用于传输网页）。

于是我果断换了个网址，访问新浪http://www.sina.com.cn/，果然就成功了。

然后把443端口也设为ACCEPT，`iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT`，再上百度果然就行了。

> 后注：哈哈哈，时代的眼泪，2016年的时候新浪竟然还不支持https。

## `FORWARD` chain
看完了上面的笔记，除了发现一些时代的印记，还能发现文中的例子（icmp和http）操作的都是INPUT/OUTPUT chain，并没有涉及到FORWARD chain。因为这两条chain很符合我们的使用场景：**由本机发出去的包（source ip是本机）走的是OUTPUT chain，由本机收到的包（target ip是本机）走的是INPUT chain，所以我们很好模拟**。

但是forward chain比较特殊：**只有源ip不是自己（不是我产生的），且目的ip也不是自己的报文（也不是发给我的），才是需要被host forward的报文**。也就是说，[我们的电脑被当成一个路由器了](https://www.baeldung.com/linux/iptables-output-vs-forward-chains#the-forward-chain)，要不然是不会有这种包的。所以大三的时候并没有模拟出这种包。
> Let's envision a scenario where we configure our host as a network gateway. In this setup, packets from one network segment arrive at our host and need to be forwarded to another network segment. The packets that pass through the host, without being the source or destination of the packets, are precisely the ones that traverse the FORWARD chain.

但是时代变了，有了docker之后，我们现在的主机就像是docker网络的路由，docker网络就像一个子网，**子网里容器产生的报文就把host当成了一个路由器**：
- 容器发出的包：source ip是容器ip，target ip是外部ip，和host无关；
- 容器收到的包：source ip是外部ip，target ip是容器ip，和host无关；

所以**docker使用的正是host上的`FORWARD` chain！docker要配置好host上的`FORWARD` chain，才能让容器能够正常和外部网络联通**。

## docker对`FORWARD` chain的修改
docker对iptables的修改，就是对`FORWARD` chain的修改：
1. 首先`FORWARD` chain被默认设为drop，只有显式设置为ACCEPT的rule才能成功forward；
1. 在`FORWARD` chain里添加一条`DOCKER` chain：所有docker自己设置的iptables规则都在这里，**用户勿动**；
2. 但是这样就意味着别的基于iptables的firewall设置的规则不一定生效了，因为DOCKER chain优先于其他chain；
    > Rules added to the `FORWARD` chain -- either manually, or by another iptables-based firewall -- are evaluated after these chains. This means that if you publish a port through Docker, this port gets published no matter what rules your firewall has configured.
3. 因此docker还添加了一条`DOCKER-USER` chain：**优先级比DOCKER chain还高**，用于用户设置iptables规则。对于上述第三方规则，如果想让他们优先于docker，就放到这里；
    > If you want those rules to apply even when a port gets exposed through Docker, you must add these rules to the `DOCKER-USER` chain.

现在的`FORWARD` chain优先级是：**`DOCKER-USER` chain > `DOCKER` chain > other chains**。

## `DOCKER` chain
举个例子来看一看`DOCKER` chain里到底有什么。

假设系统部署了两个publish port到host的container：
1. nginx-proxy，在bridge网络`docker0`上，ip为172.17.0.7，publish 80/443；
2. mongo-db，在一个自定义的bridge网络`youtube-dl_default`上，ip为172.18.0.3，publish 27017；

查看此时host的iptables：
```bash
$ sudo iptables -vL
Chain INPUT (policy ACCEPT 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination

Chain FORWARD (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination                     
 82M   91G DOCKER-USER  all  --  any    any     anywhere             anywhere
  82M   91G DOCKER-ISOLATION-STAGE-1  all  --  any    any     anywhere             anywhere              
  931K 1890M ACCEPT     all  --  any    br-7f97ab2bdd72  anywhere             anywhere             ctstate RELATED,ESTABLISHED                                                                                     
  1280 74796 DOCKER     all  --  any    br-7f97ab2bdd72  anywhere             anywhere      
  78214 6170K ACCEPT     all  --  br-7f97ab2bdd72 !br-7f97ab2bdd72  anywhere             anywhere    
  950 57000 ACCEPT     all  --  br-7f97ab2bdd72 br-7f97ab2bdd72  anywhere             anywhere
  60M   57G ACCEPT     all  --  any    docker0  anywhere             anywhere             ctstate RELATED,ESTABLISHED 
  58990 3575K DOCKER     all  --  any    docker0  anywhere             anywhere                
  21M   31G ACCEPT     all  --  docker0 !docker0  anywhere             anywhere              
  26929 1636K ACCEPT     all  --  docker0 docker0  anywhere             anywhere

Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination

Chain DOCKER (2 references)                                                                                                                                                                                        
pkts bytes target     prot opt in     out     source               destination
27504 1662K ACCEPT     tcp  --  !docker0 docker0  anywhere             172.17.0.7           tcp dpt:https
 3840  234K ACCEPT     tcp  --  !docker0 docker0  anywhere             172.17.0.7           tcp dpt:http
  330 17796 ACCEPT     tcp  --  !br-7f97ab2bdd72 br-7f97ab2bdd72  anywhere             172.18.0.3           tcp dpt:27017

Chain DOCKER-ISOLATION-STAGE-1 (1 references)
 pkts bytes target     prot opt in     out     source               destination
78214 6170K DOCKER-ISOLATION-STAGE-2  all  --  br-7f97ab2bdd72 !br-7f97ab2bdd72  anywhere             anywhere
  21M   31G DOCKER-ISOLATION-STAGE-2  all  --  docker0 !docker0  anywhere             anywhere
  83M   91G RETURN     all  --  any    any     anywhere             anywhere

Chain DOCKER-ISOLATION-STAGE-2 (2 references)                                                                                                                                                                      
pkts bytes target     prot opt in     out     source               destination
    0     0 DROP       all  --  any    br-7f97ab2bdd72  anywhere             anywhere
    0     0 DROP       all  --  any    docker0  anywhere             anywhere
  21M   31G RETURN     all  --  any    any     anywhere             anywhere

Chain DOCKER-USER (1 references)
 pkts bytes target     prot opt in     out     source               destination
  83M   91G RETURN     all  --  any    any     anywhere             anywhere
```
首先观察`FORWARD` chain：
```bash
Chain FORWARD (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination                     
 82M   91G DOCKER-USER  all  --  any    any     anywhere             anywhere
  82M   91G DOCKER-ISOLATION-STAGE-1  all  --  any    any     anywhere             anywhere              
  931K 1890M ACCEPT     all  --  any    br-7f97ab2bdd72  anywhere             anywhere             ctstate RELATED,ESTABLISHED                                                                                     
  1280 74796 DOCKER     all  --  any    br-7f97ab2bdd72  anywhere             anywhere      
  78214 6170K ACCEPT     all  --  br-7f97ab2bdd72 !br-7f97ab2bdd72  anywhere             anywhere    
  950 57000 ACCEPT     all  --  br-7f97ab2bdd72 br-7f97ab2bdd72  anywhere             anywhere
  60M   57G ACCEPT     all  --  any    docker0  anywhere             anywhere             ctstate RELATED,ESTABLISHED 
  58990 3575K DOCKER     all  --  any    docker0  anywhere             anywhere                
  21M   31G ACCEPT     all  --  docker0 !docker0  anywhere             anywhere              
  26929 1636K ACCEPT     all  --  docker0 docker0  anywhere             anywhere
```
它的默认策略的确是`DROP`，然后配置所有的流量都先走`DOCKER-USER` chain。然后看docker0相关的流量：
- in=any, out=docker0：即**外部发给docker0容器的流量**，全都交给`DOCKER` chain进一步处理；
- in=docker0, out=!docker0：即docker0容器发给外部的流量，全都ACCEPT；
- in=docker0, out=docker0：即docker0容器发给docker0容器的“内网”流量，全都ACCEPT；

`youtube-dl_default`网络同理，所有外部发给`youtube-dl_default`的流量都要交给`DOCKER` chain进一步处理。

再看`DOCKER` chain具体做了什么：
```bash
Chain DOCKER (2 references)                                                              
pkts bytes target     prot opt in     out     source               destination
27504 1662K ACCEPT     tcp  --  !docker0 docker0  anywhere             172.17.0.7           tcp dpt:https
 3840  234K ACCEPT     tcp  --  !docker0 docker0  anywhere             172.17.0.7           tcp dpt:http
  330 17796 ACCEPT     tcp  --  !br-7f97ab2bdd72 br-7f97ab2bdd72  anywhere             172.18.0.3           tcp dpt:27017
```

`DOCKER` chain设置了三个规则，前两个是关于`docker0`的，目标ip对应nginx-proxy，分绑定443和80端口。后一个是关于`youtube-dl_default`的，ip对应mongo-db，绑定27017端口：
1. 外部流量，目标地址是nginx-proxy，且端口是https/http的tcp报文：允许通过；
2. 外部流量，目标地址是mongo-db，且端口是27017的tcp报文：允许通过；

所以**`DOCKER` chain就是用来配置外部流量访问docker网络的规则的**，只有publish到host上，才需要配置规则到`DOCKER` chain里。

> `youtube-dl_default`的id是7f97ab2bdd72393787241ef4bf1e6a94a48f1f37962d5f61d342f55b62ec8d8e，所以在host上该bridge网络显示为br-7f97ab2bdd72。**如果不发布mongo的port，`Docker` chain的最后一条rule会被删除。**

# 感想
要是大学的时候会docker，当初[使用StrongSwan配置IPSec](https://blog.csdn.net/puppylpg/article/details/64918562)也不用吭哧吭哧部署四个ubuntu虚拟机了……小破笔记本带不动四个虚拟机，要不是搞到了服务器root密码，毕设铁挂了。

> 菜逼害死人啊……说的就是你——docker！当初为什么你没有现在这么火！:D


