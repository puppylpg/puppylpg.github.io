---
layout: post
title: "树莓派 Docker 搭建自动电影下载站：Radarr + Jackett + qBittorrent + Bazarr"
date: 2026-06-17 01:29:07 +0800
categories: [life, raspberry-pi, docker, homelab]
tags: [docker, raspberry-pi, radarr, jackett, qbittorrent, bazarr, chinesesubfinder, homelab]
description: "在树莓派上用 Docker 部署 Radarr、Jackett、qBittorrent、Bazarr 和 ChineseSubFinder，实现指定电影自动下载到 Samba 共享目录，并自动下载中英双语字幕。"
math: true
mermaid: true
---

> **⚠️ 安全警告**：本文会公开本实验环境的登录地址、账号、密码和 API Key。这些凭证在发布后即视为已泄露，**请勿直接用于生产环境或长期暴露的服务**。建议读者在复现时替换为自己的强密码，并在公网访问时加 VPN/反向代理 + HTTPS。

## 1. 目标

让树莓派变成一个可以通过网页操作的“电影下载站”：

1. 打开网页搜索电影。
2. 选择想下载的版本（优先 4K）。
3. 自动通过 BT 下载到 Samba 共享目录 `/share/Movies`。
4. 自动下载中英双语字幕并合并成一条 bilingual 字幕。

## 2. 最终架构

```mermaid
flowchart LR
    User[浏览器] -->|搜索/添加电影| Radarr[Radarr 7878]
    Radarr -->|查询种子| Jackett[Jackett 9117]
    Jackett -->|Torznab| TPB[The Pirate Bay]
    Jackett -->|Torznab| RARBG[TheRARBG]
    Jackett -->|Torznab| TP2[TorrentProject2]
    Radarr -->|下发任务| qBittorrent[qBittorrent 8085]
    qBittorrent -->|下载中| Downloads[(/share/Downloads)]
    Radarr -->|硬链接/整理| Movies[(/share/Movies)]
    Bazarr[Bazarr 6767] -->|同步片库| Radarr
    Bazarr -->|下载字幕| OpenSubtitles[OpenSubtitles.com]
    Bazarr -->|中文字幕| Zimuku[字幕库/射手网等]
    Bazarr -->|写入双语字幕| Movies
    CSF[ChineseSubFinder 19035] -->|扫描| Movies
    CSF -->|下载中英双语字幕| Movies
    subgraph 树莓派
        Radarr
        Jackett
        qBittorrent
        Bazarr
        CSF
        Downloads
        Movies
    end
```

### 2.1 各服务职责

**Radarr**：电影收藏管理器（*arr 家族中的一员）。它维护一份“想看的电影”列表，自动追踪影片上映信息，决定应该下载哪个版本，并把下载任务发送给下载客户端。下载完成后，它还会把文件整理/重命名到媒体库目录。

**Jackett**：索引器聚合器。BT 站点（如 The Pirate Bay）通常没有统一、机器可读的 API，Jackett 把它们封装成标准的 Torznab API，让 Radarr 可以用同一种方式查询多个站点的种子。

**qBittorrent**：BT 下载客户端，负责实际的 P2P 下载。Radarr 通过 qBittorrent 的 WebUI API 添加种子、监控进度；下载完成后把文件落到 `/share/Downloads`，再由 Radarr 硬链接/移动到 `/share/Movies`。

**Bazarr**：字幕管理器。它定期向 Radarr 索取电影库清单，比对哪些影片缺少指定语言的字幕，然后到 OpenSubtitles 等字幕站下载。本文配了一个后处理脚本，把下载到的英文和中文 SRT 按时间轴合并成一条 bilingual 字幕。

**ChineseSubFinder**（可选补充）：专攻中文字幕的工具，会去字幕库、射手网等中文站点匹配并下载中英双语字幕。它直接扫描 `/share/Movies`，和 Bazarr 并行工作，作为中文字幕来源的兜底/增强。当前 `latest` 镜像带一个轻量 WebUI，但只能查看电影列表封面、控制系统状态和任务日志，**不能点进电影详情页手动搜索/上传字幕**；手动指定字幕只能直接把 `.srt`/`.ass` 文件放进电影目录。

### 2.2 工作流时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant R as Radarr
    participant J as Jackett
    participant Q as qBittorrent
    participant B as Bazarr
    participant OS as OpenSubtitles
    participant Z as 字幕库/射手网
    participant CSF as ChineseSubFinder
    participant S as /share/Movies

    U->>R: 搜索并添加电影
    R->>J: 查询 Torznab: 有这部电影的种子吗？
    J-->>R: 返回种子列表
    R->>R: 按画质优先级挑选最佳种子
    R->>Q: 添加下载任务
    Q->>Q: P2P 下载
    Q-->>R: 下载完成
    R->>S: 硬链接/移动到媒体库
    R-->>B: Webhook 通知电影下载/移动完成
    B->>R: 同步电影库（兜底轮询）
    B->>B: 发现缺少中英字幕（zh 优先）
    B->>OS: 下载英文字幕
    OS-->>B: 返回 .en(.hi).srt
    B->>Z: 下载中文字幕
    Z-->>B: 返回 .zh(.hi).srt
    B->>B: Post-Processing 检测/合并为 .zh+en.srt
    B->>S: 写入 .zh+en.srt
    CSF->>S: 扫描并下载中英双语字幕
