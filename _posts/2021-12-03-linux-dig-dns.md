---
layout: post
title: "Linux - dig & DNS"
date: 2021-12-03 00:42:06 +0800
categories: Linux DNS
tags: Linux DNS
---

最近在`namesilo`用0.99刀淘了一个域名`puppylpg.xyz`，又配置了一下，感觉对域名的理解更深刻了。DNS是一般是解析域名对应的ip，但远不止这些。而dig则是查询DNS的工具，通过dig，可以更深刻理解DNS。而后再看Nigin的反向代理，会有一种融会贯通的感觉。

- 域名管理页面：https://www.namesilo.com/account_home.php

1. Table of Contents, ordered
{:toc}

# 域名层级
以`netdata.puppylpg.xyz`为例：
- `puppylpg.xyz`是我买的域名；
- `.root`是根域名（root ），可以省略，因为所有的域名的根域名都是`.root`；
- `.xyz`是顶级域名（top level domain，简称tld），还有com、cn、io等，不能人为注册；
- `.puppylpg`次级域名（second-level domain，简称sld），可以人为注册；
- `netdata`主机名（host）。其实不一定是主机名，有了`puppylpg.xyz`这个域名，它再次一级的域名可以由拥有者任意定义。但好像只能控制一层，不能定义出`xxx.netdata.puppylpg.xyz`这种又多了一层的域名。

**域名是树状结构，每一个域名都有NS（Name Server）记录，记录该层级域名的域名服务器。域名服务器则知道它的下一层级的所有域名的所有信息记录（比如`.xyz`的name server知道关于`puppylpg.xyz`的所有A、AAAA、CNAME、MX、TXT记录等）。**

当需要查询一个域名的ip的时候，就是从根域名查起，一层一层直到查到域名的ip。

