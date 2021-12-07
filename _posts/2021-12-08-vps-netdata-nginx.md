---
layout: post
title: "折腾小服务器 - netdata与nginx"
date: 2021-12-08 01:46:47 +0800
categories: Linux nginx socket
tags: Linux nginx socket
---

给服务器装个监控。

1. Table of Contents, ordered
{:toc}

# munin
一开始在shadowsocks的官网上看到了munin，就装了一个。但发现监控界面比较老旧，想切换不同时段查看数据也很粗糙，基本就是重新发个请求再刷新页面内容，非常原始，体验极差，后来就不用了。所以这里就简单记录一下装的过程。

munin大概是需要启动一个server一个client，client收集数据发给server。最终通过apache展示数据。apache的配置使用的是xml，这些都是不太舒服的体验。

参考的资料大致有这些，不再详述过程：
- munin: https://munin-monitoring.org/
- munin on debian 10: https://www.osradar.com/install-munin-debian-10/
- debian munin config: https://wiki.debian.org/Munin/ApacheConfiguration
- apache in different distros: https://blog.csdn.net/puppylpg/article/details/52346654

# netdata
搜了一下比较现代化的监控系统，netdata立刻吸引了我。

netdata的安装非常简单，官网有一键安装脚本，安装后有一些重要信息提示——

开启KSM：
```
 --- Check KSM (kernel memory deduper) ---

Memory de-duplication instructions

You have kernel memory de-duper (called Kernel Same-page Merging,
or KSM) available, but it is not currently enabled.

To enable it run:

    echo 1 >/sys/kernel/mm/ksm/run
    echo 1000 >/sys/kernel/mm/ksm/sleep_millisecs

If you enable it, you will save 40-60% of netdata memory.
```
如果不是用的root账户，上面的命令无法写入成功。可以改为：
```
echo 1 | sudo tee /sys/kernel/mm/ksm/run
```
**`tee`是将stdin重定向到stdout或者file，功能和`>`类似。但是`>`是由shell来做的，没法给它加sudo**：
- https://stackoverflow.com/a/550808/7676237

**或者直接用sudo启动一个shell来执行命令**：
```
sudo sh -c "echo 1 >/sys/kernel/mm/ksm/run"
```

netdata的默认端口是19999，可以使用systemd启动关闭netdata：
```
 --- Basic netdata instructions ---

netdata by default listens on all IPs on port 19999,
so you can access it with:

  http://this.machine.ip:19999/

To stop netdata run:

  systemctl stop netdata

To start netdata run:

  systemctl start netdata
```

卸载netdata也有一键脚本。另外netdata还有更新脚本，通过cron执行，也不用操心：
```
Uninstall script copied to: /usr/libexec/netdata/netdata-uninstaller.sh


 --- Installing (but not enabling) the netdata updater tool ---
Failed to disable unit: Unit file netdata-updater.timer does not exist.
Update script is located at /usr/libexec/netdata/netdata-updater.sh

 --- Check if we must enable/disable the netdata updater tool ---
Auto-updating has been enabled through cron, updater script linked to /etc/cron.daily/netdata-updater

If the update process fails and you have email notifications set up correctly for cron on this system, you should receive an email notification of the failure.
Successful updates will not send an email.
```

# 配置nginx
netdata安装好后，有一些配置是非常建议做的：
- 配置反向代理；
- 网卡绑定；

## 配置反向代理
netdata配置好之后，直接就可以通过`puppylpg.xyz:19999`来访问了。**但是一个成熟的服务不应该把端口暴露出来，不仅不好看，用户也记不住。所以需要使用nginx做一层反向代理**。

配置反向代理：
- 使用nginx做反向代理：https://learn.netdata.cloud/docs/agent/running-behind-nginx

### 专有域名
首先在nginx的站点配置文件夹下`/etc/nginx/site-available/`创建`netdata.conf`（有没有`.conf`并不重要）：
```
upstream backend {
    # the Netdata server
    server 127.0.0.1:19999;
    keepalive 64;
}

server {
    # nginx listens to this
    listen 80;
    # uncomment the line if you want nginx to listen on IPv6 address
    listen [::]:80;

    # use password to access
    auth_basic "Protected";
    auth_basic_user_file passwords;

    # the virtual host name of this
    server_name netdata.puppylpg.xyz;

    location / {
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Server $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_pass_request_headers on;
        proxy_set_header Connection "keep-alive";
        proxy_store off;
    }
}
```
> yaml配置非常舒适。

