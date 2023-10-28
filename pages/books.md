---
layout: page
title: Book
permalink: /books/
---

# Book

读书破万卷，下笔无神也快乐！

<div class="section-index">
    <hr class="panel-line">
    {% assign sorted = site.books | sort: 'date' | reverse %}
    {% for book in sorted  %}
    <div class="entry">
    <h3><a href="{{ book.url | prepend: site.baseurl }}">{{ book.title }}</a></h3>
    <span class="post-date">{{ book.date | date: "%B %d, %Y" }}</span><br>
    <p>{{ book.description }}</p>
    </div>{% endfor %}
</div>
