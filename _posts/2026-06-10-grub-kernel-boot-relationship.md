---
title: "GRUB、内核与 /boot 的启动关系"
date: 2026-06-10 03:55:01 +0800
categories: [linux]
tags: [linux, grub, kernel, boot, debian, apt]
description: "通过一台 Debian 机器的 /dev/sda 分区布局，梳理 GRUB 如何加载内核、initrd 如何辅助挂载根分区，以及 APT 内核包与 /boot 文件之间的关系。"
---

1. Table of Contents, ordered
{:toc}

# 背景与目标

这次对话围绕一个很具体的问题展开：在一台 Debian 机器上，GRUB、Linux 内核、`/boot`、根分区 `/` 之间到底是什么关系。

机器的实际分区很适合作例子：

```text
/dev/sda
├─/dev/sda1  ext3  UUID=08d8246c...  挂载到 /boot
└─/dev/sda2  ext3  UUID=2277e8c4...  挂载到 /
```

也就是说，`/dev/sda1` 是单独的 `/boot` 分区，`/dev/sda2` 才是 Linux 真正运行起来之后的根分区。

# 主要步骤

## 步骤一：先看完整启动流程

先不要急着看某一行配置，先把整体链路串起来。启动过程大致分成两个阶段：前半段由 GRUB 负责找到内核和 initrd，后半段由 Linux 内核接管，挂载真正的根分区并启动系统。

在这台机器上，GRUB 先从 `/dev/sda1` 读取 `/boot` 里的启动文件；内核启动后，再把 `/dev/sda2` 挂载成 Linux 系统真正的 `/`。

```mermaid
flowchart TD
    firmware["BIOS / 固件"] --> grub["GRUB 启动"]
    grub --> bootRoot["GRUB root = hd0,msdos1<br/>对应 /dev/sda1"]
    bootRoot --> kernelFile["读取 /vmlinuz-6.1.0-49-amd64"]
    bootRoot --> initrdFile["读取 /initrd.img-6.1.0-49-amd64"]
    kernelFile --> linux["Linux 内核接管"]
    initrdFile --> linux
    linux --> rootfs["挂载 root=UUID=2277e8c4...<br/>对应 /dev/sda2 为 /"]
    rootfs --> remountBoot["系统启动后挂载 /dev/sda1 到 /boot"]

    style firmware fill:#eceff1,stroke:#607d8b,stroke-width:1px
    style grub fill:#fff3e0,stroke:#fb8c00,stroke-width:2px
    style bootRoot fill:#fff9c4,stroke:#fbc02d,stroke-width:2px
    style kernelFile fill:#e3f2fd,stroke:#1e88e5,stroke-width:2px
    style initrdFile fill:#e8f5e9,stroke:#43a047,stroke-width:2px
    style linux fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style rootfs fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px
    style remountBoot fill:#fff9c4,stroke:#fbc02d,stroke-width:2px
```

这个流程里有两个关键点：

1. GRUB 的任务是加载内核文件 `vmlinuz` 和初始内存根文件系统 `initrd.img`。
2. Linux 内核启动后，才会根据 `root=UUID=...` 找到真正的根分区 `/dev/sda2`。

## 步骤二：从 grub.cfg 看路径差异

这台机器的 GRUB 配置在：

```text
/boot/grub/grub.cfg
```

默认启动项里的关键行是：

```grub
set root='hd0,msdos1'

linux /vmlinuz-6.1.0-49-amd64 root=UUID=2277e8c4-09d7-4c4d-bd96-237e417ff3be ro net.ifnames=0 biosdevname=0 consoleblank=0 consoleblank=0

initrd /initrd.img-6.1.0-49-amd64
```

最值得注意的是这里写的是：

```grub
linux /vmlinuz-6.1.0-49-amd64
initrd /initrd.img-6.1.0-49-amd64
```

而不是：

```grub
linux /boot/vmlinuz-6.1.0-49-amd64
initrd /boot/initrd.img-6.1.0-49-amd64
```

原因在于：`set root='hd0,msdos1'` 已经告诉 GRUB，把 `/dev/sda1` 当作它自己的根目录。对 GRUB 来说，`/dev/sda1` 的顶层就是 `/`，所以内核文件路径自然是：

```text
/vmlinuz-6.1.0-49-amd64
/initrd.img-6.1.0-49-amd64
```

等 Linux 系统启动完成后，情况才变成：

```text
/dev/sda2  挂载为 /
/dev/sda1  挂载为 /boot
```

这时同样的文件，在 Linux 里看到的路径才是：

```text
/boot/vmlinuz-6.1.0-49-amd64
/boot/initrd.img-6.1.0-49-amd64
```

所以这里并不是 `/boot` 和 `/` 互相嵌套，而是 GRUB 阶段和 Linux 阶段对同一块分区使用了不同的路径视角。

这里有两个“root”：

| 配置 | 谁使用 | 含义 |
| --- | --- | --- |
| `set root='hd0,msdos1'` | GRUB | 从 `/dev/sda1` 读取内核、initrd、GRUB 文件 |
| `root=UUID=2277e8c4...` | Linux 内核 | 启动后把 `/dev/sda2` 挂载成真正的 `/` |

`vmlinuz-6.1.0-49-amd64` 是真正的 Linux 内核文件；`initrd.img-6.1.0-49-amd64` 不是内核，而是初始内存根文件系统。它负责在早期启动阶段提供驱动、模块和脚本，帮助内核找到并挂载真正的根分区。

## 步骤三：理解为什么系统启动后还要挂载 /boot

从“本次启动已经完成”的角度看，`/boot` 确实大多数时间没用。内核已经加载进内存，GRUB 已经退场。

