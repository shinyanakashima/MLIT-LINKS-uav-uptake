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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(()=>{});
await page.waitForTimeout(2500);

const checks = await page.evaluate(() => ({
  period: document.getElementById("periodBadge")?.textContent,
  kpiCount: document.querySelectorAll("#kpis .kpi").length,
  legendRows: document.querySelectorAll("#legend .legend-row").length,
  monthOptions: document.querySelectorAll("#monthSel option").length,
  paths: document.querySelectorAll("#map path").length,
  detailTitle: document.getElementById("detailTitle")?.textContent,
  canvases: [...document.querySelectorAll("canvas")].map(c => c.id + ":" + (c.width>0)),
}));
console.log("CHECKS", JSON.stringify(checks, null, 2));

// click 帯広市-ish: click a map path then read detail
await page.click("#scopeSeg button[data-scope='hokkaido']");
await page.waitForTimeout(800);
const hokPaths = await page.evaluate(() => document.querySelectorAll("#map path").length);
console.log("hokkaido paths:", hokPaths);

await page.screenshot({ path: "scripts/verify_tokachi.png", fullPage: false });
await page.click("#scopeSeg button[data-scope='tokachi']");
await page.waitForTimeout(800);
await page.screenshot({ path: "scripts/verify_full.png", fullPage: true });

console.log("ERRORS", errors.length ? JSON.stringify(errors, null, 2) : "none");
await browser.close();
server.close();
