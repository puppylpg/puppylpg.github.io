---
layout: post
title: Refresh - 前缀和
date: 2024-05-05 00:54:43 +0800
render_with_liquid: false
---

前缀和 + hash表优化查询速度。

1. Table of Contents, ordered
{:toc}


# 前缀和
前缀和指的是一个数组当前及之前位置所有数字的和。**获取前缀和数组s后，[i, j)这一段的数组和，可以直接用s[j] - s[i]来得到，所以前缀和常用来处理和“连续子区间”相关的问题**。

在一个数组中，根据i，在数组中寻找j，使得i + j = k，最快的方式是使用map达到On的时间复杂度。而前缀和需要s[j] - s[i] = k，所以前缀和经常使用map来根据s[j]寻找s[i]，来达到加速查询的目的。

> 关于前缀和的详细定义，可以看[这个回答](https://leetcode.cn/problems/find-longest-subarray-lcci/solutions/2160308/tao-lu-qian-zhui-he-ha-xi-biao-xiao-chu-3mb11/)。

# 思路演进
> 参考[暴力解法、前缀和、前缀和优化](https://leetcode.cn/problems/subarray-sum-equals-k/solutions/247577/bao-li-jie-fa-qian-zhui-he-qian-zhui-he-you-hua-ja/)

求一段区间的和，那么就要用两层for遍历所有的位置，作为区间的两端，O(n2)。然后再计算这一段区间内所有数据的和，O(n3)。当然因为是连续的求和，区间终点后移一位的时候可以利用之前一段区间的sum，从而不用把所有元素重新计算一遍，还是n2：
```java
public class Solution {
    public int subarraySum(int[] nums, int k) {
        int count = 0;
        for (int start = 0; start < nums.length; ++start) {
            int sum = 0;
            for (int end = start; end >= 0; --end) {
                sum += nums[end];
                if (sum == k) {
                    count++;
                }
            }
        }
        return count;
    }
}
```
即便如此，还是出现了很多重复计算。

一般**求一段区间的和为某个值，都会用到前缀和（假设为f(x)）**。i~j的和为k，也就意味着f(j)-f(i-1)=k。**从而把题目转化为了：在一个数组中（数组的值为原数组的前缀和），求一共有多少对数，他们的差为k**。这就一下子变成了类似LeetCode第一题：[1. 两数之和](https://leetcode.cn/problems/two-sum/description/)。如果先用for遍历第一个数，再用for寻找另一个数，那也是On2的复杂度。所以用map优化，直接以O1的复杂度找到另一个数。

创建新的前缀和数组的时候注意，要多加一个元素f(0)=0， 表示一个空数组的元素和。为什么要额外定义它？想一想，**如果符合条件的子数组恰好从0开始，你要用f(right)减去谁呢？通过定义 f(0)=0，任意子数组都可以表示为两个前缀和的差**。此时，**[i, j]区间的和为f(j) - f(i - 1)**。

[和为 K 的子数组](https://leetcode.cn/problems/subarray-sum-equals-k/description/)：
```java
    public int subarraySum(int[] nums, int k) {

        int n = nums.length;

        int[] sum = new int[n + 1];
        // f(0) = 0
        sum[0] = 0;

        // 转成前缀和后，求的是s[j] - s[i] = k。如果直接遍历是n^2
        for (int i = 1; i < n + 1; i++) {
            sum[i] = sum[i - 1] + nums[i - 1];
        }

        // 在第一题两数之和中，快速找另一个数的办法是用hash map
        int result = 0;
        // number -> freq
        Map<Integer, Integer> map = new HashMap<>();
        for (int j = 0; j < n + 1; j++) {
            // 找之前的前缀和，s[i] = s[j] - k
            int former = sum[j] - k;
            if (map.containsKey(former)) {
                result += map.get(former);
            }

            map.put(sum[j], map.getOrDefault(sum[j], 0) + 1);
        }

        return result;
    }
```

**前缀和的问题有两个关键点：**
1. **第一个关键点在于转化：怎么把一段区间的求值问题转化成前缀和数组里的某两个数的关系**；
2. **第二个关键点在于撇清关系：在转化后，除非让给出原区间的详情，否则转换后的问题已经和原区间没有任何关系了**；
    - 如果真让求原区间，那么**f(j) - f(i)代表[i, j)区间的和**（建议写个简单的数组[1, 2, 3]，并写出其前缀和数组[0, 1, 3, 6]，再看这个关系就很明确了：f(3) - f(1) = 5 = [1, 3)区间的和）；

# 转化
## 同余
**前缀和经常和同余定理一起出现，因为求子数组的和能被k整除，实际上就是f(j) - f(i) = nk，即f(j)和f(i)同余**。

比如[连续的子数组和](https://leetcode.cn/problems/continuous-subarray-sum/description/)，根据[这个题解](https://leetcode.cn/problems/continuous-subarray-sum/solutions/808246/gong-shui-san-xie-tuo-zhan-wei-qiu-fang-1juse/)可以知道，**其实是在求新数组中（前缀和数组）两个数同余**。题目加了额外限定条件为区间长度至少为2（原区间下标差至少为1），也就是说新的数组里两个数的下标差至少为2。

按照上面总结的关键点，此时题目变成了：
1. 求新数组里两个数同余；
2. 两个数的下标差>=2；

按照转化后的这两点去实现代码就行了，忘记原数组：
```java
class Solution {
    public boolean checkSubarraySum(int[] nums, int k) {
        int n = nums.length;

        int[] f = new int[n + 1];
        f[0] = 0;

        for (int i = 1; i < n + 1; i++) {
            f[i] = f[i - 1] + nums[i - 1];
        }

        // f(j) - f(i) = nk, 假设k为3，则fj - fi = 3n，所以fj和fi模3同余
        // <模, 索引>
        Map<Integer, Integer> map = new HashMap<>();
        for (int j = 0; j < n + 1; j++) {
            int former = f[j] % k;
            if (map.containsKey(former)) {
                // 两个数的距离至少差2
                if (j - map.get(former) >= 2) {
                    return true;
                }
            } else {
                map.put(former, j);
            }
        }

        return false;
    }
}
```

[和可被 K 整除的子数组](https://leetcode.cn/problems/subarray-sums-divisible-by-k/description/)，整体思路和上题一致，也是同余，但是这一题可出现负数，所以前缀和也可能出现负值。

一开始还想讨论s[j]和s[i]分别为正负时候的情况，但是太麻烦了。后来发现同余定理里，不分负数和正数（只要负数取正余数即可）。比如-4和2，关于3同余。-4 % 3 = 2, 2 % 3 = 2，则无论-4 - 2还是2 - (-4)都能被3整除。

**那么-4 % 3应该是几**？
- **如果取负余数，则-4 % 3 = -1 * 3 + (-1)，负余数为-1**；
- **如果取正余数，则-4 % 3 = -2 * 3 + 2，正余数为2**；

java里的模取的是负余数，python的模取的是正余数。**而[同余定理](https://baike.baidu.com/item/%E5%90%8C%E4%BD%99%E5%AE%9A%E7%90%86/1212360)指的是正余数，所以在java里需要需要把负余数转换成正余数，即(x % k + k) % k，无论x为正还是负，最终取的都是正余数**。
```java
class Solution {
    public int subarraysDivByK(int[] nums, int k) {

        int n = nums.length;
        int[] preSum = new int[n + 1];
        preSum[0] = 0;

        for (int i = 1; i < n + 1; i++) {
            preSum[i] = preSum[i - 1] + nums[i - 1];
        }

        int result = 0;
        // mod -> freq
        Map<Integer, Integer> map = new HashMap<>();

        // s[j] % k == s[i] % k
        for (int j = 0; j < n + 1; j++) {
            // java里负数的余数也是负数，再+k可转为正余数
            int mod = (preSum[j] % k + k) % k;
            result += map.getOrDefault(mod, 0);
            map.put(mod, map.getOrDefault(mod, 0) + 1);
        }

        return result;
    }
}
```

[1590. 使数组和能被 P 整除](https://leetcode.cn/problems/make-sum-divisible-by-p/description/)，这个题更麻烦一些：总数组的和sum去掉子数组的和（f(j) - f(i)）能被p整除，即sum和f(j) - f(i)同余，即f(j) - sum和f(i)同余：
```java
class Solution {
    public int minSubarray(int[] nums, int p) {
        int k = p;

        int n = nums.length;
        int[] preSum = new int[n + 1];
        preSum[0] = 0;

        for (int i = 1; i < n + 1; i++) {
            preSum[i] = (preSum[i - 1] + nums[i - 1]) % k;
        }
        int sum = preSum[n];

        int result = Integer.MAX_VALUE;
        // mod -> min index
        Map<Integer, Integer> map = new HashMap<>();

        // (s[j] - s[i]) % k = sum % k, (s[j] - sum) % k = s[i] % k
        for (int j = 0; j < n + 1; j++) {

            // 如果一个不删，也是符合条件的，所以s[0]也可能满足条件，因此先put，再计算
            int mod2 = (preSum[j] % k + k) % k;
            map.put(mod2, j);

            int mod1 = ((preSum[j] - sum) % k + k) % k;
            if (map.containsKey(mod1)) {
                result = Math.min(result, j - map.get(mod1));
            }
        }

        return result == n ? -1 : result;
    }
}
```
**注意，前缀和用map的时候，如果f(0)本身也符合条件（即本题中一个元素都不去掉，原数组本来就能被p整除），此时应该先往map里put，否则的话会漏掉f(0)。**

## 同值
有一些前缀和的问题，转化条件相对隐晦，但是因为不需要同余，所以反而简单一些。**比如经常遇到的“某一段区间两类元素个数相等”，如果把一种定义为1，另一种定义为-1，其实就是在求子区间和为0，即f[j] = f[i]**。

[525. 连续数组](https://leetcode.cn/problems/contiguous-array/description/)，如果把0当做-1，1当做1，那么某一段0和1个数相同，就是这一段的和为0，即s[j] - s[i] = 0，即s[j] = s[i]：
```java
class Solution {
    public int findMaxLength(int[] nums) {
        int n = nums.length;

        int[] preSum = new int[n + 1];
        preSum[0] = 0;

        for (int i = 1; i < n + 1; i++) {
            preSum[i] = preSum[i - 1] + (nums[i - 1] == 1 ? 1 : -1);
        }

        int result = 0;
        // value -> min index
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < n + 1; i++) {
            if (map.containsKey(preSum[i])) {
                // 找前缀和数组里最远的两个相同的数，即s[j] == s[i]，且j - i至少为2
                int index = map.get(preSum[i]);
                int range = i - index;
                if (range >= 2 && range > result) {
                    result = range;
                }
            } else {
                map.put(preSum[i], i);
            }
        }

        return result;
    }
}
```

[面试题 17.05. 字母与数字](https://leetcode.cn/problems/find-longest-subarray-lcci/description/)稍微麻烦一些，要把取最值时候的下标记录下来。记住，**前缀和数组和原数组的下标关系为：前缀和数组的s[r] - s[l]代表的是原数组[l, r)的前缀和**：
```java
class Solution {
    
    // 前缀和主要记住一个关键点：前缀和数组的s[r] - s[l]代表的是原数组[l, r)的前缀和
    public String[] findLongestSubarray(String[] array) {
        int n = array.length;

        int[] prefixSum = new int[n + 1];
        prefixSum[0] = 0;
        for (int i = 1; i < n + 1; i++) {
            // 数字和字母，一个1，一个-1
            int digit = array[i - 1].charAt(0) >= '0' && array[i - 1].charAt(0) <= '9' ? 1 : -1;
            prefixSum[i] = prefixSum[i - 1] + digit;
        }

        Map<Integer, Integer> firstIndex = new HashMap<>();
        int max = 0, maxLeft = -1, maxRight = -1;

        // i从0开始遍历前缀和数组，则前缀和数组的s[r] - s[l]代表的是原数组[l, r)的前缀和
        for (int i = 0; i < n + 1; i++) {
            int sum = prefixSum[i];
            if (firstIndex.containsKey(sum)) {
                int first = firstIndex.get(sum);
                int diff = i - first;
                if (diff > max) {
                    max = diff;
                    maxLeft = first;
                    maxRight = i;
                }
            } else {    
                firstIndex.put(sum, i);
            }
        }

        if (max == 0) {
            return new String[] {};
        } else {
            // 正好求的就是[l, r)
            return Arrays.copyOfRange(array, maxLeft, maxRight);
        }
    }
}
```

[1542. 找出最长的超赞子字符串](https://leetcode.cn/problems/find-longest-awesome-substring/description/)

## dfs + 前缀和
这道题很漂亮！和dfs结合在一起。

[路径总和 III](https://leetcode.cn/problems/path-sum-iii/description/)。

> 最直观的思路是像树的覆盖一样，内层要做一个dfs用于比较两棵树，外层要做一个dfs用于比较整棵树。On2

如果用前缀和，则能达到On的复杂度，不过思路上稍微复杂一些：
1. 首先，这里的前缀和数组指的是root为起点当前节点为终点的这一枝上的所有节点组成的前缀和数组。
2. 按照dfs的思路，如果回溯，前缀和数组里的当前节点应该pop掉。

那么我们在dfs的过程中实际上形成了无数个前缀和数组，在[和为 K 的子数组](https://leetcode.cn/problems/subarray-sum-equals-k/description/)里，根据前缀和数组获取diff k，即使用map优化，也要On的复杂度。这么一来，其实还是On2的复杂度。

但是我们其实还可以优化一下[和为 K 的子数组](https://leetcode.cn/problems/subarray-sum-equals-k/description/)的解法：前缀和数组一定要生成出来吗？能不能边遍历边寻找diff k？可以的：
```java
    public int subarraySum(int[] nums, int k) {
        int n = nums.length, result = 0;

        // number -> freq
        Map<Integer, Integer> map = new HashMap<>();
        // 前缀和数组的第一个
        map.put(0, 1);

        int preSum = 0;
        for (int i = 0; i < n; i++) {
            int curSum = preSum + nums[i];
            result += map.getOrDefault(curSum - k, 0);
            map.put(curSum, map.getOrDefault(curSum, 0) + 1);

            // preSum
            preSum = curSum;
        }

        return result;
    }
```

> 注意对前缀和数组第一个元素的记录`map.put(0, 1)`，别忘了！

不过这么写在[和为 K 的子数组](https://leetcode.cn/problems/subarray-sum-equals-k/description/)这道题里没什么优势，复杂度依旧是On，写起来反而容易出错，所以不如先把前缀和数组生成出来。

但是在[路径总和 III](https://leetcode.cn/problems/path-sum-iii/description/)，这么写就很有用了，可以把前缀和数组优化掉，直接边遍历变寻找diff k，不需要先生成很多个前缀和数组，再对每个数组做查找：
1. 首先，这里的前缀和数组指的是root为起点当前节点为终点的这一枝上的所有节点组成的前缀和数组。
2. 按照dfs的思路，如果回溯，前缀和数组里的当前节点应该pop掉。
3. dfs的过程中，只维护map而非前缀和数组边，这样的话整个过程的复杂度就是On。

```java
class Solution {
    public int pathSum(TreeNode root, int targetSum) {
        if (root == null) {
            return 0;
        }
    
        // map: preSum -> freq
        Map<Long, Integer> map = new HashMap<>();
        // 前缀和数组的第一个
        map.put(0L, 1);

        return dfs(root, map, 0, targetSum);
    }

    // map: preSum -> freq
    private int dfs(TreeNode root, Map<Long, Integer> map, long preSum, int k) {
        int result = 0;
        if (root == null) {
            return 0;
        }

        long curSum = preSum + root.val;
        result += map.getOrDefault(curSum - k, 0);
        map.put(curSum, map.getOrDefault(curSum, 0) + 1);

        // 不管是否满足条件，都要继续递归下去
        result += dfs(root.left, map, curSum, k);
        result += dfs(root.right, map, curSum, k);

        // 恢复现场
        map.put(curSum, map.get(curSum) - 1);
        return result;
    }
}
```
> 这题卡int溢出的用例，所以只能用long保存sum了，map的key也只能是Long。

这里只有map是有状态的，所以恢复现场只回复它一个就行了。





