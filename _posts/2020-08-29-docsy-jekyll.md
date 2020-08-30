---
layout: post
title: "docsy-jekyll"
date: 2020-08-29 00:48:00 +0800
categories: Jekyll
tags: Jekyll
---

之前利用github pages提供的便利，使用jekyll创建了个人静态网站：
- [搭建个人GitHub Pages（Debian 9 Stretch）]({% post_url 2019-11-16-build-github-pages-Debian %})
- [探索Jekyll静态网站结构]({% post_url 2019-11-17-Jekyll-website %})
- [minima主题拓展]({% post_url 2019-11-23-minima-costumize %})

jekyll的默认主题是minima，一个看起来十分干净整洁的主题。从学习的角度来讲，由于没有花里胡哨的组件，minima挺适合学习前端或者jekyll。

但是minima使用的时候，也有一些不是很方便的地方，比如：
- 页面元素过少，缺乏tag页等；
- 无法检索；
- 没有sidebar，不能在浏览博客的同时关注整篇文章的结构；

对于一个博客系统来讲，相当不方便。

在页面内容展示上，minima似乎也有不小的问题：
- 各级子标题的字号有些混乱，二级标题比一级标题还大；
- 引用语句显示的很奇怪；

虽然渲染英文短文看起来很整洁，但是在中文博客上的呈现很多方面看起来都不是很舒服。

![](/assets/screenshots/jekyll/minima_toc.png )
![](/assets/screenshots/jekyll/minima_content.png )
![](/assets/screenshots/jekyll/minima_code.png )

docsy-jekyll则更像一个成熟的网站：

![](/assets/screenshots/jekyll/docsy_toc.png )
![](/assets/screenshots/jekyll/docsy_content.png )
![](/assets/screenshots/jekyll/docsy_code.png )

页面渲染的很好看，sidebar能看试试导航目录，支持站内检索，这些优势带来的便利令人很难拒绝。

# 结构
关于jekyll工程的structure，可以参考：https://jekyllrb.com/docs/structure/

- assets：一个普通的放资源的目录；
- `_data`：分类放置变量；
- `_docs`：自定义的collection；
- `_include`：网页的组件，用于被引用，类似程序的函数；
- `_layouts`：网页模板；
- `pages`：自定义的放置page的目录；
- `_posts`：放置post，jekyll官方定义的collection；
- `_site`：放置编译后的整个静态网站的内容；
- `vendor`：自定义的安装gem的文件夹；

## `_data` - Jekyll Data Files
`_data`是用来指定变量的，这样就不用把所有的变量都放在`_config.yml`里。

- https://jekyllrb.com/docs/datafiles/

## `_layouts` `_include`
`_layouts`是页面模板，会引用`_include`里的内容，比如header/footer/sidebar等。

## `_docs` - Jekyll Collection
`docs`是根据jekyll collection自定义的类型，`_docs`是其对应的目录。

> Create a corresponding folder (e.g. `<source>/_staff_members`) and add documents.

in `_config.yml`:
```
# Collections
collections:
  docs:
    output: true
    permalink: /:collection/:path
```

`_docs`下没有Front Matter的文件会被当成static file，内容不会被处理：
> Front matter is processed if the front matter exists, and everything after the front matter is pushed into the document’s content attribute. If no front matter is provided, Jekyll will consider it to be a static file and the contents will not undergo further processing. If front matter is provided, Jekyll will process the file contents into the expected output.

除非定义collection的时候，设置了`output: true`的属性：
> Regardless of whether front matter exists or not, Jekyll will write to the destination directory (e.g. `_site`) only if output: true has been set in the collection’s metadata.

post由于是Jekyll内定的collection，不受上述之约，有没有设置output都会被处理：
> Do note that in spite of being considered as a collection internally, the above doesn’t apply to posts. Posts with a valid filename format will be marked for processing even if they do not contain front matter.

- https://jekyllrb.com/docs/collections/

## `pages`/`posts`/`drafts` - 三个Jekyll默认的Collection
`pages`是最基础的内容，**工程里的任何html页面、markdown文件**（会被转成html）都会成为一个独立的页面，**url就是它的路径名。如果是markdown文件，可以在Front Matter里通过permalink指定其url**。（其实就是编译成html后放在url指定的位置）

> `pages`不需要像`posts`、`drafts`一样有预定义好的`_posts`和`_drafts`文件夹，因为工程下所有的html/markdown都属于`pages`。

这里docsy-jekyll使用了一个独立的pages文件夹来统一放置page。当然这个文件夹取任何名字都行（因为**工程里的任何html页面**都是page）。
```
pichu@Archer ~/Codes/jekyll/puppylpg.github.io (master*) $ cat pages/about.md 
---
title: About
permalink: /about/
---

# About

This is a [starter template](https://vsoch.github.com/docsy-jekyll/) for a Docsy jekyll theme, based
...
```
这里使用permalink指定了url为about，否则就是它的路径pages/about。

- https://jekyllrb.com/docs/pages/

`_posts`和`_drafts`是`posts`和`drafts`对应的文件夹。