然后在`etc/nginx/sites-enabled/`下创建一个它的软连接，重启nginx或者reload配置就启用新配置了。

主要分析一下它配置了什么——
1. 首先把netdata配置为一个上游服务，名为backend，地址是`localhost:19999`；
2. 然后配置server_name为`netdata.puppylpg.xyz`。这样，所有以域名`netdata.puppylpg.xyz`且端口80打到nginx上的请求，都会被转发到backend这个上游服务上，也就是打给了netdata。

**最后还有重要的一步：在DNS服务商那里配置`netdata.puppylpg.xyz`这个域名能访问到nginx。一般nginx直接部署在服务器80端口，所以也就是让域名能解析为服务器的ip**，要不然用户输入`netdata.puppylpg.xyz`根本连不上nginx，nginx配置的再好也没用了。

而这里，我使用的是CNAME配置，指向服务器的域名`puppylpg.xyz`：
```
≥ dig CNAME netdata.puppylpg.xyz +short
puppylpg.xyz.
```

> 关于CNAME，参考：[Linux - dig & DNS]({% post_url 2021-12-03-linux-dig-dns %})

此时`netdata.puppylpg.xyz`和`puppylpg.xyz`在DNS上没有区别，都指向同一个ip。但是nginx收到请求之后，做了区分：**只要是以`netdata.puppylpg.xyz`这个域名，80这个端口访问，请求路径为`/`，nginx就会打到`localhost:19999`**，而直接访问`puppylpg.xyz`会显示nginx的根index.html页面。

这样配置之后，一个请求的流程就变成了：
1. `netdata.puppylpg.xyz`经过DNS解析变成了服务器的ip，端口默认80；
2. 该ip:80就是nginx服务。nginx根据刚刚`netdata.conf`的配置，发现域名是`netdata.puppylpg.xyz`，于是将请求打给了`localhost:19999`，也就是netdata服务；
3. netdata服务开始处理请求；

这就是反向代理的真正含义：将服务隐藏在nginx之后，nginx作为服务的代理。这样做的好处显而易见：**所有的服务都可以配置一个专属于自己的域名了，所有的域名都指向服务器ip，请求都会打到nginx上，再由nginx按照域名转发请求给相应的服务**。

> 没买域名之前，感觉这一点儿还是比较难理解的。买域名之后一操作，一切都清晰了……

其实之前在公司配置域名跟这个是一模一样的，配置都放在公司的nginx上：
```
upstream raw-url-test-inner-youdao-com {
    server 10.109.8.215:8080 fail_timeout=5s max_fails=3 weight=1;
}

server {
    listen 80;
    server_name raw-url-test.inner.youdao.com;
    listen 443 ssl;
    ssl_certificate /usr/local/youdao/openresty/nginx/conf/ssl/inner.youdao.com.cert;
    ssl_certificate_key /usr/local/youdao/openresty/nginx/conf/ssl/inner.youdao.com.key;
    ssl_session_timeout 1d;
    ssl_session_cache shared:MozSSL:10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHExxxxxxxxxxx-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;

    if ($scheme = http ) {
        return 307 https://$host$request_uri;
    }
    access_log /disk1/logs/lb/raw-url-test.inner.youdao.com.access.log  proxy buffer=128k;
    error_log /disk1/logs/lb/raw-url-test.inner.youdao.com.error.log;

    location / {
        proxy_pass http://raw-url-test-inner-youdao-com;
    }
}
```
唯一的区别就是域名所在的DNS是公司内局域网的DNS，所以可以立即生效。

配置完之后，有两种方式可以访问netdata服务了：
1. 原始方式：`puppylpg.xyz:19999`；
2. `netdata.puppylpg.xyz` (必须保证DNS里这个域名指向nginx的ip)；

### 通用域名，专有路径
**也可以不专门搞个`netdata.puppylpg.xyz`域名，而是使用不同的路径区分不同的服务**。

再配置一个`netdata-sub.conf`：
```
upstream netdata {
    server 127.0.0.1:19999;
    keepalive 64;
}

server {
    listen 80;
    # uncomment the line if you want nginx to listen on IPv6 address
    listen [::]:80;

    # the virtual host name of this subfolder should be exposed
    #server_name netdata.example.com;
    server_name puppylpg.xyz;

    location = /netdata {
        return 301 /netdata/;
    }

    location ~ /netdata/(?<ndpath>.*) {
        proxy_redirect off;
        proxy_set_header Host $host;

        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Server $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_pass_request_headers on;
        proxy_set_header Connection "keep-alive";
        proxy_store off;
        proxy_pass http://netdata/$ndpath$is_args$args;

        gzip on;
        gzip_proxied any;
        gzip_types *;
    }
}
```
1. 上游服务依然是指向netdata服务，并取名为netdata；
2. `server_name`这次直接用了服务器域名，而不是特意配的域名；
3. `location`指向`/netdata`路径；

