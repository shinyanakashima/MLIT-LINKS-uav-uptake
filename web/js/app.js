/* 農業ドローン活用マップ（十勝／北海道）
   出典：国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』を加工して作成 */
"use strict";

const DATA = {
  meta: "data/meta.json",
  muni: "data/agri_municipalities.json",
  pref: "data/prefecture_summary.json",
  geo:  "data/hokkaido_municipalities.geojson",
};

// 件数のカラースケール（緑系・逐次）
const BREAKS = [1, 5, 15, 30, 60, 120, 250, 500];
const COLORS = [
  getCss("--green-0"), getCss("--green-1"), getCss("--green-2"), getCss("--green-3"),
  getCss("--green-4"), getCss("--green-5"), getCss("--green-6"), getCss("--green-7"),
];
function getCss(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function colorFor(v){
  if(!v || v <= 0) return "#eef1ec";
  for(let i = BREAKS.length - 1; i >= 0; i--){ if(v >= BREAKS[i]) return COLORS[i]; }
  return COLORS[0];
}
const fmt = n => (n == null ? "—" : n.toLocaleString("ja-JP"));

const state = {
  scope: "tokachi",      // "tokachi" | "hokkaido"
  month: "all",          // "all" | "YYYY-MM"
  selection: null,       // null=スコープ集計 / muni record
  base: "std",           // "std" | "photo"
};

let META, MUNI, PREF, GEO;
let map, popup, hoveredId = null, mapReady = false;
const byCity = new Map();           // city -> aggregation record
let charts = {};

// 地理院タイル（背景地図）
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';

init();

async function init(){
  const [meta, muni, pref, geo] = await Promise.all(
    Object.values(DATA).map(u => fetch(u).then(r => r.json()))
  );
  META = meta; MUNI = muni; PREF = pref; GEO = geo;
  MUNI.municipalities.forEach(m => byCity.set(m.city, m));

  document.getElementById("periodBadge").textContent =
    `対象期間: ${jpMonth(MUNI.months[0])} 〜 ${jpMonth(MUNI.months[MUNI.months.length-1])}（月次）`;
  document.getElementById("genStamp").textContent =
    META.generated_at ? `生成日: ${META.generated_at.slice(0,10)}` : "";

  setupMonthSelect();
  setupScopeToggle();
  setupBaseToggle();
  buildLegend();
  buildPrefChart();
  initMap();          // 地図準備後に load 内で choropleth を描画
  render();           // 地図以外（KPI・チャート・詳細）を即時描画
}

/* ---------- コントロール ---------- */
function setupMonthSelect(){
  const sel = document.getElementById("monthSel");
  MUNI.months.forEach(m => {
    const o = document.createElement("option");
    o.value = m; o.textContent = jpMonth(m);
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => { state.month = sel.value; render(); });
}
function setupScopeToggle(){
  document.querySelectorAll("#scopeSeg button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#scopeSeg button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.scope = btn.dataset.scope;
      state.selection = null;
      applyScope();
      fitScope();
      render();
    });
  });
}
function setupBaseToggle(){
  document.querySelectorAll("#baseSeg button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#baseSeg button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.base = btn.dataset.base;
      setBasemap();
    });
  });
}
function buildLegend(){
  const el = document.getElementById("legend");
  el.innerHTML = "";
  const rows = [["0（計画なし）", "#eef1ec"]];
  for(let i = 0; i < BREAKS.length; i++){
    const lo = BREAKS[i];
    const hi = (i < BREAKS.length - 1) ? BREAKS[i+1] - 1 : null;
    rows.push([hi ? `${lo}–${hi}` : `${lo}+`, COLORS[i]]);
  }
  rows.forEach(([label, c]) => {
    const r = document.createElement("div"); r.className = "legend-row";
    r.innerHTML = `<span class="legend-swatch" style="background:${c}"></span>${label}`;
    el.appendChild(r);
  });
}

/* ---------- 地図（MapLibre GL JS + 地理院タイル） ---------- */
function valueOf(rec){
  if(!rec) return 0;
  return state.month === "all" ? rec.total : (rec.by_month[state.month] || 0);
}

// 件数 → 塗り色（step 式）
function fillColorExpr(){
  const expr = ["step", ["to-number", ["coalesce", ["get", "v"], 0]], "#eef1ec"];
  for(let i = 0; i < BREAKS.length; i++){ expr.push(BREAKS[i], COLORS[i]); }
  return expr;
}
function scopeFilter(){
  return state.scope === "hokkaido" ? null : ["==", ["get", "is_tokachi"], true];
}

