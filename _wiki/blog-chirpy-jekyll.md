---
title: "这个博客本身：Jekyll + Chirpy 的架构与维护"
date: 2026-08-24 16:45:37 +0800
categories: [wiki]
tags: [jekyll, chirpy, github-pages, docker]
description: "本站架构的活页面：Jekyll + Chirpy gem 主题、自定义集合、主题覆盖清单、预览与发布流程。升级主题或改结构时先看这里。"
---

> 这是一页 **wiki 活页面**，记录博客的“当前架构”；`_tutorials/` 里的文章是各次改造的历史实录。规则类内容以 `AGENTS.md` 为准，本页是它的可读版导航。

## 架构一句话

Jekyll + Chirpy gem 主题，部署在 GitHub Pages。布局、样式、JS 大部分在主题 gem 里，本仓库放站点配置、文章内容、少量自定义 layout/plugin 和本地开发脚本。本地同路径文件优先于 gem 内文件（gem-based 主题机制）。

## 集合与 Tab

`_config.yml` 定义了 7 个自定义集合，每个都有 `_tabs/` 下的同名 tab 页（basename 必须与 collection label 一致，否则列表页静默变空）：

| 集合 | 内容 | permalink |
|------|------|-----------|
| `_posts`（tech） | 技术原理、框架机制 | `/:collection/:year/:month/:day/:title/` |
| `_ai` | AI 相关 | 同上 |
| `_life` | 生活记录与折腾实录（VPS、树莓派、家庭网络等） | 同上 |
| `_tutorials` | 教程 | 同上 |
| `_books`、`_viewed` | 书与看过的东西 | 同上 |
| `_open` | 开放页面 | `/:collection/:title/` |
| `_wiki` | 活页面（本集合） | `/:collection/:title/` |

## 对主题 gem 的本地覆盖清单

每个覆盖文件都是升级主题时的手动合并债务，增减必须同步 `AGENTS.md` 的覆盖表：

| 本地文件 | 覆盖原因 |
|---------|---------|
| `_includes/update-list.html` | 右侧栏“最近更新”涵盖所有集合 |
| `_layouts/home.html` | 首页合并所有集合按日期倒序 |
| `_includes/js-selector.html` | 追加 `custom-toc.js` 与 `custom-mermaid.js` |
| `_includes/metadata-hook.html` | 注入 custom.css、赛博皮肤、星空背景、3D 纵深、tag-sphere |
| `assets/404.html` | “迷失太空”主题 404 |

## 本地预览与发布

| 场景 | 命令 |
|-----|------|
| macOS / Linux 原生 Ruby（需 3.x） | `bin/jekyll-dev.sh start` / `restart` |
| macOS / Linux Docker | `bin/jekyll-docker.sh start` |
| Windows Docker | `bin/jekyll-docker.ps1 start` |

发布流程铁律：本地预览 → 用户确认 → 询问后才 commit/push → 发布后 `stop` 关闭预览。CI 卡点是 `bundle exec jekyll build` + `htmlproofer`。

## 改造实录

- [jekyll-theme-chirpy](/tutorials/2023/10/29/jekyll-theme-chirpy/) — 主题初装
- [Chirpy 主题升级指南：从版本比对到本地覆盖维护](/tutorials/2026/06/08/chirpy-theme-upgrade-guide/)
- [为 Jekyll 博客搭建 Docker 开发环境：从跨平台问题到多阶段构建优化](/tutorials/2026/06/11/docker-jekyll-dev-environment/)
- [调试 Jekyll 博客的 Mermaid 渲染：从“文字被裁”到自动对比度的完整排查](/tutorials/2026/06/13/mermaid-rendering-debug-workflow/)
- [把 Jekyll 博客全站 3D 化：从 Three.js 知识图书馆到全息阅读面板](/tutorials/2026/06/10/jekyll-blog-3d-cyber-theme/)
- [Jekyll 博客的 Ruby 环境](/tutorials/2019/11/16/ruby-bundler-jekyll/) — Bundler 的两层套娃与 GitHub Pages 部署模式

## 维护约定

新增集合、新增主题覆盖文件、改变发布流程时，同步更新本页与 `AGENTS.md`。