现在，使用`puppylpg.xyz/netdata`也可以访问netdata了。不过我还是更倾向于配置一个专有域名，好记也好看。

当然也可以不用nginx，使用apache：
- apache配置反向代理：https://learn.netdata.cloud/docs/agent/running-behind-apache

## 配置安全访问
### 增加认证
安全配置其实也是通过nginx实现的，请求到达nginx的时候，必须通过认证之后才能访问资源：
- 安全配置：https://learn.netdata.cloud/docs/configure/secure-nodes

首先配置nginx安全认证要用到的user和password：
```
printf "yourusername:$(openssl passwd -apr1)" > /etc/nginx/passwords
```
yourusername换成想用的用户名，跟linux本身的用户名没什么关系。执行命令的时候，如果不是root，可以用`tee`取代`>`。

然后给刚刚的nginx配置加上认证：
```
server {
    # ...
    auth_basic "Protected";
    auth_basic_user_file passwords;
    # ...
}
```

现在，再使用nginx访问netdata就要输入用户名和密码了：
1. `netdata.puppylpg.xyz`;
2. `puppylpg.xyz/netdata`;

### 关闭远程访问
但还有一种访问netdata的方式没有使用nginx，所以还是不需要认证的：
- `puppylpg.xyz:19999`

通过端口直接访问服务，nginx也没办法限制它了。

一个更合理的方式，应该是不把服务的端口暴露出去。比如通过防火墙关闭19999出口，使外部无法连接该端口。**更推荐的做法是服务本身绑定网卡的时候，不要绑定到有公网ip的网卡**：
1. **仅仅绑定局域网网卡**，只能局域网内直接访问服务；
2. **或者干脆仅仅绑定localhost**，只有在本机上才能直接访问该服务；

netdata默认的绑定配置是：
```
[web]
    bind to = *
```
会绑定所有的网卡：
```
netdata % netstat -anp | grep :19999
(Not all processes could be identified, non-owned process info
 will not be shown, you would have to be root to see it all.)
tcp        0      0 0.0.0.0:19999           0.0.0.0:*               LISTEN      -
tcp        0      0 104.225.232.103:19999   103.129.255.69:51550    ESTABLISHED -
tcp        0      0 127.0.0.1:53720         127.0.0.1:19999         ESTABLISHED -
tcp        0      0 127.0.0.1:53700         127.0.0.1:19999         ESTABLISHED -
tcp        0      0 127.0.0.1:19999         127.0.0.1:53700         ESTABLISHED -
tcp        0      0 127.0.0.1:19999         127.0.0.1:53720         ESTABLISHED -
tcp6       0      0 :::19999                :::*                    LISTEN      -
```
同时listen所有的ipv4和所有的ipv6。

可以改为仅监听localhost：
```
[web]
    bind to = 127.0.0.1 ::1
```
此时只有localhost被监听，而不是`0.0.0.0`：
```
netdata % netstat -anp | grep 19999
(Not all processes could be identified, non-owned process info
 will not be shown, you would have to be root to see it all.)
tcp        0      0 127.0.0.1:19999         0.0.0.0:*               LISTEN      -
tcp        0      0 127.0.0.1:55494         127.0.0.1:19999         ESTABLISHED -
tcp        0      0 127.0.0.1:19999         127.0.0.1:55494         ESTABLISHED -
```
现在，通过端口19999查询连接只能查到nginx和netdata之间的连接了，不可能再查到外部ip连到19999端口了。**而且一查就能查到两个关于19999端口的连接**，上面显示的这两个established其实是nginx和netdata互相之间的连接。通过sudo就能看出进程信息：
```
netdata % sudo netstat -anp | grep 19999
[sudo] password for pichu:
tcp        0      0 127.0.0.1:19999         0.0.0.0:*               LISTEN      578931/netdata
tcp        0      0 127.0.0.1:19999         127.0.0.1:55706         ESTABLISHED 578931/netdata
tcp        0      0 127.0.0.1:55706         127.0.0.1:19999         ESTABLISHED 577089/nginx: worke
```
这样一来，外部用户再也无法通过`puppylpg.xyz:19999`访问netdata服务了，因为这里根本没有服务在监听：
```
puppylpg@worker:~|⇒  nc -zv puppylpg.xyz 19999
nc: connect to puppylpg.xyz (104.225.232.103) port 19999 (tcp) failed: Connection refused
```

