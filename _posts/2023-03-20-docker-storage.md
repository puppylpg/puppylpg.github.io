---
layout: post
title: "Docker - storage"
date: 2023-03-20 22:40:45 +0800
categories: docker
tags: docker
---

docker的持久化存储。

1. Table of Contents, ordered
{:toc}

# docker中的数据管理

docker支持[三种类型的mount](https://docs.docker.com/storage/)：
- volume：docker自己管理的volume；
- bind mount：直接mount宿主机上的文件/夹；
- tmpfs：mount到宿主机的ram里；

volume和bind mount最终对应的都是host上的directory。唯一的区别是volume可以使用docker cli管理，bind mount不行。

需要注意的是：**volume并不和`--volume`对应，bind mount也不和`--mount`对应。`--volume`和`--mount`是对等的，既可以绑定volume也可以直接绑定本地文件夹。只不过`--volume`是short syntax，`--mount`是long syntax。所以docker官方推荐后者。**

> We recommend using the --mount flag for both containers and services, for bind mounts, volumes, or tmpfs mounts, as the syntax is more clear.

无论用哪种mount方式，**以docker容器的视角来看都是一样的**，都只是一个存储数据的位置：

> No matter which type of mount you choose to use, **the data looks the same from within the container**. It is exposed as either a directory or an individual file in the container’s filesystem.

# volume
[volume](https://docs.docker.com/storage/volumes/)是官方推荐的持久化数据的方式，因为可以使用docker命令进行管理。

> When you need to back up, restore, or migrate data from one Docker host to another, volumes are a better choice.

**volume实际也是对应实体机上的文件夹，一般在`/var/lib/docker/volumes/`下，可以使用`docker inspect`查看**：
```
debian:app (master*) $ docker volume create todo-db
todo-db
debian:app (master*) $ docker volume inspect todo-db 
[
    {
        "CreatedAt": "2021-09-28T16:12:40+08:00",
        "Driver": "local",
        "Labels": {},
        "Mountpoint": "/var/lib/docker/volumes/todo-db/_data",
        "Name": "todo-db",
        "Options": {},
        "Scope": "local"
    }
]
```

## 挂载volume
用`--volume`和`--mount`都可以。

`--volume`：**冒号分隔的三部分**
- 第一部分：如果写了，就是named volume的名字，**如果不写，就是匿名volume**；
- 第二部分：容器内路径；
- 第三部分：可选，逗号分割的权限。比如`ro`，代表read only；

比如：`-v myvol2:/app`。

`--mount`：**逗号分割的多个键值对**，所以描述的更具体一些，但写起来也更麻烦一些
- `type`：volume/bind/tmpfs等，这一部分只介绍volume
- `source`/`src`：named volume的名字，如果是匿名volume可以省略；
- `destination`/`dst`/`target`：容器内路径；
- `readonly`/`ro`

比如：`--mount source=myvol2,target=/app,readonly`

如果volume不存在，会自动创建。
> You can create a volume explicitly using the docker volume create command, or Docker can create a volume during container or service creation.

## mount到非空文件夹：填充volume
如果容器挂载一个空volume，且容器内被挂载的路径上本身有内容（文件或文件夹），[相关内容会被populate到这个volume](https://docs.docker.com/storage/volumes/#populate-a-volume-using-a-container)。如果别的容器也挂载该volume，就会看到同样的内容。

## 备份volume
[备份volume](https://docs.docker.com/storage/volumes/#back-up-restore-or-migrate-data-volumes)是很有用的技巧！

> Volumes are useful for backups, restores, and migrations. Use the `--volumes-from` flag to create a new container that mounts that volume.

> 在[Docker - 容器化nginx]({% post_url 2023-03-13-dockerize-nginx %})里，acme-companion就用到了`--volumes-from`挂载和nginx-proxy相同的volume。

假设某个container挂载了一个匿名volume到/dbdata：
```
docker run -v /dbdata --name dbstore ubuntu /bin/bash
```
我们使用一个新容器挂载该匿名volume（使用`--volumes-from`），同时bind mount一个本地文件夹到容器，就可以将该container作为中转站，把匿名volume的内容copy到本地文件夹：
```
docker run --rm --volumes-from dbstore -v $(pwd):/backup ubuntu tar cvf /backup/backup.tar /dbdata
```
同理，可以把备份内容恢复到另一个volume里：
```
docker run -v /dbdata2 --name dbstore2 ubuntu /bin/bash

docker run --rm --volumes-from dbstore2 -v $(pwd):/backup ubuntu bash -c "cd /dbdata2 && tar xvf /backup/backup.tar --strip 1"
```

# bind mount
[bind mount](https://docs.docker.com/storage/bind-mounts/)**主要是[为了直接把host machine的本地文件暴露给container](https://docs.docker.com/storage/#good-use-cases-for-bind-mounts)**。但是不能使用docker管理bind mount，所以如果没有特殊理由就用volume。

> You can’t use Docker CLI commands to directly manage bind mounts.

虽然docker文档说，如果文件/夹不存在，会自动在host上创建，但这仅限于使用`--volume`，使用`--mount`不行。
> The file or directory does not need to exist on the Docker host already. It is created on demand if it does not yet exist.

> 在[Docker - 容器化nginx]({% post_url 2023-03-13-dockerize-nginx %})里，YoutubeDL-Material挂载host上当前文件夹（docker-compose文件所在的文件夹）下的audio/video等目录到容器，因为默认不存在，所以会自己创建。

## 挂载指令
和挂载volume一样，bind mount时用`--volume`和`--mount`也都可以。

**在bind mount的场景下**，这两个命令有一个[唯一区别](https://docs.docker.com/storage/bind-mounts/#differences-between--v-and---mount-behavior)：**当bind mount的文件/文件夹在host不存在时，`--volume`会创建一个文件夹/文件，`--mount`会报错。**

> If you use `-v` or `--volume` to bind-mount a file or directory that does not yet exist on the Docker host, `-v` creates the endpoint for you. It is always created as a directory.
>
> If you use `--mount` to bind-mount a file or directory that does not yet exist on the Docker host, Docker does not automatically create it for you, but generates an error.

`--volume`：冒号分隔的三部分
- 第一部分：**（和挂载volume不同）bind mount这里必须有值**，代表host的文件路径；
- 第二部分、第三部分：和挂载volume相同

比如：`-v "$(pwd)"/target:/app`。

`--mount`：逗号分割的多个键值对，所以描述的更具体一些，但写起来也更麻烦一些
- `type`：volume/bind/tmpfs等，**这一部分只介绍bind**
- `source`/`src`：**同--volume第一部分，必须是一个host的路径**
- `destination`/`dst`/`target`
- `readonly`/`ro`

比如：`--mount type=bind,source="$(pwd)"/target,target=/app,readonly`。

## mount到非空文件夹：obscure
这个行为和bind volume大不相同：如果bind本地文件夹到容器内一个非空的文件夹，**会使用bind mount的内容[屏蔽掉容器内文件夹的内容](https://docs.docker.com/storage/bind-mounts/#mount-into-a-non-empty-directory-on-the-container)**，所以叫obscure。这个功能和linux默认的mount很像，可以屏蔽掉之前mount的内容，很不错！

> **This can be beneficial, such as when you want to test a new version of your application without building a new image.**

# tmpfs
不写在持久层，而是写在宿主机的内存里。container关停的时候，[tmpfs mount](https://docs.docker.com/storage/tmpfs/)就会被删掉。**一般用来存储既不想写入host，也不想写入container的敏感信息；或者为了性能，需要些一大堆不需要持久化的信息，此时写到ram里肯定是最快的**。

> tmpfs mounts are best used for cases when you do not want the data to persist either on the host machine or within the container. This may be **for security reasons** or **to protect the performance of the container** when your application needs to write a large volume of non-persistent state data.
>
> It can be used by a container during the lifetime of the container, to store non-persistent state or sensitive information. **For instance, internally, swarm services use tmpfs mounts to mount secrets into a service’s containers.**

# docker compose
- https://docs.docker.com/compose/compose-file/compose-file-v3/#volumes

无论mount volume还是bind mount，在docker compose里用的都是[`volumes`](https://docs.docker.com/compose/compose-file/#volumes)关键字（或者参考[v3的文档](https://docs.docker.com/compose/compose-file/compose-file-v3/#volumes)）。因此volume的语法有short syntax和long syntax：
```
version: "3.9"
services:
  web:
    image: nginx:alpine
    volumes:
      - type: volume
        source: mydata
        target: /data
        volume:
          nocopy: true
      - type: bind
        source: ./static
        target: /opt/app/static

  db:
    image: postgres:latest
    volumes:
      - "/var/run/postgres/postgres.sock:/var/run/postgres/postgres.sock"
      - "dbdata:/var/lib/postgresql/data"

volumes:
  mydata:
  dbdata:
```
如果只绑定到一个service上，没必要定义一个顶级`volumes` key。如果想在多个service之间使用同一个volume，则需要定义。

> You can mount a host path as part of a definition for a single service, and there is no need to define it in the top level volumes key.
>
> But, if you want to reuse a volume across multiple services, then define a named volume in the top-level volumes key.

short syntax写起来和docker的`--mount`/`--volume`的short syntax一样。如果不是路径，那就是volume：
```
volumes:
  # Just specify a path and let the Engine create a volume
  - /var/lib/mysql

  # Specify an absolute path mapping
  - /opt/data:/var/lib/mysql

  # Path on the host, relative to the Compose file
  - ./cache:/tmp/cache

  # User-relative path
  - ~/configs:/etc/configs/:ro

  # Named volume
  - datavolume:/var/lib/mysql
```

**默认创建的volume名字是`[projectname]_[volume name]`，而非volume name。**

如果volume是提前创建好的，可以使用[`external: true`](https://docs.docker.com/compose/compose-file/compose-file-v3/#external)属性。在3.4里被弃用了，使用`name`属性：
```
volumes:
  data:
    external:
      name: actual-name-of-volume
```

# rancher volume
一般来说，使用docker创建volume只能创建在单个宿主机上。在rancher上，可以创建被多个宿主机共享的volume，从而被多个container共享。

