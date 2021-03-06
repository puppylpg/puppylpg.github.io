# CHANGELOG
## v0.0.1(2019-11-16)
    * 功能
        - 初始化网站，部署到github上；

## v0.0.2(2019-11-17)
    * 功能
        - 添加两篇关于在Debian用Jekyll搭建网站，及Jekyll使用的文章；
        - 将一些原始的Jekyll模板替换为自己的信息；

## v0.0.3(2019-11-17)
    * bugfix
        - 使用Liquid raw tag禁止渲染代码中的tag；
        - 站内引用；

## v0.0.4(2019-11-17)
    * 功能
        - 增加目录toc；
        - 修改navigation bar的内容；

## v0.1.0(2019-11-18)
    * 功能
        - 和GitHub Pages的依赖同步：使用Jekyll 3.8.5，使用github-pages指定的所有依赖；
        - 使用bundler将所有需要的gem安装在工程本地；
        - 修改README.md，添加使用方法；
        - 使用`page.header_pages`自定义导航栏。需要定义一个YAML的array（之前错加上分号了）；
        - 增加图片；
        - 添加Google Analytics和seo插件；

## v0.1.1(2019-11-23)
    * 功能
        - 增加tag页面；
        - 增加blog页面的tag显示；

## v0.2.0(2019-12-11)
    * bugfix
        - 设置timezone，blog能按照设置的时区编译显示时间了；

## v1.0.0(2020-08-28)
    * 功能
        - 使用[docsy-jekyll](https://jekyll-themes.com/docsy-jekyll/)替换默认的minima主题；

## v1.1.0(2020-09-04)
    * 功能
        - 按照时间逆序排列collection的文章；
