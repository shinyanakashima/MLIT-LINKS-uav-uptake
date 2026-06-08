import { chromium } from "playwright";
import http from "http";
import { readFile } from "fs/promises";
import path from "path";

const ROOT = path.resolve("web");
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".geojson":"application/json", ".png":"image/png" };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const fp = path.join(ROOT, p);
    const data = await readFile(fp);
    res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("404"); }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => { if (m.type() === "error") { const t = m.text(); if (!/ERR_CERT|Failed to load resource/.test(t)) errors.push("CONSOLE: " + t); } });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(()=>{});
// 地図 load 待ち
await page.waitForFunction(() => !!window.__map, null, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

const checks = await page.evaluate(() => {
  const m = window.__map;
  const src = m && m.getSource("muni");
  const data = src && src._data;
  return {
    maplibre: typeof window.maplibregl !== "undefined",
    canvas: !!document.querySelector(".maplibregl-canvas"),
    muniFeatures: data ? data.features.length : -1,
    kpiCount: document.querySelectorAll("#kpis .kpi").length,
    legendRows: document.querySelectorAll("#legend .legend-row").length,
    baseButtons: document.querySelectorAll(".basemap-ctrl button").length,
    baseDefault: window.__map && window.__map.getLayoutProperty("base-photo", "visibility"),
    layers: m ? ["base-std","base-photo","muni-fill","muni-line"].filter(l => m.getLayer(l)).length : -1,
    detailTitle: document.getElementById("detailTitle")?.textContent,
  };
});
console.log("CHECKS", JSON.stringify(checks, null, 2));

if (checks.muniFeatures > 0) {
  const clicked = await page.evaluate(() => {
    const m = window.__map;
    const p = m.project([143.20, 42.92]); // 帯広市付近
    const fs = m.queryRenderedFeatures([p.x, p.y], { layers: ["muni-fill"] });
    if (!fs.length) return null;
    m.fire("click", { lngLat: m.unproject([p.x, p.y]), point: p, features: fs });
    return fs[0].properties.name;
  });
  await page.waitForTimeout(400);
  const afterClick = await page.evaluate(() => document.getElementById("detailTitle").textContent);
  console.log("clicked feature:", clicked, "-> detailTitle:", afterClick);

  await page.click(".basemap-ctrl button[data-base='std']");
  await page.waitForTimeout(400);
  const vis = await page.evaluate(() => ({
    std: window.__map.getLayoutProperty("base-std", "visibility"),
    photo: window.__map.getLayoutProperty("base-photo", "visibility"),
  }));
  console.log("basemap after switch to std:", JSON.stringify(vis));
}

// 言語切替（EN）
await page.click("#langSeg button[data-lang='en']");
await page.waitForTimeout(500);
const enState = await page.evaluate(() => ({
  htmlLang: document.documentElement.lang,
  h1: document.querySelector("h1").textContent,
  area: document.querySelector('[data-i18n="area"]').textContent,
  kpiLabel: document.querySelector("#kpis .kpi .l")?.textContent,
  basemap: document.querySelector(".basemap-ctrl button")?.textContent,
  monthAll: document.querySelector('#monthSel option[value="all"]').textContent,
}));
console.log("EN state:", JSON.stringify(enState));
await page.screenshot({ path: "scripts/verify_en.png" });
await page.click("#langSeg button[data-lang='ja']");
await page.waitForTimeout(300);

await page.screenshot({ path: "scripts/verify_tokachi.png" });
await page.click("#scopeSeg button[data-scope='hokkaido']");
await page.waitForTimeout(800);
await page.screenshot({ path: "scripts/verify_full.png", fullPage: true });

console.log("ERRORS", errors.length ? JSON.stringify(errors, null, 2) : "none");
await browser.close();
server.close();
