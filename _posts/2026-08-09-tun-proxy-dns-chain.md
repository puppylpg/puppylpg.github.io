---
title: "从豆瓣变卡说起：TUN 代理环境下的 DNS 链路全拆解"
date: 2026-08-09 17:58:24 +0800
categories: [tech, network, proxy]
tags: [dns, clash, doh, tun, fake-ip]
description: "从三个真实故障拆清显式代理与 TUN 的 DNS 链路：应用解析、fake-ip 映射、域名分流、远端解析和 DIRECT 真实解析分别发生在哪里，以及系统 DNS 污染、fallback-filter 误判和 Fake-IP 映射失同步该如何修复。"
---

1. Table of Contents, ordered
{:toc}

> 说明：本文涉及的公司域名（包括内网域名）均已脱敏，统一以 `corp.example.com`、`internal.intra.example.com` 等示例名代替；IP 地址保留原值。
{: .prompt-info }

> 版本说明：本文的排障跨越了数次 PandaFan / PandaCore 配置更新。DNS、Fake-IP、TUN 和目标覆盖的原理具有通用性，但字段位置与热重载能力可能随内核版本变化；文中的运行时结论均以当时生成的配置、日志和实测为准，当前验证版本为 PandaCore 1.6.4。
{: .prompt-warning }

> 本文是下篇，讲“号怎么查”（代理环境下的 DNS 链路）。上篇[《代理与 VPN 的区别：从三层封装到四层接力》](/posts/2026/08/08/proxy-vs-vpn-principles/)讲“包怎么走”——捕获入口、TUN、路由裁决这些概念如果在阅读中遇到障碍，可以先读上篇。
{: .prompt-tip }

## 三个故障，一张地图

这篇文章源于三个真实故障：

- **在家里**：代理（TUN 模式）开着，刷 Google 很快，国内的豆瓣却卡得像断了网；
- **在公司**：只开代理、不开公司 VPN，公网一切正常，内网系统却转圈直到超时；
- **同一台 Mac 上**：Codex 命令行能访问 ChatGPT，ChatGPT App 却连不上网。

三个故障看似无关，根子却是同一条链路：**代理环境下的 DNS**。但直接扎进排查细节很容易被绕晕——应用解析、TUN 捕获、fake-ip、fallback-filter、macOS 的 DNS 分流，缺了哪块拼图都看不懂现场。所以本文反过来组织：**先用四节把基础知识拉齐，再按“家里”“公司”“ChatGPT App”三个场景复盘故障**。

前两个场景的最终落地形态（排查也就发生在这套环境里）：

| 场景 | PandaFan 代理 | Cisco Secure Client（公司 VPN） | macOS 系统代理 |
|---|---|---|---|
| 家庭网络 | 增强/TUN 开启 | 开启 | 关闭 |
| 公司网络 | 增强/TUN 开启 | 关闭 | 关闭 |

前两个网络场景里，应用进代理的入口又分两种：**TUN 模式**（路由接管）和**端口模式**（应用主动连代理端口）。两种网络环境 × 两种入口，一共四种组合。第三个场景则把两种入口放在同一台机器、同一时刻直接对照，专门解释为什么命令行正常而 ChatGPT App 失败。

表里的“系统代理关闭”是刻意为之：PandaFan 选择“手动设置系统代理”，并用 `scutil --proxy` 确认 `HTTPEnable`、`HTTPSEnable`、`SOCKSEnable`、`ProxyAutoConfigEnable` 全为 `0`。于是没有单独配置代理的应用都先按直连方式产生请求，不会在应用层提前把域名交给代理——它们统一走 TUN。Codex 命令行是一个特意配置的例外：shell 函数给它注入了 `HTTP_PROXY` / `HTTPS_PROXY`，因此它走 `127.0.0.1:10080` 端口；这个例外正好构成场景三的对照实验。

## 基础一：两种代理模式，应用发出的包从一开始就不一样

要理解后面所有故障，得先把时间线往前推一步。**TUN 捕获的不是“域名请求”，而是应用已经决定连接某个 IP 后发出的普通 IP 包。** 应用在这之前有没有查 DNS、查到了什么，取决于解析结果来自哪里；这一步并不保证经过 PandaFan。

显式代理的时间线则不同：应用知道代理的存在，可以在自己还没有目标 IP 时，就把域名交给代理。两条链路从第一个动作起就已经分叉。

### 端口模式：应用把域名写进代理协议

**显式代理模式：应用知道代理的存在，会说“代理协议”。** 既然知道自己在用代理，应用就按约定好的格式跟代理对话。以 HTTP 代理为例，它连上代理端口后的第一句话是明文：

```text
CONNECT douban.com:443 HTTP/1.1
```

这就像一封按格式写好的委托书：“请帮我连 `douban.com` 的 443 端口”。目标域名白纸黑字写在协议里，代理拆开就能读。SOCKS5 同理，握手报文里有专门的字段填域名。

```mermaid
packet-beta
title 显式代理：代理收到的是“按协议写的委托书”
0-15: "三层头 src=127.0.0.1"
16-31: "三层头 dst=127.0.0.1（代理端口）"
32-47: "四层头 sport=54321"
48-63: "四层头 dport=10080"
64-95: "数据：CONNECT douban.com:443 ← 域名在明处"
```

应用不必先把 `douban.com` 解析成 IP：它只连接 `127.0.0.1:10080`，并在 `CONNECT` 里说明最终目标。PandaFan 从第一刻就拿到了域名，可以直接按域名规则分流。

### TUN 模式：应用先拿到 IP，TUN 才有包可抓

**TUN 模式下，应用不知道代理的存在。** 它看到 URL 里的域名后，先调用系统或自己的解析器；解析器交回一个 IP，应用才向这个 IP 发起连接，路由随后把包送进 TUN。

“调用解析器”不等于“现场发出一条 DNS 查询”。结果可能来自四个地方：

1. **PandaFan 截获的普通 DNS 查询**：`dns-hijack` 收到 53 端口查询，返回 `198.18.x.x`，同时保存“Fake-IP ↔ 域名”映射；
2. **macOS 或应用自己的 DNS 缓存**：直接交回之前保存的 IP，网络上没有 DNS 包，PandaFan 无从截获；
3. **`/etc/hosts` 或应用直接使用 IP**：同样没有 DNS 包；
4. **绕过劫持的查询**：例如应用自带 DoH/DoT，或被绑定到物理网卡的系统查询，可能拿到真实 IP，也可能拿到污染 IP。

因此 TUN 真正收到的目标地址有三种正常或异常形态：**有映射的 Fake-IP、正确的真实 IP、错误的真实 IP**；另有一种更隐蔽的异常——**系统还缓存着旧 Fake-IP，但 PandaFan 已经丢了对应映射**。

```mermaid
packet-beta
title TUN：代理收到普通 IP 包，目标已经是某个 IP
0-15: "三层头 src=192.168.31.51"
16-31: "三层头 dst=Fake-IP / 正确 IP / 错误 IP"
32-47: "四层头 sport=54321"
48-63: "四层头 dport=443"
64-95: "数据：TCP 握手；稍后 TLS 可能出现 SNI"
```

这就是两者的本质区别：**端口模式先交域名，TUN 模式先交 IP。** TUN 可以借 Fake-IP 映射或 SNI 嗅探补回域名，但“补回用于匹配规则的域名”和“把连接目标改成另一个地址”是两件事，不能混为一谈。

### 完整流程：差异发生在 TUN 捕获之前

先用一张时序图对齐两种入口的先后关系。最关键的区别是：端口模式在应用解析目标域名之前就进入 PandaFan，TUN 模式则要等应用拿到 IP、发出连接包之后才介入。

```mermaid
sequenceDiagram
    participant A as 应用
    participant R as macOS / 应用解析器
    participant P as PandaFan 代理端口
    participant T as Panda TUN
    alt 端口模式：应用知道代理
        A->>P: ① 连接 127.0.0.1:10080
        A->>P: ② CONNECT / SOCKS 携带 example.com
        Note over P: 此时已经知道域名，不需要应用先解析目标
    else TUN 模式：应用不知道代理
        A->>R: ① 解析 example.com
        R-->>A: ② 返回某个 IP
        A->>T: ③ 向该 IP 发普通连接包
        Note over T: 到这一步 TUN 才捕获业务连接
    end
```

再把 TUN 这一支展开。图的上半段是**应用解析结果从哪里来**，中间才是**TUN 捕获**，下半段是**PandaFan 手里最终有域名还是只有 IP**：

