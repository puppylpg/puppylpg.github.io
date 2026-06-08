---
title: "通过 MTP 同步小米手机文件到电脑"
date: 2026-06-08 23:35:08 +0800
categories: [ai]
tags: [powershell, mtp, xiaomi, windows, file-sync]
description: "使用 PowerShell Shell.Application COM 接口通过 MTP 协议将小米手机文件同步到 Windows 电脑，记录过程中遇到的枚举不完整、编码陷阱和年份匹配误报问题及修复方法。"
---

1. Table of Contents, ordered
{:toc}

# 背景与目标

用户的 Xiaomi 13 手机通过 USB 连接到 Windows 电脑，需要把手机内部存储中的照片和视频同步到电脑的 `F:\Photos\phone\10.MI13` 目录下。涉及多个目录：

- **Camera**：文件量最大（上万张），只需同步指定年份（2026）的照片
- **Screenshots、WeiXin、Douban、HeyBox、Twitter**：文件量相对较小，全量增量同步

由于手机通过 MTP（Media Transfer Protocol）协议连接，无法像普通磁盘一样直接用标准文件系统 API 访问，需要借助 Windows Shell 命名空间接口。

# 主要步骤

## 步骤一：诊断连接与目录映射

首先通过 PowerShell 的 `Shell.Application` COM 对象访问手机 MTP 设备。Windows 资源管理器中的「此电脑 → Xiaomi 13 → 内部存储设备」在 Shell 命名空间中对应 `Shell.Namespace(17)`（即「我的电脑」）下的虚拟文件夹。

遍历后确认了以下目录映射关系：

| 电脑目标目录 | 手机源路径 |
|---|---|
| `Camera` | `内部存储设备/DCIM/Camera` |
| `Screenshots` | `内部存储设备/DCIM/Screenshots` |
| `WeiXin` | `内部存储设备/Pictures/WeiXin` |
| `Douban` | `内部存储设备/Pictures/Douban` |
| `HeyBox` | `内部存储设备/Pictures/HeyBox` |
| `Twitter` | `内部存储设备/Pictures/Twitter` |

## 步骤二：Camera 按年份精确同步

Camera 目录有上万张照片，用户只需要 2026 年的。最初的年份判断逻辑是检查文件名是否包含子串 `"2026"`，但很快发现了问题：

小米手机截图的文件名格式为 `Screenshot_YYYYMMDD_HHMMSS-xxx.jpg`，其中时间戳部分如 `20:26:38` 会变成 `202638`，恰好包含 `"2026"` 子串。这导致 2023 年 20:26 拍摄的截图被误判为 2026 年。

**修复**：改为提取文件名中第一个 `20\d{2}` 作为年份，再与目标年份比较。对于文件名不含年份格式的边缘情况，兜底读取 `ModifyDate` 属性。

## 步骤三：其他目录全量同步

Screenshots、WeiXin 等目录采用全量增量策略：遍历源目录所有文件，通过 `Test-Path` 检查目标目录是否已存在同名文件，已存在的跳过，不存在的通过 `Shell.Application.CopyHere($item, 16)` 复制。其中 `16` 表示响应「Yes to All」，避免弹窗。

## 步骤四：发现问题与修复

第一次执行后，用户反馈 Screenshots 明显没有同步完。排查发现三个关键问题：

### 问题 1：MTP `Items()` 枚举不完整

Screenshots 手机端实际有 **4,384** 个文件，但脚本第一次只遍历到 **33** 个（3 个新文件 + 30 个已存在）。

**根因**：MTP 协议下，`Folder.Items()` 首次访问大文件夹时可能只返回一个子集，不会触发完整枚举。

**修复**：在 `foreach` 遍历之前，先强制访问 `.Count` 属性，这会触发 MTP 设备返回完整文件列表：

```powershell
$items = $srcFolder.Items()
Write-Host ('Item count (MTP may take a while): ' + $items.Count)
foreach ($file in $items) { ... }
```

修复后 Screenshots 完整同步：4,384 个文件全部枚举到，其中 287 个新复制，4,097 个已存在跳过。

### 问题 2：UTF-8 编码导致语法错误

脚本文件保存为 UTF-8 without BOM 后，PowerShell 5.1 默认用系统编码（GBK）读取。GBK 解码某些 UTF-8 中文字节时，将换行符「吃掉」了，导致代码行被粘到注释后面，报出 `Unexpected token '}'` 和 `The assignment expression is not valid` 等语法错误。

**修复**：给脚本文件加上 UTF-8 BOM（`EF BB BF`），PowerShell 读到 BOM 后会正确按 UTF-8 解析。

### 问题 3：`param` 块位置

`param([int]$CameraYear = (Get-Date).Year)` 被放在了脚本中间，这在 PowerShell 中是非法的。

**修复**：`param` 必须是脚本中第一个非注释/非空行，移到最开头。

# 核心结论

1. **MTP 大文件夹枚举不完整**：遍历前必须先访问 `.Count` 属性，否则可能只拿到部分文件。这个问题在 4,000+ 文件的 Screenshots 目录上表现明显，而 11,000+ 文件的 Camera 目录反而因为之前的访问可能已经缓存了完整列表。

2. **PowerShell 5.1 中文脚本的编码陷阱**：无 BOM 的 UTF-8 文件会被 GBK 解码，中文字节可能破坏换行符。保存为 UTF-8 with BOM 是最安全的做法。

3. **年份匹配不能简单子串搜索**：`Screenshot_20230603_202638.jpg` 中的 `202638` 是时间戳而非年份，必须用正则提取文件名中第一个 `20\d{2}`。

4. 最终整理了一份可复用的 PowerShell 脚本 `sync-mi13.ps1`，支持参数 `-CameraYear` 指定年份，以后插手机一键同步。

# 参考

- [PowerShell Shell.Application COM 接口文档](https://docs.microsoft.com/en-us/windows/win32/shell/shell-application)
- Windows Portable Devices (WPD) / MTP 协议枚举行为
