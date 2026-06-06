# Ruby 环境与博客启动指南

本文档解释这个 Jekyll 博客项目的技术架构，以及如何本地启动。

## Ruby 与 Python 概念对应

| Python | Ruby | 说明 |
|--------|------|------|
| `pip` | **gem** | 包本身（一个 gem = 一个 Python 包） |
| `pip` / pipenv | **Bundler** | 依赖管理工具 |
| `requirements.txt` | **Gemfile** | 声明要哪些 gem + 版本约束 |
| `Pipfile.lock` | **Gemfile.lock** | 锁定精确版本，确保团队一致 |
| `pip install` | `bundle install` | 根据 Gemfile 安装依赖 |
| `pipenv shell` | `bundle exec` | 在当前环境中运行命令 |

## 技术栈架构

```
博客源码 ──→ Jekyll ──→ 静态 HTML ──→ GitHub Pages 托管
   ↓
_posts/*.md   （你的博文，Markdown 格式）
_config.yml   （站点配置）
Gemfile       （声明依赖：jekyll-theme-chirpy 等）
```

- **Jekyll**: 静态站点生成器，把 Markdown 转成 HTML
- **Ruby**: Jekyll 用 Ruby 写的运行环境
- **Bundler**: 管理 Jekyll 及其依赖 gem，版本由 `Gemfile.lock` 末尾 `BUNDLED WITH` 字段决定，`ruby/setup-ruby` action 会自动读取并安装对应版本
- **Chirpy**: Jekyll 主题 gem，提供博客布局/样式/JS

## 启动方式

### 方式一：项目脚本（推荐 macOS + Homebrew Ruby）

```bash
bin/jekyll-dev.sh start
bin/jekyll-dev.sh restart
bin/jekyll-dev.sh stop
```

### 方式二：直接用 Bundler

```bash
# 安装依赖
bundle install

# 启动本地服务器（默认 http://localhost:4000）
bundle exec jekyll serve

# 生产构建（对标 CI 环境）
JEKYLL_ENV=production bundle exec jekyll build
```

## GitHub Pages 的两种部署模式

GitHub Pages 支持两种工作方式，行为完全不同：

### 模式一：GitHub Pages 默认构建（本博客不用这种）

```
你 push 代码 → GitHub Pages 用自己的 Jekyll 构建 → 发布
```

这种模式下，Jekyll 版本由 GitHub 锁定（目前是 3.10.0），插件只能用[白名单](https://pages.github.com/versions/)里的。
你的 Gemfile 里的版本约束**会被忽略**。

### 模式二：GitHub Actions 自定义构建（本博客用这种）

```
你 push 代码 → GitHub Actions 跑 pages-deploy.yml → 用 Gemfile 里的 Jekyll 构建 → 把 _site 静态文件交给 GitHub Pages → 发布
```

这种模式下，GitHub Pages 只做**静态文件托管**，不参与构建。
Jekyll 版本、插件完全由你的 `Gemfile` 控制。

本博客走的是模式二（`.github/workflows/pages-deploy.yml`），所以：

- Jekyll 版本 = `Gemfile.lock` 里锁定的（目前是 **4.4.1**）
- Ruby 版本 = workflow 里 `ruby-version` 指定的（目前是 **4.0**）
- `pages.github.com/versions/` 那个页面对本博客**无关**

## 本地与 CI 对齐

### gem 版本对齐

只需要：

```bash
bundle install   # 按 Gemfile.lock 安装，和 CI 完全一致
```

### Ruby 版本对齐

本地 Ruby 版本不需要和 CI 完全一致，只要所有 gem 都兼容即可。CI 用的是 Ruby 4.0。

如果出现 gem 不兼容的问题，用 rbenv 切换版本：

```bash
# 安装 rbenv（如果没有）
brew install rbenv ruby-build

# 写入 shell 配置
echo 'export PATH="$HOME/.rbenv/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(rbenv init - zsh)"' >> ~/.zshrc
source ~/.zshrc

# 安装指定版本（用国内镜像加速）
export RUBY_BUILD_MIRROR_URL=https://cache.ruby-china.com/
rbenv install 4.0.5
rbenv local 4.0.5  # 在项目目录生效
```

### gem 源

Gemfile 已配置国内镜像源（`gems.ruby-china.com`），`bundle install` 速度正常。

系统级 gem 命令也建议切换：

```bash
gem sources --add https://gems.ruby-china.com/ --remove https://rubygems.org/
```

### nokogiri 编译问题

nokogiri 有 native extension，在某些环境下编译 libxml2 可能失败。用系统自带库绕过：

```bash
bundle config set --local build.nokogiri "--use-system-libraries"
bundle install
```

## gem 兼容性注意事项

升级 Ruby 大版本时需要关注 gem 的 Ruby 版本约束，尤其是：

- **有 native extension 的 gem**（nokogiri、ffi、sass-embedded 等）：包含 C 代码，需要针对 Ruby 版本重新编译，但通常不限制版本范围
- **明确限制 Ruby 版本的 gem**：如 html-proofer 4.x 要求 `< 4.0`，升级到 Ruby 4.0 时必须同步升级到 html-proofer 5.x

查看某个 gem 的 Ruby 版本要求：

```bash
gem specification --remote <gem名> -v <版本> | grep -A8 required_ruby_version
```

## 常见问题

### Q: `bundle exec jekyll serve` 报错找不到 gem

A: 运行 `bundle install` 安装依赖。

### Q: `cannot load such file -- bundler`

A: Ruby 版本切换后 bundler 需要重新安装：
```bash
gem install bundler:$(grep -A1 "BUNDLED WITH" Gemfile.lock | tail -1 | tr -d ' ')
bundle install
```

### Q: 本地跑没问题，推到 GitHub 报错

A: 查看 Actions 日志定位问题：
```bash
gh run list --workflow=pages-deploy.yml
gh run view <id> --log-failed
```

## 参考

- Jekyll 文档：https://jekyllrb.com/
- Chirpy 主题：https://github.com/cotes2020/jekyll-theme-chirpy
- GitHub Pages 依赖版本（模式一适用）：https://pages.github.com/versions/
- Ruby 中国镜像：https://gems.ruby-china.com/
