[toc]

---
layout: post
title: "向量搜索"
date: 2024-05-21 01:08:48 +0800
categories: elasticsearch milvus
tags: elasticsearch milvus
---

把文本编码成向量，用向量搜索向量。

1. Table of Contents, ordered
{:toc}

# 向量搜索
传统搜索引擎基于词汇匹配来做文档搜索，虽然像elasticsearch这种发展完善的搜索引擎已经可以在单词预处理后做词根匹配，但是超出词汇的东西还是无能为力，比如不能根据同义词、甚至语义来做搜索。更不要提用文本搜索图片、视频了，对于传统搜索引擎来说，这是完全风马牛不相及的事情。

向量搜索可利用机器学习来捕获非结构化数据（包括文本和图像）的含义和上下文，并将其转换为数字化表示形式。**向量搜索常用于语义搜索**，通过利用相似最近邻 (ANN) 算法来找到相似数据。与传统的关键字搜索相比：
1. 向量搜索产生的结果相关度更高；
2. **向量embedding除了捕获文本之外，还能捕获非结构化数据，如视频、图像和音频**。它可以**把这些素材都编码到同一个向量空间**，因此**向量embedding可捕获同义词和关联，它们本质上是在搜索素材背后的含义**（和传统基于词汇的搜索相比，这属于降维打击）；
3. 还有一个很明显的优势：**你可以用一段话来描述想搜索的内容，会根据语义来召回结果**，这是以前基于词汇的匹配所完全做不到的。比如`a fps game about space war and human future, in which an super soldier with advanced armor with a artifical intelligence fighting together to strive for victory of human`可以搜索出tital fall和halo（还有一些其他我不认识的游戏），如果用传统的词汇匹配，召回结果一定是非常乱的。

更通用的方式可能是将向量搜索与筛选、聚合相结合，通过混合搜索，并将其与传统评分相结合来优化相关性，从而增强搜索体验。

**向量可以被用来比较，比如使用cosine比较向量的相似度**：
> These embeddings can then be compared e.g. with cosine-similarity to find sentences with a similar meaning.

