---
layout: post
title: "搭建个人GitHub Pages（Debian 9 Stretch）"
date: 2019-11-16 16:13:19 +0800
categories: [op, Jekyll]
tags: [op, Jekyll]
---

使用github搭建个人站，比如https://puppylpg.github.io，是一件很炫酷的事情。而且不用自己花钱买服务器，我还能说什么好，只能叫一声GitHub爸爸。

1. Table of Contents, ordered                    
{:toc}

# 搭建流程
在github上搭建个人站总共分为两步：
1. 使用Jekyll搭建本地离线网站；
2. 推送到github同名仓库。

## Jekyll搭建本地网站
使用Jekyll搭建本地网站需要安装Ruby，RubyGems，然后使用gem安装Jekyll。

### 安装Ruby
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
```
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

### 安装Jekyll & bundler
接下来的安装就简单了。

根据Jekyll[官方文档](https://jekyllrb.com/docs/installation/other-linux/)，先把Ruby之外的其他必要依赖装上：
```
sudo apt install build-essential zlib1g-dev
```

Ruby的各种gem最好装在自己目录下，所以修改zshrc指定gem home：
```
echo '# Install Ruby Gems to ~/gems' >> ~/.zshrc
echo 'export GEM_HOME="$HOME/gems"' >> ~/.zshrc
echo 'export PATH="$HOME/gems/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

安装jekyll和bundler这两个gem：
```
gem install jekyll bundler
```

参阅：
- https://jekyllrb.com/docs/installation/
- https://jekyllrb.com/docs/installation/ubuntu/

### 关于Ruby，Gem，Jekyll，Bundler
一个gem可以理解为Ruby工程的一个第三方依赖。使用`gem`命令安装一些gem之后，就可以使用该gem的功能。

Jekyll和Bundler都是gem：
- Jekyll的功能是快速初始化一个离线网站，让我们有了一套渐变构建网站的框架；
- Bundler的功能是充当一个依赖管理器，让我们使用工程中`Gemfile`指定的版本的gem，保证工程构建的一致性。

