import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_URL = "https://llm-stats.com/ai-trends";

function parseArgs(argv) {
  const options = { url: DEFAULT_URL, outputDir: null, attempts: 3, passes: 4 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--url") options.url = argv[++index];
    else if (value === "--output-dir") options.outputDir = argv[++index];
    else if (value === "--attempts") options.attempts = Number(argv[++index]);
    else if (value === "--passes") options.passes = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.outputDir) throw new Error("--output-dir is required");
  for (const key of ["attempts", "passes"]) {
    if (!Number.isInteger(options[key]) || options[key] < 1) {
      throw new Error(`--${key} must be a positive integer`);
    }
  }
  return options;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 72) || "chart";
}

function identitiesMatch(previous, current) {
  return previous.length > 0
    && previous.length === current.length
    && previous.every((value, index) => value === current[index]);
}

const options = parseArgs(process.argv.slice(2));
const runDir = path.resolve(options.outputDir);
const chartDir = path.join(runDir, "assets", "charts");
const dataDir = path.join(runDir, "data");
await fs.mkdir(chartDir, { recursive: true });
await fs.mkdir(dataDir, { recursive: true });

const diagnostics = { console: [], errors: [], failedRequests: [], attempts: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  locale: "en-US",
});
const page = await context.newPage();
page.setDefaultTimeout(90_000);

page.on("console", (message) => {
  if (message.type() === "error") diagnostics.console.push(message.text());
});
page.on("pageerror", (error) => diagnostics.errors.push(String(error.stack ?? error)));
page.on("requestfailed", (request) => {
  if (/api|_next\/static\/chunks/.test(request.url())) {
    diagnostics.failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    });
  }
});

async function scrollPage() {
  let height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(300);
    height = await page.evaluate(() => document.documentElement.scrollHeight);
  }
  for (let y = height; y >= 0; y -= 900) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(2_000);
}

async function discoverCharts(markCards = false) {
  return page.evaluate(({ mark }) => {
    const visuals = [...document.querySelectorAll("svg,canvas")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 250 && rect.height >= 160;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const ay = ar.y + window.scrollY;
        const by = br.y + window.scrollY;
        return Math.abs(ay - by) < 8 ? ar.x - br.x : ay - by;
      });

    const seen = new Set();
    const charts = [];
    for (const visual of visuals) {
      let card = visual.parentElement;
      while (card) {
        const rect = card.getBoundingClientRect();
        const headings = card.querySelectorAll("h3");
        if (
          headings.length === 1
          && rect.width >= 300
          && rect.width <= 1250
          && rect.height >= 220
          && rect.height <= 1100
        ) break;
        card = card.parentElement;
      }
      if (!card || seen.has(card)) continue;
      seen.add(card);

      const order = charts.length + 1;
      if (mark) card.dataset.aiTrendChartId = String(order);
      const title = card.querySelector("h3")?.textContent?.replace(/\s+/g, " ").trim();
      if (!title) continue;
      const section = card.closest("section")?.querySelector("h2")?.textContent?.trim() ?? "Other";
      const clone = card.cloneNode(true);
      clone.querySelectorAll("svg,canvas,button").forEach((element) => element.remove());
      const narrativeLines = clone.innerText
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const svgText = visual.tagName === "svg"
        ? [...visual.querySelectorAll("text")]
          .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean)
        : [];
      const visualRect = visual.getBoundingClientRect();
      charts.push({
        order,
        section,
        title,
        narrativeLines,
        svgText,
        visualTag: visual.tagName.toLowerCase(),
        visualWidth: Math.round(visualRect.width),
        visualHeight: Math.round(visualRect.height),
        svgMarkup: visual.tagName === "svg" ? visual.outerHTML : null,
      });
    }
    return charts;
  }, { mark: markCards });
}

function chartIdentities(charts) {
  return charts.map((chart) => [chart.section, chart.title, chart.visualTag].join("\u0000"));
}

async function pageHasIncompleteCharts() {
  return page.evaluate(() => {
    const sections = [...document.querySelectorAll("section")];
    return sections.some((section) => /loading(?: chart)?\.{0,3}|no data available/i.test(section.innerText));
  });
}

let stableCharts = null;
for (let attempt = 1; attempt <= options.attempts && !stableCharts; attempt += 1) {
  const attemptLog = { attempt, passes: [] };
  diagnostics.attempts.push(attemptLog);
  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(3_000);
  let previous = [];
  for (let pass = 1; pass <= options.passes; pass += 1) {
    await scrollPage();
    const charts = await discoverCharts(false);
    const identities = chartIdentities(charts);
    const incomplete = await pageHasIncompleteCharts();
    attemptLog.passes.push({ pass, chartCount: charts.length, incomplete });
    console.log(`attempt ${attempt}, pass ${pass}: ${charts.length} charts${incomplete ? " (incomplete)" : ""}`);
    if (!incomplete && identitiesMatch(previous, identities)) {
      stableCharts = charts;
      break;
    }
    previous = identities;
  }
}

if (!stableCharts) {
  await fs.writeFile(
    path.join(dataDir, "capture-diagnostics.json"),
    JSON.stringify(diagnostics, null, 2),
  );
  await browser.close();
  throw new Error("Chart discovery did not stabilize; see capture-diagnostics.json");
}

const markedCharts = await discoverCharts(true);
if (!identitiesMatch(chartIdentities(stableCharts), chartIdentities(markedCharts))) {
  await browser.close();
  throw new Error("Chart order changed between stable discovery and capture");
}

await page.evaluate(() => {
  for (const element of document.querySelectorAll("body *")) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const overlaysContent = (style.position === "fixed" || style.position === "sticky")
      && rect.width >= window.innerWidth * 0.6
      && rect.top < 160;
    if (overlaysContent) element.style.setProperty("visibility", "hidden", "important");
  }
});

for (const chart of markedCharts) {
  const base = `${String(chart.order).padStart(2, "0")}-${slugify(chart.title)}`;
  const locator = page.locator(`[data-ai-trend-chart-id="${chart.order}"]`);
  const imageRelative = `assets/charts/${base}.png`;
  await locator.screenshot({
    path: path.join(runDir, imageRelative),
    animations: "disabled",
    timeout: 90_000,
  });
  chart.image = imageRelative;
  if (chart.svgMarkup) {
    chart.vector = `assets/charts/${base}.svg`;
    await fs.writeFile(path.join(runDir, chart.vector), chart.svgMarkup);
  } else {
    chart.vector = null;
  }
  delete chart.svgMarkup;
  console.log(`${chart.order}/${markedCharts.length} ${chart.section} - ${chart.title}`);
}

const capture = {
  sourceUrl: options.url,
  sourceTitle: await page.title(),
  capturedAt: new Date().toISOString(),
  chartCount: markedCharts.length,
  charts: markedCharts,
};
await fs.writeFile(path.join(dataDir, "capture.json"), JSON.stringify(capture, null, 2));
await fs.writeFile(
  path.join(dataDir, "capture-diagnostics.json"),
  JSON.stringify(diagnostics, null, 2),
);
await browser.close();
console.log(`Captured ${markedCharts.length} charts in ${runDir}`);
