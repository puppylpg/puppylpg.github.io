#!/bin/bash

ROOT_DIR=$(dirname "$(dirname "$(realpath "$0")")")
DIRECTORIES=("_posts" "_tutorials")

for dir in "${DIRECTORIES[@]}"; do
  TARGET_DIR="$ROOT_DIR/$dir"
  echo "$TARGET_DIR"

  for file in "$TARGET_DIR"/*.md; do
    [ -f "$file" ] || continue
    sed -i -E '/^(categories|tags):/ { s/([[:alpha:]]+)/\L\1/g }' "$file"
  done
done
