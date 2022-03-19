---
layout: post
title: "dockerize"
date: 2022-03-20 03:13:15 +0800
categories: docker
tags: docker
---

三月是被docker打动的一个月。

1. Table of Contents, ordered
{:toc}

# docker碎碎念
关于docker，之前很早我就有耳闻，前两年也简单了解了一下，去年甚至还简单改了一个下载youtube视频的工程，并打包成了docker镜像。但是真正系统地去了解docker，还是在最近。

为什么docker又被我摆到了台前？其实只是最近为了找一个日志记录的系统，记录一下自己平日里的碎碎念。找着找着就找到了monica，看起来还是比较满意的，就打算部署一下。正好部署的方式有docker，就想着借这个机会，维护一下docker服务吧，毕竟需求是学习的最大动力，有了需求自然会在为了满足需求的过程中，搞得越来越深入。

不得不说，思路还是很正确的。在这里就捋着这条思路，把自己最近dockerize的简单经验记录一下。

> dockerize是我编的，没想到搜了一下还真有一个docker相关的工程叫[dockerize](https://github.com/jwilder/dockerize)，有空了了解一下。

# monica
第一个部署的docker容器是[monica](https://github.com/monicahq/monica)，它本身是支持docker部署的，部署起来巨方便！尤其是我这种对前端技术几乎不了解的后端开发，docker部署前端的东西简直是救命神器！什么都不用管，只管自己关心的就行了。

一开始就直接按照文档在服务器上使用docker部署monica了，使用了几天觉得还不错，才看到更高阶的两种部署方式：
1. 使用volume持久化数据；
2. 使用docker compose，使用网络连接两个服务；

## docker数据copy
就创建了新的volume，把老数据从container里copy到新的volume上：
- 把数据从container里copy出来：https://stackoverflow.com/questions/71427566/how-to-migrate-data-from-docker-container-to-a-newly-created-volume
- 把数据copy到volume里：https://stackoverflow.com/a/37469637/7676237

虽然可以像copy实体数据一样直接把数据copy到实体数据里，但还是推荐上面这种docker的标准命令把数据从实体机copy到container的volume上。

无独有偶，这两天视图dockrize netdata，也碰到了类似copy数据的方式：
- https://learn.netdata.cloud/docs/agent/packaging/docker#host-editable-configuration

搞个临时容器把数据copy出来，然后再删掉：
```
mkdir netdataconfig
docker run -d --name netdata_tmp netdata/netdata
docker cp netdata_tmp:/etc/netdata netdataconfig/
docker rm -f netdata_tmp
```
感觉以后想获取哪个服务的默认配置，这种方式很方便啊！

然后再把volume挂载到新的monica上，再然后monica就工作不正常了……

看来数据迁移这种东西，最好还是一开始就搞定的。

## docker network
docker的网络确实很不错，直接使用linux内核的代码创建的网络，所以使用`ip addr`指令，是可以直接看到docker默认创建的`docker0`网络的。

用户还可以创建任意名称的网络，然后使用网络给不同容器组网：
1. 一个网络是一个封闭的网络；
2. 有一个网段；
3. 同一个网络内的容器会分配该网段的不同ip；
4. 如果使用`--name`指定了容器名，不同容器之间可以直接通过容器名通信，相当于内置了DNS服务器。自动生成的容器名则不能被当做hostname使用。

这一组网功能不禁让我想起了自己当年做毕设时使用虚拟机组网的惨痛经历：
- https://blog.csdn.net/puppylpg/article/details/64918562

当年毕设时为了用StrongSwan配置IPSec，用VMWare搞了四台虚拟机组网，老实说，要不是最后搞到了实验室服务器的root密码，在配置牛逼的服务器上起的VMWare，那我毕设大概率不保了……然而看到docker轻轻松松用alpine和内置网络组了个集群，只能说虚拟机一路走好~

这里推荐非常深入签出的docker入门教程：
- 《深入浅出Docker》：https://book.douban.com/subject/30486354/

不得不说，作者把深层次原理讲得相当简洁易懂，把docker的历史梳理地也很规整，这些对学习docker的技术本身都是有帮助的。翻译也很给力！

> 某effective java第三版的中文版简直就是翻译出了个屎……

最终，数据迁移失败。再加上后来好不容易配置mailgun搞定了monica的邀请功能，结果发现邀请功能很鸡肋，其实就是多个账户完全无差别地管理同一份数据……这个就比较扯一些。导出数据也老报错，就放弃monica了。

# dailyTXT
放弃Monica，除了因为不太符合我的期待，还有一个原因是找到了[dailyTXT](https://github.com/PhiTux/DailyTxT)，一个非常轻量又好用的日记系统。随着对docker喜爱的加深，我现在几乎只找能docker部署的服务了，恰好dailyTXT又支持docker，天作之合！

dailyTXT的主要优点：
- 有日历；
- 可搜索；
- 能上传图片；
- 导入导出数据非常干脆利落；
- 哦，还有一点，很轻量化，内存占用很小，才40多兆。很适合小服务器部署。而Monica至少100M+的内存，200M+的swap，今天甚至有一刻把小服务器卡爆了。

> 1G内存的服务器狂喜。而Monica把服务器卡爆了的表现：CPU占用100%，发现基本都是系统占用的，load很高。后来看磁盘才发现是内存捉紧导致swap拉满，swap拉满会导致疯狂用磁盘，整个系统的cpu就拉满了，load爆高。关掉一个占内存的东西，啥都好了。

不过dailyTXT也有不尽如人意的地方，比如：
- 一天不能post多条；
- 没有多条post所以不能分条显示；
- 自动保存太快了……而且都会产生历史记录，导出的时候也会带出来，我觉得太乱了；

之后打算改改dailyTXT，顺便学学前端。

还想加一些新的东西：
- 打标签，所有标签可以显示在主界面，至少标签界面；
- 支持复制图片；

# docker ui
docker部署应用是非常方便的！管理应用也不麻烦，但是每次敲那么长的docker命令效率还是有些低，自然而然就想找一个docker ui。

经过调研，主流的docker ui基本就两种：portainer和rancher。rancher公司里也在用，但是[根据我深入地观察](https://peppe8o.com/portainer-vs-rancher-comparison-between-the-2-docker-gui/)：
- rancher是为中大规模的docker准备的，比如k8s；
- 而portainer是为小docker集群或者独立docker准备的，而且占用内存特别小。

所以自然而然就装了portainer。

> 1G内存的服务器再次狂喜。portainer只占大概30M内存。

## docker socket
portainer的安装文档：
- https://docs.portainer.io/v/ce-2.9/start/install/server/docker/linux

里面有一处比较有意思：
```
-v /var/run/docker.sock:/var/run/docker.sock
```
把宿主机的docker unix socket挂载到了portainer docker容器里。

我猜因为portainer本身是通过container起的，它把真正的docker的socket挂载到容器上，然后就可以通过这个socket读取宿主机上部署的docker的相关信息了。

后来找到一篇这个，基本验证了我的猜想：
- https://my.oschina.net/362228416/blog/812515

> unix socket也是有其系统调用函数的，docker在上面也提供了查询接口。

有了ui，关闭、删除container，管理image、network、volume，查看container的运行状态，日志，方便了太多太多！

# v2ray
继续把服务器上现有的服务往docker上搬！v2ray，作为购买服务器的主力应用，首先考虑！

然而迁移v2ray的过程非常不顺利。

按照教程部署v2ray docker：
- https://guide.v2fly.org/app/docker-deploy-v2ray.html#%E6%9B%B4%E6%96%B0%E7%AD%96%E7%95%A5

配置使用的是宿主机上已有的v2ray的配置，只不过为了避免保险起见，重新copy了一份`docker.config.json`作为container版v2ray的配置：
```
docker run -d --name v2ray -v /etc/v2ray:/etc/v2ray -p 127.0.0.1:10087:10087 v2fly/v2fly-core:v4.23.4 v2ray -config=/etc/v2ray/docker.config.json
```

## docker container内网络绑定
第一个碰到的问题就是，之前实体机v2ray的配置，为了不暴露给公网，绑定的是127.0.0.1。**如果container内的v2ray绑定这个ip，宿主机就连不上docker里的v2ray了！只有container自己内部才能访问它的v2ray应用**！

> 这和宿主机本机上的应用才能访问绑定127.0.0.1的应用一个道理。

改成绑定`0.0.0.0`之后，宿主机终于连上了container里的v2ray了，但依然无法使用。

正常的v2ray连接后：
```
pokemon➜  v2ray  ᐅ  netstat -anp | grep 10086
(Not all processes could be identified, non-owned process info
 will not be shown, you would have to be root to see it all.)
tcp        0      0 127.0.0.1:10086         0.0.0.0:*               LISTEN      -
tcp        0      0 127.0.0.1:10086         127.0.0.1:37760         ESTABLISHED -
tcp        0      0 127.0.0.1:10086         127.0.0.1:37718         ESTABLISHED -
tcp        0      0 127.0.0.1:37760         127.0.0.1:10086         ESTABLISHED -
tcp        0      0 127.0.0.1:37784         127.0.0.1:10086         ESTABLISHED -
tcp        0      0 127.0.0.1:37806         127.0.0.1:10086         ESTABLISHED -
tcp        0      0 127.0.0.1:10086         127.0.0.1:37784         ESTABLISHED -
tcp        0      0 127.0.0.1:10086         127.0.0.1:37806         ESTABLISHED -
tcp        0      0 127.0.0.1:10086         127.0.0.1:37748         ESTABLISHED -
tcp        0      0 127.0.0.1:37718         127.0.0.1:10086         ESTABLISHED -
tcp        0      0 127.0.0.1:37748         127.0.0.1:10086         ESTABLISHED -
```
docker后的v2ray连接后：
```
pokemon➜  v2ray  ᐅ  netstat -anp | grep 10087
(Not all processes could be identified, non-owned process info
 will not be shown, you would have to be root to see it all.)
tcp        0      0 127.0.0.1:10087         0.0.0.0:*               LISTEN      -
tcp        0      0 127.0.0.1:10087         127.0.0.1:59938         ESTABLISHED -
tcp        0      0 127.0.0.1:10087         127.0.0.1:59930         TIME_WAIT   -
tcp        0      0 127.0.0.1:59938         127.0.0.1:10087         ESTABLISHED -
tcp        0      0 127.0.0.1:10087         127.0.0.1:59934         TIME_WAIT   -
tcp        0      0 172.17.0.1:58536        172.17.0.3:10087        ESTABLISHED -

```

## 切换版本
这个让我想起了开启debug：
- https://post.smzdm.com/p/apzek86w/

当应用出错后，与其乱猜，寻找开启debug日志的方法是个更靠谱的方案：
```
2022/03/13 16:00:52 V2Ray 4.44.0 started
2022/03/13 16:01:20 [3187668690] app/proxyman/inbound: connection ends > proxy/vmess/inbound: invalid request from 114.249.24.222:0 > common/drain: common/drain: drained connection > proxy/vmess/encoding: invalid user: VMessAEAD is enforced and a non VMessAEAD connection is received. You can still disable this security feature with environment variable v2ray.vmess.aead.forced = false . You will not be able to enable legacy header workaround in the future.
```
查了一下，一堆相关问题：
- https://91ai.net/thread-950258-1-1.html
- https://github.com/233boy/v2ray/issues/812#issuecomment-1066138522

听说是从4.24起加入的，22年开始强制启用。所以我直接用4.23版本：
```
docker run -d --name v2ray -v /etc/v2ray:/etc/v2ray -p 127.0.0.1:10087:10087 v2fly/v2fly-core:v4.23.4 v2ray -config=/etc/v2ray/docker.config.json
```
这就是使用docker的方便之处啊——**一键启动 & 任意版本切换**！！！

还意外地发现，protainer能统计container累计的网络总使用量！这样一来，甚至不用去搬瓦工查看累计流量使用情况了~

# docker nginx
这么多应用都搬到docker里了，自然想把nginx也搬到docker里。其实维护nginx最主要的部分，是反向代理配置文件：
- 一个没找到合适答案的问答：https://stackoverflow.com/questions/26921620/should-you-install-nginx-inside-docker
- 一篇不错的文章，大致扫了一下：https://nickjanetakis.com/blog/why-i-prefer-running-nginx-on-my-docker-host-instead-of-in-a-container

扫完第二篇文章，我也觉得将nginx搬到docker里没啥必要。它还提到一个点赞量很高的nginx-proxy项目，自动为一个nginx生成其他container的conf。但是个人感觉太麻烦了，而且想要开启ssl的话，对生成的cert的名称还有要求，和certbot的名称并不一致。所以还是算了。使用这个框架并引入一堆约定的代价并不太值得，到最后可能还是像文章作者说的，你还要自定义一大堆东西，这个难度还不如自己配置一个nginx 的conf。

# docker netdata
把netdata搬到docker比较灾难：
- https://learn.netdata.cloud/docs/agent/packaging/docker

首先，挂载宿主机的netdata配置并不能正常启动netdata。其次，使用container之后编辑netdata的配置并不方便。即使它提供了一种挂载的方案，个人感觉也不是很方便。下次重新在服务器上部署netdata的时候，再考虑重新部署netdata docker，并挂载`/etc/netdata`作为配置吧。

和portainer类似的是，既然想监控宿主机的数据，那就需要把宿主机的相应文件挂载到container里：
```
  -v /etc/passwd:/host/etc/passwd:ro \
  -v /etc/group:/host/etc/group:ro \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -v /etc/os-release:/host/etc/os-release:ro \
```

# docker nginx-digest-auth
这是一个让我感触良多的使用docker的方式：nginx的digest auth模块并没有标准化，所以原作者就想用docker打包一个带有digest auth模块的nginx，做测试用。

在alpine里，下载一个标准nginx，下载digest auth模块，然后编译为nginx，并启动docker部署：
- https://github.com/puppylpg/dockerfiles/blob/master/nginx-digest/Dockerfile

最后就可以非常方便地使用构造好的镜像测试带digest auth的nginx了：
- https://hub.docker.com/repository/docker/puppylpg/nginx-digest-auth-test

# 感想
docker的优点经过这么多个dockerize的实践，已经能总结出来一些了：
- 一键部署，不用安装、学习那些你不懂也完全不关心的应用框架；
- 应用的任意版本，随便切换；
- 想要魔改应用，直接做个docker镜像就行了，不污染宿主机软件运行环境；

而docker相比VM，无需启动新的os这一非常轻量化的优点，让它变得非常好用！docker真的是划时代的技术！而docker和上述这些有趣有有用的应用，让人认识到，1G内存还是能干很多事的……

这是一个什么样的世界？它充满了武功秘籍——瞬间移动，隐身，七十二变，在这里应有尽有！更令人咂舌的是，所有的秘籍都一份份摆在你的面前，没有人故弄玄虚守口如瓶，甚至还有很多人眼巴巴看着你，鼓励你，教导你，希望你能好好研习其中的奥义！而你只是一介凡人，通过习得一项项技能，就能在这个世界上越来越游刃有余！而世界上，你这一类人终究只是少数，这就意味着大部分人其实都没有这些福利。这不是游戏的设定，这就是真实的世界！这就是真实的编程的世界！


