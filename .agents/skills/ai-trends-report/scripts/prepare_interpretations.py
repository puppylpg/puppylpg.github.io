#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def load_capture(run_dir: Path) -> dict:
    capture_path = run_dir / "data" / "capture.json"
    if not capture_path.is_file():
        raise ValueError(f"capture metadata not found: {capture_path}")
    return json.loads(capture_path.read_text(encoding="utf-8"))


def validate_capture(capture: dict, run_dir: Path) -> None:
    charts = capture.get("charts")
    if not isinstance(charts, list) or not charts:
        raise ValueError("capture contains no charts")
    if capture.get("chartCount") != len(charts):
        raise ValueError("chartCount does not match charts")
    orders = [chart.get("order") for chart in charts]
    if orders != list(range(1, len(charts) + 1)):
        raise ValueError("chart orders must be contiguous")
    identities = [(chart.get("section"), chart.get("title")) for chart in charts]
    if len(set(identities)) != len(identities):
        raise ValueError("duplicate chart identities found")
    for chart in charts:
        image = run_dir / chart.get("image", "")
        if not image.is_file() or image.stat().st_size < 1_000:
            raise ValueError(f"missing or invalid image for chart {chart['order']}")
        evidence = " ".join(chart.get("narrativeLines", []))
        if re.search(r"loading(?: chart)?|no data available", evidence, re.I):
            raise ValueError(f"incomplete chart {chart['order']}: {chart['title']}")


def prepare(capture: dict) -> dict:
    sections = []
    for chart in capture["charts"]:
        if chart["section"] not in sections:
            sections.append(chart["section"])
    return {
        "executiveSummary": [],
        "glossary": [],
        "sections": {
            section: {"zhTitle": "", "summary": ""}
            for section in sections
        },
        "charts": [
            {
                "order": chart["order"],
                "section": chart["section"],
                "originalTitle": chart["title"],
                "zhTitle": "",
                "reading": "",
                "conclusion": "",
                "keyPoints": [],
                "note": "",
                "evidence": [],
            }
            for chart in capture["charts"]
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a chart capture and prepare interpretation JSON.")
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run_dir = args.run_dir.resolve()
    capture = load_capture(run_dir)
    validate_capture(capture, run_dir)
    destination = run_dir / "data" / "interpretations.json"
    if destination.exists() and not args.force:
        raise ValueError(f"interpretations already exist: {destination}; use --force to replace")
    destination.write_text(
        json.dumps(prepare(capture), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Validated {capture['chartCount']} charts")
    print(destination)


if __name__ == "__main__":
    main()
