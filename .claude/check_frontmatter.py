#!/usr/bin/env python3
# check_frontmatter.py
# Hook mode: stdin JSON -> outputs systemMessage JSON if problems found
# CLI mode:  python3 check_frontmatter.py file.md ... -> stderr + exit 1
import sys, json, re

COLLECTION_DIRS = {'_ai', '_open', '_books', '_life', '_viewed', '_tutorials'}


def parse_frontmatter(content):
    if not content.startswith('---'):
        return None
    end = content.find('\n---', 3)
    if end == -1:
        return None
    return content[3:end]


def check_file(fp):
    if not fp.endswith('.md'):
        return None
    try:
        content = open(fp, encoding='utf-8').read()
    except FileNotFoundError:
        return None

    fm = parse_frontmatter(content)
    if fm is None:
        return None

    problems = []

    # categories/tags 不能含大写
    for field in ('categories', 'tags'):
        m = re.search(r'^' + field + r'\s*:\s*(.+)', fm, re.MULTILINE)
        if m and re.search(r'[A-Z]', m.group(1)):
            problems.append('{} 含大写字母（应全小写）'.format(field))

    # date 必须带 +0800 时区
    m = re.search(r'^date\s*:\s*(.+)', fm, re.MULTILINE)
    if m and '+0800' not in m.group(1):
        problems.append('date 缺少 +0800 时区')

    # 不应手写 last_modified_at
    if re.search(r'^last_modified_at\s*:', fm, re.MULTILINE):
        problems.append('不应手写 last_modified_at（由 git hook 自动注入）')

    # 集合文章不应写 layout:
    parts = fp.replace('\\', '/').split('/')
    in_collection = any(p in COLLECTION_DIRS for p in parts)
    if in_collection and re.search(r'^layout\s*:', fm, re.MULTILINE):
        problems.append('集合文章不应手写 layout:（由 _config.yml defaults 注入）')

    # _open 文章必须有 order:
    if '_open' in parts and not re.search(r'^order\s*:', fm, re.MULTILINE):
        problems.append('_open 文章缺少 order: 字段（用于卡片排序）')

    return problems if problems else None


if len(sys.argv) > 1:
    exit_code = 0
    for fp in sys.argv[1:]:
        problems = check_file(fp)
        if problems:
            print('[front matter 检查] {}：'.format(fp) + '；'.join(problems), file=sys.stderr)
            exit_code = 1
    sys.exit(exit_code)

data = json.load(sys.stdin)
fp = (data.get('tool_input') or {}).get('file_path') or \
     (data.get('tool_response') or {}).get('filePath') or ''
problems = check_file(fp)
if problems:
    msg = '[front matter 检查] {}：'.format(fp) + '；'.join(problems) + '。'
    print(json.dumps({'systemMessage': msg}))