> [`RubyGems`](https://rubygems.org/pages/download)本身就是依赖管理器。我们使用它安装了bundler，然后使用bundler配合本工程的Gemfile，完成本工程依赖的管理。（猜测：bundler也许内部调用了RubyGems下载依赖，然后自己对依赖进行管理）

比如我们电脑上都装有Jekyll，但是版本不同。那么对于同一个工程，你用Jekyll启动之后的样子，跟我用Jekyll启动之后长得不一样。版本的不同会让人很难协同。但是有了Bundler，不管我们电脑上装的是哪个版本的Jekyll，使用该工程的时候，就会按照该工程指定版本的Jekyll构建该工程。（如果没有该版本Jekyll，会先下载）那工程启动之后，我们看到的效果是一致的。

`Gemfile`，就是记录工程使用的各个gem及其对应版本。

参阅：
- https://jekyllrb.com/docs/ruby-101/

### ~~创建离线网站~~ @Deprecated
> 使用Jekyll创建网站本身是很简单的。但是，这样创建出来的工程大概率和GitHub当前使用的Jekyll等依赖的版本是不同的。本地网站调试出来的效果，上传到GitHub之后很可能截然不同。
>
> **所以大家千万别按照这个步骤创建工程。浏览一下知道Jekyll创建网站的流程即可。**

使用Jekyll创建离线网站：
```
jekyll new myblog
```
启动网站：
```
cd myblog
bundle exec jekyll serve
```
这里使用bundle的目的是保证使用myblog下Gemfile指定的所有gem versions，保证了构建的一致性。如果不用Gemfile，直接用默认的jekyll运行即可（不推荐）：
```
jekyll serve
```
然后就可以打开 http://localhost:4000 浏览已经构建的网站了。

参阅：
- https://jekyllrb.com/docs/
- ~~http://www.stephaniehicks.com/githubPages_tutorial/pages/githubpages-jekyll.html~~

### 创建和GitHub使用的依赖完全相同版本的离线网站
首先，使用和GitHub相同版本的Jekyll创建网站。GitHub使用的Jekyll版本可以在[GitHub Pages Dependency](https://pages.github.com/versions/)查询，当前使用的是Jekyll 3.8.5。

我们可以使用gem安装Jekyll 3.8.5到机器上，但是还有一种更好的方法：**将所有需要的gem（包括Jekyll）都使用bundler安装到工程内部。** 这样当不同的工程需要安装不同版本的gem时，他们的安装路径都是隔绝的（隔绝在自己的工程下），所以能更好地避免冲突。

想使用bundler，首先要初始化bundler，生成一个Gemfile：
```
mkdir my-jekyll-website
cd my-jekyll-website
bundle init
```
当前还没有引入任何gem，所以Gemfile没有指定任何gem：
```
$ cat Gemfile
# frozen_string_literal: true

source "https://rubygems.org"

git_source(:github) {|repo_name| "https://github.com/#{repo_name}" }

# gem "rails"
```

接着指定bundler的行为，安装gem到本工程下的vendor/bundle目录：
```
bundle install --path vendor/bundle
```
此时可以看到该工程下bundler的配置文件：
```
$ cat .bundle/config
---
BUNDLE_PATH: "vendor/bundle" 
```

接着安装GitHub同款3.8.5 Jekyll（所以本地可以不安装Jekyll，在这一步将特定版本的Jekyll装到工程内部即可）：
```
bundle add jekyll -v 3.8.5
```
如果观察工程的Gemfile，可以看到现在里面加上了3.8.5版本的Jekyll：
```
$ cat Gemfile
# frozen_string_literal: true

source "https://rubygems.org"

git_source(:github) {|repo_name| "https://github.com/#{repo_name}" }

# gem "rails"

gem "jekyll", "= 3.8.5"
```
现在使用该版本的Jekyll创建工程：
```
bundle exec jekyll new --force --skip-bundle .
bundle install
```
> Tips 1: Jekyll创建工程的语法是`jekyll new <folder>`，这里我们通过bundler使用Gemfile里指定的Jekyll，所以必须加上`bundle exec`。
> 
> Tips 2: jekyll默认只能在空文件夹下创建工程。但是我们已经init过bundler了，所以有bundler的一些配置和Gemfile，所以使用`--force`选项。

现在工程已经初始化好了。Jekyll初始化网站的过程中也用到了很多其他的依赖，所以现在的Gemfile丰富了很多：
```
$ cat Gemfile
source "https://rubygems.org"

# Hello! This is where you manage which Jekyll version is used to run.
# When you want to use a different version, change it below, save the
# file and run `bundle install`. Run Jekyll with `bundle exec`, like so:
#
#     bundle exec jekyll serve
#
# This will help ensure the proper Jekyll version is running.
# Happy Jekylling!
gem "jekyll", "~> 3.8.5"

# This is the default theme for new Jekyll sites. You may change this to anything you like.
gem "minima", "~> 2.0"

# If you want to use GitHub Pages, remove the "gem "jekyll"" above and
# uncomment the line below. To upgrade, run `bundle update github-pages`.
# gem "github-pages", group: :jekyll_plugins

# If you have any plugins, put them here!
group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.6"
end

# Windows does not include zoneinfo files, so bundle the tzinfo-data gem
gem "tzinfo-data", platforms: [:mingw, :mswin, :x64_mingw, :jruby]

# Performance-booster for watching directories on Windows
gem "wdm", "~> 0.1.0" if Gem.win_platform?
```
比如引入了Jekyll网站的默认主题minima 2.0。

但是，这些用到的依赖并不是GitHub使用的依赖。根据Gemfile里的提示，如果我们想把网站传到GitHub上，最好使用和GitHub完全相同的依赖。使用的方式是，注释掉Gemfile中的Jekyll gem，开启`github-pages`这个gem：
```
# If you want to use GitHub Pages, remove the "gem "jekyll"" above and
# uncomment the line below. To upgrade, run `bundle update github-pages`.
# gem "github-pages", group: :jekyll_plugins
```
按照提示修改完之后，我们安装一个`gethub-pages`这个gem：
```
bundle install
```
这样所有安装的gem就全都和GitHub Pages使用的完全相同了。

可以看到主题minima安装的位置和版本：
```
$ ls vendor/bundle/ruby/2.6.0/gems/minima-2.5.0
assets  _includes  _layouts  LICENSE.txt  README.md  _sass
```
安装的是2.5.0，位置就是我们通过bundle指定的`vendor/bundle`。

一切安装完毕。想看效果，使用Gemfile指定的Jekyll启动工程：
```
bundle exec jekyll serve
```
然后就可以在 127.0.0.1:4000 查看效果了。

参阅：
- https://jekyllrb.com/tutorials/using-jekyll-with-bundler/
- https://bundler.io/man/bundle-add.1.html
- https://help.github.com/en/github/working-with-github-pages/creating-a-github-pages-site-with-jekyll
- https://github.com/github/pages-gem
- https://bundler.io/v2.0/bundle_install.html

## 上传到github
这里可以参考[GitHub Pages](https://help.github.com/en/github/working-with-github-pages/creating-a-github-pages-site-with-jekyll)。


1. 在自己的github账户下创建同名repo，比如puppylpg.github.io；
2. 将刚刚的myblog文件夹初始化为git仓库：`git init`；
3. 关联GitHub远程库，比如我的就是：`git add remote origin git@github.com:puppylpg/puppylpg.github.io.git`；
4. 推送到GitHub：`git push -u origin master`；

然后打开 https://puppylpg.github.io/ 就可以看到和刚刚离线网站一样的个人网站了。（GitHub官方说可能有延迟，最多20min，但是我上传完就可以打开了）。

GitHub默认用master分支，repo的根目录，上述repo就是这种结构，所以就不需要进行额外设置了。

参阅：
- https://help.github.com/en/github/working-with-github-pages/setting-up-a-github-pages-site-with-jekyll

