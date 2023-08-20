---
layout: post
title: "Unicode & UTF-n"
date: 2019-12-15 16:48:21 +0800
categories: Unicode UTF Java
tags: Unicode UTF Java
---

Unicode就是一个超大号字符集合，旨在将世界上所有现存的、曾有的符号（文字、数学、音乐等所有符号）囊括其中。它像一个Java的接口，只是规定了所有字符的编号，具体这些字符在使用、存储的时候用字节怎么表示，取决于各个字符编码。

1. Table of Contents, ordered
{:toc}

# Unicode
Unicode为每个字符赋予一个特定的编号（**code point，码点**）。这些码点一般用十六进制进行编号（而不是人类更熟悉的十进制），使用“U+”作为前缀。比如
- 第0x41个字符（或者用人类更熟悉的十进制来说，就是第65号字符），就是[大写字母A](http://unicode.org/cldr/utility/character.jsp?a=A)。
- “[皮](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=%E7%9A%AE&mode=char)”的码点是U+76AE，是第0x76ae个字符（或者说第30382个）。

**至于怎么用字节去表示这些字符，是各个字符集自己内部的事情，和Unicode无关。**

> 从这个层面来讲，可以将Unicode理解为Java的接口，所有的具体编码形式是它的实现类。

## plane
- Unicode每个面板有65536（0xFFFF）个编码点，**正好能用两个byte表示一个plane**；
- Unicode共有17个面板，编号为0-16，总区间为U+10FFFF（十六进制表示，17个FFFF）。（所以四个字节肯定可以表示整个Unicode）；
- Unicode的**最后一个码点为`U+10FFFF`**；
- 面板0被称为Basic Multilingual Plane（**BMP，基本多语言面板**），包含了最经常使用的字符。换句话说Unicode的前65536个码点囊括了当今几乎所有常用字符；
- 1-16号面板被称为**补充面板supplementary planes**；
- CJK作为中日韩字符，显然也在BMP中；

查看Unicode Plane及内容：
- https://en.wikipedia.org/wiki/Plane_(Unicode)#Overview
- https://en.wikibooks.org/wiki/Unicode/Character_reference/7000-7FFF

## BMP
![BMP字符组成](https://upload.wikimedia.org/wikipedia/commons/8/8e/Roadmap_to_Unicode_BMP.svg)

可看到CJK占了BMP的绝大部分。

如果使用两个字节，可以完整表示一个面板。一个字节能表示256个字符，两个字节是`256*256`，将BMP分成256个小格，一个小格就是一字节能表示的字符数。所以 **ASCII码（7bit，128个）全都包含在第一小格里**。

> 一开始，Unicode就只有一个面板，也就是0号面板，最多表示256*256=65536个字符，使用统一的16bit进行编码。（16bit正好表示完一整个面板）

# 字符编码
所有的字符都赋予了编号，从U+0000到U+10FFFF。但是在字节表示层面上，这些字符都是怎么用字节表示的呢？这就是字符编码要做的事情。比如UTF-8 Encoding。

那么为什么会有这么多字符集？都使用同一种不行吗？

比如，最简单的，Unicode空间下0x10FFFF个字符，使用21bit去表示是绰绰有余的。凑个整，使用四字节（32bit）编码Unicode完全够：每一个字符，都用四个字节来表示。

但是思路上的简单通常意味着使用上的代价。每个字符都用32bit表示，显然无论硬盘、内存，还是网络，在传输text的时候，使用的byte会极大地膨胀。

那咋办嘛？使用小于四个字节的空间，又编码不下这么多字符。

所以变长编码的作用就体现出来：比如使用一个字节的前7bit表示最常用的英文字符（ASCII），然后两个字节表示后续的拉丁字符，再接着用三个字符表示Unicode空间中紧随其后的CJK等等。

这样一来，**高频字符用很少的字节数表示（eg：1 byte），低频字符用很多的字节数表示（eg：4 byte），但是总体使用上，由于低频字符很少出现，相当于用了相对少的字节来表示了当前使用的字符**。

> 实际上UTF-8也并没有超过四个字节，因为Unicode 17个面板本来也用不完四个字节，21bit就够了。所以虽然使用了变长编码，UTF-8表示字符的最长字节数也没超过4。

好处：
- 好处当然是在能表示所有字符的同时，最大程度地节省空间；

缺点：
- 缺点自然就是这么一搞逻辑上就复杂了。变长编码比定长编码逻辑上更复杂，这是肯定的；
- 处理逻辑复杂了，总体速度上相应会慢一点，这也是无法避免的。

> UTF-32也不是完全没用，它的好处就是简单呀！一个字符与四个字节固定对应！所以可以用它来进行一些临时的内部的处理逻辑，比如检查字符串里的码点等，但是最终保存text的时候肯定不会拿它来存储的。

## UTF-8: use 8-bit code unit
名称由来：**Unicode Transformation Format-8bit（Unicode转化格式-8bit，UTF-8）**，是**用8bit作为表示字符的一个基本单元**。

> Ken Thompson发明的，**使用1-4个byte（8bit）表示Unicode的一个字符**。

### 表示方法

bytes used |	bits used |	First code point |	Last code point | Byte 4 |	Byte 3 |	Byte 2 |	Byte 1
--|--|--|--|--|--|--|--|
1 |	7 |	U+0000 |	U+007F | | | |	0xxxxxxx			
2 |	11 |	U+0080 |	U+07FF | | |	110xxxxx |	10xxxxxx		
3 |	16 |	U+0800 |	U+FFFF | |	1110xxxx |	10xxxxxx |	10xxxxxx	
4 |	21 |	U+10000 |	U+10FFFF |	11110xxx |	10xxxxxx |	10xxxxxx |	10xxxxxx


- **`ASCII`**：前128(0x7F)个字符（7bit）使用一个byte搞定，二进制表示形式为`0xxxxxxx`；
- **拉丁语系字母（希腊语、阿拉伯、古叙利亚等）**：接下来的一坨（1920个字符）使用两个byte，共计11bit搞定，二进制表示形式为`110xxxxx	10xxxxxx`；
- **中日韩CJK文字**：
- **不常用CJK、数学符号、历史符号、emoji**：

> 英文字符和CJK字符虽然都在BMP中，但是在UTF-8编码中英文字符是单字节表示，编到CJK时已经要使用三字节编码一个字符了！
> 
> **UTF-8用了1-3个byte才将BMP编码完毕！！！**

### 示例
如果用UTF-8表示“皮”，会表示为三个字节：11100111 10011010 10101110，十六进制表示为0x E7 9A AE。

> 如果用UTF-16表示它，会表示为两个字节：0x76 AE。
>
> 但是只是在“皮”上UTF-16比UTF-8省空间，如果表示英文，UTF-8一个字节就绰绰有余了，UTF-16还是得2个字节。

### 应用
UTF-8已经是最主流的编码，世界上90%+的网页的编码都是UTF-8。

### 字节序
UTF-8使用单字节作为编码的unit，所以不存在字节序问题。

因此，UTF-8可以没有BOM。不过UTF-8也可以使用`0xEF,0xBB,0xBF`作为字节序，仅仅是宣布：“老子是UTF-8”，并没有其他什么意义。不像UTF-16，如果没有BOM，就不知道字节究竟该怎么翻译了。

## UTF-16: use 16-bit code unit
同理，UTF-16其实就是以16个bit作为编码的一个单元，而16bit是两个字节，所以使用一个单元编码的字符占两个字节，使用两个单元编码的字符占四个字节。字节数一定是2的整倍数。

### 历史
UTF-16的由来需要追溯一下历史。

一开始，大家准备搞一个**统一字符集（Universal Character Set, UCS）**，来表示所有语言中使用的字符。其实和Unicode一个目的，只不过没设计好：一开始大家准备用个统一的规范，**所有字符都用两个字节编码**，这样一共可以编码2^16个字符。其实这就是Unicode中的第0号面板BMP（上面说过，一个面板能用两个字节一一对应表示）。**这样的话世界上只有一个字符集，UCS-2，码点空间为65536。**

然而65536还是有些太小了，世界上所有的符号加起来超出了这个范围。所以后来字符集扩充到Unicode，一共17块面板，需要`17*65536`的空间。

为了解决这个问题，后来延续了构造一个统一字符集的思路，**又提出了UCS-4，用4个字节编码一个字符**，这样一共可以编码`65536*65536`个字符，空间肯定是够了。

但是缺点也是显而易见的：所有的字符都用四个字节来表示，从UCS-2换成UCS-4，相当于文本的存储体积一下子膨胀为原来的二倍，这不太合理。

也可以认为这是定长编码 vs. 变长编码的战役：
- **UCS是定长编码的思路**，简单但费空间；
- 那只能使用变长编码了，UTF-16出现了。

### 编码方式
UTF-16和UCS-2一样，也采用两个byte作为一个编码的基本单元。

UTF-16的作为变长编码，变长的方式和UTF-8的思路不太一样：
- UTF-8是先用单字节编码字符，然后是双字节，然后三字节，最后四字节；
- UTF-16是用双字节编码字符，但是两个byte只够编码一块面板，所以让Unicode的第0块面板的一些码点不编码字符，而是用来组合出后面的字符。

比如，BMP中有65536个码点，如果只有65436个码点编码了字符（每个字符2 byte），剩下的100个码点没有编码字符，将这些码点分为前50个和后50个，那么“前_后”一共可以组合出`50*50=2500`个码点。只不过这2500个码点都是由2个unit，即4byte来表示的。这样UTF-16就能编码出65436+2500个字符，前65436个字符都是2 byte表示，后2500个都是4 byte表示。

上面只是一个示例，实际上Unicode除了BMP，还有16块面板，每块面板0xFFFF个码点，所以除了BMP一共还有0xFFFFF个码点需要编码，即2^20，`2^10 * 2*10`个。

将BMP中共计`2^10 + 2^10`个码点不编码字符，就可以组合后面需要的`2^10 * 2*10`个码点。**所以Unicode在BMP中预留了`0x3FF + 0x3FF = 0x6FF`个码点不编码字符**，使用这0x6FF个（2048个）码点，前后两两组合出了后面16个面板所需要的0xFFFFF个（1024 * 1024个）码点。

这两个0x3FF空间的码点，UTF-16选的是`0xD800-0xDBFF`和`0xDC00-0xDFFF`。

> BMP的字符都是2 byte表示，supplementary plane的字符都是4 byte表示。

延伸阅读：
- https://stackoverflow.com/a/47505451/7676237

### BMP代理区域
由于这特殊的两块空间的码点被用来组合出后面16块面板的码点，所以也被称为代理码点（Surrogate code point），`0xD800-0xDBFF`和`0xDC00-0xDFFF`分别被称为High-Surrogate和Low-Surrogate。

> `0xD800-0xDBFF`的前6bit是`110110`，`0xDC00-0xDFFF`的前6bit是110111，所以supplementary plane的四字节表示固定为：`110110** ******** 110111** ********`

显然，**代理区域是不会被编码上字符的**！要不然出现了代理区域的码点，究竟是代表一个字符，还是拿它去和后面的码点去组合出一个代理字符？**所以BMP的65536个码点并不能表示65536个字符**。

可以查看一下Unicode在BMP的码点 `0xD800-0xDFFF`，这一块确实没有编码任何字符：https://en.wikibooks.org/wiki/Unicode/Character_reference/D000-DFFF

参阅：
- https://en.wikipedia.org/wiki/UTF-16
- https://en.wikipedia.org/wiki/Universal_Coded_Character_Set

### 字节序问题：0xFEFF
UTF-16使用双字节（16bit）作为一个unit，所以存在字节序问题：一个unit的两个字节，谁放前面谁放后面？

为了解决这个问题，UTF-16编码的文件的前两个字节使用**字节序标记（Byte Order Mark，BOM）** 指定字节序。对于UTF-16来说，这个BOM就是`0xFEFF`：
- 如果头两个字节是`0xFE`和`0xFF`，则采用大端序（Big-Endian），此时的字符集又被称为 **`UTF-16BE`** 。eg: 对于两个字节`0x12345678`，大端序是`0x1234`后面跟着`0x5678`；
- 如果头两个字节是`0xFF`和`0xFE`，则采用小端序（Little-Endian），此时的字符集又被称为 **`UTF-16LE`** 。eg: 对于两个字节`0x12345678`，大端序是`0x5678`后面跟着`0x1234`；

另外值得注意的就是UTF-8不需要字节序指示，所以一旦出现0xFEFF或者0xFFFE，说明这不是UTF-8编码的文件。（可能是UTF-16，也可能是UTF-32）

参阅：
- https://en.wikipedia.org/wiki/Byte_order_mark
- http://www.fileformat.info/info/charset/UTF-16/list.htm

## UTF-32: use 32-bit code unit
UTF-32使用32bit（4 byte）表示一个字符。显然UTF-16就是**定长编码**了，因为就算按定长去编码，2^32^依然能表示出Unicode当前总共2^21^的编码空间。

诚然，使用UTF-32存储字符是非常费空间的，几乎是UTF-16的2倍，如果存储英文，占用空间是UTF-8的4倍。但是UTF-32并非一无是处，比如，想知道一个字符串中第N个字符的内容，直接查看第4N~4N+3这四个字节对应哪个字符就行了，所用时间是**常量级**的。但是变长编码就必须从头遍历才能判断第N个字符的内容，时间复杂度为O(n)。

> 但是由于组合字符的存在（两个Unicode码点组合出一个字符），UTF-32的定长也并不能说一个字符一定是4byte……所以也不能说UTF-32就一定能在常量时间对UTF-32编码的字符进行计数，只能对码点进行计数。这是Unicode的定义导致的（码点和字符并不一一对应）。

### 字节序问题
和UTF-16一样，UTF-32的基本单元（4 byte）也是跨字节的，所以也会存在字节序问题。使用BOM `0x 00 00 FE FF`和`0x FF FE 00 00`标志。

# 字符集比较
## 兼容性
UTF-8可以和ASCII兼容，UTF-16/32则不可以。

## 存储效率
- UTF-8存储前128个字符使用1 byte，后续的BMP码点分别是2 byte，3byte，supplementary plane是4 byte；
- UTF-16在BMP上恒为2 byte，supplementary plane是4 byte；
- UTF-32恒为4 byte；

所以UTF-8在存储英文的时候更高效，其他字符比如CJK则不如UTF-16。UTF-32黯然退出。

但是这并不意味着中国使用UTF-16编码网页会获得更高的性能：仅仅纯文字会。但是网页还有很多tag之类的东西，使用ASCII字符，所以整体上，就算是中文的网页，使用UTF-8也不一定比UTF-16更消耗空间。

## 优劣
各种字符编码方式似乎确有优劣之分，UTF-8应该更优秀（事实上从当今UTF-8的流行度上也能证明这一点）。具体参考[UTF-8 everywhere](http://utf8everywhere.org/)！

# 其他

## 码点和字符的对应关系
最后说一下，以上为了理解方便，姑且认为Unicode码点和字符是一一对应的。但实际上并不是所有的码点和字符都是一一对应的：
- 有的码点不对应字符，比如代理区码点、未编码字符码点；
- 多个码点可能代表同一个字符，比如Ω：[0x03A9](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=03a9&mode=hex)和[0x2126](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=2126&mode=hex)；
- 还有一些字符是两种字符组合出来的，所以这样的一个字符是Unicode的两个码点组合起来表示的；
- 上例也说明了，有的字符并不存在一个能代表它的码点；

总结一下就是：**字符和码点并没有什么关系。只是绝大多数情况下，字符和码点是一一对应的**。所以认为他们一一对应其实比较便于理解Unicode和字符编码的关系。

## NFC: Normalization Form C
`café`算几个字符？或者说几个码点？主要涉及到`é`，它可以是[字母e（U+0065）](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=e&mode=char)和[重音符号´（U+00B4）](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=%C2%B4&mode=char)组合出来的，也可以是[一个单字符é（U+00E9）](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=00e9&mode=hex)。是的，就是这么神奇……

对于组合情况，`café`总共有5个码点，UTF-8表示共有6个字节0x63 0x61 0x66 0x65 0xCC 0x81；对于非组合情况，共有4个码点，5个字节0x63 0x61 0x66 0xC3 0xA9。

所以具体是哪一种情况，需要看用的是Unicode的哪一种规范化形式。其中**NFC（Normalization Form C，标准化形式C）规定，碰到`é`这种字符时，当做1个码点处理**。

参阅：
- https://developer.twitter.com/en/docs/basics/counting-characters

# Java
## char
### 使用补充面板的字符

**Java中的char和码点是一一对应的。所以char并不和字符一一对应**，只是大多数情况下一个码点一个字符，所以大多数情况下一个char一个字符。

char**一开始是基于原始的Unicode，即UCS-2设计的，长度为2 byte**。所以即使后来Unicode扩充到了17个面板，**char还是只能表示BMP中的字符**。

如果想表示补充面板的字符，比如[emoji露齿笑，U+1F600](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=1F600&mode=hex)，要么直接使用代理对的码点：
```
        // use surrogate pair
        String smile0 = "\uD83D\uDE00";
        System.out.printf("simle0: %s%n", smile0);
```
要么指明露齿笑的码点，使用StringBuilder或者`Character.toChars()`将码点**转换成两个char，只能以String的形式保存（不能转换成char，因为一个char保存不下）**：
```
        int smileCodePoint = 0x1F600;
        
        // use StringBuilder code point
        String smile1 = new StringBuilder().appendCodePoint(smileCodePoint).toString();
        System.out.printf("simle1: %s%n", smile1);
        
        // use Character code point
        String smile2 = new String(Character.toChars(smileCodePoint));
        System.out.printf("simle2: %s%n", smile2);
```

也可以理解为，**BMP中的字符需要一个char，而supplementary plane中的字符需要两个char**！

所以说`Character.toChars(int codePoint)`将码点转成char，返回值是char数组而不是char：
> Converts the specified character (Unicode code point) to its UTF-16 representation stored in a char array. If the specified code point is a BMP (Basic Multilingual Plane or Plane 0) value, the resulting char array has the same value as codePoint. If the specified code point is a supplementary code point, the resulting char array has the corresponding surrogate pair.

参阅：
- https://stackoverflow.com/questions/9834964/char-to-unicode-more-than-uffff-in-java

### char转int
**char就是两个字节，转成int就是两个字节所代表的数值：**
- 对于char能表示的BMP中的字符，转成int就是码点值。比如“皮”U+76AE，转成int后是0x76AE；
- 对于char不能表示的补充面板的字符，比如U+2F81A（一个像“冬”但不是“冬”的文字。“冬”是CJK常用字，所以在BMP中），它的代理对是0xD87E 0xDC1A，转成int后实际是0xD87E，它是High-Surrogate。**也就是说将char不能表示的字符（实际是两个char）强行转成char时，char只能保存第一个char的内容，即前2个byte（High-Surrogate）**。

因此对于接收char作为参数的方法，如果传进来的字符是supplementary plane上的字符，实际只传进去了第一个码点（被截断了）：
```
    /**
     * char就是两个字节，转成int就是两个字节所代表的数值。
     *
     * BMP字符就是一个char，所以转成int就是码点值；
     * 补充面板字符是两个char，所以转成int分别是high/low surrogate的码点值。
     */
    private static void charToInt() {
        System.out.println("char to int: ");
        // 皮
        int piCJK = 0x76AE;
        // 76AE
        System.out.printf("char to int: %x%n", (int)Character.toChars(piCJK)[0]);

        // 冬，不是冬
        int notDongCodePoint = 0x2F81A;
        // high surrogate: D87E
        System.out.printf("char to int: %x%n", (int)Character.toChars(notDongCodePoint)[0]);
        // low surrogate: DC1A
        System.out.printf("char to int: %x%n", (int)Character.toChars(notDongCodePoint)[1]);
    }
```
因此接收char的方法判断会出错（因为判断的实际上不是这个字符，而是被截断的字符）。但是**接收int的方法不会截断该字符**。

## c的char 1byte，java的char 2byte
- c诞生的时候，ASCII看起来是够的。所以1byte够了；
- java诞生的时候，UCS-2，65536，2byte看起来是够的，所以用了2byte；
- 结果都不够，现在Unicode已经扩充到17个面板了。话说回来，如果现在让我设计一门语言，也许我内部的char用4byte表示了呢。然后N年后，外星人也来了，当把他们的语言也编进来的时候，他们会觉得4byte又不够表示了，他们肯定会问，为什么我的char不用8byte表示……

Ref:
- https://stackoverflow.com/a/9354024/7676237

## string.lentgh()
官方文档说String的length方法返回的是**Unicode code units的个数**：
> Returns the length of this string. The length is equal to the number of Unicode code units in the string.

由于char和code unit一一对应，所以也可以说返回的是char的个数。**实际上Java的String里面封装的就是一个char数组`char value[]`，用来保存数据**。`length()`方法返回的就是`value.length`。

因为char是UTF-16编码的，所以可以认为String也是UTF-16编码的。

补充面板的字符都需要两个char来表示，也就是两个code unit，所以**他们每个字符的length就是2**：
```
        // 一个像“冬”但不是“冬”的文字
        int notDongCodePoint = 0x2F81A;
        String notDong = new String(Character.toChars(notDongCodePoint));
        String dong = "冬";
        // length is 2
        System.out.printf("%s.length = %d, by code point. %n", notDong, notDong.length());
        // length is 1
        System.out.printf("%s.length = %d, by CJK word. %n", dong, dong.length());
```
所以“冬”作为BMP字符，length=1；补充面板中的那个[像冬而不是冬的字符](http://www.ltg.ed.ac.uk/~richard/utf-8.cgi?input=2F81A&mode=hex)，length=2。

emoji在java里的length也都是2。
> 但是在Elasticsearch中，一个 Emoji 表情符号的长度被视为一个字符。这是因为 **Elasticsearch 默认情况下使用的 Unicode Tokenizer （也就是[Standard Tokenizer](https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-standard-tokenizer.html)）会将表情符号视为单个字符进行分词和处理**。所以如果使用Java给带emoji的string做截断，截断的位置和elasticsearch不一样。

参阅：
- http://reedbeta.com/blog/programmers-intro-to-unicode/#diversity-and-inherent-complexity
- https://github.com/puppylpg/java-examples/blob/master/src/main/java/example/unicode/CharacterDemo.java

# 感想
本来以为仅仅是稍微系统了解一下Unicode，应该很简单的就总结完了的，没想到就算忽视了许多细节，依旧搞了两三天……好复杂……主要是了解的越多，碰到的不认识的东西越多。可见Unicode本身一定是一个复杂到爆的东西…… 

Orz

