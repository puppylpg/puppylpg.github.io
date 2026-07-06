---
layout: post
title: "Windows 传电影到树莓派只有 2MB/s：从硬件到芯片的完整排查实录"
date: 2026-06-04 22:00:00 +0800
categories: [life, windows, raspberry-pi, network]
tags: [wifi, smb, sftp, rtl8832au, network-diagnosis, raspberry-pi, windows, tcp, iperf]
description: "完整记录从树莓派硬件排查、网络链路分析、纯 TCP 隔离测试到公网测速交叉验证，最终锁定 Realtek RTL8832AU WiFi 网卡上传缺陷的全过程"
math: true
mermaid: true
---

## 一、问题背景

用户反映：Windows 电脑向树莓派传输电影时，无论使用 SMB 还是 SFTP，速度都只有约 **2 MB/s**。要求排查根本原因。

1. Table of Contents, ordered
{:toc}

## 二、排查思路总览

排查遵循"从硬件到软件、从底层到上层"的原则：

1. 采集树莓派硬件信息（CPU、内存、存储、网卡）
2. 排除存储瓶颈
3. 测试实际传输速度（上传 vs 下载）
4. 分析网络接口状态
5. 采集 Windows 端信息
6. 纯 TCP 隔离测试（排除协议层干扰）
7. 公网测速交叉验证
8. 优化尝试与效果验证
9. 锁定根因并给出方案

---

## 三、Step 1：树莓派硬件信息采集

**输入**：SSH 登录树莓派，执行诊断脚本

```bash
uname -a
cat /proc/cpuinfo | grep -i 'model name\|hardware\|revision' | head -5
free -h
df -h
ip -s link
```

**输出**：

```
Linux raspberrypi 6.12.20+rpt-rpi-2712 #1 SMP PREEMPT Debian 1:6.12.20-1+rpt1~bpo12+1 (2025-03-19) aarch64 GNU/Linux

CPU revision    : 1
CPU revision    : 1
CPU revision    : 1
CPU revision    : 1
Revision        : d04170

Mem: 7.9Gi total, 1.1Gi used, load average: 0.13

/dev/nvme0n1p2  235G  195G   28G  88% /

3: end0: mtu 1500
    RX: bytes 121034015924 packets 120640845 errors 0 dropped 3376275 missed 0 mcast 7400714
    TX: bytes 97941240864 packets 23906901 errors 0 dropped 230 carrier 0 collsns 0
```

**关键发现**：
- 树莓派 **5（8GB 版）**，性能强劲
- 网卡 `end0` 是千兆有线
- ⚠️ **RX dropped: 3,376,275**（接收端大量丢包）
- 存储为 **NVMe SSD（长城 GW3300 256GB）**

---

## 四、Step 2：网络链路排查

**输入**：

```bash
ethtool end0
ping -n 3 192.168.1.7
```

**输出**：

```
Speed: 1000Mb/s
Duplex: Full
Link detected: yes

Reply from 192.168.1.7: bytes=32 time=2ms TTL=64
Reply from 192.168.1.7: bytes=32 time=2ms TTL=64
Reply from 192.168.1.7: bytes=32 time=2ms TTL=64
```

**结论**：树莓派端网络协商正常，延迟仅 2ms，物理链路无问题。

---

## 五、Step 3：存储性能排查

**输入**：测试目标目录 `/share` 的写入速度

```bash
dd if=/dev/zero of=/share/dd_test bs=1M count=256 oflag=direct
```

**输出**：

```
268435456 bytes (268 MB, 256 MiB) copied, 0.724443 s, 371 MB/s
```

**结论**：NVMe SSD 写入 **371 MB/s**，存储完全不是瓶颈。

---

## 六、Step 4：实际传输速度测试（上传 vs 下载）

### 4.1 下载测试（树莓派 → Windows）

**输入**：

```bash
# 在树莓派上生成 1GB 测试文件
dd if=/dev/urandom of=/home/pi/test_1gb.bin bs=1M count=1024

# Windows 端下载
scp pi@192.168.1.7:/home/pi/test_1gb.bin .
```

**输出**：

```
real    0m20.457s
```

**速度**：1024 MB / 20.457s = **50 MB/s** ✅

### 4.2 上传测试（Windows → 树莓派）

**输入**：

```bash
# Windows 端生成 100MB 文件并上传
dd if=/dev/urandom of=test_upload_local.bin bs=1M count=100
scp test_upload_local.bin pi@192.168.1.7:/home/pi/
```

**输出**：

```
real    0m21.252s
```

**速度**：100 MB / 21.252s = **4.7 MB/s** ❌