```

时序说明：

1. 用户在 Radarr 搜索并添加电影。
2. Radarr 通过 Jackett 的 Torznab 接口查询索引站点。
3. Jackett 返回候选种子，Radarr 根据画质配置挑选最优版本。
4. Radarr 把种子推给 qBittorrent，qBittorrent 开始 P2P 下载。
5. 下载完成后，Radarr 把文件整理到 `/share/Movies`。
6. **Radarr 通过 Webhook 主动推送事件给 Bazarr**（电影下载/移动完成）；同时 **Bazarr 也会定期轮询 Radarr 的电影库**做兜底同步。
7. Bazarr 发现缺字幕后去 OpenSubtitles/中文字幕站下载；语言 profile 中 `zh` 优先于 `en`，如果 `.zh.srt` / `.zh.hi.srt` 本身已是中英双语，后处理脚本会直接复制为 `.zh+en.srt`。
8. 每次下载字幕后，Bazarr 调用后处理脚本，把中英两条 SRT 合并为一条 bilingual 字幕。
9. （可选）ChineseSubFinder 也会扫描 `/share/Movies`，从中文站点补充下载中英双语字幕。

### 2.3 为什么这些名字都这么奇怪？

这套工具的名字看着像黑话，其实大多是有意为之的双关或谐音梗。

**Radarr** 来自 **Radar**（雷达）+ `r`，寓意“扫描发现电影”。同属 *arr 家族的还有：

| 工具 | 用途 | 名字梗 |
|------|------|--------|
| **Sonarr** | 电视剧 | Sonar（声纳），像雷达一样扫描剧集 |
| **Lidarr** | 音乐 | Lid（盖子/眼睑），比较冷门的双关 |
| **Readarr** | 电子书/有声书 | Read（阅读）直接加 `r` |
| **Bazarr** | 字幕 | Bazaar（集市），字幕来自五湖四海 |
| **Prowlarr** | 索引器统一管理 | Prowl（ prowling，四处搜寻）|
| **Radarr** | 电影 | Radar（雷达）|

**Jackett** 则像是一件 **jacket（夹克）**，给形形色色、接口各异的 BT 站点套上一层统一外套，让它们都能以 Torznab 协议对外服务。

**qBittorrent** 里的 **q** 指它基于 **Qt** 图形框架开发；Bittorrent 就是 P2P 下载协议本身。

**Torznab** 是 **Torrent** + **Newznab** 的拼接。Newznab 是 Usenet 时代的 API 标准，Torznab 把它借用到 BT 世界，所以名字听起来像两种不同技术强行结婚生的孩子。

简单记法：

- 管电影的带“雷达”——**Radarr**
- 管字幕的像“集市”——**Bazarr**
- Jackett 是 BT 站的统一“外套”
- qBittorrent 就是实际干下载活的 BT 客户端

## 3. 环境信息

- 设备：Raspberry Pi，ARM64，8 GB RAM
- OS：Linux 6.12.87
- Docker：29.5.3，Docker Compose v5.1.4
- 已有服务：V2Ray（HTTP 代理 `127.0.0.1:10809`）、Portainer、AdGuard Home
- Samba 共享：`/share`，局域网地址 `192.168.1.7`
- Docker 默认网桥网关：`172.18.0.1`，容器内通过 `172.18.0.1:10809` 走宿主机 V2Ray 代理

## 4. 部署步骤

### 4.1 创建目录

```bash
mkdir -p /share/Movies /share/Downloads
mkdir -p /home/pi/docker/qbittorrent/config
mkdir -p /home/pi/docker/radarr/config
mkdir -p /home/pi/docker/jackett/config
mkdir -p /home/pi/docker/bazarr/config/scripts
mkdir -p /home/pi/docker/chinesesubfinder/config
```

### 4.2 Docker Compose

在 `/home/pi/docker/compose.yml` 里追加以下服务（与已有的 v2ray 等共存）：

```yaml
  qbittorrent:
    image: linuxserver/qbittorrent:latest
    container_name: qbittorrent
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
      - WEBUI_PORT=8085
    volumes:
      - /home/pi/docker/qbittorrent/config:/config
      - /share/Downloads:/downloads
    ports:
      - "8085:8085"
      - "6881:6881"
      - "6881:6881/udp"
    restart: unless-stopped

  radarr:
    image: linuxserver/radarr:latest
    container_name: radarr
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
      - HTTP_PROXY=http://172.18.0.1:10809
      - HTTPS_PROXY=http://172.18.0.1:10809
      - NO_PROXY=localhost,127.0.0.1,qbittorrent,radarr,jackett,bazarr
    volumes:
      - /home/pi/docker/radarr/config:/config
      - /share/Movies:/movies     # ⚠️ 错误示范：与下一行是两个独立 bind mount，会导致硬链接失败、空间翻倍，正确写法见第 10 节
      - /share/Downloads:/downloads  # ⚠️ 错误示范：应改为单一 /share 挂载，见第 10 节
    ports:
      - "7878:7878"
    restart: unless-stopped

  jackett:
    image: linuxserver/jackett:latest
    container_name: jackett
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
      - HTTP_PROXY=http://172.18.0.1:10809
      - HTTPS_PROXY=http://172.18.0.1:10809
      - NO_PROXY=localhost,127.0.0.1,qbittorrent,radarr,jackett,bazarr,yts.gg,movies-api.accel.li,yts.mx
    volumes:
      - /home/pi/docker/jackett/config:/config
    ports:
      - "9117:9117"
    restart: unless-stopped

  bazarr:
    image: linuxserver/bazarr:latest
    container_name: bazarr
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
      - HTTP_PROXY=http://172.18.0.1:10809
      - HTTPS_PROXY=http://172.18.0.1:10809
      - NO_PROXY=localhost,127.0.0.1,qbittorrent,radarr,jackett,bazarr,yts.gg,movies-api.accel.li,yts.mx
    volumes:
      - /home/pi/docker/bazarr/config:/config
      - /share/Movies:/movies
      - /share/Downloads:/downloads
    ports:
      - "6767:6767"
    restart: unless-stopped

  chinesesubfinder:
    image: allanpk716/chinesesubfinder:latest
    container_name: chinesesubfinder
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
    volumes:
      - /home/pi/docker/chinesesubfinder/config:/config
      - /share/Movies:/media
    ports:
      - "19035:19035"
    restart: unless-stopped
```

注意：

- qBittorrent 的 WebUI 端口改成 `8085`，因为宿主机 `8080` 已被其他服务占用。
- Radarr/Jackett/Bazarr 不直接用内置代理，而是通过容器环境变量走 V2Ray，这样更稳定。
- 容器下载目录统一挂到 `/share/Downloads`，电影最终目录是 `/share/Movies`。**但 radarr 不能像上面那样把两者挂成两个独立 volume**——这会让导入时的硬链接悄悄退化为复制，空间翻倍（2026-07-18 踩坑实录，排查与正确写法见第 10 节）。
- ChineseSubFinder 的媒体目录在容器内是 `/media`，对应宿主机的 `/share/Movies`。

### 4.3 启动

```bash
cd /home/pi/docker
docker compose up -d qbittorrent radarr jackett bazarr chinesesubfinder
```

## 5. 各服务配置

### 5.1 qBittorrent

- 地址：`http://192.168.1.7:8085`
- 账号：`admin`
- 密码：`pi123456`

Radarr 里添加下载客户端时，主机填 `qbittorrent`，端口填 `8085`（因为容器内 qBittorrent 的 WebUI 监听的是 `8085`）。

### 5.2 Jackett

- 地址：`http://192.168.1.7:9117`
- API Key：`1gh53xjyx9l1djek69yas386y7wtcjoc`

配置步骤：

1. 进入 Jackett → Add indexer。
2. 添加以下公开索引器（推荐至少加 TPB）：
   - **The Pirate Bay**
   - **TheRARBG**
   - **TorrentProject2**
3. 在 Jackett 设置里的 Proxy 先留空，靠容器环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 走代理。
4. 对每个 indexer 复制其 Torznab feed URL，例如：
   - TPB: `http://192.168.1.7:9117/api/v2.0/indexers/thepiratebay/results/torznab/`
   - TheRARBG: `http://192.168.1.7:9117/api/v2.0/indexers/therarbg/results/torznab/`
   - TorrentProject2: `http://192.168.1.7:9117/api/v2.0/indexers/torrentproject2/results/torznab/`

> 踩坑：Jackett 内置代理填 `127.0.0.1:12345` 会失败，因为容器内 `127.0.0.1` 不是宿主机。改成容器环境变量代理后正常。

### 5.3 Radarr

- 地址：`http://192.168.1.7:7878`
- API Key：`be67ae6612cc4061a7a2335723893305`

配置步骤：