// 集計値 v を注入した FeatureCollection を生成
function buildFC(){
  return {
    type: "FeatureCollection",
    features: GEO.features.map((f, i) => ({
      type: "Feature",
      id: i,
      properties: {
        name: f.properties.name,
        is_tokachi: !!f.properties.is_tokachi,
        v: valueOf(byCity.get(f.properties.name)),
      },
      geometry: f.geometry,
    })),
  };
}

function baseStyle(){
  return {
    version: 8,
    sources: {
      gsi_std: {
        type: "raster", tileSize: 256, maxzoom: 18, attribution: GSI_ATTR,
        tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
      },
      gsi_photo: {
        type: "raster", tileSize: 256, maxzoom: 18, attribution: GSI_ATTR,
        tiles: ["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"],
      },
    },
    layers: [
      { id: "base-std", type: "raster", source: "gsi_std",
        layout: { visibility: state.base === "std" ? "visible" : "none" } },
      { id: "base-photo", type: "raster", source: "gsi_photo",
        layout: { visibility: state.base === "photo" ? "visible" : "none" } },
    ],
  };
}

function initMap(){
  map = new maplibregl.Map({
    container: "map",
    style: baseStyle(),
    center: [143.2, 43.0],
    zoom: 7,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "muni-popup" });

  // style.load はスタイル解析完了時に発火（タイル取得の成否に依存しない）
  map.on("style.load", () => {
    if (map.getSource("muni")) return;
    map.addSource("muni", { type: "geojson", data: buildFC() });
    map.addLayer({
      id: "muni-fill", type: "fill", source: "muni",
      paint: { "fill-color": fillColorExpr(), "fill-opacity": 0.78 },
    });
    map.addLayer({
      id: "muni-line", type: "line", source: "muni",
      paint: {
        "line-color": "#ffffff",
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.6, 0.8],
      },
    });
    applyScope();
    bindMapEvents();
    mapReady = true;
    fitScope();
    render();
    window.__map = map;            // 動作確認用フック
  });
}

function bindMapEvents(){
  map.on("mousemove", "muni-fill", e => {
    if(!e.features.length) return;
    map.getCanvas().style.cursor = "pointer";
    const f = e.features[0];
    if(hoveredId !== null && hoveredId !== f.id){
      map.setFeatureState({ source: "muni", id: hoveredId }, { hover: false });
    }
    hoveredId = f.id;
    map.setFeatureState({ source: "muni", id: hoveredId }, { hover: true });
    popup.setLngLat(e.lngLat)
      .setHTML(`<b>${f.properties.name}</b><br>${fmt(f.properties.v)} 件`)
      .addTo(map);
  });
  map.on("mouseleave", "muni-fill", () => {
    map.getCanvas().style.cursor = "";
    if(hoveredId !== null) map.setFeatureState({ source: "muni", id: hoveredId }, { hover: false });
    hoveredId = null;
    popup.remove();
  });
  map.on("click", "muni-fill", e => {
    if(!e.features.length) return;
    const name = e.features[0].properties.name;
    const rec = byCity.get(name);
    state.selection = rec || {
      city: name, total: 0, by_month: {}, aircraft: {},
      methods: { "夜間":0,"目視外":0,"物件投下":0,"30m未満":0 },
      is_tokachi: !!e.features[0].properties.is_tokachi,
    };
    render();
  });
}

function setBasemap(){
  if(!map) return;
  map.setLayoutProperty("base-std", "visibility", state.base === "std" ? "visible" : "none");
  map.setLayoutProperty("base-photo", "visibility", state.base === "photo" ? "visible" : "none");
}

function applyScope(){
  if(!mapReady && !(map && map.getLayer("muni-fill"))) return;
  const f = scopeFilter();
  map.setFilter("muni-fill", f);
  map.setFilter("muni-line", f);
}

// スコープ内フィーチャの bbox に合わせてズーム
function fitScope(){
  if(!map) return;
  const feats = GEO.features.filter(f => state.scope === "hokkaido" || f.properties.is_tokachi);
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const walk = c => {
    if(typeof c[0] === "number"){
      if(c[0] < minX) minX = c[0]; if(c[0] > maxX) maxX = c[0];
      if(c[1] < minY) minY = c[1]; if(c[1] > maxY) maxY = c[1];
    } else c.forEach(walk);
  };
  feats.forEach(f => walk(f.geometry.coordinates));
  if(minX <= maxX) map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 24, duration: 600 });
}

// 集計値の再注入（月・選択変更時）
function restyle(){
  if(!mapReady) return;
  const src = map.getSource("muni");
  if(src) src.setData(buildFC());
}

