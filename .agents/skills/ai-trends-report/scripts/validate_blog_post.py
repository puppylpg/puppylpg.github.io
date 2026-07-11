#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


FRONTMATTER_FIELDS = ("title", "date", "categories", "tags", "description")


def load_json(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f"required JSON not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def parse_frontmatter(markdown: str) -> tuple[dict[str, str], str]:
    if not markdown.startswith("---\n"):
        raise ValueError("post does not start with YAML frontmatter")
    end = markdown.find("\n---\n", 4)
    if end < 0:
        raise ValueError("frontmatter closing delimiter not found")
    raw = markdown[4:end]
    fields: dict[str, str] = {}
    for line in raw.splitlines():
        if not line.strip() or line.startswith((" ", "\t", "#")):
            continue
        key, separator, value = line.partition(":")
        if not separator:
            raise ValueError(f"invalid frontmatter line: {line}")
        fields[key.strip()] = value.strip()
    return fields, markdown[end + 5 :]


def resolve_site_path(repo_root: Path, url: str) -> Path:
    if not url.startswith("/") or ".." in Path(url).parts:
        raise ValueError(f"image must use a safe site-absolute path: {url}")
    path = (repo_root / url.removeprefix("/")).resolve()
    try:
        path.relative_to(repo_root)
    except ValueError as error:
        raise ValueError(f"image escapes repository: {url}") from error
    return path


def validate(repo_root: Path, run_dir: Path, post_path: Path) -> dict:
    capture = load_json(run_dir / "data" / "capture.json")
    build = load_json(run_dir / "data" / "blog-build.json")
    expected = capture.get("chartCount")
    if not isinstance(expected, int) or expected <= 0:
        raise ValueError("capture chartCount is invalid")

    post_path = post_path.resolve()
    if not post_path.is_file() or post_path.stat().st_size == 0:
        raise ValueError(f"blog post not found: {post_path}")
    try:
        post_path.relative_to((repo_root / "_ai").resolve())
    except ValueError as error:
        raise ValueError("AI trends report must be written under _ai/") from error

    markdown = post_path.read_text(encoding="utf-8")
    frontmatter, body = parse_frontmatter(markdown)
    missing = [field for field in FRONTMATTER_FIELDS if not frontmatter.get(field)]
    if missing:
        raise ValueError(f"frontmatter fields missing: {', '.join(missing)}")
    forbidden = [field for field in ("layout", "last_modified_at") if field in frontmatter]
    if forbidden:
        raise ValueError(f"forbidden frontmatter fields: {', '.join(forbidden)}")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}", frontmatter["date"]):
        raise ValueError("frontmatter date must include time and numeric timezone")
    if frontmatter["categories"] != "[ai, trends]":
        raise ValueError("categories must be [ai, trends]")
    if not re.fullmatch(r"\[[a-z0-9, -]+\]", frontmatter["tags"]):
        raise ValueError("tags must contain lowercase ASCII slugs")

    toc = "1. Table of Contents, ordered\n{:toc}"
    if body.count(toc) != 1:
        raise ValueError("post must contain the canonical TOC exactly once")
    if not re.search(r"> 数据来源：\[[^]]+\]\(https?://[^)]+\)", body):
        raise ValueError("post must contain an inline HTTP(S) source link")
    if "# 整体趋势总结" not in body or "# 方法与局限" not in body:
        raise ValueError("post is missing summary or limitations section")
    section_order = [
        body.find("# 整体趋势总结"),
        body.find("# 方法与局限"),
        body.find("# 数据范围与读图方法"),
        body.find("## 图 01｜"),
    ]
    if any(position < 0 for position in section_order) or section_order != sorted(section_order):
        raise ValueError("summary, limitations, reading method, and charts are not in the required order")
    first_h1 = re.search(r"^# .+$", body, flags=re.MULTILINE)
    if not first_h1 or first_h1.group(0) != "# 整体趋势总结":
        raise ValueError("overall summary must be the first level-one section")
    summary_reasons = re.findall(r"^\*\*判断依据：\*\* .+$", body, flags=re.MULTILINE)
    if not 4 <= len(summary_reasons) <= 8:
        raise ValueError("overall summary must contain 4-8 explicit rationales")

    limitations = body[body.find("# 方法与局限") : body.find("# 数据范围与读图方法")]
    limitation_items = re.findall(r"^- \*\*[^*]+\*\*：.+$", limitations, flags=re.MULTILINE)
    if len(limitation_items) < 3:
        raise ValueError("methods and limitations must contain at least three explicit limitations")

    glossary_start = body.find("## 读图术语")
    first_chart_section = body.find("\n# ", glossary_start + 1)
    glossary_body = body[glossary_start:first_chart_section]
    glossary_items = re.findall(r"^- \*\*([^*]+)\*\*：.+$", glossary_body, flags=re.MULTILINE)
    if not 3 <= len(glossary_items) <= 10:
        raise ValueError("glossary must contain 3-10 rendered entries")
    if any(not re.search(r"[A-Za-z]{2,}", term) for term in glossary_items):
        raise ValueError("every glossary term must include an English name")

    expected_sections = len(dict.fromkeys(chart.get("section") for chart in capture["charts"]))
    group_summaries = re.findall(r"^> \*\*本组结论：\*\* .+$", body, flags=re.MULTILINE)
    if len(group_summaries) != expected_sections:
        raise ValueError(f"group-summary count mismatch: {len(group_summaries)} != {expected_sections}")
    if any(marker in body for marker in ("TODO", "TBD", "[TODO", "待补充")):
        raise ValueError("post still contains placeholder text")
    if body.count("“") != body.count("”"):
        raise ValueError("Chinese curved quotes are unbalanced")

    headings = re.findall(r"^## 图 (\d{2})｜.+$", body, flags=re.MULTILINE)
    expected_orders = [f"{order:02d}" for order in range(1, expected + 1)]
    if headings != expected_orders:
        raise ValueError("chart headings are missing, duplicated, or out of order")

    key_point_blocks = body.count("**关键模型 / 数据点：**")
    if key_point_blocks != expected:
        raise ValueError(f"key-point block count mismatch: {key_point_blocks} != {expected}")
    chart_chunks = re.split(r"^## 图 \d{2}｜.+$", body, flags=re.MULTILINE)[1:]
    for order, chunk in enumerate(chart_chunks, 1):
        match = re.search(
            r"\*\*关键模型 / 数据点：\*\*\n\n((?:- .+\n)+)",
            chunk,
        )
        if not match:
            raise ValueError(f"chart {order} has no key-point bullets")
        bullets = re.findall(r"^- .+$", match.group(1), flags=re.MULTILINE)
        if not 1 <= len(bullets) <= 6:
            raise ValueError(f"chart {order} must contain 1-6 key-point bullets")

    images = re.findall(r"^!\[[^]]*\]\((/assets/img/ai/ai-trends/[^)]+\.png)\)$", body, flags=re.MULTILINE)
    if len(images) != expected or len(set(images)) != expected:
        raise ValueError(f"blog image count mismatch: {len(images)} != {expected}")
    resolved_images = [resolve_site_path(repo_root, image) for image in images]
    for image in resolved_images:
        if not image.is_file() or image.stat().st_size < 1_000:
            raise ValueError(f"missing or invalid published chart: {image}")

    asset_dir = Path(build["assetDir"]).resolve()
    try:
        asset_dir.relative_to((repo_root / "assets" / "img" / "ai" / "ai-trends").resolve())
    except ValueError as error:
        raise ValueError("asset directory is outside the AI trends asset root") from error
    pngs = sorted(asset_dir.glob("*.png"))
    if len(pngs) != expected:
        raise ValueError(f"published PNG count mismatch: {len(pngs)} != {expected}")
    if {path.resolve() for path in pngs} != set(resolved_images):
        raise ValueError("published PNG files and Markdown image links differ")

    result = {
        "status": "ok",
        "post": str(post_path),
        "chartCount": expected,
        "headingCount": len(headings),
        "imageCount": len(images),
        "keyPointBlockCount": key_point_blocks,
        "groupSummaryCount": len(group_summaries),
        "assetDir": str(asset_dir),
        "articleUrl": build.get("articleUrl"),
    }
    destination = run_dir / "data" / "blog-validation.json"
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a generated Jekyll AI trends blog post.")
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--post", type=Path)
    args = parser.parse_args()

    run_dir = args.run_dir.resolve()
    repo_root = args.repo_root.resolve()
    build = load_json(run_dir / "data" / "blog-build.json")
    post_path = args.post or Path(build["post"])
    result = validate(repo_root, run_dir, post_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
