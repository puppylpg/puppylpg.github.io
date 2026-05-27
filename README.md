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

### 本地快速启动（macOS，推荐）

仓库根目录直接：

```console
bin/jekyll-dev.sh start      # 后台起 jekyll serve，按需 bundle install
bin/jekyll-dev.sh restart
bin/jekyll-dev.sh stop
bin/jekyll-dev.sh status
```

浏览器访问 **http://127.0.0.1:4000**（默认端口 `4000`）。日志：`/tmp/puppylpg-jekyll.log`。

脚本会优先使用 Homebrew 的 Ruby（`/opt/homebrew/opt/ruby/bin` 或 `/usr/local/opt/ruby/bin`），因为 macOS 系统 Ruby 2.6 自带的 bundler 1.17 与 `Gemfile.lock` 锁定的 2.x 不兼容。如果还没装：`brew install ruby`。

可选环境变量：`JEKYLL_PORT`（端口，默认 4000）。

首次 `bundle install` 时 `sass-embedded` 会从 GitHub 下载 dart-sass；超时请检查网络/代理后重试。

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

### 本地 vs 远端：`git` 与 `gh` 分工

为了让自动化(包括 Claude Code)行为可预期,本仓库约定:

- **本地操作走 `git`**:`git status` / `diff` / `add` / `commit` / `log` / `branch` / `pull` 等只读或只改本地的命令照常用。
- **远端发布走 `gh`,禁止 `git push`**:
  - 直接把改动落到远端 master:`gh api -X PUT repos/puppylpg/puppylpg.github.io/contents/<path> -f message=... -f content=<base64> -f branch=master`
  - 走 PR 流程:`gh pr create`(`gh` 内部代理 push)
  - 触发 / 查看部署:`gh workflow run pages-deploy.yml`、`gh run list --workflow=pages-deploy.yml`

判断口诀:**只读自己机器 → `git`;改远端的状态 → `gh`**。`git pull` / `git fetch` 虽然访问远端但只改本地,所以归 `git`。

## 定制说明

| 路径 | 作用 |
|------|------|
| `_plugins/posts-lastmod-hook.rb` | 根据 Git 历史为 `_posts` 与各内容集合写入 `last_modified_at` |
| `_layouts/custom-collection.html` | 自定义集合的按年归档列表 |
| `_layouts/open-layout.html` | `open` 集合的卡片式列表 |
| `bin/jekyll-dev.sh` | macOS 本地 `start` / `stop` / `restart` / `status` |
| `bin/lower_tag.sh` | 构建前统一 `_posts`、`_tutorials` 的 tags / categories 大小写 |
| `bin/clean_toc.sh` | 移除 `_posts`、`_tutorials` 首行 `[toc]` 占位（CI 安全网） |

站点外观、评论、PWA、分页等全局选项在 `_config.yml` 中配置。主题详细用法见 [Chirpy 文档](https://github.com/cotes2020/jekyll-theme-chirpy#documentation)。

## 许可

本项目基于 [MIT](LICENSE) 许可发布。Chirpy 主题遵循其上游许可，详见 [jekyll-theme-chirpy](https://github.com/cotes2020/jekyll-theme-chirpy)。
