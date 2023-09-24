---
layout: post
title: "Elasticsearch：analyzer"
date: 2022-04-22 00:16:18 +0800
categories: elasticsearch
tags: elasticsearch
---

Elasticsearch的[搜索]({% post_url 2022-04-22-es-search %})，仅仅创建倒排索引是不够的。比如搜索时如果想忽略大小写，一个单纯的倒排并不能做到这一点，必须在倒排之前，对数据进行处理，全部转为小写。进行这些数据处理的，就是analyzer。

1. Table of Contents, ordered
{:toc}

# analyzer
我们要在建立倒排索引之前处理文本，就要使用analyzer定义文本的处理方式。analyzer由三部分组成：
1. `char_filter`：字符过滤器。**字符串在被分词之前，先对字符做一些过滤**。比如替换&为and、去掉html tag等；
2. `tokenizer`：分词器。**处理字符串，拆分为不同的token**；
3. `filter`：Token 过滤器（感觉起名为token filter会更贴切。可能es觉得本来就是在处理token，所以不用再提token了）。**改变token，也可以增删token**。比如token小写、转为词根、增加近义词。

es[内置了一些analyzer](https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-analyzers.html)。

比如常用的standard analyzer，语言相关的english analyzer等。还可以添加第三方的比如ik analyzer，用于中文分词。

