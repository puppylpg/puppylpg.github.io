---
layout: post
title: "树莓派 homelab 全景：Jellyfin 家庭影院、Vaultwarden 密码与统一入口的演进"
date: 2026-07-20 13:11:05 +0800
categories: [life, raspberry-pi, docker, homelab]
tags: [docker, raspberry-pi, jellyfin, jellyseerr, vaultwarden, homepage, caddy, mdns, homelab]
description: "在树莓派 homelab 上补装 Jellyfin、Jellyseerr、Vaultwarden、Homepage 四个服务，把自动下载管线闭环成完整的家庭影院；并把入口方案从裸端口、Caddy 子路径一路演进到 Homepage 占根路径的最终形态。"
math: true
mermaid: true
---

1. Table of Contents, ordered
{:toc}

## 1. 背景：下载管线缺了“两头”，入口也乱了

在[之前的文章](/life/2026/06/17/raspberry-pi-docker-radarr-jackett-qbittorrent-bazarr/)里，树莓派上已经有了一条自动化下载管线：Radarr 管电影、Jackett 聚合种子站、qBittorrent 下载、Bazarr 和 ChineseSubFinder 补字幕，后来又修复了[硬链接失效导致的磁盘翻倍问题](/life/2026/06/17/raspberry-pi-docker-radarr-jackett-qbittorrent-bazarr/#10-最大的坑两个-bind-mount-让硬链接悄悄变成复制2026-07-18-补记)。

但用了一段时间会发现，这条管线只解决了“下”的问题，两头都缺，还附带两个管理问题：

- **上游缺“发现”**：想看电影要自己打开 Radarr 搜索、选画质，家里人根本不会用；
- **下游缺“播放”**：片子入库后靠 Samba 共享裸文件播放，没有海报墙、没有进度记录、没有手机客户端；
- **入口混乱**：服务越装越多，七八个 WebUI 端口记不住，每次都要翻备忘录；
- **密码裸奔**：各服务的密码和 API Key 明文写在文档甚至公开博客里。

这次补装的四个服务正好一一对应：Jellyseerr 管“发现”，Jellyfin 管“播放”，Vaultwarden 管“密码”，Homepage 管“入口”。

```mermaid
flowchart LR
    Family[家人] -->|搜片点想看| JS[Jellyseerr 5055]
    JS -->|下发任务| Radarr[Radarr 7878]
    Radarr --> Jackett[Jackett 9117]
    Radarr --> qBT[qBittorrent 8085]
    qBT --> Downloads[(/share/Downloads)]
    Radarr -->|硬链接入库| Movies[(/share/Movies)]
    Movies --> JF[Jellyfin 8096]
    JF -->|海报墙/播放| Family
    HP[Homepage 3001] -.->|统一入口| Family
    VW[Vaultwarden 8443] -.->|密码与 API Key| Family
    style JS fill:#e3f2fd
    style JF fill:#e8f5e9
    style HP fill:#fff3bf
    style VW fill:#fff3bf
```

四个服务均已提交到 [pi-docker-homelab](https://github.com/puppylpg/pi-docker-homelab) 仓库的 compose 里。下面就按这几个缺口的顺序逐个补上——先是“看”和“点”，再是“密码”，最后单用一节讲“入口”的三次演进，那是这次折腾真正想明白的东西。

## 2. Jellyfin：补上“看”的一头

### 2.1 已经有 Kodi + Samba 了，为什么还要 Jellyfin？

先把现状说清楚：在此之前，我的播放链路是 Radarr 下载入库 → 电视上的 Kodi 通过 Samba 直连树莓派 → 选文件播放。这条链路是自洽的——Kodi 自己也能刮削海报墙、记录本机进度。所以如果场景永远只有“一台电视、一个观众”，Jellyfin 的价值确实有限，这话得先说在明处。

[Jellyfin](https://jellyfin.org/) 是开源媒体服务器，它和 Kodi 的本质区别在于**媒体库放在哪**：

- **Kodi + Samba 是“本地媒体库”**：海报墙、刮削数据、观看进度都存在那台电视本地，是它一台的私有财产；
- **Jellyfin 是“服务端媒体库”**：扫描片库、刮削元数据、记录进度全部发生在服务端，所有客户端共享同一份。

这个区别带来几个实际收益：

- **跨设备续播**：电视上看到一半，躺床上用手机、用电脑网页能从同一秒接着看。Kodi 的进度只认识那台电视；
- **多设备零配置**：手机、平板、电脑想看片，浏览器打开就是全部，不用每台设备装 Kodi、配 Samba；
- **多用户互不干扰**：家人各自有账号、各自的进度和列表，儿童账号还能限制内容范围；
- **和 Jellyseerr 闭环**：下一节点播链的终点就是 Jellyfin——家人点完“想看”，片子下好后自动出现在海报墙上，不用再去电视上翻文件夹。

关键是这两者**不冲突，可以合体**：Kodi 有官方插件 [Jellyfin for Kodi](https://jellyfin.org/docs/general/clients/kodi/)，电视继续用 Kodi 的播放器（它的解码能力比 Jellyfin 自家客户端强），但媒体库、海报墙、观看进度全部交给 Jellyfin 服务端统一管理。所以正确的定位是把 Jellyfin 当**后台媒体库**，而不是电视播放器的替代品——电视上的习惯可以一点都不改，白赚多端同步。

### 2.2 部署

选 `linuxserver/jellyfin` 镜像与现有栈保持同一套约定：

```yaml
  jellyfin:
    image: linuxserver/jellyfin:latest
    container_name: jellyfin
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
      # 刮削元数据需要访问 TMDB，走宿主机 V2Ray 代理
      - HTTP_PROXY=http://172.18.0.1:10809
      - HTTPS_PROXY=http://172.18.0.1:10809
      - NO_PROXY=localhost,127.0.0.1,jellyseerr,radarr
    volumes:
      - /home/pi/docker/jellyfin/config:/config
      - /home/pi/docker/jellyfin/cache:/cache
      # 只读挂载片库即可，元数据写在 config 里
      - /share/Movies:/data/movies:ro
    ports:
      - "8096:8096"
    restart: unless-stopped
```

两个要点：

- 片库**只读挂载**（`:ro`），Jellyfin 的元数据、字幕缓存都写在自己的 `config`/`cache` 里，不会污染片库目录；
- 刮削要访问 TMDB，和 Jackett 一样走宿主机 V2Ray 代理，否则海报和简介拉不下来。

首次访问 `http://raspberrypi.local:8096` 创建管理员，添加媒体库时选容器内路径 `/data/movies`。性能上树莓派 1080p 直接播放毫无压力，但不要指望它做 4K 实时转码——客户端支持直接播放才是关键。

## 3. Jellyseerr：补上“点播”的一头

片子能看了，下一个问题是“看什么”从哪来——总不能要求每个家人都学会 Radarr。[Jellyseerr](https://github.com/fallenbagel/jellyseerr) 是面向 Jellyfin 生态的点播门户（Plex 生态对应的叫 Overseerr）。家人打开网页搜电影、点“想看”，请求自动流转到 Radarr 下载、入库、出现在 Jellyfin 里，全程不用知道 Radarr 的存在。

```yaml
  jellyseerr:
    image: fallenbagel/jellyseerr:latest
    container_name: jellyseerr
    environment:
      - TZ=Asia/Shanghai
      # 搜索/海报依赖 TMDB API，走宿主机 V2Ray 代理
      - HTTP_PROXY=http://172.18.0.1:10809
      - HTTPS_PROXY=http://172.18.0.1:10809
      - NO_PROXY=localhost,127.0.0.1,jellyfin,radarr
    volumes:
      - /home/pi/docker/jellyseerr/config:/app/config
    ports:
      - "5055:5055"
    restart: unless-stopped
```

首次访问 `http://raspberrypi.local:5055` 时选 Jellyfin 登录（用 Jellyfin 的管理员账号），然后在设置里关联 Radarr（Host 填 `radarr`，端口 `7878`，API Key 从 Radarr 设置页复制）。同样要注意 TMDB 走代理，否则搜索页一片空白。

## 4. Vaultwarden：密码到底该怎么管

前两个服务解决的是“用”的问题，这一节解决“管”的问题——而且它牵出的东西比预想的多：从部署时的一个报错出发，一路追问到了整套加密模型，最后才弄明白密码到底是怎么被填进各个服务的。

### 4.1 先拆掉一个错误前提

之前的做法是密码明文写在文档里，理由是“反正都是内网，别人看不到；就算看到也登录不了”。这个理由有个事实漏洞：密码不只是写在本地文档里，而是**明文出现在公开发布的博客文章里**，全世界都能搜到。

真正在起保护作用的并不是“别人看不到”，而是**服务只监听内网**——互联网上的陌生人拿到密码也够不着 `192.168.1.7`。但仍然剩下两类真实风险：

- **局域网内部**：访客 WiFi 的设备、中毒的手机，拿着公开密码可以登录全部服务；
- **密码复用习惯**：`pi123456` 这类弱密码如果和其他账号有复用，公开它等于公开别处的钥匙。

### 4.2 部署：十分钟跑起来，然后撞上 HTTPS

[Vaultwarden](https://github.com/dani-garcia/vaultwarden) 是 Bitwarden 的轻量自托管实现（Rust 编写，树莓派上跑得很轻松）。它承诺的改变很诱人：浏览器/手机自动填充、每个服务一个随机强密码、API Key 和 TOTP 也能一并收进来。compose 照例很简单：

```yaml
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: vaultwarden
    environment:
      - TZ=Asia/Shanghai
      # 初次使用先开放注册，建好账号后改为 false 重建容器
      - SIGNUPS_ALLOWED=true
      - HTTP_PROXY=http://172.18.0.1:10809
      - HTTPS_PROXY=http://172.18.0.1:10809
      - NO_PROXY=localhost,127.0.0.1
    volumes:
      # 保险库数据，务必纳入备份
      - /home/pi/docker/vaultwarden/data:/data
    ports:
      - "8001:80"
    restart: unless-stopped
```

但部署完第一次打开就撞上一个硬限制：**Vaultwarden 必须走 HTTPS 访问**。HTTP 直连 `:8001` 会直接报 “You are not using a secure context ... You need to enable HTTPS!”。原因是它的 Web 保险库依赖浏览器的 Web Crypto API（SubtleCrypto）**在本地做加解密**，而浏览器只在安全上下文（HTTPS 或 localhost）里开放这个 API。Vaultwarden 不支持子路径，所以解法是让 Caddy 给它单独开一个 HTTPS 端口反代（Caddy 会自动生成本地证书）：

```caddy
raspberrypi.local:8443 {
    reverse_proxy vaultwarden:80
}
```

浏览器首次访问接受自签证书即可。完整流程：访问 `https://raspberrypi.local:8443` 注册主账号 → 浏览器装 Bitwarden 扩展、自托管服务器地址填同一个 HTTPS 地址 → 把各服务密码逐个换强并入库 → 把 `SIGNUPS_ALLOWED` 改为 `false` 重建容器，关掉公开注册。

先停一下——**为什么一个密码管理器非要“在本地做加解密”不可？** 这个问题值得追到底，因为它的答案就是 Bitwarden 的整个安全模型。

### 4.3 顺着 HTTPS 追问：零知识加密模型

先纠正一个理解偏差：**Vaultwarden 只是服务端**。它是 Bitwarden 服务端协议的 Rust 重实现（官方服务端是 C# 写的，很重量级），而浏览器扩展、手机 App、桌面客户端**全是 Bitwarden 官方客户端**——Vaultwarden 把协议实现得足够兼容，官方客户端连上来感觉不到区别。所以要理解它，理解 Bitwarden 的加密模型即可。

这个模型的出发点是**零知识**：服务器（哪怕是你自己架的这台）永远接触不到明文，也接触不到能解密的主密钥，所有加解密都在客户端本地完成。你打开的 Web 保险库页面本身就是一个加密程序——这正是它强制 Web Crypto API、进而强制 HTTPS 的原因。注册和解锁时，客户端在本地跑一条密钥派生链：

```text
主密码 + 邮箱（作盐）
   │  PBKDF2-SHA256，默认 60 万轮迭代（可选 Argon2id）
   ▼
主密钥（Master Key）            ← 只存在于设备内存，从不传输
   │
   ├─ HKDF 拉伸 ──► 用于加密“保险库密钥”
   │
   └─ 再跑 1 轮 PBKDF2 ──► 主密码哈希 ← 登录时发给服务器的只有它
```

**保险库密钥**是注册时客户端随机生成的一把 AES-256 密钥，每条密码、每个 API Key 都靠它加密；它自己被主密钥加密后才上传服务器。**主密码哈希**只用于登录校验，从它反推不出主密钥。整个生命周期里服务器经手的东西：

```mermaid
sequenceDiagram
    participant C as 客户端
    participant S as Vaultwarden 服务器

    Note over C,S: 注册（仅一次）
    C->>C: 主密码 + 邮箱（盐）经 PBKDF2 派生主密钥
    C->>C: 随机生成保险库密钥，用主密钥加密
    C->>S: 上传邮箱、主密码哈希、加密后的保险库密钥
    Note over S: 只存密文<br>永远见不到主密码和主密钥

    Note over C,S: 日常解锁
    C->>S: 邮箱 + 主密码哈希，请求登录
    S-->>C: 校验通过，返回加密保险库
    C->>C: 本地重新派生主密钥，解出保险库密钥
    C->>C: 逐条解密密码条目，供自动填充
```

所谓“同步”只是密文的上传下载，解密永远发生在你自己的设备上。

### 4.4 服务器不解密，那它到底有什么用？

理解上面的模型后，很容易冒出一个疑问：**服务器既然不参与解密，那它存在的意义是什么？**

答案是**密文的存储 + 多端同步**。当你在手机上想登录 Radarr 时，服务器把加密后的 Radarr 条目返回给手机，手机在本地解出明文——服务器解决的是“手机、电脑、平板随时拿到同一份保险库”，而不是“帮你解密”。注意它**不是备份**：密文保险库只存在 `vaultwarden/data` 这一处（默认 SQLite），它刻意不进 git，也没有“云端另一份”，丢了就是全丢，所以这份目录必须另有备份副本。

从这个模型还能直接推出几条“规矩”：

- **忘了主密码 = 数据永久锁死**：服务器端没有任何恢复手段，这是“零知识”的字面含义。主密码要足够强、且真的记得住，别存在任何文档里；
- **主密码必须强**：就算树莓派被人整个拖库，攻击者拿到的也只有密文，只能离线暴力猜主密码。60 万轮 PBKDF2 是专门拖慢猜测速度的，但 `pi123456` 这种密码多少轮迭代都救不了；
- **每个服务可以放心用随机强密码**：记密码的事被客户端本地解密 + 自动填充彻底接管，人只需要记住主密码一个。纯内网时这是好习惯，一旦哪天把服务通过 VPN 或公网暴露出去，这就是生死线。

### 4.5 最后一个环节：密码是怎么“到” Radarr 的？

还剩最后一跳没说清楚：客户端在本地解出了明文，**它怎么把这个密码交给 Radarr？** 答案可能出乎意料——**密码管理器从来不和目标服务通信**。它做的事到“把明文填进登录表单”为止，之后的一切和你亲手打字完全相同：

```mermaid
sequenceDiagram
    participant BW as Bitwarden 扩展
    participant B as 浏览器
    participant R as Radarr 服务器

    BW->>BW: 本地解密出明文
    BW->>B: 填入网页登录表单
    B->>R: 正常提交表单（与手打相同）
    Note over BW: 到这一步就结束了
```

**浏览器扩展**做的就是这件事：检测当前页面的登录表单，按网址匹配条目，本地解密后填进去。没有扩展也完全能用，只是换成手动版：打开 Web 保险库或桌面/手机 App（它们和扩展是同一账号、连同一服务器，各自独立可用）→ 搜索 `radarr` → 点“复制密码” → 切回登录页粘贴。两个实用细节：**复制优先于查看**——密码全程不进肉眼，Bitwarden 还会定时自动清空剪贴板，只有在电视这类没法粘贴的设备上才点眼睛图标看明文；手机上没有扩展，对应的是系统级自动填充（Android Autofill、iOS 密码自动填充），效果相同。

也正因为最后一步就是普通表单提交，密码在局域网里仍以 HTTP 明文发给各服务——这和你以前手打密码的风险完全一样，密码管理器既没有加重、也没有解决这一跳。**它管的是“存储和填写”，传输环节的安全取决于服务本身用不用 HTTPS。**

最后强调一句：换工具之外，**博客别再贴真实密码**——工具换不掉习惯。

## 5. 顺带弄清：LinuxServer.io 是什么、和官方镜像差在哪

这次加的镜像里，`linuxserver/jellyfin` 又一次出现。这个前缀值得专门搞清楚：[LinuxServer.io](https://www.linuxserver.io/) 是一个**社区维护的 Docker 镜像团队**，把流行的自建应用统一打包、以 `linuxserver/` 前缀发布。它不是这些应用的官方团队——Radarr 是 Radarr 团队写的，linuxserver 只是“搬运工 + 标准化包装”。类似的团队还有 [hotio](https://hotio.dev/)，覆盖范围更聚焦在 *arr 和媒体服务。

他们的选品有明显边界：主力是影音媒体（*arr 全家桶、Plex、Jellyfin）、下载器、配套工具，只零星涉及基础设施（如 `linuxserver/mariadb`）。**Redis、Elasticsearch、MySQL 这类核心组件他们不碰**——这些软件的官方镜像已经足够好，第三方重新打包没有增值空间。LinuxServer 的增值恰恰在“上游没有好镜像”的领域。

与官方镜像的具体区别：

| 维度 | 官方镜像 | LinuxServer 镜像 |
|------|---------|-----------------|
| 打包者 | 软件作者或 Docker Library 团队 | 第三方社区团队 |
| 权限模型 | 各自为政，很多固定 UID 或 root | 统一 `PUID`/`PGID`，挂载文件权限不乱 |
| 配置路径 | 每家不同 | 统一 `/config` |
| init 系统 | 通常直接跑应用进程 | s6-overlay，带 `custom-cont-init.d` 扩展钩子 |
| 架构支持 | 核心软件一般齐全 | 冷门应用也覆盖 ARM64/ARMv7，树莓派友好 |
| 更新节奏 | 跟随上游发版 | CI 每周重建，带最新基础系统安全补丁 |
| 镜像体积 | 通常精简 | 偏大（多一层 init 和工具） |

代价是中间多了一层：他们的基础镜像改版会引入自己的坑——之前修复硬链接时遇到的 `custom-cont-init.d` 目录从 `/config` 挪到容器根，就是 linuxserver 基础镜像变更造成的，与 Radarr 本身无关。

经验法则：**基础设施用官方镜像，homelab 应用用 linuxserver/hotio**。

## 6. 统一入口的三次演进：从裸端口到 Homepage 占根

服务补全之后，剩下最影响日常体验的问题是入口。这个问题我前后折腾了三轮，每一轮都解决了一点、也暴露了一点，值得完整记录下来。

### 6.1 阶段一：裸端口，记不住

最初每个服务一个端口，访问全靠 `http://192.168.1.7:<端口>`：

| 服务 | 端口 | 服务 | 端口 |
|------|------|------|------|
| Radarr | 7878 | Bazarr | 6767 |
| Jackett | 9117 | ChineseSubFinder | 19035 |
| qBittorrent | 8085 | AdGuard Home | 8080 |
| Jellyfin | 8096 | Jellyseerr | 5055 |

八九个端口，时间长了根本记不住，每次想打开某个页面都要先翻备忘录。

### 6.2 阶段二：Caddy 子路径收敛

第一反应是上反向代理，把所有服务收敛到 `raspberrypi.local/<服务名>`。

**为什么选 Caddy 而不是 Nginx**：两者都能做反代，但家庭场景下 Caddy 的 `Caddyfile` 三五行就搞定，还能在 `.local` 私有域名上自动生成本地证书、自动处理 HTTPS 重定向；Nginx 要写 `server`/`location` 块、自己搞自签证书。功能和生态 Nginx 无疑更强，但树莓派局域网反代这个需求，Caddy 省掉很多模板代码。

**为什么选子路径而不是子域名**，核心原因是 mDNS。树莓派默认运行 [Avahi](https://www.avahi.org/)，实现了 [mDNS](https://en.wikipedia.org/wiki/Multicast_DNS)：同一个局域网里，设备不需要任何 DNS 配置就能通过 `raspberrypi.local` 访问到树莓派。但 `radarr.raspberrypi.local` 这种子域名**不会**被 mDNS 自动解析，必须依赖真正的 DNS 服务器——要么每台设备改 DNS 指向 AdGuard Home，要么改路由器 DHCP，都引入了额外的网络层配置，一旦 DNS 出问题整个局域网受影响。子路径方案只依赖 `raspberrypi.local` 这一个主机名，**零网络配置，开箱即用**：

```caddy
raspberrypi.local {
    reverse_proxy /radarr* radarr:7878
    reverse_proxy /jackett* jackett:9117
    reverse_proxy /bazarr* bazarr:6767
    reverse_proxy /adguard* adguardhome:80
}
```

**但子路径有个硬伤：后端服务必须支持 URL Base**。否则页面 HTML 里的 JS/CSS/API 链接会指向根路径 `/`，直接白屏或 404。*arr 家族都支持（Radarr 的 `UrlBase`、Jackett 的 `BasePathOverride`、Bazarr 的 `base_url`），但有两个服务怎么都挂不上：

- **qBittorrent**：WebUI 没有 URL Base 选项，前端代码写死了根路径 `/api/v2/...`，社区呼吁多年官方始终没加；
- **ChineseSubFinder**：作者转向 Lite 路线后 WebUI 基本不维护，同样按根路径部署。

于是这两个只能继续用原端口访问，方案天然残缺。

### 6.3 阶段三：想通了——入口只需要一个

后来装了 [Homepage](https://gethomepage.dev/) 导航页：一份 YAML 把所有服务收进一个首页，还能挂 docker socket 显示容器运行状态、探测服务存活：

```yaml
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    container_name: homepage
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
      # v1+ 必须显式允许访问的 Host
      - HOMEPAGE_ALLOWED_HOSTS=raspberrypi.local,192.168.1.7:3001,raspberrypi.local:3001
    volumes:
      - /home/pi/docker/homepage/config:/app/config
      # 只读挂 docker socket，用于首页显示容器运行状态
      - /var/run/docker.sock:/var/run/docker.sock:ro
    ports:
      - "3001:3000"
    restart: unless-stopped
```

这个小服务踩了两个坑：**ghcr.io 直连拉不动**（Docker Hub 的加速手段对它无效，解法是走[南京大学 ghcr 镜像站](https://ghcr.nju.edu.cn/)拉取后 `docker tag` 回原名）；**v1 强制 Host 校验**（不配 `HOMEPAGE_ALLOWED_HOSTS` 时页面能开但数据接口全部报 `Host validation failed`，必须把访问用的所有主机名都列进去）。

Homepage 用着用着，一个念头冒了出来：**既然所有服务都能从导航页点过去，为什么还要给每个服务维护一条 Caddy 子路径？** 入口只需要记住一个，子路径反代解决的是“记住 N 个地址”的问题，而 Homepage 已经把这个问题解决掉了。

那顺手把 Homepage 也挂到 Caddy 的 `/homepage` 子路径下，不就整齐了？一查才发现行不通，而且很讽刺：**Homepage 恰恰是全栈里最不适合挂子路径的服务**。它是 Next.js 应用，官方对子路径的支持一直很勉强——早年在 [discussion #150](https://github.com/gethomepage/homepage/discussions/150) 里加过一个 `settings.yaml` 的 `base` 设置（往 HTML 里插 `<base href>`），需要代理端剥掉前缀配合，但 JS 资源、`/api` 接口、widget 数据在子路径下依然经常出问题，到 2025 年的 [discussion #5087](https://github.com/gethomepage/homepage/discussions/5087) 里维护者的建议仍然是“把根路径直接给 dashboard 用”。再叠上 v1 的 Host 校验，这会是最痛苦的一个子路径——而它偏偏是入口，它挂了什么都点不了。

于是有了最终方案，简单到有点不好意思：**Homepage 直接占 `raspberrypi.local` 的根路径，其他服务全部直连端口，从导航页点过去**：

```caddy
raspberrypi.local {
    # 根路径直接给 Homepage 导航页，其他服务从导航页点过去、直连端口
    reverse_proxy homepage:3000
}

# 唯一例外：Vaultwarden 强制要求 HTTPS（见 4.3），单独开一个 HTTPS 端口
raspberrypi.local:8443 {
    reverse_proxy vaultwarden:80
}
```

Homepage 的服务清单里直接写端口链接（mDNS 下主机名比 IP 好写）：

```yaml
- 影音:
    - Jellyfin:
        href: http://raspberrypi.local:8096
        description: 媒体播放
    - Jellyseerr:
        href: http://raspberrypi.local:5055
        description: 点播入口
```

收尾清理：删掉 Caddyfile 里所有子路径反代；把阶段二给后端配的 URL Base 全部还原（Radarr 的 `UrlBase` 清空、Jackett 的 `BasePathOverride` 改回 `null`、Bazarr 的两个 `base_url` 改回 `/`），否则直连端口时还会被重定向到 `/radarr` 这种子路径；`HOMEPAGE_ALLOWED_HOSTS` 里加上不带端口的 `raspberrypi.local`（经 Caddy 443 访问时 Host 不带端口）。

```mermaid
flowchart LR
    User[浏览器 / 手机] -->|mDNS 自动发现| Pi[raspberrypi.local]
    Pi --> Caddy[Caddy 443/8443]
    Caddy -->|根路径 443| HP[Homepage 3001]
    Caddy -->|8443 HTTPS| VW[Vaultwarden]
    HP -.->|点卡片直连端口| Svc[Jellyfin :8096<br>Jellyseerr :5055<br>Radarr :7878<br>qBittorrent :8085<br>...]
    style HP fill:#fff3bf
    style VW fill:#fff3bf
```

实线是经过 Caddy 的两跳，虚线是 Homepage 卡片指向的直连链接。qBittorrent、ChineseSubFinder 这些挂不上子路径的服务天然兼容——反正都是直连端口；Vaultwarden 因为强制 HTTPS 走了 Caddy 的 8443，是唯一例外。

### 6.4 三轮方案对比

| 方案 | 要记几个地址 | 网络配置 | 前提条件 | 结局 |
|------|-------------|---------|---------|------|
| 裸端口 | N 个 IP:端口 | 无 | 无 | 记不住 |
| Caddy 子路径 | 1 个主机名 + N 个路径 | 无（mDNS 白送） | 每个后端支持 URL Base | qBittorrent/CSF 挂不上 |
| Homepage 占根 | 1 个 | 无 | 无 | 最终方案 |

回头看，子路径方案并不是白折腾：它让我确认了 mDNS 是局域网零配置的基石，也摸清了哪些服务支持 URL Base。但最终形态比它更简单——**反代只服务入口本身，入口之内全是直连**。

## 7. 当前栈全景与下一步

至此树莓派上的服务全景：

| 分组 | 服务 | 端口 |
|------|------|------|
| 播放与点播 | Jellyfin、Jellyseerr | 8096、5055 |
| 下载管线 | Radarr、Jackett、qBittorrent、Bazarr、ChineseSubFinder | 7878、9117、8085、6767、19035 |
| 入口与管理 | Homepage、Vaultwarden、Caddy、Portainer | 3001（经 443 反代）、8443（HTTPS 反代）、80/443、9443 |
| 网络 | AdGuard Home、V2Ray | 53/3000、10808/10809 |

日常唯一需要记的地址是 `https://raspberrypi.local/`（首次访问接受自签证书），其余全部从导航页点过去。

如果继续折腾，候选清单（都 ARM64 友好）：

- **Sonarr**：电视剧版 Radarr，自动追更按季整理；
- **Prowlarr**：Jackett 的现代化替代，索引器统一管理并同步给所有 *arr；
- **Recyclarr**：把 [TRaSH Guides](https://trash-guides.info/) 推荐的画质配置自动同步进 Radarr/Sonarr；
- **Navidrome**：音乐流媒体，私人 Spotify；
- **Immich**：自托管 Google Photos，8G 内存能跑；
- **Uptime Kuma / Dozzle**：服务存活监控 / 浏览器里看容器日志。

不建议在树莓派上碰的：Tdarr（转码农场，算力不够）、Nextcloud（能跑但体验重）。
