import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";


function parseArgs(argv) {
  const options = { runDir: null, url: null, limit: 240, delayMs: 25 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--run-dir") options.runDir = argv[++index];
    else if (value === "--url") options.url = argv[++index];
    else if (value === "--limit") options.limit = Number(argv[++index]);
    else if (value === "--delay-ms") options.delayMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.runDir) throw new Error("--run-dir is required");
  for (const key of ["limit", "delayMs"]) {
    if (!Number.isInteger(options[key]) || options[key] < 0) {
      throw new Error(`--${key === "delayMs" ? "delay-ms" : key} must be a non-negative integer`);
    }
  }
  return options;
}


async function scrollPage(page) {
  let height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
    height = await page.evaluate(() => document.documentElement.scrollHeight);
  }
  await page.waitForTimeout(1_500);
}


function insertedText(before, after) {
  if (before === after) return "";
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return after.slice(prefix, after.length - suffix).replace(/\s+/g, " ").trim();
}


const options = parseArgs(process.argv.slice(2));
const runDir = path.resolve(options.runDir);
const capturePath = path.join(runDir, "data", "capture.json");
const capture = JSON.parse(await fs.readFile(capturePath, "utf8"));
const sourceUrl = options.url ?? capture.sourceUrl;
if (!Array.isArray(capture.charts) || capture.charts.length !== capture.chartCount) {
  throw new Error("capture.json has an invalid chart list");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "en-US",
});
page.setDefaultTimeout(90_000);
await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
await scrollPage(page);

const diagnostics = [];
for (const chart of capture.charts) {
  const marked = await page.evaluate(({ title, order }) => {
    const heading = [...document.querySelectorAll("h3")]
      .find((node) => node.textContent?.replace(/\s+/g, " ").trim() === title);
    if (!heading) return false;
    let card = heading.parentElement;
    while (card && !card.querySelector("svg,canvas")) card = card.parentElement;
    if (!card) return false;
    card.dataset.aiPointChartId = String(order);
    return true;
  }, { title: chart.title, order: chart.order });
  if (!marked) throw new Error(`chart not found while extracting points: ${chart.title}`);

  const card = page.locator(`[data-ai-point-chart-id="${chart.order}"]`);
  const baseline = await card.innerText();
  const candidates = card.locator("svg circle, svg rect");
  const count = Math.min(await candidates.count(), options.limit);
  const samples = [];
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible())) continue;
    const box = await candidate.boundingBox();
    if (!box || box.width < 4 || box.height < 4) continue;
    await page.mouse.move(1, 1);
    await page.waitForTimeout(5);
    await candidate.hover({ force: true });
    if (options.delayMs) await page.waitForTimeout(options.delayMs);
    const insertion = insertedText(baseline, await card.innerText());
    if (!insertion || insertion.length > 600 || seen.has(insertion)) continue;
    seen.add(insertion);
    samples.push(insertion);
  }
  chart.interactivePoints = samples;
  diagnostics.push({
    order: chart.order,
    title: chart.title,
    candidates: count,
    interactivePoints: samples.length,
  });
  console.log(`${chart.order}/${capture.chartCount} ${chart.title}: ${samples.length} interactive points`);
}

capture.pointDataCapturedAt = new Date().toISOString();
await fs.writeFile(capturePath, JSON.stringify(capture, null, 2));
await fs.writeFile(
  path.join(runDir, "data", "point-capture-diagnostics.json"),
  JSON.stringify(diagnostics, null, 2),
);
await browser.close();
console.log(`Enriched ${capture.chartCount} charts in ${capturePath}`);
