---
title: Stanford ML
date: 2020-10-20 20:44:00 +0800
---


# link
https://www.coursera.org/learn/machine-learning?isNewUser=true

# Introduction
supervised learning: "right answers" given

- Regression: predict continuous valued output(eg: price)
- Classification: discrete valued output(eg: 0 or 1. or more results: 0, 1, or 2)


Unsupervised Learning: no right answer. 算法自己给所有数据分分类，哪些是同一类型。“聚类算法”。比如给一堆新闻，同一类新闻放一起。给人分类，同一类人，我们也不知道他们属于哪一波，有什么特性，反正你就分成一波一波就行了。

聚类（无监督学习）和分类（监督学习），从本质上理解就是有没有label（right answer）：
- 一堆病人，自动分成不同的组，是聚类；
- 一堆病人，有的得了癌症，有的没有癌症，给一个病人学会判断他是否得癌症，是分类；

聚类甚至可以自动归类人声和bgm，从而实现人声和bgm分离技术。

# Linear regression with one variable

## 损失函数
损失函数：平方差的和，除以个数。

$$ J(\theta) = \frac{1}{2n} \sum_{i=1}^{n}(h_\theta(x_i) - y_i)^2 $$

> 小trick，实际是除以2n，多除个2，应该是损失函数求导后有个2，就可以正好消掉这个2。

如果y=kx，损失函数是关于k的函数，是二维的。（实际是关于k^2的函数，二次函数。）

> 损失函数是个convex function，即凸函数，所以可以找到最小值。

如果y=kx+b，损失函数是关于k和b的二元函数，所以是个三维曲面。最低点处的k和b，就是使模型拟合最好的参数。

如果参数更多，损失函数的图形会更复杂。

## 梯度下降
导数（derivative）为0，函数取极值。所以损失函数的导数为0时，损失最小。

但是，损失函数可能很复杂，导数也可能很复杂，怎么求导数为0？

梯度下降：对于关于k的损失函数J(k)，不断让

$$ k = k - \alpha \frac{\partial}{\partial k}J(k) $$

即可。当k不再变动，就到了极值。

> 对theta 0求偏导，很正常。对theta 1（变量x1的系数）求偏导，别忘了同时对cost function（平方）的内部函数求导，所以最后还要乘个x1。

alpha就是学习速率。如果太大，可能不会converge，而是diverge。但是alpha是fixed，无需改变。斜率会自动变化，从而自动影响学习步长。

> 梯度下降其实就是求导数=0的另一种方式。

如果模型有多个参数，损失函数就是关于多个变量的函数。梯度下降针对变量的求导就变成了针对某个变量的求偏导。

For the specific choice of cost function J(k, b) used in linear regression, there are no local optima (other than the global optimum).

事实证明，损失函数的图像总是bowl shaped（convex function，凸函数）。所以只要选了一个损失函数，就会有唯一的极值（最值）。如果模拟不佳，可能是损失函数的选择问题，或者模型变量的选择问题，而不是“梯度下降到了极值没下降到最值”的问题。

> 还有一种是正规方程法（Normal Equation），不需要迭代，但是数据集很大时会计算很慢。梯度下降法数据很大时依然工作良好。

# 矩阵 向量
n*m的矩阵有时候也这样表示：

$$ I\kern-2.5pt R^{n*m} $$

下标访问：

$$ A_{ij} $$

从一开始数。因为这是数学家定的，不是程序员……

向量：n*1矩阵（**所以是竖着的**）。所以向量也可以用矩阵表示，比如：

$$ I\kern-2.5pt R^{4} $$

列恒为1列，所以省略。

下标访问：

$$ y_{1} $$

不过vector的下标访问有两种传统，一种是0开始，一种是1开始（默认）。

> 一般矩阵用大写字母表示，向量用小写字母。

## 矩阵特性
矩阵相乘没有交换律，但是有结合律。

## identity
scalar标量乘法的identity是1，矩阵乘法的标量是对角线为1，其他为0的矩阵。

使用I代替。而且这种矩阵不只有一个，对于3*3矩阵，identity也是3*3的，其他矩阵同理。


