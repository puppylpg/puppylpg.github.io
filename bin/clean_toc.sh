#!/bin/bash

DIRECTORIES=("_posts" "_tutorials")

for dir in "${DIRECTORIES[@]}"; do
    DIR=$(dirname "$(dirname "$(realpath "$0")")")/$dir
    echo $DIR

    for file in $DIR/*.md; do
        if [[ $(head -n 1 "$file") == "[toc]" ]]; then
            sed -i -e '1,/^$/d' "$file"
        fi
    done
done