### 4.3 关键发现

| 方向 | 速度 | 结论 |
|------|------|------|
| 下载 | 50 MB/s | 正常 |
| 上传 | 4.7 MB/s | **慢 10 倍** |

**问题锁定在"上传方向"**。

---

## 七、Step 5：网络接口深度分析

### 5.1 网卡统计

**输入**：

```bash
ip -s link show end0
```

**输出**：

```
RX: bytes 121034015924 packets 120640845 errors 0 dropped 3376275 missed 0 mcast 7400714
TX: bytes 97941240864 packets 23906901 errors 0 dropped 230 carrier 0 collsns 0
```

### 5.2 分析

RX dropped 高达 **3,376,275** 个包，丢包率约 2.8%。初步怀疑树莓派接收缓冲区不足。

---

## 八、Step 6：Windows 端信息采集

### 6.1 网卡信息

**输入**：

```powershell
Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select Name, InterfaceDescription, LinkSpeed
```

**输出**：

```
Name  InterfaceDescription                        LinkSpeed
----  --------------------                        ---------
WLAN  Realtek 8832AU Wireless LAN WiFi 6 USB NIC 1.2 Gbps
```

### 6.2 WiFi 详情

**输入**：

```powershell
netsh wlan show interfaces
```

**输出**：

```
名称                   : WLAN
物理地址               : d4:84:09:3b:fc:62
状态                   : 已连接
SSID                   : CMCC-bonjour
BSSID                  : 12:9f:47:c2:3a:ab
网络类型               : 结构
无线标准               : 802.11ax
身份验证               : WPA2 - 个人
密码                   : CCMP
信道                   : 44
接收速率(Mbps)         : 1201
传输速率 (Mbps)        : 1201
信号                   : 76%
配置文件               : CMCC-bonjour
```

### 6.3 关键发现

- Windows **没有有线网卡**，只有 WiFi
- WiFi 芯片：**Realtek 8832AU**
- 协商速率：1201 Mbps（5GHz，WiFi 6）
- 信号强度：76%

---

## 九、Step 7：纯 TCP 隔离测试

为了排除 SMB/SCP/SFTP 等协议层的干扰，编写纯 TCP 程序进行裸测。

### 9.1 测试设计

- **Server**（树莓派）：接收数据并丢弃，不做任何处理
- **Client**（Windows）：发送 300MB 数据，计算实际吞吐

### 9.2 代码

**tcp_server.py**（树莓派端）：

```python
import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 5202))
s.listen(1)
conn, addr = s.accept()
start = time.time()
total = 0
while True:
    data = conn.recv(1048576)
    if not data:
        break
    total += len(data)
elapsed = time.time() - start
print(f"Received {total/(1024*1024):.1f} MB in {elapsed:.1f}s")
conn.close()
```

**tcp_client.py**（Windows 端）：

```python
import socket, time

HOST = '192.168.1.7'
PORT = 5202
DATA = b'0' * 1048576

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect((HOST, PORT))
start = time.time()
total_sent = 0
target = 300 * 1048576

while total_sent < target:
    sent = s.send(DATA)
    total_sent += sent

elapsed = time.time() - start
speed = total_sent / (1024*1024) / elapsed
print(f"Sent {total_sent/(1024*1024):.1f} MB in {elapsed:.1f}s = {speed:.1f} MB/s")
s.close()
```

### 9.3 测试结果

**输出**：

```
Sent 300.0 MB in 64.3s = 4.7 MB/s
```

### 9.4 结论

- 纯 TCP（零协议开销、零加密、零磁盘 I/O）上传也只有 **4.7 MB/s**
- 与 scp 的 **4.7 MB/s**、SMB 感知的 **2 MB/s** 处于同一水平
- **100% 证明：瓶颈不在应用层，而在网络/链路层**

---

## 十、Step 8：公网测速交叉验证

用户提供了腾讯电脑管家的公网测速截图：

| 指标 | 数值 |
|------|------|
| 下载速度 | **59.8 MB/s** |
| 上传速度 | **4.9 MB/s** |
| 运营商 | 中国移动 |
| 宽带等级 | 300~500M |

### 交叉对比

| 场景 | 上传速度 |
|------|---------|
| 局域网 → 树莓派（scp） | 4.7 MB/s |
| 局域网 → 树莓派（纯 TCP） | 4.7 MB/s |
| 公网测速（电脑管家） | 4.9 MB/s |

**三者几乎完全一致。**

### 关键推理

