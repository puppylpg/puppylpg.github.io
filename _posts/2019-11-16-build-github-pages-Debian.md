---
layout: post
title: "Jekyll：GitHub Pages"
date: 2019-11-16 16:13:19 +0800
categories: [Jekyll]
tags: [Jekyll]
---

使用Github搭建[个人网站](https://puppylpg.github.io)，是一件很炫酷的事情。以后有什么所思所学都可以发布在自己的网站上，很是方便。（同时为了丰富网站的内容，还会经常不自觉地开始学习:D，简直是进步神器~）。

> 最重要的是，这一切还不用自己花钱买服务器 :D

1. Table of Contents, ordered                    
{:toc}

# 搭建流程
在github上搭建个人站总共分为两步：
1. 使用Jekyll搭建本地离线网站；
2. 推送到github同名仓库。

# Jekyll搭建本地网站
使用Jekyll搭建本地网站需要安装Ruby，RubyGems，然后使用gem安装Jekyll。

## 安装Ruby
Jekyll需要Ruby版本不小于2.4.0，我用的是Debian 9 (stretch)，官方仓库的最新版Ruby只更新到2.3.3：
```
> apt show ruby
Package: ruby
Version: 1:2.3.3 
```
所以不能直接从官方仓库装。步骤就变得麻烦一些。如果用的Debian更高版本，也许直接`apt install ruby`就可以了。

安装Ruby的方法很多，根据[官方教程](https://www.ruby-lang.org/en/documentation/installation/)，我选择了使用`rbenv`。rbenv可以同时安装多个版本的Ruby，并可以自由选择使用的版本。

首先安装一些必要工具：
```
sudo apt update
sudo apt install git curl libssl-dev libreadline-dev zlib1g-dev autoconf bison build-essential libyaml-dev libreadline-dev libncurses5-dev libffi-dev libgdbm-dev
```
然后安装rbenv：
```
curl -sL https://github.com/rbenv/rbenv-installer/raw/master/bin/rbenv-installer | bash -
```
会报错`Checking for 'rbenv' in PATH: not found`，问题不大。

那接下来就把rbenv加入`$PATH`，我用的是zsh，所以：
```bash
echo 'export PATH="$HOME/.rbenv/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(rbenv init -)"' >> ~/.zshrc
source ~/.zshrc
```

终于可以安装ruby了，Ruby现在已经到2.6.+了，那就装个2.6.0吧：
```
rbenv install 2.6.0
```
rbenv貌似是从源码编译安装的，所以整个过程会比较慢。而且编译安装过程中console没有任何提示，导致我以为卡死了，强制终结安装之后它才告诉我在/tmp下有编译的log。

所以我又重新装了一下，这次看着log装的，心里就有谱了：
```
> tailf /tmp/ruby-build.20191116003640.18211.log 
```
log文件名是`/tmp/ruby-xxx`，后面的文件名未必就是上面的时间戳，但是在/tmp下很好找到该log。

log的内容就是整个编译流程的输出。编译完成后，Ruby就装好了。

接下来把该Ruby设为默认Ruby：
```
rbenv global 2.6.0
```
查看Ruby版本：
```
> ruby -v
ruby 2.6.0p0 (2018-12-25 revision 66547) [x86_64-linux]
```
参阅：
- https://www.ruby-lang.org/en/documentation/installation/
- https://linuxize.com/post/how-to-install-ruby-on-debian-9/

### 几个概念
以Java和Python类比Ruby中的几个概念：
- ruby: java
- [`gem`](https://rubygems.org/pages/download)：RubyGems，类似`pip`，安装好ruby后，自带`gem`指令，用来安装Gems
- [Gems](https://jekyllrb.com/docs/ruby-101/#gems): jar包，可复用的第三方依赖
    - jekyll: 一个gem，用于快速初始化一个静态网站
    - bundler: 一个gem，用于管理Gems依赖
- `Gemfile`：类似`pom.xml`，用来声明所需要的依赖。
- `bundle`：类似`mvn`。安装完bundler后，可以使用`bundle`命令安装`Gemfile`里声明的依赖，安装位置为`./vendor/bundle`
- `Gemfile.lock`：**在执行完`bundle install`命令安装依赖之后，会自动生成`Gemfile.lock`**，相当于版本号都确定的第三方依赖集合

大概因为Gemfile里指定的依赖不像pom里是确定的版本。Gemfile里的gems可以不指定版本，或者指定某一范围的版本，所以需要在第一次的时候生成一个Gemfile.lock，以确保后续都用同一个版本。

> `Gemfile.lock`是一个Gemfile的**锁定版本**，它记录了在当前项目中使用的每个gem的确切版本以及其所有依赖项的确切版本。它的目的是确保在不同机器或团队成员之间的开发和部署过程中，使用的gem版本保持一致，以避免由于不同环境导致的依赖关系冲突和应用程序崩溃。

> [`RubyGems` aka `gem`](https://rubygems.org/pages/download)本身就是依赖管理器。我们使用它安装了bundler，然后使用bundler配合本工程的Gemfile，完成工程依赖的管理。

## 安装Jekyll & bundler
安装好ruby之后，需要安装本次需要的两个gem：管理依赖的bundler和生成静态网站的jekyll。

根据Jekyll[官方文档](https://jekyllrb.com/docs/installation/other-linux/)，在Debian上把Ruby之外的其他必要依赖装上（刚刚ruby已经手动装过了）：
```
sudo apt install build-essential
```

[jekyll官方建议](https://jekyllrb.com/docs/installation/ubuntu/)，Ruby的各种gem最好不要全局安装。实际上确实如此，毕竟Java的jar包我们也不是全局安装，每个项目都可能有自己的版本。

所以按照官方建议，我们指定`~/gems`为ruby gems的安装目录（`GEM_HOME`）：
```bash
echo '# Install Ruby Gems to ~/gems' >> ~/.zshrc
echo 'export GEM_HOME="$HOME/gems"' >> ~/.zshrc
echo 'export PATH="$HOME/gems/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

最后把jekyll和bundler这两个gem装一下：
```
gem install jekyll bundler
```

### gem国内源
gem的官方源太慢，替换成国内源：
```bash
$ gem sources --remove https://rubygems.org/
$ gem sources -a https://gems.ruby-china.com/
$ gem sources -l
```

> 下面的bundler也需要做源替换。

## 离线网站搭建

### 初始化
首先使用jekyll新创建一个站点：
```bash
$ jekyll new --skip-bundle .
# Creates a Jekyll site in the current directory
```
会生成一个Gemfile。这里的Gemfile使用的是本地的jekyll版本。

使用Jekyll创建网站本身是很简单的。但是，这样创建出来的工程大概率和GitHub当前使用的Jekyll等依赖的版本是不同的。本地网站调试出来的效果，上传到GitHub之后很可能截然不同。

所以我们参考[github pages的搭建流程](https://docs.github.com/zh/pages/setting-up-a-github-pages-site-with-jekyll/creating-a-github-pages-site-with-jekyll)，**使用和它相同版本的依赖**。

我们要把Gemfile里的gem依赖和jekyll版本改一下：
1. 打开 Jekyll 创建的 Gemfile 文件。将“#”添加到以 gem "jekyll" 开头的行首，以注释禁止此行。
2. 编辑以 `# gem "github-pages"` 开头的行，以添加 `github-pages` gem。 将此行更改为：`gem "github-pages", "~> GITHUB-PAGES-VERSION", group: :jekyll_plugins`。其中`GITHUB-PAGES-VERSION`需要替换为[github pages所支持的 `github-pages` gem 的最新版本](https://pages.github.com/versions/)。

> 当前版本是228。

### 安装依赖
然后使用bundler根据Gemfile构建完整的依赖版本：
```bash
$ bundle install
```
会生成Gemfile.lock，里面的依赖版本和[GitHub Pages Dependency](https://pages.github.com/versions/)版本是一致的。

> 这些依赖都会被安装到`./vendor/bundle`下。

**bundle默认是用的源写在Gemfile第一行**，是`source "https://rubygems.org"`，同样需要改成国内源`source "https://gems.ruby-china.com/"`。

### 构建网站
之后就可以使用jekyll构建网站了。当然，这里的jekyll用的是安装在`./vendor/bundle`下的jekyll，而不是我们原本装的jekyll：
```
$ bundle exec jekyll serve
```

> 不推荐直接用默认的jekyll运行：`jekyll serve`。

然后就可以打开 http://localhost:4000 浏览已经构建的网站了。

上述流程中，有两个东西我们只用了一次：
1. `gem`指令：安装完bundler，就不再用它安装gems了；
2. 我们一开始（通过`gem`指令）本地安装的jekyll：创建完Gemfile，我们就不用它了。后面用到的jekyll，都是使用bundler安装到`./vendor/bundle`下的jekyll；

# 上传到github
这里依然参考[GitHub Pages](https://help.github.com/en/github/working-with-github-pages/creating-a-github-pages-site-with-jekyll)。

1. 在自己的github账户下创建同名repo，比如puppylpg.github.io；
2. 将刚刚的myblog文件夹初始化为git仓库：`git init`；
3. 关联GitHub远程库，比如我的就是：`git add remote origin git@github.com:puppylpg/puppylpg.github.io.git`；
4. 推送到GitHub：`git push -u origin master`；

然后打开 https://puppylpg.github.io/ 就可以看到和刚刚离线网站一样的个人网站了。（GitHub官方说可能有延迟，最多20min，但是我上传完就可以打开了）。

GitHub默认用master分支，repo的根目录，上述repo就是这种结构，所以就不需要进行额外设置了。