1. **Settings → Media Management → Root Folders**：添加 `/movies`。
2. **Settings → Download Clients → Add → qBittorrent**：
   - Host：`qbittorrent`
   - Port：`8085`
   - Username：`admin`
   - Password：`pi123456`
3. **Settings → Indexers → Add → Torznab**：把 Jackett 里每个 indexer 都单独加一次：
   - URL：对应 indexer 的 Torznab URL
   - API Key：Jackett 的 API Key `1gh53xjyx9l1djek69yas386y7wtcjoc`
   - 当前已添加：TPB、TheRARBG、TorrentProject2
4. **Profiles → 编辑 Ultra-HD**：把画质优先级调整为：
   1. Remux-2160p
   2. Bluray-2160p
   3. WEB-DL-2160p
   - 禁用 HDTV-2160p，避免下载到低质量 4K。

#### Radarr 是怎么决定下载哪个版本的

Radarr 做决策时主要考虑三个维度：**可用性**、**画质** 和 **索引器来源**。

**可用性：Minimum Availability**

- 路径：添加/编辑电影时的 **Minimum Availability**，或在 **Settings → Profiles** 里设置默认值。
- 它决定电影到什么阶段才允许开始搜索：
  - **Announced**：刚加入 Radarr 就搜索，通常没资源；
  - **In Cinemas**：院线上映后搜索，可能下到枪版；
  - **Released**：蓝光/流媒体正式发行后搜索，资源最稳，**推荐**。
- 建议保持 **Released**，避免下到预告片或枪版。

**画质：Quality Profile**

- 路径：**Settings → Profiles**
- 每个 profile 是一组画质的排序列表，Radarr 会优先选择排在前面的画质。
- 当前预置 profile 有：Any、SD、HD-720p、HD-1080p、Ultra-HD、HD - 720p/1080p。
- 想优先 4K，就给电影指定 **Ultra-HD** profile。
- 如果 UI 支持设置 **Default Quality Profile**，可以把它设成 Ultra-HD；否则每次添加电影时手动选。
- 已经下载成 1080p 的电影，再改成 Ultra-HD 后，Radarr 会显示 "Cutoff Unmet"，但**不会自动重新搜索**。你需要手动进入电影页面点 **Search**，或者等 RSS 监控刷到新的 4K 种子。

**停止升级：Upgrade Until / Cutoff**

- 在 Quality Profile 里还有一个 **Upgrade Until**（也叫 Cutoff）设置。
- 它表示“达到这个画质后就不再继续升级”。
- 例如 Ultra-HD profile 里 Upgrade Until 设为 `Remux-2160p`，那么一旦下载到 Remux-2160p，Radarr 就会停止，不会再下载其他 4K 版本。
- 如果看到 `Release Rejected: Existing file meets cutoff: Remux-2160p`，说明当前文件已经满足 cutoff，这是正常行为。

**同一画质内继续升级：Custom Format Cutoff Score**

- 路径：**Settings → Custom Formats** 定义规则，**Settings → Profiles** 里设置 **Upgrade Until Score**。
- Custom Formats 让你给发布组、来源、音轨等属性打分。比如 `SPHD` +50、`Atmos` +20、`HMAX` -30。
- **Upgrade Until Score**（即 Custom Format Cutoff Score）是“满意分数”。
- Radarr 会升级，直到同时满足：**画质达到 Upgrade Until 且 Custom Format Score 达到 Upgrade Until Score**。
- 不折腾的话保持 `Upgrade Until Score = 0`，只按画质 cutoff 停止即可。

**索引器来源：Indexer Priority**

- 路径：**Settings → Indexers**
- 每个 indexer 有一个 **Priority** 数字，**越小越优先**。
- 当前配置：

| Indexer | Priority |
|---------|----------|
| TPB | 5 |
| TheRARBG | 10 |
| TorrentProject2 | 22 |

- 同一部电影、同一画质下，Radarr 会优先尝试 TPB，没有结果再 fallback 到 TheRARBG，最后 TorrentProject2。

**综合决策顺序**

1. 电影必须达到 **Minimum Availability** 才进入搜索池；
2. 按 **Quality Profile** 选最高可用画质，但不超过 **Upgrade Until**；
3. 如果启用了 Custom Formats，同一画质内继续升级直到 **Upgrade Until Score** 满足；
4. 在该画质下按 **Indexer Priority** 选优先级最高的 indexer；
5. 同一 indexer 多个结果中，优先选做种数多的种子。

#### 资源来源类型详解：从枪版到原盘

Radarr 的画质体系是**来源类型 × 分辨率**的二维组合，比如 `WEB-1080p` 表示“流媒体源 + 1080p”。Quality 列表里的所有类别按来源的演进顺序可以分成几组，下面逐一说明。

##### 影院流出类（枪版，不推荐）

| 缩写 | 全称 | 含义 | 质量 | 建议 |
|------|------|------|------|------|
| CAM | Camera | 摄像机在影院偷拍，画面抖、常有人头影子和观众笑声 | 最差 | 禁用 |
| TELESYNC（TS） | Telesync | 也是影院偷拍，但接了影院的外接音源（如无障碍音频孔），声音比 CAM 干净 | 差 | 禁用 |
| TELECINE（TC） | Telecine | 把影院放映用的胶片拷贝通过胶转磁设备转成数字文件 | 比 CAM/TS 好，但仍属枪版 | 禁用 |
| WORKPRINT | Workprint | 未完成剪辑的工作样片流出，可能缺特效、音轨未混音、有多余片段 | 不稳定 | 禁用 |

新片刚上映时往往只有这类源，比如《功夫女足》的 `TC国语v2` 就是 Telecine 源；`v2` 是发布组修正后的第二版（修音画不同步、补缺失片段等），不代表画质档次提升。这就是 **Minimum Availability 推荐保持 Released** 的原因——等正式发行再动手，自动避开枪版。

##### 提前泄露 / 样片类（不推荐）

| 缩写 | 全称 | 含义 | 质量 | 建议 |
|------|------|------|------|------|
| DVDSCR（DVD Screener） | DVD Screener | 片方送审、评奖、送媒体用的 DVD 样片流出，画面可能带“仅供评审”水印和时间码 | 接近 DVD 正版 | 禁用 |
| REGIONAL | Regional（常见为 R5） | 某些地区（如俄罗斯 R5 区）DVD 提前于全球发行，流出后被转录 | 接近 DVD | 禁用 |

这两类是在正式零售版之前泄露的“正版样片”，画质尚可，但有水印、缺内容等风险。

##### DVD / 标清时代（收藏价值有限）

| 缩写 | 全称 | 含义 | 建议 |
|------|------|------|------|
| DVD | DVD | DVD 光盘的直接转录 | 老片没有高清源时可接受 |
| DVD-R | DVD-R | 完整 DVD 光盘镜像（含菜单），体积大、播放麻烦 | 不推荐 |
| SDTV | Standard Definition TV | 标清电视信号采集 | 老片兜底 |

##### 电视采集类（HDTV）

| 缩写 | 全称 | 含义 | 质量 | 建议 |
|------|------|------|------|------|
| HDTV | High Definition TV | 从电视广播信号采集，可能带台标、插广告、码率受限 | 不如 WEB / 蓝光 | 有 WEB / 蓝光源就不勾 |

