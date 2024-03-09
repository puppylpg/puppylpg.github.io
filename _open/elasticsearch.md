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
当时用的elasticsearch 7.17.6有[一个bug](https://github.com/elastic/elasticsearch/issues/85221)，在enrich index过大，enrich时间过长的时候，会出现新的enrich索引还没生成好，老的enrich索引就被删掉的情况，导致系统里的enrich pipeline找不到enrich索引。要解决这个问题，除了要修复enrich策略本身之外（在[#85221](https://github.com/elastic/elasticsearch/issues/85221#issuecomment-1488108528)里被修复），还要解决elasticsearch直接把内部的NPE异常抛出来的问题，这会让用户摸不着头脑。所以这个pr修正了这一点，主动做NPE校验，为用户抛出一个合理的异常，让用户知道出错的原因是enrich索引找不到了。

> 测试用例不错，展示了enrich cache的作用。
{: .prompt-tip }

## [#105823](https://github.com/elastic/elasticsearch/pull/105823)
修改的内容很小，但问题本身比较有意思。之前也好奇过Java的中文异常信息是怎么打出来的，虽然知道和locale相关，但具体要怎么调整就不清楚了。本次正好趁着这个问题，搞清楚了起作用的原来是`LANGUAGE`环境变量。

另外，这个问题也引入了对[随机locale](https://github.com/elastic/elasticsearch/issues/105822#issuecomment-1966829814)的讨论，虽然最终证明并不相关，但了解到了elasticsearch故意用的随机locale来进行测试，**以应对各种可能但又不太可能穷举的情况**。而这正是[randomizedtesting](https://github.com/randomizedtesting/randomizedtesting)被引入的[意义](https://github.com/randomizedtesting/randomizedtesting/wiki/Core-Concepts)。

> 通过seed可以复现某次失败的随机条件，很有用！
{: .prompt-tip }

