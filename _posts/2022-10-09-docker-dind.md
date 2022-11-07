---
layout: post
title: "Docker - dind"
date: 2022-10-09 23:54:39 +0800
categories: docker gitlab
tags: docker gitlab
---

使用docker in docker在容器内构建docker镜像。主要是为了集成到gitlab ci里。

1. Table of Contents, ordered
{:toc}

# dind
docker容器内部是可以再启动一个docker daemon，但并不像想象中的那么美好。主要是无法做到完全的隔离。

## `--privileged`
`docker run`有一个很重要的参数[`--privileged`](https://docs.docker.com/engine/reference/commandline/run/#full-container-capabilities---privileged)。

如果不开启，用不了类似mount之类的命令：
```
$ docker run -t -i --rm ubuntu bash
root@xxxxx:/# mount -t tmpfs none /mnt
mount: /mnt: permission denied.
```
**by default, most potentially dangerous kernel capabilities are dropped**; including `cap_sys_admin` (which is required to mount filesystems)

> `mount -t type device dir`

**但是如果启动的时候使用了这个参数，就可以啥都干。比如挂载一个tmpfs类型的文件系统，实际上位于虚拟内存。系统里的文件都会放在RAM里**：`sudo mount -t tmpfs -o size=10M tmpfs /mnt/mytmpfs`
```
# df -Th
Filesystem     Type      Size  Used Avail Use% Mounted on
...
tmpfs          tmpfs      10M  4.0K   10M   1% /mnt/mytmpfs
```

> In other words, the container can then do almost everything that the host can do

## 好处
dind可以在docker镜像里使用docker了。

## 弊端
dind有很多弊端，比如：外层的docker容器用的是正常的文件系统，容器内部实际用的是一个copy on write文件系统(AUFS, BTRFS, Device Mapper, etc., depending on what the outer Docker is setup to use)，但是这个内部的文件系统并不一定能在外部的文件系统上正常工作，比如内层是AUFS的时候，外层不能是AUFS。除此之外，还有很多其他的问题。
- https://jpetazzo.github.io/2015/09/03/do-not-use-docker-in-docker-for-ci/

总之，dind使用起来并不能完全像正常的独立docker一样。

# dood: expose docker socket to container
**但实际上，大部分情况下大家需要的并不是一个完全正常的内部docker，可能只是想在docker内部使用docker指令build一个docker镜像，仅此而已**。

如果这样的话，**直接把host的docker socket暴露给container就行了，container内部调用docker的时候，实际命令发给了host的docker daemon**，进行docker操作是完全没问题的：
1. docker daemon就是服务器，接收host的docker client命令和容器里的docker client命令对它来说没有区别。只要能访问到它就行；
2. **创建的镜像/volume、启动的容器等，都和直接在host上创建一样。也就是说，这些新创建的东西都是dind容器的sibling，而不是child。和dind容器是同级别的，因为都是host创建的**；

> Let’s take a step back here. Do you really want Docker-in-Docker? Or do you just want to be able to run Docker (specifically: build, run, sometimes push containers and images) from your CI system, while this CI system itself is in a container?
>
> I’m going to bet that most people want the latter. All you want is a solution so that your CI system like Jenkins can start containers.

这样的话，**仿佛用的是dind，效果和dind也一样，但实际用的是docker out of docker，简称DooD**。但大家一般也称之为dind了，可以理解为它是一种表面上的dind（实际是dood）。

> This looks like Docker-in-Docker, feels like Docker-in-Docker, but it’s not Docker-in-Docker: when this container will create more containers, those containers will be created in the top-level Docker. You will not experience nesting side effects, and the build cache will be shared across multiple invocations.

## docker:latest
**不管用dind还是dood，容器内是必须要有docker cli的。**

dind的镜像是[docker:latest](https://hub.docker.com/_/docker)，**其实就是一个带docker binary的镜像（总得有个docker client能给docker daemon发请求吧）**，别的没啥特殊的。
```
C:\Users\puppylpg>docker run -v /var/run/docker.sock:/var/run/docker.sock -ti docker
Unable to find image 'docker:latest' locally
latest: Pulling from library/docker
213ec9aee27d: Pull complete
7b0dd730a5c3: Pull complete
4b90f8029a36: Pull complete
b2204c289e68: Pull complete
a75dcb107a37: Pull complete
3a173a06c313: Pull complete
44f3a1cb7a3f: Pull complete
a7d2f4b1d0b5: Pull complete
cd2ccc3f5575: Pull complete
Digest: sha256:b2343859b009730168704bf04dd705291539db39df5ccf840a91b647b72009fe
Status: Downloaded newer image for docker:latest
/ # which docker
/usr/local/bin/docker
/ # docker -v
Docker version 20.10.18, build b40c2f6
```

早前，甚至都不需要用这个景象，直接把host上的docker binary绑定到容器里就行了。**但是后来docker engine不再是静态的了，所以只能在容器里装docker cli了**：
1. 要么直接用带docker cli的镜像，比如官方的`docker:latest`；
2. 要么自己在image里装docker，比如用apt安装docker。但是图啥呢，何不直接用官方带docker cli的镜像……

> Former versions of this post advised to bind-mount the docker binary from the host to the container. This is not reliable anymore, because the Docker Engine is no longer distributed as (almost) static libraries.

## dind/dood的示例
- docker容器中跑docker服务：https://www.zhihu.com/question/435886465/answer/1666067989

# Ref
非常好的介绍了docker in docker的弊端：
- https://jpetazzo.github.io/2015/09/03/do-not-use-docker-in-docker-for-ci/
- https://hub.docker.com/_/docker
- https://github.com/jpetazzo/dind

# gitlab dind
gitlab的dind提供了上述dind和dood，**想使用dind，必须使用[docker gitlab runner](https://docs.gitlab.com/runner/executors/docker.html)，不能使用物理机的runner**：
- https://docs.gitlab.com/ee/ci/docker/using_docker_build.html

> **runner必须本身是个docker镜像，且含有docker cli**。

## dind
**纯正的dind必须在容器内部启动一个docker daemon，首先配置docker gitlab runner的时候就要开启[`privileged=true`](https://docs.gitlab.com/ee/ci/docker/using_docker_build.html#docker-in-docker-with-tls-enabled-in-the-docker-executor)**，这样才能启动dind：
```
[[runners]]
  url = "https://gitlab.com/"
  token = TOKEN
  executor = "docker"
  [runners.docker]
    tls_verify = false
    image = "docker:20.10.16"
    privileged = true
    disable_cache = false
    volumes = ["/certs/client", "/cache"]
  [runners.cache]
    [runners.cache.s3]
    [runners.cache.gcs]
```

> 当然配置runner并不属于开发的范畴，咱也就大致了解一下。

**其次，必须在容器内部启动docker daemon，所以这里必须用gitlab service启动一个docker daemon**：
```
image: docker:20.10.16

variables:
  # When you use the dind service, you must instruct Docker to talk with
  # the daemon started inside of the service. The daemon is available
  # with a network connection instead of the default
  # /var/run/docker.sock socket. Docker 19.03 does this automatically
  # by setting the DOCKER_HOST in
  # https://github.com/docker-library/docker/blob/d45051476babc297257df490d22cbd806f1b11e4/19.03/docker-entrypoint.sh#L23-L29
  #
  # The 'docker' hostname is the alias of the service container as described at
  # https://docs.gitlab.com/ee/ci/services/#accessing-the-services.
  #
  # Specify to Docker where to create the certificates. Docker
  # creates them automatically on boot, and creates
  # `/certs/client` to share between the service and job
  # container, thanks to volume mount from config.toml
  DOCKER_TLS_CERTDIR: "/certs"

services:
  - docker:20.10.16-dind

before_script:
  - docker info

build:
  stage: build
  script:
    - docker build -t my-docker-image .
    - docker run my-docker-image /script/to/run/tests
```

当然，gitlab也提醒了纯正dind的限制，跟上面介绍的差不多：
- limitations of dind: https://docs.gitlab.com/ee/ci/docker/using_docker_build.html#limitations-of-docker-in-docker

## docker socket binding
也可以使用dood，通过[docker socket binding](https://docs.gitlab.com/ee/ci/docker/using_docker_build.html#use-docker-socket-binding)实现。此时，**docker gitlab runner不需要配置privileged，但是必须用volumes绑定docker socket**：
```
[[runners]]
  url = "https://gitlab.com/"
  token = RUNNER_TOKEN
  executor = "docker"
  [runners.docker]
    tls_verify = false
    image = "docker:20.10.16"
    privileged = false
    disable_cache = false
    volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/cache"]
  [runners.cache]
    Insecure = false
```

**绑定之后，就不用在容器里再启动一个docker service了，再试图起一个docker daemon反而会冲突**：
> If you bind the Docker socket and you are using GitLab Runner 11.11 or later, you can no longer use docker:20.10.16-dind as a service. **Volume bindings are done to the services as well, making these incompatible**.

[docker socket绑定也有它的弊端](https://docs.gitlab.com/ee/ci/docker/using_docker_build.html#limitations-of-docker-socket-binding)：
1. **不安全**。把docker daemon共享到了容器里，相当于没有安全措施了，`docker rm -f $(docker ps -a -q)`直接把gitlab runner的所有container删掉了；
2. **同样因为共享docker daemon，并发job可能失败**，因为container如果指定了名称，可能会造成冲突；

## 实体机docker指令
gitlab runner想使用docker，并非只能在dind跑。如果实体机上起的有docker，那么把gitlab-runner用户加入docker组之后，实体机的gitlab runner也能调用实体机上的docker daemon了。当然，这不涉及到dind：
- https://docs.gitlab.com/ee/ci/docker/using_docker_build.html#use-the-shell-executor

## gitlab-ci使用dind示例
这是一个gitlab-ci使用dind的例子，用的是真正的dind：
```
image: harbor-registry.inner.yd.com/devops/docker:19.03-ydci

services:
  - name: harbor-registry.inner.yd.com/devops/docker:19.03-dind
    alias: docker

stages:
  - test
  - pom-version
  - package
  - build-push-image
  - deploy
  - notify

unit_test:
  image: harbor-registry.inner.yd.com/ead/xxx-base:latest
  stage: test
  tags:
    - k8s
  script:
    - mvn clean test
    - if [ -e target/site/jacoco/index.html ]; then cat target/site/jacoco/index.html; fi
  coverage: '/Total.*?([0-9]{1,3})%/'

build-image:
  stage: build-push-image
  tags:
    - k8s
  variables:
    IMAGE_NAME: $IMAGE_NAME
  script:
    - !reference [.build_push_image, script]
  except:
    - master
  when: manual
  dependencies:
    - fetch-version
    - package
```

> 之所以不使用dood，大概是dood太危险了吧，而且如前所述，会冲突。

- services：**启动一个docker daemon，用于接收docker cli发出的请求**。这是真正的dind；
- image：**image也使用docker镜像，因为image里需要有docker cli，才能使用docker命令**；

**接下来的unit_test，用不到docker命令，但是需要用到maven，所以换了一个有maven的镜像，取代默认的`docker:19.03-ydci`镜像。**

> **如果unit_test用到了testcontainers，也是可以的，它不需要container里有docker cli（testcontainers自己肯定内嵌了类似docker cli的client）**，只需要container里有docker daemon。而我们已经在镜像里起了docker daemon service，满足testcontainers的使用要求。

**在build-image这一步，打包docker镜像，需要用到docker cli给docker daemon发请求了，所以使用默认的`docker:19.03-ydci`镜像。**

# 感想
开发docker的人，才是真正的深入理解linux啊~

> 我太菜了o(╥﹏╥)o