/* ---------- スコープ集計 ---------- */
function scopeAgg(){
  const recs = MUNI.municipalities.filter(m => state.scope === "hokkaido" || m.is_tokachi);
  const agg = { city: state.scope === "hokkaido" ? "北海道全体" : "十勝管内", total: 0,
    by_month: {}, aircraft: {}, methods: { "夜間":0,"目視外":0,"物件投下":0,"30m未満":0 }, _isScope: true };
  MUNI.months.forEach(m => agg.by_month[m] = 0);
  recs.forEach(r => {
    agg.total += r.total;
    MUNI.months.forEach(m => agg.by_month[m] += (r.by_month[m] || 0));
    for(const [k,v] of Object.entries(r.aircraft || {})) agg.aircraft[k] = (agg.aircraft[k]||0) + v;
    for(const k of Object.keys(agg.methods)) agg.methods[k] += (r.methods?.[k] || 0);
  });
  // 分母はスコープ内の全市区町村数（境界データ基準）、分子は計画が1件以上ある市区町村数
  const scopeNames = GEO.features
    .filter(f => state.scope === "hokkaido" || f.properties.is_tokachi)
    .map(f => f.properties.name);
  agg.municipalities = new Set(scopeNames).size;
  agg.active = scopeNames.filter(n => (byCity.get(n)?.total || 0) > 0).length;
  return agg;
}

/* ---------- 全体レンダリング ---------- */
function render(){
  restyle();
  const agg = scopeAgg();
  renderKpis(agg);
  const target = state.selection || agg;
  renderDetail(target, agg);
  renderTrend(target, agg);
  renderAircraft(target);
  renderMethod(target);
  document.getElementById("mapCaption").textContent =
    state.month === "all" ? "全期間（累計）の計画件数。市区町村をクリックで詳細表示。"
                          : `${jpMonth(state.month)} の計画件数。市区町村をクリックで詳細表示。`;
}

function renderKpis(agg){
  const el = document.getElementById("kpis");
  const periodLabel = state.month === "all" ? "全期間" : jpMonth(state.month);
  const scopeVal = state.scope === "hokkaido"
    ? sumScope("hokkaido") : sumScope("tokachi");
  const top = [...MUNI.municipalities]
    .filter(m => state.scope === "hokkaido" || m.is_tokachi)
    .map(m => ({ city: m.city, v: valueOf(m) }))
    .sort((a,b) => b.v - a.v)[0] || { city: "—", v: 0 };

  const prefEntries = Object.entries(PREF.prefectures);
  const hokRank = prefEntries.findIndex(([k]) => k === "北海道") + 1;

  let card4;
  if(state.scope === "hokkaido"){
    card4 = kpi(`全国 ${hokRank}位`, `北海道の農業計画 全国順位（全期間 / ${prefEntries.length}都道府県中）`);
  }else{
    const hokTotal = sumScopeAll("hokkaido");
    const tokTotal = sumScopeAll("tokachi");
    const share = hokTotal ? Math.round(tokTotal / hokTotal * 1000) / 10 : 0;
    card4 = kpi(`${share}%`, "十勝の道内シェア（全期間・計画件数）");
  }
  el.innerHTML =
    kpi(`${fmt(scopeVal)} 件`, `計画件数（${periodLabel}・${state.scope==="hokkaido"?"北海道":"十勝"}）`) +
    kpi(`${fmt(agg.active)} / ${fmt(agg.municipalities)}`, "計画のある市町村数") +
    kpi(`${top.city}`, `最多市町村（${fmt(top.v)} 件・${periodLabel}）`) +
    card4;
}
function kpi(v, l){ return `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`; }
function sumScope(scope){
  return MUNI.municipalities.filter(m => scope==="hokkaido" || m.is_tokachi)
    .reduce((s,m)=> s + valueOf(m), 0);
}
function sumScopeAll(scope){
  return MUNI.municipalities.filter(m => scope==="hokkaido" || m.is_tokachi)
    .reduce((s,m)=> s + m.total, 0);
}

