---
layout: post
title: Refresh - 滑动窗口
date: 2024-05-06 00:08:53 +0800
render_with_liquid: false
---

常用来处理字符串的子串问题，比如找出符合条件的max/min子串，一般通过一个窗口动态维护子串，动态的过程有滑动的意思，所以称为滑动窗口。

1. Table of Contents, ordered
{:toc}

# 滑动窗口
[这个](https://www.51cto.com/article/689828.html)教程总结了滑动窗口的模板，**核心就是右边++增大窗口，判断是否满足条件；左边++减小窗口，判断是否满足条件**。

**什么时候开始窗口缩小（left++）**？分两种：
- **如果找的是最大的字符串，那么尽量加：在不满足条件的时候，才缩小**；
- **如果找的是最小的字符串，那么尽量减：在满足条件的基础上，就缩小**；

**什么时候记录结果呢**？同样分两种：
- 如果找的是最大字符串，肯定是在扩窗口以后（同时满足条件）记录结果；
- 如果找的是最小字符串，肯定是在缩窗口以后（同时满足条件）记录结果；

```java
int left =0，right = 0; 
while (right < s.size()){ 

  while (不能继续增大了？那就考虑缩小吧！) { 
    //缩小窗口 
    window.remove(s[left]); 
    left++; 
  } 
  
  //增大窗口
  window.add(s[right]); 
  right++; 
} 
```

> right++也未必放在内层while前，放while后也可以，看情况。

之所以这个模板很好，是因为它把两种情况下的判断都放到了里面的while的条件里，这样写的话：
- 右边++之后会立刻判断条件是否满足；
- 左边++之后也会立刻判断条件是否满足；

而我之前自己写了一个类似这样的：
```java
int left =0，right = 0; 
while (right < s.size()){ 

  while (满足条件 && right < s.size()) {
    //增大窗口 
    window.add(s[right]); 
    right++; 
  }
  
  while (不满足条件 && left < s.size()){ 
    //缩小窗口 
    window.remove(s[left]); 
    left++; 
  } 
} 
```
这样写就很麻烦，尤其是如果还需要记录满足条件的值，就会在里面的两个while后面分别记录，很麻烦。上面的模板只在一处判断，所以也只在一处记录就行了。

[这个](https://leetcode.cn/problems/longest-substring-without-repeating-characters/solutions/3982/hua-dong-chuang-kou-by-powcai/)题解列出了一堆滑动窗口的题型：

滑动窗口的问题，**核心在于判断条件是否成立**。其他部分就按照框架滑就行了。

以[无重复字符的最长子串](https://leetcode.cn/problems/longest-substring-without-repeating-characters/description/)为例，由于是无重复，所以把当前窗口的字符都放到set里，判断下一个是否还能放。**由于找的是最长，所以条件是：在不重复的基础上，一直right++，直到下一个要重复了，才开始缩小窗口left++**。窗口**缩小到不会有字符和下一个字符重复了，再继续扩大窗口**。
```java
class Solution {
    // s = "ccabcabcbb"
    public int lengthOfLongestSubstring(String s) {

        Set<Character> set = new HashSet<>();

        int max = 0;

        int left = 0, right = 0;
        while (right < s.length()) {
            char c = s.charAt(right);

            // 下一个要往里加的是c，如果之前set里有过c了，就可以从左收缩窗口了
            while (set.contains(c)) {
                // 如果之前有两个c，那么这里移动一个left却remove了所有的c？
                // 其实不是的，因为处理一开始的cc的时候，第二个c进来前，第一个c就会因为重复被删了，所以用set是可以的，这也是为什么会用set。**set对应的当前串，不会对应两个重复字符的情况**
                set.remove(s.charAt(left++));
            }

            set.add(c);
            right++;

            max = Math.max(max, set.size());
        }

        return max;
    }

}
```

[最小覆盖子串](https://leetcode.cn/problems/minimum-window-substring/description/)之所以是hard，就难在怎么判断条件是否成立了。题目要求的是s的子串包含t里的所有字符。首先想到的还是set，**但是t里的字符可能重复，所以s的子串除了要有相应字符，字符频次也得够。这样一来相当于要给set里的字符计数，很显然，应该用map：使用map的kv记录t里的所有字符和频次**。

**那么怎么判断是否包含了呢？滑动窗口在滑s的时候，给map里的对应字符做--就行了，类似于消消乐，如果map里所有的key对应的value都为0，就相当于当前窗口全包含t了**。然后再使用框架滑动。

但是“map里所有的key对应的value都为0”，需要遍历整个map，能不能不遍历？可以！想想MySQL的表级的意向锁，就是为了不使用遍历判断是否有行锁，才搞得一个数据结构。**那这里也可以用一个标识符表示当前所有的key是否都为0。既然是消消乐，那消`t.length()`次后就都为0了，所以用一个int就行了。**

**最后梳理一下条件：由于找的是最小字符串，那不停缩小窗口的条件就是“消完了”。**

```java
class Solution {
    public String minWindow(String s, String t) {

        // 一开始想仿照（3. 无重复字符的最长子串）用set判断滑动窗口弹出的左字符是否在t里，后来发现t可以有重复字符，所以还得记t里有几个字符
        // https://leetcode.cn/problems/longest-substring-without-repeating-characters/description/
        // Set<Character> tSet = new HashSet<>();
        // 所以用map了
        Map<Character, Integer> tMap = new HashMap<>();
        for (char c : t.toCharArray()) {
            tMap.put(c, tMap.getOrDefault(c, 0) + 1);
        }

        int minLength = Integer.MAX_VALUE, minLeft = -1, minRight = -1;

        // sMap不需要了，直接原地decrease tMap就行了，就像消消乐
        // Map<Character, Integer> sMap = new HashMap<>();
        // 什么时候全覆盖了？tMap所有key为0，但这个操作需要遍历，复杂度太高。可以找一个值单独记录t有没有被消完
        int stillLeft = t.length();
        int left = 0, right = 0;
        while (right < s.length()) {
            
            char rc = s.charAt(right);

            if (!tMap.containsKey(rc)) {
                right++;
                continue;
            }

            int rcValue = tMap.get(rc);
            if (rcValue > 0) {
                // a valid decrease
                stillLeft--;
            }
            tMap.put(rc, rcValue - 1);

            right++;

            // 参考滑动窗口的模板，只用外内两个while就行了，能省不少代码，逻辑也清晰。
            // 外层while是right++，内存while是left++，内层while的判断条件是：当前依旧符合题意（依旧能覆盖）
            while (stillLeft <= 0) {

                // record current result
                if (minLength > right - left) {
                    minLength = right - left;
                    minLeft = left;
                    minRight = right;
                }

                char lc = s.charAt(left);

                if (!tMap.containsKey(lc)) {
                    left++;
                    continue;
                }

                int lcValue = tMap.get(lc);
                if (lcValue + 1 > 0) {
                    // a valid increase
                    stillLeft++;
                }
                tMap.put(lc, lcValue + 1);

                left++;
            }

        }

        return minLeft == -1 ? "" : s.substring(minLeft, minRight);
    }
}
```

再贴一个一开始不按照模板写的，就比较啰嗦：
```java
class Solution {
    public String minWindow(String s, String t) {

        Map<Character, Integer> tMap = new HashMap<>();
        for (char c : t.toCharArray()) {
            if (tMap.containsKey(c)) {
                tMap.put(c, tMap.get(c) + 1);
            } else {
                tMap.put(c, 1);
            }
        }

        int minLength = Integer.MAX_VALUE, minLeft = -1, minRight = -1;

        int stillLeft = t.length();
        int left = 0, right = 0;
        while (right < s.length()) {
            
            while (stillLeft > 0 && right < s.length()) {
                char c = s.charAt(right);

                if (!tMap.containsKey(c)) {
                    right++;
                    continue;
                }

                int value = tMap.get(c);
                if (value > 0) {
                    // a valid decrease
                    stillLeft--;
                }
                tMap.put(c, value - 1);

                right++;
            }

            // record result
            if (stillLeft <= 0) {
                if (minLength > right - left) {
                    minLength = right - left;
                    minLeft = left;
                    minRight = right;
                }
            }

            while (stillLeft <= 0 && left < right) {
                char c = s.charAt(left);

                if (!tMap.containsKey(c)) {
                    left++;
                    continue;
                }

                int value = tMap.get(c);
                if (value + 1 > 0) {
                    // a valid increase
                    stillLeft++;
                }
                tMap.put(c, value + 1);

                left++;
            }

            // record result
            if (stillLeft > 0) {
                if (minLength > right - left - 1) {
                    minLength = right - left - 1;
                    minLeft = left - 1;
                    minRight = right;
                }
            }
        }

        return minLeft == -1 ? "" : s.substring(minLeft, minRight);
    }
}
```

[30. 串联所有单词的子串](https://leetcode.cn/problems/substring-with-concatenation-of-all-words/description/)这个题很有意思：
- **如果把滑动的单位看做word，那么它和[无重复字符的最长子串](https://leetcode.cn/problems/longest-substring-without-repeating-characters/description/)的相似性就很明显了：一个在统计char，一个在统计string**。区别是本题的word要exactly相同（且包括词频），**所以用了map#equals来做判断**
- 而我一开始傻傻地在滑动char，然后把当前字符串再切分成一个个string作比较，相比之下，慢了很多，也麻烦了很多

滑动char（**慢，但是和双重for循环切分字符串比起来，还是要快不少的，因为滑动完整个字符串是O(n)，但是双重for光遍历切分完整个字符串就是O(n^2)了**）：
```java
class Solution {
    public List<Integer> findSubstring(String s, String[] words) {
        int wordsNum = words.length;
        int wordLen = words[0].length();

        int targetLen = wordLen * wordsNum;

        if (s.length() < targetLen) {
            return List.of();
        }

        // 统计words词频
        Map<String, Integer>  = new HashMap<>();
        for (String word : words) {
            map.put(word, map.getOrDefault(word, 0) + 1);
        }

        List<Integer> result = new ArrayList<>();

        // 因为用的是substring，所以right就用来做开区间了，因此从1开始，而且可以为s.length()
        int left = 0, right = 0;
        while (right <= s.length()) {
            int curLen = right - left;

            // 窗口开始滑动的条件就是长度符合条件了，不管match与否都要滑动，所以判断match与否不能写在这里
            while (curLen == targetLen) {
                // 只有match才记录结果，但就算不match也应该滑动
                if (matchWithArray(s, left, right, new HashMap<>(map), wordsNum, wordLen)) {
                    // record result
                    result.add(left);
                }

                left++;
                curLen = right - left;
            }
            right++;
        }

        return result;
    }

    private boolean matchWithArray(String s, int left, int right, Map<String, Integer> map, int wordsNum, int wordLen) {
        while (left < right) {
            String sub = s.substring(left, left + wordLen);
            if (!map.containsKey(sub)) {
                return false;
            }

            int value = map.get(sub);
            if (value > 0) {
                // a valid decrease
                wordsNum--;
            }

            if (value - 1 < 0) {
                return false;
            }

            map.put(sub, value - 1);

            left += wordLen;
        }

        return wordsNum == 0;
    }
}
```
**和滑动word相比，慢在了每次比较的时候，都要给当前子串做切分成word数组的操作**。

滑动word（**不用再遍历子串切分为word数组了**）。由于这个问题要求当前窗口的words正好是目标words的拼接，所以**当当前窗口的words和目标words个数相同，就可以进行判断了。不管是否满足匹配，都缩减窗口**。
```java
class Solution {
    public List<Integer> findSubstring(String s, String[] words) {
        int wordsNum = words.length;
        int wordLen = words[0].length();

        int targetLen = wordLen * wordsNum;

        if (s.length() < targetLen) {
            return List.of();
        }

        // 统计words词频
        Map<String, Integer> targetWordsFreq = new HashMap<>();
        for (String word : words) {
            targetWordsFreq.put(word, targetWordsFreq.getOrDefault(word, 0) + 1);
        }

        List<Integer> result = new ArrayList<>();

        // 以word为单位滑动，那么要滑wordLen轮
        for (int i = 0; i < wordLen; i++) {
            // 每一轮的词频当前统计，直接用map#equals比较词频
            Map<String, Integer> curWordsFreq = new HashMap<>();
            // 同理，使用一个计数器而不是每次sum all values来计算word数是否够了
            int curWordsNum = 0;

            // 因为用的是substring，所以right就用来做开区间了，因此从1开始，而且可以为s.length()
            int left = i, right = i;
            while (right + wordLen <= s.length()) {
                String curWord = s.substring(right, right + wordLen);
                curWordsFreq.put(curWord, curWordsFreq.getOrDefault(curWord, 0) + 1);
                curWordsNum++;

                // 窗口开始滑动的条件就是长度符合条件了，不管match与否都要滑动，所以判断match与否不能写在这里
                while (curWordsNum == wordsNum) {
                    // 只有match才记录结果，但就算不match也应该滑动
                    if (curWordsFreq.equals(targetWordsFreq)) {
                        // record result
                        result.add(left);
                    }

                    left += wordLen;
                    String removedWord = s.substring(left - wordLen, left);
                    int freq = curWordsFreq.get(removedWord);
                    if (freq > 1) {
                        curWordsFreq.put(removedWord, freq - 1);
                    } else {
                        // 如果为0了，要删掉这个entry，否则map#equals不会为true
                        curWordsFreq.remove(removedWord);
                    }
                    curWordsNum--;
                }
                right += wordLen;
            }
        }

        return result;
    }
}
```
