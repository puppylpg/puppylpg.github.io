---

title: "【已废弃】ListenableFuture"
date: 2020-06-03 02:30:06 +0800
categories: [java, executor]
tags: [java, executor, listenablefuture]
description: "旧版 ListenableFuture 笔记入口，正文已迁移到 2025 年的 Guava ListenableFuture 文章。"

---

ListenableFuture是Guava里拓展了Future的接口，增加了回调行为。所以要比Future更强大。Guava建议使用ListenableFuture取代Future。而且，看ListenableFuture的实现过程，也能让人获益良多。

1. Table of Contents, ordered
{:toc}

[guava ListenableFuture]({% post_url 2025-05-31-listenable-future %})

# 总结
通过对ListenableFuture的学习和对源码的阅读，感觉异步这一块儿变得相当通透了！Guava牛逼（破音）~
