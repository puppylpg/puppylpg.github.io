#!/bin/bash

POST_DIR=$(dirname "$(dirname "$(realpath "$0")")")/_posts
echo $POST_DIR

# 检测一个文件夹下所有的md格式的文件
for file in $POST_DIR/*.md; do
  # 把所有以`categories:`和`tags:`开头的行后面的单词，都转为小写
  sed -i -E '/^(categories|tags):/ { s/([[:alpha:]]+)/\L\1/g }' "$file"
done
