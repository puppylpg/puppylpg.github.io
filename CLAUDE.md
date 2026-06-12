# Claude Code 入口

本仓库的通用 agent 规则统一维护在 `AGENTS.md`。Claude Code 在本仓库工作时，先读取并遵循 `AGENTS.md`，不要在这里复制第二套项目规范。

## 读取顺序

1. 先读 `AGENTS.md`，它是跨工具主规范。
2. 如任务涉及项目内工作流，再读 `.agents/skills/<skill>/SKILL.md`。
3. 只把本文件当作 Claude Code 的兼容入口和专属补充。

## Claude 专属文件

`.claude/` 目录用于 Claude Code 自己的配置：

- `.claude/skills/`：Claude Code skill 自动发现入口，只放指向 `.agents/skills/` 的薄代理文件。
- `.claude/settings.json`：配置 Claude Code hook。
- `.claude/check_frontmatter.py`：在写入 Markdown 后检查 front matter。
- `.claude/settings.local.json`：本机私有权限配置，不作为项目通用规范。

这些文件不替代 `AGENTS.md`。跨 agent 都要遵守的规则应写入 `AGENTS.md`。

## Commit 签名

通用签名规则见 `AGENTS.md`。如果是 Claude Code 参与创建的 commit，使用 Claude 自己的 trailer：

```text
Co-Authored-By: Claude <noreply@anthropic.com>
```