```mermaid
flowchart TD
    T0["阶段零：应用调用解析器"] --> CACHE{"缓存、hosts 已命中<br>或应用直接使用 IP？"}
    CACHE -->|"是"| C["直接得到已有 IP<br>没有 DNS 包可拦"]
    CACHE -->|"否"| DNSPKT{"普通 53 端口 DNS 包<br>进入 TUN？"}
    DNSPKT -->|"是"| H["dns-hijack 返回 Fake-IP<br>保存 Fake-IP ↔ 域名"]
    DNSPKT -->|"否：DoH / DoT / 绑网卡"| X["查询绕过普通 DNS 劫持<br>得到真实或污染 IP"]
    H --> SEND["应用向 IP 发普通连接包"]
    C --> SEND
    X --> SEND
    SEND --> CAP["阶段一：路由把包送进 TUN"]
    CAP --> FAKE{"目标在 Fake-IP 地址段？"}
    FAKE -->|"否：真实或污染 IP"| REAL["进入真实 IP 主分支<br>见下图"]
    FAKE -->|"是"| MAP{"映射表里还有记录？"}
    MAP -->|"有"| DOMAIN["反查得到原始域名"]
    MAP -->|"没有"| BROKEN["无法确定真正的出站目标<br>不建立正常出站连接<br>应用等待至超时或失败"]
    DOMAIN --> RULE{"按域名规则裁决"}
    RULE -->|"DIRECT"| LOCALDNS["PandaFan 在本地查询 DNS<br>得到真实 IP"]
    LOCALDNS --> LOCALDIAL["本机向真实 IP 直连"]
    RULE -->|"Proxy"| HANDOFF["域名原封不动交给代理节点<br>PandaFan 不解析真实 IP"]
    HANDOFF --> REMOTEDNS["代理节点在境外解析 DNS<br>并向真实服务器拨号"]
```

真实 IP 分支只需要再区分一个主流条件：**嗅探出的域名有没有覆盖原目的地址。** 开启目标覆盖后，连接重新变成域名连接，回到上图已有的域名分支；没有目标覆盖时，无论规则依据是 IP、进程、端口，还是只把嗅探域名用于匹配，实际拨号目标始终是原 IP：

```mermaid
flowchart TD
    R["TUN 拿到真实或污染 IP"] --> O{"嗅探出域名<br>且开启目标覆盖？"}
    O -->|"是"| D["嗅探域名替换原 IP<br>成为实际访问目标"]
    D --> JOIN["重新汇入上图的域名分支<br>DIRECT：PandaFan 本地解析<br>Proxy：域名交给节点解析"]
    O -->|"否"| I["实际目标仍是原 IP<br>嗅探域名至多参与规则匹配"]
    I --> IR{"规则裁决结果"}
    IR -->|"DIRECT"| ID["本机直接连接原 IP<br>不重新解析目标域名"]
    IR -->|"Proxy"| IP["原 IP 交给代理节点<br>节点仍连接该 IP<br>不解析目标域名"]
```

图中最重要的是两条边界：

- **TUN 只捕获网络包，不会捕获“从内存缓存里取 IP”这个函数调用。** 应用从缓存拿到 IP 后，前半段 DNS 流程已经结束；PandaFan 只能处理随后发来的 IP 包。
- **规则身份与拨号目标彼此独立。** 没有目标覆盖时，SNI 可能让 `103.252.115.53` 这条连接命中 `DOMAIN-KEYWORD,chatgpt,Proxy`，但出站节点收到的仍是 `103.252.115.53`，不会因为规则按域名命中就自动重新解析 `chatgpt.com`。只有嗅探成功且开启目标覆盖，嗅探域名才会替换原 IP 成为实际目标，随后重新汇入上图已有的域名分支：`DIRECT` 由 PandaFan 本地解析，`Proxy` 把域名交给节点解析。

### 六类主路径放在一起

把目标覆盖纳入后，不同入口与分流结果可以压缩成六类主路径。第六类不是新的出口机制，而是把原本的真实 IP 连接重新变成域名连接，再复用前面的 `DIRECT / Proxy` 域名分支。

| 入口与目标 | PandaFan 收到什么 | 规则之后如何拨号 | 目标域名在哪里解析 |
|---|---|---|---|
| 端口模式 + Proxy | 代理协议里的域名 | 域名交给国外节点，由节点解析 | 代理节点 |
| 端口模式 + DIRECT | 代理协议里的域名 | PandaFan 解析真实 IP，再由本机直连 | PandaFan 本地 |
| TUN + 有映射 Fake-IP + Proxy | Fake-IP 反查出的域名 | 域名交给国外节点，由节点解析 | 代理节点 |
| TUN + 有映射 Fake-IP + DIRECT | Fake-IP 反查出的域名 | PandaFan 解析真实 IP，再由本机直连 | PandaFan 本地 |
| TUN + 真实 IP + 没有目标覆盖 | 现成 IP；嗅探域名至多参与规则匹配 | `DIRECT` 或 `Proxy` 都继续使用原 IP | 不再解析目标域名 |
| TUN + 真实 IP + 嗅探后覆盖目标 | 嗅探域名替换原 IP，成为实际目标 | `DIRECT` 由本地解析；`Proxy` 把域名交给节点 | `DIRECT` 在本地；`Proxy` 在节点 |

于是 DNS 在整条流水线里可能登场三次，角色不同：

- **TUN 捕获之前的应用解析**：可能被 `dns-hijack` 接管并返回 Fake-IP，也可能直接命中缓存或绕过劫持；
- **PandaFan 的 DIRECT 真实解析**：前提是内核已经掌握域名，需要拿到真实 IP 才能本地直连；
- **代理节点的远端解析**：前提同样是内核掌握域名，并把域名交给节点；如果内核手里只有 IP，节点就没有域名可解析。

这张图就是后面所有故事的地图：豆瓣卡在 PandaFan 的 DIRECT 真实解析，公司内网卡在真实解析后的 `fallback-filter` 裁决，ChatGPT App 则卡在更靠前的“应用解析结果与 Fake-IP 映射是否同步”。

## 基础二：fake-ip——为什么 TUN 模式离不开 DNS

前面已经看清：TUN 抓到的普通 IP 包里没有域名，而分流规则偏偏按域名写。那这个域名怎么找回来？

先排除一个直觉方案：让 DNS 正常返回真实 IP，代理拿到包之后再“反查”域名。这不可行——一个 CDN IP 上可能挂着几百个域名，从 IP 本身反推不出应用本来想访问谁。**DNS 阶段的“域名 ↔ 连接”关系一旦丢失，只能寄希望于后续 SNI / Host 嗅探重新补出域名；能否补出、是否覆盖实际目标，都不是必然的。**

fake-ip 的思路是反过来的：**趁 DNS 应答还在代理手里，不给真答案，发一张“牌”**。代理本来就通过 `dns-hijack` 接管着 DNS 查询，于是它回一个 `198.18.x.x` 段的假 IP，同时在小本本上记下“假 IP ↔ 域名”的映射。应用拿着假 IP 来连接时（这个地址段会被路由进 TUN），代理一查小本本，域名就找回来了。整个过程像存包：柜员不告诉你货架位置，只给你一张 5 号牌；你拿着牌回来，他一查本子就知道你存的是什么。

```mermaid
sequenceDiagram
    participant A as 应用
    participant D as 代理 DNS 模块
    participant R as 规则引擎
    participant N as 机场节点
    participant S as 国内站点
    A->>D: ① 查询 douban.com（被 dns-hijack 接管）
    D-->>A: ② 返回假 IP 198.18.0.5（小本本记下映射）
    A->>R: ③ 连接 198.18.0.5（被路由进 TUN，反查出域名）
    alt 规则判定：DIRECT
        R->>D: ④ 真实解析 douban.com
        D-->>R: 返回真实 IP
        R->>S: ⑤ 向真实 IP 拨号
    else 规则判定：Proxy
        R->>N: ④ 把域名原样发给节点
        Note over N: ⑤ 节点在境外自行解析、拨号
    end
```

注意第 ② 步：代理应答时**自己也不需要知道真 IP**，所以 fake-ip 应答飞快。真实解析被推迟到必须它的时刻——两种去向对 DNS 的依赖完全不同：

- **Proxy**：在这条 Fake-IP 正常路径里，域名原样发给节点，由节点在境外解析，本地从头到尾不需要真实 IP，**本地 DNS 挂不挂无所谓**；如果 TUN 入口只拿到真实 IP，且没有目标覆盖，节点只会继续连接该 IP；嗅探后开启目标覆盖，才会重新回到“域名交给节点”的路径；
- **DIRECT**：代理必须自己做一次真实解析（走 nameserver/fallback 那套链路，见基础三），拿到真 IP 再拨号。

所以“TUN 离不开 DNS”的准确含义是：**每个 DIRECT 域名的第一次连接，都压着一次代理内核的真实解析**。解析链路一断，连接不是报错，而是干等——记住这句话，场景一的豆瓣故障就是它的放大版。

### 端口模式为什么不需要 fake-ip

从阶段图能看清：fake-ip 只是 TUN 在阶段二补齐域名信息的装置；端口模式的委托书自带域名，阶段二零成本。代理协议之所以设计成“说域名”而不是“说 IP”，是因为拨号的是代理，解析也该由代理（或远端节点）在它合适的网络位置做——应用先解析反而会带上本地污染。