# DNS服务器
## `dig +trace <domain>`
`dig +trace`可以完整显示使用DNS解析一个域名的流程：
```
➜  ~ dig +trace netdata.puppylpg.xyz

; <<>> DiG 9.16.22-Debian <<>> +trace netdata.puppylpg.xyz
;; global options: +cmd
.                       512221  IN      NS      a.root-servers.net.
.                       512221  IN      NS      b.root-servers.net.
.                       512221  IN      NS      c.root-servers.net.
.                       512221  IN      NS      d.root-servers.net.
.                       512221  IN      NS      e.root-servers.net.
.                       512221  IN      NS      f.root-servers.net.
.                       512221  IN      NS      g.root-servers.net.
.                       512221  IN      NS      h.root-servers.net.
.                       512221  IN      NS      i.root-servers.net.
.                       512221  IN      NS      j.root-servers.net.
.                       512221  IN      NS      k.root-servers.net.
.                       512221  IN      NS      l.root-servers.net.
.                       512221  IN      NS      m.root-servers.net.
.                       512221  IN      RRSIG   NS 8 0 518400 20211215050000 20211202040000 14748 . Ox5BxBP6Se88niNPIxlpMrOX5R2kYOMVoBJoTgaf9ncsdkokYhp8YuAF VKvSJgOMbiJgu78UASW/4GDKOgxrd645hpGHuVagErsL1Y8fTqPM3pg8 HFZYsj7xLL6EH2sVmXy0nQla69Xy6dssRMprMTlQFKhO7dLIfGbiUai2 FjpHIVnfnGCjROZSWulj/VKAeyAPOBfOvfgslFtpAdsBI85v9D7CDv51 9KkA+2c2F4OmBl6YIRu8580XFxvzsMKa2DZE688UM2wZ1wJKzKFYGf9I yX/5n2eLs5FegcJhyAdlCyvHHKegMox7S683TBUC7tX6/X44Naq83LoC 1xwHpg==
;; Received 1097 bytes from 1.0.0.1#53(1.0.0.1) in 0 ms

xyz.                    172800  IN      NS      x.nic.xyz.
xyz.                    172800  IN      NS      y.nic.xyz.
xyz.                    172800  IN      NS      z.nic.xyz.
xyz.                    172800  IN      NS      generationxyz.nic.xyz.
xyz.                    86400   IN      DS      3599 8 1 3FA3B264F45DB5F38BEDEAF1A88B76AA318C2C7F
xyz.                    86400   IN      DS      3599 8 2 B9733869BC84C86BB59D102BA5DA6B27B2088552332A39DCD54BC4E8 D66B0499
xyz.                    86400   IN      RRSIG   DS 8 1 86400 20211215050000 20211202040000 14748 . jCRZUsCPu0GW7gnBDFXBsKVFjT1i8SfwPH30qQ4dg2I+Zrl0LkIubJom b5o4SaMGb38CKnyarf81shLQChieS+yaw/JqfzTioF/YbK0ntwK6cVKr IGvHHj4HZton5pGOuu8tLKrbBk/8LbnRj0YXDPczvUZdXZeBKET3IiaE NLB8XsunyzgB2I8vJQ8K8dd90VnlcN6L4L7IFJZP5X83tP3FZmHn6NpP PKiHXZGo+Xd+KE7MZzaZDyVTFZ0r/BBEqPgrVqsl4XyndL/KVsnuYnw9 c8DN9ohtn9AIkmUoYXcBbtFC6ihz07tfG8Ovfu2NQ1nEhIAfGUaicQL6 skaTXA==
;; Received 676 bytes from 199.7.83.42#53(l.root-servers.net) in 12 ms

puppylpg.xyz.           3600    IN      NS      ns1.dnsowl.com.
puppylpg.xyz.           3600    IN      NS      ns2.dnsowl.com.
puppylpg.xyz.           3600    IN      NS      ns3.dnsowl.com.
1h97h2oec2juov8dlbbjj6i7ik26bm8d.xyz. 3600 IN NSEC3 1 1 1 - 1H9SP7N22537R92KKG4DNO5R90TMHMCQ NS SOA RRSIG DNSKEY NSEC3PARAM
jkilke9221kd2ein5lem85lg6mi01vgk.xyz. 3600 IN NSEC3 1 1 1 - JKKG027OR13NTC8QJ4TAQ736UO0M6N3T NS DS RRSIG
1h97h2oec2juov8dlbbjj6i7ik26bm8d.xyz. 3600 IN RRSIG NSEC3 8 2 3600 20211209061147 20211109121839 22788 xyz. A3UiT3g59p3lK0ns4KiIOWzuQgbytlXOBrqcQuuK9wNuuf4pO85bd6Do mXHHXF3ETe4OhP8biuc5N4P2k6AsA/cHDWBoef+rja3jyNqHNw9PLEcf 3C51roiVIANodUFVKOCfBCyoPJ6E/D8EdF8WLloColzK9eM8Papg6oVq p2s=
jkilke9221kd2ein5lem85lg6mi01vgk.xyz. 3600 IN RRSIG NSEC3 8 2 3600 20211214010116 20211113212841 22788 xyz. JPHIcrepBpVl+WNcHhMI3K7HHU+dK55tvSsipK+Z88Yt1WB5UmSwTiZ6 KLMNqDCirQ3oqxyrubmDTepl7nSitPtQ1UTFtjUb6I3uEhbRTuTVxXGW nUnB1aXxrXulq3u/aJijhUVl5xO0whhEJcIet7THMGF0N7U0tA1iE+xu 1Wc=
;; Received 598 bytes from 185.24.64.42#53(y.nic.xyz) in 0 ms

netdata.puppylpg.xyz.   7207    IN      CNAME   puppylpg.xyz.
puppylpg.xyz.           172800  IN      NS      ns1.dnsowl.com.
puppylpg.xyz.           172800  IN      NS      ns2.dnsowl.com.
puppylpg.xyz.           172800  IN      NS      ns3.dnsowl.com.
;; Received 223 bytes from 162.159.27.130#53(ns2.dnsowl.com) in 4 ms
```
- 向根级域名的域名服务器查顶级域名`.xyz`的**NS服务器**，`l.root-servers.net`给结果最快，给出了4个NS服务器（xyz的NS），木有A记录；
- 向这4个NS（顶级域名的域名服务器）查次级域名`.puppylpg`的**NS服务器**，`y.nic.xyz`反应最快，给出了3个NS服务器（puppylpg的NS），木有A记录；
- 向这3个NS（次级域名的域名服务器）查主机名`netdata`的**A记录（查的就是它的ip，所以不再是NS记录了）**，`ns2.dnsowl.com`反应最快，给出了`netdata.puppylpg.xyz.`的CNAME，它没有A记录；