function renderDetail(t, agg){
  const title = document.getElementById("detailTitle");
  const body = document.getElementById("detailBody");
  const isScope = t._isScope;
  const tokBadge = (!isScope && t.is_tokachi) ? '<span class="badge-tokachi">十勝</span>' : "";
  title.innerHTML = (isScope ? "地域サマリー：" : "") + t.city + tokBadge;

  const periodVal = isScope ? valueScopeAll(t) : t.total;
  const monVal = state.month === "all" ? null : (t.by_month[state.month] || 0);
  const topAir = Object.entries(t.aircraft||{}).sort((a,b)=>b[1]-a[1])[0];
  const dropRate = t.total ? Math.round((t.methods?.["物件投下"]||0)/t.total*100) : 0;

  let html = `<div class="detail-grid">
    ${kpi(fmt(periodVal), "累計 計画件数")}
    ${kpi(monVal==null?"—":fmt(monVal), state.month==="all"?"（月を選択）":jpMonth(state.month))}
  </div>`;
  html += `<div class="detail-list">`;
  html += row("主な機体", topAir ? `${topAir[0]}（${fmt(topAir[1])}）` : "—");
  html += row("散布関連（物件投下）", `${dropRate}%`);
  if(!isScope){
    html += row("目視外を含む計画", pct(t,"目視外"));
    html += row("夜間を含む計画", pct(t,"夜間"));
  }
  html += `</div>`;
  if(!isScope){
    html += `<p class="card-note" style="margin-top:10px">クリックで他の市区町村に切替。スコープ集計に戻すには表示範囲を切り替えてください。</p>`;
  }else{
    html += `<p class="placeholder" style="margin-top:10px">市区町村をクリックすると、その地域の内訳に切り替わります。</p>`;
  }
  body.innerHTML = html;
}
function valueScopeAll(t){ return Object.values(t.by_month).reduce((a,b)=>a+b,0); }
function row(k,v){ return `<div class="row"><span>${k}</span><strong>${v}</strong></div>`; }
function pct(t,key){ const r = t.total ? Math.round((t.methods?.[key]||0)/t.total*100) : 0; return `${r}%`; }

/* ---------- チャート ---------- */
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }

function buildPrefChart(){
  const entries = Object.entries(PREF.prefectures).slice(0, 12);
  const labels = entries.map(e => e[0]);
  const vals = entries.map(e => e[1]);
  const bg = labels.map(l => l === "北海道" ? getCss("--green-6") : "#c7d6bd");
  destroy("pref");
  charts.pref = new Chart(document.getElementById("prefChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: vals, backgroundColor: bg, borderRadius: 4 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmt(c.parsed.x)} 件` } } },
      scales: { x: { ticks: { callback: v => fmt(v) }, grid: { color: "#eef1ec" } }, y: { ticks: { font: { size: 11 } }, grid: { display: false } } },
    },
  });
}

function renderTrend(t, agg){
  const labels = MUNI.months.map(jpMonthShort);
  let datasets;
  if(t._isScope){
    datasets = [
      lineDs("北海道", MUNI.months.map(m => MUNI.month_totals.hokkaido[m]||0), getCss("--green-3"), false),
      lineDs("十勝", MUNI.months.map(m => MUNI.month_totals.tokachi[m]||0), getCss("--green-6"), true),
    ];
  }else{
    datasets = [ lineDs(t.city, MUNI.months.map(m => t.by_month[m]||0), getCss("--green-6"), true) ];
  }
  destroy("trend");
  charts.trend = new Chart(document.getElementById("trendChart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} 件` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => fmt(v) }, grid: { color: "#eef1ec" } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } } },
    },
  });
}
function lineDs(label, data, color, fill){
  return { label, data, borderColor: color, backgroundColor: color + "33",
    fill: fill, tension: 0.3, pointRadius: 2, borderWidth: 2 };
}

const AIR_COLORS = ["#2c6a1c","#66ab3a","#8fc65d","#b6db92","#c9b27a","#bbbbbb"];
function renderAircraft(t){
  const entries = Object.entries(t.aircraft || {}).sort((a,b)=>b[1]-a[1]);
  destroy("air");
  if(!entries.length){ blankCanvas("aircraftChart"); return; }
  charts.air = new Chart(document.getElementById("aircraftChart"), {
    type: "doughnut",
    data: { labels: entries.map(e=>e[0]),
      datasets: [{ data: entries.map(e=>e[1]), backgroundColor: entries.map((_,i)=>AIR_COLORS[i%AIR_COLORS.length]) }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "55%",
      plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmt(c.parsed)} 件` } } } },
  });
}

function renderMethod(t){
  const keys = ["物件投下","目視外","夜間","30m未満"];
  const labels = ["物件投下（散布）","目視外","夜間","30m未満接近"];
  const total = t.total || 0;
  const vals = keys.map(k => total ? Math.round((t.methods?.[k]||0)/total*1000)/10 : 0);
  destroy("method");
  charts.method = new Chart(document.getElementById("methodChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: vals, backgroundColor: "#66ab3a", borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.x}%（${fmt(t.methods?.[keys[c.dataIndex]]||0)} 件）` } } },
      scales: { x: { beginAtZero: true, max: 100, ticks: { callback: v => v+"%" }, grid: { color: "#eef1ec" } },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } } } },
  });
}
function blankCanvas(id){ const c = document.getElementById(id); const ctx = c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height); }

/* ---------- ユーティリティ ---------- */
function jpMonth(m){ const [y,mo] = m.split("-"); return `${y}年${parseInt(mo,10)}月`; }
function jpMonthShort(m){ const [y,mo] = m.split("-"); return `${y.slice(2)}/${parseInt(mo,10)}`; }