过了阶段二，两种模式走的是同一条流水线。逐项对比：

| | 端口模式 | TUN 模式 |
|---|---|---|
| 域名从哪来 | CONNECT/SOCKS 握手自带 | Fake-IP 反查；SNI / Host 只能补救 |
| 应用自己查 DNS 吗 | 不查目标域名，只连 `127.0.0.1` | 先调用解析器；可能拿 Fake-IP，也可能命中缓存拿到真实或错误 IP |
| 判 DIRECT 后 | 代理解析真 IP 再拨号 | 代理解析真 IP 再拨号 |
| 判 Proxy 后 | 域名交节点远端解析 | 有域名就交域名；只有 IP 就原样交 IP |
| 内核 DNS 挂了 | DIRECT 连接干等 | DIRECT 连接干等 |

所以“DIRECT 集体卡死”这类故障，走端口模式一样会发生，只是波及面不同：端口模式只影响读了代理配置的应用，TUN 影响所有应用。fake-ip 只是 TUN 入口为了补齐域名信息而装的装置，不是代理的通用机制。

### 追问：为什么不直接拆 IP 包找域名？

既然包里“有时候”也能看到域名（TLS 的 SNI、HTTP 的 Host 头），代理拆开看不就行了？确实能拆——mihomo 的 SNI 嗅探干的就是这个——但它只能当补救，当不了主力。

回看前面那张“TUN 普通包”：头部全是地址和端口，没有域名这个字段；域名只可能藏在“数据”里，而且只在特定协议的特定时刻出现——TLS 握手的 ClientHello 带 SNI，明文 HTTP 带 Host 头，其他协议（SSH、各种私有协议）根本没有。它出现得也更晚：一条 TCP 连接的头三个包是握手，不含任何应用数据。用户态代理可以先接住入站连接，等到 ClientHello 到达后再做嗅探和规则裁决，所以“看到 SNI 时已经绝对来不及”并不准确；代价是代理必须理解并缓冲相应协议，而且**嗅探出的域名用于规则匹配，不等于它一定会替换原始目的 IP**。是否替换还取决于目标覆盖配置，ECH、QUIC 和私有协议则继续限制嗅探能力：

```mermaid
sequenceDiagram
    participant A as 应用
    participant P as 代理（TUN 捕获）
    A->>P: SYN（无数据）
    P-->>A: SYN-ACK
    A->>P: ACK
    Note over P: 此时只有目的 IP；代理可以暂存连接，等待应用层数据
    A->>P: ClientHello（SNI 首次出现域名）
    P->>P: 嗅探 SNI，参与规则裁决
    Note over P: 只有目标覆盖生效时才替换原始 IP；<br>ECH、QUIC 和无域名协议仍可能无法嗅探
```

域名解析发生在连接之前，因此是最适合建立“Fake-IP ↔ 域名”映射的时刻；普通 53 端口 DNS 还会直接暴露域名，便于劫持。但“应用调用解析器”不保证产生普通 DNS 包：缓存、hosts、DoH / DoT 都是例外。Fake-IP 守住的是**成功进入代理 DNS 模块的查询**，SNI 嗅探则是在后续数据里碰运气——主力和补救的分工就是这么定的。场景二还会看到嗅探的另一面：目标覆盖生效时，它可能把裸 IP 连接“升级”成域名连接，从而放大原本只影响域名解析的故障。

### 追问：TUN 模式是不是必然接管全系统 DNS？

**目标是尽量接管，但并不等于必然接管。** `dns-hijack: any:53` 的能力边界是：凡是**已经进入 TUN 的 53 端口网络包**，无论原本准备问路由器、公共 DNS 还是公司 DNS，都改道给 PandaFan 的 DNS 模块。这种接管只发生在包级，不会拦截应用从内存缓存里取地址的动作，也不会自动清理已有缓存。

四类情况不会经过这条普通 DNS 劫持链：

- macOS 或应用缓存已经命中，根本没有 DNS 包；
- `/etc/hosts` 已给出答案，或应用直接使用 IP；
- 应用自己通过 443 / 853 端口使用 DoH / DoT，在 TUN 看来只是 HTTPS / TLS 流量；
- 系统查询被绑定到物理网卡，绕过 TUN 直接出门。

因此“开着 TUN + 配了 `dns-hijack`”只能说明**进入 TUN 的普通 DNS 包会被接管**，不能推出“应用得到的每个 IP 都由 PandaFan 当场生成”。场景一会遇到物理网卡绕行，场景三则会直接撞上系统缓存与 PandaFan 映射不同步。

## 基础三：代理内核查 DNS 的家底：两组上游，一个裁判

基础一说过，无论哪种模式，只要规则判了 DIRECT，代理内核就得**自己**把域名查成真 IP 再拨号。那内核自己查 DNS 时问的是谁？这一节把它的家底翻出来。

**内核手头有两组上游，不是一组。** 配置里一组叫 `nameserver`（主组），放的是国内 DNS：阿里 `223.5.5.5`、腾讯 `119.29.29.29`，外加一个 `system`（意思是“去问系统”，它通向哪马上讲）。另一组叫 `fallback`（备组），放的是国外 DNS：`8.8.8.8`、`1.1.1.1`。

为什么要两组？因为只放哪一组都不放心：国内组快，但查国外域名时可能收到被人为塞进来的假答案；国外组干净，但从国内家宽直接问它，路上长期被干扰。所以内核的策略**不是**“主组挂了才用备组”，而是**两组同时问，再让一个裁判决定信谁**——这个裁判叫 `fallback-filter`，它的裁决规则是下一个话题，也是公司内网故障的伏笔。

先把这些上游各自的真实状况摸一遍。连上 `system` 牵出来的那条，一共三条链路：

- **主组 nameserver：靠两台国内公共 DNS 硬撑。** 这组用的都是“裸 UDP”查询——可以理解成寄明信片：不封口、不加密，路上谁都能看一眼、改两笔，忙的时候还可能被运营商故意压优先级、直接丢掉（行话叫 QoS 限速）。平时靠阿里、腾讯这两台公共 DNS 撑着没事，但明信片这种寄法，天生就不稳。
- **备组 fallback：先天就是断的。** `8.8.8.8`、`1.1.1.1` 的明信片从国内家宽寄出去，长期被干扰，大多数时候根本寄不到。所以“裁判倒向备组”基本等于“这次解析拿不到好结果”。
- **`system` 牵出的系统 DNS：最长、最脆的一条链。** 主组里的 `system` 指“用 macOS 系统里配置的那台 DNS”。这个配置没人手动设过，是连 Wi-Fi 时路由器自动塞给电脑的（路由器会给电脑发一份上网配置：IP、网关、DNS，这个过程叫 DHCP），里面写着“DNS 就用我 `192.168.31.1`”——小米路由器。于是查询先问路由器，路由器再转手问运营商的 DNS。实测连查 15 次超时 1 次（约 7% 丢包），故障窗口里还会连续超时——家用路由器顺手兼职的 DNS 转发，本来就没人保证质量。

三条链路画在一起，就是内核一次真实解析的全貌：

```mermaid
flowchart TD
    subgraph APP["应用侧"]
        B["端口模式应用<br>把域名直接交给代理"]
        C["其他应用（TUN 接管）<br>先拿到 fake-ip，再发起连接"]
    end
    subgraph CLASH["代理内核 DNS（mihomo）"]
        R{"DNS 调度<br>两组并发查询"}
        NS["nameserver（主）<br>system / 223.5.5.5 / 119.29.29.29"]
        FB["fallback（备）<br>8.8.8.8 / 1.1.1.1"]
        J{"fallback-filter<br>按结果 IP 归属地<br>裁决采纳哪份"}
        R --> NS
        R --> FB
        NS --> J
        FB --> J
    end
    SYS["系统 DNS<br>192.168.31.1（小米路由器）"]
    B -->|"域名"| R
    C -->|"fake-ip 反查域名"| R
    NS -.->|"system 这一项等于"| SYS
    SYS --> ISP["运营商 DNS"]
    NS --> PUB["国内公共 DNS"]
    FB --> OUT["国外公共 DNS"]
```

**三条腿各有各的瘸法**：主组靠公共 DNS 硬撑，`system` 这条链最脆，备组常年不通。平时还能凑合；一旦国内链路抖动的窗口叠上来，三组同时拿不到好结果，就是日志里那句 `all DNS requests failed`——场景一的豆瓣故障就是这么来的。

### fallback-filter：裁判的裁决规则，以及它的天生盲区

两组同时问，拿回两份答案，裁判 `fallback-filter` 凭什么决定信谁？这份配置里，裁判的规则写成配置只有三行：

```yaml
fallback-filter:
  geoip: true
  geoip-code: CN
```

翻译成人话：**主组给的 IP 如果在“中国名册”上，就信主组；不在，就把主组当骗子，改用备组的答案。** 这本“中国名册”就是 GeoIP CN 库——一个 IP 归属地数据库，登记着哪些 IP 号段分配给了中国大陆（代理分流规则里的 `GEOIP,CN,DIRECT` 查的也是这同一本名册）。