> `ns[1-3].dnsowl.com.`是我买的域名的服务商自己的NS。所以我的域名的NS记录指向他们。

如果dig的是`puppylpg.xyz`的ip：
```
puppylpg.xyz.           7207    IN      A       104.225.232.103
puppylpg.xyz.           172800  IN      NS      ns1.dnsowl.com.
puppylpg.xyz.           172800  IN      NS      ns2.dnsowl.com.
puppylpg.xyz.           172800  IN      NS      ns3.dnsowl.com.
;; Received 217 bytes from 162.159.26.234#53(ns3.dnsowl.com) in 8 ms
```
返回的就是`puppylpg.xyz`的A记录和NS记录了。但是之前查的是`netdata.puppylpg.xyz.`，所以`puppylpg.xyz`就只显示NS记录，不显示A记录了。

每一级NS服务器找出下一级域名，再根据下一级域名查到它这一级的NS服务器地址，向该级NS服务器查下一级域名，直到查到，**就像一个链一样。但还有一个条件没有满足：链的头是怎么知道的**？即root NS服务器的地址是怎么知道的？他们因为是root，所以NS记录和IP地址一般是不会变化的，所以内置在DNS服务器里面。

**世界上一共有13组root NS服务器，`[a-m].root-servers.net.`**。

> IN前的数字是查询缓存秒数。下次再查，如果没超过这个时间，直接用缓存数据。要不然NS服务器压力就太大了。

从上面的例子可以看出：**根域名服务器是第一个被查询的NS**。当你不知道谁是你的负责人时，直接找公司老板，老板会告诉你下一你部门领导。就这用一路找下来，就找到你的直接负责人了。（真这么干的话，怕不是会被老板打死，233）

## `dig NS <domain>`
**NS是最重要的记录。通过NS记录找到name server，之后就可以向它查到下一级域名的所有信息**。

**直接使用`dig NS`就可以查到该域名的NS服务器记录了**。比如查根域名的NS：
```
➜  ~ dig NS .

; <<>> DiG 9.16.22-Debian <<>> NS .
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 20354
;; flags: qr aa rd ra; QUERY: 1, ANSWER: 13, AUTHORITY: 0, ADDITIONAL: 27

;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 1232
;; QUESTION SECTION:
;.                              IN      NS

;; ANSWER SECTION:
.                       511286  IN      NS      a.root-servers.net.
.                       511286  IN      NS      b.root-servers.net.
.                       511286  IN      NS      c.root-servers.net.
.                       511286  IN      NS      d.root-servers.net.
.                       511286  IN      NS      e.root-servers.net.
.                       511286  IN      NS      f.root-servers.net.
.                       511286  IN      NS      g.root-servers.net.
.                       511286  IN      NS      h.root-servers.net.
.                       511286  IN      NS      i.root-servers.net.
.                       511286  IN      NS      j.root-servers.net.
.                       511286  IN      NS      k.root-servers.net.
.                       511286  IN      NS      l.root-servers.net.
.                       511286  IN      NS      m.root-servers.net.

;; ADDITIONAL SECTION:
a.root-servers.net.     511286  IN      A       198.41.0.4
a.root-servers.net.     511286  IN      AAAA    2001:503:ba3e::2:30
b.root-servers.net.     511286  IN      A       199.9.14.201
b.root-servers.net.     511286  IN      AAAA    2001:500:200::b
c.root-servers.net.     511286  IN      A       192.33.4.12
c.root-servers.net.     511286  IN      AAAA    2001:500:2::c
d.root-servers.net.     511286  IN      A       199.7.91.13
d.root-servers.net.     511286  IN      AAAA    2001:500:2d::d
e.root-servers.net.     511286  IN      A       192.203.230.10
e.root-servers.net.     511286  IN      AAAA    2001:500:a8::e
f.root-servers.net.     511286  IN      A       192.5.5.241
f.root-servers.net.     511286  IN      AAAA    2001:500:2f::f
g.root-servers.net.     511286  IN      A       192.112.36.4
g.root-servers.net.     511286  IN      AAAA    2001:500:12::d0d
h.root-servers.net.     511286  IN      A       198.97.190.53
h.root-servers.net.     511286  IN      AAAA    2001:500:1::53
i.root-servers.net.     511286  IN      A       192.36.148.17
i.root-servers.net.     511286  IN      AAAA    2001:7fe::53
j.root-servers.net.     511286  IN      A       192.58.128.30
j.root-servers.net.     511286  IN      AAAA    2001:503:c27::2:30
k.root-servers.net.     511286  IN      A       193.0.14.129
k.root-servers.net.     511286  IN      AAAA    2001:7fd::1
l.root-servers.net.     511286  IN      A       199.7.83.42
l.root-servers.net.     511286  IN      AAAA    2001:500:9f::42
m.root-servers.net.     511286  IN      A       202.12.27.33
m.root-servers.net.     511286  IN      AAAA    2001:dc3::35

;; Query time: 0 msec
;; SERVER: 1.0.0.1#53(1.0.0.1)
;; WHEN: Thu Dec 02 11:05:37 EST 2021
;; MSG SIZE  rcvd: 811
```
不仅给出了所有的13组NS，还给出了他们的ipv4地址和ipv6地址。

