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

所以Certificate Authority出现了，**作为证书颁发的机构。证书颁发机构的公钥昭告天下，世人皆知**。

比如我要给自己的网站创建了一个数字签名，想让CA帮我担保：
1. 我向CA申请数字证书，CA会让我使用比如DNS验证的方式，证明我申请证书的网站的确是我的网站；
2. 审核通过，CA给我下发 **我的私钥**、**数字证书，数字证书的明文包含CA给我的公钥、机构信息等，这些明文信息由CA的私钥签名，签名也放在证书上**；
3. 用户访问我的网站时，我的网站会返回这个数字证书；
4. **用户拥有CA的公钥，来验证数字证书的签名是否正确。如果验证通过，说明证书上的公钥的确是我的公钥**；
5. 之后用户就可以用我的公钥来和我的网站聊天了：用公钥解密我加密的消息、用公钥加密消息发给我的网站；

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
>
> 我：继续前往

还可以手动把这个证书加到系统的受信任区，相当于白名单，这样浏览器就不替你瞎操心了。

chrome貌似没有这个权限，使用ie浏览器打开网站，就有把证书安装到系统的功能。

- https://cnzhx.net/blog/self-signed-certificate-as-trusted-root-ca-in-windows/

但是后来我发现一个免费帮网站做签名的CA，真是万分意外！下面一一介绍。

## 生成自签名的certificate
通过openssl生成证书和私钥：
- https://stackoverflow.com/questions/10175812/how-to-generate-a-self-signed-ssl-certificate-using-openssl?rq=1

```
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -sha256 -days 365 -nodes
```
`-nodes`是no DES，访问私钥的时候不需要单独的密码。

最后还要交互式输入一些组织结构信息、发布人、邮箱等。反正也不提交给CA，随便写就行。

生成的key.pem就是私钥，cert.pem就是数字证书。

> 不推荐给网站设置自签名证书了，毕竟下面会介绍免费的CA签名证书方案。但是自签名方式还是放在这里，可以更清楚理解证书的生成过程。

