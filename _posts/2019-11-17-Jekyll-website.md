---
layout: post
title: "探索Jekyll静态网站构建"
date: 2019-11-17 01:44:39 +0800
categories: Jekyll
tags: Jekyll
# render_with_liquid: false
---

使用Jekyll搭建静态网站是一件容易上手，非常优雅且令人愉悦的事情，甚至让我这个服务端程序猿产生了能搞一搞前端的错觉:D

使用Jekyll搭建网站，只需要考虑页面内容即可，Jekyll现有的一些主题能很好的构建整个网站框架。这里以Jekyll默认的minima为例，简单分析一下框架的内容。

# 网站架构
分析minima之前，可以先想象一下一个普通网页应该有的样子：
- navigation bar：上方应该是一个导航栏；
- body：中间应该是网页内容；
- foot：最下面应该是网页的页脚，写着一些网站的通用信息，比如copyright之类的。

网页的这三部分不应该是手撸到一个html里的。考虑到网站的网页复用等情况，应该只有body是可变的。上下的导航条和页脚应该是所有网页共用的。所以得有模板之类的东西，我们写blog的时候只是把内容往里填。

# minima结构
遵循上面的思路，简单探索一下minima-2.5.1的结构。

首先，在构建出的网站的根目录下，看一下该构件使用的minima所在的安装路径：
```
➜  puppylpg.github.io git:(master) ✗ bundle show minima
/home/win-pichu/gems/gems/minima-2.5.1
```
然后到该路径下，看一下minima的目录结构：
```
win-pichu@DESKTOP-T467619:~/gems/gems/minima-2.5.1 $ tree
.
├ assets
│   ├ main.scss
│   └ minima-social-icons.svg
├ _includes
│   ├ disqus_comments.html
│   ├ footer.html
│   ├ google-analytics.html
│   ├ header.html
│   ├ head.html
│   ├ icon-github.html
│   ├ icon-github.svg
│   ├ icon-twitter.html
│   ├ icon-twitter.svg
│   └ social.html
├ _layouts
│   ├ default.html
│   ├ home.html
│   ├ page.html
│   └ post.html
├ LICENSE.txt
├ README.md
└ _sass
    ├ minima
    │   ├ _base.scss
    │   ├ _layout.scss
    │   └ _syntax-highlighting.scss
    └ minima.scss

5 directories, 22 files
```