这个判断方法在家里上网时大体靠谱：被污染的假答案通常是境外 IP，“名册上没有”约等于“可疑”；国内网站的真答案都在名册上，顺利放行。但它有一个天生盲区：**名册只登记了公开发出去的号段，而公司内网偏偏爱用“内部编号”**——`10.0.0.0/8`、`100.64.0.0/10`（RFC 6598 保留的 CGNAT 段）这类保留地址段，任何国家的名册上都没有它们。于是内网域名的真实答案也会被裁判当成“骗子”丢掉；备组的国外公共 DNS 更不可能知道公司内网域名，只能答空。真答案被扔、空答案被采纳，解析就此失败。

在家里刷公网网站，这个盲区永远碰不到——所有答案都是公网 IP。可一旦把这套配置带进公司网络，盲区就会准时引爆。**先记住它，场景二见。**

## 基础四：macOS 有好几本 DNS 电话簿，按域名后缀分工

前面一直说“系统 DNS”，好像 macOS 只有一本电话簿。其实不是——**macOS 可以同时维护好几本，每本写清楚两件事：归我管哪些域名、查这些域名去问哪台服务器**。连 Wi-Fi 时路由器发下来的那本是“默认电话簿”，管所有没被点名的域名；VPN 这类软件还可以再装一本“专用电话簿”，只管自己圈定的域名——比如 Cisco 就给公司后缀单独安排了一本，指向两台公司 DNS（`10.78.226.115`、`10.78.226.116`）。

查域名时听哪本的？规则只有一条：**谁管的范围更具体，就听谁的**。“`corp.example.com` 这些公司后缀归企业 DNS 管”显然比“所有域名都归默认电话簿管”更具体，所以公司域名去问企业 DNS，剩下的才去翻默认电话簿。这跟 IP 路由“掩码越长越优先”是同一个思路，只不过这里比的不是 IP 前缀，而是域名后缀：

```mermaid
flowchart TD
    Q["应用要查一个域名"] --> M{"macOS 的挑选规则：<br>哪本电话簿管得更具体？"}
    M -->|"公司后缀<br>corp.example.com 等"| C["企业 DNS 电话簿<br>（Cisco 安装，只管公司域名）"]
    M -->|"其他所有域名"| D["默认电话簿<br>（Wi-Fi 下发，管剩下的全部）"]
```

以本文的环境为例，`hr.corp.example.com` 的完整旅程是：先被分到企业 DNS 那本电话簿，查出 `10.88.128.45`；拿到 IP 后要连接了，再按 IP 路由表选路——`10.0.0.0/8` 这条更具体的公司路由把它交给 Cisco TUN。注意这里发生了**两次互不相干的裁决**：查号时按“域名后缀”挑电话簿，走路时按“IP 前缀”挑网卡。前者决定“号码从哪本电话簿查”，后者决定“拿到号码后从哪条路走”。

排查时用到的几条命令，各自只回答一个问题，不能互相替代：

| 命令 | 它回答什么 |
|---|---|
| `scutil --dns` | 系统当前有几本电话簿（默认的、只管特定后缀的） |
| `dscacheutil -q host -a name <域名>` | 应用走 macOS 系统解析时实际得到什么 |
| `dig @<DNS-IP> <域名>` | 指定 DNS 服务器本身返回什么，不经过系统的挑选 |
| `route -n get <目标IP>` | 已经拿到 IP 后，连接会进入哪张接口 |

## 场景一（家里）：代理和公司 VPN 同开

基础知识齐了，进第一个实战场景。家里的形态：PandaFan 代理常年开着（增强/TUN 模式），在家要访问公司资源，Cisco VPN 也常开，系统代理关闭——没有单独配置代理端口的应用统一以 TUN 作为默认入口。

### 故障一：开着代理，豆瓣卡得像断了网

一个反直觉的现象：代理开着，刷 Google 很快，反倒是国内网站豆瓣卡得离谱——首页 HTML 能回来，页面却一直转圈，图片加载半天，偶尔能开、偶尔彻底打不开。

直觉上代理只该影响国外站点：规则里国内域名都是 DIRECT，豆瓣的服务器在国内，怎么会慢？怀疑对象自然先落在路径上——是不是流量被绕去国外转了一圈？

### 排查：先查“号”，再查“路”

网站打不开，无外乎两类原因：**出发前没查到地址**（DNS 出问题），或者**地址有了但路不对**（流量走错了方向）。一次连接本来就是先查号、再走路，排查也按这个顺序来。

**第一步：号有没有查到？** 直接问默认 DNS：

```bash
$ dig +short img3.doubanio.com
;; connection timed out; no servers could be reached

$ dig +short m.douban.com
;; connection timed out; no servers could be reached
```

全超时。注意 `dig` 只按默认 DNS 挨个问，它只能证明**默认 DNS 在抖**，说明不了全局；更硬的证据得看内核自己——通过它的控制 API 问一次：

```bash
$ curl "http://127.0.0.1:10079/dns/query?name=img3.doubanio.com"
{"message":"all DNS requests failed, first error: dial udp 1.1.1.1:53: i/o timeout"}
```

**所有上游 DNS 同时失败**——正是基础三说的“三条腿一起瘸”的叠加窗口。根因坐实：DNS 间歇性全灭。

这正好解释了实测里最扎眼的细节：走代理端口逐个访问豆瓣的子域，`www.douban.com` 0.24 秒秒开，`img3.doubanio.com`（图片 CDN）、`m.douban.com` 却挂起 10~20 秒直至超时——挂起的全是**“新域名的第一次连接”**。对照基础二的结论：每个 DIRECT 域名的第一次连接都压着一次内核真实解析，DNS 全灭时，它们自然集体卡死。

豆瓣之所以卡得最惨，因为它是这种故障的放大器：一个页面要拉 `img1`~`img9.doubanio.com`、`m.douban.com` 等十几个新子域，每个都是 DIRECT、每个的第一次连接都压着一次真实解析，赶上失败窗口各卡 5~20 秒，叠加起来就是“首页能开、图片全转圈”。而走节点的 Google 反而快——它根本不依赖本地解析。

**第二步：路有没有走错？** 根因已经坐实，再把“路”排除一遍，顺便见识下 TUN 的路由表。TUN 模式的代理（本机是 PandaFan，内核 mihomo）用了一组“级联路由”来接管流量——听着玄乎，做法其实很粗暴：**把整个 IP 地址空间像切西瓜一样切成 8 块，每块写一条路由，全部指向代理的虚拟网卡**。合起来的效果就是“几乎所有流量都先进代理过一遍”，但又没有直接动系统的默认路由：

```bash
$ netstat -nr -f inet | grep utun
1.0.0.0/8     198.18.0.1    UGSc    utun5
2.0.0.0/7     198.18.0.1    UGSc    utun5
4.0.0.0/6     198.18.0.1    UGSc    utun5
8.0.0.0/5     198.18.0.1    UGSc    utun5
...共 8 条，把除 0/8 外的 IPv4 空间拼满
```

豆瓣的 IP 确实全被导进了 TUN 虚拟网卡——看起来很可疑。但按基础一的流水线，进 TUN 只是进代理内核过一遍规则，不等于出国。再确认两件事：规则里豆瓣明明白白是 `DIRECT`；当前节点延迟 273ms，是活的。**路也没有问题**——症状全部由第一步的 DNS 全灭解释。

排查中还有个小插曲，值得提一句防踩坑：同样的代理配置，**把公司 VPN 开起来，豆瓣立刻变快**。但按基础四的机制，Cisco 只给公司后缀装了专用电话簿，管不着 `douban.com`——变快更可能是 DNS 缓存被刷新了，或者故障窗口恰好过去了。**时间相关不等于因果**：真正锁定根因的是第一步的两条硬证据（默认上游超时、内核报 `all DNS requests failed`），不是这个插曲。

### 修复一：把 mihomo 自己的 DNS 换成 DoH

病因清楚后，修复一是让**已经进入 mihomo DNS 模块**的查询不再依赖路由器和裸 UDP。方案核心是把普通 DNS 查询换成 **DoH**（DNS over HTTPS）：把 DNS 查询装进加密的 HTTPS 请求里，从外面看就是一次普通网页访问，路由器和运营商看不见内容、也没法篡改。整体安排是：日常查询只用国内 DoH，国外备用查询经代理节点出去，另留一组只写 IP 的普通 DNS 当“引导员”（作用马上讲）。

```yaml
dns:
  # DoH 域名的引导解析：必须能在 DoH 建立前工作，因此只写 IP
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29

  # DNS 查询遵循路由规则；节点域名用独立上游解析
  respect-rules: true
  proxy-server-nameserver:
    - https://223.5.5.5/dns-query
    - https://doh.pub/dns-query

  # 主解析不再混入 system 和裸 UDP，避免污染、抖动与自指循环
  nameserver:
    - https://doh.pub/dns-query
    - https://dns.alidns.com/dns-query

  # 国外备用解析经 Proxy 策略组发出
  fallback:
    - https://1.1.1.1/dns-query#Proxy
    - https://8.8.8.8/dns-query#Proxy
```

