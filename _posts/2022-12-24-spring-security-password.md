---
layout: post
title: "Spring Security - 密码"
date: 2022-12-24 18:56:34 +0800
categories: spring security
tags: spring security
---

开发这么多年，spring security其实一直用的比较少。毕竟大部分情况下都是在搞定特定功能，security属于另一套东西，一般不需要，大都是涉及到前后端的时候才加上。这也是security这一功能的本质：一套呼之即来挥之即去的东西。spring security很好地诠释了这一点，给服务集成security功能还是比较优雅的。spring security的功能虽然不一定经常用，但设计理念还是不错的，看一看很受用。

spring security的主要功能就是：认证、权限。而二者的基础就是密码，有了用户名和密码才能进行认证，认证通过才能进行鉴权。

1. Table of Contents, ordered
{:toc}

# 密码演进史
[密码存储](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html)一章对密码的演进进行了非常好的介绍！从过来人的角度，对选择什么加密算法做密码进行了解释，高屋建瓴。

数据库以什么形式存储密码？大概发展历程如下：
1. **明文**：数据库被攻破（breach）了就凉了；
2. **one way hash**：数据库被攻破之后，虽然不能立刻获知原始密码，但是防不了提前算好lookup table，比如rainbow table；
3. **salted password**：彩虹表是没用了，但是现在的电脑太强了，暴力破解也很快了，一秒能算十来亿次（can perform billions of hash calculations a second），分分钟根据新的salt算出来一套新的lookup table；
4. **adaptive one-way function**：**故意拖慢密码验证速度的单向算法**；

目前公认的防破解密码是使用一个故意消耗资源以拖延密码验证时长的算法：
> Validation of passwords with adaptive one-way functions are **intentionally resource-intensive (they intentionally use a lot of CPU, memory, or other resources)**. An adaptive one-way function allows configuring a “work factor” that can grow as hardware gets better.

指定一个合理的“拖延系数”，该系数可以认为是算法的强度（strength）。拖延到让自己的系统1s才能验证完输入密码是否正确，给攻击者造成额外负担的同时，1s也不会让自己系统的用户等的不耐烦：
> We recommend that the “work factor” be tuned to take about one second to verify a password on your system. This trade off is to make it difficult for attackers to crack the password, but not so costly that it puts excessive burden on your own system or irritates users.

当然，攻击者的机器和咱们的不一样，所以它未必也需要1s才能验证一次，但肯定不至于像以前一样一秒算billion次了。

**这个算法的精髓在于：自己的系统判断密码对不对，只需要验证一次就行。所以验证一次需要1ns、1ms和1s对自己来说区别不大，都能接受；而攻击者暴力破解一个密码需要计算无数次（假设一百万次），此时1ns、1ms和1s分别重复一百万次（各需要1ms，1000秒，一百万秒），就是天壤之别**。破解一个密码需要一百万秒？对攻击者来说就是不可接受的暴力破解代价。

但是也不能每个请求都验证用户名密码，毕竟验证起来这么消耗资源，系统扛不住。**所以只给一开始的认证请求做这些相关的密码验证，认证成功之后就换成session或其他token以验证接下来的请求**：
> Users are encouraged to exchange the long term credentials (that is, username and password) for a short term credential (such as a session, and OAuth Token, and so on). The short term credential can be validated quickly without any loss in security.

# bcrypt
spring security实现的bcrypt算法，就是一种adpative one-way function。

需要在使用前设置好强度：
```
new BCryptPasswordEncoder(strength)
```
在我的Intel(R) Core(TM) i5-9400F CPU @ 2.90GHz台式机上，不同的strength对应的加密一次、或验证一次的时长如下：

| strength | encode | verify |
| --- | --- | --- |
| ~~10~~  | ~~927ms~~ | ~~202ms~~ |
| 11  | 167ms | 139ms |
| 12  | 263ms | 258ms |
| 13  | 517ms | 512ms |
| 14  | 1024ms | 1019ms |
| 19  | 33086ms | 32667ms |

