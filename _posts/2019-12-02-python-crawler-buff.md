---
layout: post
title: "爬取网易buff CSGO饰品数据"
date: 2019-12-02 00:48:05 +0800
categories: Python csgo
tags: Python csgo
---

最近steam游戏疯狂打折，然鹅我的steam里余额只有可怜的几块钱，想充点儿钱买游戏，直接1:1充值人民币进steam感觉有点儿亏，想买充值卡，但是充值卡毕竟黑产，而且最近大家对充值卡的需求一高，充值卡店铺都变得特别傲娇，发货时间竟然是48天以内……想想前一段csgo裂网大行动，也是steam没有余额通行证，不得不直接拿现金1:1买了，甚是心疼。所以我在想，要不从第三方网站买个饰品，再高价卖到steam？虽然扣掉手续费之后，差价也没剩多少了，但是至少比直接往steam充人民币值一些吧。那么问题来了，买哪个皮肤卖到steam里更赚一些呢？总不能一个一个人肉去比价吧。不如就搞个爬虫自动算一下。就算不赚钱，使用程序搞了一件自己喜欢的事情，虽然并不是多难的东西，至少也算是可以跟狐朋狗友吹逼的东西嘛。

想通过这种方法赚钱是不可能了，像这些第三方平台本身就是搞这个的，哪个饰品如果真的通过倒卖有赚头，他们肯定直接就截胡了。所以首先我们报的最高期待就是：在不买充值卡的情况下，从第三方平台买一件饰品卖到steam，哪个能更赚steam余额。

这个第三方平台，就选网易buff吧。

1. Table of Contents, ordered                    
{:toc}

# 需要的东西
想达到上述目的，大概需要知道以下数据：
- 所有皮肤；
- 每件皮肤在buff的最低价；
- 每件皮肤在steam的价格；

然后就可以算差价，再扣去大概13%的steam交易税，剩下的就是能赚到的steam余额差价了。最后除以我们实际花掉的钱，大概就是投资回报比。找一个回报比最高的皮肤，美滋滋。

# API
## 获取所有饰品
首先我们需要一个爬取buff上所有饰品的办法。

在`https://buff.163.com/market/?game=csgo#tab=selling&page_num=1`，随便打开一个饰品，比如鲍伊猎刀，观察它的访问按钮，网页显示的是`<li value="weapon_knife_survival_bowie">鲍伊猎刀</li>`，点击之后url是`https://buff.163.com/market/?game=csgo#tab=selling&page_num=1&category=weapon_knife_survival_bowie`。所以猜测它的访问办法就是前面的路径是`https://buff.163.com/market/?game=csgo#tab=selling&page_num=1&category=`，后面加上类别即可。试了一下果然就是这样。

那么我们只需要知道所有的category，挨个用这个url访问就行了。

