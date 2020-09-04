---
title: Recently
permalink: /recently/
---

# Recently

<p>Subscribe with <a href="{{ site.baseurl }}/feed.xml">RSS</a> to keep up with the latest news.

{% for post in site.posts limit:10 %}
   <div class="post-preview">
   <h3><a href="{{ site.baseurl }}{{ post.url }}">{{ post.title }}</a></h3>
   <span class="post-date">{{ post.date | date: "%B %d, %Y" }}</span><br>
   {% if post.badges %}{% for badge in post.badges %}<span class="badge badge-{{ badge.type }}">{{ badge.tag }}</span>{% endfor %}{% endif %}
   {{ post.excerpt }}
   </div>
   <hr>
{% endfor %}

Want to see more? See the <a href="{{ site.baseurl }}/archive/">News Archive</a>.
