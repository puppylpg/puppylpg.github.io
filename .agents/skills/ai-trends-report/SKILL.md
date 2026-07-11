---
name: ai-trends-report
description: "抓取并分析最新 AI/LLM 趋势网页的全部动态图表，将逐图中文解读生成 Jekyll 博客文章和站内图片，并执行本地预览、用户确认及后续发布流程。用户要求总结 AI 趋势、AI trends、LLM 趋势、生成 AI 趋势博客、发布 AI 趋势报告或分析 llm-stats.com/ai-trends 时使用。默认来源为 https://llm-stats.com/ai-trends；不生成 PDF 或独立 HTML。"
---

# AI Trends 博客报告

把来源页面的当前数据快照生成项目内 `_ai/` 博客文章。不要沿用旧报告的图表数量、模型排名、数字或结论。

## 默认行为

- 默认来源：`https://llm-stats.com/ai-trends`；仅当用户明确给出新网址时替换。
- 正式产物只有 Jekyll Markdown 和站内 PNG 图表，不生成 PDF 或独立 HTML。
- 默认目标为 `_ai/`，分类为 `[ai, trends]`。
- 生成文章并完成本地预览后等待用户确认。未经再次明确授权，不执行 `git commit` 或 `git push`。
- 全程遵循项目根目录 `AGENTS.md`，尤其是文章同步、frontmatter、预览、发布和清理要求。

## 文章硬性要求

- **先给结论和理由**：正文第一个一级标题必须是“整体趋势总结”。每条趋势判断紧跟“判断依据”，用跨图数字或对比说明为什么得到这个结论；不要把总结放到文章末尾。
- **方法与局限前置**：紧接整体总结写“方法与局限”，交代时间快照、数据口径、相关与因果、来源边界，再进入读图方法和单图正文。
- **术语附英文全称**：术语表不能只写中文或缩写；同时给出可核对的英文全称，例如 `GPQA（Graduate-Level Google-Proof Q&A Benchmark）`。
- **每组先写小结**：每个来源 section 的中文标题下立即给出“本组结论”，先概括整组共同趋势，再介绍组内各图。
- **每图列关键点**：每张图除了“怎么看”和“图表显示”，还必须列 1–6 条“关键模型 / 数据点”，通常精选 2–4 条模型名与精确 metric；聚合图则列国家、组织、时间、门槛或相关系数等可直接核对的数据。
- **只写可核对数值**：优先使用 tooltip 抓取值；没有 tooltip 时只能引用 SVG、PNG、图卡或来源正文中的明确标注，不得根据点位位置猜模型名或伪造精确值。

## 1. 准备仓库和运行时

先定位路径并同步远端。同步失败或出现 rebase 冲突时停止，不要继续写文章。

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
SKILL_DIR="$REPO_ROOT/.agents/skills/ai-trends-report"
cd "$REPO_ROOT"
git pull --rebase --autostash
```

调用工作区依赖工具取得 bundled Node.js、Node modules 和 Python 的绝对路径，设置：

```bash
SOURCE_URL="https://llm-stats.com/ai-trends"
NODE="<bundled-node>"
NODE_PATH="<bundled-node-modules>"
PYTHON="<bundled-python>"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ai-trends-report.XXXXXX")"
```

用户给出新网址时只替换 `SOURCE_URL`。`RUN_DIR` 是未提交的临时证据目录；任务失败时保留路径供诊断，发布或放弃后删除。

## 2. 抓取全部动态图表

运行：

```bash
NODE_PATH="$NODE_PATH" PW_TEST_SCREENSHOT_NO_FONTS_READY=1 "$NODE" \
  "$SKILL_DIR/scripts/capture_charts.mjs" \
  --url "$SOURCE_URL" \
  --output-dir "$RUN_DIR"
```

脚本通过连续两次一致的有序扫描判断页面稳定，不依赖固定图表数量。抓取失败时检查：

- `$RUN_DIR/data/capture-diagnostics.json`
- 浏览器控制台错误
- 失败的 API 或 `_next/static/chunks` 请求

扫描未稳定、页面仍有 `Loading`、图片缺失或图表为空时，不得继续生成文章。

随后抓取散点、折线和柱状图的交互 tooltip，作为具体模型与指标值的补充证据：

```bash
NODE_PATH="$NODE_PATH" "$NODE" \
  "$SKILL_DIR/scripts/enrich_chart_points.mjs" \
  --run-dir "$RUN_DIR"
```

脚本把可读取的 tooltip 写入各图的 `interactivePoints`，并生成 `$RUN_DIR/data/point-capture-diagnostics.json`。个别非交互热力图可能没有 tooltip，这时只能使用 SVG、PNG 或图卡文字中可直接核对的数据，不得猜测模型名和数值。

## 3. 生成并填写解读数据

先校验抓取并生成模板：

```bash
"$PYTHON" "$SKILL_DIR/scripts/prepare_interpretations.py" --run-dir "$RUN_DIR"
```

完整读取 [逐图解读规范](references/interpretation-guidelines.md)，然后：

1. 读取 `$RUN_DIR/data/capture.json`。
2. 使用图像查看工具实际查看每张 PNG；宽图、热力图、散点图、坐标密集图和末图必须放大检查。
3. 填写 `$RUN_DIR/data/interpretations.json` 中所有 section、chart、glossary 和 executiveSummary 字段；每张图从 `interactivePoints` 或直接可见标注中筛选 1–6 个代表性 `keyPoints`。
4. 保持每张图的 `order`、`section` 和 `originalTitle` 不变。
5. 对明确数字写 `direct:` 证据；对视觉判断写 `inference:` 证据；不得把相关性写成因果。

完成全部逐图解读后再归纳跨图趋势，不能先写结论再让单图迎合结论；最终文章展示时将结论和理由放到最前面。每个 section 的 `summary` 必须是这一组图的整体结论，不要只写“本节将观察什么”。术语缩写必须补充英文全称。

## 4. 生成博客文章

必须通过命令获取真实发布时间，不得硬写：

```bash
PUBLISHED_AT="$(date '+%Y-%m-%d %H:%M:%S %z')"
"$PYTHON" "$SKILL_DIR/scripts/build_blog_post.py" \
  --run-dir "$RUN_DIR" \
  --repo-root "$REPO_ROOT" \
  --published-at "$PUBLISHED_AT"
