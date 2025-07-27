---
title: Andrew Ng Sequence Model
date: 2020-12-01 14:58:00 +0800
---


序列化数据

# Recurrent Neural Network
## 场景
比如标注一句话里的名字。或者简单的说，判断一句话里的哪个单词是名字，那个不是。

标注：构造一个词典，每个单词有一个index，所以每个单词可以用一个one-hot向量表示（index位置为1，其余为0）。

为什么不能用朴素神经网络，而要用RNN（sequence model）？

显然，朴素神经网络不会共享从不同位置的文本学到的特征。比如名字重复出现，如果学习到了句子开头的pikachu是名字，理应意识到句子结尾的pikachu很可能也是名字，而不是当做一个完全不同的单词重新学习。就像CNN一样，一部分图像学到的参数可以泛化到其他部分（shared parameter）。

共享参数还能极大减少参数，要不然一本小说几十万几百万单词，按照朴素神经网络，参数爆炸了。

## detail
```math
a^i = g_1(W_1 \times a^{i-1} + W_2 \times x^i + b_1)

y^i = g_2(W_3 \times a^i + b_2)
```
即：
- 当前层输出ai是：上一层的输出（上一层的输出，而不是上一层的预测结果）a^{i-1}乘以矩阵w1，加上当前层输入xi乘以w2；
- 当前层的预测结果yi是：当前层的输出ai乘以矩阵w3；

三个矩阵在每一层都是相同的。

- g1在RNN里经常是tan，也可以是ReLU。
- g2经常是sigmoid或者是softmax函数。

既然在当前层，a^{i-1}和xi都算是input，一般将计算ai的式子简化：

假设`a^{i-1}`是100x1，W1是500x100，xi是200x1，W1是500x200。把w1和w2水平拼接（stack）为一个500x300的矩阵，`a^{i-1}`和xi竖直拼接为一个300x1的矩阵，二者直接乘就行了。

从表达式的字母表达上来看，更简洁：
```math
a^i = g_1(W \times [a^{i-1}, x^i] + b_i)
```

# 其他类型的RNN
上述RNN是many to many且input和output等长的。

## many to one
比如将电影的一句话转为一个评分。输入还是一句话，一个单词对应一层，只有最后一层有输出，其他层都不输出了。

## one to many
只有第一层有原始input。其它层的input都使用前一层的y。

## many to many but have different lengths
比如翻译，两种语言的句子长度经常不一致。

结构：前一部分还有input没有output，后一部分只有output没有input。

# vanishing gradients 梯度消失
https://www.coursera.org/learn/nlp-sequence-models/lecture/PKMRR/vanishing-gradients-with-rnns

NN层数过深的时候会有很多问题，比如梯度消失梯度爆炸，导致loss又变高了。（应该在深度学习那门课里讲了）

层数过深，在back propagation的时候，后面层很难影响到前面。

**在时间序列上间隔和延迟很长但又很重要的事件**：比如cat/cats, which ...., was/were cute. 这个cat/cats对was/were很重要，但被很长的定语阻隔了。

RNN显然就是层数很深的网络。比如cat/cats，中间一个很长的定语，was/were，单数复数其实是受很久之前的cat/cats影响的，跟挨着的单词到没什么关系。所以RNN需要解决这个问题。

- 梯度爆炸：gradient clipping可以解决
- 梯度消失：难搞
- 

# GRU - Gated Recurrent Unit
既然当前项可能跟很久之前的项有关，**那就创建这么一种机制**：

当前输出在极端情况下，可以是根据上一项计算得到的，也可以就是之前项的拷贝。一般情况下，是二者的加权平均：
```math
a^i = \Gamma_u * a_{candidate}^i + (1-\Gamma_u) * a^{i-1}

a_{candidate}^i = tanh(W \times [a^{i-1}, x^i] + b_i)
```
在之前的RNN中，`a_{candidate}^i`就是算出来的输出项`a^i`。所以现在，当Gamma为1时，`a^i`还是之前RNN中的`a^i`；当Gamma为0时，`a^i`就是它的前一项`a^{i-1}`。

所以现在**有了GRU的RNN，有了和远在它之前的项保持联系的能力（只要Gamma一直趋近于0）。然后让模型自己学习去吧。**

