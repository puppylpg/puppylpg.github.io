---

layout: post  
title: "Docker - 容器化nginx"  
date: 2023-03-13 01:20:41 +0800  
categories: docker nginx websocket  
tags: docker nginx websocket

---

终于找到一个容器化nginx的好方法！

> 三月真不愧是被docker打动的一个月。
>

1. Table of Contents, ordered  
{:toc}

# 容器化nginx
去年给vps上的服务做了容器化[Docker - 容器化]({% post_url 2022-03-20-dockerize %})。最后想容器化nginx，没成功：

> 这么多应用都搬到docker里了，自然想把nginx也搬到docker里。其实维护nginx最主要的部分，是反向代理配置文件：
>
> + 一个没找到合适答案的问答：[https://stackoverflow.com/questions/26921620/should-you-install-nginx-inside-docker](https://stackoverflow.com/questions/26921620/should-you-install-nginx-inside-docker)
> + 一篇不错的文章，大致扫了一下：[https://nickjanetakis.com/blog/why-i-prefer-running-nginx-on-my-docker-host-instead-of-in-a-container](https://nickjanetakis.com/blog/why-i-prefer-running-nginx-on-my-docker-host-instead-of-in-a-container)
>
> 扫完第二篇文章，我也觉得将nginx搬到docker里没啥必要。它还提到一个点赞量很高的nginx-proxy项目，自动为一个nginx生成其他container的conf。但是个人感觉太麻烦了，而且想要开启ssl的话，对生成的cert的名称还有要求，和certbot的名称并不一致。所以还是算了。使用这个框架并引入一堆约定的代价并不太值得，到最后可能还是像文章作者说的，你还要自定义一大堆东西，这个难度还不如自己配置一个nginx的conf。
>

主要麻烦的地方是自己的nginx有很多个性化配置，需要自己在官方nginx镜像的基础上打包一个带有自己配置的专属nginx镜像。但是nginx是需要经常修改的，如果每次修改config都要重新打包nginx镜像，未免太麻烦了。看来看去，最后还是觉得直接使用nginx更简单一些。

但是nginx用的时间久了，依然会感到麻烦。每次新增一个反向代理都要在`/etc/nginx/sites-available`里重新搞一个config，并软链接到`/etc/nginx/sites-enabled`。config的内容跟之前也是大同小异，重复步骤过多。还要使用certbot手动创建ssl证书，相当费劲。

> 是的我又飘了，一开始知道certbot的时候，简直高兴到飞起。今是昨非，现在甚至已经觉得它麻烦了:D
>

今天仔细看了一下[nginx-proxy](https://github.com/nginx-proxy/nginx-proxy)，发现之前太年轻了，这个正好集成了自动生成nginx配置、自动生成ssl证书的功能，非常方便！

> “太年轻了”：指太菜了，docker了解得太浅显。
>

# nginx-proxy + acme-companion
组合使用下面两个服务即可：

+ [nginx-proxy](https://github.com/nginx-proxy/nginx-proxy)：根据docker container生成反向代理配置；
+ [acme-companion](https://github.com/nginx-proxy/acme-companion)：根据container生成ssl；

二者加起来，就是常配置的http[s]反向代理。此外还支持websocket、location等。

nginx-proxy[主要通过go template](http://jasonwilder.com/blog/2014/03/25/automated-nginx-reverse-proxy-for-docker/)生成反向代理配置文件。

![](https://raw.githubusercontent.com/nginx-proxy/acme-companion/736b9302c170a386fdc051aa61df0b5d6a08b78c/schema.png)

参考[acme-companion的readme](https://github.com/nginx-proxy/acme-companion)搭建两个服务。首先启动一个nginx-proxy：

```bash
docker run --detach \
--name nginx-proxy \
--publish 80:80 \
--publish 443:443 \
--volume certs:/etc/nginx/certs \
--volume vhost:/etc/nginx/vhost.d \
--volume html:/usr/share/nginx/html \
--volume /var/run/docker.sock:/tmp/docker.sock:ro \
--restart=always \
nginxproxy/nginx-proxy:latest
```

绑定80和443端口。

同时[需要挂载一些volume](https://github.com/nginx-proxy/acme-companion/blob/main/docs/Persistent-data.md)，比如：

+ `/etc/nginx/certs` to store certificates and private keys (readonly for the nginx-proxy container).
+ `/etc/nginx/vhost.d` to change the configuration of vhosts (required so the CA may access http-01 challenge files).
+ `/usr/share/nginx/html` to write http-01 challenge files.

这里还要绑定`/var/run/docker.sock`到容器内的`/tmp/docker.sock`，**因为要读取docker contianer的状态以自动增删nginx反向代理配置**。

因为下面还要绑定youtube-dl_default，所以还要带上参数：`--net my-network`

```bash
docker run --detach \
--name nginx-proxy \
--publish 80:80 \
--publish 443:443 \
--volume certs:/etc/nginx/certs \
--volume vhost:/etc/nginx/vhost.d \
--volume html:/usr/share/nginx/html \
--volume /var/run/docker.sock:/tmp/docker.sock:ro \
--net my-network \
--restart=always \
nginxproxy/nginx-proxy:latest
```

当然也可以后期再连接上网络：`docker network connect youtube-dl_default nginx-proxy`。

然后启动acme-companion：

```bash
docker run --detach \
--name nginx-proxy-acme \
--volumes-from nginx-proxy \
--volume /var/run/docker.sock:/var/run/docker.sock:ro \
--volume acme:/etc/acme.sh \
--env "DEFAULT_EMAIL=puppylpg@puppylpg.top" \
--restart=always \
nginxproxy/acme-companion:latest
```

通过`--volumes-from`挂载同样的volume，还要多挂载一个volume以保存acme.sh：

+ a fourth volume must be declared on the acme-companion container to store acme.sh configuration and state: /etc/acme.sh.

`DEFAULT_EMAIL`是可选的，ssl报错用：

> Albeit optional, it is recommended to provide a valid default email address through the DEFAULT_EMAIL environment variable, so that Let's Encrypt can warn you about expiring certificates and allow you to recover your account.
>

其他参考：

+ [Hosting Multiple Websites with SSL using Docker, Nginx and a VPS](https://blog.harveydelaney.com/hosting-websites-using-docker-nginx/)

事实证明，其他docker服务和nginx-proxy不必有启动先后顺序限定，因为nginx-proxy是通过调用docker的api获取的信息。

# 自动生成反向代理
之后就可以通过给container设置上以下变量，来自动为container生成反向代理了：

+ `VIRTUAL_HOST`：Host域名，nginx分流的依据；
+ `LETSENCRYPT_HOST`：和`VIRTUAL_HOST`的值相同，用于let's encrypt生成ssl；
+ `LETSENCRYPT_EMAIL`：如果没写，[默认用](https://github.com/nginx-proxy/acme-companion/blob/736b9302c170a386fdc051aa61df0b5d6a08b78c/docs/Let's-Encrypt-and-ACME.md?plain=1#L87)`DEFAULT_EMAIL`；
+ `VIRTUAL_PORT`：容器的访问端口（比如springboot服务默认的8080）；

`VIRTUAL_PORT`**代表容器的访问端口，同时也是nginx配置里的upstream的端口**：

1. **我们应该显式设置该值为后端服务的监听端口**；
2. 如果设置了值，则nginx-proxy使用该值；
3. 如果没设置，且container只expose了一个port，使用该port。[container有多种方式expose端口](https://docs.docker.com/engine/reference/run/#expose-incoming-ports)：
    1. 可以是Dockerfile里的`EXPOSE`；
    2. 可以是docker指令里的`--expose`；
    3. 但是nginx-proxy里没有提及`-p`和`--link`：The containers being proxied must expose the port to be proxied, either by using the `EXPOSE` directive in their Dockerfile or by using the `--expose` flag to `docker run` or `docker create`；
4. 否则使用默认值80；

如果`VIRTUAL_HOST`的值（无论是显示设置的，还是默认使用的80）和container的访问端口不一致，将无法正确访问服务。

> **不同container完全可以使用同一个端口，不会冲突，因为大家有不同的ip。**
>
> 如果没有publish，在host上使用`netstat`看不到这些container的端口。
>

如果通过`-p`参数把容器的端口发布到host上，比如`-p 127.0.0.1:9999:8765`，nginx-proxy在生成upstream的时候会提示：**container的port被发布到了host上，client可以绕过nginx-proxy访问container服务**

```nginx
upstream memory.puppylpg.top {                          
    # Container: dailytxt                     
    #     networks:         
    #         bridge (reachable)                                                                                              
    #     IP address: 172.17.0.3                                                                                              
    #     exposed ports: 8765/tcp                                                                                             
    #     default port: 8765                    
    #     using port: 8765                            
    #         /!\ WARNING: Virtual port published on host.  Clients                                                           
    #                      might be able to bypass nginx-proxy and
    #                      access the container's server directly.
    server 172.17.0.3:8765;                
}  
```

使用示例：

```bash
$ docker run --detach \
--name grafana \
--env "VIRTUAL_HOST=othersubdomain.yourdomain.tld" \
--env "VIRTUAL_PORT=3000" \
--env "LETSENCRYPT_HOST=othersubdomain.yourdomain.tld" \
--env "LETSENCRYPT_EMAIL=mail@yourdomain.tld" \
grafana/grafana
```

**所有自动生成的配置均放置在container里的**`/etc/nginx/conf.d/default.conf`。

> 由[Nginx]({% post_url 2021-12-12-nginx %})可知，`/etc/nginx/nginx.conf`会通过`include /etc/nginx/conf.d/*.conf;`把它引用到`http`配置里。
>

## 正确性校验
### 直接查看配置
**可以使用**`docker exec nginx-proxy nginx -T | less`**查看nginx配置以进行问题定位。**

> 整个命令的含义是在nginx-proxy容器里执行`nginx -T`命令。
>

```plain
-T             Same as -t, but additionally dump configuration files to standard output.

-t             Do not run, just test the configuration file.  nginx checks the configuration file syntax and then tries to open files referenced in the configuration file.
```

### 发送请求
也可以直接发送http请求来nginx配置的正确性：

```bash
curl -H "Host: netdata.puppylpg.top" localhost
```

**直接往localhost发送一个带有相应Host header的http请求即可，这也是nginx分流的本质！**

默认情况下，nginx-proxy搭配acme会让http请求301重定向到https，所以也可以直接使用https请求。比如查看netdata的config：

```bash
curl -k -H "Host: netdata.puppylpg.top" https://localhost/netdata.conf
```

使用`-k`允许自签名证书：

```plain
  -k, --insecure
         (TLS) By default, every SSL connection curl makes is verified to be secure. This option allows curl to proceed and operate even for server connections otherwise considered insecure.

         The server connection is verified by making sure the server's certificate contains the right name and verifies successfully using the cert store.
```

## 自定义配置
默认情况下，nginx支持的最大request是1M，通过`client_max_body_size`控制。如果部署了一些需要上传图片的服务，很可能就会因为request太大导致nginx返回`413 (Request Entity Too Large)`。可以按照需求给这个参数设置为一个大小，甚至直接设置为0，禁用request size校验。

### 直接修改容器内的配置
> 容器被删后就没了。
>

在nginx-proxy里可以直接进入容器修改配置文件：

```plain
docker exec -it nginx-proxy bash
```

（使用apt安装nano或vim）编辑`/etc/nginx/nginx.conf`文件，在 http 块中添加或修改 `client_max_body_size` 指令。

在容器内执行以下命令来重新加载配置：

```plain
nginx -s reload
```

这样就可以生效了。

### Custom Nginx Configuration
参考[官方文档](https://github.com/nginx-proxy/nginx-proxy/tree/main/docs#custom-nginx-configuration)。

host上新建一个文件`nginx.default.properties`，加入`client_max_body_size 0;`，然后把它挂载到容器的`/etc/nginx/conf.d/`下并以`.conf`结尾：

```bash
docker run --detach \
--name nginx-proxy \
--publish 80:80 \
--publish 443:443 \
--volume certs:/etc/nginx/certs \
--volume vhost:/etc/nginx/vhost.d \
--volume html:/usr/share/nginx/html \
--volume /var/run/docker.sock:/tmp/docker.sock:ro \
--volume /home/pichu/nginx.default.properties:/etc/nginx/conf.d/my_proxy.conf:ro \
--restart=always \
nginxproxy/nginx-proxy:latest
```

# 单容器部署
## portainer
```bash
docker run --detach --name portainer \
--restart=always \
-v /var/run/docker.sock:/var/run/docker.sock \
-v portainer_data:/data \
--env VIRTUAL_HOST=portainer.puppylpg.top \
--env VIRTUAL_PORT=9443 \
--env VIRTUAL_PROTO=https \
--env LETSENCRYPT_HOST=portainer.puppylpg.top \
portainer/portainer-ce:latest
```

portainer比较特殊，在[Docker - 容器化]({% post_url 2022-03-20-dockerize %})里可以看到，它只开启了https访问，没有开启http，所以反向代理必须设置为https。另外，portainer的UI在[9443](https://docs.portainer.io/start/install-ce/server/docker/linux)端口，所以这里我们要手动指定。

nginx-proxy支持通过设置`VIRTUAL_PROTO=https`指定使用https协议进行反向代理。

生成的配置：

```nginx
# portainer.puppylpg.top/
upstream portainer.puppylpg.top {                            
    # Container: portainer                                                                                                    
    #     networks:                                                                                                           
    #         bridge (reachable)                        
    #     IP address: 172.17.0.2                         
    #     exposed ports: 8000/tcp 9000/tcp 9443/tcp                                                                           
    #     default port: 80                                
    #     using port: 9443                               
    server 172.17.0.2:9443;                                
}                                                            
server {                                                    
    server_name portainer.puppylpg.top;                                                                                       
    listen 80 ;                                          
    access_log /var/log/nginx/access.log vhost;          
    # Do not HTTPS redirect Let's Encrypt ACME challenge 
    location ^~ /.well-known/acme-challenge/ {              
        auth_basic off;                                                                                                                                                                                                                                     
        auth_request off;                                                                                                                                                                                                                                   
        allow all;                                                                                                            
        root /usr/share/nginx/html;                                                                                           
        try_files $uri =404;                                                                                                                                                                                                                                
        break;                                                 
    }                                                                                                                         
    location / {                                         
        return 301 https://$host$request_uri;            
    }                                                        
}                                                                                                                             
server {                                                       
    server_name portainer.puppylpg.top;                                                                                       
    access_log /var/log/nginx/access.log vhost;          
    listen 443 ssl http2 ;                                                                                                    
    ssl_session_timeout 5m;                               
    ssl_session_cache shared:SSL:50m;                       
    ssl_session_tickets off;                                   
    ssl_certificate /etc/nginx/certs/portainer.puppylpg.top.crt;                                                              
    ssl_certificate_key /etc/nginx/certs/portainer.puppylpg.top.key;                                                          
    ssl_dhparam /etc/nginx/certs/portainer.puppylpg.top.dhparam.pem;                                                          
    ssl_stapling on;                                          
    ssl_stapling_verify on;                              
    ssl_trusted_certificate /etc/nginx/certs/portainer.puppylpg.top.chain.pem;                                                
    set $sts_header "";                                  
    if ($https) {                                        
        set $sts_header "max-age=31536000";              
    }                                                        
    add_header Strict-Transport-Security $sts_header always;
    include /etc/nginx/vhost.d/default;                  
    location / {                               
        proxy_pass https://portainer.puppylpg.top;             
    }                                                   
}
```

注意，最后生成的`proxy_pass`用的是https协议：

```nginx
    location / {                               
        proxy_pass https://portainer.puppylpg.top;             
    }   
```

## v2ray
```bash
docker run -d --name v2ray \
-v /etc/v2ray:/etc/v2ray \
--env VIRTUAL_HOST=puppylpg.top \
--env VIRTUAL_PORT=10087 \
--env LETSENCRYPT_HOST=puppylpg.top \
--env VIRTUAL_PATH=/v2ray \
--restart=always \
v2fly/v2fly-core:v4.23.4 v2ray -config=/etc/v2ray/docker.config.json
```

v2ray也比较特殊，没有使用单独的子域名，**直接挂在主域名下，通过location定位**。nginx-proxy[支持location](https://github.com/nginx-proxy/nginx-proxy#path-based-routing)，使用`VIRTUAL_PATH`即可。

> 监听端口配置在`/etc/v2ray/docker.config.json`中，为10087。
>

[nginx支持websocket等一众](https://nginx.org/en/docs/http/websocket.html)`Upgrade`[协议](https://nginx.org/en/docs/http/websocket.html)：**由于**`Upgrade`** header是hop-by-hop而非end-to-end，nginx反向代理在收到websocket协议之后，要手动再设置一遍**`Upgrade $http_upgrade`**和**`Connection "upgrade"`**两个header，发送给其后的server**。一般这样设置：

```nginx
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }
    
    server {
        ...
        
        location /chat/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

`$http_upgrade`**指的是**`Upgrade`**header的值**，定义在`$http_<name>`里。

`map`**指令相当于switch case**：如果`Upgrade`值为空（即`Upgrade`header不存在），设置`$connection_upgrade`的值为`close`，否则设置为`upgrade`。因此，对于websocket协议，nginx会自动设置上`Upgrade $http_upgrade`（此时是`Upgrade websocket`）和`Connection upgrade`两个header，交给被代理的服务。

> `Upgrade`是一种[protocol switch mechanism](https://datatracker.ietf.org/doc/html/rfc2616#section-14.42)：
>
> The HTTP 1.1 (only) Upgrade header can be used to upgrade an already established client/server connection to a different protocol (over the same transport protocol). For example, it can be used by a client to upgrade a connection from HTTP 1.1 to HTTP 2.0, or an HTTP or HTTPS connection into a WebSocket.
>
> 不止可以用于将http1.1升级为websocket。但是仅能用于http1.1，http2明确禁用该header。
>

nginx-proxy[在2014年就已经支持websocket了](https://github.com/nginx-proxy/nginx-proxy/pull/46)。

之前实体机nginx v2ray自己配过websocket，设置的只要`Upgrade: websocket`的流量，其他协议一概返回404：

```nginx
location ~ /v2ray {
    
    if ($http_upgrade != "websocket") { # WebSocket协商失败时返回404
        return 404;
    }
    
    proxy_redirect off;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    ...
}
```

由nginx-proxy生成的配置：

```nginx
# puppylpg.top/v2ray
upstream puppylpg.top-e4ef5e7590321020fdf18aca8812df0c6d8539ac {
    # Container: v2ray
    #     networks:
    #         bridge (reachable)
    #     IP address: 172.17.0.7
    #     exposed ports: (none)
    #     default port: 80
    #     using port: 10087
    server 172.17.0.7:10087;
}
server {
    server_name puppylpg.top;
    access_log /var/log/nginx/access.log vhost;
    listen 80 ;
    include /etc/nginx/vhost.d/default;
    location /v2ray {
        proxy_pass http://puppylpg.top-e4ef5e7590321020fdf18aca8812df0c6d8539ac;
    }
    location / {
        return 404;
    }
}
server {
    server_name puppylpg.top;
    listen 443 ssl http2 ;
    access_log /var/log/nginx/access.log vhost;
    return 500;
    ssl_certificate /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;
}

# configuration file /etc/nginx/vhost.d/default:
## Start of configuration add by letsencrypt container
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;
    auth_request off;
    allow all;
    root /usr/share/nginx/html;
    try_files $uri =404;
    break;
}
```

可以看到，除了location用的是`/v2ray`，协议用的是http，其他和portainer的配置并没有什么区别。新加的那两个websocket的header哪去了？`Upgrade`**相关信息并没有单独配置在**`server`**里，而是配置在了**`http`**里、**`server`**外**。相当于websocket相关的header是`http`下所有`server`的全局配置。

> 因此该nginx代理其他server时，**如果收到websocket，也会发给后端服务**。只不过其他后端服务可能不支持websocket，把它当做普通的http处理了。
>

## memos
> memo是不是memory？
>

```bash
docker run --detach --name memos \
--restart=always \
-v memos_data:/var/opt/memos \
--env VIRTUAL_HOST=memos.puppylpg.top \
--env VIRTUAL_PORT=5230 \
--env LETSENCRYPT_HOST=memos.puppylpg.top \
neosmemo/memos:stable
```

为了上传大照片，记得修改nginx的`client_max_body_size`属性。

## DailyTxT
可以使用docker命令：

```bash
docker run \
-e "PORT=80" \
-e "SECRET_KEY=<secret key>" \
-e "ALLOW_REGISTRATION=False" \
--env VIRTUAL_HOST=memory.puppylpg.top \
--env LETSENCRYPT_HOST=memory.puppylpg.top \
-v daily-txt-dc:/app/data \
--restart=always \
--name dailytxt -d phitux/dailytxt:1.0.13
```

也可以使用docker compose（使用compose起单个服务，hhh）：

```yaml
dailytxt:
  image: phitux/dailytxt:1.0.13
  container_name: dailytxt
  restart: always
  environment:
    # That's the internal container-port. You can actually use any portnumber (must match with the one at 'ports')
    - PORT=80

    - SECRET_KEY=<secret key>

    # Set it to False or remove the line completely to disallow registration of new users.
    - ALLOW_REGISTRATION=False

    # Use this if you want the json log file to be indented. Makes it easier to compare the files. Otherwise just remove this line! 
    - DATA_INDENT=2

    # Set after how many days the JWT token will expire and you have to re-login. Defaults to 30 days if line is ommited.
    - JWT_EXP_DAYS=60

    # nginx
    - VIRTUAL_HOST=memory.puppylpg.top
    - LETSENCRYPT_HOST=memory.puppylpg.top
  # ports:
    # - "127.0.0.1:9999:8765"
    # perhaps you only want:
    # "<host_port>:8765"
  volumes:
    - "daily-txt-dc:/app/data/"
```

这个服务通过`PORT`环境变量指定服务端口，我们直接使用80，就可以不设置nginx-proxy的`VIRTUAL_PORT`参数了（不存在`EXPOSE`的情况下，它的默认值也是80）。

生成的配置和之前都一样，所以只贴upstream了：

```nginx
# memory.puppylpg.top/
upstream memory.puppylpg.top {
    # Container: dailytxt
    #     networks:
    #         bridge (reachable)
    #     IP address: 172.17.0.3
    #     exposed ports: (none)
    #     default port: 80
    #     using port: 80
    server 172.17.0.3:80;
}
```

## netdata
```bash
docker run -d --name=netdata \
-v netdataconfig:/etc/netdata \
-v netdatalib:/var/lib/netdata \
-v netdatacache:/var/cache/netdata \
-v /etc/passwd:/host/etc/passwd:ro \
-v /etc/group:/host/etc/group:ro \
-v /proc:/host/proc:ro \
-v /sys:/host/sys:ro \
-v /etc/os-release:/host/etc/os-release:ro \
--env VIRTUAL_HOST=netdata.puppylpg.top \
--env VIRTUAL_PORT=19999 \
--env LETSENCRYPT_HOST=netdata.puppylpg.top \
--restart unless-stopped \
--cap-add SYS_PTRACE \
--security-opt apparmor=unconfined \
netdata/netdata:latest
```

netdata默认的port是`19999`.

之前的netdata使用basic auth进行权限控制。nginx-proxy[支持basic auth](https://github.com/nginx-proxy/nginx-proxy#basic-authentication-support)，以后有需要再配置吧，这次不配了。

生成的配置：

```nginx
# netdata.puppylpg.top/
upstream netdata.puppylpg.top {
    # Container: netdata
    #     networks:
    #         bridge (reachable)
    #     IP address: 172.17.0.4
    #     exposed ports: 19999/tcp
    #     default port: 19999
    #     using port: 19999
    server 172.17.0.4:19999;
}
```

如果使用docker compose 3：

```yaml
version: '3'
services:
  netdata:
    image: netdata/netdata
    container_name: netdata
    environment:
      - VIRTUAL_HOST=netdata.puppylpg.top
      - VIRTUAL_PORT=19999
      - LETSENCRYPT_HOST=netdata.puppylpg.top
    hostname: puppylpg's vps docker # set to fqdn of host
    # ports:
      # - 19999:19999
    restart: unless-stopped
    cap_add:
      - SYS_PTRACE
    security_opt:
      - apparmor:unconfined
    volumes:
      - netdataconfig:/etc/netdata
      - netdatalib:/var/lib/netdata
      - netdatacache:/var/cache/netdata
      - /etc/passwd:/host/etc/passwd:ro
      - /etc/group:/host/etc/group:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/os-release:/host/etc/os-release:ro

volumes:
  netdataconfig:
  netdatalib:
  netdatacache:
```

**默认会生成netdata_network，如果不把nginx-proxy attach到这个network上，会无法访问到netdata容器！**

## chatgpt
```bash
docker run -d \
    --name chatgpt
    --restart=always \
    -e OPENAI_API_KEY="xxx" \
    -e CODE="puppylpg" \
    --env VIRTUAL_HOST=bibi.puppylpg.top \
    --env LETSENCRYPT_HOST=bibi.puppylpg.top \
    yidadaa/chatgpt-next-web
```

## jupyter notebook
给jupyter notebook加个密钥：

```bash
docker run --detach --name jupyter-base-notebook \
    --restart=always \
    -e JUPYTER_TOKEN=p***u \
    --env VIRTUAL_HOST=jupyter.puppylpg.top \
    --env LETSENCRYPT_HOST=jupyter.puppylpg.top \
    jupyter/base-notebook
```

启动后，可以在jupyter内置的ternimal里，使用conda创建环境，安装依赖。**然后**[手动把这个环境添加到jupyter的kernel里](https://ipython.readthedocs.io/en/stable/install/kernel_install.html#kernels-for-different-environments)：

```bash
(base) jovyan@79097436643e:~$ conda deactivate
jovyan@79097436643e:~$ python -m ipykernel install --user --name=test
Installed kernelspec test in /home/jovyan/.local/share/jupyter/kernels/test
```

之后就可以使用该环境打开notebook了！

> ipykernel这么重要。
>

# docker compose
启动/停止：

```bash
docker-compose up -d
docker-compose down
```

也可以使用portainer来维护docker compose，直接在上面启动stack即可。



用docker compose起的服务和直接起container区别不大。但是有一点需要注意：**如果compose启动的service绑定到了自己的network上，而非默认的bridge，那么nginx-proxy无法访问到他们，无法为他们生成反向代理！**

> **因为nginx-proxy默认只绑定了bridge网络。**
>

**由于不在一个网络上，二者的网络是unreachable**，所以反向代理的ip是none usable，没有可用的服务器：

```nginx
# download.puppylpg.top/
upstream download.puppylpg.top {
    # Container: youtube-dl-ytdl_material-1
    # networks:
    # youtube-dl_default (unreachable)
    # IP address: (none usable)
    # exposed ports: 17442/tcp
    # default port: 17442
    # using port: 8998
    # Fallback entry
    server 127.0.0.1 down;
}
```

> By default, if you don't pass the `--net` flag when your nginx-proxy container is created, it will only be attached to the default `bridge` network. This means that it will not be able to connect to containers on networks other than `bridge`.
>

[所以必须把nginx-proxy也绑定到这个network上](https://github.com/nginx-proxy/nginx-proxy#multiple-networks)！**使用**`docker network connect`（假设该网络是`youtube-dl_default`）：

```bash
docker network connect youtube-dl_default nginx-proxy
```

此时nginx-proxy同时挂载到两个网络上（**相当于有两个网卡，分属于不同网段**）：

| Network | IP Address | Gateway | MAC Address |
| --- | --- | --- | --- |
| bridge | 172.17.0.4 | 172.17.0.1 | 02:42:ac:11:00:04 |
| youtube-dl_default | 192.168.96.4 | 192.168.96.1 | 02:42:c0:a8:60:04 |


而youtube-dl_default上除了原有的两个container，也多了一个nginx-proxy：

| Container Name | IPv4 Address | IPv6 Address | MacAddress |
| --- | --- | --- | --- |
| youtube-dl-ytdl_material-1 | 192.168.96.3/20 | - | 02:42:c0:a8:60:03 |
| mongo-db | 192.168.96.2/20 | - | 02:42:c0:a8:60:02 |
| nginx-proxy | 192.168.96.4/20 | - | 02:42:c0:a8:60:04 |


bridge上也有nginx-proxy：

| Container Name | IPv4 Address | IPv6 Address | MacAddress |
| --- | --- | --- | --- |
| v2ray | 172.17.0.3/16 | - | 02:42:ac:11:00:03 |
| nginx-proxy-acme | 172.17.0.7/16 | - | 02:42:ac:11:00:07 |
| netdata | 172.17.0.5/16 | - | 02:42:ac:11:00:05 |
| dailytxt | 172.17.0.6/16 | - | 02:42:ac:11:00:06 |
| portainer | 172.17.0.2/16 | - | 02:42:ac:11:00:02 |
| nginx-proxy | 172.17.0.4/16 | - | 02:42:ac:11:00:04 |


> 从network里也可以看到每个container在该网段上的ip是不一样的，**而反向代理的upstream使用的就是每个container在该网段的ip，所以多个反向代理的**`VIRTUAL_HOST`**可以都一样，冲突不了**。
>

nginx-proxy可以通过ip 192.168.96.4/20和youtube-dl-ytdl_material-1的ip 192.168.96.3/20互通。

所以就能正常进行反向代理了：

```nginx
# download.puppylpg.top/
upstream download.puppylpg.top {
    # Container: youtube-dl-ytdl_material-1
    # networks:
    # youtube-dl_default (reachable)
    # IP address: 192.168.96.3
    # exposed ports: 17442/tcp
    # default port: 17442
    # using port: 17442
    server 192.168.96.3:17442;
}
```

> portainer用处很大。事实证明，一个好的ui胜过千言万语，查问题时了然于胸。
>

## YoutubeDL-Material
该工程的docker compose挂载了太多local directory，且为相对路径（相对于docker-compose的working directory。如果使用portainer，相对路径是`/data/compose`）。**mount current directory**[一般用于开发环境](https://docs.docker.com/compose/gettingstarted/#step-5-edit-the-compose-file-to-add-a-bind-mount)**，像python这种不需要编译的，改代码后根本不需要重新部署服务即可生效**。

> bind mount参考[Docker - storage](  
{% post_url 2023-03-20-docker-storage %})
>

因此考虑改成volume：

```yaml
version: "3"
services:
    ytdl_material:
        environment: 
            ALLOW_CONFIG_MUTATIONS: 'true'
            ytdl_mongodb_connection_string: 'mongodb://ytdl-mongo-db:27017'
            ytdl_use_local_db: 'false'
            write_ytdl_config: 'true'
            VIRTUAL_HOST: download.puppylpg.top
            LETSENCRYPT_HOST: download.puppylpg.top
        restart: always
        depends_on:
            - ytdl-mongo-db
        volumes:
            - appdata:/app/appdata
            - audio:/app/audio
            - video:/app/video
            - subscriptions:/app/subscriptions
            - users:/app/users
        #ports:
        #    - "127.0.0.1:8998:17442"
        image: tzahi12345/youtubedl-material:latest
    ytdl-mongo-db:
        image: mongo
        #ports:
        #    - "27017:27017"
        logging:
            driver: "none"          
        container_name: mongo-db
        restart: always
        volumes:
            - db:/data/db
            - configdb:/data/configdb
volumes:
    appdata:
    audio:
    video:
    subscriptions:
    users:
    db:
    configdb:
```

**从docker-compose 3开始，volume和service的默认前缀是项目名称**。在portainer里是docker-composec创建时的stack名称。

> mongo-db这个service通过`container_name`设置了别名，所以不会再加上该前缀。
>

`/data/configdb`是`mongo`[ image](https://stackoverflow.com/questions/56855283/what-is-data-configdb-path-used-for-in-mongodb)所使用到的另一个volume：

```json
        "Volumes": {
            "/data/configdb": {},
            "/data/db": {}
        },
```

如果不在compose里创建具名volume，则会生成匿名volume，每次重启新建一个，比较烦。所以也加到上述compose里了。

生成的nginx配置：

```nginx
# download.puppylpg.top/
upstream download.puppylpg.top {
    # Container: youtube-dl-ytdl_material-1
    #     networks:
    #         youtube-dl_default (reachable)
    #     IP address: 172.18.0.3
    #     exposed ports: 17442/tcp
    #     default port: 17442
    #     using port: 17442
    server 172.18.0.3:17442;
}
server {
    server_name download.puppylpg.top;
    listen 80 ;
    access_log /var/log/nginx/access.log vhost;
    # Do not HTTPS redirect Let's Encrypt ACME challenge
    location ^~ /.well-known/acme-challenge/ {
        auth_basic off;
        auth_request off;
        allow all;
        root /usr/share/nginx/html;
        try_files $uri =404;
        break;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}
server {
    server_name download.puppylpg.top;
    access_log /var/log/nginx/access.log vhost;
    listen 443 ssl http2 ;
    ssl_session_timeout 5m;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    ssl_certificate /etc/nginx/certs/download.puppylpg.top.crt;
    ssl_certificate_key /etc/nginx/certs/download.puppylpg.top.key;
    ssl_dhparam /etc/nginx/certs/download.puppylpg.top.dhparam.pem;
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/nginx/certs/download.puppylpg.top.chain.pem;
    set $sts_header "";
    if ($https) {
        set $sts_header "max-age=31536000";
    }
    add_header Strict-Transport-Security $sts_header always;
    include /etc/nginx/vhost.d/default;
    location / {
        proxy_pass http://download.puppylpg.top;
    }
}
```

# 高阶用法
## 多host
nginx-proxy还可以让一个container支持多个host，传入逗号分割的`VIRTUAL_HOST`即可：

```bash
docker run -d --name=netdata \
-v netdataconfig:/etc/netdata \
-v netdatalib:/var/lib/netdata \
-v netdatacache:/var/cache/netdata \
-v /etc/passwd:/host/etc/passwd:ro \
-v /etc/group:/host/etc/group:ro \
-v /proc:/host/proc:ro \
-v /sys:/host/sys:ro \
-v /etc/os-release:/host/etc/os-release:ro \
--env VIRTUAL_HOST=netdata.puppylpg.top,netdata.puppylpg.xyz \
--env VIRTUAL_PORT=19999 \
--env LETSENCRYPT_HOST=netdata.puppylpg.top,netdata.puppylpg.xyz \
--restart unless-stopped \
--cap-add SYS_PTRACE \
--security-opt apparmor=unconfined \
netdata/netdata:latest
```

原理也很简单，就是配置多个upstream，只不过upstream里的server其实是同一个：

```nginx
# netdata.puppylpg.top/
upstream netdata.puppylpg.top {
    # Container: netdata
    #     networks:
    #         bridge (reachable)
    #     IP address: 172.17.0.4
    #     exposed ports: 19999/tcp
    #     default port: 19999
    #     using port: 19999
    server 172.17.0.4:19999;
}
server {
    server_name netdata.puppylpg.top;
    access_log /var/log/nginx/access.log vhost;
    listen 80 ;
    include /etc/nginx/vhost.d/default;
    location / {
        proxy_pass http://netdata.puppylpg.top;
    }
}
server {
    server_name netdata.puppylpg.top;
    listen 443 ssl http2 ;
    access_log /var/log/nginx/access.log vhost;
    return 500;
    ssl_certificate /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;
}
# netdata.puppylpg.xyz/
upstream netdata.puppylpg.xyz {
    # Container: netdata
    #     networks:
    #         bridge (reachable)
    #     IP address: 172.17.0.4
    #     exposed ports: 19999/tcp
    #     default port: 19999
    #     using port: 19999
    server 172.17.0.4:19999;
}
server {
    server_name netdata.puppylpg.xyz;
    access_log /var/log/nginx/access.log vhost;
    listen 80 ;
    include /etc/nginx/vhost.d/default;
    location / {
        proxy_pass http://netdata.puppylpg.xyz;
    }
}
server {
    server_name netdata.puppylpg.xyz;
    listen 443 ssl http2 ;
    access_log /var/log/nginx/access.log vhost;
    return 500;
    ssl_certificate /etc/nginx/certs/default.crt;
    ssl_certificate_key /etc/nginx/certs/default.key;
}
```

## static resource
nginx-proxy支持的是为container生成反向代理，不支持对static resource的反向代理。比如为puppylpg.top生成static resource的反向代理。

可以[把static resource打包到一个nginx里，作为容器启动，然后使用nginx-proxy为这个nginx生成反向代理](https://github.com/nginx-proxy/nginx-proxy/issues/270#issuecomment-360000868)。这么搞确实很符合nginx-proxy的画风，但是为statis resource多起一个nginx container，流量也要多走一道nginx，多少显得有点儿小题大做了。

还有一种方案：

1. 在上述v2ray的container里，host为`puppylpg.top`，因为只配置了`location /v2ray`，所以默认配置的`location /`为404；
2. 给v2ray[配置](https://github.com/nginx-proxy/nginx-proxy#default_root)`DEFAULT_ROOT=none`[以禁用](https://github.com/nginx-proxy/nginx-proxy#default_root)`puppylpg.top`[的](https://github.com/nginx-proxy/nginx-proxy#default_root)`location /`；
3. 然后在`/etc/nginx/vhost.d/puppylpg.top`或者`/etc/nginx/vhost.d/default`配置`location /`的行为；
4. 最后把他们挂载到container里，比如`-v /path/to/vhost.d:/etc/nginx/vhost.d:ro`；

nginx-proxy生成的反向代理里，默认都引入了一句`include /etc/nginx/vhost.d/default;`，所以该default会被加入`server`配置。它的内容为：

```nginx
## Start of configuration add by letsencrypt container
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;
    auth_request off;
    allow all;
    root /usr/share/nginx/html;
    try_files $uri =404;
    break;
}
## End of configuration add by letsencrypt containe
```

是在配置acme challenge相关的location。如果发现有`/etc/nginx/vhost.d/<VIRTUAL_HOST>`文件，应该就include该文件，而非default了。

> 但是总体来说，代理static resource还是不太合适。
>

### 比较方便的方式
不过我还是找到了一种比较方便的部署静态资源的方式。



假设使用npm生成静态网站，结构如下：

```shell
photo_slideshow_package_beautiful_timeline ➤ tree -L 1 dist
dist
├── assets
├── index.html
└── vite.svg
```

可以直接把文件挂载到一个nginx容器上，使用新的子域名即可（毕竟主域名被v2ray占了，而且已经开放出去也好再改了）。



假设dist文件夹的位置在`~/dist`：

```shell
docker run -d --name ttq \
  -v /home/pichu/dist:/usr/share/nginx/html \
  -e VIRTUAL_HOST=ttq.puppylpg.top \
  -e LETSENCRYPT_HOST=ttq.puppylpg.top \
  --restart=always \
  nginx:alpine
```

之后就可以通过`ttq.puppylpg.top`访问了。

## 统一部署
使用docker compose把所有的服务和nginx-proxy都放在一起

# 更多原理
nginx-proxy和acme-companion算是把nginx和docker玩明白了！**好好看看这两个项目，大有裨益！**

acme-companion提供了[不少文档](https://github.com/nginx-proxy/acme-companion/tree/main/docs)，有助于更进一步了解nginx-proxy和acme-companion。

# 感想
这个世界，越强越轻松。

