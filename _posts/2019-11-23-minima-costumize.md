---
layout: post
title: "minima主题拓展"
date: 2019-11-23 22:46:25 +0800
categories: Jekyll minima
tags: Jekyll minima
# render_with_liquid: false
---

minima是Jekyll默认的主题，也是最简单的主题，很符合Keep It Stupid and Simple的原则。默认的可能是符合大众的，但一定不是完全适合自己口味的，所以理解一些原理，增加一些自己想要的东西也是很必要的。

1. Table of Contents, ordered                    
{:toc}

# env
指定一些环境变量。

比如`JEKYLL_ENV`，默认是development。在Liquid中，该变量通过`jekyll.environment`访问。所以我们可以加一些只有线上环境才会有的代码：
```
{% raw %}
{% if jekyll.environment == "production" %}
  <script src="my-analytics-script.js"></script>
{% endif %}
{% endraw %}
```
然后在开发环境中，指定`JEKYLL=production`，编译启动server，看看代码的效果是否符合预期：
```
JEKYLL_ENV=production bundle exec jekyll serve
```

参阅：
- https://jekyllrb.com/docs/step-by-step/10-deployment/#environments
- https://jekyllrb.com/docs/configuration/environments/
- https://jekyllrb.com/docs/usage/

# 页面路径
每个页面都有路径。可以通过页面Front Matter的`permalink`指定路径，这样页面源文件和最终编译后的页面的目录就不用非得对应了。

也可以在`_config.yml`中指定permalink的格式。默认好像是：
```
permalink: /:categories/:year/:month/:day/:title:output_ext
```
所以文章的categories，date，都会影响最终网页的链接。

参阅：
- https://jekyllrb.com/docs/permalinks/

# 自定义导航栏里的条目
哪些页面会增加到导航栏里？

默认情况下所有工程根目录下的文件都会加入导航条。如果工程内有CHANGELOG.md，它也会在导航栏里。

导航栏的逻辑还是看一下header.html的源码：
```
{% raw %}
<header class="site-header" role="banner">

  <div class="wrapper">
    {%- assign default_paths = site.pages | map: "path" -%}
    {%- assign page_paths = site.header_pages | default: default_paths -%}
    <a class="site-title" rel="author" href="{{ "/" | relative_url }}">{{ site.title | escape }}</a>

    {%- if page_paths -%}
      <nav class="site-nav">
        <input type="checkbox" id="nav-trigger" class="nav-trigger" />
        <label for="nav-trigger">
          <span class="menu-icon">
            <svg viewBox="0 0 18 15" width="18px" height="15px">
              <path d="M18,1.484c0,0.82-0.665,1.484-1.484,1.484H1.484C0.665,2.969,0,2.304,0,1.484l0,0C0,0.665,0.665,0,1.484,0 h15.032C17.335,0,18,0.665,18,1.484L18,1.484z M18,7.516C18,8.335,17.335,9,16.516,9H1.484C0.665,9,0,8.335,0,7.516l0,0 c0-0.82,0.665-1.484,1.484-1.484h15.032C17.335,6.031,18,6.696,18,7.516L18,7.516z M18,13.516C18,14.335,17.335,15,16.516,15H1.484 C0.665,15,0,14.335,0,13.516l0,0c0-0.82,0.665-1.483,1.484-1.483h15.032C17.335,12.031,18,12.695,18,13.516L18,13.516z"/>
            </svg>
          </span>
        </label>

        <div class="trigger">
          {%- for path in page_paths -%}
            {%- assign my_page = site.pages | where: "path", path | first -%}
            {%- if my_page.title -%}
            <a class="page-link" href="{{ my_page.url | relative_url }}">{{ my_page.title | escape }}</a>
            {%- endif -%}
          {%- endfor -%}
        </div>
      </nav>
    {%- endif -%}
  </div>
</header>
{% endraw %}
```
可以看到最后输出的是那些`site.pages`中，path为`page_paths`的页面。

`page_paths`又是啥？`assign page_paths = site.header_pages | default: default_paths`，优先取`site.header_pages`，如果该变量不存在，默认是default_paths。而default_paths的定义是`default_paths = site.pages | map: "path"`，也就是`site.pages`包含的page。

默认情况下`site.header_pages`并不存在，所以最后输出的就是`site.pages`中的所有页面。

如果我们自定义了`site.header_pages`的内容，那最终的导航栏就是我们定义什么就输出什么。所以在`_config.yml`中增加以下内容内容：
```
# navigation bar items
header_pages:
        - about.md
        - index.md
```
这样导航栏里就只有about和index两个页面的`page.title`了。

参阅：
- https://shopify.github.io/liquid/filters/map/
- https://shopify.github.io/liquid/filters/where/
- https://shopify.github.io/liquid/tags/variable/
- https://jekyllrb.com/docs/variables/#site-variables
- https://www.tahirtaous.com/exclude-pages-jekyll-navigation-menu-minima-theme/
- https://stackoverflow.com/questions/25452429/excluding-page-from-jekyll-navigation-bar

# 增加评论系统
```
# Disqus Comments
disqus:
        # Leave shortname blank to disable comments site-wide.
        # Disable comments for any post by adding `comments: false` to that post's YAML Front Matter.
        shortname: <your-shortname>
```
在一个中文网站里接入了国外的评论系统，应该注定我的网站是不会有人评论的吧……

- https://desiredpersona.com/disqus-comments-jekyll/

# 引用的代码中有Liquid tag，导致代码被替换了
在这篇文章中我想引用一下layout模板的代码，但是代码里的Liquid tag竟然会被Liquid替换掉……即使使用markdown的代码引用格式，也不奏效……