## Let's encrypt
**[Let's Encrypt](https://letsencrypt.org/getting-started/)是一个为了推广https而免费设立的CA**。所以可以使用它免费生成被承认的数字签名。

Let's Encrypt打造了一个非常顺手的数字证书获取软件[Certbot](https://certbot.eff.org/pages/about)。服务器上装好certbot之后，直接就可以获取数字签名了。

在certbot的网站上，有一个导引安装流程：
- https://certbot.eff.org/instructions?ws=nginx&os=debianbuster

### 安装snapd
第一步是在Debian上安装snapd：
- https://snapcraft.io/docs/installing-snap-on-debian

然后就可以通过snapd安装certbot了。

snapd安装的软件都在`/snap/bin`里，为了能直接访问到，可以配置个软连放到`/usr/bin`里：
```
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

### 获取证书
使用snapd装好certbot后，就可以使用certbot从Let's Encrypt获取数字证书了：
```
pichu@pokemon: ~ $ sudo certbot certonly --nginx                                                              [1:45:55]
Saving debug log to /var/log/letsencrypt/letsencrypt.log
Enter email address (used for urgent renewal and security notices)
 (Enter 'c' to cancel): shininglhb@163.com

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
Please read the Terms of Service at
https://letsencrypt.org/documents/LE-SA-v1.2-November-15-2017.pdf. You must
agree in order to register with the ACME server. Do you agree?
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
(Y)es/(N)o: Y

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
Would you be willing, once your first certificate is successfully issued, to
share your email address with the Electronic Frontier Foundation, a founding
partner of the Let's Encrypt project and the non-profit organization that
develops Certbot? We'd like to send you email about our work encrypting the web,
EFF news, campaigns, and ways to support digital freedom.
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
(Y)es/(N)o: Y
Account registered.

Which names would you like to activate HTTPS for?
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
1: puppylpg.xyz
2: netdata.puppylpg.xyz
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
Select the appropriate numbers separated by commas and/or spaces, or leave input
blank to select all options shown (Enter 'c' to cancel): 2
Requesting a certificate for netdata.puppylpg.xyz

Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/netdata.puppylpg.xyz/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/netdata.puppylpg.xyz/privkey.pem
This certificate expires on 2022-03-28.
These files will be updated when the certificate renews.
Certbot has set up a scheduled task to automatically renew this certificate in the background.

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
If you like Certbot, please consider supporting our work by:
 * Donating to ISRG / Let's Encrypt:   https://letsencrypt.org/donate
 * Donating to EFF:                    https://eff.org/donate-le
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
```
因为选的是nginx，所以certbot检测到我的nginx目前配置了两个域名：`puppylpg.xyz`和`netdata.puppylpg.xyz`。我先给后者生成了数字签名。

> 生成证书之后，给nginx配置一下就行了。后面会介绍。

**但是这个数字证书只给`netdata.puppylpg.xyz`做了认证，如果`puppylpg.xyz`也用这个证书，会导致错误**。浏览器会警告：
> 您的连接不是私密连接
>
> NET::ERR_CERT_COMMON_NAME_INVALID
>
> **此服务器无法证明它是puppylpg.xyz；其安全证书来自netdata.puppylpg.xyz。出现此问题的原因可能是配置有误或您的连接被拦截了。**

所以再来一次，给`puppylpg.xyz`也生成证书：
```
pichu@pokemon: ~ $ sudo certbot certonly --nginx                                                              [2:07:54]
[sudo] password for pichu:
Saving debug log to /var/log/letsencrypt/letsencrypt.log

Which names would you like to activate HTTPS for?
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
1: puppylpg.xyz
2: netdata.puppylpg.xyz
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
Select the appropriate numbers separated by commas and/or spaces, or leave input
blank to select all options shown (Enter 'c' to cancel): 1
Requesting a certificate for puppylpg.xyz

Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/puppylpg.xyz/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/puppylpg.xyz/privkey.pem
This certificate expires on 2022-03-28.
These files will be updated when the certificate renews.
Certbot has set up a scheduled task to automatically renew this certificate in the background.

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
If you like Certbot, please consider supporting our work by:
 * Donating to ISRG / Let's Encrypt:   https://letsencrypt.org/donate
 * Donating to EFF:                    https://eff.org/donate-le
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
```

生成的证书文件只有root用户才能读取：
```
pichu@pokemon: ~ $ ll /etc/letsencrypt                                                                        [2:17:20]
total 36K
drwx------ 3 root root 4.0K Dec 28 01:46 accounts
drwx------ 4 root root 4.0K Dec 28 02:09 archive
drwxr-xr-x 2 root root 4.0K Dec 28 02:09 csr
drwx------ 2 root root 4.0K Dec 28 02:09 keys
drwx------ 4 root root 4.0K Dec 28 02:09 live
-rw-r--r-- 1 root root  721 Dec 28 01:46 options-ssl-nginx.conf
drwxr-xr-x 2 root root 4.0K Dec 28 02:09 renewal
drwxr-xr-x 5 root root 4.0K Dec 28 01:46 renewal-hooks
-rw-r--r-- 1 root root  424 Dec 28 01:46 ssl-dhparams.pem
```
其他用户并不能读取live下的文件，因为没有r权限。更无法获取live下的文件的权限等信息，因为没有x权限。

证书默认三个月有效，certbot会同时生成crontab脚本，每天检查证书是不是过期了，并自动续期。

## 配置证书到nginx
nginx配置http文档：
- http://nginx.org/en/docs/http/configuring_https_servers.html

主要就是：
1. 端口改为443；
2. 指定ssl的证书和私钥的路径；

相关配置如下：
```
server {
    # nginx listens to this
    listen 80;
    listen 443 ssl;
    # uncomment the line if you want nginx to listen on IPv6 address
    listen [::]:80;
    listen [::]:443 ssl;

    # the virtual host name of this
    server_name netdata.puppylpg.xyz;

    # untrusted by CA
    # ssl_certificate /etc/nginx/puppylpg-ssl/cert.pem;
    # ssl_certificate_key /etc/nginx/puppylpg-ssl/key.pem;

    # CA: LET'S ENCRYPT
    ssl_certificate /etc/letsencrypt/live/netdata.puppylpg.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/netdata.puppylpg.xyz/privkey.pem;
    
    if ($scheme = http ) {
        return 307 https://$host$request_uri;
    }
```

之后nginx就根据http over TLS协议，下发公钥给客户端，并使用私钥做两件事：加密内容发给用户、解密用户发来的加密内容。

为什么还会监听80呢？岂不是还能使用http？是的，支持http请求，但是最下面三行把80的http请求自动跳转为了https请求，所以不管过来的是http还是https请求，最后用的还是https。

# 验证
看看配置https后的效果。

## 浏览器
如果用的是Let's Encrypt这个CA签发的数字签名，chrome会显示加锁标志，证明是安全连接。

如果用的是自签名的数字签名，chrome会提示证书不可信。如果选择继续访问，其实整体上没有太大区别。

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
3. TLS，tls里记录的有http-over-tls这一信息，但是具体内容已经解析不出来了，加密了；

可以很明显感知二者的一些区别：
1. https协议的内容根本看不出来，加密了；
2. **HTTP和TLS的概念相对应，是同一层的协议**。在https中，http协议被拆分放到了tls协议中，内容是以TLS协议的格式发送的。而http协议则是直接以HTTP协议发送的，
3. 用了TLS之后，整个包都变大了，网络流量消耗更多；

而客户端和服务端的加密解密势必也会更消耗CPU资源。所以安全是有代价的，但只要值得，都是可以接受的。

https的具体握手过程可参考[《HTTPS RSA 握手解析》](https://xiaolincoding.com/network/2_http/https_rsa.html)。

