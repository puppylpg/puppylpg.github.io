"""Generate the P99 teaching diagram with Python's standard library only."""

from html import escape
from pathlib import Path
import xml.etree.ElementTree as ET


DESTINATION = Path(__file__).with_name("p99-interpolation.svg")
WIDTH, HEIGHT = 920, 550
LEFT, RIGHT, TOP, BOTTOM = 112, 872, 125, 425


def x(value):
    return LEFT + (value - 175) / (535 - 175) * (RIGHT - LEFT)


def y(value):
    return BOTTOM - (value - 943) / (1003 - 943) * (BOTTOM - TOP)


def line(x1, y1, x2, y2, color, width=1, dash=""):
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}" stroke="{color}" stroke-width="{width}"{extra}/>'


def text(content, px, py, size=15, color="#e6edf3", anchor="start"):
    assert 0 <= px <= WIDTH and 0 <= py <= HEIGHT
    return f'<text x="{px:.3f}" y="{py:.3f}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{escape(content)}</text>'


rank = 1000 * 0.99
fraction = (rank - 950) / (995 - 950)
estimate = 200 + fraction * (500 - 200)
assert abs(estimate - 466.6666666666667) < 1e-9

parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title description">',
    '<title id="title">P99：目标桶内的线性插值</title>',
    '<desc id="description">在总共一千次请求中，累计计数为九百五十时耗时上界为二百毫秒，累计计数为九百九十五时上界为五百毫秒。假设桶内均匀分布，第九百九十个位置对应的 P99 估计为四百六十六点七毫秒。连线表示估计关系，不代表真实样本。</desc>',
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="#f4c57b" stroke-width="1.3"/></marker></defs>',
    '<rect width="920" height="550" fill="#151b28"/>',
    '<g font-family="Helvetica Neue, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif">',
    text("P99：目标桶内的线性插值", LEFT, 51, size=25),
    text("总请求数 1,000；目标位置 990；桶内位置 (990 − 950) / (995 − 950) = 40 / 45", LEFT, 88, size=15, color="#a6b2c5"),
]

for count in [950, 960, 970, 980, 990, 995]:
    parts.append(line(LEFT, y(count), RIGHT, y(count), "#2b3546", width=0.8))
    parts.append(line(LEFT - 5, y(count), LEFT, y(count), "#a6b2c5"))
    parts.append(text(str(count), LEFT - 14, y(count) + 5, color="#f4c57b" if count == 990 else "#a6b2c5", anchor="end"))

parts.append(f'<rect x="{LEFT}" y="{TOP}" width="{RIGHT - LEFT}" height="{BOTTOM - TOP}" fill="none" stroke="#354054"/>')
for value in [200, 300, 400, estimate, 500]:
    label = "466.7" if value == estimate else str(value)
    parts.append(line(x(value), BOTTOM, x(value), BOTTOM + 5, "#a6b2c5"))
    parts.append(text(label, x(value), BOTTOM + 27, color="#f4c57b" if value == estimate else "#a6b2c5", anchor="middle"))

parts.extend([
    line(LEFT, y(rank), x(estimate), y(rank), "#f4c57b", width=1.7, dash="7 6"),
    line(x(estimate), BOTTOM, x(estimate), y(rank), "#f4c57b", width=1.7, dash="7 6"),
    line(x(200), y(950), x(500), y(995), "#6ed5df", width=3),
])
for value, count in [(200, 950), (500, 995)]:
    parts.append(f'<circle cx="{x(value):.3f}" cy="{y(count):.3f}" r="5.5" fill="#6ed5df"/>')
parts.extend([
    f'<circle cx="{x(estimate):.3f}" cy="{y(rank):.3f}" r="7" fill="#f4c57b" stroke="#151b28" stroke-width="1.5"/>',
    text("(200 ms, 950)", x(200) + 14, y(950) + 24, size=15),
    text("(500 ms, 995)", x(500) - 6, y(995) - 17, size=15, anchor="end"),
    text("P99 ≈ 466.7 ms", 485, 273, size=20, color="#f4c57b"),
    text("目标累计数：990", 485, 305, size=17, color="#f4c57b"),
    f'<path d="M 663 269 L {x(estimate)-8:.3f} {y(rank)+7:.3f}" fill="none" stroke="#f4c57b" stroke-width="1.3" marker-end="url(#arrow)"/>',
    text("耗时 / ms", (LEFT + RIGHT) / 2, 484, size=17, anchor="middle"),
    '<text transform="translate(35 275) rotate(-90)" font-size="17" fill="#e6edf3" text-anchor="middle">累计请求数 / 次</text>',
    text("线段表示桶内均匀分布假设下的估计关系，不代表真实请求样本。", LEFT, 526, size=15, color="#a6b2c5"),
    '</g></svg>',
])
svg = "\n".join(parts) + "\n"
ET.fromstring(svg)
assert 'href=' not in svg
DESTINATION.write_text(svg, encoding="utf-8")
print(f"Saved {DESTINATION}; P99={estimate:.10f} ms; bucket fraction={fraction:.10f}")
