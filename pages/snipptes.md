---
layout: page
title: Snippet
permalink: /snippets/
---

# Snippet

Welcome to the {{ site.title }} snippet pages!

一些七零八碎的东西，可以是一个想法、一个心情，但我猜更多应该会是那些我看到又一时不能整理成章的知识。
并不总有那么多成章成段的时间，不如偷一刻闲，撒下这些碎片：

<div class="section-index">
    <hr class="panel-line">
    {% assign sorted = site.snippets | sort: 'date' | reverse %}
    {% for snippet in sorted  %}        
    <div class="entry">
    <h3><a href="{{ snippet.url | prepend: site.baseurl }}">{{ snippet.title }}</a></h3>
    <span class="post-date">{{ snippet.date | date: "%B %d, %Y" }}</span><br>
    <p>{{ snippet.description }}</p>
    </div>{% endfor %}
</div>