但系统仍然通常会把 `/dev/sda1` 挂载到 `/boot`，原因是后续维护需要它：

1. 安装或升级内核时，包管理器要写入新的 `vmlinuz-*`、`initrd.img-*`、`System.map-*`、`config-*`。
2. 执行 `update-grub` 或 `grub-mkconfig` 时，要更新 `/boot/grub/grub.cfg`。
3. 保证系统运行时维护的 `/boot`，就是 GRUB 下次启动时真正读取的那块分区。

如果 `/boot` 没挂载，内核包可能把新文件写进根分区 `/dev/sda2` 里的空 `/boot` 目录，而不是写进 `/dev/sda1`。这样 Linux 系统里看着文件有了，GRUB 下次启动却读不到。

## 步骤四：理解 grub.cfg 是生成结果

`/boot/grub/grub.cfg` 不是推荐手写维护的静态文件，而是由系统生成出来的 GRUB 脚本。

它的来源大致是：

```mermaid
flowchart LR
    defaultCfg["/etc/default/grub<br/>用户级默认配置"] --> mkconfig["update-grub / grub-mkconfig"]
    scripts["/etc/grub.d/*<br/>菜单生成脚本"] --> mkconfig
    bootFiles["/boot/vmlinuz-*<br/>/boot/initrd.img-*"] --> mkconfig
    mkconfig --> grubCfg["/boot/grub/grub.cfg<br/>最终启动脚本"]
    grubCfg --> grubBoot["下次开机由 GRUB 读取"]

    style defaultCfg fill:#e3f2fd,stroke:#1e88e5,stroke-width:2px
    style scripts fill:#e8f5e9,stroke:#43a047,stroke-width:2px
    style bootFiles fill:#fff9c4,stroke:#fbc02d,stroke-width:2px
    style mkconfig fill:#fff3e0,stroke:#fb8c00,stroke-width:2px
    style grubCfg fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px
    style grubBoot fill:#eceff1,stroke:#607d8b,stroke-width:1px
```

安装、升级、删除内核时，Debian 通常会触发 `update-grub`，扫描 `/boot` 里的内核和 initrd，然后重新生成启动菜单。开机时选择某个菜单项，一般不会反过来改写 `grub.cfg`。

## 步骤五：多个内核如何变成多个启动项

如果系统里安装了多个内核，`/boot` 里会有多组文件：

```text
/boot/vmlinuz-6.1.0-47-amd64
/boot/initrd.img-6.1.0-47-amd64
/boot/vmlinuz-6.1.0-48-amd64
/boot/initrd.img-6.1.0-48-amd64
/boot/vmlinuz-6.1.0-49-amd64
/boot/initrd.img-6.1.0-49-amd64
```

`update-grub` 会把它们生成多个菜单项。启动时，GRUB 读取配置，用户选择一个菜单项，GRUB 就加载对应版本的内核和 initrd。

```mermaid
flowchart TD
    install["APT 安装多个 linux-image 包"] --> files["/boot 出现多组 vmlinuz / initrd"]
    files --> update["触发 update-grub"]
    update --> menu["grub.cfg 生成多个 menuentry"]
    menu --> boot["开机显示 GRUB 菜单"]
    boot --> choose{"选择哪个内核？"}
    choose --> k49["Linux 6.1.0-49<br/>vmlinuz + initrd"]
    choose --> k48["Linux 6.1.0-48<br/>vmlinuz + initrd"]
    choose --> recovery["Recovery mode<br/>带 single 等参数"]
    k49 --> run["对应内核接管启动"]
    k48 --> run
    recovery --> run

    style install fill:#e3f2fd,stroke:#1e88e5,stroke-width:2px
    style files fill:#fff9c4,stroke:#fbc02d,stroke-width:2px
    style update fill:#fff3e0,stroke:#fb8c00,stroke-width:2px
    style menu fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px
    style boot fill:#eceff1,stroke:#607d8b,stroke-width:1px
    style choose fill:#ffffff,stroke:#455a64,stroke-width:2px
    style k49 fill:#e8f5e9,stroke:#43a047,stroke-width:2px
    style k48 fill:#e8f5e9,stroke:#43a047,stroke-width:2px
    style recovery fill:#ffebee,stroke:#e53935,stroke-width:2px
    style run fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

# 核心结论

GRUB 和 Linux 内核的关系可以概括成一句话：**GRUB 负责把内核加载起来，内核负责真正启动系统。**

在这台机器上：

| 对象 | 实际位置 | 作用 |
| --- | --- | --- |
| GRUB 配置 | `/boot/grub/grub.cfg` | 告诉 GRUB 有哪些启动项 |
| 内核文件 | `/boot/vmlinuz-6.1.0-49-amd64` | 真正接管启动的 Linux 内核 |
| initrd | `/boot/initrd.img-6.1.0-49-amd64` | 早期启动用的临时小系统 |
| `/boot` 分区 | `/dev/sda1` | 存放 GRUB、内核、initrd |
| 根分区 `/` | `/dev/sda2` | Linux 启动完成后真正的系统根目录 |

APT 包名和实际文件名也不是一回事。`linux-image-6.1.0-49-amd64` 是内核镜像包，安装出来的启动文件叫 `/boot/vmlinuz-6.1.0-49-amd64`；`linux-headers-6.1.0-49-amd64` 则主要用于编译外部内核模块，不是启动用的内核本体。

# 参考

本文基于本机命令输出整理，关键命令包括：

```bash
lsblk -f /dev/sda
findmnt -no SOURCE,TARGET,FSTYPE / /boot /boot/efi
grep -nE "menuentry|linux|initrd|set root|search --no-floppy" /boot/grub/grub.cfg
ls -lh /boot
```
