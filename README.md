# puppylpg.github.io

个人技术博客与知识库，基于 [Jekyll](https://jekyllrb.com/) 与 [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) 主题构建，通过 GitHub Actions 部署至 [GitHub Pages](https://puppylpg.github.io)。

本仓库由 [Chirpy Starter](https://github.com/cotes2020/chirpy-starter) 演进而来：在主题 gem 之外，保留了站点级配置、导航 Tab、插件与部署流程，并扩展了多个自定义内容集合。

## 技术栈

| 项目 | 说明 |
|------|------|
| 静态站点 | Jekyll |
| 主题 | `jekyll-theme-chirpy` ~6.2 |
| 语言 / 时区 | `zh-CN` / `Asia/Shanghai` |
| 评论 | [Utterances](https://utteranc.es/)（GitHub Issues） |
| 部署 | GitHub Actions → GitHub Pages |
| 链接检查 | `html-proofer`（CI 构建阶段；`_tutorials` 因 Chirpy 模板残留断链而豁免） |

主题的大部分布局、样式与脚本来自 Ruby gem；仓库内主要存放**站点配置**、**文章内容**与**少量定制**。

## 目录结构

```
.
├── _config.yml          # 站点总配置
├── index.html           # 首页（layout: home）
├── Gemfile              # Ruby 依赖
│
├── _posts/              # 主博客文章
├── _ai/                 # AI 专题
├── _open/               # 开源相关
├── _books/              # 读书 / 学者系列
├── _life/               # 生活随笔
├── _tutorials/          # 教程
│
├── _tabs/               # 侧边栏导航页
├── _layouts/            # 自定义布局
├── _plugins/            # Jekyll 插件
├── _data/               # 站点数据（contact、share 等）
│
├── assets/              # 静态资源（含 chirpy-static-assets 子模块）
├── pics/                # 头像等图片
├── bin/                 # 构建前脚本
└── .github/workflows/   # CI / CD
```

## 内容组织

### 主文章（`_posts/`）

标准 Jekyll 博文，文件名格式为 `YYYY-MM-DD-title.md`。Front matter 示例：

```yaml
---
layout: post
title: "文章标题"
date: 2020-01-01 12:00:00 +0800
categories: 分类名
tags: 标签名
---
```

`_config.yml` 中为 `posts` 配置了默认选项：评论、目录（TOC）、数学公式（MathJax）、Mermaid 图表等。

### 自定义集合（Collections）

除主博客外，站点通过 Jekyll Collections 划分专题栏目。集合定义见 `_config.yml` 的 `collections` 段，内容与 `_tabs/` 中的导航页一一对应：

| 集合 | 目录 | 侧边栏 Tab | 列表布局 |
|------|------|------------|----------|
| `ai` | `_ai/` | `_tabs/ai.md` | 列表 `custom-collection`；文章 `layout: post`（与主博客一致） |
| `open` | `_open/` | `_tabs/open.md` | `open-layout`（按 `order` 排序的卡片列表） |
| `books` | `_books/` | `_tabs/books.md` | `custom-collection` |
| `life` | `_life/` | `_tabs/life.md` | `custom-collection` |
| `tutorials` | `_tutorials/` | `_tabs/tutorials.md` | `custom-collection` |

此外还有 Chirpy 内置 Tab：`about`、`archives`、`categories`、`tags` 等。

新增一篇集合文章时，在对应 `_<collection>/` 目录下创建 Markdown 文件，并在 front matter 中设置 `title`、`date` 等字段；`open` 集合还可使用 `order` 控制展示顺序。

### 分类与标签

启用 `jekyll-archives` 生成分类、标签归档页。CI 构建前会执行 `bin/lower_tag.sh`，将 `_posts` 与 `_tutorials` 中 `categories:` / `tags:` 行的英文统一为小写，避免归档重复。源文件已统一小写，脚本在 CI 中作为安全网保留。

## 本地开发

### 环境要求

- [Ruby](https://www.ruby-lang.org/)（建议与 CI 一致，当前为 3.2.x）
- [Bundler](https://bundler.io/)
- [Git](https://git-scm.com/)

安装步骤可参考 [Jekyll 官方文档](https://jekyllrb.com/docs/installation/)。Windows 用户需注意 `tzinfo-data`、`wdm` 等 gem（已在 `Gemfile` 中按平台声明）。仓库已提交 `Gemfile.lock`，`bundle install` 将安装与 CI 一致的 gem 版本。

### 克隆与子模块

```console
git clone https://github.com/puppylpg/puppylpg.github.io.git
cd puppylpg.github.io
bundle install
```

若启用 `_config.yml` 中的 `assets.self_host.enabled`，还需初始化静态资源子模块：

```console
git submodule update --init --recursive
```

### 本地快速启动（推荐）

本机未装 Ruby 时，通过 **WSL** 在临时目录构建并启动预览（与 CI 使用同一套 `Gemfile.lock`）。

**Windows（PowerShell，在项目根目录）：**

```console
.\bin\jekyll-dev.ps1 start      # 同步代码 + 启动
.\bin\jekyll-dev.ps1 restart    # 改完文章后重启（会重新同步）
.\bin\jekyll-dev.ps1 stop       # 停止
.\bin\jekyll-dev.ps1 status     # 是否在跑
.\bin\jekyll-dev.ps1 sync       # 只同步 + bundle install，不启动
```

**WSL / Git Bash：**

```console
bin/jekyll-dev.sh start
bin/jekyll-dev.sh restart
bin/jekyll-dev.sh stop
bin/jekyll-dev.sh status
```

浏览器访问 **http://127.0.0.1:4000**（默认端口 `4000`）。日志：`/tmp/puppylpg-build4/.jekyll-dev.log`（WSL 内 `tail -f` 查看）。

| 命令 | 作用 |
|------|------|
| `start` | 将仓库同步到 `/tmp/puppylpg-build4`，按需 `bundle install`，后台启动 `jekyll serve` |
| `restart` | 先 `stop`，再 `start`（改内容后用这个；已安装的 gem 会缓存在 `/tmp/puppylpg-vendor-bundle`） |
| `stop` | 结束本机 4000 端口的 Jekyll |
| `status` | 打印运行状态、PID、日志路径 |
| `sync` | 仅同步与安装依赖（等同旧版 `bin/serve-prep.sh`） |

可选环境变量：`JEKYLL_PORT`（端口）、`JEKYLL_DEV_DIR`（构建目录，默认 `/tmp/puppylpg-build4`）、`JEKYLL_VENDOR_CACHE`（gem 缓存目录，默认 `/tmp/puppylpg-vendor-bundle`）。

首次 `bundle install` 时 `sass-embedded` 会从 GitHub 下载 dart-sass；若超时，请检查 WSL 网络/VPN 后重试。成功后 gem 会写入缓存，后续 `restart` 一般不再重装。

### 已安装 Ruby 时

```console
bundle install
bundle exec jekyll serve
```

本地开发与 CI 行为一致；`bin/clean_toc.sh` / `bin/lower_tag.sh` 仅在 CI 中作为安全网执行，日常不必手动跑。

## 构建与部署

推送到 `main` 或 `master` 分支时，`.github/workflows/pages-deploy.yml` 会自动：

1. 安装 Ruby 依赖（`bundle`）
2. 执行 `bin/lower_tag.sh`、`bin/clean_toc.sh`
3. `bundle exec jekyll build` 生成静态站点
4. `html-proofer` 校验站内链接
5. 部署至 GitHub Pages

本地模拟生产构建：

```console
JEKYLL_ENV=production bundle exec jekyll build
```

## 定制说明

| 路径 | 作用 |
|------|------|
| `_plugins/posts-lastmod-hook.rb` | 根据 Git 历史为 `_posts` 与各内容集合写入 `last_modified_at` |
| `_layouts/custom-collection.html` | 自定义集合的按年归档列表 |
| `_layouts/open-layout.html` | `open` 集合的卡片式列表 |
| `bin/jekyll-dev.sh` / `bin/jekyll-dev.ps1` | 本地 `start` / `stop` / `restart` / `status` / `sync` |
| `bin/lower_tag.sh` | 构建前统一 `_posts`、`_tutorials` 的 tags / categories 大小写 |
| `bin/clean_toc.sh` | 移除 `_posts`、`_tutorials` 首行 `[toc]` 占位（CI 安全网） |
| `bin/serve-prep.sh` | 已弃用，转调 `jekyll-dev.sh sync` |

站点外观、评论、PWA、分页等全局选项在 `_config.yml` 中配置。主题详细用法见 [Chirpy 文档](https://github.com/cotes2020/jekyll-theme-chirpy#documentation)。

## 许可

本项目基于 [MIT](LICENSE) 许可发布。Chirpy 主题遵循其上游许可，详见 [jekyll-theme-chirpy](https://github.com/cotes2020/jekyll-theme-chirpy)。
