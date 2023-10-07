---
layout: post
title: "RIP shadowsocks"
date: 2022-06-03 19:10:35 +0800
categories: network v2ray shadowsocks
tags: network v2ray shadowsocks
---

上次搞[代理 - v2ray]({% post_url 2022-01-03-proxy-v2ray %})，正好是在半年前。现在整个人看曼岛TT，看csgo赛事，Twitter关注这些选手，ins看夺冠照片，YouTube看精彩集锦，搞得妹子也眼馋。然而Mac、iPhone和iPad这种封闭的东西，我从来没碰过。但是看妹子还有一些查论文搜资料的需求也要用Google，所以还是准备花心思搞一搞，有代理同享。

> 当然代理服务器最重要的对我来说还是查资料，学技术，不然代码实在敲不下去啊……

1. Table of Contents, ordered
{:toc}

# FUCK GFW
## Mac
mac还是比较简单的，使用v2rayx就行了：
- https://github.com/Cenmrev/V2RayX
- https://v2xtls.org/v2rayx%E9%85%8D%E7%BD%AE%E6%95%99%E7%A8%8B/

比较坑的点在于：如果是直接导入的代理服务器json配置，这个软件有bug，没法设置transport setting，所以没法配置流量混淆的websocket path。折腾了好久，最后手动创建了一个配置，填上代理服务器地址，就发现transport setting也能配置了。坑……

虽然被bug坑了好久，但整体来讲，mac还是很简单的，毕竟支持直接使用安装包安装程序。接下来iOS就恶心了，绕不过去的App Store……

## iPhone尝试v2ray
iOS的App Store只能在登陆美区账号的情况下，才能搜到shadowrocket等client。但是我并不像为了给iPhone配置v2ray，就去注册个Apple美区账号，所以找了个离线安装app的方案：
- https://ssrvps.org/archives/6521

1. 找到ipa文件；
2. 通过pp助手/爱思助手离线装到手机上：https://ssrvps.org/archives/6538；
3. 使用shadowrocket连接代理服务器；

但是这里提供的另外两个ipa需要登录美区Apple账号才能用，shadowrocket版本则太低，虽然支持vmess，但是不支持vmess流量混淆。所以我自己找了个高版本的shadowrocket ipa，但因为不越狱无法装到iPhone上。

## 部署shadowsocks-R
夜越来越深，破iPhone还是没搞定。逐渐失去耐心，干脆就用这个能用的shadowrocket得了……只需要VPS上再部署一个shadowsocks-R代理服务。虽然反GFW能力没那么强，但据说还行？

于是找了个docker镜像：
- https://hub.docker.com/r/teddysun/shadowsocks-r

按上面一通操作，在iPhone上使用刚刚低版本的shadowrocket连上了shadowsocks-R。

结果刚使用一分钟，服务器的ip直接被封了……

## 服务器更换ip
一开始的表现是不仅代理挂了，portainer页面挂了，连ssh都挂了。这时候我意识到ip可能被封了，果然，ping域名和ip已经不通了。

此时再去vps服务页搞服务器迁移，并不成功：
> Migration backend is currently not available for this VPS. Please try again

使用仅存的baidu查了一下，看来是ip被封了之后得使用小钱钱解决问题了：
- 被封了：https://www.bandwagonhost.net/3174.html
- 检测自己被封了：https://kiwivm.64clouds.com/VPS_ID/main-exec.php?mode=blacklistcheck
    + https://tcp.ping.pe/puppylpg.xyz:443
- 换ip：https://bwh89.net/ipchange.php

> 每当代理挂了之后，使用百度的时候总感觉自己很可怜。是困在地道里吃最后一点战备粮的可怜人……绝望而无力……

一个比较有用的地方是使用https://port.ping.pe/检测自己端口是否被封了。可以看到除了中国大陆的client，其他地方都能ping通。被GFW封了无疑。

赶紧提个换ip的ticket，付了$8.8之后，等了一段，得到一个新的ip。

# iPhone just v2ray
一通折腾，换了ip之后，VPS又可以用了。还好封的是ip，去namesilo做一些DNS设置，给域名换个ip就行了，其他都不用动。

没想到GFW竟然这么猛！去年年底部署shadowsocks，用了一个星期才封掉我的端口。现在部署shadowsocks-R，刚用一分钟整个ip都没了……

没得选了，老老实实连我的带流量混淆的服务器吧。那就只有一个选择了：使用美区Apple账号老老实实给iPhone装个新版的shadowrocket。

1. 注册美区Apple账号；
2. 使用大陆visa全币种信用卡买苹果充值卡；
3. 美区账号登录iPhone，充值卡兑换；
4. 购买shadowrocket；

## 注册美区Apple账号
美区Apple账号当然是能不自己注册就不自己注册，懒。但是网上查到的共享账号都被封禁了，或者监测到异常需要验证。没办法，最终还是要自己注册。

按这个注册就行了：
- https://zhuanlan.zhihu.com/p/367821925

美国地址生成器：https://www.meiguodizhi.com/，先选好免税州阿拉斯加再生成。

碰到问题就看评论区，基本就能解决了。

## 买充值卡
使用新注册的美区账号登录App Store之后，可以搜到shadowrocket了，但是这个app需要购买（$2.99）。据说要用美国信用卡买，所以直接买是没戏了，只能曲线救国，使用大陆visa买个礼品充值卡，再使用美区账号兑换礼品卡。

- https://zhuanlan.zhihu.com/p/476434200

# shadowrocket配置
终于在iPhone上装好了shadowrocket。接下来配置代理服务器就比较简单了：
1. 使用vmess协议；
2. 配置websocket流量混淆，设置好路径；
3. 开启tls；

参考：
- https://v2xtls.org/shadowrocket%E9%85%8D%E7%BD%AEv2ray%E6%95%99%E7%A8%8B/

# 后记
看着妹子像个刚学会上网的老年人一样开心，感觉无比舒心。没白折腾一天。