我在namesilo买的域名，理所当然默认用的是namesilo的服务器：
```
$ dig NS puppylpg.xyz

; <<>> DiG 9.16.37-Debian <<>> NS puppylpg.xyz
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 60851
;; flags: qr rd ad; QUERY: 1, ANSWER: 7, AUTHORITY: 0, ADDITIONAL: 0
;; WARNING: recursion requested but not available

;; QUESTION SECTION:
;puppylpg.xyz.                  IN      NS

;; ANSWER SECTION:
puppylpg.xyz.           0       IN      NS      ns3.dnsowl.com.
puppylpg.xyz.           0       IN      NS      ns2.dnsowl.com.
puppylpg.xyz.           0       IN      NS      ns1.dnsowl.com.
ns1.dnsowl.com.         0       IN      A       162.159.27.173
ns1.dnsowl.com.         0       IN      A       162.159.26.136
ns3.dnsowl.com.         0       IN      AAAA    2400:cb00:2049:1::a29f:1aea
ns3.dnsowl.com.         0       IN      AAAA    2400:cb00:2049:1::a29f:1b62

;; Query time: 0 msec
;; SERVER: 172.26.240.1#53(172.26.240.1)
;; WHEN: Mon Mar 06 20:52:03 CST 2023
;; MSG SIZE  rcvd: 242
```
但namesilo的网站界面实在是太丑了。网站又丑又慢还不是原罪，namesilo的NS实在和行业翘楚cloudflare没法比：namesilo每次更新dns时要近一个小时才生效，**cloudflare配置一个新的dns记录秒生效**，体验上简直是云泥之别！

> 而且cloudflare免费服务的一部分，其他还有一些放DDoS的安全措施、邮件转发等，操作起来也非常人性化。

让cloudflare作为自己的NS就涉及到NS的变更：登录注册cloudflare，获取NS记录，然后在namesilo网站里把NS换成cloudflare的NS。等生效后，再查NS记录：
```
─➤  dig NS puppylpg.xyz

; <<>> DiG 9.16.37-Debian <<>> NS puppylpg.xyz
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 50230
;; flags: qr rd ad; QUERY: 1, ANSWER: 5, AUTHORITY: 0, ADDITIONAL: 0
;; WARNING: recursion requested but not available

;; QUESTION SECTION:
;puppylpg.xyz.                  IN      NS

;; ANSWER SECTION:
puppylpg.xyz.           0       IN      NS      yevgen.ns.cloudflare.com.
puppylpg.xyz.           0       IN      NS      aryanna.ns.cloudflare.com.
aryanna.ns.cloudflare.com. 0    IN      A       162.159.38.95
aryanna.ns.cloudflare.com. 0    IN      A       172.64.34.95
aryanna.ns.cloudflare.com. 0    IN      A       108.162.194.95

;; Query time: 200 msec
;; SERVER: 172.26.240.1#53(172.26.240.1)
;; WHEN: Tue Mar 07 21:39:34 CST 2023
;; MSG SIZE  rcvd: 192
```
NS成功从namesilo换成了cloudflare！之后就可以享受cloudflare的NS带来的便捷了。