接下来以[standard analyzer](https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-standard-analyzer.html)和[english analyzer](https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-lang-analyzer.html#english-analyzer)为例分别介绍char_filter/tokenizer/filter：

## char_filter
es内置的char filter不是很多，也不太常用：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-charfilters.html

比如HTML Strip Character Filter。
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-htmlstrip-charfilter.html
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/char-filters.html

**standard analyzer和english analyzer都没有使用char filter**。

## tokenizer
内置的tokenizer：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-tokenizers.html

**standard analyzer和english analyzer使用的都是standard tokenizer**，它使用空格给英文分词。汉语则是一个汉字分为一个词，失去了语义：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-standard-tokenizer.html

**es可以使用analyze api非常方便地测试analyzer及其组件**：
```json
POST _analyze
POST _analyze
{
  "tokenizer": "standard",
  "text": "hello123 456 world 你好吗"
}
```
输出：
```json
{
  "tokens" : [
    {
      "token" : "hello123",
      "start_offset" : 0,
      "end_offset" : 8,
      "type" : "<ALPHANUM>",
      "position" : 0
    },
    {
      "token" : "456",
      "start_offset" : 9,
      "end_offset" : 12,
      "type" : "<NUM>",
      "position" : 1
    },
    {
      "token" : "world",
      "start_offset" : 13,
      "end_offset" : 18,
      "type" : "<ALPHANUM>",
      "position" : 2
    },
    {
      "token" : "你",
      "start_offset" : 19,
      "end_offset" : 20,
      "type" : "<IDEOGRAPHIC>",
      "position" : 3
    },
    {
      "token" : "好",
      "start_offset" : 20,
      "end_offset" : 21,
      "type" : "<IDEOGRAPHIC>",
      "position" : 4
    },
    {
      "token" : "吗",
      "start_offset" : 21,
      "end_offset" : 22,
      "type" : "<IDEOGRAPHIC>",
      "position" : 5
    }
  ]
}
```
标准分词器做的事情还是挺多的，它会按照Unicode Standard Annex #29定义的统一文本处理算法去处理文本，包括丢掉标点之类的。但是它对中文等特定语言的处理并不好，如果要考虑这些语言的语义，则要使用更专业的分词器，比如icu或ik。

> **另外可以看出分出来的token除了token本身，还有位置信息、类型信息等，`match_phrase`搜索会使用position**。

- `max_token_length`：默认255。标准分词器对token的长度是有限制的，超过255就在255出分词了。

> 注意：**平时说的icu和ik，其实是分词器tokenizer**。他们都提供了使用了该分词器的analyzer。比如ik_smart。
> 
> - https://www.elastic.co/guide/cn/elasticsearch/guide/current/icu-tokenizer.html

### pattern tokenizer
自己指定pattern，进行分词：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-pattern-tokenizer.html

### UAX URL email tokenizer
给email和url分词：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-uaxurlemail-tokenizer.html

注意默认最大的token是255，url可能会超。

### path hierarchy tokenizer
path和path的父目录都会是token：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-pathhierarchy-tokenizer.html

## filter
token filter就比较多了，毕竟对token的处理需求还是很多的：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-tokenfilters.html

比如lowercase filter：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-lowercase-tokenfilter.html

**使用analyze api指定tokenizer和filter测试一下：**
```json
GET _analyze
{
  "tokenizer" : "standard",
  "filter" : ["lowercase"],
  "text" : "THE Quick FoX JUMPs"
}
```
输出：
```json
[ the, quick, fox, jumps ]
```

**stop word filter，过滤掉语言中的stop word，比如a/an/the等无意义词**：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-stop-tokenfilter.html

和tokenizer一样，**filter也有属性可以自定义**：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-stop-tokenfilter.html#analysis-stop-tokenfilter-configure-parms

**standard analyzer使用了lowercase filter，english analyzer则使用了很多filter**：
```json
PUT /english_example
{
  "settings": {
    "analysis": {
      "filter": {
        "english_stop": {
          "type":       "stop",
          "stopwords":  "_english_" 
        },
        "english_keywords": {
          "type":       "keyword_marker",
          "keywords":   ["example"] 
        },
        "english_stemmer": {
          "type":       "stemmer",
          "language":   "english"
        },
        "english_possessive_stemmer": {
          "type":       "stemmer",
          "language":   "possessive_english"
        }
      },
      "analyzer": {
        "rebuilt_english": {
          "tokenizer":  "standard",
          "filter": [
            "english_possessive_stemmer",
            "lowercase",
            "english_stop",
            "english_keywords",
            "english_stemmer"
          ]
        }
      }
    }
  }
}
```
第一个是`stop word filter`，**当不想要某些token时，可以把他们过滤掉**。这里设置的stop word集合是es内置的english stop word，`_english_`：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-stop-tokenfilter.html#english-stop-words

最后两个filter是`stemmer filter`，**获取token的词根形式**，可以极大扩大匹配范围：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-stemmer-tokenfilter.html

第二个是`keyword_marker filter`，**当不想把某个词作为词根时使用**：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-keyword-marker-tokenfilter.html

### reverse token filter
颠倒分词：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-reverse-tokenfilter.html

**看起来似乎没用，但是如果要匹配`*bar`，不如把token倒过来，再匹配`rab*`，速度极大提升**。

还有一种奇效：reverse + ngram + reverse：
```json
GET /_analyze
{
  "tokenizer": "standard",
  "filter": ["reverse", "edge_ngram", "reverse"], 
  "text" : "Hello!"
}
```
从尾部生成edge_ngram。当然，和设置edge_ngram的`side=back`一个效果。

## 自定义analyzer
如果所有内置的analyzer都不符合自己的需求，就需要自定义一个analyzer。

改变标准analyzer的任何一点设置，都是在自定义analyzer。一般情况下自定义analyzer，其实就是：
1. **在标准char_filter/tokenizer/filter的基础上，改一改配置，生成一个新的char_filter/tokenizer/filter**；
2. **组装一个或多个char_filter/tokenizer/filter**；

> **上面贴的english analyzer，实际就是对tokenizer、filter改了改设置，组装起来的**。

比如自定义一个支持的token最大长度为5的standard analyzer：
```json
PUT my-index-000001
{
  "settings": {
    "analysis": {
      "analyzer": {
        "my_analyzer": {
          "tokenizer": "my_tokenizer"
        }
      },
      "tokenizer": {
        "my_tokenizer": {
          "type": "standard",
          "max_token_length": 5
        }
      }
    }
  }
}
```
也可以自定义一个char filter，把&转为and：
```json
"char_filter": {
    "&_to_and": {
        "type":       "mapping",
        "mappings": [ "&=> and "]
    }
}
```
实际是在mapping char_filter的基础上，改了改配置。

- https://www.elastic.co/guide/cn/elasticsearch/guide/current/custom-analyzers.html

最后把这些char_filter/tokenizer/filter，放到custom类型的analyzer里，组装成一个自己的analyzer：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-custom-analyzer.html

## analyzer的最小元素集合
一个analyzer虽然由三部分组成，但是char_filter和filter可以没有，也可以有多个（zero or more），**但是tokenizer必须有且只有一个（exactly one）**。

最典型的例子就是[whitespace analyzer](https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-whitespace-analyzer.html)，它只有一个tokenizer，whitespace tokenizer，按照空格分词。

# `_analyze` API
[测试analyzer，也可以测试char_filter、tokenizer、filter](https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-analyze.html)：
```json
GET /_analyze
{
  "tokenizer" : "keyword",
  "filter" : ["lowercase"],
  "char_filter" : ["html_strip"],
  "text" : "this is a <b>test</b>"
}
```
或者自定义一个truncate filter：
```json
GET _analyze
{
  "tokenizer": "keyword",
  "filter": [
    {
      "type": "truncate",
      "length": 7
    },
    "lowercase"
  ],
  "text": [
    "Hello World"
  ]
}
```
返回：
```json
{
  "tokens" : [
    {
      "token" : "hello w",
      "start_offset" : 0,
      "end_offset" : 11,
      "type" : "word",
      "position" : 0
    }
  ]
}
```

**一个比较方便的功能是引用已有的index的某个field的analyzer**：
```json
GET /<index>/_analyze
{
  "field": "description", 
  "text": ["hello world"]
}
```
或者直接指定analyzer名称，无论analyzer还是search_analyzer都可以：
```json
GET <index>/_analyze
{
  "analyzer": "autocomplete_sentence_search",
  "text": ["hello world"]
}
```

# search as you type
有一些比较猛的filter，因为太强，所以单独拎出来说了。常用来做search as you type。

## n-gram filter - 字符滑动窗口
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-ngram-tokenfilter.html

## edge n-gram filter - 左窗口固定为edge的滑动窗口
edge ngram和ngram相比，**左窗口固定为edge的滑动窗口，所以它产生的都是前缀**：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-edgengram-tokenfilter.html

token filter可以改变token，**也可以增删token**。stop word filter是删除token的例子，edge n-gram则是增加token的例子。

edge n-gram可以把一个token转成很多个token，每个token都是原本token的前缀：
```json
GET _analyze
{
  "tokenizer": "standard",
  "filter": [
    { "type": "edge_ngram",
      "min_gram": 2,
      "max_gram": 4
    }
  ],
  "text": "hello world"
}
```
输出：
```json
{
  "tokens" : [
    {
      "token" : "he",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "<ALPHANUM>",
      "position" : 0
    },
    {
      "token" : "hel",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "<ALPHANUM>",
      "position" : 0
    },
    {
      "token" : "hell",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "<ALPHANUM>",
      "position" : 0
    },
    {
      "token" : "wo",
      "start_offset" : 6,
      "end_offset" : 11,
      "type" : "<ALPHANUM>",
      "position" : 1
    },
    {
      "token" : "wor",
      "start_offset" : 6,
      "end_offset" : 11,
      "type" : "<ALPHANUM>",
      "position" : 1
    },
    {
      "token" : "worl",
      "start_offset" : 6,
      "end_offset" : 11,
      "type" : "<ALPHANUM>",
      "position" : 1
    }
  ]
}
```
standard tokenizer把字符串分成hello和world两个token，edge n-gram filter则把他们映射为了6个token，每个token都是原有token的2-4个字符不等的前缀。

这样当我们输入字符的时候，只要搜索框在输入大于两个字符时就对es发起搜索请求，并把搜索结果实时展示在搜索框下，就会产生一种search as you type的效果！（如果搜索返回速度还赶不上用户输入速度，那就凉凉了……）

**因为这个功能太强了，所以es支持在定义mapping的时候，给某个field设为"search_as_you_type"类型**：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/search-as-you-type.html

直接就能用，甚至都不需要自定义一个包含edge n-gram filter的analyzer了。

> 当输入“he wor”的时候，既匹配上了he，又匹配上了wor，该文档就会被作为候选项筛选出来。

### truncate token filter - 输入词过长
上述自定义的filter只生成了2-4长度的前缀作为token，如果用户输入了hello或者world，反而匹配不到这些前缀了，在用户看来这岂不是很离谱？

其本质原因是查询词超出了edge n-gram的`max_gram`。**这个时候可以给analyzer加一个truncate token filter使用，自动帮用户截断搜索词到`max_gram`的长度**，又可以搜到了：
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-edgengram-tokenfilter.html#analysis-edgengram-tokenfilter-max-gram-limits
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-truncate-tokenfilter.html

```json
  "analysis":{
    "filter":{
      "sentence_char_trunc": {
        "type": "truncate",
        "length": 20
      }
    },
    "analyzer":{
      "autocomplete_sentence":{
        "tokenizer":"sentence_edge_ngram",
        "filter":[
          "lowercase"
        ]
      },
      "autocomplete_sentence_search":{
        "tokenizer":"keyword",
        "filter":[
          "lowercase",
          "sentence_char_trunc"
        ]
      }
    },
    "tokenizer":{
      "sentence_edge_ngram":{
        "type":"edge_ngram",
        "min_gram":2,
        "max_gram":20,
        "token_chars":[

        ]
      }
    },
    "char_filter":{
    }
  }
```

## edge n-gram tokenizer = keyword tokenizer + edge n-gram filter
一开始我还以为是我眼花了……后来发现真的有一个edge n-gram tokenizer，又有一个edge n-gram filter……

仔细想想也有道理：edge n-gram filter是别的tokenizer分好词后，把每个分词拆成前缀token。但是如果不想给句子分词，想直接构建一个句子的前缀，edge n-gram filter就做不到了。此时edge n-gram tokenizer就起到作用了！

**edge n-gram tokenizer默认把整个文本作为一个token**：
> With the default settings, **the edge_ngram tokenizer treats the initial text as a single token** and produces N-grams with minimum length 1 and maximum length 2

```json
POST _analyze
{
  "tokenizer": "edge_ngram",
  "text": "hello world"
}
```
输出：
```json
[ h, he ]
```

edge n-gram tokenizer除了可以配置`min_gram`、`min_gram`，**还可以配置`token_chars`数组，默认为空数组，即把所有文本当作一整个token，不拆分**：
- `token_chars`：可配置为`letter`/`digit`/`whitespace`等等。

**如果配置为whitespace，那这个edge n-gram tokenizer就和standard tokenizer + edge n-gram filter效果类似了**。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-edgengram-tokenizer.html

最好也配合truncate token filter使用。

## completion suggester - search as you type
**如果按照乱序前缀匹配文档，用edge n-gram，如果用widely known order，用completion suggester**：
> When you need search-as-you-type for text which has a widely known order, such as movie or song titles, the completion suggester is a much more efficient choice than edge N-grams. Edge N-grams have the advantage when trying to autocomplete words that can appear in any order.

不过什么是widely known order？ TODO

看起来它也是一个field type，和"search-as-you-type"一样离谱……
- https://www.elastic.co/guide/en/elasticsearch/reference/current/search-suggesters.html#completion-suggester

**一个很大的优势在于，它被优化的巨快，甚至直接放到了内存里**：
> Ideally, auto-complete functionality should be as fast as a user types to provide instant feedback relevant to what a user has already typed in. Hence, completion suggester is optimized for speed. The suggester uses data structures that enable fast lookups, but are costly to build and are stored in-memory.

## search analyzer - 和edge n-gram一起使用
**正常情况下，搜索时对搜索词使用的analyzer，应该和构建索引时使用的analyzer一样，这样搜索词token和索引里的待搜索token才能在同一套标准下进行匹配**。比如构建索引时使用english analyzer，搜索时也使用english analyzer。

但是edge n-gram不一样，它存的时候用到的analyzer是edge n-gram相关的，存的是前缀。**但是搜索的时候，不能对搜索词也应用这个analyzer，否则只要搜索词的某个前缀和索引词的某个前缀相同，就能被搜出来**：

比如索引词是pikachu，存在倒排索引里的是pi/pik/pika三个前缀。搜索词是pipi，理论上来讲它不应该搜出来pikachu。但是如果对它也应用edge n-gram，搜索词也变成了三个：pi/pip/pipi。其中，pi这个搜索词是可以匹配上倒排索引里的pi的。但这完全不是我们想要的结果。

`analyzer`和`search_analyzer`都是定义mapping时，field的属性：
- **前者叫index analyzer**；
- **后者叫search analyzer**；

定义一个有多个名字的field：
```json
      "name":{
        "type":"keyword",
        "fields":{
          "standard":{
            "type":"text",
            "analyzer":"standard"
          },
          "autocomplete":{
            "type":"text",
            "analyzer":"autocomplete_sentence",
            "search_analyzer":"autocomplete_sentence_search"
          }
        }
      },
```
`name.autocomplete`这个field使用自定义的`autocomplete_sentence` analyzer作为index analyzer，使用自定义的`autocomplete_sentence_search`作为search analyzer。

前者使用edge n-gram，后者就是单纯的keyword tokenizer：
```json
        "analyzer":{
          "autocomplete_sentence":{
            "tokenizer":"sentence_edge_ngram",
            "filter":[
              "lowercase"
            ]
          },
          "autocomplete_sentence_search":{
            "tokenizer":"keyword",
            "filter":[
              "lowercase"
            ]
          }
        },
        "tokenizer":{
          "sentence_edge_ngram":{
            "type":"edge_ngram",
            "min_gram":2,
            "max_gram":20,
            "token_chars":[
              
            ]
          }
        }
      }
```
- https://www.elastic.co/guide/en/elasticsearch/reference/current/search-analyzer.html

## shingle - token滑动窗口
shingle是token层级的n-gram：**edge n-gram token filter是给一个token的前缀做ngram，shingle是给多个token做ngram**。

比如：
```json
GET /_analyze
{
  "tokenizer": "whitespace",
  "filter": [
    {
      "type": "shingle",
      "min_shingle_size": 2,
      "max_shingle_size": 3
    }
  ],
  "text": "i love you bibi"
}
```
能生成4个单独的word，和5个shingle：
```json
{
  "tokens" : [
    {
      "token" : "i",
      "start_offset" : 0,
      "end_offset" : 1,
      "type" : "word",
      "position" : 0
    },
    {
      "token" : "i love",
      "start_offset" : 0,
      "end_offset" : 6,
      "type" : "shingle",
      "position" : 0,
      "positionLength" : 2
    },
    {
      "token" : "i love you",
      "start_offset" : 0,
      "end_offset" : 10,
      "type" : "shingle",
      "position" : 0,
      "positionLength" : 3
    },
    {
      "token" : "love",
      "start_offset" : 2,
      "end_offset" : 6,
      "type" : "word",
      "position" : 1
    },
    {
      "token" : "love you",
      "start_offset" : 2,
      "end_offset" : 10,
      "type" : "shingle",
      "position" : 1,
      "positionLength" : 2
    },
    {
      "token" : "love you bibi",
      "start_offset" : 2,
      "end_offset" : 15,
      "type" : "shingle",
      "position" : 1,
      "positionLength" : 3
    },
    {
      "token" : "you",
      "start_offset" : 7,
      "end_offset" : 10,
      "type" : "word",
      "position" : 2
    },
    {
      "token" : "you bibi",
      "start_offset" : 7,
      "end_offset" : 15,
      "type" : "shingle",
      "position" : 2,
      "positionLength" : 2
    },
    {
      "token" : "bibi",
      "start_offset" : 11,
      "end_offset" : 15,
      "type" : "word",
      "position" : 3
    }
  ]
}
```

**使用shingle做索引的field，搜索的时候使用同样的analyzer就行了，不像edge n-gram必须设置不同的search analyzer，因为shingle本来就是按照单词匹配的，符合对搜索的认知**。

- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-shingle-tokenfilter.html

设置带有shingle的analyzer：
```json
# analyzer
PUT /puzzle
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1,
    "analysis": {
      "char_filter": {
        "&_to_and": {
          "type":       "mapping",
          "mappings": [ "&=> and "]
        }
      },
      "filter": {
        "english_stop": {
          "type":       "stop",
          "ignore_case": true,
          "stopwords":  ["a", "an", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these", "they", "this", "to", "was", "will", "with"]
        },
        "english_keywords": {
          "type":       "keyword_marker",
          "keywords":   ["example"]
        },
        "english_stemmer": {
          "type":       "stemmer",
          "language":   "english"
        },
        "english_possessive_stemmer": {
          "type":       "stemmer",
          "language":   "possessive_english"
        },
        "my_shingle_filter": {
                    "type":             "shingle",
                    "min_shingle_size": 2,
                    "max_shingle_size": 2,
                    "output_unigrams":  false  
                }
      },
      "analyzer": {
        "reb_standard": {
          "type":         "custom",
          "char_filter":  [ "&_to_and" ],
          "tokenizer":    "standard"
        },
        "reb_english": {
          "type":         "custom",
          "char_filter":  [ "&_to_and" ],
          "tokenizer":    "standard",
          "filter":       [ "english_possessive_stemmer",
            "lowercase",
            "english_stop",
            "english_keywords",
            "english_stemmer" ]
        },
        "my_shingle_analyzer": {
                    "type":             "custom",
                    "char_filter":  [ "&_to_and" ],
                    "tokenizer":        "standard",
                    "filter": [
                        "lowercase",
                        "my_shingle_filter"
                    ]
        },
        "eng_shingle_analyzer": {
                    "type":             "custom",
                    "char_filter":  [ "&_to_and" ],
                    "tokenizer":        "standard",
                    "filter": [
                      "english_possessive_stemmer",
                      "lowercase",
                      "english_stop",
                      "english_keywords",
                      "english_stemmer",
                      "my_shingle_filter"
                    ]
        }
      }
    }
  }
}
```
设置mapping：
```json
# property
PUT /puzzle/_mapping
{
  "properties": {
    "article": {
      "type": "keyword",
      "fields": {
        "stan": {
          "type": "text",
          "analyzer": "standard"
        },
        "eng": {
          "type": "text",
          "analyzer": "english"
        },
        "reb_eng": {
          "type": "text",
          "analyzer": "reb_english"
        },
        "reb_stan": {
          "type": "text",
          "analyzer": "reb_standard"
        },
        "icu": {
          "type": "text",
          "analyzer": "icu_analyzer"
        },
        "ik": {
          "type": "text",
          "analyzer": "ik_smart"
        }
      }
    }
  }
}
 
PUT /puzzle/_mapping
{
  "properties": {
    "article": {
      "type": "keyword",
      "fields": {
        "shingle": {
          "type": "text",
          "analyzer": "eng_shingle_analyzer"
        }
      }
    }
  }
}
```
搜索：
```json
GET /puzzle/_search
{
  "query": {
      "bool": {
         "must": {
            "match": {
               "article.reb_eng": {
                  "query": "puzzles & survival",
                  "minimum_should_match": "100%"
               }
            }
         },
         "should": [
           {
              "match": {
                 "article.shingle": "puzzles & survival"
              }
           }
         ]
      }
   }
}
```

**shingle介于match和match_phrase之间**：它像match一样不要求所有搜索词都出现（match_phrase虽然可以调slop，但是所有词必须出现），同时不像match丝毫不考虑顺序（shingle考虑了局部顺序，单词局部顺序和shingle匹配的得分会高）：
- https://www.elastic.co/guide/cn/elasticsearch/guide/current/shingles.html


# 实例：自定义analyzer
一些典型的自定义analyzer的样例。

## 保留`#`/`@`
需求：搜索`#hello`。

默认情况下，es会删掉标点符号，所以搜`#hello`和搜`hello`是一样的：
```json
GET /_analyze
{
  "tokenizer": "standard",
  "text": ["hello #world @wtf &emmm ???  ? . , !tanhao ! ！ ……我爱你 才怪"]
}
```
结果：
```json
{
  "tokens" : [
    {
      "token" : "hello",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "<ALPHANUM>",
      "position" : 0
    },
    {
      "token" : "world",
      "start_offset" : 7,
      "end_offset" : 12,
      "type" : "<ALPHANUM>",
      "position" : 1
    },
    {
      "token" : "wtf",
      "start_offset" : 14,
      "end_offset" : 17,
      "type" : "<ALPHANUM>",
      "position" : 2
    },
    {
      "token" : "emmm",
      "start_offset" : 19,
      "end_offset" : 23,
      "type" : "<ALPHANUM>",
      "position" : 3
    },
    {
      "token" : "tanhao",
      "start_offset" : 36,
      "end_offset" : 42,
      "type" : "<ALPHANUM>",
      "position" : 4
    },
    {
      "token" : "我",
      "start_offset" : 49,
      "end_offset" : 50,
      "type" : "<IDEOGRAPHIC>",
      "position" : 5
    },
    {
      "token" : "爱",
      "start_offset" : 50,
      "end_offset" : 51,
      "type" : "<IDEOGRAPHIC>",
      "position" : 6
    },
    {
      "token" : "你",
      "start_offset" : 51,
      "end_offset" : 52,
      "type" : "<IDEOGRAPHIC>",
      "position" : 7
    },
    {
      "token" : "才",
      "start_offset" : 53,
      "end_offset" : 54,
      "type" : "<IDEOGRAPHIC>",
      "position" : 8
    },
    {
      "token" : "怪",
      "start_offset" : 54,
      "end_offset" : 55,
      "type" : "<IDEOGRAPHIC>",
      "position" : 9
    }
  ]
}
```
起作用的主要是standard analyzer里的standard tokenizer，它会按照[Unicode Text Segmentation algorithm](https://discuss.elastic.co/t/standard-tokenizer-punctuation-symbols-removed/223426)在分词的时候就[把标点删掉](https://unicode.org/reports/tr29/#Default_Word_Boundaries)。

> 所以删东西的未必是filter，tokenizer也可以在生成token的时候去掉一些东西。

比如换成whitespace分词，就只是单纯用空格分一下，不会判断word边界，因此也不会删除标点：
```json
GET /_analyze
{
  "tokenizer": "whitespace",
  "text": ["hello #world @wtf &emmm ???  ? . , !tanhao ! ！ ……我爱你 才怪"]
}
```
结果：
```json
{
  "tokens" : [
    {
      "token" : "hello",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "word",
      "position" : 0
    },
    {
      "token" : "#world",
      "start_offset" : 6,
      "end_offset" : 12,
      "type" : "word",
      "position" : 1
    },
    {
      "token" : "@wtf",
      "start_offset" : 13,
      "end_offset" : 17,
      "type" : "word",
      "position" : 2
    },
    {
      "token" : "&emmm",
      "start_offset" : 18,
      "end_offset" : 23,
      "type" : "word",
      "position" : 3
    },
    {
      "token" : "???",
      "start_offset" : 24,
      "end_offset" : 27,
      "type" : "word",
      "position" : 4
    },
    {
      "token" : "?",
      "start_offset" : 29,
      "end_offset" : 30,
      "type" : "word",
      "position" : 5
    },
    {
      "token" : ".",
      "start_offset" : 31,
      "end_offset" : 32,
      "type" : "word",
      "position" : 6
    },
    {
      "token" : ",",
      "start_offset" : 33,
      "end_offset" : 34,
      "type" : "word",
      "position" : 7
    },
    {
      "token" : "!tanhao",
      "start_offset" : 35,
      "end_offset" : 42,
      "type" : "word",
      "position" : 8
    },
    {
      "token" : "!",
      "start_offset" : 43,
      "end_offset" : 44,
      "type" : "word",
      "position" : 9
    },
    {
      "token" : "！",
      "start_offset" : 45,
      "end_offset" : 46,
      "type" : "word",
      "position" : 10
    },
    {
      "token" : "……我爱你",
      "start_offset" : 47,
      "end_offset" : 52,
      "type" : "word",
      "position" : 11
    },
    {
      "token" : "才怪",
      "start_offset" : 53,
      "end_offset" : 55,
      "type" : "word",
      "position" : 12
    }
  ]
}
```
可以看到它给出的类型是word，而非更详细的ALPHANUM之类的。

参考[这篇文章](https://www.pixlee.com/blog/finding-hashtags-in-elasticsearch-1-7)，如果想保留#/@等符号，需要使用[Word delimiter graph token filter](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/analysis-word-delimiter-graph-tokenfilter.html#analysis-word-delimiter-graph-tokenfilter)保留这些符号：
```json
"filter":{
  "hashtag_as_alphanum" : {
    "type" : "word_delimiter_graph",
    "type_table": ["# => ALPHANUM", "@ => ALPHANUM"]
  }
}
```
但是filter是在tokenizer后生效的，所以只能把tokenizer改成whitespace，否则tokenizer就把标点过滤掉了，filter也无从保留。

`word_delimiter_graph`的原理如下：

原本whitespace tokenizer仅按照space生成token，会有很多token，**`word_delimiter_graph`可以把token前后的标点过滤掉**：
```json
GET /_analyze
{
  "tokenizer": "whitespace",
  "filter": ["word_delimiter_graph"],
  "text": ["hello #world @wtf &emmm ???  ? . , !tanhao ! ！ ……我爱你 才怪 rainy"]
}
```
产生的token就和standard tokenizer差不多了：
```json
{
  "tokens" : [
    {
      "token" : "hello",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "word",
      "position" : 0
    },
    {
      "token" : "world",
      "start_offset" : 7,
      "end_offset" : 12,
      "type" : "word",
      "position" : 1
    },
    {
      "token" : "wtf",
      "start_offset" : 14,
      "end_offset" : 17,
      "type" : "word",
      "position" : 2
    },
    {
      "token" : "emmm",
      "start_offset" : 19,
      "end_offset" : 23,
      "type" : "word",
      "position" : 3
    },
    {
      "token" : "tanhao",
      "start_offset" : 36,
      "end_offset" : 42,
      "type" : "word",
      "position" : 8
    },
    {
      "token" : "我爱你",
      "start_offset" : 49,
      "end_offset" : 52,
      "type" : "word",
      "position" : 11
    },
    {
      "token" : "才怪",
      "start_offset" : 53,
      "end_offset" : 55,
      "type" : "word",
      "position" : 12
    },
    {
      "token" : "rainy",
      "start_offset" : 56,
      "end_offset" : 61,
      "type" : "word",
      "position" : 13
    }
  ]
}
```
**此时如果我们指定不要去掉#和@，就可以保留`#hello`这样的token**！

新的analyzer如下：
```json
GET /_analyze
{
  "tokenizer": "whitespace",
  "filter": [
    {
      "type": "word_delimiter_graph",
      "type_table": [
        "# => ALPHANUM",
        "@ => ALPHANUM"
      ]
    }
  ],
  "text": ["hello #world @wtf &emmm# ???  ? . , !tanhao ! ！ ……我爱你 才怪 rainy"]
}
```
结果：
```json
{
  "tokens" : [
    {
      "token" : "hello",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "word",
      "position" : 0
    },
    {
      "token" : "#world",
      "start_offset" : 6,
      "end_offset" : 12,
      "type" : "word",
      "position" : 1
    },
    {
      "token" : "@wtf",
      "start_offset" : 13,
      "end_offset" : 17,
      "type" : "word",
      "position" : 2
    },
    {
      "token" : "emmm#",
      "start_offset" : 19,
      "end_offset" : 24,
      "type" : "word",
      "position" : 3
    },
    {
      "token" : "tanhao",
      "start_offset" : 37,
      "end_offset" : 43,
      "type" : "word",
      "position" : 8
    },
    {
      "token" : "我爱你",
      "start_offset" : 50,
      "end_offset" : 53,
      "type" : "word",
      "position" : 11
    },
    {
      "token" : "才怪",
      "start_offset" : 54,
      "end_offset" : 56,
      "type" : "word",
      "position" : 12
    },
    {
      "token" : "rainy",
      "start_offset" : 57,
      "end_offset" : 62,
      "type" : "word",
      "position" : 13
    }
  ]
}
```
token `#world`被成功保留了下来。

> 当然，`emmm#`也被保留了下来。

如果设置`"preserve_original": true`：
```json
GET /_analyze
{
  "tokenizer": "whitespace",
  "filter": [
    {
      "type": "word_delimiter_graph",
      "type_table": [
        "# => ALPHANUM",
        "@ => ALPHANUM"
      ],
      "preserve_original": true
    }
  ],
  "text": ["hello #world @wtf &emmm ???  ? . , !tanhao ! ！ ……我爱你 才怪 rainy"]
}
```
则会把过滤之前带标点的和过滤之后不代标点的都保留下来：
```json
{
  "tokens" : [
    {
      "token" : "hello",
      "start_offset" : 0,
      "end_offset" : 5,
      "type" : "word",
      "position" : 0
    },
    {
      "token" : "#world",
      "start_offset" : 6,
      "end_offset" : 12,
      "type" : "word",
      "position" : 1
    },
    {
      "token" : "@wtf",
      "start_offset" : 13,
      "end_offset" : 17,
      "type" : "word",
      "position" : 2
    },
    {
      "token" : "&emmm",
      "start_offset" : 18,
      "end_offset" : 23,
      "type" : "word",
      "position" : 3
    },
    {
      "token" : "emmm",
      "start_offset" : 19,
      "end_offset" : 23,
      "type" : "word",
      "position" : 3
    },
    {
      "token" : "???",
      "start_offset" : 24,
      "end_offset" : 27,
      "type" : "word",
      "position" : 4
    },
    {
      "token" : "?",
      "start_offset" : 29,
      "end_offset" : 30,
      "type" : "word",
      "position" : 5
    },
    {
      "token" : ".",
      "start_offset" : 31,
      "end_offset" : 32,
      "type" : "word",
      "position" : 6
    },
    {
      "token" : ",",
      "start_offset" : 33,
      "end_offset" : 34,
      "type" : "word",
      "position" : 7
    },
    {
      "token" : "!tanhao",
      "start_offset" : 35,
      "end_offset" : 42,
      "type" : "word",
      "position" : 8
    },
    {
      "token" : "tanhao",
      "start_offset" : 36,
      "end_offset" : 42,
      "type" : "word",
      "position" : 8
    },
    {
      "token" : "!",
      "start_offset" : 43,
      "end_offset" : 44,
      "type" : "word",
      "position" : 9
    },
    {
      "token" : "！",
      "start_offset" : 45,
      "end_offset" : 46,
      "type" : "word",
      "position" : 10
    },
    {
      "token" : "……我爱你",
      "start_offset" : 47,
      "end_offset" : 52,
      "type" : "word",
      "position" : 11
    },
    {
      "token" : "我爱你",
      "start_offset" : 49,
      "end_offset" : 52,
      "type" : "word",
      "position" : 11
    },
    {
      "token" : "才怪",
      "start_offset" : 53,
      "end_offset" : 55,
      "type" : "word",
      "position" : 12
    },
    {
      "token" : "rainy",
      "start_offset" : 56,
      "end_offset" : 61,
      "type" : "word",
      "position" : 13
    }
  ]
}
```
如果想更强大一些，我们可以借用english analyzer的成分，组一个能够区分词干又能够保留#和@的analyzer：
```json
  "analysis":{
    "filter":{
      "english_keywords":{
        "keywords":[],
        "type":"keyword_marker"
      },
      "english_stemmer":{
        "type":"stemmer",
        "language":"english"
      },
      "english_possessive_stemmer":{
        "type":"stemmer",
        "language":"possessive_english"
      },
      "english_stop":{
        "type":"stop",
        "stopwords":  "_english_"
      },
      "hashtag_as_alphanum" : {
        "type" : "word_delimiter_graph",
        "type_table": ["# => ALPHANUM", "@ => ALPHANUM"]
      }
    },
    "analyzer":{
      "reb_english":{
        "filter":[
          "english_possessive_stemmer",
          "lowercase",
          "english_stop",
          "english_keywords",
          "english_stemmer",
          "hashtag_as_alphanum"
        ],
        "char_filter":[
        ],
        "type":"custom",
        "tokenizer":"whitespace"
      }
    },
    "tokenizer":{
    },
    "char_filter":{
    }
  }
```

