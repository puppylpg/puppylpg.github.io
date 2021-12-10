---
layout: post
title: "折腾小服务器 - nginx与https"
date: 2021-12-11 04:51:37 +0800
categories: Linux nginx network https
tags: Linux nginx network https
---

之前[折腾小服务器 - netdata与nginx]({% post_url 2021-12-08-vps-netdata-nginx %})使用nginx代理netdata服务，用nginx配置了简单的basic认证。但http是明文传输的，所以很容易就能在http header里发现用户名和密码，这就不太能接受了。因此配置https势在必行。

1. Table of Contents, ordered
{:toc}

# https
- https://developer.mozilla.org/en-US/docs/Glossary/https

使用ssl（Secure Sockets Layer，过时了）或者tls（Transport Layer Security）加密http，然后以ssl协议或者tls协议发送出去。所以准确的说，https这一协议其实本质上还是tls协议，只不过tls包里面的内容是http。

https用到以下知识：

## 非对称加密
TSL是使用非对称加密的。为什么？当然是因为开放的网络世界，对称加密没法做到安全分发密钥。但是分对称加密可以，因为只需要分发公钥就行了，而且每个人都可以知道，不需要保密。而私钥自己要保存好。之后就可以：公钥加密，私钥解密；反之亦然；私钥签名，公钥认证。

不过这里用的是加密的场景，跟认证关系不大。

**客户端不需要任何配置，只需要接收服务器下发的公钥，然后使用公钥加密解密就行了**。

## TLS
- https://developer.mozilla.org/en-US/docs/Glossary/TLS

现代浏览器都支持TLS，不然怎么处理https请求。

## digital certificate
- https://developer.mozilla.org/en-US/docs/Glossary/Digital_certificate

带有组织、公司等信息的密钥文件，用来声明这是谁的公钥。

## CA
但问题在于，你说公钥是你的它就是你的？谁能担保呢？万一你是中间人呢？

所以Certificate Authority出现了，作为证书颁发的机构。证书颁发机构的公钥昭告天下，世人皆知。比如我要给自己的网站创建了一个数字签名，想让CA帮我担保，CA会让我使用比如DNS验证的方式，证明这是我的签名。之后别人访问我的网站时，我的网站会返回一个数字签名，用户就可以向CA求证这个到底是不是我的签名。

关于CA和证书验证，流程，国内一家CA写了很好的科普：
- https://www.wosign.com/FAQ/faq2016-0309-03.htm

还有一系列其他基础介绍的文章：
- https：https://www.wosign.com/FAQ/faq2016-0309-01.htm
- tls加密：https://www.wosign.com/FAQ/faq2016-0309-02.htm
- PKI（Public Key Infrastructure）公钥相关：https://www.wosign.com/basic/aboutPKI.htm

# nginx配置https
生成数字签名很容易，但是想要CA帮忙认证做担保就需要给CA交钱了。查了一下一年好几百，比服务器还贵，所以就决定采用自签名方式了。

所谓自签名方式，其实就是数字签名不交给CA认证，直接发给用户使用。坏处就是浏览器比如chrome就会提醒用户：这个证书不安全，没有经过CA认证，无法验证是否真的是属于该网站的。

> chrome：您的连接不是私密连接
> 我：继续前往

还可以手动把这个证书加到系统的受信任区，相当于白名单，这样浏览器就不替你瞎操心了。

chrome貌似没有这个权限，使用ie浏览器打开网站，就有把证书安装到系统的功能。

- https://cnzhx.net/blog/self-signed-certificate-as-trusted-root-ca-in-windows/

## 生成自签名的certificate
通过openssl生成证书和私钥：
- https://stackoverflow.com/questions/10175812/how-to-generate-a-self-signed-ssl-certificate-using-openssl?rq=1

```
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -sha256 -days 365 -nodes
```
`-nodes`是no DES，访问私钥的时候不需要单独的密码。

最后还要交互式输入一些组织结构信息、发布人、邮箱等。反正也不提交给CA，随便写就行。

生成的key.pem就是私钥，cert.pem就是数字证书。

## 配置到nginx

- http://nginx.org/en/docs/http/configuring_https_servers.html

主要就是：
1. 端口改为443；
2. 指定ssl的证书和私钥的路径；

之后nginx就根据http over TLS下发公钥给客户端，并使用私钥加密内容发给用户、解密用户加密的内容。

# 验证
看看配置https后的效果。

## 浏览器
除了chrome在提醒证书不可信，其实看不出来太大区别。

## wireshark
wireshark抓包就能看到不少东西了。

现在网站支持两种通过nginx访问netdata服务的方式：
1. http://puppylpg.xyz/netdata：http协议；
2. https://netdata.puppylpg.xyz：https协议；

wireshark开启流量包抓取——

对于http的情况，可以使用`http.host == netdata.puppylpg.xyz`过滤包，之后就能很容易找到GET请求，它的网络栈如下：
1. IP
2. TCP，请求只有1个tcp segment
3. HTTP，它的Authorization header里base64的内容赫然在列，wireshark甚至帮忙把base64前的内容给显示了出来……

所以相当于一眼就能看到明文的用户名和密码了。

对于https的情况，没法使用host过滤了。网络这一块儿有点儿失忆了，可能是根据http header里的Host过滤的？但是整个http都被tls加密了，所以无法解析内容。因此这里使用服务器的ip和端口来过滤http请求`ip.addr == 104.225.232.103 && tcp.port == 443`，然后发现包的内容都加密了，一堆无意义的字符。此时整个网络栈的结构为：
1. IP
2. TCP，请求由4个tcp segment组成
3. TLS，tls里记录的有http-over-tls这一信息

可以很明显感知二者的一些区别：
1. https协议的内容根本看不出来，加密了；
2. 甚至都可以认为没有“https协议”一说，而是TLS，所有加密的内容是以TLS协议的格式发送的。而http协议则是以HTTP协议发送的，HTTP和TLS的概念相对应；
3. 用了TLS之后，整个包都变大了，网络流量消耗更多；

而客户端和服务端的加密解密势必也会更消耗CPU资源。所以安全是有代价的，但只要值得，都是可以接受的。

