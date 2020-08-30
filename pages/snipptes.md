---
layout: page
title: Snippet
permalink: /snippets/
---

# Snippet

Welcome to the {{ site.title }} snippet pages! Here you can quickly jump to a 
particular page.

<div class="section-index">
    <hr class="panel-line">
    {% for snippet in site.snippets  %}        
    <div class="entry">
    <h5><a href="{{ snippet.url | prepend: site.baseurl }}">{{ snippet.title }}</a></h5>
    <p>{{ snippet.description }}</p>
    </div>{% endfor %}
</div>