好在这个并不难找，在每一个网页上，我们都可以看到所有的类别选择按钮，可以选择所有类别的皮肤：ak47、猎杀者匕首、usp等等。查看网页源码，可以看到这一块的内容为：
```
</div> <i class="icon icon_arr_right cru-market"></i> <span class="cru-market"><a href="/market/?game=csgo">饰品市场</a></span> <i class="icon icon_arr_right cru-filter" style="display:none;"></i> <span class="cru-filter" style="display:none;"></span> </div> <div class="market-list"> <div class="l_Layout"> <div class="market-header black"> <div class="h1z1-selType type_csgo" id="j_h1z1-selType"> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_type_knife"></i> <p value="knife">匕首</p> <ul class="cols"> <li value="weapon_knife_survival_bowie">鲍伊猎刀</li> <li value="weapon_knife_butterfly">蝴蝶刀</li> <li value="weapon_knife_falchion">弯刀</li> <li value="weapon_knife_flip">折叠刀</li> <li value="weapon_knife_gut">穿肠刀</li> <li value="weapon_knife_tactical">猎杀者匕首</li> <li value="weapon_knife_m9_bayonet">M9 刺刀</li> <li value="weapon_bayonet">刺刀</li> <li value="weapon_knife_karambit">爪子刀</li> <li value="weapon_knife_push">暗影双匕</li> <li value="weapon_knife_stiletto">短剑</li> <li value="weapon_knife_ursus">熊刀</li> <li value="weapon_knife_gypsy_jackknife">折刀</li> <li value="weapon_knife_widowmaker">锯齿爪刀</li> <li value="weapon_knife_css">海豹短刀</li> <li value="weapon_knife_cord">系绳匕首</li> <li value="weapon_knife_canis">求生匕首</li> <li value="weapon_knife_outdoor">流浪者匕首</li> <li value="weapon_knife_skeleton">骷髅匕首</li> </ul> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_type_pistol"></i> <p value="pistol">手枪</p> <ul class="cols"> <li value="weapon_hkp2000">P2000</li> <li value="weapon_usp_silencer">USP 消音版</li> <li value="weapon_glock">格洛克 18 型</li> <li value="weapon_p250">P250</li> <li value="weapon_fiveseven">FN57</li> <li value="weapon_cz75a">CZ75 自动手枪</li> <li value="weapon_tec9">Tec-9</li> <li value="weapon_revolver">R8 左轮手枪</li> <li value="weapon_deagle">沙漠之鹰</li> <li value="weapon_elite">双持贝瑞塔</li> </ul> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_type_rifle"></i> <p value="rifle">步枪</p> <ul class="cols"> <li value="weapon_galilar">加利尔 AR</li> <li value="weapon_scar20">SCAR-20</li> <li value="weapon_awp">AWP</li> <li value="weapon_ak47">AK-47</li> <li value="weapon_famas">法玛斯</li> <li value="weapon_m4a1">M4A4</li> <li value="weapon_m4a1_silencer">M4A1 消音版</li> <li value="weapon_sg556">SG 553</li> <li value="weapon_ssg08">SSG 08</li> <li value="weapon_aug">AUG</li> <li value="weapon_g3sg1">G3SG1</li> </ul> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_type_smg"></i> <p value="smg">微型冲锋枪</p> <ul class="cols"> <li value="weapon_p90">P90</li> <li value="weapon_mac10">MAC-10</li> <li value="weapon_ump45">UMP-45</li> <li value="weapon_mp7">MP7</li> <li value="weapon_bizon">PP-野牛</li> <li value="weapon_mp9">MP9</li> <li value="weapon_mp5sd">MP5-SD</li> </ul> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_type_shotgun"></i> <p value="shotgun">霰弹枪</p> <ul> <li value="weapon_sawedoff">截短霰弹枪</li> <li value="weapon_xm1014">XM1014</li> <li value="weapon_nova">新星</li> <li value="weapon_mag7">MAG-7</li> </ul> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_type_machinegun"></i> <p value="machinegun">机枪</p> <ul> <li value="weapon_m249">M249</li> <li value="weapon_negev">内格夫</li> </ul> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_type_hands"></i> <p value="hands">手套</p> <ul class="cols"> <li value="weapon_bloodhound_gloves">血猎手套</li> <li value="weapon_driver_gloves">驾驶手套</li> <li value="weapon_hand_wraps">手部束带</li> <li value="weapon_moto_gloves">摩托手套</li> <li value="weapon_specialist_gloves">专业手套</li> <li value="weapon_sport_gloves">运动手套</li> <li value="weapon_hydra_gloves">九头蛇手套</li> </ul> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_tool_sticker"></i> <p value="sticker">印花</p> </div> <div class="item w-SelType csgo_filter"> <i class="icon icon_csgo_type_other"></i> <p value="other">其他</p> <ul class="cols"> <li value="csgo_type_tool">工具</li> <li value="csgo_type_spray">涂鸦</li> <li value="csgo_type_collectible">收藏品</li> <li value="csgo_type_ticket">通行证</li> <li value="csgo_tool_gifttag">礼物</li> <li value="csgo_type_musickit">音乐盒</li> <li value="csgo_type_weaponcase">武器箱</li> <li value="csgo_tool_weaponcase_keytag">钥匙</li> <li value="type_customplayer">探员</li> </ul> </div> </div> <div class="criteria">
```
首先抓取该网页内容，掐头去尾，只留下中间的核心部分，然后用正则将类别全抠出来即可：
```
    prefix = '<div class="h1z1-selType type_csgo" id="j_h1z1-selType">'
    suffix = '</ul> </div> </div> <div class="criteria">'
    # to match all csgo skin categories
    category_regex = re.compile(r'<li value="(.+?)"', re.DOTALL)

    # entry page
    root_url = BUFF_ROOT + 'market/?game=csgo#tab=selling&page_num=1'

    print("GET: " + root_url)
    root_html = http_util.open_url(root_url)

    remove_prefix = root_html.split(prefix, 1)[1]
    core_html = remove_prefix.split(suffix, 1)[0]

    # all categories
    categories = category_regex.findall(core_html)
```
这里我们抠的是所有的类别，比如`weapon_negev`代表内格夫，`weapon_sg556`代表帅哥553，`weapon_deagle`代表沙鹰。

