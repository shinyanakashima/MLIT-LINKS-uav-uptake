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
};

let META, MUNI, PREF, GEO;
let map, choro;
const byCity = new Map();           // city -> aggregation record
let charts = {};

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
  buildLegend();
  initMap();
  buildPrefChart();
  render();
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
      renderChoropleth(true);
      render();
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

/* ---------- 地図 ---------- */
function initMap(){
  map = L.map("map", { zoomControl: true, scrollWheelZoom: true });
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    attribution: "地理院タイル",
    maxZoom: 18,
  }).addTo(map);
  renderChoropleth(true);
}

function inScope(name){
  if(state.scope === "hokkaido") return true;
  const f = GEO.features.find(x => x.properties.name === name);
  return f ? f.properties.is_tokachi : false;
}
function valueOf(rec){
  if(!rec) return 0;
  return state.month === "all" ? rec.total : (rec.by_month[state.month] || 0);
}

function renderChoropleth(refit){
  if(choro){ map.removeLayer(choro); }
  const feats = GEO.features.filter(f => state.scope === "hokkaido" || f.properties.is_tokachi);
  choro = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    style: styleFeature,
    onEachFeature: (feature, layer) => {
      const name = feature.properties.name;
      const rec = byCity.get(name);
      layer.on({
        mouseover: e => e.target.setStyle({ weight: 2.4, color: "#11331a" }),
        mouseout:  e => choro.resetStyle(e.target),
        click: () => { state.selection = rec || { city: name, total: 0, by_month: {}, aircraft: {}, methods: {}, is_tokachi: feature.properties.is_tokachi }; render(); },
      });
      bindTip(layer, name);
    },
  }).addTo(map);
  if(refit){
    const b = choro.getBounds();
    if(b.isValid()) map.fitBounds(b, { padding: [20, 20] });
  }
}
function bindTip(layer, name){
  const rec = byCity.get(name);
  const v = valueOf(rec);
  layer.bindTooltip(`${name}：${fmt(v)} 件`, { className: "muni-tip", sticky: true });
}
function styleFeature(feature){
  const rec = byCity.get(feature.properties.name);
  const v = valueOf(rec);
  return {
    fillColor: colorFor(v), fillOpacity: 0.82,
    weight: 1, color: "#ffffff", opacity: 1,
  };
}
function restyle(){
  if(!choro) return;
  choro.setStyle(styleFeature);
  choro.eachLayer(l => {
    const name = l.feature.properties.name;
    l.unbindTooltip(); bindTip(l, name);
  });
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