## Liquid
Jekyll使用[Liquid](https://shopify.github.io/liquid/)模板语言来处理模板。

Liquid有三个主要部分：
- Object：`{% raw %}{{page.title}}{% endraw %}`，双括号，用于引用变量，使用该变量值；
- Tag：`{% raw %}{% if page.show_sidebar %}{% endraw %}`，大括号加百分号，用于逻辑控制，相当于html里嵌入代码；
- Filter：`{% raw %}{{ "hi" | capitalize }}{% endraw %}`，竖线，对内容进行处理，A变成B；

### Front Matter
页头，Liquid只处理有页头的页面。页头是两行三横线，里面可以使用[YAML](https://yaml.org/)定义一些变量：
```
{% raw %}
---
name: puppylpg
---

<h1>{{ page.name | downcase }}</h1>
{% endraw %}
```
所有定义在页头里的变量，在Liquid中都可以使用`page`变量访问，比如上面定义的name的访问方式就是`{% raw %}{{ page.name }}{% endraw %}`。

参阅：
- https://jekyllrb.com/docs/liquid/
- https://jekyllrb.com/docs/step-by-step/03-front-matter/

## layouts
layout就是上面说的网页模板，放在`_layouts`目录下。

### `_layout/default.html`
看一下minima的一个根模板（`_layout/default.html`）：
```
{% raw %}
<!DOCTYPE html>
<html lang="{{ page.lang | default: site.lang | default: "en" }}">

  {%- include head.html -%}

  <body>

    {%- include header.html -%}

    <main class="page-content" aria-label="Content">
      <div class="wrapper">
        {{ content }}
      </div>
    </main>

    {%- include footer.html -%}

  </body>

</html>
{% endraw %}
```
body标签之间的就是网页内容，模板中body大致有三块内容：
- body开头引用了header.html；
- 中间引用了内容；
- body结束前引用了footer.html；

header.html和footer.html里分别放着导航栏和页脚。

他们是被include进来的，稍后再说。

### `_layout/home.html`
看一下另一个模板home（`_layout/home.html`）：
```
{% raw %}
---
layout: default
---

<div class="home">
  {%- if page.title -%}
    <h1 class="page-heading">{{ page.title }}</h1>
  {%- endif -%}

  {{ content }}

  {%- if site.posts.size > 0 -%}
    <h2 class="post-list-heading">{{ page.list_title | default: "Posts" }}</h2>
    <ul class="post-list">
      {%- for post in site.posts -%}
      <li>
        {%- assign date_format = site.minima.date_format | default: "%b %-d, %Y" -%}
        <span class="post-meta">{{ post.date | date: date_format }}</span>
        <h3>
          <a class="post-link" href="{{ post.url | relative_url }}">
            {{ post.title | escape }}
          </a>
        </h3>
        {%- if site.show_excerpts -%}
          {{ post.excerpt }}
        {%- endif -%}
      </li>
      {%- endfor -%}
    </ul>

    <p class="rss-subscribe">subscribe <a href="{{ "/feed.xml" | relative_url }}">via RSS</a></p>
  {%- endif -%}

</div>
{% endraw %}
```
home的页头定义了自己使用的模板是default（default就是上面介绍的一个layout）。

也就是说，home是一个模板，它首先复用了default.html模板的内容，然后自己又定义了一些内容。自己定义的这些内容会去替换default.html的`{% raw %}{{ content }}{% endraw %}`的内容。

home定义的元素主要分为两部分：
- 输出使用该模板的网页的content；
- 输出该网站所有的post的标题、摘要等；

那么一个是用了home模板的页面的内容一定是这样四部分的：
1. 开头引用了header.html（来自default）；
2. 该网页自己定义的内容（来自home）；
3. 该网站所有的post的标题、摘要等（来自home）；
4. 最后引用了footer.html（来自default）；

### `_layouts/page.html`
page和home模板一样，也是继承了default的模板，内容甚至更简单一些：
```
{% raw %}
---
layout: default
---
<article class="post">

  <header class="post-header">
    <h1 class="post-title">{{ page.title | escape }}</h1>
  </header>

  <div class="post-content">
    {{ content }}
  </div>

</article>
{% endraw %}
```

### `_layouts/post.html`
post模板同理：
```
{% raw %}
---
layout: default
---
<article class="post h-entry" itemscope itemtype="http://schema.org/BlogPosting">

  <header class="post-header">
    <h1 class="post-title p-name" itemprop="name headline">{{ page.title | escape }}</h1>
    <p class="post-meta">
      <time class="dt-published" datetime="{{ page.date | date_to_xmlschema }}" itemprop="datePublished">
        {%- assign date_format = site.minima.date_format | default: "%b %-d, %Y" -%}
        {{ page.date | date: date_format }}
      </time>
      {%- if page.author -%}
        • <span itemprop="author" itemscope itemtype="http://schema.org/Person"><span class="p-author h-card" itemprop="name">{{ page.author }}</span></span>
      {%- endif -%}</p>
  </header>

  <div class="post-content e-content" itemprop="articleBody">
    {{ content }}
  </div>

  {%- if site.disqus.shortname -%}
    {%- include disqus_comments.html -%}
  {%- endif -%}

  <a class="u-url" href="{{ page.url | relative_url }}" hidden></a>
</article>
{% endraw %}
```
页面略复杂，大致包括：
- page title；
- date；
- author；
- 内容；
- disqus评论；

当然还包括父模板里的header和footer。

### 使用layout
比如使用Jekyll初始化网站之后默认生成的博客`Welcome to Jekyll!`就使用了post layout，它的Front Matter YAML就是这么写的：
```
{% raw %}
---
layout: post
title:  "Welcome to Jekyll!"
date:   2019-11-16 02:08:37 +0800
categories: jekyll update
---
blabla...
{% endraw %}
```
最终的效果如图所示：
TODO IMAGE

和上面介绍的post layout的页面结构一致。

参阅：
- https://jekyllrb.com/docs/step-by-step/04-layouts/

## include
之前介绍default layout的时候，说它引入了header.html和footer.html。include是防止重复的另一种机制，类似于写代码的时候把一段代码封装成了一个函数，需要用的时候某一小段模板的时候，include一下就行了。

参阅：
- https://jekyllrb.com/docs/step-by-step/05-includes/

感觉最重要的就是_layouts和_includes，其他还有assets，_sass等，用来控制样式，放置一些静态资源如图片之类的，有兴趣可以了解一下。

# 工程结构
在[搭建个人GitHub Pages（Debian 9 Stretch）]({% post_url 2019-11-16-build-github-pages-Debian %})中，我们使用Jekyll初始化了一个网站工程。结构大致如下：
```
.
├ 404.html
├ about.markdown
├ _config.yml
├ Gemfile
├ Gemfile.lock
├ index.markdown
├ _posts
│   ├ 2019-11-16-build-github-pages-Debian.md
│   ├ 2019-11-16-keep-alive.md
│   └ 2019-11-16-welcome-to-jekyll.markdown
├ README.md
└ _site
```

## `_posts`
这里是专门放置文档的地方。因为我们会使用模板写文章，且模板只需要给出content和一些其他的信息如author、title等，所以现在写文章就很方便，只需要指定：
- 使用的是哪个模板；
- 文章内容；
- 一些author、title等模板里用到的信息；

文章需要命名为类似于`_posts/2018-08-20-bananas.md`就行。

比如Jekyll的样例文章：
```
{% raw %}
---
layout: post
title:  "Welcome to Jekyll!"
date:   2019-11-16 02:08:37 +0800
categories: jekyll update
---
You’ll find this post in your `_posts` directory. Go ahead and edit it and re-build the site to see your changes. You can rebuild the site in many different ways, but the most common way is to run `jekyll serve`, which launches a web server and auto-regenerates your site when a file is updated.

Jekyll requires blog post files to be named according to the following format:

`YEAR-MONTH-DAY-title.MARKUP`

Where `YEAR` is a four-digit number, `MONTH` and `DAY` are both two-digit numbers, and `MARKUP` is the file extension representing the format used in the file. After that, include the necessary front matter. Take a look at the source for this post to get an idea about how it works.

Jekyll also offers powerful support for code snippets:

{% highlight ruby %}
def print_hi(name)
  puts "Hi, #{name}"
end
print_hi('Tom')
#=> prints 'Hi, Tom' to STDOUT.
{% endhighlight %}

Check out the [Jekyll docs][jekyll-docs] for more info on how to get the most out of Jekyll. File all bugs/feature requests at [Jekyll’s GitHub repo][jekyll-gh]. If you have questions, you can ask them on [Jekyll Talk][jekyll-talk].

[jekyll-docs]: https://jekyllrb.com/docs/home
[jekyll-gh]:   https://github.com/jekyll/jekyll
[jekyll-talk]: https://talk.jekyllrb.com/
{% endraw %}
```
- 用的模板是post.html；
- 用的标题和日期。如果标题不指定，会使用文件名日期后的字符串作为标题，如`bananas`；
- YAML Front Matter下面只需要给出文章正文就行了。

### 访问所有的`_posts`
发表的文章有很多，应该提供一种看到所有文章的机制。

在`home.html`模板中，已经给出了方法：
```
{% raw %}
  {%- if site.posts.size > 0 -%}
    <h2 class="post-list-heading">{{ page.list_title | default: "Posts" }}</h2>
    <ul class="post-list">
      {%- for post in site.posts -%}
      <li>
        {%- assign date_format = site.minima.date_format | default: "%b %-d, %Y" -%}
        <span class="post-meta">{{ post.date | date: date_format }}</span>
        <h3>
          <a class="post-link" href="{{ post.url | relative_url }}">
            {{ post.title | escape }}
          </a>
        </h3>
        {%- if site.show_excerpts -%}
          {{ post.excerpt }}
        {%- endif -%}
      </li>
      {%- endfor -%}
    </ul>

    <p class="rss-subscribe">subscribe <a href="{{ "/feed.xml" | relative_url }}">via RSS</a></p>
  {%- endif -%}
{% endraw %}
```
`site.posts`在Jekyll中代表所有发表在`_posts`下的文章。通过`{% raw %}{% for post in site.post %}{% endraw %}`就可以遍历所有文章，并访问每个文章的date、title、excerpt等信息。

这也是是用了`home.html`模板的页面也会显示所有文章的原因。

参阅：
- https://jekyllrb.com/docs/step-by-step/08-blogging/

## `_site`
这里是编译`_posts`里的文章生成的最终的网页，模板和内容在这里都被组装到了一起。最终我们访问网页的时候，访问的时候都是这些内容。

`_site`就是一个完整的静态网站。如果把它拷到Apach服务器上，一个静态网站就可以直接访问了。

## `index.markdown`
```
{% raw %}
---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults
layout: home
title: Home
list_title: puppylpg wanna say -
---
Welcome to puppylpg's home website, pika~
{% endraw %}
```
index页面使用的模板是`home.html`，所以会列出所有的文章目录。

## `about.markdown`
```
{% raw %}
---
layout: page
title: About
permalink: /about/
---

This is the base Jekyll theme. You can find out more info about customizing your Jekyll theme, as well as basic Jekyll usage documentation at [jekyllrb.com](https://jekyllrb.com/)

You can find the source code for Minima at GitHub:
[jekyll][jekyll-organization] /
[minima](https://github.com/jekyll/minima)

You can find the source code for Jekyll at GitHub:
[jekyll][jekyll-organization] /
[jekyll](https://github.com/jekyll/jekyll)


[jekyll-organization]: https://github.com/jekyll
{% endraw %}
```
about使用的是page模板，路径是/about。关于路径，下面会介绍。

## `_config.yml`
config文件可以配置很多东西，比如：
- 全局变量：可以指定一些键值对，这些键值对最终都能通过`site`变量引用；
- 主题：比如现在用的minima；
- 插件；

其他。

> 修改其他文件都能做到动态加载，在不重启本地server的情况直接看到变化。但是修改`_config.yml`里的内容必须重启server。

参阅：
- https://jekyllrb.com/docs/configuration/

## `Gemfile`
使用Gemfile最大的作用就是指定Jekyll和其他gem的版本，这样通过`bundler`就可以使用Gemfile中指定的这些版本的gem构建工程，保证构建的一致性。

构建方式：
```
bundle exec jekyll serve
```

# env
TODO

参阅：
- https://jekyllrb.com/docs/step-by-step/10-deployment/#environments
- https://jekyllrb.com/docs/configuration/environments/

# 页面路径
每个页面都有路径。可以通过页面Front Matter的`permalink`指定路径，这样页面源文件和最终编译后的页面的目录就不用非得对应了。

也可以在`_config.yml`中指定permalink的格式。默认好像是：
```
permalink: /:categories/:year/:month/:day/:title:output_ext
```
所以文章的categories，date，都会影响最终网页的链接。

参阅：
- https://jekyllrb.com/docs/permalinks/

# 导航条里的条目
哪些页面回增加到导航栏里？
看导航栏header.html的源码：
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
最后一部分，遍历page_paths，把那些有title的page的title放上去。

page_paths来自哪儿？根据上面的`assign` tag的定义，page_paths优先设置为`site.header_pages`，否则就使用默认的`site.pages`。

`site.header_pages`应该是需要我们在`_config.yml`中自定义的变量。所以默认就是`site.pages`的值。

> `site.pages`: A list of all Pages.

因此，默认所有有title的page都会放在导航栏里。

参阅：
- https://shopify.github.io/liquid/tags/variable/
- https://jekyllrb.com/docs/variables/#site-variables

# 增加评论系统
TODO: 
- https://desiredpersona.com/disqus-comments-jekyll/
- 

# 关于引用的代码中有Liquid tag的问题
想引用一下layout模板的代码，但是代码里的Liquid tag竟然会被Liquid替换掉……即使使用markdown的代码引用格式，也不奏效……

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