> In addition to any collections you create yourself, the posts collection is hard-coded into Jekyll. It exists whether you have a _posts directory or not. This is something to note when iterating through site.collections as you may need to filter it out.

> You may wish to use filters to find your collection: {{ site.collections | where: "label", "myCollection" | first }}

- https://jekyllrb.com/docs/posts/

## `_site`
`_site`是编译后的目录

## `vendor`
`vendor`是bundler自定义的安装gem的地方。

## config defaults
```
# Defaults
defaults:
  - scope:
      path: "_docs"
      type: "docs"
    values:
      layout: page
  -
    scope:
      path: ""
      type: "pages"
    values:
      layout: "page"
  -
    scope:
      path: "_posts"
      type: "posts"
    values:
      layout: "post"
```
- scope：对谁设定defaults；
    + path：限定文件的目录，空字符串代表整个工程。必填；
    + type：限定文件的类型，`pages`/`posts`/`drafts`或者其他collection。可选；
- values：给符合的文件添加哪些Front Matter属性；

> layout page和collection pages之间并没有什么关系，我们只是配置对所有的pages都应用page layout，仅此而已。

- https://jekyllrb.com/docs/configuration/
- https://jekyllrb.com/docs/configuration/options/
- https://jekyllrb.com/docs/configuration/front-matter-defaults/

## Gemfile
其实有用的就一行：
```
source "https://rubygems.org"
ruby RUBY_VERSION

# Hello! This is where you manage which Jekyll version is used to run.
# When you want to use a different version, change it below, save the
# file and run `bundle install`. Run Jekyll with `bundle exec`, like so:
#
#     bundle exec jekyll serve
#
# This will help ensure the proper Jekyll version is running.
# Happy Jekylling!
# gem "jekyll", "3.2.1"

# This is the default theme for new Jekyll sites. You may change this to anything you like.
# gem "minima"

# If you want to use GitHub Pages, remove the "gem "jekyll"" above and
# uncomment the line below. To upgrade, run `bundle update github-pages`.
gem "github-pages", group: :jekyll_plugins

# If you have any plugins, put them here!
# group :jekyll_plugins do
#   gem "jekyll-github-metadata", "~> 1.0"
# end
```
引入github-pages这一个gem就好了，它已经组装好各种所需要的依赖了，而且当github pages更新依赖之后，本地`bundle update`一下同步一下最新版的gem就行了，非常方便。

**所以使用jekyll搭建一个网站特别简单：安装好ruby和bundler，创建一个这样的Gemfile就行了……**

> 之前搭建jekyll网站的时候折腾了一大圈，折腾的是个啥……

# 部署
## 获取docsy-jekyll
可以直接clone，然后把之前自己的`_post`挪过来。但是我想保留之前的git提交记录，所以把docsy-jekyll里需要的文件拷到了我的工程里。

## 安装gem
我倾向于把gem安装在本目录下（记得gitignore一下）：
```
bundle install --path vendor/bundle
```

## 启动
```
bundle exec jekyll serve --port 4444
```

# jquery
- https://github.com/vsoch/docsy-jekyll/issues/25

现象：直观表现就是网页加载很慢，且搜索和toc组件都不存在。

> 打开控制台，查看network，发现是js没有加载成功。前端问题多使用开发者工具debug。

原因：网页引用了jquery：https://code.jquery.com/jquery-3.3.1.min.js，但是在中国该网址直连不了。所以我下载了jquery（两个js文件），直接引用本地的jquery就行了：
1. 下载jquery，上传到`assets/js`：即`assets/js/jquery-3.3.1/jquery-3.3.1.js`和`assets/js/jquery-3.3.1/jquery-3.3.1.min.js`；
2. 查找使用了jquery的地方`grep -r "https://code.jquery.com/jquery-3.3.1.min.js" . --exclude-dir=_site`：发现只有`_include/head.html`和`_include/toc.html`用了；
3. 替换为引用本地的jquery：修改`src="https://code.jquery.com/jquery-3.3.1.min.js"`为{% raw%}`src="{{ site.baseurl }}/assets/js/jquery-3.3.1/jquery-3.3.1.min.js"`{% endraw %}；

# 定制
首先考虑一下当前模板`_layout`需不需要定制。目前我感觉还挺好，暂时不用动了。

其次，页面的navigation bar或者sidebar一般是需要定制的。这个可以修改`_include`下的header或者sidebar，看他们的实现，可能引用了`_data`里的变量，所以可能修改一下变量就达到自定义的目的了。

目前：
- `_include/header`：页面头部，里面的导航条目是`_data/navigation.yml`配置的；
- `_include/sidebar`：左边栏，内容配置在`_data/toc.yml`；
- `_include/editable`：右边栏的上部，用于快速修改页面对应的github里的文件；
- `_include/toc`：右边栏的下部，editable下面，放置目录；


网页的单独页面（比如about或者tag）都是在`pages`目录下单独定义的，按照自己的需求增删页面内容、修改页面结构，稍微改改基本就可以了。