strength每增加1，时长基本翻一倍。第一次应该是需要预热，跑出来的时间不准确。

所以如果系统部署在我的这台电脑上，strength选14最合适，**这是我在让用户不久等的情况下能选择的最强强度了**。如果选19，那这系统估计没人愿意用了……bcrypt默认strength=10。

# `PasswordEncoder`
spring security对密码验证的抽象是`PasswordEncoder`接口，它只有`encode(CharSequence rawPassword)`和`matches(CharSequence rawPassword, String encodedPassword)`两个接口，没有decode，因为是one way function。

## `DelegatingPasswordEncoder`
spring security 5.0之前的默认`PasswordEncoder`是`NoOpPasswordEncoder`，其实就是明文存储。显然，到了后来，我们知道使用`BCryptPasswordEncoder`作为默认`PasswordEncoder`是更合理的。**但是spring security不能直接修改默认encoder为`BCryptPasswordEncoder`，否则程序猿一升级spring security的版本，数据库里存储的密码hash都不能用了……那用户炸了……**

而且，就算一开始敲定的默认encoder就是`BCryptPasswordEncoder`，之后依然会面对这样的问题，毕竟时代在变化，也许再过几年`BCryptPasswordEncoder`也成过气网红了，所以还要切换默认encoder。

**应该有这么一种解决方案**：
1. 不忘过去：兼容旧的hash，已存储的旧encoder（比如`NoOpPasswordEncoder`）产生的hash依然能被验证；
2. 把握现在：新用户使用当前指定的最新的encoder（比如`BCryptPasswordEncoder`）产生新hash；
3. 放眼未来：同时还能拓展，允许未来更新到更先进的encoder；

所以spring security引入了`DelegatingPasswordEncoder`：

```
PasswordEncoder passwordEncoder =
    PasswordEncoderFactories.createDelegatingPasswordEncoder();

Map encoders = new HashMap<>();
encoders.put(idForEncode, new BCryptPasswordEncoder());
encoders.put("noop", NoOpPasswordEncoder.getInstance());
encoders.put("pbkdf2", Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_5());
encoders.put("pbkdf2@SpringSecurity_v5_8", Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8());
encoders.put("scrypt", SCryptPasswordEncoder.defaultsForSpringSecurity_v4_1());
encoders.put("scrypt@SpringSecurity_v5_8", SCryptPasswordEncoder.defaultsForSpringSecurity_v5_8());
encoders.put("argon2", Argon2PasswordEncoder.defaultsForSpringSecurity_v5_2());
encoders.put("argon2@SpringSecurity_v5_8", Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8());
encoders.put("sha256", new StandardPasswordEncoder());

String idForEncode = "bcrypt";
PasswordEncoder passwordEncoder =
    new DelegatingPasswordEncoder(idForEncode, encoders);
```
**这是一个多版本的密码验证器**，使用当前指定的id=`bcrypt`的encoder加密新密码，同时能解析数据库里存储的老encoder产生的旧密码：
```
{bcrypt}$2a$10$dXJ3SW6G7P50lGmMkkmwe.20cQQubK3.HZWzG3YB1tlRy.fqvM/BG
{noop}password
{pbkdf2}5d923b44a6d129f3ddf3e3c8d29412723dcbde72445e8ef6bf3b508fbf17fa4ed4d6b99ca763d8dc
{scrypt}$e0801$8bWJaSu2IKSn9Z9kM+TPXfOc/9bdYSrN1oD9qfVThWEwdRTnO7re7Ei+fUZRJ68k9lTyuTeUp4of4g24hHnazw==$OAOec05+bXxvuu/1qZ6NUR+xQYvYv7BeL1QxwRpY5Pc=
{sha256}97cde38028ad898ebc02e690819fa220e88c62e0699403e94fff291cfffaf8410849f27605abcbc0
```
同时未来可以更换或增加新的encoder。

