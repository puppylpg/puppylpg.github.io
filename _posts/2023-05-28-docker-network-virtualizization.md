---
layout: post
title: "Docker - 虚拟化网络设备"
date: 2023-05-28 19:39:30 +0800
categories: docker
tags: docker
---

在docker中，容器的网络隔离不仅用到了iptables对数据包的转发规则进行干预，还离不开网络设备的虚拟化技术，毕竟容器需要配上虚拟化的网络设备才能组成完整的虚拟网络。

> [虚拟化网络设备](https://icyfenix.cn/immutable-infrastructure/network/linux-vnet.html#%E8%99%9A%E6%8B%9F%E5%8C%96%E7%BD%91%E7%BB%9C%E8%AE%BE%E5%A4%87)

1. Table of Contents, ordered
{:toc}

# 网络协议栈
linux网络协议栈，无论被描述为是OSI五层模型，还是TCP/IP七层模型，都有一个共同点：应用层以下（从传输层开始，调用socket系统调用）的协议栈，都实现在内核态。

之所以这么设计，主要考虑的是**数据安全隔离**。虽然这会增加数据在内核态和用户态之间的复制成本，但**避免了一个应用程序窃听/伪造另一个应用程序的通信内容**。

> 因为送信人是内核，内核相比于用户态程序是安全可靠的，别的用户态程序无法插手。

但网络协议栈的设计也并不是完全没有给用户态程序任何操作空间，还是**允许root用户配置一些回调函数（hook）对协议栈里的数据进行干预**的。

![Netfilter_hook](/pics/docker/network/Netfilter_hook.png)

PREROUTING/POSTROUTING、FORWARD、INPUT/OUTPUT就是这样五种callback，每种callback都可以设置多个callback函数，形成了链，因此也被称为chain。**这套过滤器框架名为Netfilter**，有一些上层应用能够更方便地设置Netfilter hook，比如Xtables家族，最出名的是iptables。

> FORWARD：报文经过IP路由判定，如果确定不是发往本机的，就会直接转发出去。此时linux系统充当了数据包转发工具。

其实根据这么多年的开发经验，**明显能感觉到netfilter相当于给网络协议栈引入了“插件机制”**，使得网络协议栈的玩法变得多样化了起来，比如下面要介绍的VPN。而且由于几乎整个协议栈都处于内核态，想安装这些“插件”需要root权限。

# 虚拟网卡
普通的网卡驱动，可以理解为**一端连着网络协议栈，另一端连着物理网卡**。从一端收数据，发送到另一端。

## tun、tap
虚拟网卡，一端连着网络协议栈，另一端连着用户态程序。

比如VPN，普通应用程序把数据包发送给网络协议栈，**tun/tap模拟了虚拟的网卡，从网络协议栈里收到数据包之后，没有像实体网卡一样把数据包通过网线发送出去，而是发送给了VPN程序**。VPN程序就可以用任何想要的方式操作数据包了。比如隧道技术（Tunneling），把发往ip A的报文（以IPsec协议）加密，封装到新的报文里，新报文的目标ip地址为B。

对于发送报文的应用程序来说，这些都是无感知的。

> 被tun/tap传输的数据一共经过了两次协议栈。

## veth
如果进行容器对容器的通信，一般使用veth（**因为实体网卡叫eth，比如eth0，所以它叫veth**），它**代表一对儿使用网线连接的网卡**，两个容器一边一个，数据可以直接发送过去。

# 交换机
现实中，设备一旦多了起来，再使用网线进行两两直连就爆炸了，所以出现了交换机。因此虚拟网络设备既然有虚拟网卡，也会有虚拟交换机。

## bridge
linux上虚拟交换机的名字不是switch（交换机），而是bridge（网桥），但实际上就是虚拟交换机。linux bridge从kernel 2.2开始引入，无论是真实的物理网卡（eth0）还是虚拟网卡（tap、veth）都能喝linux bridge配合工作。

bridge既然是个虚拟交换机，那么它的工作原理和[数据链路层]({% post_url 2021-12-19-network-data-link-layer %})里介绍的交换机一模一样。只有一点点区别：**普通交换机只会单纯地做二层转发，忽略ip地址，Linux Bridge 却还支持把发给它自身的数据包接入到主机的三层的协议栈中**。

然而 Linux Bridge 与普通交换机的区别是除了显式接入的设备外，**它自己也无可分割地连接着一台有着完整网络协议栈的 Linux 主机，因为 Linux Bridge 本身肯定是在某台 Linux 主机上创建的**，可以看作 Linux Bridge 有一个与自己名字相同的隐藏端口，隐式地连接了创建它的那台 Linux 主机。因此，Linux Bridge 允许给自己设置 IP 地址，比普通交换机多出一种特殊的转发情况：**如果数据包的目的 MAC 地址为网桥本身，并且网桥设置了 IP 地址的话**，那该数据包即被认为是收到发往创建网桥那台主机的数据包，此数据包将不会转发到任何设备，而是直接交给上层（三层）协议栈去处理。

这样，**linux bridge本身还充当了一点点路由器的功能**。如果没有这个功能，只能做到接入到同一个bridge的虚拟设备之间相互通信。有了这个功能，当数据包被通过bridge扔到了主机的网络协议栈，只需要提前预支一些iptables NAT规则，就可以把原ip和mac替换为实际网卡eth0的ip和mac，从而实现外部通信。同理，数据包返回的时候还要把ip和mac换回来。

![linux_bridge_container](/pics/docker/network/linux_bridge_container.png)

**因此可以认为linux bridge是一个虚拟交换机，linux内核本身就是一个虚拟路由器，因为只有路由器才能做NAT转换。**


回看[Docker - network]({% post_url 2023-04-13-docker-network %})：
1. docker安装之后就会创建这样一个默认的linux bridge：docker0；
2. 所有的容器如果没有显式指定network，都会接入docker0，相互之间可以通信；
3. 如果创建了新的network，比如使用docker compose启动多个服务，相当于新建了一个linux bridge，组了一个独立的局域网；
4. 如果某个容器把端口publish到主机上，此时iptables里的`Chain DOCKER`就会多一条允许相关流量通过的`ACCEPT`规则；

而`--network=host`则是完全不创建虚拟网络设备，直接使用宿主机的网卡、网络栈，也不会拥有自己的ip，和在宿主机上直接起一个这样的进程没什么太大区别。优点是容器和外界通信不需要再做NAT，性能好，缺点就是没有隔离就不能避免网络资源冲突，比如端口冲突。