$$ A_{m \times n} \times I_{n \times n} = I_{m \times m} \times A_{m \times n} = A_{m \times n} $$


## inverse
常量有倒数，除了0。

矩阵里，只有square matrix（行列数相等）有倒数。

倒数相乘为标量的identity，1；矩阵倒数相乘为矩阵的identity。


$$ A_{m \times m} \times A_{m \times m}^{-1} = A_{m \times m}^{-1} \times A_{m \times m} = I_{m \times m} $$


怎么求inverse？先不管了，交给软件去求就行了。

## transpose
转置。沿对角线翻转一下。

如果B是A的转置：

$$ B_{n \times m} = A_{m \times n}^{T} $$

那么：

$$ B_{ij} = A_{ji} $$


**加减乘、inverse、transpose。就需要这么多liner algebra线性代数基础。**

# Linear regression with multiple variable

multivariate linear regression:


$$ \theta = 
\begin{bmatrix}
\theta_{0} \\
\theta_{1} \\
... \\
\theta_{n} \\
\end{bmatrix}

x = 
\begin{bmatrix}
x_{0} \\
x_{1} \\
... \\
x_{n} \\
\end{bmatrix}

h_{0}(x) = \theta^Tx $$

x0是常量1，为了让变量向量x和参数向量theta同为n+1维的向量。

cost function:

$$ J(\theta_0,\theta_1,...,\theta_n) = \frac{1}{2m}\sum_{i=1}^m (h_\theta(x^{(i)} - y^{(i)}))^2 $$


## feature scaling + mean normalization
尽量让各个feature的取值范围等比例，比如x1范围是千，x2是个，整个损失函数的等高线是一个椭圆。比例相差越大越椭。梯度下降时不好找方向，建议x1/1000，让两个变量比例相同。

feature scaling + mean normalization：

$$ x_i := \frac{x_i - \mu_i}{s_i} $$

u为该特征数据的均值，s为特征数据max-min，**mean normalization让值接近0，feature scaling让范围在1以内**。

> trick：会让梯度下降训练的更快。

建议变量的取值都处理到[-1, 1]的范围，或者说个位的量级，毕竟x0=1。一般是让变量减去均值再除以范围。

# polynomial regression 多项式回归
有时候规律明显不符合直线，可以用曲线，也就是多项式模型。**毕竟不符合直线特征的数据集再怎么用直线模拟，上限也不会高。所以这就是选择模型，或者说创造模型的重要性。模型构造的好，整个模型的效果上限就会很高。**

多项式可以是x的几次方，也可以是`x1*x2`。比如预测房价，长、宽是因素，长×宽（面积）也是，可以把`x1*x2`作为x3。

如果这样搞，feature scaling就更重要了，因为一平方，整个范围扩大了好多，如果有x1，有x1^2，后者会比前者范围偏差太多，所以要scale一下。


# Normal Equation 正规方程
用于求解线性回归的参数解。

对于一个普通的二次方程（其实是一个cost function），求导让值为0即可得出极值。对于y=kx，只有一个参数k，适用于这种情况。

如果参数有多个，cost function就是一个关于多个theta的二次方程，那就对每个theta求偏导，等于0，得出所有的theta值。但是很麻烦。

每一个样本的各个特征，构成一个向量：

$$ x^{(i)} = 
\begin{bmatrix}
x_{0}^{(i)} \\
x_{1}^{(i)} \\
... \\
x_{n}^{(i)} \\
\end{bmatrix} $$

向量转置，构造一个矩阵X。比如：

age (x1) | height in cm (x2) | weight in kg (y)
---|---|---
4 | 89 | 16
9 | 124 | 28
5 | 103 | 20


$$ x^{(2)} = 
\begin{bmatrix}
9 \\
124 \\
28
\end{bmatrix} $$



$$ X = 
\begin{bmatrix}
4 & 89 & 16 \\
9 & 124 & 28 \\
5 & 103 & 20
\end{bmatrix} $$



$$ Y = 
\begin{bmatrix}
16 \\
28 \\
20
\end{bmatrix} $$

正规方程能直接求出theta向量（所有的theta值）：

