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

# network drivers
[drivers](https://docs.docker.com/network/#network-drivers)有好几种，主要考虑**在单机上使用**的bridge网络。如果需要跨机器，考虑overlay。

> Bridge networks apply to containers running on the same Docker daemon host. For communication among containers running on different Docker daemon hosts, you can either manage routing at the OS level, or you can use an overlay network.

但是不管是用哪种底层网络，[从容器的视角看，他们都是一样的](https://docs.docker.com/config/containers/container-networking/)：**container连接上的每个网络都会给container分配一个ip**，符合物理机——有多个网卡才能接入多个网络。

> By default, the container gets an IP address for every Docker network it attaches to. A container receives an IP address out of the IP pool of the network it attaches to. The Docker daemon effectively acts as a DHCP server for each container. Each network also has a default subnet mask and gateway.

# bridge
bridge用于单机部署多个docker容器。docker默认会创建一个bridge网络——`docker0`。

所有的container如果没有指定network，都会默认连接到docker0上，**因此他们之间默认是联通的，可以相互通信**。如果是生产环境，[建议使用自己创建的bridge网络](https://docs.docker.com/network/bridge/#differences-between-user-defined-bridges-and-the-default-bridge):
- 更好的隔离性。因为只有连上该网络才能通信，而docker0默认都连上，都可以相互通信；
- **自己创建的bridge网络支持自动DNS，可以直接用容器名通信**，而docker0只能用ip通信；
- 自己创建的bridge网络支持容器热插拔，而docker0必须停到容器，再重新创建一个不连接到docker0（`--network`）的容器……

## 连通性测试
测试一下docker0只能使用ip，而非容器名——

容器a：
```
PS C:\Users\puppylpg> docker container run -d --name a-in-docker0 alpine sleep 1h
f0b11987ef36b83fb7139cb097a2e7edebe7e5572429d47ae6505a7ffe257be6
```

容器b：
```
PS C:\Users\puppylpg> docker container run -it --name b-in-docker0 alpine sh

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
```
PS C:\Users\puppylpg> docker container exec -it a-in-docker0 sh

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

# iptables
docker的网络隔离竟然是[通过`iptables`实现的]( https://docs.docker.com/network/iptables/)！（也离不开虚拟网络设备）

> 关于`iptables`，参考[Linux上使用iptables设置防火墙](https://blog.csdn.net/puppylpg/article/details/51173505)。

docker默认设置了两个优先级高于系统的iptables chain：
1. `DOCKER-USER`：用于用户设置iptables规则；
2. `DOCKER`：用于docker自己设置iptables规则；

> 优先级高于系统？错，实际上还是系统chain优先级高，但是经过docker一折腾，看起来逻辑上docker的chain优先级更高。详见下文。

而系统原有的`FORWARD` chain被默认设为drop。所以如果用户有自定义的需求，就放到`DOCKER-USER`里，否则可能因为优先级低于docker的chain导致不生效。

> Rules added to the `FORWARD` chain -- either manually, or by another iptables-based firewall -- are evaluated after these chains. **This means that if you expose a port through Docker, this port gets exposed no matter what rules your firewall has configured**. If you want those rules to apply even when a port gets exposed through Docker, you must add these rules to the `DOCKER-USER` chain.

举个例子。系统布置了两个publish port到host的container：
1. nginx-proxy，在bridge网络`docker0`上ip为172.17.0.7，publish 80/443；
2. mongo-db，在一个自定义的bridge网络`youtube-dl_default`上ip为172.18.0.3，publish 27017；

查看此时host的iptables：
```
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
首先可以看到，**docker之所以能让`DOCKER` chain的优先级高于`FORWARD` chain，其实是玩了个trick**：
```
Chain FORWARD (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination                                                                                                                                     
 82M   91G DOCKER-USER  all  --  any    any     anywhere             anywhere
  82M   91G DOCKER-ISOLATION-STAGE-1  all  --  any    any     anywhere             anywhere                                                                                                                       
  931K 1890M ACCEPT     all  --  any    br-7f97ab2bdd72  anywhere             anywhere             ctstate RELATED,ESTABLISHED                                                                                     
  1280 74796 DOCKER     all  --  any    br-7f97ab2bdd72  anywhere             anywhere                                                                                                                             78214 6170K ACCEPT     all  --  br-7f97ab2bdd72 !br-7f97ab2bdd72  anywhere             anywhere                                                                                                                     950 57000 ACCEPT     all  --  br-7f97ab2bdd72 br-7f97ab2bdd72  anywhere             anywhere                                                                                                                      
  60M   57G ACCEPT     all  --  any    docker0  anywhere             anywhere             ctstate RELATED,ESTABLISHED                                                                                             
  58990 3575K DOCKER     all  --  any    docker0  anywhere             anywhere                                                                                                                                       
  21M   31G ACCEPT     all  --  docker0 !docker0  anywhere             anywhere                                                                                                                                   
  26929 1636K ACCEPT     all  --  docker0 docker0  anywhere             anywhere
```
**先把`FORWARD` chain的默认策略改成`DROP`，然后配置所有的流量都使用`DOCKER-USER` chain；所有非docker0的src，如果dst是docker0，就使用`DOCKER` chain**。所以本质上并不是优先级高于`FORWARD` chain，而是借助了iptables的`FORWARD` chain本身。

再看`DOCKER` chain：
```
Chain DOCKER (2 references)                                                                                                                                                                                        pkts bytes target     prot opt in     out     source               destination
27504 1662K ACCEPT     tcp  --  !docker0 docker0  anywhere             172.17.0.7           tcp dpt:https
 3840  234K ACCEPT     tcp  --  !docker0 docker0  anywhere             172.17.0.7           tcp dpt:http
  330 17796 ACCEPT     tcp  --  !br-7f97ab2bdd72 br-7f97ab2bdd72  anywhere             172.18.0.3           tcp dpt:27017
```

`DOCKER` chain设置了三个规则，前两个是关于`docker0`的，ip对应nginx-proxy，分绑定443和80端口；后一个是关于`youtube-dl_default`的，ip对应mongo-db，绑定27017端口。

所以只有publish到host上，才需要配置规则到`DOCKER` chain里。

> `youtube-dl_default`的id是7f97ab2bdd72393787241ef4bf1e6a94a48f1f37962d5f61d342f55b62ec8d8e，所以在host上该bridge网络显示为br-7f97ab2bdd72。**如果不发布mongo的port，`Docker` chain的最后一条rule会被删除。**

# 感想
要是大学的时候会docker，当初[使用StrongSwan配置IPSec](https://blog.csdn.net/puppylpg/article/details/64918562)也不用吭哧吭哧部署四个ubuntu虚拟机了……小破笔记本带不动四个虚拟机，要不是搞到了服务器root密码，毕设铁挂了。

> 菜逼害死人啊……说的就是你——docker！当初为什么你没有现在这么火！:D


