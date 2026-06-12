# Agent 协作指南

本项目是 Jekyll + Chirpy 主题的个人博客，部署在 GitHub Pages 上。

## 文章发布通用流程

任何将文章写入 `_ai/`、`_posts/` 或 `_tutorials/` 的 skill/agent，落盘后都应遵循以下流程：

1. **本地预览**
2. **等用户确认**
3. **询问用户后执行 git commit + push**（不要自动推送）
4. **不 OK → 删除文件 / 修改后重来**

### 目标目录与默认分类

| 用户说法 | 目标目录 | 默认 categories |
|---------|---------|----------------|
| 未特别说明 / “发到 AI” / 默认 | `_ai/` | `[ai]` |
| “发到 tech” / “发到 post” / “发到 _posts” | `_posts/` | `[tech]` |
| “发到 tutorial” / “发到 _tutorials” | `_tutorials/` | `[tutorial]` |

- 若主题有更细分领域，可在默认分类后追加，例如 `[ai, tools]`、`[tech, tools]`、`[tutorial, docker]`。
- `categories` 和 `tags` 必须小写。

### 本地预览命令

按操作系统选择：

| 系统 | 推荐命令 | 说明 |
|-----|---------|-----|
| macOS / Linux | `bin/jekyll-dev.sh start` | 本地 Ruby 环境 |
| macOS / Linux | `bin/jekyll-docker.sh start` | Docker 方式 |
| Windows | `bin/jekyll-docker.ps1 start` | Docker 方式 |

预览后向用户提供文章链接，等待用户确认。

### Git 发布与清理

- 用户确认文章无误后，**先询问**是否执行 `git commit` 和 `git push`。
- 不要未经用户同意自动 commit/push。
- 若用户不同意或需要修改：
  - 直接删除刚写的文件：`rm _<target>/YYYY-MM-DD-<slug>.md`
  - 或根据用户反馈修改 / 重写后再走预览流程。
- 推送后可查看 GitHub Actions / GitHub Pages CI 状态。

## 通用 Frontmatter 约定

- `date` 通过执行 `date '+%Y-%m-%d %H:%M:%S %z'` 获取，**不得硬写时间**。
- `categories` 和 `tags` 必须小写。
- 不写 `layout:` 或 `last_modified_at`。
- TOC 固定使用：

```markdown
1. Table of Contents, ordered
{:toc}
```

## 文件命名

文章保存为 `_<target>/YYYY-MM-DD-<slug>.md`：

- slug 用小写英文、数字、连字符，不超过 50 字符，不含中文和特殊符号。
- 中文主题用拼音或英文关键词缩写。