向量搜索的常用场景：
- [语义搜索](https://sbert.net/examples/applications/semantic-search/README.html)
- [语义挖掘](https://sbert.net/examples/applications/paraphrase-mining/README.html)
- [图片搜索](https://sbert.net/examples/applications/image-search/README.html)

## 非/对称语义搜索
[语义搜索](https://sbert.net/examples/applications/semantic-search/README.html)又分为两种：
- symmetirc semantic search：对称语义搜索。query和目标语料体量相似，所以把query和语料交换一下（flip the query and the entries in your corpus），二者也是相似的。
    > An example would be searching for similar questions: Your query could for example be “How to learn Python online?” and you want to find an entry like “How to learn Python on the web?”
- asymmetric semantic search：非对称语义搜索。分为question和answer，question体量一般较小，answer体量较大。如果颠倒过来，几乎就没有什么意义了（flipping the query and the entries in your corpus usually does not make sense）；
    > An example would be a query like “What is Python” and you want to find the paragraph “Python is an interpreted, high-level and general-purpose programming language. Python’s design philosophy …”

## 模型编码
将文本编码为向量，推荐使用[sbert](https://sbert.net/)。相比于bert，sbert针对句子进行了优化。

> [sbert](https://sbert.net/)的文档写得非常好！

sbert有很多预训练的模型，包括[对称语义搜索](https://www.sbert.net/docs/pretrained_models.html#sentence-embedding-models)和[非对称语义搜索](https://www.sbert.net/docs/pretrained_models.html#sentence-embedding-models)。推荐使用多语言版本[paraphrase-multilingual-mpnet-base-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-mpnet-base-v2)，它既是对称语义搜索模型，又可以跨语言搜索。输出向量：
- 维度：768
- 每个维度都是float（或者说float32，更直观），所以单个向量需要4byte * 768 = 3KB
- 输出结果非单位向量

向量编码有GPU支持：
- 直接使用CPU进行向量编码：48 core, Intel(R) Xeon(R) CPU E5-2650 v4 @ 2.20GHz的机器，编码60w向量大概需要5.5-6h；
- 在有GPU的机器上进行向量编码：单卡编码60w向量约20min；GPU编码速度大概是CPU的18~20倍。

sentence-transformers的模型默认优先使用GPU，无需额外设置。

> 不过更推荐[单独指定某张显卡](https://github.com/puppylpg/bertsearch/blob/f28461349c1f1871f5c2fe34a848b17ab5c42afd/example/2_create_documents_from_pickle.py#L13)。

## 单位向量
使用了余弦相似度作为向量的similarity metric，计算cosine时，**如果向量都是单位向量，直接使用二者的点积即可，计算更高效**，所以向量编码之后需要规范化为单位向量。

milvus强制使用单位向量，elasticsearch可以不使用，但最好也使用单位向量。

## knn
[knn（k-nearest neighbor，k近邻）算法](https://www.elastic.co/what-is/knn/)，用来求不同点之间的距离。有多种距离计算方法：
- Euclidean distance：欧几里得距离，x + y
- Manhattan distance：曼哈顿距离，也是我们常用的坐标系中的距离，是x^2 + y^2再开根号；
- Hamming Distance：汉明距离，主要用来计算两个bit向量（每个维度为一个bit）的距离。就是比较两个向量在同一个位置的维度上有多少bit相同，相同越多越相似。主要用于向量量化的场景；
- 还有其他距离；

余弦则可以用来计算两个向量的相似性，也就是人们常说的“小xx”，和上述距离相比，区别大概是：
- 距离是两个人绝对实力的差距，比如梅西和c罗实力接近，他们的曼哈顿距离接近；
- 相似性是两个人的技术特征相似，比如“小梅西”指一个人技术风格和梅西比较像，但是实力可能相去甚远；

**当我们需要衡量两个向量之间的相似度时，余弦相似度通常是一个很好的选择。而在需要考虑绝对差异的情况下，如KNN算法中，我们通常使用欧几里得距离来计算点之间的距离**。

## ann算法

> 空间换时间

暴力查询（exact knn）只适用于数据集比较小的情况，近似knn（Approximate Nearest Neighbor，ann）则可以把数据集按照相似度分成更小的区，就可以非常快的搜索出高相似度的向量，缺点是结果并不完全精确，但对于推荐和搜索系统来说，问题不大。

elasticsearch和milvus的ann算法都采用[HNSW](https://milvus.io/docs/index.md)，这也是elasticsearch目前唯一支持的ann算法，效率高，且更适用于分布式数据库分片的场景。

> 参考：[mapping里关于hnsw算法的设置](https://github.com/puppylpg/bertsearch/blob/f28461349c1f1871f5c2fe34a848b17ab5c42afd/example/schema/media_search.json#L33)

milvus作为专用向量数据库，[支持的ANN算法比较多](https://milvus.io/docs/index.md)，使用不同的算法需要给字段设置不同的索引。

## 向量量化

> 减少空间，同时也能减少时间

向量的搜索效果取决于向量编码效果，当前主流模型输出的向量大概是1024维，每个维度都是float32，所以单个向量占用4KB。50million向量就会占用200GB空间，比较耗费空间。如果放在elasticsearch这种文件搜索数据库还好，如果放在内存里，资源开销就比较大了。减小向量空间占用的方法就是Quantization，量化。

[Embedding Quantization](https://sbert.net/examples/applications/embedding-quantization/README.html)，或者说[Vector Quantization](https://en.wikipedia.org/wiki/Vector_quantization)，是指将连续的向量空间中的数据点映射到一个有限的离散集合中的过程。这种技术常用于数据压缩和数据编码中，**通过将连续数据点用离散的符号表示，从而减少数据的存储空间或传输带宽要求**。

**所以向量量化是以牺牲有限的精度为代价，换取存储空间和查询性能的**。

> Experiments on quantization have shown that we can maintain a large amount of performance while significantly speeding up computation and saving on memory, storage, and costs.

常见的量化方式有：
- binary quantization
- scalar(int8) quantization

### binary quantization
把每个维度的float32变换为1bit，这样就可以省下31/32（96.88%）的空间。具体做法是：大于0的值变成1，小于0的值变成0。

优点是计算起来巨快（blazingly fast）！毕竟位运算就行了。缺点自然是信息损失太严重了。

使用binary quantization一般情况下都会有一个rerank环节，最终会根据原始float32向量重新计算得分：

> In practice, we first retrieve rescore_multiplier * top_k results with the binary query embedding and the binary document embeddings – i.e., the list of the first k results of the double-binary retrieval – and then rescore that list of binary document embeddings with the float32 query embedding.

[效果还不错](https://sbert.net/examples/applications/embedding-quantization/README.html#binary-quantization)，能保证96%的检索表现，同时性能大概加速了32x：

> By applying this novel rescoring step, we are able to preserve up to ~96% of the total retrieval performance, while reducing the memory and disk space usage by 32x and improving the retrieval speed by up to 32x as well.

根据上面的经验，**我猜可能用向量描述一个东西，更重要的是维度，而不是单维度的精度。毕竟用float精确到小数点后多少位，可能影响没那么大，前面的整数才是比较关键的数据**。所以感觉用byte表示一个维度应该还不错。

实际操作的时候，可能用1byte代表8个维度的bit，这样1024维度的float32向量就被量化成了1024维度的bit向量，再compact成128维度的byte向量：
> Quantizing an embedding with a dimensionality of 1024 to binary would result in 1024 bits. In practice, it is much more common to store bits as bytes instead, so when we quantize to binary embeddings, we pack the bits into bytes using `np.packbits`.
>
> As a result, in practice quantizing a float32 embedding with a dimensionality of 1024 yields an int8 or uint8 embedding with a dimensionality of 128.

### scalar(int8) quantization
把每个维度的float32变换为byte，这样就可以省下3/4的空间。映射方式稍微复杂一点，大概就是先使用一大堆向量集合作为刻度（calibration dataset），然后求出所有向量的维度的min和max，把range映射到256个（[-128, 127)）值上。所以calibration dataset的选取很重要，它决定了bucket的划分。

同样，也可以先使用int8做召回以减少内存占用，然后对结果进一步rerank。甚至可以把binary quantization作为int8 quantization的前置召回步骤。

这里有一个[搜索Wikipedia的demo]，搜索范围是41M，先使用binary quantization，再使用scalar quantization，最后float32计算最终得分。效果非常好，响应也十分迅速！

比如输入`a fps game with ak47 and awp as main weapons`，0.2s就能返回top100，而且效果很不错，cs2/cs/csgo是top答案，arma也紧随其后。耗时：
```json
{
    Embed Time:  "0.1191 s",
    Quantize Time:  "0.0001 s",
    Search Time:  "0.0655 s",
    Load Time:  "0.0545 s",
    Rescore Time:  "0.0005 s",
    Sort Time:  "0.0782 s",
    Total Retrieval Time:  "0.1988 s"
}
```
exact knn则花费1.2s，搜索结果上并没有明显提升。

`a fps game about space war and human future, in which a super soldier with advanced armor with an artifical intelligence fighting together to strive for victory of human`，top是crysis、titanfall、halo，很不错。

# 向量数据库
向量的搜索为必要借助数据库，在做一些demo的时候，可以直接提供source vector和destination vectors，直接使用一些库来完成向量的相似度检索。比如[使用hnswlib](https://github.com/UKPLab/sentence-transformers/blob/master/examples/applications/semantic-search/semantic_search_quora_hnswlib.py)。

工程上一般选择向量数据库存储目标向量，目前行业top1是milvus，基于内存做搜索。elasticsearch7支持knn，8支持ann，基于磁盘做搜索。

这里也有一个[使用elasticsearch做向量搜索的例子](https://github.com/UKPLab/sentence-transformers/blob/master/examples/applications/semantic-search/semantic_search_quora_elasticsearch.py)。

## elasticsearch8
版本选择
- 7+：支持knn；
- 8+：支持ann；
    + 8.4+：支持使用_search API进行knn/ann检索；

索引mapping:
```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "title": {
        "type": "text"
      },
      "description": {
        "type": "text"
      },
      "tags": {
        "type": "text"
      },
      "all": {
        "type": "text"
      },
      "url": {
        "type": "keyword"
      },
      "platform": {
        "type": "keyword"
      },
      "text_vector": {
        "type": "dense_vector",
        "dims": 768,
        "index": true,
        "similarity": "dot_product",
        "index_options": {
          "type": "hnsw",
          "m": 30,
          "ef_construction": 200
        }
      }
    }
  }
}
```
使用余弦相似度（单位向量的点积）进行相似度计算，最终文档得分为`(1 + dot_product(query, vector)) / 2`，将得分映射到[0, 1]区间。

需要注意的是，[8.12之前](https://github.com/elastic/elasticsearch/issues/96405)，knn搜索不能像普通搜索一样不支持父子索引，不能在`has_child`里使用knn查询，因为knn只是查询参数，不是query本身。8.12开始，**es引入了[knn query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-knn-query.html)，把knn作为query dsl**，所以可以做基于父子索引的knn搜索了。

## milvus

top1向量数据库。

[数据构建过程](https://github.com/puppylpg/bertsearch/blob/master/example/3_milvus_index_documents.py)：
1. 创建field，指定类型：是标量还是向量
2. 所有的field组成schema
3. 根据schema创建collection，相当于es的一个索引，或者MySQL的一张表
4. 为其中的向量字段创建索引：比如使用HNSW算法，指定算法的细节。如果不创建索引，只能使用暴力knn搜索该字段。创建之后就可以使用相应的ann算法做快速检索

milvus在摄入数据之后，必须`collection.load()`之后才能进行查询，因为milvus是在内存里进行搜索的。

- 优点：
    + 内存的天然优势决定了它比es的磁盘型搜索要更快，即使es能够利用page cache；
- 缺点：
    - 无法取代当前的es搜索架构，所以要在milvus里多维护一套向量数据；
    - 和其他条件的组合搜索比较复杂，没有现有的es组合搜索方便；
    - 额外的硬件资源开销：内存消耗偏大，按照当前的数据规模，单节点至少需要20G左右的内存。这一点倒不是很重要；

所以不考虑使用milvus，主要基于以下原因：
- 就相似kol搜索的性能要求来说，milvus和es都满足；
- 当前系统主要使用es实现搜索，向量搜索也接入es会很方便；
- 引入milvus也无法取代es，还会增加数据冗余、增加服务架构的复杂性、增加代码开发的工作量；

## 对比
demo：
- 工程地址：[bertsearch](https://github.com/puppylpg/bertsearch)
- [部署说明](https://github.com/puppylpg/bertsearch/blob/master/example/README.md)

输入句子，即可获取不同的搜索结果：
- 左侧为elasticsearch knn搜索：将输入文本编码为向量，和elasticsearch里的向量进行相似度计算（dot_product，点积）；
- 中间为elasticsearch关键词匹配（match query）：将输入文本做分词处理，和数据库里已分词的文本进行文本匹配；
- 右侧为milvus knn搜索：同elasticsearch的knn；

从几个角度来对比一下elasticsearch和milvus：

### 磁盘搜索 vs. 内存搜索
- 磁盘搜索：elasticsearch作为磁盘搜索数据库，可以以很小的内存占用检索海量的文件，主要借助的是linux的page cache做文件查询加速。同时ssd会极大提高磁盘速度；
- 内存搜索：milvus默认是内存搜索，所有的向量必须加载到内存里，因此对内存消耗比较；
- 空间占用：es使用磁盘存储向量数据，所以给所有kol做向量编码的存储代价并不高，和平台里的其他数据相比，向量的空间占用甚至可以忽略不计；milvus需要全部加载到内存，内存开销比较大；

实测618w数据，在上述三种查询方法中，es的关键词匹配是最快的，基本立刻出结果。es和milvus的向量搜索会慢一些（因为还要包括把查询语句生成向量的开销），之后milvus基本立刻能出结果，es稍慢一点点，但也非常快。但是，es消耗内存不到1G，milvus消耗40G。

如果部署到到线上，更多的数据将带来更大的内存压力，milvus应该不太现实。不过milvus也支持[diskAnn，需要在编译时就开启disk ann支持](https://milvus.io/docs/disk_index.md)。其原理和es类似，我没有测试，但感觉应该不会比es更强（毕竟es是专门做磁盘搜索的），至少不会从原理上比es更快。

### 混合检索
混合检索：同时支持向量检索 + 普通的条件过滤，灵活度比较高，也能在普通条件过滤之后减少候选文档数，以提高搜索效率。

这一点es做的比较好，搜索是es的强项，包括标量搜索、甚至可以做文本的关键词匹配，之后再用ann做向量检索。

milvus略显麻烦：
1. 首先要对标量field显示开启[scalar index](https://milvus.io/docs/scalar_index.md)，才能进行搜索；
2. 标量检索能力不如es强大，比如[文本搜索支持有限，无法进行关键词匹配](https://milvus.io/docs/boolean.md)。因此**不具备“在出现某关键词的目标文档里做进一步knn搜索”的能力**。

### 算法支持

作为专用的向量数据库，[milvus支持的ann算法](https://milvus.io/docs/index.md)种类比较多，es当下只支持[HNSW，比较适合es这种分布式数据库](https://www.elastic.co/cn/blog/introducing-approximate-nearest-neighbor-search-in-elasticsearch-8-0)。

# 不同版本es对向量的支持
elasticsearch的7和8版本对向量搜索有不同程度的支持，使用起来对当前架构的影响也不尽相同。系统当前使用的是7的最高版本，7.17。

## 向量存储`dense_vector`
7支持的向量字段类型是[`dense_vector`](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/dense-vector.html)：
- `type：dense_vector`，固定类型；
- `dims`：向量维度。最高支持2048，但我们只需要用768，够用了；在8里能支持到4096；

没了。

8支持[更多的高级属性](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/dense-vector.html)：
- `element_type`：用什么类型存储向量。默认是float，还可以修改为byte。**byte每个维度只需要1 byte，比float减少3/4，但是会降低数据精度，而且取值必须介于[-128, 127]**；
- `index`：默认为true，可以支持knn搜索api，见下文。只有在该字段设置为true的情况下，才能设置下面的字段，因为他们都是用来控制knn的；
- `similarity`：**string，代表knn搜索使用的相似性算法（`l2_norm`/`dot_product`/`cosine`/`max_inner_product`）**。从8.8开始，**搜索的时候也可以提供一个`similarity`，不过它是float，用于指定匹配文档的最小相似度**，小于该值的文档会被过滤掉；
- `index_options`：object，配置**构建knn索引**时的算法和参数（**所以叫index option**）
    + `type`：string，**所使用的knn/ann算法**。
        - `hnsw`，可以以更慢的索引速度换来更高的搜索准确性；
        - `int8_hnsw`算法，以降低一些准确性为代价，换取更低（-75%）的内存消耗，它的主要做法是**利用[向量的量化](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/dense-vector.html#dense-vector-quantization)将一个float量化为一个byte整数**；所以`element_type`必须是`float`（要不然怎么做向量的量化）；
        - `flat`：和es7的brute force算法一样；
        - `int8_flat`：brute force和向量的量化的结合，所以`element_type`也必须是`float`；
    + `m`/`ef_construction`/`confidence_interval`：这些参数都是具体的knn算法的细节，他们[主要影响的是构建索引的性能、搜索的性能](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/knn-search.html#knn-indexing-considerations)

> 这些参数参考[为spring-data-elasticsearch添加的`dense_vector` mapping](https://github.com/spring-projects/spring-data-elasticsearch/pull/2920)。



## 向量搜索
不同的向量存储方式对应了不同的搜索方式，性能也相差较大。

### exact knn
7对向量搜索的高级功能支持有限，主要是[brute force搜索（exatct knn）](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/knn-search.html#exact-knn)。搜索的api主要是[`script_score`](https://www.elastic.co/guide/en/elasticsearch/reference/7.17/query-dsl-script-score-query.html#vector-functions)，需要自己在搜索时指定script内容，包括：
- 相似度算法；
- 搜索向量；

好处是script很灵活，可以自定义逻辑。比如**使用点积**计算相似度：
```json
GET my-index-000001/_search
{
  "query": {
    "script_score": {
      "query" : {
        "bool" : {
          "filter" : {
            "term" : {
              "status" : "published"
            }
          }
        }
      },
      "script": {
        "source": """
          double value = dotProduct(params.query_vector, 'my_dense_vector');
          return sigmoid(1, Math.E, -value); 
        """,
        "params": {
          "query_vector": [4, 3.4, -0.2]
        }
      }
    }
  }
}
```
在系统实现的时候，可以配合其他query做过滤（平台、内容标签、kol简介等），以减少需要搜索的数据集，提升性能。比如搜索相似的YouTube kol，可以直接将数据集缩小一半多。

**`script_score`属于[Query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/query-dsl.html)，所以要放在`query`内部，但是[不可以和其他过滤条件比如`match`/`bool`共用](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/specialized-queries.html)**。为了做过滤，需要把过滤条件放到`script_score.query`下。

如果想做分数的叠加，需要在script里使用`_score`变量来访问query的得分：
```json
GET my-index-000001/_search
{
  "query": {
    "script_score": {
      "query" : {
        "bool" : {
          "filter" : {
            "term" : {
              "status" : "published"
            }
          }
        }
      },
      "script": {
        "source": "cosineSimilarity(params.query_vector, 'my_dense_vector') + 1.0",
        "params": {
          "query_vector": [4, 3.4, -0.2] 
        }
      }
    }
  }
}
```

### ann
8除了支持knn，还可以支持ann。ann以更慢的数据索引速度和降低一些搜索精度为代价，换取更快的搜索速度。
- 8.4+：支持使用_search API进行knn/ann检索；

有两种进行knn搜索的方式：
- [knn search](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/search-search.html#search-api-knn)：`knn`在搜索请求的top level，**是推荐用法**；
- [knn query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-knn-query.html)：`knn`作为一个query dsl，在`query`下面。按照文档的说法，**knn query适合和其他query dsl一起做组合搜索**；
    > knn query is reserved for expert cases, where there is a need to combine this query with other queries.

在elasticsearch-java client里，二者对应的class分别是`KnnSearch`和`KnnQuery`，他们的大部分属性是相同的。

#### knn search
[knn search api](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/search-search.html#search-api-knn)在top level下提供了`knn`搜索项，支持以下属性：
- `field`
- `filter`：**指定query DSL，用于做过滤**
- `k`：搜索topK，默认为`size`
- `num_candidates`：每个shard计算出的topK的个数，必须大于k，小于10000，默认是`Math.min(1.5 * k, 10_000)`
- `query_vector`
- `similarity`：**和定义`dense_vector`字段时候的`similarity`属性不一样，这是一个float值，用于指定最小相似度得分，低于得分的文档就直接忽略了**。
    > The minimum similarity required for a document to be considered a match


完整的knn搜索文档可以参考[knn search](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/knn-search.html)。

如果想先过滤再做向量搜索，需要把query放到`knn.filter`里：
```json
POST image-index/_search
{
  "knn": {
    "field": "image-vector",
    "query_vector": [54, 10, -2],
    "k": 5,
    "num_candidates": 50,
    "filter": {
      "term": {
        "file-type": "png"
      }
    }
  },
  "fields": ["title"],
  "_source": false
}
```
使用knn search还可以做[组合搜索hybrid retrieval](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/knn-search.html#_combine_approximate_knn_with_other_features)。比如这个搜索的意思是knn搜索出top5，加上title含有mountain lake提名出的文档，最后按照得分求出top10：
```json
POST image-index/_search
{
  "query": {
    "match": {
      "title": {
        "query": "mountain lake",
        "boost": 0.9
      }
    }
  },
  "knn": {
    "field": "image-vector",
    "query_vector": [54, 10, -2],
    "k": 5,
    "num_candidates": 50,
    "boost": 0.1
  },
  "size": 10
}
```
**组合搜索的得分默认是knn和query的sum，score = 0.9 * match_score + 0.1 * knn_score**。**注意这里两处搜索是or的关系，所以不能起到像上面搜索一样提前过滤（pre-filter）的效果**。

#### knn query
[knn query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-knn-query.html)的主要作用是做[hybrid retrieval](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-knn-query.html#knn-query-in-hybrid-search)，把knn搜索和其他搜索相结合。

> knn query不像knn search，它没有`k`参数，只能指定`number_candidates`。

比如这个组合搜索，是找出搜索title里含有mountain lake的文档，结合图片向量搜索出来的文档，最后根据score取出top 3：
```json
POST my-image-index/_search
{
  "size" : 3,
  "query": {
    "bool": {
      "should": [
        {
          "match": {
            "title": {
              "query": "mountain lake",
              "boost": 1
            }
          }
        },
        {
          "knn": {
            "field": "image-vector",
            "query_vector": [-5, 9, -12],
            "num_candidates": 10,
            "boost": 2
          }
        }
      ]
    }
  }
}
```
**既然是query dsl，那么它还可以和[nested query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-knn-query.html#knn-query-with-nested-query)、[parent-child query](https://github.com/elastic/elasticsearch/issues/96405)一起使用！**

需要注意的是，**[只有放在`knn.filter`下的filter才是做pre-filtering的](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-knn-query.html#knn-query-filtering)，query dsl里的所有其他filter做的都是post-filtering**，这一点比较迷惑，和其他query dsl不同：
> Pre-filtering is supported through the filter parameter of the knn query. Also filters from aliases are applied as pre-filters. All other filters found in the Query DSL tree are applied as post-filters.

比如这个，是knn搜索完了之后，才对搜索结果应用term filter的：
```json
POST my-image-index/_search
{
  "size" : 10,
  "query" : {
    "bool" : {
      "must" : {
        "knn": {
          "field": "image-vector",
          "query_vector": [-5, 9, -12],
          "num_candidates": 3
        }
      },
      "filter" : {
        "term" : { "file-type" : "png" }
      }
    }
  }
}
```

### ann + exact knn(brute-force)
在ann搜索里，可以使用vector quantization加速查询：**存储原始float向量，同时生成byte向量，搜索的时候使用byte向量，可以降低内存消耗，代价是向量精度会有所降低**。还可以同时使用两种向量做组合搜索：
1. 使用byte向量做初步ann召回；
2. 使用float向量对召回的结果做进一步的rescore计算，获取更精准的排序；

这里有一个[例子](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/knn-search.html#knn-search-quantized-example)，展示了**先使用向量量化的ann做近似召回，然后再使用exact knn（`script_score`）查询原始float向量，对得分进行rescore**，得到精准结果——

先指定index options，使用int8_hnsw算法，该算法会对float向量做量化：
```json
PUT quantized-image-index
{
  "mappings": {
    "properties": {
      "image-vector": {
        "type": "dense_vector",
        "element_type": "float",
        "dims": 2,
        "index": true,
        "index_options": {
          "type": "int8_hnsw"
        }
      },
      "title": {
        "type": "text"
      }
    }
  }
}
```
这是纯ann搜索，会用到量化后的向量：
```json
POST quantized-image-index/_search
{
  "knn": {
    "field": "image-vector",
    "query_vector": [0.1, -2],
    "k": 10,
    "num_candidates": 100
  },
  "fields": [ "title" ]
}
```
这是先ann搜索，再使用exact knn搜索做进一步rescore：
```json
POST quantized-image-index/_search
{
  "knn": {
    "field": "image-vector",
    "query_vector": [0.1, -2],
    "k": 15,
    "num_candidates": 100
  },
  "fields": [ "title" ],
  "rescore": {
    "window_size": 10,
    "query": {
      "rescore_query": {
        "script_score": {
          "query": {
            "match_all": {}
          },
          "script": {
            "source": "cosineSimilarity(params.query_vector, 'image-vector') + 1.0",
            "params": {
              "query_vector": [0.1, -2]
            }
          }
        }
      }
    }
  }
}
```

## 7和8对比
使用es7：
- 优点：
    + 和当前使用的es版本一致，直接就可以实现功能；
- 缺点：
    + brute force，内存占用、搜索消耗的时长都会比较大。但是结合业务使用场景，倒不是不能接受；

使用es8可以做到高性能ann、byte vector等：
- 优点
    + ann，搜索快；
    + vector quantization，进一步减少内存消耗，增强搜索性能；还能结合float向量对召回的结果做进一步的rescore计算，获取更精准的排序；
- 缺点
    + 比只存储float向量要多消耗约1/4硬盘存储，但对我们来说可以忽略不计；
    + 使用近似knn，返回的并非绝对相似结果，但差异可接受；
    + 额外的数据迁移步骤；


## 向量来源
es的向量可以来自于外部手动编码，也可以使用es提供的向量编码支持。如果采用后者，就可以直接使用语义搜索，由es自动使用所部署的模型将搜索文本转换为向量。

```json
// ...
{
  "knn": {
    "field": "dense-vector-field",
    "k": 10,
    "num_candidates": 100,
    "query_vector_builder": {
      "text_embedding": {
        "model_id": "my-text-embedding-model",
        "model_text": "The opposite of blue"
      }
    }
  }
}
// ...
```


参考：
- semantic search: https://www.elastic.co/guide/en/elasticsearch/reference/8.13/knn-search.html#knn-semantic-search
- text embedding model: https://www.elastic.co/guide/en/machine-learning/8.13/ml-nlp-search-compare.html#ml-nlp-text-embedding
- example: https://www.elastic.co/guide/en/machine-learning/8.13/ml-nlp-text-emb-vector-search-example.html

## 其他注意事项
[调优](https://www.elastic.co/guide/en/elasticsearch/reference/8.13/tune-knn-search.html)

# 附：ChatGPT
在最开始，向量相似度的相关问题我是通过ChatGPT来整理的。

余弦相似度通常用于衡量两个向量之间的相似度，它在文本分类、推荐系统等领域有广泛应用。

在文本分类中，我们通常使用向量空间模型（Vector Space Model）来表示文本，将每个文档表示为一个向量，其中每个维度表示一个词语。这些向量可以使用余弦相似度来计算它们之间的相似度，从而进行分类。

在推荐系统中，我们通常使用协同过滤算法来推荐物品。协同过滤算法需要计算用户之间的相似度，以确定哪些用户具有相似的兴趣。在这种情况下，我们通常使用余弦相似度来计算用户之间的相似度，因为它可以很好地衡量它们之间的夹角，即它们之间的兴趣相似度。

因此，**当我们需要衡量两个向量之间的相似度时，余弦相似度通常是一个很好的选择。而在需要考虑绝对差异的情况下，如KNN算法中，我们通常使用欧几里得距离来计算点之间的距离**。

## 编码方式
Elasticsearch的KNN是指基于k最近邻算法的搜索功能。它允许用户在Elasticsearch中存储和搜索向量数据，并使用KNN算法来查找与查询向量最相似的向量。这种搜索功能可以用于各种应用程序，例如图像搜索、相似产品推荐等。

一个具体的例子是，假设你有一个电商网站，你想为每个产品存储一个向量表示其特征。你可以使用Elasticsearch来存储这些向量，并使用KNN搜索来查找与用户查询最相似的产品。例如，当用户搜索“黑色运动鞋”，KNN搜索可以找到最接近这个查询向量的产品向量，并推荐给用户。这样可以提高用户体验，增加销售额。

怎么用knn给黑色运动鞋编码？对于KNN搜索，我们需要将向量嵌入到特征空间中，并计算向量之间的距离来找到最相似的向量。对于黑色运动鞋，我们可以使用各种特征来编码它，例如：
- 鞋子的大小
- 鞋子的材质
- 鞋子的颜色
- 鞋子的形状
- 鞋子的品牌
- 鞋子的价格


我们可以将这些特征组成一个向量，并使用一种嵌入技术（如Word2Vec）将其映射到一个向量空间中。这样，我们就可以使用KNN算法来搜索最相似的向量，即最相似的黑色运动鞋。

比如我们用以下特征来编码黑色运动鞋：
- 鞋子的大小为10
- 鞋子的材质为皮革
- 鞋子的颜色为黑色
- 鞋子的形状为运动鞋
- 鞋子的品牌为Adidas
- 鞋子的价格为100元


我们可以将这些特征组成一个长度为6的向量：
- `[10, 0, 0, 0, 1, 100]`


其中，第一个元素表示鞋子的大小，第二个元素表示鞋子的材质，第三个元素表示鞋子的颜色，第四个元素表示鞋子的形状，第五个元素表示鞋子的品牌，最后一个元素表示鞋子的价格。


然后，我们可以使用嵌入技术（如Word2Vec）将这个向量映射到一个向量空间中，例如：
- `[-0.12, 0.56, 0.23, -0.87, 0.43, 0.76]`

现在，我们可以使用KNN算法来搜索与这个向量最相似的其他向量，就可以推荐给用户最相似的黑色运动鞋了。

我可以随机mock几个商品，并计算它们与黑色运动鞋之间的相似度。这里我先随机mock三个商品：
- 商品1：尺码9，材料为纺织品，颜色为蓝色，形状为跑步鞋，品牌为Nike，价格为80元。
- 商品2：尺码10，材料为皮革，颜色为白色，形状为篮球鞋，品牌为Jordan，价格为200元。
- 商品3：尺码11，材料为纺织品，颜色为黑色，形状为足球鞋，品牌为Puma，价格为120元。

假设我们已经将这些商品的特征编码，并使用嵌入技术将它们映射到向量空间中。现在，我们可以使用KNN算法来计算它们与黑色运动鞋之间的相似度。

假设我们已经将黑色运动鞋和其他商品的特征编码成向量，并使用嵌入技术将它们映射到向量空间中。现在，我们可以使用余弦相似度来计算它们之间的相似度。余弦相似度的计算公式如下：

```
similarity = cos(theta) = Dot Product(A, B) / (||A|| * ||B||)
```

其中，A和B分别是两个向量，||A||和||B||分别是它们的模长（即长度），Dot Product(A, B)是它们的点积，也就是对应元素相乘后再求和。


例如，在上面的例子中，假设黑色运动鞋的向量为：
- `[-0.12, 0.56, 0.23, -0.87, 0.43, 0.76]`

商品1的向量为：
- `[9, 1, 0, 1, 2, 80]`


我们可以将商品1的向量归一化为单位向量，即：
- `[0.11, 0.01, 0, 0.01, 0.02, 0.99]`


现在，我们可以计算它们的余弦相似度：`similarity = Dot Product([-0.12, 0.56, 0.23, -0.87, 0.43, 0.76], [0.11, 0.01, 0, 0.01, 0.02, 0.99]) / (||[-0.12, 0.56, 0.23, -0.87, 0.43, 0.76]|| * ||[0.11, 0.01, 0, 0.01, 0.02, 0.99]||) = 0.425`

这样，我们就计算出了商品1和黑色运动鞋之间的相似度。按照同样的方法，可以计算出商品2和商品3与黑色运动鞋之间的相似度。

# 感想
大人，时代变了。从es的发展就可以看出，纯分词搜索依然必要，但终归也是要拥抱算法的。

