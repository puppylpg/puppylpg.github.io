#!/bin/bash
set -e
export PATH="/home/win-pichu/.local/share/gem/ruby/3.1.0/bin:/usr/bin:/bin"
SRC="/mnt/c/Users/puppylpg/Documents/GitHub/mine/puppylpg.github.io"
DST="/tmp/puppylpg-build4"

mkdir -p "$DST/.bundle"
printf '%s\n' '---' 'BUNDLE_PATH: "vendor/bundle"' > "$DST/.bundle/config"

cd "$SRC"
tar --exclude=vendor --exclude=_site --exclude=.git --exclude=.jekyll-cache --exclude=.bundle -cf - . | tar -C "$DST" -xf -

cd "$DST"
bundle install
bundle check