$$ \theta = (X^TX)^{-1}X^Ty $$

而且不太用考虑feature scaling。

## normal equation和gradient descent的区别
- 学习速率alpha：梯度下降要考虑，正规方程不存在这东西；
- 迭代：梯度下降要迭代，正规方程一步到位；

但是，当特征很多，设为n时：
- 特征多：X^T * X是一个n*n矩阵，对它求inverse，复杂度是n^3。所以特征过多（比如1000），就炸了。梯度下降不用考虑，多少个特征都这样；
- 算法复杂：正规方程也就线性回归用用，其他模型就不适用了。**梯度下降是最朴素的方法，什么算法都适用**；

> 正规方程算是简单线性回归的一种高级计算参数的方式，用不了其他场景。


# 向量化
当时用for循环计算矩阵和向量的乘积时（每个点想成再求和），不妨直接用矩阵乘以向量。或者面对类似的公式，把他们抽象出矩阵和向量。这种高层级的抽象比低层次的循环要方便得多。

# Classification & Logistic Regression
分类问题不能用线性回归来解决。

线性回归还会有大于1或者小于0的预测值，对分类问题来讲根本不存在。

所以使用逻辑回归。逻辑回归的值在[0,1]，被用于分类问题，名称中的“回归”只是历史原因，**实际上逻辑回归是一个分类问题的算法**。

## sigmoid function
S型函数：

$$ g(z) = \frac{1}{1+e^{-z}} $$

范围为(0,1)，所以把**线性回归**的结果放在**sigmoid函数**里转换一次，输出只能在0和1之间了。二者的组合就变成了**逻辑回归**的假设函数（模型）。

sigmoid函数又叫逻辑函数，这就是“逻辑回归”的由来。

逻辑回归的输出值的意义：给定某x，y=1的概率。

> 但是线性回归不能搞分类问题，这点怎么破？


### 为什么sigmoid函数可以？
其实任何值域在[0,1]的函数都可以。如果线性回归h(x)的函数值经过所选的函数变形之后，值>=0.5认为是1，反之认为是0，那么使用sigmoid函数来改变原有的线性回归h(x)，其实是在训练一条h(x)=0的直线（如果是更高多项式级的，也可以说是曲线），此时的参数theta是使原有的线性回归函数=0，因为>0的部分会被sigmoid变形为1，<0会被变形为0.

**所以，如果不用sigmoid，用另一个值域在(0,1)的函数，也是没问题的，假设该函数在x>1的时候y>0.5，反之y<0.5，现在我们要训练的theta，实际是h(x)=1这条线**。

> **取的变形函数不同，训练出的theta也不同，但最终功能都是一样的。**

这条线叫做Decision Boundary。

## cost function
线性回归的损失函数是二次的，所以是个convex函数，有最小值。

逻辑回归的函数是非线性的，如果还套用到平方差损失函数里，损失函数不再是convex，会有无数个极小值。所以要想出一个新的损失函数。

所以找了两个cost function：

$$
J(\theta) = \frac{1}{m} \sum_{i=1}^{m}Cost(h_{\theta}(x^{i}), y^{i})

Cost(h_{\theta}(x), y) = -log(h_{\theta}(x)), if, y = 1

Cost(h_{\theta}(x), y) = -log(1-h_{\theta}(x)), if, y = 0 
$$

-log(x)在(0,1)上是递减的，-log(1-x)在(0,1)上是递增的。

所以y=1时，用递减的函数，如果h(x)预测的越接近1，误差越小；同样y=0时，用递增的函数，如果h(x)预测的越接近于0，误差越小。

> 这里的h(x)指的是逻辑回归函数。而不是一开始说的往sigmoid函数里套的线性回归函数。

这样，逻辑回归的损失函数就是一个凸函数了。

但是两段毕竟太麻烦了，可以把他们合成一个式子：

$$ Cost(h_{\theta}(x), y) = -ylog(h_{\theta}(x))-(1-y)log(1-h_{\theta}(x)) $$

其实这个式子并不复杂，y只能取0或1，当取0的时候，只有后半段，反之只有前半段。所以还是刚刚的两个分段函数，只是合成一个了。