- 如果是**运营商限制上行带宽**，只应影响公网，不影响局域网
- 但**局域网内也跑不出更高的速度**
- 唯一的解释：**Windows WiFi 网卡的发送端天花板就是约 40 Mbps（5 MB/s）**
- 无论往哪传（公网还是局域网），都被这个硬件天花板锁死

---

## 十一、Step 9：树莓派端优化尝试

虽然证据已指向 Windows 端，但仍对树莓派进行了全面优化，以彻底排除接收端瓶颈。

### 9.1 优化前状态

```
RX ring buffer: 512
TX ring buffer: 512
```

### 9.2 执行的优化

```bash
# 1. 扩大网卡 ring buffer
sudo ethtool -G end0 rx 4096 tx 4096

# 2. 优化内核网络参数
sudo bash -c 'cat >> /etc/sysctl.conf << "EOF"
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.core.netdev_max_backlog = 65536
EOF'
sudo sysctl -p

# 3. 优化 Samba 配置
# 在 /etc/samba/smb.conf [global] 段添加：
#   socket options = TCP_NODELAY IPTOS_LOWDELAY SO_RCVBUF=131072 SO_SNDBUF=131072
#   min protocol = SMB2
#   max protocol = SMB3
#   read raw = yes
#   write raw = yes
#   use sendfile = yes

sudo systemctl restart smbd
```

### 9.3 优化后状态

```
RX ring buffer: 4096
TX ring buffer: 4096
SMB protocol: SMB3
socket options: TCP_NODELAY IPTOS_LOWDELAY SO_RCVBUF=131072 SO_SNDBUF=131072
```

### 9.4 优化后复测

```bash
scp test_upload_local.bin pi@192.168.1.7:/home/pi/
```

**输出**：

```
real    0m21.733s
```

**速度**：100 MB / 21.733s = **4.6 MB/s**

### 9.5 结论

**零改善。** 树莓派端已被彻底排除。

---

## 十二、Step 10：芯片溯源与社区验证

### 10.1 硬件对应关系

| 用户看到的 | 实际芯片 |
|-----------|---------|
| 品牌：水星 MERCURY | 芯片：Realtek RTL8832AU |
| 型号：UX18H AX1800 | 芯片方案：AX1800（2.4G 574M + 5G 1201M）|

### 10.2 社区反馈

NGA 论坛用户反馈同款芯片：

> *"5g 链接 1201Mbs，用电信宽带测速，还没原来 intel 自带 8265 无线网卡速度快，只能跑 30 不到的。装了三个版本驱动都一样。"*

B站评测结论：

> *"MT7921AU 这张卡从硬件到发热再到性能都稳赢对位的瑞昱 RTL8832 系列。想要稳定的无线网络，首先远离瑞昱网卡。厂商喜欢用它是因为它便宜，而不是因为它好用。"*

---

## 十三、最终结论

### 根因锁定

| 排查项 | 状态 | 说明 |
|--------|------|------|
| 树莓派 CPU | ❌ 排除 | Pi 5，负载 0.13 |
| 树莓派存储 | ❌ 排除 | NVMe SSD，371 MB/s |
| 树莓派网卡 | ❌ 排除 | 千兆全双工，已优化到最大 |
| 树莓派系统配置 | ❌ 排除 | 优化前后速度不变 |
| 协议层 | ❌ 排除 | 裸 TCP 与 scp/SMB 速度一致 |
| 运营商限速 | ❌ 排除 | 局域网不应受公网带宽影响 |
| **Windows WiFi 网卡** | ✅ **锁定** | 上传天花板约 40 Mbps |

### 定量分析

- WiFi 协商速率：1201 Mbps
- 实际上传吞吐：37.6 Mbps（4.7 MB/s）
- **实际 / 协商 = 3.1%**（严重不达标）

### 问题定性

**Realtek RTL8832AU 芯片方案的 USB WiFi 6 网卡存在严重的发送端性能缺陷。** 这不是水星一家的问题，而是该芯片方案的通病。

---

## 十四、解决方案

### 方案一：PCIe AX210（最佳）

| 产品 | 价格 | 特点 |
|------|------|------|
| COMFAST CF-AX210 | ~90-110 元 | 带磁吸延长天线，可吸机箱顶 |
| 奋威 Fenvi AX210 | ~110-150 元 | 做工更好，散热佳 |
| SSU AX210 | ~80-120 元 | 性价比最高 |

- 上传速度：**30-50 MB/s**
- 需要主板有空闲 PCIe 插槽

### 方案二：USB MT7921AU（次选）