**密文通过中括号里的前缀表明这个hash是由哪个encoder产生的**，从而选择相应的encoder进行验证。noop标志着这是一个`NoOpPasswordEncoder`产生的密码，所以后面的数据就是明文密码。

> 其实这是一个 **多算法hash**。sharding sphere使用的是 **多版本密钥轮换加密**：不换算法，只换密钥值，且是加密而不是hash。

没有`{xxx}`的密文（可以认为id=null）或者xxx对应不上已有encoder的密文无法被解密，会导致`IllegalArgumentException`。设置一个默认encoder可以解决这个问题`DelegatingPasswordEncoder.setDefaultPasswordEncoderForMatches(PasswordEncoder)`。

**不能把原来的密码都换成最新的吗？不行，因为这是password hash，不是加密，所以无法解密原有明文。唯一能做的，就是保留那些旧的encoder以兼容旧的hash**：
> unlike encryption, password hashes are designed so that there is no simple way to recover the plaintext

有人可能会问，如果数据库被黑了，这些前缀岂不是暴露密码使用的产生算法了？是的，但是这不重要，因为：
1. **密码的可靠性不是靠不对外暴露算法，而是靠算法本身的强度**：即使你知道用的是哪个算法，依旧很难破解；
2. 就算你不说，从密文也很容易判断出这是用哪个算法加密的。比如`$2a`开头一看就是BCrypt算法产生的；

> Some users might be concerned that the storage format is provided for a potential hacker. This is not a concern because the storage of the password does not rely on the algorithm being a secret. Additionally, most formats are easy for an attacker to figure out without the prefix. For example, BCrypt passwords often start with `$2a$`.

系统默认会自己配置一个`DelegatingPasswordEncoder`，如果自己显式配置一个`PasswordEncoder`则会替换掉它，不利于系统拓展和升级：
> Spring Security uses `DelegatingPasswordEncoder` by default. However, **you can customize this by exposing a `PasswordEncoder` as a Spring bean.**
>
> If you are migrating from Spring Security 4.2.x, you can revert to the previous behavior by exposing a `NoOpPasswordEncoder` bean.
>
> Reverting to `NoOpPasswordEncoder` is not considered to be secure. You should instead migrate to using `DelegatingPasswordEncoder` to support secure password encoding.

# springboot cli加密

[spring boot cli](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html#authentication-password-storage-boot-cli)，有一个方便的功能就是使用bcrypt生成一个字符串的hash。

springboot cli的所有命令，没几个……
```
win-pichu@home ~ » spring help
usage: spring [--help] [--version]
       <command> [<args>]

Available commands are:

  init [options] [location]
    Initialize a new project using Spring Initializr (start.spring.io)

  encodepassword [options] <password to encode>
    Encode a password for use with Spring Security

  shell
    Start a nested shell

Common options:

  --debug Verbose mode
    Print additional status information for the command you are running


See 'spring help <command>' for more information on a specific command.
```
spring security牛逼啊，总共就仨command，有一个就是security的。

`encodepassword`的用法：
```
win-pichu@home ~ » spring help encodepassword                                                                       1 ↵
spring encodepassword - Encode a password for use with Spring Security

usage: spring encodepassword [options] <password to encode>

Option                    Description
------                    -----------
-a, --algorithm <String>  The algorithm to use (default: default)

examples:

    To encode a password with the default encoder:
        $ spring encodepassword mypassword

    To encode a password with pbkdf2:
        $ spring encodepassword -a pbkdf2 mypassword
```
默认bcrypt：
```
win-pichu@home ~ » spring encodepassword pikachu                                                                  130 ↵
{bcrypt}$2a$10$G/Mn/ZBjDN6ArjHdzRDW2O3L7gKP0CRsmQN3Up4k03AUXohXlTb5q
```

# 感想
第一次看官方文档看出了科普文的感觉，挺有意思的。