所以，对于整个数据集，cost function就是：

$$ J(\theta) = -\frac{1}{m} \sum_{i=1}^m[y_i log(h_{\theta}(x_i)) + (1-y_i)log(1-h_{\theta}(x_i))] $$


有了cost function，剩下的就和线性回归梯度下降求theta的思想一致了。

## multiclass classification 多分类
预测的不止0和1两个值。

使用one-vs-all的思想：比如要预测三个值，先训练一个区分1和其他的h1(x)，在训练一个区分2和其他h2(x)，最后训练一个区分3和其他的h3(x)。

需要预测一个x是123中的哪一个，就分别代入三个函数，看哪个值最大，x为这个分类的confidence就最大。

不过k分类要训练k个分类函数，有点儿暴力啊……

> 虽然k分类要训练k个分类函数，但是2分类还是训练一个就够了。。。这点儿别被绕进去了。毕竟训练个区分A和B的，就能区分出二者了，因为A剩下的全是B，而不是BCD之类的混合。

# overfitting & underfitting
如果有太多特征（包括原始特征平方、特征交叉等等多项式特征），h(x)的偏差趋近于0，那就不太能泛化到新的样本（正确地估计新样本）。

如果h(x)太简单，特征不足，可能会欠拟合。

简单的模型可以画一画，太过弯曲的曲线说明过拟合了。通用的解决过拟合的方法：
1. 减少特征：
    - 自己判断哪些特征不重要，扔掉；
    - 一些特征选择算法；
2. Regularization 正则化，正规化：
    - 保留所有特征，但是减少某些参数的量级；
    - 特征很多时比较有效，尤其适用于每一个特征都会对预测做出轻微贡献的情况；

# Regularization
假设二次函数

$$ h_1(x)=\theta_0 + \theta_1x + \theta_2x^2 $$

能模拟一个数据集。我们却错误的使用了

$$ h_2(x)=\theta_0 + \theta_1x + \theta_2x^2 + \theta_3x^3 + \theta_4x^4 $$

这个函数可能弯弯曲曲，让训练数据过拟合了。

## Regularization Cost Function
如何消除三次项和四次项带来的影响？

此时如果改一下cost function，把theta3和theta4也加进去，再加个大系数：

$$ J(\theta) = \frac{1}{2n} \sum_{i=1}^{n}(h_\theta(x_i) - y_i)^2 + 1000\theta_3^2 + 1000\theta_4^2 $$

按照这个cost function训练出来的h2(x)，theta3和theta4一定都很小，从而最后两项都可以忽略不计，整个hx(x)又是一种趋近二次函数h1(x)的样子（当然，并不是标准的二次函数。不过话说回来，我们也并不需要一个标准的二次函数，大概是这个形状就行了）

这就是Regularization的思想。

但问题在于，怎么知道哪个项是不需要的，从而把它的系数加入cost function？实际上，把所有的系数都加进来就行了。

假设有m个数据，n+1个feature，线性回归的cost function：

$$ J(\theta) = \frac{1}{2m} \sum_{i=1}^{m}(h_\theta(x_i) - y_i)^2 + \lambda \sum_{j=1}^n \theta_{j}^{2} $$

逻辑回归的cost function：

$$ J(\theta) = -\frac{1}{m} \sum_{i=1}^m[y_i log(h_{\theta}(x_i)) + (1-y_i)log(1-h_{\theta}(x_i))] + \frac{\lambda}{2m} \sum_{j=1}^{n}\theta_{j}^{2} $$


这里只把theta1到theta n纳入进来了，没有纳入theta 0，不过它是个常数项，加不加无所谓。

## Regularization Parameter
这样，所有的theta都被纳入考虑范围内，都不会太大。**可以平滑整个预测函数，避免过拟合**。

而lambda则是**正则化系数，用来调整theta参数所带来的代价**。
- 如果lambda趋近于0，cost function还是原来的cost function，即不太关注过拟合问题，所以最后可能会过拟合；
- 如果lambda太大，此时为了让cost function最小，所有的theta都会趋近于0，这样的函数只剩下theta 0这一项了，就是一条直线，显然不足以拟合当前数据集；