> 同样是NS，专业的吊打非专业的:D

# DNS记录的类型
- `A`：记录着该域名和ip（ipv4）的对应关系；
- `AAAA`：同上，ipv6；
- `NS`：**Name Server，该域名的域名服务器地址，可以用来查该域名的下一级的所有（或部分，取决于NS服务提供商的具体部署情况）域名**；
- `MX`：Mail Exchange，该域名对应的电子邮件服务器的地址；
- `CNAME`：**Canonical Name record，规范名称，或者说真实名称**。可以理解为 **当前域名指向的域名**；
- `TXT`：记录自定义的text内容；

## `dig <domain>`
获取域名的A记录，CNAME记录：
```
~ % dig puppylpg.xyz

; <<>> DiG 9.16.22-Debian <<>> puppylpg.xyz
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 52581
;; flags: qr rd ad; QUERY: 1, ANSWER: 4, AUTHORITY: 0, ADDITIONAL: 0
;; WARNING: recursion requested but not available

;; QUESTION SECTION:
;puppylpg.xyz.                  IN      A

;; ANSWER SECTION:
puppylpg.xyz.           0       IN      A       107.161.23.204
puppylpg.xyz.           0       IN      A       192.161.187.200
puppylpg.xyz.           0       IN      A       209.141.38.71
puppylpg.xyz.           0       IN      A       104.225.232.103

;; Query time: 10 msec
;; SERVER: 172.30.128.1#53(172.30.128.1)
;; WHEN: Wed Dec 01 21:20:47 CST 2021
;; MSG SIZE  rcvd: 106
```

## `dig MX <domain>`
用于获取域名记录的邮件服务器。电子邮件用一种特殊的DNS记录称为MX记录（Mail Exchange）。如果你发一封邮件给`1234@qq.com`,发送方服务器会对@分隔符后面的`qq.com`做一个MX记录查询，DNS返回的查询结果举个例子是`receive.qq.com`,发送方服务器就会使用smtp协议给`receive.qq.com`的特定端口（如25）发送邮件。

没设置，所以没答案：
```
~ % dig MX puppylpg.xyz

; <<>> DiG 9.16.22-Debian <<>> MX puppylpg.xyz
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 49288
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 0

;; QUESTION SECTION:
;puppylpg.xyz.                  IN      MX

;; Query time: 330 msec
;; SERVER: 172.30.128.1#53(172.30.128.1)
;; WHEN: Wed Dec 01 21:25:04 CST 2021
;; MSG SIZE  rcvd: 30
```
**因此如果给`xxx@puppylpg.xyz`发邮件，会无处可发**。

可以在域名服务商提供的域名的管理页面添加MX记录。我给它加了163的邮件接收服务器的地址，之后再查：
```
➜  ~ dig MX puppylpg.xyz

; <<>> DiG 9.16.22-Debian <<>> MX puppylpg.xyz
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 32896
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 1232
;; QUESTION SECTION:
;puppylpg.xyz.                  IN      MX

;; ANSWER SECTION:
puppylpg.xyz.           7207    IN      MX      10 163mx01.mxmail.netease.com.

;; Query time: 368 msec
;; SERVER: 1.0.0.1#53(1.0.0.1)
;; WHEN: Thu Dec 02 11:15:01 EST 2021
;; MSG SIZE  rcvd: 83
```
此时如果给`xxx@puppylpg.xyz`发邮件，会发给163邮箱服务器，但应该会被安全策略拒收。

