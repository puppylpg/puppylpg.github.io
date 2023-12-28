---
title: elasticsearch
date: 2023-12-28 16:45:43 +0800
order: 3
---

- [my issue](https://github.com/elastic/elasticsearch/issues?q=is%3Aissue+author%3A%40me+)
- [my PR](https://github.com/elastic/elasticsearch/pulls?q=is%3Apr+author%3A%40me+)

1. Table of Contents, ordered
{:toc}

## [#99604](https://github.com/elastic/elasticsearch/pull/99604)
当时用的elasticsearch 7.17.6有[一个bug](https://github.com/elastic/elasticsearch/issues/85221)，在enrich index过大，enrich时间过长的时候，会出现新的enrich索引还没生成好，老的enrich索引就被删掉的情况，导致系统里的enrich pipeline找不到enrich索引。除了要被修复的enrich策略本身之外（在[#85221](https://github.com/elastic/elasticsearch/issues/85221#issuecomment-1488108528)里被修复），还有一个问题就是elasticsearch直接把内部的NPE异常抛了出来，让用户摸不着头脑。所以这个pr修正了这一点，主动做NPE校验，为用户抛出一个合理的异常，让用户知道出错的原因是enrich索引找不到了。

> 测试用例不错，展示了enrich cache的作用。
{: .prompt-tip }