所以正则化系数的设定，代表了更注重过拟合还是更注重欠拟合。

# Neural Network - 逻辑回归的层层叠加
为什么要用神经网络？

对于传统的线性回归或者逻辑回归，如果特征数n很大，比如1000，特征之间光二次项的相互组合就有1000*1000/2项（n^2量级），计算量太大。

到了计算机视觉领域，100*100 pixel的图片就10^4个像素点，假设每个像素点是一个特征，两个像素点就能组合出10^8的量级。假设一张图仅考虑2个像素点的组合特征，判断是不是小汽车，会有10^8量级的特征。完全没法算。

> 神经网络上世纪就有了，现在才火起来是因为现在计算机的计算速度够快了。

神经网络一开始是为了模仿大脑的。

神经元：输入信号、计算信号、输出信号。一个神经元的信号可以输出给多个下一层神经元。

神经网络就是模仿神经元这个构造的模型。

第一层（输入层）有三个输入x1/x2/x3，第二次（hidden layer）有三个神经元，第三层（输出层）有一个神经元，计算出一个输出函数h(x)，即模型。那么每一个神经元是这么计算出来的：

$$ a_1^{(2)} = g(\Theta_{10}^{(1)}x_0 + \Theta_{11}^{(1)}x_1 + \Theta_{12}^{(1)}x_2 + \Theta_{13}^{(1)}x_3) \newline a_2^{(2)} = g(\Theta_{20}^{(1)}x_0 + \Theta_{21}^{(1)}x_1 + \Theta_{22}^{(1)}x_2 + \Theta_{23}^{(1)}x_3) \newline a_3^{(2)} = g(\Theta_{30}^{(1)}x_0 + \Theta_{31}^{(1)}x_1 + \Theta_{32}^{(1)}x_2 + \Theta_{33}^{(1)}x_3) \newline h_\Theta(x) = a_1^{(3)} = g(\Theta_{10}^{(2)}a_0^{(2)} + \Theta_{11}^{(2)}a_1^{(2)} + \Theta_{12}^{(2)}a_2^{(2)} + \Theta_{13}^{(2)}a_3^{(2)}) \newline $$

**把这里的Theta当成theta（矩阵Theta的第i行第j列的元素，可不就是theta嘛！）**。计算下一层的时候都给这一层加个bias unit，通常为1。

所以计算第二层的a1需要四个参数分别乘以x0-x3，a2和a3同理。那么从第一层计算出第二层，需要一个3x4的矩阵。将x1-x4计算出三个值。

同理计算第三层，需要1x4的矩阵。

> 第i层有n个节点，第i+1层有m个，两层之间就是一个 **`m*(n+1)`** 维的矩阵。

**这里不知道为什么，每一层都是拿层与层之间的映射矩阵乘以上一层的unit向量，所以矩阵的维度是`m*(n+1)`，而不是`(n+1)*m`**。

然后就发现，**神经网络实际是把上一层的所有神经元当做一个特征，做一个逻辑回归，得出下一层的一个神经元**。**这就避免了直接拿输入层作为特征直接做逻辑回归得出h(x)，还要试类似于`x1*x2`特征。有了hidden layer，输入层先做逻辑回归得出中间层的复杂特征，再用这些复杂特征做逻辑回归得出最终的h(x)**。所以是不是免去了手试特征组合的过程？

> 如果神经网络只有输入层和输出层，没有中间的hidden layer，那它就是一个普通的逻辑回归。

**神经网络的中间层很像倒推一步：为了得到结果（输出层），需要知道xxx，然后想怎么从输入层的得到xxx就行了。这样，一个hidden layer，相当于将input -> output拆成了两步，两个小问题。这就是解一个复杂问题的思路啊！！！一步步倒推，直到从输入能直接得到某一步倒推为止**。

eg：A xnor B = (A and B) or ((not A) and (not B))，A和B想得到xnor，可以有一个hidden layer，两个unit，一个是and，另一个是not and not，最后两个unit在输出层合成一个xnor。

## cost function
逻辑回归的损失函数：