四处改动各有针对性，字段语义可与 [mihomo 官方 DNS 配置说明](https://wiki.metacubex.one/config/dns/)交叉核对：

- **`default-nameserver` 只放 IP**：它的角色是“引导员”——要用 DoH，得先连上 `doh.pub` 这台服务器；要连它，又得先知道它的 IP；查这个 IP 用的就是 default-nameserver。所以它必须只写 IP 这种直接能用的地址；这里要是也写一个域名，就变成“查地址之前得先会查地址”的鸡生蛋了。
- **`nameserver` 只保留国内 DoH**：`doh.pub` 和 `dns.alidns.com` 走加密的 HTTPS，不再把日常查询交给抖动的路由器和裸 UDP。另一个坑：`nameserver` 里不能再留 `system`（系统 DNS）——修复二会把系统 DNS 指向 Panda TUN，如果 mihomo 又去问系统 DNS，就变成“mihomo 问系统、系统问回 mihomo”的无限转圈。
- **fallback 改 DoH 并强制走节点**：这一步是被日志逼出来的。改成 DoH 后第一次测试依然超时，日志显示 `dial DIRECT (match Match/) mihomo --> 1.1.1.1:443`——**内核自己的 DNS 查询默认直连**，而 `1.1.1.1` 的 443 端口从家宽直连同样不通。讽刺的是，本机其他应用访问 `1.1.1.1:443` 反而能通：它们被 TUN 抓进内核、按规则走了节点，只有内核自己的查询“享受”不到代理。`#Proxy` 后缀就是告诉内核：这条 DNS 查询也要走名为 Proxy 的策略组出去。
- **`respect-rules` + `proxy-server-nameserver`**：前者让 DNS 查询遵循路由规则分流，后者指定节点域名的引导解析器，避免“要连节点先得解析节点域名、解析节点域名又得连节点”的鸡生蛋问题。

fallback 那个坑里还藏着一个值得细看的反差：同一个 `1.1.1.1:443`，普通应用访问能通，内核自己访问反而不通——

```mermaid
flowchart LR
    subgraph APP["普通应用访问 1.1.1.1:443"]
        A1["应用"] -->|"被 TUN 抓走"| A2["代理内核"]
        A2 -->|"规则命中 Proxy"| A3["经节点出去 ✅"]
    end
    subgraph CORE["内核自己的 DNS 查询"]
        B1["代理内核"] -->|"默认直连<br>不进自己的 TUN"| B2["家宽直连 ❌ 被干扰"]
    end
```

修复后验证（VPN 关闭状态）：

- 国内链路：连查豆瓣 CDN 10 次全部成功；
- fallback 链路：连查 `www.google.com` 6 次全部成功，且拿到的是干净的真实 IP（`142.251.x.x`），不再是之前的污染应答；
- 浏览器路径实测：`www.douban.com` 200 / 0.21 秒，`m.douban.com` 200 / 0.08 秒，Google 302 / 0.46 秒。

一个遗留提醒：这类 GUI 客户端（PandaFan、Clash Verge 等）的配置是托管的，**订阅更新或重启 App 可能把手改的 `config.yaml` 冲掉**。手改适合快速验证，长期配置应写进客户端提供的持久化覆写入口；PandaFan 对应的是“偏好设置 → 更多设置 → PandaCore 默认配置 → 编辑默认值”。保存后仍要重启核心，并以生成后的 `config.yaml`、端口监听和实际请求为准，不能只相信界面提示。这个提醒第二天就应验了：运行时配置被悄无声息地重写，上面这套 DoH 修复直接消失——兜底方案见场景二的“持久化”一节。

### 故障二：mihomo 修好了，系统 DNS 仍可能绕过 TUN

修复一只能保证**已经进入 mihomo DNS 模块**的查询可靠。但按基础二的结论，TUN 模式下应用是“先自己查 DNS、再连接”的——这些系统侧发出的查询，真的都进了 mihomo 吗？理论上，TUN 配了 `dns-hijack: any:53`，所有 53 端口的查询都该被抢走。但实测暴露了 macOS 的一个怪癖：**路由器自动下发的 DNS 配置，可能带着“必须从 Wi-Fi 网卡（`en0`）出去”的标记**（配置里写作 `if_index: en0`）。被这样绑死网卡的查询会绕过 TUN 的拦截直接出门——相当于包裹上贴了“仅限陆运”，TUN 这条空中走廊它根本不进。

这就是为什么“把小米路由器下发的 DNS 改成 `223.5.5.5`、`119.29.29.29`”还不够：查询确实绕过了小米的转发器，却也可能连 Panda 的 `dns-hijack` 一起绕过。实测向国内公共 DNS 直接查询时，`www.google.com` 和 `www.youtube.com` 依然拿到了明显张冠李戴的污染地址。

后续的 TLS 连接有时会被 mihomo 的 SNI 嗅探救回来（就是基础二里“拆包找域名”那个补救）：Google 即使先拿到污染 IP，代理仍可能从 ClientHello 里抠出域名，让规则改判为 Proxy；**只有嗅探结果还被允许覆盖原始目标时**，错误 IP 才会被域名替换，随后交给节点重新解析。若只改了规则而没有覆盖目标，节点拿到的依然是污染 IP，照样可能超时。YouTube 在同一轮测试里就没有获救；QUIC、ECH 和非 TLS 协议，更不能假设永远有明文域名可看。

这条“先被坑、再被救”的完整时序是这样的：

```mermaid
sequenceDiagram
    participant A as 应用
    participant P as 公共 DNS
    participant T as TUN / mihomo
    participant N as 机场节点
    A->>P: ① 查询 www.google.com<br>（查询被绑到 en0，绕过 dns-hijack）
    P-->>A: ② 返回污染 IP（张冠李戴的假地址）
    A->>T: ③ 连接污染 IP（被级联路由抓进 TUN）
    T->>T: ④ 从 ClientHello 嗅探出域名<br>SNI = www.google.com
    T->>T: ⑤ 域名规则改判为 Proxy
    alt 目标覆盖生效
        T->>N: ⑥ 用域名替换污染 IP，交给节点
        N->>N: 节点侧解析并拨号（可能救回）
    else 只用于规则匹配
        T->>N: ⑥ 仍让节点连接原污染 IP
        N--xA: TLS 仍可能超时
    end
```

能不能被救，既要看第 ④ 步有没有明文域名可抠，也要看嗅探结果能否覆盖原始目标——这就是它只能当补救的原因。

至于应用自己硬编码的 DNS：直接向 `8.8.8.8:53` 发的普通查询通常会被 `dns-hijack` 截获，但绑死网卡的查询和走 443 端口的 DoH 都抓不到——靠“劫持”兜底终归有漏。

所以最终问题已经不是“选哪台公共 DNS”，而是：**如何让 macOS 默认查询明确进入 Panda TUN，同时又保留 Cisco 对公司域名的专用解析。**

### 端口模式对照：域名直接交给代理

如果不用 TUN，改用系统代理（端口模式），DNS 发生的位置完全不同。Chrome、Safari 等应用读取系统代理后，会把 `CONNECT img3.doubanio.com:443` 直接交给本地代理。代理从一开始就拿到域名，DNS 全程由 mihomo 完成，不经过 macOS 的系统 DNS——故障二的“绕过 TUN”问题根本不存在：

```mermaid
flowchart LR
    B["浏览器"] -->|"域名"| L["本地代理端口"]
    L --> R["mihomo DNS<br>国内 DoH + 国外 fallback"]
    R --> D{"规则引擎"}
    D -->|"DIRECT"| S["国内站点"]
    D -->|"Proxy"| P["机场节点"]
```

但这条链引入了另一个先后关系：浏览器先把公司域名交给代理，**代理规则先于 macOS 的电话簿分工做决定**。公司域名一旦被误判为 `Proxy`，后续只会产生“代理核心 → 机场节点”的连接，Cisco 的公司路由再具体也看不到原始内网目标。在家里“代理 + VPN 同开”的场景下，这是个实打实的风险——这正是最终方案选择 TUN 作为全局默认入口、而不是开启系统代理的原因。

### 修复二：让 TUN 成为默认入口，也让默认 DNS 进入 TUN

修复二遵循一个原则：**代理侧只保留 TUN 作为全局默认入口，DNS 侧把普通域名和公司域名分别交给各自最可靠的 DNS。** 这并不要求关闭 PandaFan 的本地代理端口：少数明确配置了 `HTTP_PROXY` / `HTTPS_PROXY` 的应用仍可以主动走端口；关闭的是 macOS 系统代理这块全局“公告栏”，避免大量应用在端口与 TUN 两套默认入口之间分叉。为什么“单条连接更简单”的显式代理没有成为全局默认方案，完整取舍见上篇[《代理与 VPN 的区别：从三层封装到四层接力》](/posts/2026/08/08/proxy-vs-vpn-principles/)的共存场景。

Panda TUN 使用 `198.18.0.1` 作为本地虚拟接口地址，并配置了 `dns-hijack: any:53`。把 macOS Wi-Fi 的默认 DNS 指向这个地址，系统查询就不再带“必须走 Wi-Fi 网卡”的标记，而是明确进入 Panda：

```bash
networksetup -setdnsservers Wi-Fi 198.18.0.1
dscacheutil -flushcache
```

`198.18.0.1` 不是外部公共 DNS，也不会被发到互联网。查询进入 TUN 后由 mihomo 返回 `198.18.x.x` fake-ip，连接这个 fake-ip 时再反查域名、执行 `DIRECT` 或 `Proxy` 规则。Panda 内部的真实解析使用修复一配置的 DoH，`nameserver` 不再包含 `system`，因此不会形成自指循环。

Cisco 开启时，公司后缀有它专门指定的 DNS——按基础四“后缀匹配更具体者优先”，公司域名仍然用企业 DNS 解析。这就是为什么把默认 DNS 指向 Panda 后，`hr.corp.example.com` 依然解析为 `10.88.128.45` 并走公司 TUN：**两套机制各管各的后缀，互不干扰**。

这项设置按 macOS 的 Wi-Fi 网络服务保存，换家庭或公司 Wi-Fi 不需要重复修改。代价也必须明确：**PandaFan 必须保持连接**；如果主动关闭或核心崩溃，`198.18.0.1` 就没有 DNS 服务，表现会是所有新域名都打不开。需要临时不用 Panda 时，可恢复 DHCP DNS：

```bash
networksetup -setdnsservers Wi-Fi Empty
```

如果公司网络里存在“只有默认 DNS 解析得了、Cisco 又没单独安排”的私有域名，把默认 DNS 固定指向 Panda 就会绕过它们。当前方案之所以没这个问题，是因为常用公司域名都有 Cisco 指定的专用 DNS 覆盖，`hr.corp.example.com` 本身也有公开可见的私网 A 记录。

#### 小米路由器 DNS 仍然要改，但它只是底座

小米界面里的两类 DNS 不是一回事：

- **WAN DNS** 决定路由器自己向谁转发查询。设为 `223.5.5.5`、`119.29.29.29`，可以绕开光猫和运营商自动下发的上游；
- **LAN DHCP DNS** 决定路由器把哪些 DNS 地址发给客户端。把同一组公共 DNS 直接下发，可以让其他家庭设备少经过一层路由器转发。

这两项修复了原来“小米路由器 → 光猫 → 运营商 DNS”的脆弱链路，也给 Panda 的引导 DNS 和其他家庭设备提供可用底座；但裸公共 DNS 仍可能受 UDP 丢包或污染影响，所以**它不是这台 Mac 的最终解析入口**。Mac 的普通域名最终交给 Panda DoH，公司域名交给 Cisco 指定的公司 DNS。

```mermaid
flowchart TD
    APP["未单独配置代理的应用<br>系统代理关闭"] --> SDNS{"macOS 按域名后缀挑 DNS<br>匹配越具体越优先"}
    SDNS -->|"公司后缀"| CDNS["Cisco 指定的公司 DNS<br>10.78.226.115 / .116"]
    CDNS --> CIP["公司真实 IP<br>如 10.88.128.45"]
    CIP --> CRT["具体公司路由 → Cisco TUN"]

    SDNS -->|"其他域名"| PDNS["198.18.0.1<br>Panda TUN DNS"]
    PDNS --> DOH["mihomo：国内 DoH<br>+ 经 Proxy 的 fallback"]
    PDNS --> FIP["返回 fake-ip"]
    FIP --> RULE{"mihomo 规则"}
    RULE -->|"DIRECT"| DIRECT["物理网络直连"]
    RULE -->|"Proxy"| NODE["机场节点"]
```

#### 最终验证

配置完成后，同一轮测试覆盖了三类目标：

| 目标 | 结果 | 用时 | 关键路径 |
|---|---|---:|---|
| DHR 公司内网 | HTTP 200 | 约 0.58 秒 | 企业 DNS → `10.88.128.45` → Cisco TUN |
| Google | HTTP 204 | 约 1.06 秒 | Panda fake-ip → 代理节点 |
| YouTube | HTTP 200 | 约 1.98 秒 | Panda fake-ip → 代理节点 |
| 豆瓣 | HTTP 200 | 约 0.23 秒 | Panda fake-ip → `DIRECT` |

测试进程看到的远端地址是 `198.18.0.x` 属于正常现象：这是本机与 Panda 用户态协议栈之间的 fake-ip，不是网站真实地址。与此同时，`route -n get 10.88.128.45` 指向 Cisco TUN，普通公网目标指向 Panda TUN，系统代理四个开关全部为 `0`。

至此，场景一的“国内网站随机卡顿”不再靠系统代理绕开症状，而是从两层收口：mihomo 上游使用可达的 DoH，macOS 默认 DNS 明确进入 Panda TUN；Cisco 则只接管自己更具体的公司域名和公司路由。**小米公共 DNS 是底座，Panda DoH 是普通域名的解析入口，Cisco 指定的公司 DNS 是公司域名的专用入口。**

## 场景二（公司）：只开代理，不开 VPN

家里的方案落地后，第二天把电脑带进公司——正好是场景定义里的形态：“PandaFan TUN 开启、Cisco 关闭”。结果第一次实战就撞上新故障：内网系统（形如 `internal.intra.example.com`）一直转圈直到超时，而公网代理、国内直连全部正常。

### 排查：从“路不通”查到“查不到号”

代理环境下内网打不开，第一反应总是怀疑链路：路由被代理抢了？和企业 VPN 冲突？那就先量链路。让代理照常工作、用裸 IP 直连这台内网系统：`100.69.238.148:443` 的 TCP 能建立，但 TLS 握手死在 ClientHello 之后（`SSL_ERROR_SYSCALL`）。

“TCP 通、TLS 卡死”很容易把人引向 MTU 或中间设备；嫌疑一度也落到了 Cisco 头上——虽然 VPN 会话没开，但它装了一个常驻的系统插件（socket filter，作用是按进程接管网络连接），理论上确实可能和“代理内核代发连接”产生冲突。不过两个对照实验排除了这些方向：

- **同一内核转发公网 HTTPS 完全正常**：`baidu.com` 经 DIRECT 规则返回 200，说明代理内核的转发能力没有问题。故障和“这个目的地”相关，而不是和“转发”这个动作相关；
- **绑定物理网卡、彻底绕开代理内核**直连同一目标，TLS 握手一路走完 Certificate 交换——VPN 残留扩展并不拦路，“路”本身是通的。

路通而页面打不开，剩下的怀疑对象就是“查号”。先看 DNS 的表面：`dig` 这个内网域名，拿到的是 `198.18.x.x` 的 fake-ip——这是 TUN 的正常机制，不是故障。真正的矛盾藏在内核日志里（`external-controller` 的 `/logs` 接口）：

```text
[DNS] internal.intra.example.com --> [100.69.238.148] A from udp://172.25.218.221:53
[DNS] internal.intra.example.com --> [] A from udp://1.1.1.1:53
[TCP] dial DIRECT (match Match/) ... --> internal.intra.example.com:443 error: dns resolve failed: couldn't find ip
```

公司 DNS **成功返回了** `100.69.238.148`，fallback 的公共 DNS 返回空（它当然不可能知道内网域名），内核最终却报 `couldn't find ip`——一份真结果、一份空结果，内核为什么采纳了空的？

### 印证：正是 fallback-filter 的保留段盲区

“真结果被丢、空结果被采纳”这个矛盾，答案正是基础三预告的盲区。这台内网系统的地址 `100.69.238.148` 落在 `100.64.0.0/10`——RFC 6598 保留的 CGNAT 段，不在任何国家的 GeoIP 记录里。于是主 DNS 的真实答案被 fallback-filter 误判为污染、丢弃，fallback 又答空，`couldn't find ip` 就是这么来的：

```mermaid
flowchart TD
    Q["内核解析内网域名"] --> P["主 DNS（公司 DNS）<br>返回 100.69.238.148"]
    Q --> F["fallback（1.1.1.1 等）<br>返回空"]
    P --> J{"fallback-filter<br>IP 在 GeoIP CN 库？"}
    J -->|"100.64.0.0/10 是保留段<br>不在 → 误判为污染"| D["丢弃真实结果"]
    F --> E["采纳 fallback 的空结果"]
    D --> E
    E --> X["couldn't find ip<br>连接被杀死"]
```

内核日志已经直接证明：**域名解析路径**上的公司 DNS 真值被 `fallback-filter` 丢弃，这是内网域名失败的根因。再回看其他现象时，需要把“已经证实的根因”和“可能的放大路径”分开：

- **“TCP 通、TLS 卡死”**：裸 IP 的 TCP 能建立，证明路由和服务端口可达；TLS 停在 ClientHello 之后，只能说明故障发生在应用数据出现以后，单凭这一现象不能证明内核一定执行了目标覆盖。若该连接的嗅探配置同时覆盖实际目标，才会从 SNI 恢复域名、重新触发解析并撞上同一个失败；
- **公网国内域名不受影响**：它们的结果在 CN 库里，filter 直接采纳；
- **`10.x` 网段的内网应用不受影响**：它们直接以 IP 连接，命中 `IP-CIDR,10.0.0.0/8,DIRECT`，不触发内核解析。

只有“需要内核解析、且答案落在保留段”的内网域名，被这个机制精确误杀——基础三里那个理论盲区，在这里变成了现实故障。

下面这条时间线描述的是**目标覆盖生效时**可能出现的放大路径，而不是仅凭“TCP 通、TLS 卡死”就能反推出的唯一事实：

```mermaid
sequenceDiagram
    participant A as 应用
    participant T as TUN / mihomo
    participant S as 内网系统 100.69.238.148
    Note over A,S: 条件：该连接的 TLS 嗅探同时启用了目标覆盖
    A->>T: ① TCP 连接 100.69.238.148（裸 IP，不需要解析）
    T->>S: ② 拨号成功，TCP 握手完成
    A->>T: ③ ClientHello（SNI = 内网域名）
    T->>T: ④ 嗅探出域名，把连接“升级”成域名连接<br>重走规则：DIRECT 需要真实 IP
    Note over T: ⑤ 解析被 fallback-filter 误杀<br>couldn't find ip
    T--xA: ⑥ 杀死连接（表现：TLS 卡死）
```

若没有明文 SNI，或目标覆盖没有生效，基础一里的原则仍然成立：代理拿到的实际目标还是原来的裸 IP，不会仅因为匹配到域名规则就自动重新解析。上图只说明嗅探在特定配置下**可能**把解析故障扩散到裸 IP 连接。

### 端口模式对照：这个坑一样躲不开

这次故障发生在 TUN 模式，但换端口模式并不能躲开。端口模式下，应用把内网域名写进 `CONNECT` 交给代理，代理判 DIRECT 后同样要做阶段四的真实解析——**同样撞上 fallback-filter 的误杀**。区别只在两点：

- **波及面**：端口模式只影响读了代理配置的应用，TUN 影响所有应用；
- **TUN 侧可能出现的放大器**：目标覆盖生效时，SNI 嗅探可能把本来能走通的裸 IP 连接“升级”成域名目标，再次触发解析；端口模式从一开始就携带域名，不存在这次由 IP 到域名的转换。

也就是说，只要内网域名进入 nameserver/fallback 的“二选一”，两种模式都会被误杀。真正的出路只有一个：让内网域名**根本不参加这个二选一**。

### 修复：nameserver-policy 把公司域名摘出“二选一”

mihomo 的 `nameserver-policy` 优先级高于 `nameserver`/`fallback`：命中的域名直接由指定上游解析，不参与 fallback-filter 的 GeoIP 裁决。把公司各个域名后缀指向公司 DNS（域名已脱敏）：

```yaml
dns:
  nameserver-policy:
    "+.corp.example.com": [172.25.218.221, 172.25.218.248]
    # 其余公司后缀照此添加
```

改完必须让内核重新读取配置。当时通过控制 API 请求（`PUT /configs?force=true`）应用配置后，内网系统立即恢复，公网代理和国内直连的回归测试也都正常；但这不代表所有版本都支持 DNS 配置热重载。应先检查接口返回码：只有 `2xx` 才表示配置已载入；当前验证的 PandaCore 1.6.4 会对部分需要重启的 DNS / sniffer 变更返回 `409`，此时必须完整重启核心，再核对生成后的 `config.yaml` 和实际请求。

### 持久化：修复本身也可能被重写

修复只有几行 yaml，但紧接着的另一个发现让问题多了一层：前一天写入的内核 DoH 配置（见场景一的修复一），这天已经不在运行时的 `config.yaml` 里了——GUI 客户端在某个时刻重新生成了配置。前文“以生成后的 `config.yaml` 为准，不能只相信界面提示”的提醒，第二天就应验了。

手改文件只适合快速验证。PandaFan 每次启动都会从自己的默认配置对象重新生成 `config.yaml`，所以长期设置要写进生成源 `clash_default_config`。本次把 `nameserver-policy` 放进 `clash_default_config.dns`；后面场景三新增的 `store-fake-ip` 也放在同一位置。客户端重启后，生成文件仍同时包含两项，说明生成源已经生效。

launchd 看门狗继续作为第二层保险：`WatchPaths` 监听 `config.yaml`，发现 `nameserver-policy` 或 `dns.store-fake-ip` 被刷掉就自动补回，再尝试调用控制 API 重载。需要注意，PandaCore 会拒绝热应用 DNS、嗅探等“必须重启”的差异，返回 `409 Conflict`；遇到这种情况必须完整重启 PandaFan，并再次检查生成文件与实际请求，不能把“文件改成功”当成“内核运行时已生效”。

看门狗的判断逻辑可以概括为：

```bash
CONFIG=".../config.yaml"
# 两项都在才退出；否则补回 dns 段，再尝试热重载
grep -q "nameserver-policy" "$CONFIG" \
  && grep -q "store-fake-ip: true" "$CONFIG" \
  && exit 0
# ...（插入缺失配置）...
curl -X PUT "http://127.0.0.1:10079/configs?force=true" \
  -H "Content-Type: application/json" -d "{\"path\": \"$CONFIG\"}"
```

## 场景三（ChatGPT）：命令行能联网，App 却不能

第三个故障发生在同一台 Mac、同一时刻：Codex 命令行一直能访问 OpenAI，ChatGPT App 却显示无法联网。PandaFan 的代理端口与 TUN 都正常，规则也明确把 ChatGPT / OpenAI 域名交给 `Proxy`。这组现象看似否定了前面的链路，其实恰好把“入口不同”暴露得最清楚。

### 同一个网站，两条入口从第一步就不同

Codex 的 shell 包装函数显式设置了：

```bash
HTTP_PROXY=http://127.0.0.1:10080
HTTPS_PROXY=http://127.0.0.1:10080
```

所以 Codex 不先向 macOS 查询 `chatgpt.com`，而是直接向 PandaFan 的 HTTP 端口发送 `CONNECT chatgpt.com:443`。PandaFan 拿到域名，命中 `Proxy`，再把域名交给国外节点解析。

ChatGPT App 没有使用 macOS 系统代理，走的是 TUN：它先向系统解析器要 IP，再连接这个 IP，最后才被 TUN 捕获。两条路径的分叉发生在 PandaFan 处理业务连接之前：

```mermaid
flowchart TD
    subgraph A["路径 A：显式 HTTP 代理（Codex CLI）"]
        direction TB
        A1["Codex 请求 chatgpt.com"] --> A2["向 127.0.0.1:10080 发送<br>CONNECT chatgpt.com:443"]
        A2 --> A3["PandaFan 收到域名<br>chatgpt.com"]
        A3 --> A4["匹配 chatgpt → Proxy"]
        A4 --> A5["把域名交给代理节点<br>由节点侧解析并连接"]
        A5 --> A6["连接正确的 Cloudflare IP"]
        A6 --> A7["TLS 成功"]
    end

    subgraph B["路径 B：TUN 模式（正常情况）"]
        direction TB
        B1["ChatGPT App 查询 DNS"] --> B2{"macOS DNS 缓存"}
        B2 -->|"未命中"| B3["发出 DNS 查询"]
        B3 --> B4["PandaFan dns-hijack 截获"]
        B4 --> B5["返回 Fake-IP<br>198.18.0.19"]
        B5 --> B6["记录映射<br>198.18.0.19 ↔ chatgpt.com"]
        B6 --> B7["应用连接 198.18.0.19:443"]
        B7 --> B8["Panda TUN 捕获"]
        B8 --> B9["查询 Fake-IP 映射<br>恢复 chatgpt.com"]
        B9 --> B10["匹配 Proxy<br>域名交给节点解析并连接"]
    end

    subgraph C["路径 C：污染缓存造成的故障"]
        direction TB
        C1["ChatGPT App 查询 DNS"] --> C2{"macOS DNS 缓存"}
        C2 -->|"命中旧缓存"| C3["直接返回错误 IP<br>103.252.115.53"]
        C3 --> C4["没有发出 DNS 查询<br>Fake-IP 步骤被跳过"]
        C4 --> C5["应用连接错误 IP:443"]
        C5 --> C6["Panda TUN 成功捕获"]
        C6 --> C7["TLS Sniffer 从 SNI 看出<br>它原本是 chatgpt.com"]
        C7 --> C8["路由规则正确命中 Proxy"]
        C8 --> C9["但实际连接目标<br>仍是 103.252.115.53"]
        C9 --> C10["代理节点连接错误服务器"]
        C10 --> C11["TLS 超时"]
    end

    A7 ~~~ B1
    B10 ~~~ C1
```

### 故障状态一：系统缓存交回污染的真实 IP

第一次复现时，`dscacheutil` 显示 macOS 把 `chatgpt.com` 缓存成 `103.252.115.53`，还混入了不属于该站点的 IPv6 地址。应用命中缓存时没有发 DNS 包，`dns-hijack` 自然没有机会返回 Fake-IP。

ChatGPT App 随后向错误 IP 发起 TLS 连接。TUN 能从 ClientHello 的 SNI 里看到 `chatgpt.com`，日志也确实显示它命中了 `DOMAIN-KEYWORD,chatgpt,Proxy`；但当前 TLS 嗅探只把域名用于规则匹配，没有覆盖原始目的地址。于是“走代理节点”这个决定是对的，节点连接的目标仍是错误的 `103.252.115.53`，最终卡在 TLS 超时。

这一段印证了基础一里的关键边界：**命中域名规则，不等于目的 IP 被重新解析和替换。** 如果 TUN 手里只有真实 IP，选 `Proxy` 只是决定“由谁去连接这个 IP”。

### 故障状态二：系统记得旧 Fake-IP，PandaFan 忘了映射

继续清理和复测时，又出现了第二种状态：macOS 缓存返回 `198.18.0.19`，说明它记得此前的 Fake-IP；但 PandaFan 重启后已经丢了“`198.18.0.19` ↔ `chatgpt.com`”这条映射。

这时路由仍正确指向 Panda TUN，TCP 连接却停在 `SYN_SENT`，控制器里甚至看不到一条已建立的 ChatGPT 连接。原因不是规则、节点或真实 DNS，而是包在进入规则引擎前就失去了身份：

```mermaid
sequenceDiagram
    participant A as ChatGPT App
    participant M as macOS DNS 缓存
    participant T as Panda TUN
    participant F as Fake-IP 映射表
    A->>M: 查询 chatgpt.com
    M-->>A: 返回旧值 198.18.0.19（没有 DNS 包）
    A->>T: SYN → 198.18.0.19:443
    T->>F: 反查 198.18.0.19
    F-->>T: 没有映射
    Note over T: 无法确定真实出站目标，不创建正常 outbound
    T--xA: 应用等待至超时，或收到连接失败
```

Fake-IP 不是可以在公网直接访问的地址，它只是一张必须配合映射表使用的“取件牌”。macOS 留着牌、PandaFan 丢了登记簿，这张牌就变成了死地址。这里的“停在边界”不是说一个本来可以正常转发的公网包在途中随机丢了，而是 TUN 收到的目的地址本身缺少必要语义：它既不能把 `198.18.0.19` 当作真实公网目标拨出去，又查不到应该替换成哪个域名，因此无法创建正常的出站连接。具体表现可能是内核忽略或终止连接，应用侧等待到超时或直接收到失败；本次观测到的是 `SYN_SENT` 持续等待、控制器中没有对应的已建立连接。**真正坏掉的不是“第一次生成 Fake-IP”，而是系统缓存与内核映射表失同步。**

Codex 为什么不受影响也就完全清楚了：`CONNECT` 每次都重新携带 `chatgpt.com`，不需要 macOS 缓存里的 IP，更不依赖 Fake-IP 映射表。

### 修复：同时重建两边状态，而不是只清一边

只清 macOS 缓存或只清 PandaFan 映射，都可能留下另一边的旧状态。本次修复按同一个窗口连续完成四步：

```bash
# 1. 清 PandaFan 的 Fake-IP 映射与 DNS 缓存
curl -X POST http://127.0.0.1:10079/cache/fakeip/flush
curl -X POST http://127.0.0.1:10079/cache/dns/flush

# 2. 清 macOS 解析缓存
dscacheutil -flushcache

# 3. 明确向 PandaFan DNS 查询，建立一条新映射
dig @127.0.0.1 -p 1053 chatgpt.com A

# 4. 完整退出并重新打开 ChatGPT App，让旧连接池全部失效
```

重建后，PandaFan 给 `chatgpt.com` 分配了新的 `198.18.0.4`，macOS 查询也返回同一个地址。关闭所有代理环境变量、只走 TUN 的 `curl https://chatgpt.com` 在约一秒内完成 TCP 和 TLS，HTTP 返回 `403`；这里的 `403` 是网站拒绝普通 curl 请求，不是网络失败。控制器随后能看到域名被还原为 `chatgpt.com`，并经 `Proxy` 连接到正确的 Cloudflare 地址。完整重启 ChatGPT App 后，它的 `chatgpt.com`、`chat.openai.com`、`ab.chatgpt.com` 与 `cdn.openai.com` 连接也全部恢复。

### 防复发：持久化 Fake-IP 映射表

协调清缓存解决当前失同步，长期还要避免“内核重启后忘掉映射”。这里有一个版本差异不能照抄：**标准 Mihomo 文档常见的是 `profile.store-fake-ip`，当前 PandaFan 的 PandaCore 1.6.4 实际字段是 `dns.store-fake-ip`。** 以本机二进制的配置 schema 与重启测试为准，运行配置应包含：

```yaml
dns:
  store-fake-ip: true
```

这项设置同时写进 PandaFan 的持久化生成源，而不是只改生成后的 YAML：

```json
{
  "clash_default_config": {
    "dns": {
      "store-fake-ip": true
    }
  }
}
```

验证不能止于“配置文件里有这一行”，单个域名重启后地址不变也可能只是分配器总从同一位置开始。本次用了反序查询：重启前依次查询，得到 `chatgpt.com → 198.18.0.4`、`openai.com → 198.18.0.5`；完整退出并重启 PandaFan 后，反过来先查 `openai.com` 仍是 `.5`，再查 `chatgpt.com` 仍是 `.4`。两个地址没有随查询顺序对调，才证明映射确实写入并从 PandaCore 的 `fakeip-v4.json` 恢复。最后再用无代理环境变量的 curl 走 TUN 回归，TCP、TLS 与 HTTP 全部完成。

`store-fake-ip` 解决的是“旧 Fake-IP 与内核映射失同步”，不能阻止应用自带 DoH、物理网卡绕行或系统里已经存在的污染真实 IP。后几类风险仍要靠默认 DNS 指向 Panda TUN、必要时协调清缓存，以及实际检查 `dscacheutil`、控制器日志和目的 IP 来处理。

## 收尾：正常路径与故障边界一页速查

前两个场景 × 两种入口，各自的要害汇总如下：

| | 家里（代理 + 公司 VPN 同开） | 公司（只开代理，不开 VPN） |
|---|---|---|
| **TUN 模式** | 全系统应用都进 TUN；系统 DNS 可能被 `if_index` 绑卡绕过 `dns-hijack`，需把默认 DNS 显式指向 `198.18.0.1`；公司后缀由 Cisco 的专用电话簿分流，与 Panda 互不干扰 | 内网保留段域名会被 fallback-filter 误杀，必须配 `nameserver-policy` 把公司后缀摘出去；目标覆盖生效时，SNI 嗅探可能把裸 IP 重新变成域名目标，放大解析故障 |
| **端口模式** | DNS 全程在代理内核，家里那套 DoH 修复天然生效、不怕系统 DNS 绕路；但公司域名先过代理规则，一旦被误判 Proxy 就直接发往境外节点，Cisco 路由救不回来 | 内网域名 CONNECT 进代理后走 DIRECT 真实解析，同样被 fallback-filter 误杀——`nameserver-policy` 同样是必需品 |

再把三类 DNS 故障放回完整流水线，定位顺序如下：

| 故障位置 | 典型现象 | 本文案例 |
|---|---|---|
| TUN 捕获之前：应用解析 | TUN 收到错误真实 IP；规则可能正确，拨号目标仍错误 | ChatGPT 的污染缓存 |
| Fake-IP 身份恢复 | 路由进入 TUN，但控制器没有正常连接，旧 Fake-IP 无法反查 | ChatGPT 的映射失同步 |
| PandaFan 的 DIRECT 真实解析 | Proxy 站点正常，国内 DIRECT 新域名集体卡顿 | 家里的豆瓣 |
| 真实解析结果裁决 | DNS 已返回内网 IP，内核却报告 `couldn't find ip` | 公司的保留段内网域名 |

整篇文章最终收束为一句话：**先问 PandaFan 收到的是域名还是 IP，再问这个身份从哪里来，最后才看规则把它交给谁。** 端口模式的代理协议天然保留域名；TUN 只有在普通 DNS 被接管、Fake-IP 映射仍存在，或嗅探恰好可用时才能补回域名。规则决定出口，却不会凭空把一个错误 IP 变回正确域名。把这三个层次分开，DNS、TUN、路由和代理节点就不会再混成一团。