| 产品 | 价格 | 特点 |
|------|------|------|
| COMFAST CF-952AX | ~100 元 | AX1800，外置天线 |
| EDUP EP-AX1672 | ~80-100 元 | 发热控制好 |

- 上传速度：**10-15 MB/s**
- 适合只有 USB 口可用的场景

### 方案三：USB 转千兆网线（最便宜）

| 产品 | 价格 | 特点 |
|------|------|------|
| USB3.0 转千兆网卡 | ~30-50 元 | 插网线，速度拉满 110 MB/s |

---

## 十五、总结

一个看似简单的"传电影慢"问题，经过从硬件到软件、从底层到上层的逐层排查，最终锁定为 **Windows 端 Realtek RTL8832AU WiFi 网卡的发送端性能缺陷**。

**核心排查逻辑**：

```
用户反馈慢
    ↓
测试发现：下载 50 MB/s，上传 4.7 MB/s（极度不对称）
    ↓
纯 TCP 裸测：上传仍 4.7 MB/s（排除协议层）
    ↓
树莓派全面优化：上传仍 4.6 MB/s（排除接收端）
    ↓
公网测速：上传 4.9 MB/s（与局域网一致，排除网络环境）
    ↓
锁定 Windows WiFi 网卡：协商 1201 Mbps，实际仅 37.6 Mbps
    ↓
芯片溯源：RTL8832AU，社区证实存在上传性能缺陷
```

**建议**：更换为 Intel AX210（PCIe）或 MediaTek MT7921AU（USB）方案的网卡。

---

## 十六、后续：AX210 的反转——离远了还不如"老网卡"？

上一篇排查的结论是 **RTL8832AU 存在严重的发送端性能缺陷**，建议更换 Intel AX210。我照做了，买了块 PCIe 的 AX210，满怀期待地装上测试——结果剧情反转了。

### 16.1 近处测试：AX210 确实强

刚装好 AX210，在离路由器比较近的位置测试，速度比之前的 RTL8832AU 快很多。无论是局域网往树莓派传文件，还是公网测速，上传速度都有明显提升。看来芯片本身确实没问题，钱没白花。

### 16.2 放回原位：尴尬了

高兴完，把主机搬回原来的位置——角落里，离 WiFi 远了之后，情况急转直下。

再测传输速度，**表现甚至还不如之前那块被喷得狗血淋头的 RTL8832AU**。

### 16.3 有点儿错怪它了

这就有点尴尬了。之前把锅全扣在 RTL8832AU 头上，现在同样的位置，AX210 反而更差。这说明问题不只是"芯片烂不烂"这么简单。

### 16.4 可能的原因

虽然没再像之前那样逐层抓包做精确对比，但可以推测几个关键因素：

**1. 天线差异**

之前的 USB 网卡虽然是廉价方案，但配的是外置可旋转天线，物理尺寸和增益可能并不差。而买的这块 AX210 是 PCIe 转接卡，原装天线是短小的胶棒天线，信号捕捉能力可能反而更弱。WiFi 这玩意儿，天线占一半功劳。

**2. 信号衰减下的芯片策略差异**

不同芯片在信号弱时的处理策略不一样：
- 有的芯片信号差了还能"硬撑"，协商速率掉得不那么狠，实际吞吐还能维持
- 有的芯片在信号好时效率极高，但一旦信号衰减，协商速率和实际效率一起崩盘

AX210 很可能属于后者——近距离是王者，远距离反而不如那些"耐衰减"的老方案。

**3. 位置变量被忽略**

之前的排查全程只在主机原来的位置（角落里）测试，没有控制"距离/障碍物"这个变量。如果当初把机箱搬到路由器旁边再测一遍老网卡，可能早就发现信号强度才是最大的影响因素。

### 16.5 修正后的结论

RTL8832AU 确实有它的毛病——在信号好的情况下效率极低，协商 1201 Mbps 却只能跑几十 Mbps，这一点没得洗。

但它在弱信号环境下的"耐衰减"表现，可能比我之前以为的要好。或者说，**我之前遇到的慢，不全是芯片的锅，信号衰减也占了很大一部分原因。**

### 16.6 现在的思路

既然 AX210 近距离强、远距离弱，而主机又必须放在角落里，那单纯换网卡已经解决不了根本问题了。

接下来的方向大概是：
- **换高增益天线**：给 AX210 配个外置长天线，看能不能把信号拉回来
- **调整位置**：把天线引出来放到桌面上，避开金属机箱的遮挡
- **最务实的方案**：干脆买根长网线，或者加一个 Mesh 子路由放到房间角落里

无线网络的瓶颈，有时候真不在"芯片型号"这一个维度上。
