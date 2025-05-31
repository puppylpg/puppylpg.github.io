---

layout: post  
title: "CompletableFuture"
date: 2025-05-31 16:17:39 +0800  
categories: Java Executor  
tags: Java Executor

---

ListenableFuture是Guava里拓展了Future的接口，增加了回调行为，所以要比Future更强大。Guava建议在任何使用Future的场合都使用ListenableFuture取代Future，也是比较有道理的。

1. Table of Contents, ordered
   {:toc}

# 任务执行后的回调
