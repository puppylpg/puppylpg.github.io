---
layout: post
title: "jekyll-theme-chirpy"
date: 2023-10-29 23:36:57 +0800
categories: Jekyll
tags: Jekyll
---

[docsy-jekyll]({% post_url 2020-08-29-docsy-jekyll %})使用三年有余，又厌倦了 :D

> 始乱终弃+1。也不完全算始乱终弃吧，毕竟中间也帮忙修过bug。

- [Jekyll：GitHub Pages]({% post_url 2019-11-16-build-github-pages-Debian %})：如何使用jekyll搭建网站；
- [Jekyll：网站结构]({% post_url 2019-11-17-Jekyll-website %})：jekyll网站架构、liquid模板引擎；
- [Jekyll：minima主题自定义]({% post_url 2019-11-23-minima-customize %})：各种自定义元素，以minima为例；
- [docsy-jekyll]({% post_url 2020-08-29-docsy-jekyll %})：collection定义、default layout；

1. Table of Contents, ordered                    
{:toc}

chirpy的很多功能完美符合我的需求：
- 右侧的跟随目录；
- 底下可选的disqus或github评论；
- 非常迅速的search as you type（以后可以不用archives总目录了，想看啥直接搜就行了）；

还有越看越顺眼的界面，更多的文本高亮语法。代码高亮不仅支持直接复制，还支持显示行号，整个代码库也很有设计感。完美！