在Jekyll 4.0+ 中，可以在YAML中粗暴的使用：
```
render_with_liquid: false
```
来禁止对本文档的tag进行渲染。

这一做法粒度太粗，而且GitHub目前使用的Jekyll不到4.0。

使用[`raw`](https://shopify.github.io/liquid/tags/raw/)这个tag即可。

（但是这一篇文章就是介绍Liquid的filter和tag的，一个个加`raw...endraw`，我快疯了。。。）

参阅：
- https://shopify.github.io/liquid/tags/raw/
- https://jekyllrb.com/docs/liquid/tags/

# 站内引用
使用`post_url` tag：
```
{% raw %}
{% post_url 2010-07-21-name-of-post %}
{% endraw %}
```
会显示站内另一篇文章的路径。如果想把它变成链接，外面再套一层markdown语法即可：
```
{% raw %}
[name]({% post_url 2010-07-21-name-of-post %})
{% endraw %}
```

参阅：
- https://jekyllrb.com/docs/liquid/tags/#linking-to-posts


# 博客页面添加文章目录结构
Jekyll使用[Kramdown](https://kramdown.gettalong.org/)将markdown解析为html。

而在Kramdown中，添加Table of Contents的方法是使用：
```
{:toc}
```
同时，前面必须跟上序号或者非序号来制定目录带不带序号。

比如：
```
1. blabla
{:toc}
```
这是一个有序号的目录`blabla`不重要，它会被目录取代。

```
* blabla
{:toc}
```
这是一个没有序号的目录`blabla`不重要，它也会被目录取代。

如果不想将某个标题加入目录，在这个标题下面加上`{:.no_toc}`即可，比如：
```
# Header
{:.no_toc}
```

参阅：
- http://www.seanbuscay.com/blog/jekyll-toc-markdown/
- https://kramdown.gettalong.org/converter/html.html#toc

# post页面显示tag & 覆盖默认模板
虽然我们在写的文章里加了categories/tags，但是默认的post模板只显示文章的title，date，content，不显示tag。可以使用给默认模板增加tag显示，并覆盖默认模板。

增加tag显示的语句为：
```
{% raw %}
      <div>
              {{page.tags | join: ' | '}}
      </div>
{% endraw %}
```
将所有tag通过Liquid的[join](https://shopify.github.io/liquid/filters/join/)使用` | `连接起来，放到默认模板显示time的逻辑下面即可变为新模板。

然后把模板放到工程根目录下的`_layouts/post.html`，Jekyll便会使用该post替换默认的minina下的`_layouts/post.html`，达到替换默认模板的目的。

# 增加tag/category分类页面
Jekyll默认没有显示所有标签的功能，这很不利于根据tag去筛选文章。但是Jekyll可以根据`site.tags`获取所有的tag，这为遍历所有标签，分标签显示文章提供了途径。

`site.tags`返回的是一个（二维）数组，数组的每个元素又由两个元素组成，第一个元素是tag的名称，第二个元素是该tag下的所有post。结构大致如下：
`[[tagA, [postA1, postA2, ..., postAn]], [tagB, [postB1, postB2, ..., postBn]], ...]`

所以可以添加`tags.md`到工程根目录下：
```
{% raw %}
---
layout: page
title: Tag
permalink: /tag/
---
{% comment %}
==============
This is to make the tags sorted by their name.
site.tags[0]: tag name
site.tags[1]: array of posts in this tag
==============
{% endcomment %}
{% assign ordered_tags = site.tags | sort %}
{% for tag in ordered_tags %}
  <h3>{{ tag[0] }}</h3>
  <ul>
    {% for post in tag[1] %}
      <li><a href="{{ post.url }}">{{ post.title }}</a></li>
    {% endfor %}
  </ul>
{% endfor %}
{% endraw %}
```
首先，使用Liquid的[sort](https://shopify.github.io/liquid/filters/sort/)将`site.tags`排序，然后遍历拍过序的数组，第一个元素为tag name，第二个元素为post数组，再遍历该数组，输出post的title，指向post的url即可。

参阅：
- https://jekyllrb.com/docs/posts/#categories-and-tags
- https://gist.github.com/Phlow/57eb457898e4ac4c4a20

# 添加Google Analytics
想知道网站的访问情况，用户特征等等信息，可以使用Google Analytics进行统计。本质上这就是个回调函数，一旦有人访问，就给Google Analytics发这些信息，Google会记录下来做统计。

所以关键在于生成一个专属于自己的回调函数。

1. 使用Google账号去Google Anayltics[注册](https://analytics.google.com/analytics/web/?authuser=0#/provision/SignUp/)一下，生成专属code和用户id；
2. 把code加入网站的每个网页里。

Jekyll的minima主题已经做好模板了，回调函数写在google-analytics.html，会被引入每个网页的head里，所以我们唯一要做的就是添上回调函数里确实的user id。

只需要编辑`_config.yml`，加入：
```
# google analytics
google_analytics: <Your user id>
```
即可。

> 如果不以`JEKYLL_ENV=production`编译运行本地离线网站，这些回调函数是不会加入网页的。也就是说，这样可以避免自己自测网站的时候也向Google发送数据，影响统计信息。

参阅：
- http://lukemorrow.me/2018/05/28/adding-google-analytics.html
- https://michaelsoolee.com/google-analytics-jekyll/

# 添加seo
既然如此，那把SEO（Search Engine Optimization，搜索引擎优化）也打开吧，希望能吸引更多用户。

流程比较简单，按照github [jekyll-seo-tag](https://github.com/jekyll/jekyll-seo-tag)说的搞一下就行了。

参阅：
- https://github.com/jekyll/jekyll-seo-tag
- http://pizn.github.io/2012/01/16/the-seo-for-jekyll-blog.html
