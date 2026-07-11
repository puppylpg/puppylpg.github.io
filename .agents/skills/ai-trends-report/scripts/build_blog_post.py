#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime
from pathlib import Path


PUBLISHED_AT_FORMAT = "%Y-%m-%d %H:%M:%S %z"
REQUIRED_CHART_FIELDS = ("zhTitle", "reading", "conclusion", "note")


def load_json(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f"required JSON not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def parse_published_at(value: str) -> datetime:
    try:
        return datetime.strptime(value, PUBLISHED_AT_FORMAT)
    except ValueError as error:
        raise ValueError(
            f"--published-at must match {PUBLISHED_AT_FORMAT!r}: {value}"
        ) from error


def parse_capture_time(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"invalid capturedAt value: {value}") from error


def safe_source(run_dir: Path, relative: str) -> Path:
    source = (run_dir / relative).resolve()
    try:
        source.relative_to(run_dir)
    except ValueError as error:
        raise ValueError(f"chart image escapes run directory: {relative}") from error
    if source.suffix.lower() != ".png" or not source.is_file() or source.stat().st_size < 1_000:
        raise ValueError(f"missing or invalid PNG chart: {source}")
    return source


def merge_charts(run_dir: Path, capture: dict, interpretations: dict) -> list[dict]:
    charts = capture.get("charts")
    count = capture.get("chartCount")
    if not isinstance(charts, list) or not charts or count != len(charts):
        raise ValueError("capture chart count is invalid")

    entries = interpretations.get("charts")
    if not isinstance(entries, list) or len(entries) != count:
        raise ValueError("interpretation count does not match captured charts")
    by_order = {entry.get("order"): entry for entry in entries}
    if set(by_order) != set(range(1, count + 1)):
        raise ValueError("interpretation orders do not match captured charts")

    merged: list[dict] = []
    for chart in charts:
        order = chart.get("order")
        entry = by_order[order]
        if entry.get("section") != chart.get("section"):
            raise ValueError(f"section mismatch at chart {order}")
        if entry.get("originalTitle") != chart.get("title"):
            raise ValueError(f"title mismatch at chart {order}")
        missing = [field for field in REQUIRED_CHART_FIELDS if not str(entry.get(field, "")).strip()]
        if missing:
            raise ValueError(f"chart {order} has empty fields: {', '.join(missing)}")
        evidence = entry.get("evidence")
        if not isinstance(evidence, list) or not evidence or not all(str(item).strip() for item in evidence):
            raise ValueError(f"chart {order} requires non-empty evidence")
        key_points = entry.get("keyPoints")
        if (
            not isinstance(key_points, list)
            or not 1 <= len(key_points) <= 6
            or not all(str(item).strip() for item in key_points)
        ):
            raise ValueError(f"chart {order} requires 1-6 non-empty keyPoints")
        image = safe_source(run_dir, str(chart.get("image", "")))
        merged.append({**chart, **entry, "sourceImage": image})
    return merged


def validate_interpretations(capture: dict, interpretations: dict, charts: list[dict]) -> None:
    findings = interpretations.get("executiveSummary")
    if not isinstance(findings, list) or not 4 <= len(findings) <= 8:
        raise ValueError("executiveSummary must contain 4-8 findings")
    for item in findings:
        if isinstance(item, dict):
            if not str(item.get("conclusion", "")).strip() or not str(item.get("rationale", "")).strip():
                raise ValueError("executiveSummary objects require conclusion and rationale")
        elif not str(item).strip():
            raise ValueError("executiveSummary contains an empty finding")

    glossary = interpretations.get("glossary")
    if not isinstance(glossary, list) or not 3 <= len(glossary) <= 10:
        raise ValueError("glossary must contain 3-10 entries")
    for item in glossary:
        term = str(item.get("term", "")).strip()
        if not term or not str(item.get("definition", "")).strip():
            raise ValueError("glossary entries require term and definition")
        if not re.search(r"[A-Za-z]{2,}", term):
            raise ValueError(f"glossary term must include an English name: {term}")

    sections = interpretations.get("sections")
    if not isinstance(sections, dict):
        raise ValueError("sections must be an object")
    for section in dict.fromkeys(chart["section"] for chart in charts):
        details = sections.get(section, {})
        if not str(details.get("zhTitle", "")).strip() or not str(details.get("summary", "")).strip():
            raise ValueError(f"section interpretation missing: {section}")

    if not str(capture.get("sourceUrl", "")).startswith(("http://", "https://")):
        raise ValueError("capture sourceUrl must be HTTP(S)")


def yaml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def markdown_label(value: str) -> str:
    return value.replace("[", "［").replace("]", "］").strip()


def evidence_line(value: str) -> str:
    if value.startswith("direct:"):
        return f"**直接证据：**{value.removeprefix('direct:').strip()}"
    if value.startswith("inference:"):
        return f"**视觉推断：**{value.removeprefix('inference:').strip()}"
    return f"**证据：**{value.strip()}"


def render_markdown(
    capture: dict,
    interpretations: dict,
    charts: list[dict],
    title: str,
    description: str,
    published_at: str,
    asset_url: str,
) -> str:
    captured = parse_capture_time(capture["capturedAt"])
    source_label = markdown_label(capture.get("sourceTitle") or "AI Trends source page")
    lines = [
        "---",
        f"title: {yaml_quote(title)}",
        f"date: {published_at}",
        "categories: [ai, trends]",
        "tags: [ai, llm, ai-trends, benchmark, model-evaluation]",
        f"description: {yaml_quote(description)}",
        "---",
        "",
        "1. Table of Contents, ordered",
        "{:toc}",
        "",
        f"> 数据来源：[{source_label}]({capture['sourceUrl']})；抓取日期：{captured:%Y-%m-%d}；动态图表数量：{capture['chartCount']}。",
        "",
        "AI 模型的能力、价格、速度和使用偏好都在持续变化。单看某一张排行榜，很容易把评测分数、真实体验和成本效率混为一谈。这份报告先给出跨图整体判断及其依据，再说明方法和口径，随后按主题逐图展开。",
        "",
        "# 整体趋势总结",
        "",
    ]
    for index, finding in enumerate(interpretations["executiveSummary"], 1):
        if isinstance(finding, dict):
            lines.extend([
                f"## {index}. {finding['conclusion']}",
                "",
                f"**判断依据：** {finding['rationale']}",
                "",
            ])
        else:
            lines.extend([f"## {index}. 趋势判断", "", str(finding), ""])

    lines.extend([
        "# 方法与局限",
        "",
        "- **时间快照**：模型、价格、评测和用户投票会持续变化，所有判断只代表本次抓取日期。",
        "- **口径差异**：不同图表可能采用不同样本、基准、硬件、区域或定价单位，不能把数值直接拼成因果关系。",
        "- **相关不等于因果**：散点图或时间趋势只能说明变量共同变化，不能单独证明某个因素导致另一个结果。",
        "- **来源边界**：图表版权与原始数据解释权归来源网站；引用时应保留来源链接和抓取日期。",
        "",
        "# 数据范围与读图方法",
        "",
        f"本次分析覆盖来源页面在抓取时稳定呈现的 **{capture['chartCount']} 张图表**。只有连续两次扫描得到相同的有序图表集合，才会进入解读阶段。明确数字来自图卡文字、坐标、图例或可见标签；仅凭图形走势得到的判断会明确标记为视觉推断。",
        "",
        "不同评测、价格口径、参数规模和吞吐量的采集条件并不完全一致，因此跨图比较适合发现候选趋势，不应被理解为严格受控实验。",
        "",
        "## 读图术语",
        "",
    ])
    for item in interpretations["glossary"]:
        lines.append(f"- **{item['term']}**：{item['definition']}")
    lines.append("")

    current_section = None
    for chart in charts:
        if chart["section"] != current_section:
            current_section = chart["section"]
            details = interpretations["sections"][current_section]
            lines.extend([
                f"# {details['zhTitle']}",
                "",
                f"> **本组结论：** {details['summary']}",
                "",
            ])

        image_name = chart["sourceImage"].name
        image_url = f"{asset_url}/{image_name}"
        lines.extend([
            f"## 图 {chart['order']:02d}｜{chart['zhTitle']}",
            "",
            f"*原始标题：{chart['title']}*",
            "",
            f"![{markdown_label(chart['zhTitle'])}]({image_url})",
            "",
            f"**怎么看：** {chart['reading']}",
            "",
            f"**图表显示：** {chart['conclusion']}",
            "",
            "**关键模型 / 数据点：**",
            "",
        ])
        lines.extend(f"- {str(item).strip()}" for item in chart["keyPoints"])
        lines.extend([
            "",
            f"**解读边界：** {chart['note']}",
            "",
            '<details markdown="1">',
            "<summary>证据依据</summary>",
            "",
        ])
        lines.extend(f"- {evidence_line(str(item))}" for item in chart["evidence"])
        lines.extend(["", "</details>", ""])

    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a Jekyll AI trends blog post and publish chart assets.")
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--published-at", required=True)
    parser.add_argument("--title")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    run_dir = args.run_dir.resolve()
    repo_root = args.repo_root.resolve()
    published = parse_published_at(args.published_at)
    capture = load_json(run_dir / "data" / "capture.json")
    interpretations = load_json(run_dir / "data" / "interpretations.json")
    charts = merge_charts(run_dir, capture, interpretations)
    validate_interpretations(capture, interpretations, charts)

    captured = parse_capture_time(capture["capturedAt"])
    slug = f"ai-trends-{captured.year}-{captured.month:02d}"
    title = args.title or f"{captured.year} 年 {captured.month} 月 AI/LLM 趋势图表解读"
    source_title = str(capture.get("sourceTitle") or "AI Trends 来源页面")
    description = (
        f"基于 {source_title} 最新数据快照，逐图解读 "
        f"{capture['chartCount']} 张 AI/LLM 趋势图表及其比较边界。"
    )
    post_path = repo_root / "_ai" / f"{published:%Y-%m-%d}-{slug}.md"
    asset_dir = repo_root / "assets" / "img" / "ai" / "ai-trends" / slug
    asset_url = f"/assets/img/ai/ai-trends/{slug}"

    existing_posts = list((repo_root / "_ai").glob(f"*-{slug}.md"))
    if existing_posts and post_path not in existing_posts:
        raise ValueError(
            "a report for this capture month already exists under a different date: "
            f"{existing_posts[0]}; remove it explicitly before rebuilding"
        )
    if (post_path.exists() or asset_dir.exists()) and not args.force:
        raise ValueError("blog post or asset directory already exists; use --force only for an intentional replacement")
    if args.force and asset_dir.exists():
        shutil.rmtree(asset_dir)

    asset_dir.mkdir(parents=True, exist_ok=False)
    for chart in charts:
        shutil.copy2(chart["sourceImage"], asset_dir / chart["sourceImage"].name)

    markdown = render_markdown(
        capture,
        interpretations,
        charts,
        title,
        description,
        args.published_at,
        asset_url,
    )
    post_path.parent.mkdir(parents=True, exist_ok=True)
    post_path.write_text(markdown, encoding="utf-8")

    result = {
        "post": str(post_path),
        "assetDir": str(asset_dir),
        "articleUrl": f"/ai/{published:%Y/%m/%d}/{slug}/",
        "chartCount": capture["chartCount"],
    }
    destination = run_dir / "data" / "blog-build.json"
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