拼接url遍历所有类别，所有类别的皮肤我们就都得到了。

### 获取每一个类别的饰品
每访问一个类别，得到了什么呢？

比如浏览器访问`https://buff.163.com/market/?game=csgo#tab=selling&page_num=1&category=weapon_knife_survival_bowie`鲍伊猎刀的url，返回的是所有的鲍伊猎刀。本来还想用和上面同样的套路：看网页源码，用正则匹配出所有的鲍伊猎刀种类，然后抠出来。结果一看源码我人傻了：没有！网页上明明显示各式各样的鲍伊猎刀，但是网页源码里竟然没这些数据，只有一些类似于JSP那种嵌入网页的模板代码。像这种：
```
    <% } else { %>
    <div class="list_card unhover" id="j_list_card">
        <ul class="card_csgo">
            <% for(var i = 0; i < items.length; i++){ %>
            <li>
```
显然，浏览器是后来才将数据和模板组合起来的，显示成我们最终看到的完整的网页的样子。

但是！我不是前端啊！！！我哪知道它是用了什么技术，一窍不懂啊！对于我来说，爬东西最难的一关可能就是怎么找到API，哪个API对应哪些数据的获取方式。后面的流程，通过这些API去获取数据，处理数据，问题都不大，实在不行可以查嘛。但是前端的东西，我连用啥关键词查都不知道，这才是最绝望的！这也是我很久前就想搞这个，却始终没有搞的原因。

