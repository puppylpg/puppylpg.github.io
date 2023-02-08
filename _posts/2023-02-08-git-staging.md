---
layout: post
title: "Git - staging area"
date: 2023-02-08 23:21:20 +0800
categories: git
tags: git
---

虽然git早就玩的比较熟练了，但是一直对[暂存区（staging area）](https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E8%AE%B0%E5%BD%95%E6%AF%8F%E6%AC%A1%E6%9B%B4%E6%96%B0%E5%88%B0%E4%BB%93%E5%BA%93)的存在不甚理解。最近教我弟git，才发现不太能说明白暂存区有什么用。再好好看看暂存区，思来想去，全是intellij idea害的:D 被它的GUI坑了。

1. Table of Contents, ordered
{:toc}

# staging area
暂存区，之所以是暂存，是因为接下来就准备把它commit到git仓库里，称为提交记录树的一个节点了。把变更加入暂存区，就意味着变更已经纳入到git的管理范畴了，不用再怕工作区文件被改坏了。

> staging area也叫index。因为`git add`实际是把变动添加到`.git/index`文件，它是一个二进制文件。

之前对`git add [files]`把变更加入暂存区没什么感触，是因为idea的GUI显示的都是本次修改内容和上次提交不同的地方（diff），无论是否add，diff都没什么区别。所以使用add把变更加入暂存区的意义就被弱化了。

实际上，文件加入暂存区前后，`git diff`是不同的，通过`git diff`就能感受到staging area的作用。简言之：
- `git diff`：工作区vs暂存区，显示的是**工作区比暂存区多的内容**；
- `git diff --staged`：暂存区vs上次已提交，显示的是**暂存区比上次提交多的内容**；
- `git diff HEAD`：工作区vs上次已提交，显示的是**工作区比上次已提交多的内容**。而idea的gui实际使用的应该就是这条指令，不是单纯的`git diff`；

> `git diff`还可以查看很多东西的差异，[`git diff <common>`](https://git-scm.com/docs/git-diff#Documentation/git-diff.txt-emgitdiffemltoptionsgt--merge-baseltcommitgt--ltpathgt82308203)只是其中一个用法，比如`git diff HEAD`。**如果只写一个commit，默认就是working directory和commit的区别**：[`git diff [<options>] [--merge-base] <commit> [--] [<path>…​]`](https://git-scm.com/docs/git-diff#Documentation/git-diff.txt-emgitdiffemltoptionsgt--merge-baseltcommitgt--ltpathgt82308203)。类似地，如果想单纯比较两个commit的差异，用`git diff [<options>] [--merge-base] <commit> <commit> [--] [<path>…​]`。比较两个commit之间的一系列差异，用`git diff [<options>] <commit>...<commit> [--] [<path>…​]`。如果忽略其中一个commit，默认是HEAD。

考虑以下场景：
1. 如果原始内容为1；
2. 修改为2；
3. `git add`到暂存区。

此时`git diff`为空，因为git diff默认显示的是工作区~~和暂存区的差异~~比暂存区多的东西。现在工作区的变更已经都加入暂存区了，所以没什么diff了。

> `git diff`，此命令比较的是工作目录中当前文件和暂存区域快照之间的差异。 也就是修改之后还没有暂存起来的变化内容。

如果想看暂存区里的东西（暂存区比上次提交多的），用`git diff --staged`（或者`--cached`），显示1 --> 2。

> 用`git diff --cached`查看已经暂存起来的变化。

如果此时继续把2修改为3，但是不再`git add`：
- `git diff`：显示2 -> 3；
- `git diff --staged`：显示1 --> 2；
- `git diff HEAD`：显示1 --> 3；

ref：
- https://stackoverflow.com/questions/13057457/show-both-staged-working-tree-in-git-diff

**所以暂存区虽然还没有成为git树结构上的一个节点，但它其实已经是一个“准节点”。加入暂存区也算加入git的管理范畴了，diff就没了。**

之前搞定一部分工作后要暂时离开，怕误触什么按键导致工作区产生误修改，就会把本次修改的代码先commit。但实际上工作还没有完全改完，搞成一个commit显得有点儿小题大做，导致真正完成一次任务会产生多次不必要的commit。实际上应对这种情况使用`git add`就可以了，加入暂存区已经足够。**万一工作区再产生误修改，把工作区恢复到暂存区的状态即可**。

# 暂存区的文件操作
## 清空工作区（+暂存区）
`git checkout`可以用于从某个节点恢复文件。

[`git checkout [-f|--ours|--theirs|-m|--conflict=<style>] [<tree-ish>] [--] <pathspec>…​`](https://git-scm.com/docs/git-checkout#Documentation/git-checkout.txt-emgitcheckoutem-f--ours--theirs-m--conflictltstylegtlttree-ishgt--ltpathspecgt82308203)：
> Overwrite the contents of the files that match the pathspec. When the <tree-ish> (most often a commit) is not given, overwrite working tree with the contents in the index. When the <tree-ish> is given, overwrite both the index and the working tree with the contents at the <tree-ish>.

**该命令可以使用某次commit覆盖掉工作区和暂存区的内容。如果没有指定commit，则是使用暂存区的内容覆盖工作区**，相当于清掉了`git add`以后工作区的变动：
- `git checkout HEAD .`，指定了tree-ish（HEAD），所以用上次commit后的内容覆盖工作区和暂存区；
- `git checkout -- .`，没指定tree-ish，用index的内容覆盖工作区。

至于命令中的`--`，则是为了防止歧义，怕把pathspec误解成tree-ish了。这一点应该是仿照的bash的`--`：
- https://stackoverflow.com/questions/13321458/meaning-of-git-checkout-double-dashes
- https://git-scm.com/docs/git-checkout#_argument_disambiguation
- bash的`--`：https://unix.stackexchange.com/a/452793/283488

## 移出暂存区
**可以使用`git rm --cached xxx`将已纳入暂存区（已经被git管理了）的文件从暂存区里删掉，但是依然留在工作区中**。

- https://git-scm.com/docs/git-rm

如果不加`--cached`，则将文件同时同暂存区和工作区删除。

# 其他关于暂存区的内容
关于暂存区还有一些使用方式：
- 可以直接`git commit -a`把add和commit合成一条指令以省略`git add .`，很适合之前压根不怎么使用staging area的场景（反正也没打算使用暂存区，只是在commit变更之前不得不按照git要求把变更代码add到暂存区，不如直接一步到位，一条命令做两件事:D）；

# 感想
学会一丢丢git的用法，就完全够用了。但是偶尔新学会某一个用法，发现可选的骚操作又变多了:D 这就很有意思，就像在一个已经玩得很熟的游戏中，一不小心又解锁了一个奇奇怪怪的成就。

> 关于GUI，我从一开始就坚持使用git指令操作git，只使用gui看看diff的思路是正确的，少走了很多弯路。但是没想到即便如此，即便只用到了gui的diff，依然能让我在diff上栽跟头o(╥﹏╥)o