按照[官方教程](https://chirpy.cotes.page/posts/getting-started/)，采用chirpy starter的方式构建网站。

# 重装
原本安装jekyll-theme-chirpy gem之后，直接就可以用了。但是chirpy starter提供了更多可自定义的地方，并提供了一个自定义的github workflow，能够在push代码之后自动构建网站并推送到github pages。**它的workflow和原来github pages默认的推送流程已经不一样了。因为这个starter的Gemfile里没有使用github pages gem。**

# Collection
chirpy自定义了一个collection，`tabs`，用于显示tags/categories/archives。

```yaml
collections:
  tabs:
    output: true
    sort_by: order
```

## `_tabs`
tabs集合下默认的layout是page：
```yaml
defaults:
  - scope:
      path: ""
      type: tabs # see `site.collections`
    values:
      layout: page
      permalink: /:title/
```
但是chirpy为每一种类型都自定义了一种layout。比如archives一栏使用的是archives layout：
```yaml
---
layout: archives
icon: fas fa-archive
order: 3
---
```
{: file='_tutorial/archives.md'}

archives layout是一种基于pages的layout，但多了一些内容。所以虽然tabs collection在default里定义了layout，这里自己指定了另一个。

## 自定义collection
我也照葫芦画瓢，自定义了`life`、`books`、`tutorials`三种collection，并在`_tabs`下创建了相应文件，这样就把他们作为tab页面。

但是我不会写tab页面啊！不如照着archives抄一个吧。先找到chirpy这个gem的安装位置：
```bash
$ bundle show jekyll-theme-chirpy
/home/win-pichu/gems/gems/jekyll-theme-chirpy-6.2.3
```
archives模板就是`_layout/archives.html`。它里面遍历的是`site.posts`。那我们就在本工程下创建`_layout`文件夹，再copy一个archives过来，命名为`books.html`，然后把`site.posts`改成`site.books`，就能遍历`_books`文件夹下的文件了。

但是看结果发现，posts是按照时间倒序的，books确实正序的。查了之后才发现`site.posts`默认就是按照日期倒序排列的，相当于把tutorials排序后再逆序：
```ruby
{% raw %}
  {% assign sorted = site.tutorials | sort: 'date' | reverse %}

  {% for post in sorted %}
{% endraw %}
```
这样就是对的了。

> 但是重新构建后，网页依旧不变，后来发现是有缓存，只能`Ctrl + F5`强制刷新才行。

## icon
archives用的icon是`fas fa-archive`。在[icons reference](https://www.w3schools.com/icons/icons_reference.asp)找到了一堆Font Awesome类型的icon，可以给life、books、tutorial安排上了。

# 评论
## utterance
之前用的是disqus，但是毕竟是技术博客，还是想用github的[utterances](https://utteranc.es/)。在授权之后，它会使用utterances-bot在项目下创建issue，以url/pathname/title等作为文章和issue的匹配依据。

> 比如采用url：如果文章改url了，它之前对应的issue就对应不上了，再有评论时会重新创建一个issue。

## 启用评论
但是books没有toc和comment。看了一下posts，用的是post模板，books用的则是page模板。在post的模板里，指定了使用toc和comments：
```bash
{% raw %}
$ head -20 _layouts/post.html
---
layout: default
refactor: true
panel_includes:
  - toc
tail_includes:
  - related-posts
  - post-nav
  - comments
---

{% include lang.html %}

<article class="px-1">
  <header>
    <h1 data-toc-skip>{{ page.title }}</h1>

    <div class="post-meta text-muted">
      <!-- published date -->
      <span>
{% endraw %}
```
所以books如果也想有评论，需要把layout改为post。

# `lang`
`_config`里可以设置`lang`，语言。在每个模板都引用的`lang.html`里，引用了`site.lang`这个定义在config里的变量：
```bash
{% raw %}
$ head _includes/lang.html
{% comment %}
  Detect appearance language and return it through variable "lang"
{% endcomment %}
{% if site.data.locales[site.lang] %}
  {% assign lang = site.lang %}
{% else %}
  {% assign lang = 'en' %}
{% endif %}
{% endraw %}
```
设成[`zh-CN`](http://www.lingoes.net/en/translator/langcode.htm)之后，主页的tags和categories竟然都变成了中文。看来chirpy是有多语言支持的。

在显示日期的时候，Liquid的date format相关的函数也是会根据lang采用不同格式的。

# 站内引用
我发现chirpy的站内引用，有一些是不生效的，提示404，但确实也没写错，很迷。

正常的渲染：
- `<a href="/posts/springboot-run/">SpringBoot - run</a>`

有问题的渲染：
- `{% raw %}<a href="{% post_url 2020-08-29-docsy-jekyll %}">docsy-jekyll</a>{% endraw %}`

href里没有把`post_url`正确渲染。

于是我在site里搜了一下没成功渲染的文档：
```bash
{% raw %}
$ find _site -type f -exec grep -i "{% post_url" {} +
{% endraw %}
```
发现很明显，没有渲染成功的都是关于jekyll的，那么问题就很明显了……

我在他们开头的Front Matter里设置了：
```
render_with_liquid: false
```
不让渲染……

看来还是不行的，不能禁用全文的Liquid渲染，只能对代码单独使用`raw...endraw`了……

# workflow
研究一下这个项目的github workflow。

chirpy-starter里默认的workflow有一个test site的流程：
```
      - name: Test site
        run: |
          bundle exec htmlproofer _site \
            \-\-disable-external=true \
            \-\-ignore-urls "/^http:\/\/127.0.0.1/,/^http:\/\/0.0.0.0/,/^http:\/\/localhost/"
```
并不能执行通过，报错：`htmlproofer 4.4.3 | Error:  Invalid scheme format: 'node：https'`。

最麻烦的是我并没有找到问题的原因。后来看了一下[html-proofer](https://github.com/gjtorikian/html-proofer)这个gem的用法，想了一下应该是有个地方连接写错了，所以在生成的网页里搜索了一下：
```bash
$ find _site -type f -exec grep "node：https" {} +
_site/posts/es-config-deploy/index.html:<h2 id="节点"><span class="me-2"><a href="node：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html">节点</a></span><a href="#节点" class="anchor text-muted"><i class="fas fa-hashtag"></i></a></h2>
```
果然，是一个url当时复制错了：
```
## [节点](node：https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-node.html)
```
被htmlproofer发现了。

同样的错误还有抄scala api的时候，没有加双撇号，`as[U](implicit arg0: Encoder[U]): Dataset[U]`的模板参数U和方法参数和在一起正好是markdown的超链接格式，又被markdown渲染成了一个无效的超链接……

还有一处图片的超链接忘了放了，`[container_evolution]()`，写一半估计下载图片去了，转头就忘了，导致报错：`'a' tag is missing a reference`。

其他的还有：
- 链接没有使用https；
- 有些引用的格式不正确；
- tutorial里摘录的教程文章没有把对应的图片放进来，导致图片失效；
- life里的motorcycle章节加了tag，但是因为不是post，tag并被收集、渲染为单独的页面。导致`/categories/motocycle/`和`/tags/motocycle/`的页面检查不存在：`internally linking to /tags/motocycle/, which does not exist`；

最终我把命令改成了：
```bash
$ bundle exec htmlproofer _site \          
          --disable-external=true \
          --enforce_https=false \
          --ignore-files "/tutorials/" \
          --ignore-urls "/^http:\/\/127.0.0.1/,/^http:\/\/0.0.0.0/,/^http:\/\/localhost/"
```
不强制使用https，跳过tutorials里的文件检查，终于通过了校验。

> 挺好的，纠了不少错。

# 一些问题
## categories
categories之前做的不太好，设置的跟tags一样，导致用处不大。看起来categories作为树状目录使用比较好。后面再看看比较好的规范。

## 个人主页
个人主页没了，考虑要不要再加上。

# 感想
终于又了了一件长久以来想做的事情！终于找到了更理想的模板！

> 还是新的爽 :D