当然Gamma也是有自己的计算参数的：
```math
\Gamma_u = sigmoid(W_u[a^{i-1}, x^i] + b_u)
```
学习的时候Gamma的参数也是要学的。

这里之所以使用sigmoid，是因为它能产生介于0和1之间的值。

**所以现在懂了：机器学习的关键是当原有模型解决不了一个问题时，要有这么一种机制，引入这种机制就有可能解决这种问题。当然只有拟合的很恰当的情况下才可以。但机器学习不就是通过学习让它自动去拟合吗？就好像一个逻辑回归在做了ReLU之后就能区分非线性分类了嘛？不一定，但至少提供了一种非线性的机制，让模型有了这种可能。在拟合的好的情况下，是可以区分非线性分类的。**

上面是GRU的一个简化版本，真正的GRU还要在计算candidate的时候再加一个Gamma：
```math
a_{candidate}^i = tanh(W \times [\Gamma_r * a^{i-1}, x^i] + b_i)

\Gamma_r = sigmoid(W_r[a^{i-1}, x^i] + b_r)
```
相当于又加了一个relevance gate，表示计算`a^i`的时候，和`a^{i-1}`有多相关。

反正**事实证明（机器学习有时候哪个会更好，真没法仅从理论上下结论）** 这个比前一个简化版的好，所以GRU就用这个了。

所以GRU有两个gate：
- update gate;
- relevance gate;

# LSTM - Long Short Term Memory
是GRU更泛化的版本。

lstm不是直接拿前一项输出`a^{i-1}`更新当前项输出`a^i`，而是更新当前项的memory cell `c^i`，`a^i`是给`c^i`再加一个非线性变换：
```math
c_{candidate}^i = tanh(W \times [a^{i-1}, x^i] + b_i)

c^i = \Gamma_u * c_{candidate}^i + \Gamma_f * c^{i-1}

a^i = \Gamma_o * tanh \ c^i
```
所以说GRU是LSTM的一个ci = ai时候的特例。

和GRU不太一样的地方是：
- 计算candidate的时候又不使用那个Gamma_r了；
- 计算ci的时候，不是一个单独的Gamma u控制ci，还有一个Gamma f；
- 最后计算ai的时候再加一个Gamma o；

所以LSTM有有三个gate（**UFO，233**）：
- update gate：Gamma u，更新当前ci；
- forget gate：Gamma f，忘记前一项c i-1的权重；
- output gate：Gamma o，调节当前输出项ai；

```math
\Gamma_u = sigmoid(W_u[a^{i-1}, x^i] + b_u)

\Gamma_f = sigmoid(W_f[a^{i-1}, x^i] + b_f)

\Gamma_o = sigmoid(W_o[a^{i-1}, x^i] + b_o)
```

所以现在，c变成了纯memory cell，可以让第100项记住第0项c100=c0，同时又太不影响中间99项的输出值a。

所以LSTM可以长期记忆之前的项啊。

https://colah.github.io/posts/2015-08-Understanding-LSTMs/

# bi-direcional recurrent neural network (BRNN)
RNN只能用到当前位置之前的单词的信息辅助预测，不能用当前位置之后的单词。所以想预测一句话开头的单词就很尴尬。

BRNN就是正反各来一遍。

比如5个输入输出，现在要计算第三项输出。
1. 因为RNN，y3要考虑a3，a3需要x3和a2，a2需要x2和a1，a1需要x1和a0，所以x123都纳入y3的input了；
2. 因为BRNN，y3要考虑a3'，a3'需要考虑x3和a4'，a4'需要考虑x4和a5'，a5'需要考虑x5和a6'，所以x345都纳入y3的input了。

这样一来，整个句子都纳入y3的input了。

```math
y^i = g(W_y[a^i, a^{i'}] + b_y)
```

缺点：想处理一句话，必须等别人说完。所以不太能应用于实时的场景。

> 想想不就是这么个道理嘛，你想判断别人说的是不是人名，保守的话，那就是得等别人说完，然后根据上下文的意思去理解。当然作为人类，也可能不需要等到别人完全说完才能下结论，所以应该有类似这样的不那么保守的网络变体。