### 使用本地socket
仅仅把socket绑定为localhost是一种不把socket暴露到公网的手段。**另一种方式是干脆不使用`ip:port`这种能够在主机间IPC的方式，而使用仅用于本机上的服务间通信的方式——unix域套接字（unix domain socket）**。

**unix domain socket和基于TCP/IP或者UDP的socket都属于socket，共用同一套socket接口，可以理解为socket的不同实现**。

**如果仅需要本地通信，unix domain socket是更高效的方案，因为它仅复制数据，根本不需要进行网络报文的拆包封包、CRC校验、发送ACK等，因为本机上的通信不像网络一样不可靠，肯定不会发生丢包情况，所以也就不需要像TCP一样需要通过ACK来保证逻辑上的可靠通信**。

MySQL也可以在本地建立unix domain socket，如果client也在本地的话，就可以通过该socket直接访问了。

创建socket时，用的同样的接口，传入的参数不一样：
```
// 流式Unix域套接字
int sockfd = socket(AF_UNIX, SOCK_STREAM, 0);
// 网络socket
int sockfd = socket(AF_INET, SOCK_STREAM, 0);
```
其他比如accept的时候不需要client ip，因为都是本地进程，根本不需要ip。具体细节可以参考：
- ip socket vs. unix domain socket:  https://blog.csdn.net/Roland_Sun/article/details/50266565；
- unix domain socket program: https://www.cnblogs.com/nufangrensheng/p/3569416.html
- unix domain socket program: https://www.ibm.com/docs/en/ztpf/1.1.0.15?topic=considerations-unix-domain-sockets
- plain socket program: https://www.geeksforgeeks.org/socket-programming-cc/

给netdata创建一个unix domain socket：
```
[web]
    bind to = unix:/var/run/netdata/netdata.sock
```
**让nginx通过unix domain socket和netdata连接**：
```
upstream backend {
    server unix:/var/run/netdata/netdata.sock;
    keepalive 64;
}
```

可以列出本地的所有unix domain socket：
```
netstat -anp --unix
```


# 配置netdata本身
配置了这么一大圈，配置的都是nginx，除了绑定的socket之外，还没有对netdata本身进行配置。

配置文档：
- https://learn.netdata.cloud/docs/get-started
- config: https://learn.netdata.cloud/docs/configure/nodes

netdata提供了查看当前所有配置的接口：
- 查看当前配置：http://netdata.puppylpg.xyz/netdata.conf

配置netdata使用它提供的`edit-config`来完成。netdata的配置项挺多的（因为太强了啊），可以慢慢探索。

## 配置存储
存储是首先需要考虑的，毕竟VPS资源不富裕……

查看了一下历史记录，竟然只能存储两天的监控……毕竟netdata采集了这么多信息，默认存储却只有256m……所以从两方面修改了一下netdata的配置：
1. 修改指标采集频率，从1s一次到30s一次：`update every = 30`；
2. 存储大小设置为512m：`dbengine multihost disk space = 512`；

netdata提供了一个很好的预估所需存储空间的工具：
- https://learn.netdata.cloud/docs/store/change-metrics-storage

这么算下来，512m够我存半年的metric了，可以了。

## hostname
配置tab页的名称。默认使用hostname：`pokemon.localdomain`，不太好看，所以改掉了：`hostname = puppylpg's VPS`。但并不影响实际的hostaname值。

虽然没啥卵用，但标题确实好看了不少。

## plugin - TBD
插件好像也挺丰富强大的，等慢慢探索吧。

# 感想
1. 其实很多理论，比如DNS、反向代理，买个域名配一配实际部署一下就知道哪些是哪些了；
2. 通过折腾去了解各种理论，比如通过给VPS配置监控，部署netdata，进而了解unix socket domain，ip绑定，直观多了，既拓宽知识面，印象还深刻；
3. 学计算机真省钱啊……买域名买服务器，一年才300。后面的各种服务只要你愿意付出精力，一毛钱不花就能学到很多。这投入和其他行业比实在是太低了……

