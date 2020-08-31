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
    {% for snippet in site.snippets  %}        
    <div class="entry">
    <h5><a href="{{ snippet.url | prepend: site.baseurl }}">{{ snippet.title }}</a></h5>
    <p>{{ snippet.description }}</p>
    </div>{% endfor %}
</div>
