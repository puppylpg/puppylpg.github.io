---
title: "通过 MTP 同步小米手机文件到电脑"
date: 2026-06-08 23:35:08 +0800
categories: [tech]
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

## 步骤四：初次修复与同步

修复上述三个问题后，脚本可以正常运行。Camera 目录按 2026 年筛选，其他目录全量增量同步。首次成功执行结果：

- Camera (2026)：copied=1, skipped=1423
- Screenshots：skipped=4384
- WeiXin：skipped=1986
- Douban：skipped=56
- HeyBox：skipped=378
- Twitter：skipped=43

## 步骤五：严重漏洞——517 个文件漏同步

用户后续发现 Camera 目录下的 `VID_20260531_213533.mp4` 并未同步到 PC。进一步排查发现，这不是个例，而是系统性漏洞。

### 问题 4：MTP 元数据异常导致 `CopyHere` 静默失败

对 Camera 目录做完整比对，发现 **517 个文件在 PC 上缺失**。这些文件在手机端存在，但 MTP 报告的元数据全部异常：

- **Size = 0**
- **ModifyDate = 1899/12/30 00:00:00**

脚本第一轮遍历时确实调用了 `$targetShell.CopyHere($file, 16)`，但由于 MTP 层的问题，这些文件**没有实际写入到目标目录**。`CopyHere` 不返回值、不抛异常，脚本无法感知失败，导致「以为复制了，实际没复制」的静默漏传。

**修复**：不能依赖单次 `CopyHere` 的成功暗示。改为：

1. **收集阶段**：先枚举所有需要复制的文件，建立清单
2. **复制阶段**：批量发送 `CopyHere` 指令
3. **验证阶段**：复制完成后，逐个 `Test-Path` 检查目标是否存在（每个文件最多检查 5 次，间隔 1 秒，给大文件留出写入时间）
4. **重试阶段**：对验证失败的文件重试复制，最多 3 轮
5. **最终交叉核对**：所有目录同步完毕后，再次遍历手机端与 PC 端做全量比对。如有遗漏，`exit 1` 并列出缺失文件名

```powershell
# 验证与重试核心逻辑
$failed = @()
foreach ($item in $todo) {
    $found = $false
    for ($c = 0; $c -lt 5; $c++) {
        if (Test-Path $item.Dest) { $found = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $found) { $failed += $item }
}

# 重试 3 轮
for ($r = 1; $r -le 3; $r++) {
    if ($failed.Count -eq 0) { break }
    foreach ($item in $failed) {
        $targetShell.CopyHere($item.File, 16)
        Start-Sleep -Seconds 2
        # 再次验证...
    }
}
```

补同步这 517 个文件后，独立验证脚本确认 **2868/2868 = 0 缺失**。

### 问题 5：Skill 本身不规范

同步问题暴露后，进一步发现 skill 的编写也不符合标准：

- **无 front matter**：`SKILL.md` 直接以标题开头，没有 YAML front matter，系统无法通过 `description` 判断触发条件
- **脚本内嵌在文档中**：不符合「渐进式披露」原则，正文和代码混在一起
- **无目录结构**：脚本直接放在 skill 根目录，没有 `scripts/` 子目录

**修复**：

```yaml
---
description: 同步 Xiaomi 13 手机照片到电脑。当用户要求同步手机照片、拷贝手机目录、备份手机图片、或增量同步时触发。
---
```

脚本拆分到 `scripts/sync-mi13.ps1`，`SKILL.md` 仅保留说明和引用。

# 核心结论

1. **MTP 大文件夹枚举不完整**：遍历前必须先访问 `.Count` 属性，否则可能只拿到部分文件。

2. **PowerShell 5.1 中文脚本的编码陷阱**：无 BOM 的 UTF-8 文件会被 GBK 解码，中文字节可能破坏换行符。保存为 UTF-8 with BOM 是最安全的做法。

3. **年份匹配不能简单子串搜索**：`Screenshot_20230603_202638.jpg` 中的 `202638` 是时间戳而非年份，必须用正则提取文件名中第一个 `20\d{2}`。

4. **`CopyHere` 不可靠，必须事后验证**：Shell API 的 `CopyHere` 对 MTP 设备上的某些文件会静默失败。没有返回值、没有异常，唯一可靠的验证方式是复制完成后检查目标文件是否真的存在。

5. **重试机制是必需而非可选**：单次复制失败率不可忽略（本例中 517/2868 ≈ 18%）。脚本必须内置收集→复制→验证→重试的闭环，并在最后做全量交叉核对。

6. **Skill 需要 front matter 和目录结构**：`description` 字段让系统能渐进式地判断是否触发 skill；`scripts/` 子目录让代码和文档分离，符合可维护的标准。

# 参考

- [PowerShell Shell.Application COM 接口文档](https://docs.microsoft.com/en-us/windows/win32/shell/shell-application)
- Windows Portable Devices (WPD) / MTP 协议枚举行为
