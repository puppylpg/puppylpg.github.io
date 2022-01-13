---
layout: page
title: Documentation
permalink: /docs/
---

# Documentation

Welcome to the {{ site.title }} Documentation pages! 

人生不应只是技术，这几年基本除了技术书都不看其他的东西了。缺少了阅读的人生有点干涸，也有点儿失落。
所以单开一栏，追寻小时候一头扎进书店一泡一整天的快乐。

这里记录着我的一些值得一提的感想、见识，应该都是读书得来的：

<div class="section-index">
    <hr class="panel-line">
    {% assign sorted = site.docs | sort: 'date' | reverse %}
    {% for doc in sorted  %}
    <div class="entry">
    <h3><a href="{{ doc.url | prepend: site.baseurl }}">{{ doc.title }}</a></h3>
    <span class="post-date">{{ doc.date | date: "%B %d, %Y" }}</span><br>
    <p>{{ doc.description }}</p>
    </div>{% endfor %}
</div>
