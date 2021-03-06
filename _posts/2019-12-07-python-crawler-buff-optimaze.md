---
layout: post
title: "爬取网易buff CSGO饰品数据 - 优化篇"
date: 2019-12-07 12:37:20 +0800
categories: Python csgo
tags: Python csgo
---

继上周末搞了csgo饰品的爬虫之后，最近一周一直在根据社区小伙伴的意见建议进行优化。不得不说，玩家才是最好的产品经理，很多提出来的建议都让人为之一振，这也直接优化了最终的程序效率、实现方式等，同时也增加了一些新的功能。在这里就以优化篇记录一下本周进行的优化流程吧。

1. Table of Contents, ordered                    
{:toc}

# 思路回顾
[爬取网易buff CSGO饰品数据]({% post_url 2019-12-02-python-crawler-buff %})

# 配置优化
先说个功能性不那么强，但直接关乎程序上手热度的更新吧。

配置这问题确实之前没太关注过，自己给自己写程序，更关注的是功能。和后端程序猿做出来的前端一样：能用就行，要啥自行车。不过一旦想推广自己的程序，尤其是在游戏社区中推广，一个良好的UI是极其重要的。在这里，就是自定义配置的方式。

之前写Python一贯的配置方式是直接在一个统一的变量文件中修改变量，比如`definitions.py`，虽然是专门定义配置的地方，但是免不了定义的变量和一些简单的处理变量的逻辑交织在一起，对一些刚接触工程的人其实是不甚友好的。所以上周发布不久就优先更新了配置的方式。

这里配置使用的是python的configparser，依旧在`definitions.py`里处理变量，但是配置源设定在`config/config.ini`中，可以让用户专心只做自己心仪的配置，不需要思考太多东西，对于发布出去的程序来说，的确是一个非常重要的更新。

## RawConfigParser
有小伙伴使用发现`configparser.ConfigParser()`会转义一些特殊字符，比如百分号，这个在我自己使用的时候确实没有发现。查了一下，使用`configparser.RawConfigParser()`就不会对字符进行转义了。

## 处理配置列表
有一些参数需要配置为列表，但是是以string的形式读进来的。之前面对`[a, b, c, ..., n]`这种列表形式的string我都是掐头去尾再将元素一个一个split出来，后来看别人的建议，`json.loads('[a, b, c, ..., n]')`直接就解析为list了，确实方便。python对json的支持的确挺好的，写着写着就发现，python确实是一门有趣的语言。

# 价格取舍
之前取steam售价的时候，使用的是去掉一个最高价一个最低价。但是考虑程序的初衷：使用底价从buff收饰品，丢到steam市场卖掉。经社区老哥提醒，像多普勒这种饰品，溢价的很多，很有可能均价是被拉的偏高的。显然如果buff底价收的多普勒，不可能在steam有这么高的价格。（唉，不碰那些玄学饰品，果然就考虑不到这些）

所以后续更新该用历史售价的.25作为steam售价，这种情况应该会缓解很多。同时，这么做也相当于压低了收益期望值，真实获益也许会比算出来更高一些。

# 价格过滤
这是一个比较重要的更新，对爬取时间产生了重大影响。

一开始做价格筛选的时候，思维比较直：爬取所有物品，筛选出在用户自定义价格区间内的物品，然后分析。

后来经过社区老哥提醒，可以直接使用buff的价格筛选功能！buff是有数据库的，他们筛选起来肯定贼快，我们使用buff带加个筛选的api请求物品，这样只需要爬取这些物品就行了，不用每次都先把所有饰品爬取一遍，大大提升了程序效率。把buff当做工具人，成了！

用了和之前同样的分析方法，发现加个筛选其实就是在之前请求物品的api上增加三个参数：
- `sort_by`：取值如`price.desc`;
- `min_price`
- `max_price`

不用多说，含义自明。这样请求所有100到200的饰品，只需要：`https://buff.163.com/api/market/goods?game=csgo&page_num=99999999&sort_by=price.desc&min_price=100&max_price=200`就行了。

不过这里还是有个奇葩的地方，注意到上面url里的99999999了吗？不得不说buff的区间筛选API很是清奇，限定价格之后，返回的`page_num`和`page_size`竟然都是错的。也就是说返回的数据并不能告诉我们在这个价格区间内一共有多少页共计多少饰品。然鹅机智的我发现，如果将page number设定为超出实际页数的值，这两个数据就会变成正确值。

比如，98~99.9的饰品共计3页42件，但是返回值告诉我们一共有720页14388件，而这实际是buff现售物品总数，并不是价格筛选后的件数。
想获取准确值3页42件，只需给page number设定为超出3的值即可，所以我用了`sys.maxsize`，一个巨大无比的值。