HDTV 有 720p / 1080p / 2160p 各档。它的唯一价值是时效——电视剧和电视节目的 HDTV 源往往出得最快，对电影来说通常很快被 WEB / 蓝光取代，所以本文 Ultra-HD profile 里禁用了 HDTV-2160p。

##### 流媒体类（WEB，推荐 WEB-DL）

| 缩写 | 全称 | 含义 | 质量 | 建议 |
|------|------|------|------|------|
| WEB-DL | Web Download | 从流媒体平台（Netflix、Disney+、Apple TV 等）服务器直接下载的原始视频流，不重编码 | 和平台用户看到的完全一致 | 推荐 |
| WEBRip | Web Rip | 对 WEB-DL 二次压缩，或用录屏 / 采集方式转录 | 有一次编码损失 | 能选 DL 就不要 Rip |

注意 Radarr 里 `WEB 2160p` 是一个**分组**，里面同时包含 `WEBRip-2160p` 和 `WEBDL-2160p` 两个子项，组内排上面的优先。只标 `WEB`、没写 DL 还是 Rip 的资源，一般按 WEB-DL 档处理。

同分辨率下优先级：`WEB-DL > WEBRip > HDTV`。

##### 蓝光家族（终极收藏）

| 缩写 | 全称 | 含义 | 体积 | 建议 |
|------|------|------|------|------|
| Bluray | Blu-ray Encode | 蓝光盘重编码压缩版，砍掉多余码率 | 适中（1080p 约 2–10 GB） | 推荐，性价比最高 |
| Remux | Remux（重新封装） | 蓝光原盘的视频流**不重编码**直接抽出，只去掉多余音轨 / 字幕 / 花絮后重新封装成 mkv | 大（1080p 约 20–40 GB，2160p 更大） | 画质党 / 收藏推荐 |
| BR-DISK | Blu-ray Disk | 完整蓝光原盘镜像（ISO 或 BDMV 文件夹），含菜单、花絮、全部音轨 | 最大（25–100 GB） | 一般不用，播放需挂载 |
| Raw-HD | Raw HD | 未经压缩的原始高清采集流 | 极大 | 基本不用 |

同分辨率下：`Remux > Bluray > WEB-DL`。

##### 无法识别

| 缩写 | 含义 | 建议 |
|------|------|------|
| Unknown | Radarr 无法从文件名解析出来源类型 | 禁用，避免下到乱命名的垃圾源 |

##### 推荐勾选方案

以“4K 优先、1080p 兜底”为例：

- ✅ 勾：`Remux-2160p`、`Bluray-2160p`、`WEB 2160p`、`Remux-1080p`、`Bluray-1080p`、`WEB 1080p`
- ❌ 不勾：CAM / TELESYNC / TELECINE / WORKPRINT（枪版）、DVDSCR / REGIONAL（样片泄露）、HDTV 全系（有更好源）、DVD / DVD-R / SDTV（标清）、BR-DISK / Raw-HD（原盘）、Unknown

##### 资源名常见后缀补充

- `v2` / `v3`：发布组修正版，修 bug 但不提升画质档次；
- `PROPER`：发布组认为别家的版本有问题，自己重发一个“正确版”；
- `REPACK`：同组修正自己之前发错的版本；
- `x264` / `x265`（HEVC）：视频编码格式，x265 同画质体积更小，但需要播放设备支持解码。

### 5.4 Bazarr

- 地址：`http://192.168.1.7:6767`
- API Key：`db657bd7209430ebc1e25832b24c9d1b`

配置步骤：

1. **Settings → Languages → Add New Profile**：
   - Name：`中英双语`
   - Language items 用 alpha2 code：`en`、`zh`（不要写“英文”“中文”，会报 `ValueError: None is not a valid language`）。
