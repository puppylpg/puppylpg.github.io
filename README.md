# puppylpg.github.io

个人技术博客与知识库，基于 [Jekyll](https://jekyllrb.com/) 与 [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) 主题构建，通过 GitHub Actions 部署至 [GitHub Pages](https://puppylpg.github.io)。

## 技术栈

| 项目 | 说明 |
|------|------|
| 静态站点 | Jekyll 4.x |
| 主题 | `jekyll-theme-chirpy` ~7.5 |
| 语言 / 时区 | `zh-CN` / `Asia/Shanghai` |
| 评论 | [Utterances](https://utteranc.es/) |
| 部署 | GitHub Actions → GitHub Pages |

## 目录结构

```
.
├── _config.yml          # 站点总配置
├── Gemfile / Gemfile.lock
├── _posts/              # 主博客文章（Tech：技术原理 / 框架 / 机制）
├── _ai/                 # AI 专题
├── _tutorials/          # 教程
├── _open/               # 开源相关
├── _books/              # 读书 / 学者系列
├── _life/               # 生活随笔 / 日常折腾记录
├── _tabs/               # 侧边栏导航页
├── _layouts/            # 自定义布局
├── _plugins/            # Jekyll 插件
├── assets/              # 静态资源
├── bin/                 # 启动脚本
├── AGENTS.md            # 面向 coding agent 的统一协作规则
├── CLAUDE.md            # Claude Code 兼容入口
├── .agents/             # 项目内 agent skills
├── .claude/             # Claude Code 私有配置
├── Dockerfile           # Docker 多阶段构建
├── docker-compose.yml   # Docker 服务编排
└── .github/workflows/   # CI / CD
```

## 协作文档

本仓库同时保留人类文档和 agent 文档，职责分开维护：

| 文件 | 读者 | 用途 |
|------|------|------|
| `README.md` | 人类开发者 | 项目介绍、本地开发、内容集合、部署方式 |
| `AGENTS.md` | 所有 coding agent | 发文流程、front matter、构建检查、提交约定、项目内 skills |
| `CLAUDE.md` | Claude Code | 兼容入口，指向 `AGENTS.md`，只补充 Claude 专属配置 |

通用项目规范优先维护在 `AGENTS.md`，避免在不同 agent 的私有文件里复制多份规则。

项目内 skill 的真实来源是 `.agents/skills/`；`.claude/skills/` 只保留薄代理文件，让 Claude Code 能自动发现同一批 skill。

## 本地开发

### 方式一：Docker（推荐，跨平台）

需要 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。

```bash
# 构建并启动（首次约 1 分 30 秒）
docker compose up --build -d

# 查看日志 / 停止
docker compose logs -f
docker compose down
```

或使用脚本：

```bash
# Windows
.\bin\jekyll-docker.ps1 start

# Linux / macOS
./bin/jekyll-docker.sh start
```

访问 **http://localhost:4000**。本地修改 Markdown 后，Jekyll 自动重建并刷新浏览器。

修改 `Gemfile` 后需重新构建镜像：

```bash
docker compose up --build -d
```

Dockerfile 默认使用清华 Debian 镜像和 Ruby China gem 源，适合 Windows / 中国大陆环境。海外环境可在构建时覆盖源：

```bash
DEBIAN_MIRROR=deb.debian.org \
DEBIAN_SECURITY_MIRROR=security.debian.org \
GEM_SOURCE=https://rubygems.org/ \
docker compose up --build -d
```
### 方式二：原生 Ruby

需要 Ruby 3.x + Bundler。

```bash
bundle install
bundle exec jekyll serve
```

macOS 用户也可使用辅助脚本：

```bash
bin/jekyll-dev.sh start   # 后台启动
bin/jekyll-dev.sh stop
```

## 内容集合

站点通过 Jekyll Collections 划分专题栏目：

| 集合 | 目录 | 说明 |
|------|------|------|
| `_posts` | `_posts/` | 主博客，Tech：技术原理 / 框架 / 机制 |
| `ai` | `_ai/` | AI 专题 |
| `tutorials` | `_tutorials/` | 教程 |
| `open` | `_open/` | 开源相关 |
| `books` | `_books/` | 读书 / 学者系列 |
| `life` | `_life/` | 生活随笔 / 日常折腾记录 |

新增文章时在对应目录下创建 `YYYY-MM-DD-title.md`，设置 `title`、`date` 等 front matter 即可。

内容归属按文章主语判断：

- `Tech` 放技术原理、框架机制和可复用工程知识，例如 Java、Spring、Redis、Elasticsearch、Docker Engine、Docker network/storage、Linux/网络/SSH 原理、AI 推理机制等。
- `Life` 放个人日常、生活记录和折腾实录。VPS、树莓派、家庭网络、家庭影院/影音下载、代理/V2Ray、Windows 环境排障、系统升级、网络加速等文章，默认归入 `_life/`。
- 如果一篇 Life 文章用到了 Docker、VPS、Linux、network、proxy 等技术，目录仍归 `Life`，但在 `categories` / `tags` 里保留这些主题，例如 `categories: [life, vps, docker]`、`categories: [life, raspberry-pi, docker, homelab]`。
- Docker 本身的原理、网络、存储、镜像机制属于 `Tech`；用 Docker 搭个人服务、升级 VPS、整理家庭影音环境属于 `Life`。

## 项目演进

以下教程记录了本项目的关键技术改造过程：

| 文章 | 核心内容 |
|------|---------|
| [Jekyll 博客的 Ruby 环境](https://puppylpg.github.io/tutorials/2019/11/16/ruby-bundler-jekyll/) | 从 Python/Java 视角理解 Ruby 包管理机制，Bundler 的两层套娃结构，以及 GitHub Pages 两种部署模式的区别 |
| [Chirpy 主题升级指南](https://puppylpg.github.io/tutorials/2026/06/08/chirpy-theme-upgrade-guide/) | 主题从 v6 升级到 v7 的完整记录：breaking changes、本地覆盖文件的正确维护方式、升级后踩的坑及解决方案 |
| [把 Jekyll 博客全站 3D 化](https://puppylpg.github.io/tutorials/2026/06/10/jekyll-blog-3d-cyber-theme/) | Three.js 环形书架图书馆、全站玻璃拟态皮肤、全息阅读面板、3D 翻页过渡、可拖拽标签星球等 12 个文件的深度改造 |
| [Docker 开发环境搭建](https://puppylpg.github.io/tutorials/2026/06/11/docker-jekyll-dev-environment/) | 解决 Jekyll 在 Windows 上的跨平台问题，多阶段构建将镜像体积从 817MB 压缩到 348MB |

## 部署

推送到 `master` 分支自动触发 GitHub Actions 构建并部署至 GitHub Pages。

## 许可

[MIT](LICENSE)
