#!/bin/bash

POST_DIR=$(dirname "$(dirname "$(realpath "$0")")")/_posts
echo $POST_DIR

# 检测一个文件夹下所有的md格式的文件
for file in $POST_DIR/*.md; do
    # 检查文件第一行是否包含 [toc]
    if [[ $(head -n 1 "$file") == "[toc]" ]]; then
        # 删除第一行以及后面的空行
        sed -i -e '1,/^$/d' "$file"
    fi
done