2. **Settings → Providers**：启用以下字幕源，覆盖英文和中文：
   - **OpenSubtitles.com**：英文/多语言字幕较全，需要到 [OpenSubtitles.com](https://www.opensubtitles.com) 注册免费账号并填入用户名/密码。
   - **zimuku（字幕库）**、**subf2m**、**subx**、**shooter（射手网）**：中文字幕源，国内资源较多。
   - 启用后 Bazarr 会依次尝试这些 provider，直到下载到 `en` 和 `zh` 两条 SRT。
3. **Settings → Radarr**：
   - IP：`radarr`
   - Port：`7878`
   - API Key：Radarr 的 API Key `be67ae6612cc4061a7a2335723893305`
   - 启用后 Bazarr 会同步 Radarr 的电影库，自动判断哪些电影缺字幕。
4. **Settings → Languages → 编辑“中英双语” profile**：
   - 把 `zh` 拖到 `en` 上面，让 Bazarr 优先尝试下载中文字幕。
   - 很多中文字幕站返回的 `.zh.srt` 本身已包含英文，这样能更快得到 bilingual 字幕。
5. **Settings → Subtitles → Post-Processing**：
   - 启用 `Use Post-Processing`
   - Post-Processing Command：
     ```bash
     python3 /config/scripts/merge_bilingual_subs.py
     ```

> **关于 `.hi` 字幕**：Bazarr 下载的字幕有时会带 `.hi` 后缀，例如 `.en.hi.srt`、`.zh.hi.srt`。这里的 `hi` 是 **Hearing Impaired**（听障版）的缩写，除了对白还会标注 `[door slams]`、`[music playing]` 等音效。如果你不想下载这种带音效描述的字幕，可以在语言 profile 里取消勾选 `Hearing Impaired`；合并脚本已经兼容 `.hi` 命名，即使下到 HI 版也能正常合并成 `.zh+en.srt`。

#### Bazarr 与 Radarr 如何通信

两者同时存在**拉取**和**推送**两种机制：

- **Bazarr 主动拉取**：Bazarr 每隔一段时间（默认 60 分钟）调用 Radarr 的 `/api/v3/movie` 接口，获取完整电影库清单，判断哪些电影缺字幕。
- **Radarr 主动推送**：在 Radarr 的 **Settings → Connect → Bazarr** 里配置 Webhook 后，Radarr 会在电影下载完成、重命名、添加/删除等事件发生时，立即通知 Bazarr 去检查该电影的字幕。

 webhook 让字幕下载更及时，定期拉取则负责兜底同步。两个都配好是最佳状态。

#### 中英双语字幕的落盘形态

以电影 `Inception (2010).mkv` 为例，Bazarr 下载后会在同一目录下生成：

```
Inception (2010).mkv
Inception (2010).en.srt          # 英文原文字幕
Inception (2010).zh.srt          # 中文字幕（有些站点的 zh 字幕本身已含英文）
Inception (2010).zh+en.srt       # 后处理合并/复制的 bilingual 字幕
```

后处理脚本会先判断 `.zh.srt` / `.zh.hi.srt` 本身是否已经是中英双语（即字幕条目里已有大量英文行）。如果是，就直接把它复制为 `.zh+en.srt`，不再等待英文字幕；否则才用对应的英文字幕和 `.zh` 字幕合并。Bazarr 下载的字幕有时会带 `.hi`（hearing impaired，听障版）后缀，脚本也会正确处理。

播放时选择 `zh+en.srt`，屏幕上会同时显示中文在上、英文在下。是否生效取决于播放器对 SRT 多行文本的渲染方式；如果播放器只显示一行，可能需要换成支持双语的播放器（如 Kodi、VLC、PotPlayer 等）。

### 5.5 ChineseSubFinder（可选，专攻中英双语）

如果你的主要目标就是**单文件本身就是中英双语**的字幕，可以额外部署 [ChineseSubFinder](https://github.com/allanpk716/ChineseSubFinder)。它专门去字幕库、射手网等中文站点匹配并下载中英双语字幕，比 Bazarr 更聚焦中文字幕来源。

Docker Compose 追加：

```yaml
  chinesesubfinder:
    image: allanpk716/chinesesubfinder:latest
    container_name: chinesesubfinder
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Asia/Shanghai
    volumes:
      - /home/pi/docker/chinesesubfinder/config:/config
      - /share/Movies:/media
    ports:
      - "19035:19035"
    restart: unless-stopped
```

配置文件 `/home/pi/docker/chinesesubfinder/config/config.yaml` 最小示例：

```yaml
UseProxy: false
HttpProxy: ""
TimeFormat: "yyyy-mm-dd"
SubSaveDirName: "chinesesubfinder"
Threads: 4
SubTypePriority: 0
DebugMode: false
SaveMultiSub: false
CustomVideoExts: ""
FixTimeLine: false
FFmpegPath: ""
FFprobePath: ""
AdvancedConfig: true
MediaPaths:
  - /media
```

启动后访问 `http://192.168.1.7:19035`：

- 默认账号：`admin`
- 默认密码：`shining0306FC`
- 首次登录后建议立即修改密码。

#### 关于这个版本的 WebUI

当前 `allanpk716/chinesesubfinder:latest` 镜像（最后一次更新为 2023-12-01）带的是一个**轻量 WebUI**，功能有限：

- ✅ 可以查看电影列表和封面；
- ✅ 可以控制系统状态、启动/停止守护进程；
- ✅ 可以查看任务日志；
- ❌ **电影卡片点不开详情页**；
- ❌ **不能在里面手动搜索或上传单部电影字幕**。

这意味着你不能像 Bazarr 那样在 ChineseSubFinder 的网页里点进电影选字幕。它只能作为一个后台自动扫描下载的兜底工具。

#### 手动指定字幕的方法

既然 WebUI 不能操作，手动指定字幕只能走文件系统：

1. 把字幕文件放到电影同目录，文件名和主视频文件同名：
   ```
   /share/Movies/Pressure (2026)/Pressure.2026.1080p...mp4
   /share/Movies/Pressure (2026)/Pressure.2026.1080p...chs.ass
   ```
2. 重启容器触发重新扫描：
   ```bash
   docker restart chinesesubfinder
   ```
3. 看日志确认它识别到已有字幕：
   ```bash
   docker logs -f chinesesubfinder
   ```

#### 必须有的 `.nfo` 元数据

ChineseSubFinder 扫描电影时需要目录里有 `.nfo` 元数据文件（通常由 Radarr 生成）。如果缺少 `.nfo`，日志会报：

```
no metadata file, movie.xml or *.nfo
```

此时 WebUI 里可能连电影封面都显示不出来，或者显示为无法点击的空白卡片。

**解决办法**：在 Radarr 里开启 metadata 生成：

1. Radarr → **Settings → Metadata**；
2. 启用 **Kodi (XBMC)** 或 **Emby**，勾选 `Movie Metadata` / `.nfo`；
3. 对已有电影执行 **Refresh & Scan** 或 **Organize**，让 Radarr 生成 `.nfo`；
4. 回到 ChineseSubFinder WebUI 点扫描，或 `docker restart chinesesubfinder`。

#### 版本状态

`allanpk716/chinesesubfinder:latest` 目前就已经是最新版，不要再指望更新它能获得完整 WebUI。作者已经明确转向 Lite 路线，全功能版本不再维护。如果你确实需要完整的电影详情管理界面，只能换用其他工具（例如主要依赖 Bazarr）。

### 5.6 双语字幕合并脚本

文件：`/home/pi/docker/bazarr/config/scripts/merge_bilingual_subs.py`

Bazarr 每次下载字幕后会调用该脚本，`BAZARR_SUBTITLE_PATH` 环境变量指向刚下载的字幕。脚本逻辑：

1. 从 `BAZARR_SUBTITLE_PATH` 的文件名里识别语言（支持 `.zh.srt` / `.en.srt`，以及 Bazarr 常见的听障版 `.zh.hi.srt` / `.en.hi.srt`）。
2. 如果下载的是 `.zh.srt` / `.zh.hi.srt`，先检测它本身是否已经是中英双语（字幕条目里有大量英文行）。
3. 如果是，直接复制为 `.zh+en.srt`。
4. 如果不是，且存在对应的英文字幕，则把两条字幕按时间轴合并成 `.zh+en.srt`。

```python
#!/usr/bin/env python3
"""
Bazarr post-processing script: merge Chinese and English subtitles into bilingual subtitle.

This script is called by Bazarr after a subtitle is downloaded.
It checks if both .zh.srt and .en.srt exist for the same video,
and creates a .zh+en.srt bilingual subtitle.

Environment variables provided by Bazarr:
- BAZARR_EPISODE_PATH / BAZARR_MOVIE_PATH: path to video file
- BAZARR_SUBTITLE_PATH: path to downloaded subtitle
- BAZARR_SUBTITLE_LANGUAGE: language of downloaded subtitle (en, zh, etc.)
"""

import os
import sys
import re
import glob
from pathlib import Path


def parse_srt(content):
    """Parse SRT content into list of (index, start, end, text)."""
    entries = []
    # Normalize line endings
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    # Split by double newline
    blocks = re.split(r'\n\s*\n', content.strip())
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue
        index = lines[0].strip()
        timing = lines[1].strip()
        text = '\n'.join(lines[2:]).strip()
        if not text:
            continue
        m = re.match(r'(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})', timing)
        if not m:
            continue
        entries.append({
            'index': index,
            'start': m.group(1),
            'end': m.group(2),
            'text': text
        })
    return entries


def format_srt(entries):
    """Format entries back to SRT content."""
    output = []
    for i, e in enumerate(entries, 1):
        output.append(str(i))
        output.append(f"{e['start']} --> {e['end']}")
        output.append(e['text'])
        output.append('')
    return '\n'.join(output).strip() + '\n'


def is_bilingual_zh_srt(zh_path):
    """检测一个 .zh.srt 是否本身已经是中英双语字幕。

    判断逻辑：统计所有字幕条目，如果包含纯 ASCII/英文单词的行数
    占总行数一定比例，则认为该文件已经是中英双语。
    """
    try:
        with open(zh_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
            entries = parse_srt(f.read())
    except Exception as e:
        print(f"Failed to parse {zh_path}: {e}")
        return False

    if not entries:
        return False

    total_lines = 0
    english_lines = 0
    for e in entries:
        for line in e['text'].split('\n'):
            line = line.strip()
            if not line:
                continue
            total_lines += 1
            # 包含连续英文字母/数字，且中文字符较少的行算作英文行
            has_ascii_word = bool(re.search(r'[a-zA-Z]{2,}', line))
            chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', line))
            if has_ascii_word and chinese_chars < 3:
                english_lines += 1

    if total_lines == 0:
        return False

    ratio = english_lines / total_lines
    print(f"{zh_path}: {english_lines}/{total_lines} lines look English-only (ratio {ratio:.2f})")
    # 如果超过 30% 的行是英文，认为已经是中英双语
    return ratio >= 0.30


def create_bilingual_from_zh(zh_path, output_path):
    """直接把已有的中英双语 .zh.srt 复制为 .zh+en.srt。"""
    try:
        with open(zh_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
            content = f.read()
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Created bilingual subtitle from existing bilingual zh.srt: {output_path}")
        return True
    except Exception as e:
        print(f"Failed to copy bilingual subtitle: {e}")
        return False


def merge_subtitles(en_path, zh_path, output_path):
    """Merge English and Chinese subtitles."""
    with open(en_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
        en_entries = parse_srt(f.read())
    with open(zh_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
        zh_entries = parse_srt(f.read())

    if not en_entries or not zh_entries:
        print("Empty subtitle entries, skip merging")
        return False

    # Match entries by start time
    en_by_start = {e['start']: e for e in en_entries}
    merged = []
    for zh in zh_entries:
        start = zh['start']
        en = en_by_start.get(start)
        if en:
            # Chinese on top, English below
            text = f"{zh['text']}\n{en['text']}"
            merged.append({
                'start': start,
                'end': zh['end'],
                'text': text
            })
        else:
            merged.append(zh)

    # Add any English entries not matched
    zh_starts = {e['start'] for e in zh_entries}
    for en in en_entries:
        if en['start'] not in zh_starts:
            merged.append(en)

    # Sort by start time
    merged.sort(key=lambda x: x['start'])

    srt_content = format_srt(merged)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(srt_content)
    print(f"Created bilingual subtitle: {output_path}")
    return True


def main():
    subtitle_path = os.environ.get('BAZARR_SUBTITLE_PATH', '')
    if not subtitle_path:
        print("No BAZARR_SUBTITLE_PATH, exit")
        sys.exit(0)

    sub_file = Path(subtitle_path)
    if not sub_file.exists():
        print(f"Subtitle not found: {subtitle_path}")
        sys.exit(0)

    # Determine video stem and language
    # Subtitle filename patterns:
    #   movie.en.srt, movie.zh.srt
    #   movie.en.hi.srt, movie.zh.hi.srt  (hearing impaired variant)
    name = sub_file.stem  # e.g. movie.en or movie.en.hi
    suffix = sub_file.suffix  # .srt
    parent = sub_file.parent

    parts = name.split('.')
    if len(parts) < 2:
        print(f"Cannot detect language from {name}")
        sys.exit(0)

    # Strip optional hearing-impaired marker so it doesn't confuse language detection
    if parts[-1].lower() == 'hi':
        parts = parts[:-1]

    if len(parts) < 2:
        print(f"Cannot detect language from {name}")
        sys.exit(0)

    lang = parts[-1].lower()
    stem = '.'.join(parts[:-1])  # movie

    def find_subtitle(parent, stem, lang, suffix):
        """Find a subtitle, preferring the .hi variant but falling back to plain."""
        hi_path = parent / f"{stem}.{lang}.hi{suffix}"
        if hi_path.exists():
            return hi_path
        return parent / f"{stem}.{lang}{suffix}"

    en_sub = find_subtitle(parent, stem, 'en', suffix)
    zh_sub = find_subtitle(parent, stem, 'zh', suffix)
    bilingual_sub = parent / f"{stem}.zh+en{suffix}"

    if lang == 'en':
        if zh_sub.exists():
            if is_bilingual_zh_srt(zh_sub):
                create_bilingual_from_zh(zh_sub, bilingual_sub)
            else:
                merge_subtitles(en_sub, zh_sub, bilingual_sub)
    elif lang == 'zh':
        if is_bilingual_zh_srt(sub_file):
            create_bilingual_from_zh(sub_file, bilingual_sub)
        elif en_sub.exists():
            merge_subtitles(en_sub, zh_sub, bilingual_sub)
        else:
            print(f"No English subtitle found and zh.srt is not bilingual, skip")
    else:
        print(f"Language {lang} not en/zh, skip merging")


if __name__ == '__main__':
    main()
```

给脚本可执行权限：

```bash
chmod +x /home/pi/docker/bazarr/config/scripts/merge_bilingual_subs.py
```

> 踩坑：Bazarr 语言配置里如果填“中文”“英文”会报 `ValueError: None is not a valid language`，必须用 alpha2 code `zh`/`en`。

## 6. 下载测试：《速度与激情 1》4K

1. 在 Radarr 搜索 `The Fast and the Furious`（2001）。
2. 选择 **Ultra-HD** 质量配置。
3. Radarr 通过 Jackett/TPB 找到 4K UHD BluRay 版本，约 18.67 GB。
4. 发送给 qBittorrent 开始下载。
5. 由于种子数只有 1-2，速度较慢，预计需要几天。
6. 下载完成后 Radarr 自动硬链接/移动到 `/share/Movies`。

如果速度太慢，可以随时在 Radarr 里把画质改成 1080p 重新搜索。

## 7. 访问地址与凭证汇总

| 服务 | URL | 账号 | 密码 / API Key |
| --- | --- | --- | --- |
| Radarr | `http://192.168.1.7:7878` | 无 | `be67ae6612cc4061a7a2335723893305` |
| Jackett | `http://192.168.1.7:9117` | 无 | `1gh53xjyx9l1djek69yas386y7wtcjoc` |
| qBittorrent | `http://192.168.1.7:8085` | `admin` | `pi123456` |
| Bazarr | `http://192.168.1.7:6767` | 无 | `db657bd7209430ebc1e25832b24c9d1b` |
| ChineseSubFinder | `http://192.168.1.7:19035` | `admin` | `shining0306FC` |

## 8. 踩坑与备注

1. **代理问题**：Jackett 内置代理在容器里对 `127.0.0.1` 解析错误，改用容器环境变量 `HTTP_PROXY=http://172.18.0.1:10809` 解决。
2. **qBittorrent 端口**：默认 `8080` 被占用，改为 `8085`，Radarr 里也要对应填 `8085`。
3. **Radarr 4K 画质**：需手动调整 `Ultra-HD` profile 优先级并禁用 `HDTV-2160p`。
4. **Bazarr 语言 code**：语言 profile 里必须用 `en`/`zh`，不能用中文名。
5. **字幕源**：OpenSubtitles.com 需要注册并填入账号密码，否则字幕下载会全部失败；ChineseSubFinder 默认账号 `admin`/`shining0306FC`，首次登录后建议修改。
6. **ChineseSubFinder 需要 `.nfo` 元数据**：如果日志报 `no metadata file, movie.xml or *.nfo`，WebUI 的电影卡片会点不开或显示异常。需要在 Radarr 的 **Settings → Metadata** 里启用 `.nfo` 生成，然后刷新/整理已有电影。
7. **`.hi` 后缀字幕**：Bazarr 下载的字幕可能是 `.en.hi.srt` / `.zh.hi.srt`（Hearing Impaired，听障版），原合并脚本只认 `.en.srt` / `.zh.srt` 会导致无法生成 bilingual 字幕。当前脚本已修复，支持 `.hi` 命名；如果不想下载 HI 字幕，可在 Bazarr 语言 profile 里取消勾选 `Hearing Impaired`。
8. **ChineseSubFinder 版本现状**：`allanpk716/chinesesubfinder:latest` 目前（2023-12-01 后未再更新）已经是最新版，且作者已转向 Lite 路线，更新也不会带来能点进电影详情页的完整 WebUI。需要手动管理字幕时，建议主要使用 Bazarr。
9. **安全**：以上凭证仅用于本实验，发布本文后应视为已泄露，建议尽快修改。
10. **硬链接从未生效（重点）**：`/movies` 和 `/downloads` 两个独立 bind mount 导致跨挂载 `link(2)` 返回 EXDEV，Radarr 静默退化为复制，所有电影占双份空间。排查与修复详见第 10 节。

## 9. 后续可优化

- 给所有服务加上 HTTPS + 反向代理（Nginx/Caddy + Authelia/Authentik）。
- 用 Sonarr 扩展电视剧自动下载。
- 给 qBittorrent 设置完成后自动做种限制或分类标签。
- 把 OpenSubtitles / ChineseSubFinder 账号密码改为环境变量注入，避免手动在 UI 填写。
- 4K 下载慢时，可尝试加入更多公共索引器或 PT 站点。

## 10. 最大的坑：两个 bind mount 让"硬链接"悄悄变成复制（2026-07-18 补记）

本文前面的架构图和流程都写的是"Radarr **硬链接**/整理到媒体库"。实际上线一个月后才发现：**硬链接从未生效过**，所有电影都是完整复制了两份，235G 磁盘被吃到 91%。这是整套方案里最值得单独成章的坑。

### 10.1 先理清：Downloads 和 Movies 两个目录的分工

理解这个坑之前，得先搞清楚为什么会有两个目录、为什么还要分别挂载。

| 目录 | 谁在用 | 角色 | 里面的文件长什么样 |
|------|--------|------|-------------------|
| `/share/Downloads` | qBittorrent | 下载中转站 + 做种田 | 保持种子原始命名（如 `The.Shawshank.Redemption.1994.RESTORED.1080p.BluRay.REMUX-DDB.mkv`），还混着广告 txt、样图等发布组附带文件 |
| `/share/Movies` | Radarr | 正式片库 | 每片一个目录、规范重命名（如 `The Shawshank Redemption (1994)/`），附带 `movie.nfo`、`poster.jpg`、`fanart.jpg` 等元数据，供播放器、Bazarr、ChineseSubFinder 消费 |

关键在于：**同一部电影需要同时存在于这两个角色里**。做种要求原始文件留在 Downloads 里纹丝不动（改名或移走都会破坏种子完整性，没法继续做种）；而片库要求规范命名、目录干净。鱼和熊掌要兼得，答案就是硬链接——同一份数据挂在两个路径下，互不干扰：

- Radarr 导入时不是"移动"也不是"复制"，而是在 Movies 里建一个指向同一份数据的硬链接，文件名随便改，Downloads 那份原封不动继续做种；
- 以后任何一边删除都不影响另一边：qBittorrent 删种只删一个链接，片库文件还在；删片库文件也不伤害做种；
- 磁盘空间只在**所有**硬链接都被删除后才真正释放。

所以"两个目录分别挂载"这个设计本身没有错——错的是挂成了两个**相互独立**的 bind mount，把硬链接这条路悄悄堵死了。接下来就看到这个堵法有多隐蔽。

### 10.2 现象：磁盘空间翻倍

事发是磁盘告警：235G 的盘用到 91%。`du` 逐层排查后发现 `/share/Downloads` 占了 49G，而其中 6 部电影（肖申克 21G REMUX、Toy Story 5 18G 2160p 等）在 `/share/Movies` 片库里也各有一份。

第一反应是：也许 Radarr 用的是硬链接，两份路径共享同一文件，`du` 只是重复计数了？用 `stat` 验证 inode 和链接数：

```bash
stat -c '%i %h %n' \
  "/share/Movies/The Shawshank Redemption (1994)/The.Shawshank.Redemption....mkv" \
  "/share/Downloads/The.Shawshank.Redemption.../The.Shawshank.Redemption....mkv"
# 5943816  1  /share/Movies/...
# 5438054  1  /share/Downloads/...
```

**两个 inode 不同、链接数都是 1**——如果是硬链接，两个路径应该指向同一个 inode 且链接数 ≥ 2。结论是：这是两份真实的拷贝，49G 是实打实多占的空间，"硬链接入库"从未发生过。

### 10.3 根因：跨 bind mount 的 `link(2)` 返回 EXDEV

分层验证的结果很有意思：

- **宿主机上**：`/share/Movies` 和 `/share/Downloads` 在同一块 ext4 上（`stat -c %d` 设备号相同），手动 `ln` 硬链接**成功**；
- **radarr 容器内**：`ln /downloads/xxx /movies/xxx` 直接报 `Cross-device link`（EXDEV）。

原因在于：Linux 内核的 `link(2)` 要求源和目标落在**同一个挂载（vfsmount）**下。本文第 4.2 节的 compose 把 `/share/Movies` 和 `/share/Downloads` 作为**两个独立的 bind mount** 挂进容器——哪怕底层是同一文件系统，跨 bind mount 做硬链接也会被内核拒绝。而 Radarr 虽然 `copyUsingHardlinks: true`，硬链接失败后会**静默回退为复制**，界面上没有任何告警，不用 `stat` 查 inode 根本发现不了。

这正是 TRaSH Guides 的经典文章 [Hardlinks and Instant Moves (Atomic-Moves)](https://trash-guides.info/Hardlinks/Hardlinks-and-Instant-Moves/) 要解决的问题：它建议让下载目录和媒体库落在**同一个挂载**下（即所谓单一 `/data` 布局），硬链接和瞬时移动才能正常工作。linuxserver 官方示例 compose 里 `/movies`、`/downloads` 两个 volume 的写法历史悠久，照抄就会踩中这个坑。

```mermaid
flowchart TD
    subgraph G1["修复前：两个 bind mount"]
        EXT4A["/share（同一 ext4）"] --> BA["bind: /share/Movies → /movies"]
        EXT4A --> BB["bind: /share/Downloads → /downloads"]
        BA -.->|"link() = EXDEV，退化为复制"| BB
    end
    subgraph G2["修复后：单一挂载 + 软链"]
        EXT4B["/share（同一 ext4）"] --> B1["bind: /share → /share"]
        B1 --> S1["/movies → /share/Movies（软链）"]
        B1 --> S2["/downloads → /share/Downloads（软链）"]
        S1 ==>|"link() 成功，零拷贝"| S2
    end
    style BA fill:#ffe3e3
    style BB fill:#ffe3e3
    style S1 fill:#e8f5e9
    style S2 fill:#e8f5e9
```

### 10.4 修复：单一挂载 + 软链，原有路径不变

顺着 10.3 的根因往下推，最直观的修法几乎是自己长出来的：既然病根是"两个独立 bind mount"，那就**只挂一个** `/share:/share`，然后把 Radarr 里的路径直接配成挂载下的真实路径 `/share/Movies` 和 `/share/Downloads`——这正是 TRaSH Guides 推荐的布局，干净利落，没有任何 trick。

但真要动手时发现这条路被**一开始的配置**卡死了：这套系统最初就是按 `/movies`、`/downloads` 两个路径配的，它们早已固化在至少三处：

1. **Root folder**：Radarr 里登记的媒体库根目录就是 `/movies`；
2. **数据库记录**：每部电影在 Radarr 数据库里存的完整路径都是 `/movies/xxx (年份)/...`，几十上百条；
3. **下游联动**：Bazarr 通过 Radarr API 拿到这些 `/movies/...` 路径再去文件系统找字幕——路径一变，Bazarr 的挂载也得跟着改，否则字幕功能整个坏掉。

也就是说，"直接改配置"意味着一整套有风险的迁移手术：批量迁移 root folder、补配 Remote Path Mapping（qBittorrent 上报的路径是 `/downloads/...`）、同步改 Bazarr 挂载——任何一处漏改都是静默故障。就为了绕开这个，才用软链 trick 一下：

- 挂载改成 `/share:/share` 后，真实路径变成 `/share/Movies/...`，与旧配置对不上；
- 那就建个软链 `/movies → /share/Movies`，让旧地址自动改道到新位置。

一行 `ln -s` 换掉了整套手术，Radarr 和 Bazarr 的配置一个字都不用动，它们甚至不知道软链的存在。

这里要分清两种"链接"，它们完全不是一回事：

- **软链接（symlink）**：上面这种，只是容器内**目录的别名**。radarr 访问 `/movies/xxx` 时内核先把它翻译成 `/share/Movies/xxx` 再操作。它不连接任何电影数据，唯一作用是把两个路径引到同一个挂载下，为硬链接铺路；
- **硬链接（hardlink）**：真正省空间的那个，由 radarr 之后**每部电影导入时自动创建**——同一份电影数据同时挂在 Downloads 的种子原名和 Movies 的规范名两个路径下。

一句话：软链是搭桥的，硬链是过桥的。下面脚本里的软链只是把路修通，真正连接电影文件的硬链接不需要手动建。

> 如果这套系统是**从零搭建**，根本用不着软链：直接挂 `/share:/share`，并在 Radarr 里把 root folder 配成 `/share/Movies`、下载目录配成 `/share/Downloads`，就什么桥都不需要。软链纯粹是给"已经存在的配置"打的兼容补丁。

做法：

1. **compose 改为单一挂载**，radarr 服务的 volumes 从两个 bind 改成：

   ```yaml
   volumes:
     - /home/pi/docker/radarr/config:/config
     - /home/pi/docker/radarr/config/custom-cont-init.d:/custom-cont-init.d:ro
     - /share:/share
   ```

2. **用 linuxserver 镜像的 custom-init 机制建软链**，`/home/pi/docker/radarr/config/custom-cont-init.d/10-hardlink-symlinks.sh`（记得 `chmod +x`）：

   ```bash
   #!/usr/bin/with-contenv bash
   # 让 radarr 沿用已配置路径 /movies、/downloads，
   # 但两者软链到单一 /share 挂载下，使导入时可硬链接而非复制。
   make_link() {
     link="$1"; target="$2"
     if [ -L "$link" ]; then ln -sfn "$target" "$link"; return; fi
     if [ -d "$link" ]; then
       if mountpoint -q "$link"; then
         echo "[hardlink-symlinks] $link 是挂载点，保持不变"; return
       fi
       if ! rmdir "$link" 2>/dev/null; then
         echo "[hardlink-symlinks] $link 非空目录，保持不变"; return
       fi
     fi
     ln -s "$target" "$link"
   }
   make_link /movies /share/Movies
   make_link /downloads /share/Downloads
   ```

   软链解析后，`/movies` 和 `/downloads` 实际都落在 `/share` 这一个挂载点下，`link(2)` 自然成功。Radarr 的 root folder、下载客户端映射、数据库记录全部不用改。

   > 这个脚本**不是一次性的，必须长期保留**：软链建在容器可写层里，容器每次重建（升级镜像、配置变更）都会被丢弃，脚本是每次容器启动时运行、负责把软链重建出来的。它本身幂等，留着没有任何副作用；删掉的话下次重建容器后 `/movies`、`/downloads` 会变成无效路径，片库直接"消失"。

   > 小坑中坑：新版 linuxserver 基础镜像（s6 v3）只在**容器根**的 `/custom-cont-init.d` 找自定义脚本，不再读旧文档里的 `/config/custom-cont-init.d`。所以 compose 里要显式把脚本目录挂到 `/custom-cont-init.d`，否则日志只会打印 `[custom-init] No custom files found, skipping...`。

3. **只重建 radarr 容器**，qBittorrent 完全不用动：

   ```bash
   docker compose up -d radarr
   ```

   进行中的下载不受任何影响——qBittorrent 没重启，已下载的分块有哈希校验，不存在损坏或重下的问题；radarr 停的一两分钟里，下完的任务在 qBittorrent 里排队等它回来再导入。

验证：容器内 `ln /downloads/x /movies/x` 成功，且 Radarr API `GET /api/v3/config/mediamanagement` 返回 `copyUsingHardlinks: true`。

### 10.5 存量重复文件：字节校验后改硬链接，立省 49G

对于已经重复占空间的存量文件，不用删也不用重下：把 Movies 里的拷贝替换成指向 Downloads 的硬链接即可（Downloads 侧保留为源，qBittorrent 做种完全不受影响）。

但替换前必须先证明"两份文件内容真的相同"，否则就是把好数据换成坏数据。证据分两层：

1. **尺寸粗筛**：`stat -c %s` 对比字节数。例如肖申克两边都是 21970935446 字节（21G REMUX），Toy Story 5 两边都是 18907976291 字节——字节数完全相等是同一份文件强有力的信号，但理论上仍可能巧合；
2. **全文比对实锤**：`cmp -s` 逐字节比对两份文件的全部内容（21G 的文件就读 21G × 2），全部一致才动手。

替换本身是原子的，核心逻辑：

```bash
cmp -s "$downloads_file" "$movies_file" \
  && ln "$downloads_file" "$movies_file.tmp" \
  && mv "$movies_file.tmp" "$movies_file"
```

6 部电影全部通过字节级校验并完成替换后，`stat` 链接数变为 2，磁盘从 **91% 降到 69%（空闲 21G → 70G）**。之后新下载的电影导入时会自动硬链接，Downloads 做种和 Movies 入库共享同一份数据，不再占双份空间。