（2019年12月7日12:47:37增补：后来知道原来这就是ajax，查看网页源码看到的只能是原始网页模板，但是网页上的内容是模板+数据渲染后的样子，也就是说，看到的内容和网页的源码不再相同了。如果有兴趣，可以使用chrome的[toggle javascript插件](https://chrome.google.com/webstore/detail/toggle-javascript/cidlcjdalomndpeagkjpnefhljffbnlo?utm_source=chrome-ntp-icon)，开启插件后，网页将不会渲染js，网页源码将和看到的内容一致。）

绝望一会儿之后，想了想，既然是把数据渲染到页面模板上，那数据哪来的呢？只要找到数据了不就行了吗。打开浏览器的开发者模式，调到Network一栏，看到打开网页时浏览器请求了好多资源：图片、js、css脚本等等等等。仔细从上到下翻了半天，突然看到一个叫`goods.json`的东西！！打开一看，这不就是我心心念念的数据嘛！一条条鲍伊猎刀的数据清清楚楚地记录在json里：
```
{
  "code": "OK", 
  "data": {
    "items": [...],
    "page_num": 1, 
    "page_size": 20, 
    "total_count": 115, 
    "total_page": 6
  }, 
  "msg": null
}
```
items是个数组，记录着20条鲍伊猎刀的数据，下面的`page_size`就是说这20条数据，`total_count`表明总共有115条鲍伊猎刀的数据，`total_page`说明总共有6页，而这正是第一页`page_num`为1。

开心到飞起啊！这么一来，甚至都不需要用正则抓网页数据了，直接请求这个数据就行了！它的API是`https://buff.163.com/api/market/goods?game=csgo&page_num=1&category=weapon_knife_survival_bowie`，既然可以知道总共6页，把url中的`page_num`从1遍历到6，所有115条鲍伊猎刀的数据不就全有了吗！

再细看items里的鲍伊猎刀数据记录：
```
      {
        "appid": 730, 
        "bookmarked": false, 
        "buy_max_price": "1080", 
        "buy_num": 15, 
        "description": null, 
        "game": "csgo", 
        "goods_info": {
          "icon_url": "https://g.fp.ps.netease.com/market/file/5a9fbae6a750140659fd6620ozKc0tIl", 
          "info": {
            "tags": {
              "exterior": {
                "category": "exterior", 
                "internal_name": "wearcategory0", 
                "localized_name": "\u5d2d\u65b0\u51fa\u5382"
              }, 
              "quality": {
                "category": "quality", 
                "internal_name": "unusual", 
                "localized_name": "\u2605"
              }, 
              "rarity": {
                "category": "rarity", 
                "internal_name": "ancient_weapon", 
                "localized_name": "\u9690\u79d8"
              }, 
              "type": {
                "category": "type", 
                "internal_name": "csgo_type_knife", 
                "localized_name": "\u5315\u9996"
              }, 
              "weapon": {
                "category": "weapon", 
                "internal_name": "weapon_knife_survival_bowie", 
                "localized_name": "\u9c8d\u4f0a\u730e\u5200"
              }
            }
          }, 
          "item_id": null, 
          "original_icon_url": "https://g.fp.ps.netease.com/market/file/5a7abfad8b74278e3ebd85d32JbeFRZR", 
          "steam_price": "275", 
          "steam_price_cny": "1933.97"
        }, 
        "has_buff_price_history": true, 
        "id": 42495, 
        "market_hash_name": "\u2605 Bowie Knife | Marble Fade (Factory New)", 
        "market_min_price": "0", 
        "name": "\u9c8d\u4f0a\u730e\u5200\uff08\u2605\uff09 | \u6e10\u53d8\u5927\u7406\u77f3 (\u5d2d\u65b0\u51fa\u5382)", 
        "quick_price": "1134.5", 
        "sell_min_price": "1135", 
        "sell_num": 297, 
        "sell_reference_price": "1135", 
        "steam_market_url": "https://steamcommunity.com/market/listings/730/%E2%98%85%20Bowie%20Knife%20%7C%20Marble%20Fade%20%28Factory%20New%29", 
        "transacted_num": 0
      }
```
信息量真的丰富啊，和网页上显示的内容比对一下，每个字段的含义就很清晰了：饰品名称、当前最低售价、最高求购价、steam最低售价、steam访问该刀的URL等等信息一应俱全！

成了！所有饰品，所有饰品的buff最低售价都有了，只差steam价格了！

## 获取所有饰品的steam售价
上面的item里的`steam_price_cny`已经给出steam最低售价了。我一开始也是拿这个价格算的，但是存在两个明显的问题：
1. buff的这个数据并不是实时更新的，这个价格并不是当前steam的最低售价；
2. 另一个比较严重的问题是，steam最低售价并不是真正能卖出去的价格啊！

比如我算出来一把刀能收益好几倍，是因为steam上那个类别就挂了那一把刀，挂了1w+，但是实际求购价才1000多。所以这把刀卖这个价格实际并不会有人买。以这个价格算倒卖到steam能赚的差价是不合适的：真拿到steam上按这个价格卖，是卖不出去的。

那咋办嘛！再去爬steam，找交易记录，爬下来最近的交易价格，应该差不多。但是这工作量一下子就翻倍了呀，从爬一个网站到爬两个网站。而且steam那么大的网站，反爬机制应该做的相当完善吧，爬起来难度应该比buff大不少。

要不继续按buff提供的现成的steam最低价格？但是这样算出来也太不准了，实际可操作性没了。

踌躇不决之际，作为buff老用户的我突然想到了buff在每种饰品的价格走势里有steam价格走势。那个数据哪来的？有了那个数据不就能知道steam上该饰品最近交易的价格了嘛！

去buff上点开“流浪者匕首（★） | 表面淬火 (崭新出厂)”，用找饰品信息`goods.json`的方法继续翻开发者模式中的Network，果然找到了一个叫做`price_history.json`的东西：
```
{
  "code": "OK", 
  "data": {
    "currency": "\u7f8e\u5143", 
    "currency_symbol": "$", 
    "days": 7, 
    "price_history": [...],
    "price_type": "Steam\u4ef7\u683c", 
    "steam_price_currency": "\u7f8e\u5143"
  }, 
  "msg": null
}
```
里面的`price_history`就是steam最近7天里，每一件“流浪者匕首（★） | 表面淬火 (崭新出厂)”的详细交易价格！！！当然是dollar，问题不大，乘以汇率就是人民币价格了。

它的url是`https://buff.163.com/api/market/goods/price_history?game=csgo&goods_id=776332&currency=&days=7`，看了看，比较复杂的就是`goods_id`了。这把刀在buff的id是776332。如果我知道所有饰品的id，然后替换到这个url里，就能查到所有饰品的steam最近交易价格了！

这个id并不难找，在上面爬每一个饰品的信息的时候，里面就有`id`一项，试了一下，把id 42495换到url里，果然就是“`Bowie Knife | Marble Fade (Factory New)`”的交易价格记录。

完美！前后端分离真的是舒服！数据和模板分开，方便了后端开发，也方便了我这个爬数据的人 :D

## 总结一下
上面说的访问category的url和访问steam历史价格的url：
```
BUFF_ROOT = 'https://buff.163.com/'

BUFF_GOODS = BUFF_ROOT + 'api/market/goods?'
category_url = BUFF_GOODS + 'game=csgo&page_num=1&category=%s' % category

BUFF_HISTORY_PRICE = BUFF_ROOT + 'api/market/goods/price_history?'
BUFF_HISTORY_PRICE_CNY = BUFF_ROOT + 'api/market/goods/price_history/buff?'
STEAM_HISTORY_PRICE_URL = BUFF_HISTORY_PRICE + 'game=csgo&goods_id={}&currency=&days=7'.format(item_id)
```


在我看来，最困难的数据问题解决了，下面就简单多了，全是爬虫的一些通用的技术问题，实在不会可以Google嘛，终归是有迹可循的。能查的问题，那就不是无解的难题。

# 模拟登录
如何登录是一个难题，毕竟直接访问上面的那些url，都是让你登录。不经过登录认证是不会返回真正的数据的。

怎么登录呢？又是一个前端相关的问题。问题不大，查总会吧。最终我选了最简单的一种：使用登录后的cookie。

大致原理就是：http是无状态的，服务器怎么知道我登陆了没有？那就是在我登陆之后给我一个cookie，后面每次访问服务器，都拿着这个cookie，这样服务器就能将每一次的访问都和我联系起来，构成了有状态的访问记录。

那就好办了，先使用账户登录到buff上，开发者模式找到cookie，然后粘到程序里，程序一直拿着这个cookie访问数据，就能得到真正的数据了。浏览器只知道我向它请求了这个api，我再把浏览器的User-Agent粘到程序里，服务器哪里分的清这次对url的访问是我的浏览器发出的还是我的程序发出的！

但是这么做也有个很大的弊端：比如关机了，下次爬的时候，这个cookie肯定过期了，还得浏览器再登陆一次，把新的cookie粘到程序里。

所以嘛，简单的办法生效快，但是以后用的时候流程就会麻烦一些。其他一些更高级的办法自然能解决这个问题，比如把账号密码扔到程序里，让程序每次模拟登陆。但是考虑到buff在登陆时还有网易易盾验证（就是那个拖动滑块到图片缺失的位置），所以应该还挺麻烦的。这种或者其他更高级的办法以后有机会再探索吧。目前先用粘cookie这种简单有效的办法解决了。

参阅：
- https://www.cnblogs.com/chenxiaohan/p/7654667.html
- https://www.cnblogs.com/jiayongji/p/7143662.html

# 防止ip被封
爬虫嘛，你老爬人家，自然对服务器造成了远大于正常操作的访问压力。被封也挺正常的。所以怎么才能做到爬数据还不被封呢？

我先进行了简单的尝试：慢慢爬。

只要我不贪心，每1-2秒才爬一次，是不会对服务器造成额外的压力的，服务器可能就不会封我。试了下，果然buff并没有封禁我的爬虫，爬的很顺利，就是略慢。csgo有10000多点儿饰品，每爬一次大概20个，那差不多要爬500-700次，二十分钟以内基本是搞定了。

但是再加上steam历史价格，每个饰品都要爬一次，10000多条饰品要怕10000多次……爬取量一下子翻了好几十倍，这样就太慢了……所以我后来又加了一些限制，比如价格高于100的才爬售价纪录，其他饰品直接忽略了等等。这样就把饰品数量从10000多点儿降到了3500种左右。当然这是后话。

我也尝试了使用代理，如果使用代理，就类似于我委托了一批人以他们的身份去请求数据，假设我委托了100个人，每个人爬30多次，就能爬完所有3500条记录了。每人30多次的数量很小，不用非得战战兢兢等一两秒才敢爬一次。这样的话很快就能爬完所有数据了。

python中使用代理的做法参阅：
- https://www.scrapehero.com/how-to-rotate-proxies-and-ip-addresses-using-python-3/

但是问题在于我去哪儿找代理？国内外都有一些免费的代理网站，我试了一下，质量实在不敢恭维，好多根本ping不通，更别提当做代理服务器用了。找一两个都不容易，找一堆更是难上加难。如果只是找一两个，那和我不找代理又有什么区别。但是花钱买高质量代理？算了算了，不至于。

获取免费代理的方法参阅：
- https://blog.csdn.net/weixin_43968923/article/details/86682068

所以这个问题最终又用了最简单的解决方案：还是自己一个人爬，一两秒爬一次就行了。

（但是后来试了下还是有些问题的，似乎buff对单个ip有访问数量上限限制？爬取每个饰品的价格实在需要访问太多次服务器，一天如果爬一两次，往后爬着爬着就爬不动了。这个问题日后再解决吧。）

唉，一杯茶，一根烟，一个ip爬一天……

延伸阅读：
- https://www.scrapehero.com/how-to-prevent-getting-blacklisted-while-scraping/

# 其他问题
## 价格区间限制
基于上述单ip每隔一两秒爬一次的设定，爬取大于100块的饰品，总共3500种左右，条目API加上价格API，大概4000多次爬取，老牛拉破车爬了俩小时……
> END: 2019-12-02 02:30:05.096589. TIME USED: 2:06:13.511323.

所以我最终决定设定个价格区间，卡100-300块钱之间的（价格再高我也懒得买来扔到steam里卖了，往steam里放那么多钱干啥……我这么穷的人……）

## 平均售价
关于steam历史平均售价，这里是去掉一个最高价，去掉一个最低价，剩下的再取的均价。

## 多次爬取
默认第一次爬取之后，后面的爬取优先使用之前爬取并保存的本地数据。除非：
- 配置强制爬取；
- 超出了时间范畴。例如以天为单位，到了第二天运行时就会从网站爬取；如果配置以小时为单位，则下一个小时再爬取时就会从网站上爬。

## 冷门饰品过滤
7天在steam上都卖不了超过10次的饰品，这里就不考虑了。

## 关于steam饰品卖到buff
这个功能也有，但是感觉意义不大所以没有继续完善，毕竟steam的饰品第三方交易的话需要7天cd，7天后可能一切都变了，所以这个看看就行，不必当真。

# 结论分析
下面贴一些程序自动分析出的结论吧，还是很好玩的：
```
buff买steam卖：
单位价钱收益最大——
```
首先，今天（2019年12月2日）如果buff买饰品卖到到steam里：
```
               price     sell_num  steam_predict_price  buy_max_price            gap  gap_percent  history_sold  history_days  average_sold_price  average_sold_price_after_tax
count    3319.000000  3319.000000          3319.000000    3319.000000    3319.000000  3319.000000   3319.000000    3319.00000         3319.000000                   3319.000000
mean     1786.190196    46.145224          2049.202932     783.597349      -7.213430     0.271601     11.023501       5.18831          865.545202                    753.024326
std      8102.147813   141.030682          4562.658929    1686.629342    5490.225566     0.636890     22.424101       3.06634         1196.959990                   1041.355192
min       100.400000     1.000000           100.500000       0.000000 -149010.300000    -0.993402      0.000000       0.00000            0.000000                      0.000000
25%       399.000000     3.000000           581.775000     130.000000      21.348496     0.066383      0.000000       0.00000            0.000000                      0.000000
50%       720.000000     9.000000          1087.240000     420.000000     125.949400     0.234745      3.000000       7.00000          543.602500                    472.934175
75%      1388.440000    35.000000          2124.020000     850.000000     371.753469     0.366613     11.000000       7.00000         1129.726111                    982.861717
max    300000.000000  3318.000000        175815.000000   40000.000000   19363.000000    16.173575    162.000000       7.00000        12114.130000                  10539.293100
```
刚刚说了，大于100块钱的饰品总共有3319种。过滤掉七天内在steam上还没卖掉10件的冷门物品：
```
After threshold(history_sold >= 10) filtered: 
              price     sell_num  steam_predict_price  buy_max_price          gap  gap_percent  history_sold  history_days  average_sold_price  average_sold_price_after_tax
count    903.000000   903.000000           903.000000     903.000000   903.000000   903.000000    903.000000         903.0          903.000000                    903.000000
mean     628.866235   125.530454           932.755083     554.158361   104.211634     0.185932     34.162791           7.0          842.618240                    733.077869
std      907.966593   247.951096          1169.944022     760.729292   312.992334     0.172418     33.085709           0.0          978.752596                    851.514758
min      100.400000     1.000000           105.420000       0.000000 -4905.176920    -0.920829     10.000000           7.0           72.710000                     63.257700
25%      203.250000    17.000000           282.535000     169.500000    23.564950     0.127844     14.000000           7.0          265.992983                    231.413895
50%      390.000000    47.000000           588.980000     342.000000    78.944555     0.229248     21.000000           7.0          547.512000                    476.335440
75%      702.500000   124.500000          1048.210000     637.500000   164.666248     0.288242     38.000000           7.0          990.052053                    861.345286
max    13888.000000  3318.000000         12623.310000   12000.000000  1488.952000     0.824527    162.000000           7.0        10325.084000                   8982.823080
```
还剩903件。

在这些饰品中，收益最高的有以下这些：
```
短剑（★） | 多普勒 (崭新出厂): 2204.9403249999996(steam average sold price after tax) - 1208.5(buff) = 996.4403249999996(beyond 82.45%). Sold 14 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Stiletto%20Knife%20%7C%20Doppler%20%28Factory%20New%29
鲍伊猎刀（★） | 多普勒 (崭新出厂): 1575.8979697674422(steam average sold price after tax) - 923.08(buff) = 652.8179697674422(beyond 70.72%). Sold 45 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Bowie%20Knife%20%7C%20Doppler%20%28Factory%20New%29
暗影双匕（★） | 多普勒 (崭新出厂): 938.4260704918031(steam average sold price after tax) - 567.0(buff) = 371.4260704918031(beyond 65.51%). Sold 63 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Shadow%20Daggers%20%7C%20Doppler%20%28Factory%20New%29
折刀（★） | 多普勒 (崭新出厂): 951.7136222222223(steam average sold price after tax) - 602.5(buff) = 349.2136222222223(beyond 57.96%). Sold 29 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Navaja%20Knife%20%7C%20Doppler%20%28Factory%20New%29
折叠刀（★） | 伽玛多普勒 (崭新出厂): 1774.8963959999996(steam average sold price after tax) - 1148.72(buff) = 626.1763959999996(beyond 54.51%). Sold 27 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Flip%20Knife%20%7C%20Gamma%20Doppler%20%28Factory%20New%29
爪子刀（★） | 伽玛多普勒 (崭新出厂): 3944.1749666666665(steam average sold price after tax) - 2567.0(buff) = 1377.1749666666665(beyond 53.65%). Sold 11 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Karambit%20%7C%20Gamma%20Doppler%20%28Factory%20New%29
猎杀者匕首（★） | 多普勒 (崭新出厂): 1355.3042207547169(steam average sold price after tax) - 898.0(buff) = 457.3042207547169(beyond 50.92%). Sold 55 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Huntsman%20Knife%20%7C%20Doppler%20%28Factory%20New%29
蝴蝶刀（★） | 多普勒 (崭新出厂): 4046.7939272727276(steam average sold price after tax) - 2700.0(buff) = 1346.7939272727276(beyond 49.88%). Sold 13 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Butterfly%20Knife%20%7C%20Doppler%20%28Factory%20New%29
猎杀者匕首（★） | 表面淬火 (破损不堪): 770.6362125000003(steam average sold price after tax) - 515.0(buff) = 255.63621250000028(beyond 49.64%). Sold 10 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/%E2%98%85%20Huntsman%20Knife%20%7C%20Case%20Hardened%20%28Well-Worn%29
```
短剑从buff买，然后卖到steam里最划算。（2019年12月7日12:51:08增补：这里其实不能这么算，毕竟多普勒，玄学刀，玄学武器可以忽略。后续更新使用价格的.25分位点价格，抛弃了均价，这种情况应该会缓解很多。）buff最低卖1208.5元，steam最近7天的平均售价扣完13%的税之后是2204.9，所以假设以这个价格卖到steam，能多出996.4的差价，收益82.45%！

嗯，貌似比充值卡还赚唉！充值卡50刀的大概228，收益率也才`(350-228)/228=53.5%`，这个收益率竟然达到了82.45%！不过最近7天才卖了14件，也许不是那么好卖。往下瞅瞅，暗影双匕收益率65.51%呢，而且最近七天卖了63件，稳啊！

收益最高的前50个基本全是刀、手套之类的，收益比较高且比较好卖的枪械类饰品是大姐姐：
```
AWP（StatTrak™） | 黑色魅影 (崭新出厂): 861.5006272727269(steam average sold price after tax) - 620.0(buff) = 241.5006272727269(beyond 38.95%). Sold 35 items in 7 days.
 steam url:https://steamcommunity.com/market/listings/730/StatTrak%E2%84%A2%20AWP%20%7C%20Neo-Noir%20%28Factory%20New%29
```
不过38.95%的收益率跟刀比起来还是差太远啊！

# 代码
最后最重要的，代码在哪儿？
- https://github.com/puppylpg/buff_csgo_skin_crawler

代码我放到自己的github上了，开源免费，具体采用什么开源协议我暂时还没空想，毕竟这两天忙里偷闲临时写的程序，先把基础功能搞上吧。后续视情况再慢慢完善完善。使用方法在README里已经（不完善地）写了写，有兴趣的小伙伴欢迎研究代码，顺便点个赞。能提个完善功能的Merge Request自然是最好不过的了。

最后说一句：搞这个纯属兴趣爱好，并不是为了倒卖饰品赚钱（当然也赚不了钱），更不是出于恶意，禁止恶意使用该爬虫，否则后果自负。同时不要爬的太频繁，给buff服务器造成太大压力。要不然被封了……爬虫何必为难服务器，服务器又何必为难爬虫呢……

> **First Rule: BE GOOD AND TRY TO FOLLOW A WEBSITE’S CRAWLING POLICIES. Don't crawl the website to often!**

# 后续更新
[爬取网易buff CSGO饰品数据 - 优化篇]({% post_url 2019-12-07-python-crawler-buff-optimaze %})