# 饰品类别限定
饰品类别限定也是一项比较大的更新，主要是引入了这项功能之后，系统实现又被调整了。

增设类别限定，可以配置自己**只想**爬取的类别（白名单）或者**不想**爬取（黑名单）的类别。

**白名单优先级高于黑名单优先级。**

所以规则如下：
- 如果黑白名单均未设置，默认爬取所有类别，所有类别参考`config/reference/category.md`；
- 如果设置了白名单，仅爬取白名单类型饰品；
- 如果只设置了黑名单，则爬取除了黑名单之外的所有物品；

比如：
```
category_white_list = ["weapon_ak47", "weapon_m4a1", "weapon_m4a1_silencer"]
category_black_list = ["weapon_m4a1"]
```
则最终会爬取AK、M4A1、M4A4三种物品。

> NOTE: M4A1游戏代号为"weapon_m4a1_silencer"、M4A4游戏代号为"weapon_m4a1"。
> 不要问为什么，我猜是V社员工一开始起名的时候没想好，后来由于兼容性等原因不好改了。那咋办嘛，就这么用着呗。

**类别名称一定不能写错了（建议复制粘贴），否则buff直接返回所有类别的物品……什么鬼设定……**

## 内部实现优化：结合价格筛选和饰品类别筛选
这样设置类别和不设类别就有了两套实现：
- 如果未设定爬取类别，则不分类别直接爬取价格区间内的所有物品；
- 如果设定了爬取类别，依次爬取有效类别内所有符合价格区间的物品；

价格区间筛选的时候是不分类别直接爬取的，但是设定类别之后又要按照类别爬取，二者能不能结合成一套实现呢？即设定价格区间时，也按照类别请求各个类别在价格区间内的饰品。

继续去buff上同时加上价格和类别筛选，发现发送的api接口里多了一个参数：
- `category`

只要把饰品类别填入category就行了。

> 感觉再试下去，我要把buff所有对外接口的参数都试完了……

那么现在想要筛选100-200之间的ak，只需要请求`https://buff.163.com/api/market/goods?game=csgo&page_num=99999999&sort_by=price.desc&min_price=100&max_price=200&category=weapon_ak47`就行了。

通过这个接口，我也得以将两种实现合二为一。有价格筛选的时候就带上价格的参数，有类别筛选的时候就带上类别的参数，一种实现就搞定了。

# 其他限定？
有老哥问能不能加磨损之类的筛选？加当然可以加，也不难，不过这个程序的本意是从buff底价买饰品卖到steam换余额，也不是买来玩的，磨损这种东西不用很在意。

所以感觉做程序还是不要背离初衷，不然功能加来加去，成了一个庞大的集合体（再加就加成一个buff了……），功能越来越多，代码越来越不好维护，80%的功能却基本用不到，那和互联网公司80%的产品经理做出来的破玩意儿有什么区别！

# 命名
程序经过一个星期的优化，完成了我一开始设想的功能，甚至很多地方超出了我的期待（当然离不开社区小伙伴的意见建议，非常感谢）。那么给它起什么名字呢？之前临时命名的`buff_csgo_skin_crawler`实在太丑了，丝毫没有灵魂。一个用心做的程序，值得用心取一个好名字。

翻开神奇宝贝图鉴，童年的一幕幕再次浮上心头，终于走路草映入了我的眼帘：[During the daytime, Oddish buries itself in soil to absorb nutrients from the ground using its entire body.](https://www.pokemon.com/us/pokedex/oddish)

有两个寓意很贴切：
1. 白天沉睡，夜晚潜行，符合爬虫行为举止如履薄冰；
2. 走路草，在网页上走来走去，收集所有信息；

那就将其命名为oddish吧。

![oddish](https://assets.pokemon.com/assets/cms2/img/pokedex/full/043.png)

走路草，白天沉睡，夜晚潜行，我来过，并将信息镌刻在深深的记忆里。

[Hello, I'm oddish.](https://github.com/puppylpg/oddish)

# The End
原来写代码真的可以有趣到一下班回家不顾疲惫就迫不及待开始完成前一天留下的TODO，可以为了在睡觉前（半夜十二点甚至更晚，所以是不是可以称之为“新的一天”）发布新的更新而不玩游戏。虽然这还不是什么大的工程，不是什么真正有意义的开源项目，但是这的确是我的兴趣所在，真的开心。

如果没有其他什么特别的需求，该工程大概可以archive了。欢迎感兴趣的小伙伴github围观，star，fork，提出意见和建议，有趣的需求我会继续更新。

