---
title: "一次 Debian 11 升级到 Debian 12 的 VPS 实战记录"
date: 2026-06-10 03:14:36 +0800
categories: [ai]
tags: [debian, vps, docker, system-upgrade, linux, apt, operations]
description: "记录一台运行 Docker 服务的 VPS 从 Debian 11 升级到 Debian 12 的评估、执行、重启验证与风险处理过程。"
---

1. Table of Contents, ordered
{:toc}

# 背景与目标

这次对话的目标，是在一台已经运行多个 Docker 服务的 VPS 上，把系统从 Debian 11 bullseye 升级到 Debian 12 bookworm，同时尽量保证业务容器不受影响。

这台机器资源不大：2 核、1GB 内存、22GB 根分区。上面跑着 `nginx-proxy`、`nginx-proxy-acme`、`memos`、`portainer`、`netdata`、`v2ray`、`dailytxt`、`ttq`、`wedding` 等容器。用户已经在 VPS 管理面板完成整机备份，因此本次操作重点放在升级路径、Docker 风险控制和升级后验证上。

# 主要步骤

## 步骤一：先做系统体检和空间清理

升级前先检查系统版本、磁盘、内存、失败服务和 Docker 占用。初始状态是 Debian 11，根分区使用率约 82%，可用空间只有 3.8GB；swap 已使用 800MB 左右，但实时 `vmstat` 没有频繁 `si/so`，说明没有明显 swap 抖动。

为了给升级留足空间，先清理了几个确定安全的空间占用：

```bash
npm cache clean --force
rm -rf ~/.npm/_npx
rm -rf ~/.cache/ms-playwright ~/.cache/puppeteer
rm -rf /tmp/ruby-build...
docker image prune -af
sudo apt clean
```

清理后根分区从 82% 降到 56%，可用空间从 3.8GB 增加到 9.0GB。这个空间对于 Debian 11 到 12 的升级已经足够。

## 步骤二：处理升级前的明显隐患

体检时发现两个失败服务：

- `networking.service`：`/etc/network/interfaces` 里配置了不存在的 `eth1`
- `snap.certbot.renew.service`：宿主机 certbot 使用 nginx 插件续期，会和 Docker 的 nginx-proxy 抢 80/443

`eth1` 配置被注释，并保留备份。certbot 进一步确认是旧体系残留：宿主机 `/etc/letsencrypt` 下的 `.xyz` 证书已经在 2023 年过期，而当前 Docker 的 `nginx-proxy-acme` 正在维护 `.top` 域名证书。因此停用了 `snap.certbot.renew.timer`，避免它继续失败。

同时确认 `munin-node` 和 Netdata 功能重叠。机器内存只有 1GB，保留 Netdata 即可，`munin-node` 被停用并禁用。

## 步骤三：选择升级到 Debian 12，而不是直接到 13

用户担心升级后 Docker 服务跑不起来。最终选择先从 Debian 11 升到 Debian 12，而不是直接到 Debian 13。

主要原因有三个：

1. Debian 的常规升级路径是逐版本升级，`11 -> 12 -> 13` 比跳版本更稳。
2. 这台机器上 Docker 服务很多，稳定性优先于追最新版本。
3. Debian 12 仍有足够维护窗口，可以先在 12 上观察一段时间。

升级前也检查了当前 apt 源。Docker 实际使用的是 Debian 自带的 `docker.io/containerd`，但机器里还保留了 Docker 官方 bullseye 源。因此切换源时一并把 Docker 源从 bullseye 改成 bookworm，避免升级后源混杂。

## 步骤四：切换 apt 源并分两段升级

先备份 apt 源：

```bash
sudo cp -a /etc/apt/sources.list /etc/apt/sources.list.bak.bullseye-20260610
sudo cp -a /etc/apt/sources.list.d /etc/apt/sources.list.d.bak.bullseye-20260610
```

然后将 Debian 源切换到 bookworm：

```text
deb http://deb.debian.org/debian bookworm main
deb http://deb.debian.org/debian-security bookworm-security main
deb http://deb.debian.org/debian bookworm-updates main
```

Docker 源也切到 bookworm：

```text
deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian bookworm stable
```

升级采用两段式：

```bash
sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
  apt-get -y -o Dpkg::Options::='--force-confdef' \
  -o Dpkg::Options::='--force-confold' \
  upgrade --without-new-pkgs

sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
  apt-get -y -o Acquire::Retries=5 \
  -o Dpkg::Options::='--force-confdef' \
  -o Dpkg::Options::='--force-confold' \
  full-upgrade
```

其中 `--force-confold` 的目的是尽量保留本机已有配置，降低服务配置被包升级覆盖的风险。

升级过程中遇到两次单包下载超时，分别是 `libnet-server-perl` 和 `libzstd1`。处理方式不是改升级策略，而是重试下载，利用 apt 已经缓存的大部分包继续推进。

## 步骤五：重启并验证 Docker 服务

`full-upgrade` 完成后，系统包层面已经是 Debian 12，但仍运行旧内核。新内核安装为：

```text
6.1.0-49-amd64
```

GRUB 成功安装到 `/dev/sda`，随后执行重启。重启后验证结果：

```text
Debian: 12.14 bookworm
Kernel: 6.1.0-49-amd64
Docker Client/Server: 20.10.24+dfsg1
systemctl --failed: 0 failed units
```

Docker 容器全部自动恢复：

```text
wedding
ttq
v2ray-new
memos
nginx-proxy
v2ray
netdata
dailytxt
portainer
nginx-proxy-acme
```

其中 Netdata 初始状态是 `health: starting`，等待一会儿后变为 `healthy`。

# 核心结论

这次升级的关键不是单纯执行 `apt full-upgrade`，而是把风险控制拆成几个层次。

第一，升级前必须先释放空间。根分区从 82% 降到 56% 后，升级过程才有足够余量。否则下载包、解包、新内核和 initramfs 都可能把磁盘顶满。

第二，Docker 服务的风险主要来自系统层组件变化，而不是容器镜像本身。本次升级涉及内核、systemd、iptables/nftables、containerd、docker.io、OpenSSL 等组件，因此重启前后都要检查 Docker 服务端版本和容器状态。

第三，宿主机服务和 Docker 服务要避免职责冲突。宿主机 nginx/certbot 曾试图接管 80/443，而实际流量由 Docker 的 nginx-proxy/acme-companion 处理。升级前把旧 certbot timer 停掉，减少了升级后失败告警和端口冲突。

第四，自动清理不要急着做。升级后 `apt autoremove` 会列出旧库、旧内核和宿主机 nginx 模块。虽然大多可以清理，但刚升级完成时应该先保证业务稳定，观察一两天后再做温和清理。

最终结果是：系统成功升级到 Debian 12.14，运行新内核，Docker 容器全部恢复，apt 状态正常，failed units 为 0。磁盘最终约 65%，swap 只使用约 24MB，`vm.swappiness` 保持在 10。

# 参考

- Debian 源：`bookworm`、`bookworm-security`、`bookworm-updates`
- Docker 包：Debian `docker.io`、`containerd`、`runc`、`docker-compose`
- 关键命令：`apt-get update`、`apt-get upgrade --without-new-pkgs`、`apt-get full-upgrade`、`systemctl --failed`、`docker ps`
- 升级后版本：Debian 12.14、Linux `6.1.0-49-amd64`、Docker `20.10.24+dfsg1`
