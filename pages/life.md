---
layout: page
title: Life
permalink: /life/
---

# Life

一点小兴趣，一点小快乐

<div class="section-index">
    <hr class="panel-line">
    {% assign sorted = site.life | sort: 'date' | reverse %}
    {% for life in sorted  %}        
    <div class="entry">
    <h3><a href="{{ life.url | prepend: site.baseurl }}">{{ life.title }}</a></h3>
    <span class="post-date">{{ life.date | date: "%B %d, %Y" }}</span><br>
    <p>{{ life.description }}</p>
    </div>{% endfor %}
</div>