$$ J(\theta) = -\frac{1}{m} \sum_{i=1}^m[y_i log(h_{\theta}(x_i)) + (1-y_i)log(1-h_{\theta}(x_i))] + \frac{\lambda}{2m} \sum_{j=1}^{n}\theta_{j}^{2} $$

**神经网络其实就是每一层的每一个unit，都是上一层的逻辑回归得来的**。所以它的损失函数是：

$$ J(\Theta) = - \frac{1}{m} \sum_{i=1}^m \sum_{k=1}^K \left[y^{(i)}_k \log ((h_\Theta (x^{(i)}))_k) + (1 - y^{(i)}_k)\log (1 - (h_\Theta(x^{(i)}))_k)\right] + \frac{\lambda}{2m}\sum_{l=1}^{L-1} \sum_{i=1}^{s_l} \sum_{j=1}^{s_{l+1}} ( \Theta_{j,i}^{(l)})^2 $$

看起来很复杂，其实很好理解。
1. 前半部分，结果偏差。因为一次输出k个unit（用k维向量表示），所以每一个都可能偏差，要把输出的所有k个值的偏差累加起来作为本次输出的总偏差；
2. 后半部分，防止过拟合的参数部分。L层（假设L=t），所以需要t-1个矩阵，每个矩阵的维度是“后一层unit个数r”×“前一层unit个数s + 1”。但是就像逻辑回归一样，不用把theta 0考虑进来，所以每个矩阵只需要考虑`r*s`个参数。t个矩阵一共有`r*s*t`个参数。当然，用乘法是不严谨的，更严谨的是公式里那样三个累加，这样就把神经网络里所有的参数都扔进来了。

## back propagation
为了最小化cost function，**需要求出cost function对每一个theta的偏导**，用了backpropagation这个算法。

~~每一个训练集的样本，代入theta，一层层正向传播（forward propagation）算出输出y'。然后算出这个y'与真实值y的的偏差，再反向传播（back propagation）算出每一个unit的误差。~~

~~具体为啥这样，目前我也不懂……~~

~~讲义：https://www.coursera.org/learn/machine-learning/supplement/pjdBA/backpropagation-algorithm~~

如何直观地解释 backpropagation 算法？ - Anonymous的回答 - 知乎
https://www.zhihu.com/question/27239198/answer/89853077

这个答案解释的非常直观！

cost function是对theta的复合函数，因为它对某一层theta求偏导，涉及到后一层的theta（后一层的theta由前一层theta得到）。而对复合函数求偏导，需要用到链式法则。链式法则（正着来），会有大量重复，对于实践来讲会重复计算很多路径。所以使用了BP算法（倒着来），把后一层节点对前一层节点的偏导值存放在前一个节点里，想知道对某个节点的偏导，把这个节点里堆积的值求和即可。

所以BP就是链式法则，只是实现上不一样。从后往前倒着来，减少了很多计算量。

一个形象地例子：正向-层层讨薪 vs. 反向-主动还款。

> 链式法则：复合函数求导用的就是链式法则……wtf……

## gradient checking
对于复杂的模型，虽然cost function在下降，但其实不知道back propagation计算出的每个theta的偏导有没有什么小bug。所以需要使用偏导的定义计算一个偏导数，和BP算出来的对比一下，差别不大说明没问题，之后就不需要验证了。

- BP快；
- 按定义计算每个theta的偏导速度慢，计算量大；

所以按照导数定义仅仅验证一次就行，真正的偏导计算还是用BP。

导数（偏导）定义（一元函数）：

$$ \frac{\partial}{\partial \Theta}J(\Theta) = \frac{J(\Theta + \epsilon) - J(\Theta - \epsilon)}{2\epsilon} $$

偏导定义（多元函数）：

$$ \frac{\partial}{\partial \Theta_j}J(\Theta) = \frac{J(\Theta_1, ..., \Theta_j + \epsilon, ..., \Theta_n) - J(\Theta_1, ..., \Theta_j - \epsilon, ..., \Theta_n)}{2\epsilon} $$


> **导数（偏导）的本质是slope。**