## `dig TXT <domain>`
**域名的TXT记录可以自定义text内容。用于记录一些人类可读的东西，也可能被用来做机器验证**。RFC 1464提了一种存储kv的方式。比如`youdaoads.com`下的TXT record：
```
[puppylpg:~]$ dig TXT youdaoads.com
; <<>> DiG 9.11.5-P4-5.1+deb10u5-Debian <<>> TXT youdaoads.com
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 1025
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1
;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 4000
; COOKIE: 808bda8a14bb02c3 (echoed)
;; QUESTION SECTION:
;youdaoads.com. IN TXT
;; ANSWER SECTION:
youdaoads.com. 598 IN TXT "v=spf1 include:spf.163.com -all"
;; Query time: 1011 msec
;; SERVER: 10.238.14.4#53(10.238.14.4)
;; WHEN: Mon Jun 28 17:51:46 CST 2021
;; MSG SIZE rcvd: 98
```
其实就一条：`youdaoads.com. 598 IN TXT "v=spf1 include:spf.163.com -all"`，是用来记录SPF的。


Ref：
- https://en.wikipedia.org/wiki/TXT_record

## `dig CNAME <domain>`
CNAME是Canonical Name的缩写，指的是“真实名称”。一个比较易混的点：cname指的是右边的域名是真实名称，左边的是alias。比如：
```
netdata.puppylpg.xyz.	CNAME	puppylpg.xyz.
```
指的是netdata.puppylpg.xyz指向的“真实名称”是puppylpg.xyz，也就是说pupyplpg.xyz才是CNAME。