```

脚本生成：

- `_ai/YYYY-MM-DD-ai-trends-YYYY-MM.md`
- `assets/img/ai/ai-trends/ai-trends-YYYY-MM/*.png`
- `$RUN_DIR/data/blog-build.json`

文章结构固定为：数据来源与背景 → 整体趋势总结及判断依据 → 方法与局限 → 数据范围和读图方法 → 带英文全称的术语 → 按来源 section 展开。每个 section 先给“本组结论”，再逐图解释；每张图包含中文标题、原始英文标题、图片、读图方式、图表观察、1–6 条关键模型或数据点、解读边界和可折叠证据。

如果同月文章或资源已经存在，脚本默认拒绝覆盖。只有用户明确要求重做、且目标仍是同一天的文章时，才可在确认路径后使用 `--force`；旧文章来自其他日期时，必须先让用户确认删除旧文章和图片，再重新生成。

## 5. 校验文章

运行：

```bash
"$PYTHON" "$SKILL_DIR/scripts/validate_blog_post.py" \
  --run-dir "$RUN_DIR" \
  --repo-root "$REPO_ROOT"
```

必须满足：

- 抓取图表数 = 逐图标题数 = Markdown 图片数 = 关键数据点区块数 = 发布 PNG 数。
- 图表顺序连续，图片链接使用 `/assets/img/ai/ai-trends/...` 站内绝对路径且文件有效。
- frontmatter 包含 `title`、真实 `date`、`categories`、小写 `tags`、`description`，不包含 `layout` 或 `last_modified_at`。
- TOC 格式正确，来源是 Markdown 内联链接；整体总结和方法局限位于读图方法及单图之前，且每条总结都有判断依据。
- “整体趋势总结”是正文第一个一级标题；“方法与局限”至少覆盖三个限制点，术语表每项包含英文名称。
- 来源 section 数 = “本组结论”数；每组标题后先出现小结，再出现本组第一张图。
- 每张图都有 1–6 条关键模型或数据点，正文通常保留 2–4 条最有解释力的点，不能倾倒全部 tooltip。
- 无 `TODO`、`TBD`、`待补充`，中文弯引号数量配对。

校验失败时不要启动预览；先修正解读 JSON 或生成脚本，再重新生成和校验。不要把部分文章描述为完成。

## 6. 本地预览并等待确认

从 `$RUN_DIR/data/blog-build.json` 读取 `post` 和 `articleUrl`，启动或重启 Jekyll：

```bash
cd "$REPO_ROOT"
bin/jekyll-dev.sh restart
```

确认站点启动，并用 `curl --noproxy '*' -fsS "http://127.0.0.1:4000${ARTICLE_URL}"` 验证目标页面可访问，避免本机 HTTP/SOCKS 代理错误接管 localhost。若当前执行环境会在脚本退出时回收后台进程，则改为在持久终端会话中前台运行 `bundle exec jekyll serve --host 0.0.0.0 --port 4000 --livereload`。向用户提供：

- 文章文件的本地可点击路径
- 图表资源目录的本地可点击路径
- `http://127.0.0.1:4000${ARTICLE_URL}` 预览链接
- 抓取日期、动态图表数量和校验结果

此时停止并等待用户确认，不自动发布。

## 7. 确认后的发布与清理

- 用户要求修改：优先修改 `interpretations.json` 后重新生成；若只是少量文字润色，可直接修改文章并再次运行校验和预览。
- 用户放弃：删除本次生成的文章和专属图片目录，停止预览，删除 `RUN_DIR`。
- 用户确认发布：再次询问是否执行 commit/push；得到授权后只暂存本次文章和图片，按 `AGENTS.md` 添加当前 agent 的 `Co-Authored-By` trailer，再推送。
- 发布成功后运行 `bin/jekyll-dev.sh stop` 并删除 `RUN_DIR`。

不要暂存或提交工作区中与本报告无关的用户修改。

## 常见错误

- 使用全局 `$HOME/.agents/skills/ai-trends-report`，导致项目 Skill 无法独立版本化。
- 把旧报告的图表数量、排名或执行摘要复制到新文章。
- 只读图表标题或 SVG 文本，不实际查看 PNG。
- 把 tooltip 抓到的全部模型都堆进正文，或在没有 tooltip 时猜测点位对应的模型。
- 生成 PDF、独立 HTML 或把临时 JSON 提交进仓库。
- 把整体趋势和方法局限留在文末，读者必须看完 48 张图才能得到判断。
- section 标题后只写“本节观察什么”，没有先给这一组图共同支持的结论。
- 术语只写缩写或中文翻译，没有补充英文全称。
- 图片留在临时目录，或在 Markdown 中使用本地文件路径。
- 校验未通过就启动预览或宣称完成。
- 未经用户确认直接 commit/push，或发布后遗留 Jekyll 服务。