## 随机初始化
神经网络不能像逻辑回归一样，全部初始化为0。更准确的说，神经网络的初始参数不能全一样，否则对于第二层的神经元，他们的input和theta都一样，unit也都一样，BP产生的梯度也都一样，进而导致同样的theta改变同样的值，theta还是一模一样。最终产生的神经网络的层与层之间的矩阵的theta都一样。

为了让他们不一样，一般随机初始化（不同的接近零的值，在-epsilon~+epsilon之间）：

If the dimensions of Theta1 is 10x11, Theta2 is 10x11 and Theta3 is 1x11:
- Theta1 = rand(10,11) * (2 * INIT_EPSILON) - INIT_EPSILON;
- Theta2 = rand(10,11) * (2 * INIT_EPSILON) - INIT_EPSILON;
- Theta3 = rand(1,11) * (2 * INIT_EPSILON) - INIT_EPSILON;

rand(x,y) is just a function in octave that will initialize a matrix of random real numbers between 0 and 1.

(Note: the epsilon used above is unrelated to the epsilon from Gradient Checking)

简言之，神经网络计算每一层的神经元都是一个逻辑回归，如果input和theta都一样，逻辑回归也就一模一样。

## 总结
默认神经网络结构：
- 输入单元个数：特征维度；
- 输出单元个数：k分类的k；
- 隐藏层层数：默认为1，如果有多层，每层的神经元个数最好相同；
- 每层神经元个数：通常越多越好，但是算起来会越麻烦；

> 需要注意的是，output为k种，一般用独热编码向量表示，而不是用纯数字1,2,3,4,5,……,k表示

训练步骤：
1. 随机初始化（接近epsilon，但别相同）；
2. forward propagation；
3. implement the cost function；
4. BP to compute partial derivatives；
5. check BP算的梯度约等于倒数算出来的。然后禁用check；
6. 梯度下降或者其他算法，缩小cost function，确定theta；

神经网络不像线性回归，会更复杂，所以图像不是convex的。这也就说明网络可能会到达非全局最小值，而仅仅是某一个极小值。不过根据经验，即使只能让cost function缩小到极小值，也会得到不错的效果。

# 模型选择&效果评估
## 验证集
如果要对一个数据集建模，比如单考虑x的多项式，那应该用到x的多少次方？

比如从只有一次方一直到十次方。十个模型。

将数据划分训练集，测试集。训练所有的模型，看哪一个在测试集上表现更好。但这是有问题的。此时模型在测试集上的表现，并不足以代表泛化后的一般效果。

**因为其实是使用了测试集在和不同的模型拟合：相当于还有一个额外参数d代表多项式次数，通过测试集找出了对测试集拟合最好的参数d。再用这个测试集来评价模型效果作为泛化效果就不公平了。**

所以分为：训练集、验证集、测试集。在训练集训练，在验证集验证，挑出loss最小的模型，在测试集（从没见过）上的效果，才是该模型真正的泛化效果。

> **那么，如果不是选择模型，而是确定了模型，只用训练集和测试集是不是就足够了？**

### 之前看google的ml关于验证集的笔记
训练完毕，去测试集测试一发，发现不是很好，继续调整~~一些参数~~模型，继续训练，再测试……迭代多了，其实测试集也变成我们的训练集了，过拟合测试集了。那这模型效果肯定也不好。

所以不如将数据划分为训练集、验证集、测试集。（其实相当于把训练集拆分成两块了）。我们训练，然后再验证集上验证，再训练，直到效果不错，当且仅当此时，在测试集测试一次。

如果测试集效果不错，那说明模型不错。如果测试集效果不好，说明我们过拟合验证集了（也可以说是过拟合训练集了吧）。这时候感觉应该重建模型，重新调参。

> 有点儿像：开发+自测，可以了再提测。如果开发完就提测，发现不过再根据测试样例改代码，很可能最终只通过（应付过）了测试样例，但是实际上还是有bug的！这道理真的是相通的啊！

测试集（测试样例）越少暴露越好，这样过了测试更能证明模型（代码）的正确性。

## bias vs. variance
- bias: 欠拟合，train loss和test loss都很高；
- variance: 过拟合，train loss很低，test loss很高；








