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

### 安装RubyGems & Jekyll & bundler
接下来的安装就简单了。

根据Jekyll[官方文档](https://jekyllrb.com/docs/installation/other-linux/)，先把Ruby之外的其他必要依赖装上：
```
sudo apt install build-essential zlib1g-dev
```
Gems最好装在自己目录下，所以修改zshrc指定gem home：
```
echo '# Install Ruby Gems to ~/gems' >> ~/.zshrc
echo 'export GEM_HOME="$HOME/gems"' >> ~/.zshrc
echo 'export PATH="$HOME/gems/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

安装gem，jekyll和bundler：
```
gem install jekyll bundler
```
bundler是一个依赖管理器，使用bundler可以保证使用指定版本的依赖，保证了构建的一致性。

参阅：
- https://jekyllrb.com/docs/installation/
- https://jekyllrb.com/docs/installation/ubuntu/

### 创建离线网站
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
- http://www.stephaniehicks.com/githubPages_tutorial/pages/githubpages-jekyll.html

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

