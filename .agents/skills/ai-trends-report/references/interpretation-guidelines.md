# AI Trends 逐图解读规范

使用 `data/capture.json`、每张 PNG、可用的 SVG 文本和来源页面正文填写 `data/interpretations.json`。不得沿用旧报告的排名、数字或结论。

最终文章必须按以下顺序呈现：整体趋势总结及逐条理由 → 方法与局限 → 数据范围与读图方法 → 带英文全称的术语 → 各组结论与逐图解读。分析阶段仍要先完成全部单图证据，再反向归纳开头的整体结论。

## 必填内容

- `executiveSummary`：4–8 个对象，每个包含 `conclusion` 和 `rationale`。必须完成全部逐图分析后归纳，但文章生成时放在最前面。
- `glossary`：3–10 个对象，每个包含 `term` 和 `definition`。
- `glossary.term`：缩写或术语同时写中文含义与英文全称，例如 `GPQA（Graduate-Level Google-Proof Q&A Benchmark）`。
- `sections`：为每个抓取到的英文 section 填写自然中文 `zhTitle` 和结论式 `summary`；`summary` 要先概括这一组图共同说明的趋势，再进入单图。
- `charts`：保持 `order`、`section`、`originalTitle` 不变，填写 `zhTitle`、`reading`、`conclusion`、`keyPoints`、`note`、`evidence`。

## 图片检查

逐张实际查看 PNG，不能只看标题或 SVG 文本。宽图、热力图、散点图、坐标密集图和最后一张图必须放大检查。确认图例、坐标轴、颜色编码和数值标签可读；不可读时在 `note` 说明，不能补写想象中的结论。

## 证据规则

- 只有在 `narrativeLines`、`svgText`、PNG 或来源正文中能找到时才使用明确数字。
- 直接支持写成 `direct: ...`。
- 视觉推断写成 `inference: ...`，正文使用“约”“显示”“表明”等谨慎措辞。
- 不得把相关性写成因果关系。
- 不得把价格直接解释为基础设施成本，也不得把总参数量等同于激活计算量。
- 发现图卡文字与图形矛盾时，把冲突写入 `note`，不要自行选择更整洁的版本。

## 关键点规则

- 每张图填写 1–6 条 `keyPoints`，通常选 2–4 条即可。优先选择领先者、低成本或小模型异常值、时间前后对照点，以及最能支撑本图结论的点。
- 散点和交互图优先读取 `capture.json` 中脚本抓到的 `interactivePoints`，写出模型名以及图中对应的精确指标，例如“DeepSeek-V4-Flash-Max：每百万 token 0.12 美元，GPQA 88.1%”。
- 聚合图、热力图和相关矩阵没有模型点时，可写国家、组织、月份、季度、门槛或相关系数等关键数据点。
- 不要罗列图上全部点，也不要把无法核对的视觉位置补成精确数字。tooltip 没有抓到、标签又不可读时，只写图中能直接核对的坐标或标注明确说明无法点名。

## 写作规则

- `zhTitle`：自然翻译，保留 benchmark、模型名和专有名词的原文形式。
- `reading`：用 1–3 句说明横纵轴、编码、比较集合和数值方向。
- `conclusion`：用 1–3 句写最值得读者关注、且证据支持的观察。
- `keyPoints`：用简短列表提供模型名或聚合对象及其精确指标，让读者无需自行估读坐标。
- `note`：用 1–2 句写最重要的口径限制、时间边界或采样偏差。
- 单个文字字段原则上不超过 220 个中文字符。
- `executiveSummary.conclusion`：写可独立阅读的整体判断，避免只写主题名。
- `executiveSummary.rationale`：紧跟判断给出 1–3 个最有代表性的数字、趋势或对比作为理由。
- `executiveSummary` 必须在完成全部逐图解读后重新归纳，不能预先写结论再让单图迎合结论；只是最终展示位置前置。

## JSON 结构

```json
{
  "executiveSummary": [
    {
      "conclusion": "旧基准趋于饱和，前沿竞争转向更难任务",
      "rationale": "多条历史最佳曲线进入 85% 以上区域，但新型 Agent 和真实环境基准仍明显低于饱和线。"
    }
  ],
  "glossary": [
    {
      "term": "GPQA（Graduate-Level Google-Proof Q&A Benchmark）",
      "definition": "研究生水平科学问答评测。"
    }
  ],
  "sections": {
    "Benchmark Performance": {
      "zhTitle": "基准性能",
      "summary": "旧基准逐渐饱和，头部差距缩小，能力竞争正在迁移到更难任务。"
    }
  },
  "charts": [
    {
      "order": 1,
      "section": "Benchmark Performance",
      "originalTitle": "Benchmark Saturation",
      "zhTitle": "基准测试饱和度",
      "reading": "阶梯线表示各基准随时间刷新后的历史最高分。",
      "conclusion": "多项较早建立的基准已经进入高分区。",
      "keyPoints": [
        "85%：图中定义的饱和参考线。",
        "2024 年 11 月：GPQA 84.0%、MMMLU 81.4%、MMMU 72.2%。"
      ],
      "note": "不同基准的分数不能直接横向比较难度。",
      "evidence": [
        "direct: 图中标出 85% 饱和参考线",
        "inference: 多条曲线逐渐进入参考线以上区域"
      ]
    }
  ]
}
```
