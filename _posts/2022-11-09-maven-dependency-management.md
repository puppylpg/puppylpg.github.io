---
layout: post
title: "Maven - dependencyManagement"
date: 2022-11-09 02:39:24 +0800
categories: maven elasticsearch
tags: maven elasticsearch
---

今天被maven的transitive依赖搞蒙蔽了，一下午未果。晚上又查了查，突然意识到自己对`dependencyManagement`的理解不太完整，果然是栽到这个上面了……

1. Table of Contents, ordered
{:toc}

# dependency mediation
首先有个玩意儿叫 **依赖仲裁**，**遵循就近原则：并不是版本高的留下，而是谁离root近谁留下**……

正因为如此，直接定义的依赖会优先于transitive依赖，即使自己定义的依赖版本更低。

> 嗯，很合理，以前理解错了……

- https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html

# `dependencyManagement`
一直错误低估`dependencyManagement`标签的威力了……

- https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html#dependency-management

Dependency management - **this allows project authors to directly specify the versions of artifacts to be used when they are encountered in transitive dependencies or in dependencies where no version has been specified.**

所以有俩功能，适用场景分别为：
1. 依赖不指定版本的时候；
2. **传递性依赖的版本问题**；

## 统一管理child pom依赖
这个是之前理解的功能，child pom可以不指定依赖的版本了，默认用parent pom里`dependencyManagement`的依赖的版本。

> 但是之前一直以为只有这一个功能，大错特错……

## 控制transitive依赖的版本
**A second, and very important use of the dependency management section is to control the versions of artifacts used in transitive dependencies.**

**传递性依赖的版本，直接由`dependencyManagement`敲定！dependency management takes precedence over dependency mediation for transitive dependencies**。

依赖仲裁分为两部分：
1. 直接引入的依赖，肯定nearest，它就是最终的版本；
2. 传递性依赖，也适用于nearest，谁近用谁的版本。**但是如果`dependencyManagement`声明了某个版本，优先级高于nearest，直接使用`dependencyManagement`里声明的版本**。

如果有多处`dependencyManagement`，那么本项目的`dependencyManagement`优先级高于parent的`dependencyManagement`。

比如下面这个parent和child——

parent：
```
<project>
 <modelVersion>4.0.0</modelVersion>
 <groupId>maven</groupId>
 <artifactId>A</artifactId>
 <packaging>pom</packaging>
 <name>A</name>
 <version>1.0</version>
 <dependencyManagement>
   <dependencies>
     <dependency>
       <groupId>test</groupId>
       <artifactId>a</artifactId>
       <version>1.2</version>
     </dependency>
     <dependency>
       <groupId>test</groupId>
       <artifactId>b</artifactId>
       <version>1.0</version>
       <scope>compile</scope>
     </dependency>
     <dependency>
       <groupId>test</groupId>
       <artifactId>c</artifactId>
       <version>1.0</version>
       <scope>compile</scope>
     </dependency>
     <dependency>
       <groupId>test</groupId>
       <artifactId>d</artifactId>
       <version>1.2</version>
     </dependency>
   </dependencies>
 </dependencyManagement>
</project>
```

child：
```
<project>
  <parent>
    <artifactId>A</artifactId>
    <groupId>maven</groupId>
    <version>1.0</version>
  </parent>
  <modelVersion>4.0.0</modelVersion>
  <groupId>maven</groupId>
  <artifactId>B</artifactId>
  <packaging>pom</packaging>
  <name>B</name>
  <version>1.0</version>
 
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>test</groupId>
        <artifactId>d</artifactId>
        <version>1.0</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
 
  <dependencies>
    <dependency>
      <groupId>test</groupId>
      <artifactId>a</artifactId>
      <version>1.0</version>
      <scope>runtime</scope>
    </dependency>
    <dependency>
      <groupId>test</groupId>
      <artifactId>c</artifactId>
      <scope>runtime</scope>
    </dependency>
  </dependencies>
</project>
```
a必然是1.0，因为直接定义了。d也必然是1.0，因为没直接定义，那么一旦有d的传递性依赖，必然用1.0版本的d。

b，c和d一样，定义在了parent的`dependencyManagement`里，所以一旦作为传递性依赖引入，也必然是1.0版本。

parent定义的d默认是1.2，它被child里定义的d 1.0覆盖了。

所以对于child来说，a/b（如果引入了）/c（如果引入了）/d（如果引入了）必然都是1.0版本。

## `dependencyManagement`的应用
下面这种情况，默认用D的1.0版本，**但是有两种方式可以让maven用D的2.0或者其他版本**——
```
  A
  ├── B
  │   └── C
  │       └── D 2.0
  └── E
      └── D 1.0
```

方法一：直接把想用的D的版本引入进来，它nearest，所以就用它的版本：
```
  A
  ├── B
  │   └── C
  │       └── D 2.0
  ├── E
  │   └── D 1.0
  │
  └── D x.y     
```
这种方式最常见。

方法二：把想用的D的版本作为依赖放到`dependencyManagement`里，**那么不管D作为transitive依赖的版本是哪个，都用`dependencyManagement`里定义的这个**：
```
  A
  ├── B
  │   └── C
  │       └── D 2.0
  └── E
      └── D 1.0
```
**Instead, A can include D as a dependency in its dependencyManagement section and directly control which version of D is used when, or if, it is ever referenced.**

这种写法的主要语义在于工程并没有直接使用D的东西，但是又想控制D作为传递性依赖实际使用的版本。

