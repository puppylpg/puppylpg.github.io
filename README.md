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
├── _posts/              # 主博客文章（Tech）
├── _ai/                 # AI 专题
├── _tutorials/          # 教程
├── _open/               # 开源相关
├── _books/              # 读书 / 学者系列
├── _life/               # 生活随笔
├── _tabs/               # 侧边栏导航页
├── _layouts/            # 自定义布局
├── _plugins/            # Jekyll 插件
├── assets/              # 静态资源
├── bin/                 # 启动脚本
├── Dockerfile           # Docker 多阶段构建
├── docker-compose.yml   # Docker 服务编排
└── .github/workflows/   # CI / CD
```

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
| `_posts` | `_posts/` | 主博客，Tech 分类 |
| `ai` | `_ai/` | AI 专题 |
| `tutorials` | `_tutorials/` | 教程 |
| `open` | `_open/` | 开源相关 |
| `books` | `_books/` | 读书 / 学者系列 |
| `life` | `_life/` | 生活随笔 |

新增文章时在对应目录下创建 `YYYY-MM-DD-title.md`，设置 `title`、`date` 等 front matter 即可。

## 部署

推送到 `master` 分支自动触发 GitHub Actions 构建并部署至 GitHub Pages。

## 许可

[MIT](LICENSE)