### 使用场景
[wikipedia](https://en.wikipedia.org/wiki/CNAME_record)举的cname的例子就是使用nginx做反向代理的场景：
- puppylpg.xyz使用A记录指向一个ip；
- netdata.puppylpg.xyz指向puppylpg.xyz；

### 任意指向
CNAME可以是任何网站，但未必能访问成功。比如可以配一个du.puppylpg.xyz指向www.baidu.com，此时du.puppylpg.xyz就是www.baidu.com：
```
~ dig du.puppylpg.xyz

; <<>> DiG 9.16.15-Debian <<>> du.puppylpg.xyz
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 7409
;; flags: qr rd ad; QUERY: 1, ANSWER: 4, AUTHORITY: 0, ADDITIONAL: 0
;; WARNING: recursion requested but not available

;; QUESTION SECTION:
;du.puppylpg.xyz.               IN      A

;; ANSWER SECTION:
du.puppylpg.xyz.        0       IN      CNAME   www.baidu.com.
www.baidu.com.          0       IN      CNAME   www.a.shifen.com.
www.a.shifen.com.       0       IN      A       220.181.38.150
www.a.shifen.com.       0       IN      A       220.181.38.149

;; Query time: 10 msec
;; SERVER: 172.30.208.1#53(172.30.208.1)
;; WHEN: Mon Dec 27 18:06:32 CST 2021
;; MSG SIZE  rcvd: 166

~ dig du.puppylpg.xyz +short
www.baidu.com.
www.a.shifen.com.
220.181.38.150
220.181.38.149
```
但是想通过这个域名访问baidu，并不会成功：
```
~ curl -v du.puppylpg.xyz
*   Trying 220.181.38.150:80...
* Connected to du.puppylpg.xyz (220.181.38.150) port 80 (#0)
> GET / HTTP/1.1
> Host: du.puppylpg.xyz
> User-Agent: curl/7.74.0
> Accept: */*
>
* Mark bundle as not supporting multiuse
< HTTP/1.1 403 Forbidden
< Server: bfe
< Date: Mon, 27 Dec 2021 10:07:43 GMT
< Content-Length: 0
< Content-Type: text/plain; charset=utf-8
<
* Connection #0 to host du.puppylpg.xyz left intact
```
因为在http request header里，Host是du.puppylpg.xyz，百度收到这样的请求，是不会处理的。

想实现这种需求，不是通过CNAME来实现的，而是nginx：du.puppylpg.xyz指向自己的nginx服务，nginx把header里的Host换成baidu，再给百度发请求：
```
location / { 
    sub_filter www.baidu.com baidu.leishi.io; sub_filter_once off; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header Referer https://www.baidu.com; proxy_set_header Host www.baidu.com; proxy_set_header Accept-Encoding ""; proxy_pass https://www.baidu.com;
}
```

- https://www.v2ex.com/t/634903

### 查询CNAME记录
其实没必要，因为dig直接查domain，会把CNAME和A都显示出来。

配置`netdata.puppylpg.xyz`指向`puppylpg.xyz`，之后再查询：
```
➜  ~ dig CNAME netdata.puppylpg.xyz

; <<>> DiG 9.16.22-Debian <<>> CNAME netdata.puppylpg.xyz
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 29306
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 1232
;; QUESTION SECTION:
;netdata.puppylpg.xyz.          IN      CNAME

;; ANSWER SECTION:
netdata.puppylpg.xyz.   7207    IN      CNAME   puppylpg.xyz.

;; Query time: 52 msec
;; SERVER: 1.0.0.1#53(1.0.0.1)
;; WHEN: Thu Dec 02 11:20:39 EST 2021
;; MSG SIZE  rcvd: 63
```

**域名一旦设置CNAME记录以后，就不能再设置其他记录了（比如A记录和MX记录）**。比如`netdata.puppylpg.xyz`不能在设置A和MX了，不然发给`@netdata.puppylpg.xyz`的邮件到底是发给它的MX的，还是发给`puppylpg.xyz`的MX的？冲突了。

# 获取最新的DNS记录
有时候dns的记录刷新了，但是本地还查不到，是因为本地dns记录的缓存还没有过期。获取dns记录的时候，TTL代表了过期时间。

如果使用dig获取记录，0ms就返回了，肯定是缓存：
```
;; Query time: 0 msec
;; SERVER: 172.30.208.1#53(172.30.208.1)
;; WHEN: Mon Dec 27 17:32:10 CST 2021
;; MSG SIZE  rcvd: 66
```

此时可以直接指定NS服务器查询，返回的一定是最新的结果。dig不会再从本机缓存里查询：
```
~ dig +short puppylpg.xyz NS
ns2.dnsowl.com.
ns3.dnsowl.com.
ns1.dnsowl.com.
~ dig TXT puppylpg.xyz +short
"spf.163.com"
```

从返回内容也可以看出，是花了一些时间才获取到的，而不是0ms：
```
;; Query time: 880 msec
;; SERVER: 162.159.27.173#53(162.159.27.173)
;; WHEN: Mon Dec 27 17:32:36 CST 2021
;; MSG SIZE  rcvd: 283
```

- https://serverfault.com/questions/372066/force-dig-to-resolve-without-using-cache

# 本地域名服务器
除了上述顶级域名服务器、权限域名服务器（只负责某个domain），还有一种并不属于域名服务器层次的NS：本地域名服务器local name server。

本地域名服务器是本地主机查询域名的代理：
1. 主机向本地域名服务器查询，本地域名服务器负责把最终结果给到主机，所以这种查询是 **递归查询**；
2. 本地域名服务器先向根域名请求，root NS告诉它下一级ns地址，它再向下一级ns请求……知道找到ip。这种是 **迭代查询**；

> 递归查询：当返回的时候，就是最终的结果了；
>
> 迭代查询：当返回的时候，是下一个要调用的地址。循环往复，最后终于找到了答案；

# 其他
以下是一些添加记录：

> 'A' record for puppylpg.xyz / 104.225.232.103 updated successfully
>
> 'AAAA' record for ipv6.puppylpg.xyz / fe80::a8aa:ff:fe19:5e8f added successfully
>
> 'CNAME' record for www.puppylpg.xyz / puppylpg.xyz updated successfully 
>
> 'CNAME' record for io.puppylpg.xyz / puppylpg.github.io updated successfully
>
> 'CNAME' record for goo.puppylpg.xyz / google.com added successfully
>
> 'CNAME' record for du.puppylpg.xyz / www.baidu.com added successfully
>
> 'CNAME' record for www.puppylpg.xyz / puppylpg.github.io updated successfully
>
> 'MX' record for puppylpg.xyz / 163mx01.mxmail.netease.com updated successfully
>
> 'TXT' record for puppylpg.xyz / spf.163.com added successfully

Ref：
- https://www.ruanyifeng.com/blog/2016/06/dns.html