## `import` scope
只有`dependencyManagement`部分才能使用，同时只有type为`pom`的依赖才能声明scope为`import`，而import就是暴力替换，相当于把这个pom类型的依赖里定义的一堆依赖写入到这个`dependencyManagement`里。

比如`spring-boot-dependencies`的`dependencyManagement`有个`spring-data-bom`：
```
      <dependency>
        <groupId>org.springframework.data</groupId>
        <artifactId>spring-data-bom</artifactId>
        <version>${spring-data-bom.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
```
`spring-data-bom`是spring-data相关工程依赖的集合，比如`spring-data-elasticsearch`：
```
      <dependency>
        <groupId>org.springframework.data</groupId>
        <artifactId>spring-data-elasticsearch</artifactId>
        <version>4.2.5</version>
      </dependency>
```
`spring-boot-dependencies`的`dependencyManagement`里import了这个bom，相当于把`spring-data-elasticsearch`等依赖都写到了`spring-boot-dependencies`的`dependencyManagement`。

- https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html#dependency-scope

# 苦哈哈的实例
工程A发了一个包，包含spring-data-elasticsearch:4.4.1，用了elaticsearch相关的依赖7.17.3。

工程B引入了这个包，且工程B的parent是：
```
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.5.1</version>
    </parent>
```

结果，发现工程B依赖spring-data-elasticsearch:4.2.1，不是4.4.1，且elasticsearch相关的依赖版本是7.12.1。

**当时我感觉最离谱的是，依赖分析表明，spring-data-elasticsearch:4.2.1是工程A的transitive依赖**！这让我百思不得其解，把工程A都翻烂了，确实用的是spring-data-elasticsearch:4.4.1，实在不清楚4.2.1是哪来的……

当然，有了上面的知识，现在知道了，之所以用4.2.1，是因为工程B的parent是spring-boot-starter-parent:2.5.1，而它的parent是：
```
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-dependencies</artifactId>
    <version>2.5.1</version>
  </parent>
```
而spring-boot-dependencies:2.5.1的`dependencyManagement`引入了spring-data-bom：
```
      <dependency>
        <groupId>org.springframework.data</groupId>
        <artifactId>spring-data-bom</artifactId>
        <version>${spring-data-bom.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
```
而这个spring-data-bom包含：
```
      <dependency>
        <groupId>org.springframework.data</groupId>
        <artifactId>spring-data-elasticsearch</artifactId>
        <version>4.2.1</version>
      </dependency>
```
也就是说，spring-data-elasticsearch:4.2.1在工程B的parent的parent的`dependencyManagement`，在工程B没有直接引入spring-data-elasticsearch的情况下，不管transitive依赖的版本是啥，最终都用4.2.1。

所以最终的效果就是：**对于工程B来说，spring-data-elasticsearch来自工程A的transitive依赖，其版本由工程B的parent敲定。所以看到了一个来自工程A的spring-data-elasticsearch:4.2.1，虽然实际上工程A用的版本是spring-data-elasticsearch:4.4.1**。

解决方案：在不明白上述这些之前，我是直接把spring-data-elasticsearch:4.4.1作为直接依赖加入工程B的，结果发现工程里有两个spring-data-elasticsearch：来自B的4.4.1和来自A的4.2.1，冲突了，4.4.1胜出。但是当时没有加elasticsearch client相关的依赖，所以虽然4.4.1胜出了，但是用的elasticsearch client相关的依赖都不是4.4.1里的7.17.3，而是4.2.1里的7.12.1，因为工程B的parent的`dependencyManagement`还敲定了很多elasticsearch client相关的依赖的版本，为7.12.1。

所以最终的解决方案：
1. 把spring-data-elasticsearch和所有elasticsearch client相关的依赖都直接引入我想要的版本到工程B。但是这样会看到一个由工程A带来的spring-data-elasticsearch:4.2.1的冲突版本，虽然它并不会胜出；
2. 把spring-data-elasticsearch和所有elasticsearch client加入`dependencyManagement`。这样工程A引入的spring-data-elasticsearch直接就被敲定为4.4.1，就看不到存在冲突了；

所以我最终选择了方法二：
```
    <properties>
        <spring-data-elasticsearch>4.4.1</spring-data-elasticsearch>
        <!-- elasticsearch client version	-->
        <elasticsearch.client.version>7.17.3</elasticsearch.client.version>
    </properties>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.elasticsearch.client</groupId>
                <artifactId>elasticsearch-rest-high-level-client</artifactId>
                <version>${elasticsearch.client.version}</version>
            </dependency>
            <dependency>
                <groupId>org.elasticsearch.client</groupId>
                <artifactId>elasticsearch-rest-client</artifactId>
                <version>${elasticsearch.client.version}</version>
            </dependency>
            <dependency>
                <groupId>org.elasticsearch</groupId>
                <artifactId>elasticsearch</artifactId>
                <version>${elasticsearch.client.version}</version>
            </dependency>
            <dependency>
                <groupId>co.elastic.clients</groupId>
                <artifactId>elasticsearch-java</artifactId>
                <version>${elasticsearch.client.version}</version>
            </dependency>
            <dependency>
                <groupId>org.springframework.data</groupId>
                <artifactId>spring-data-elasticsearch</artifactId>
                <version>${spring-data-elasticsearch}</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
```

# 感想
我太菜了o(╥﹏╥)o

不过我又变强了(*￣︶￣)


