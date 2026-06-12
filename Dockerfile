# 第一阶段：编译环境 —— 装编译工具、编译所有 gem 的原生扩展
FROM ruby:3.3-slim AS builder

# 默认使用国内镜像源，海外环境可在 docker compose build 时通过 build args 覆盖。
ARG DEBIAN_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG DEBIAN_SECURITY_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG GEM_SOURCE=https://gems.ruby-china.com/

RUN sed -i "s/deb.debian.org/${DEBIAN_MIRROR}/g" /etc/apt/sources.list.d/debian.sources && \
    sed -i "s/security.debian.org/${DEBIAN_SECURITY_MIRROR}/g" /etc/apt/sources.list.d/debian.sources

# 安装编译工具（nokogiri、ffi、eventmachine 等 gem 需要编译原生 C 扩展）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

# 直接写配置文件，跳过 gem sources 的网络验证（否则可能卡住 70+ 秒）
RUN printf -- "---\n:sources:\n- %s\n" "${GEM_SOURCE}" > ~/.gemrc

WORKDIR /srv/jekyll

# 先单独复制 Gemfile，利用 Docker 缓存层
COPY Gemfile Gemfile.lock ./

# Gemfile / Gemfile.lock 在仓库中默认指向国内源；构建海外镜像时只改容器内副本。
RUN sed -i "s#https://gems.ruby-china.com/#${GEM_SOURCE}#g; s#https://rubygems.org/#${GEM_SOURCE}#g" Gemfile Gemfile.lock

# 从 Gemfile.lock 动态读取 BUNDLED WITH 版本并安装对应 Bundler
RUN BUNDLER_VERSION=$(grep -A1 "BUNDLED WITH" Gemfile.lock | tail -n1 | tr -d ' ') && \
    gem install bundler -v "$BUNDLER_VERSION"

RUN bundle install

# 第二阶段：运行时环境 —— 只保留运行时需要的库，编译工具全部丢弃
FROM ruby:3.3-slim

ARG DEBIAN_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG DEBIAN_SECURITY_MIRROR=mirrors.tuna.tsinghua.edu.cn

RUN sed -i "s/deb.debian.org/${DEBIAN_MIRROR}/g" /etc/apt/sources.list.d/debian.sources && \
    sed -i "s/security.debian.org/${DEBIAN_SECURITY_MIRROR}/g" /etc/apt/sources.list.d/debian.sources

# 只安装运行时库（nokogiri 编译出的原生扩展动态链接了 libxml2 / libxslt）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

# 从 builder 阶段复制 gem 源配置、bundler 和所有已编译的 gem
COPY --from=builder /root/.gemrc /root/.gemrc
COPY --from=builder /usr/local/bundle /usr/local/bundle

WORKDIR /srv/jekyll

EXPOSE 4000 35729

CMD ["bundle", "exec", "jekyll", "serve", "--host", "0.0.0.0", "--livereload"]
