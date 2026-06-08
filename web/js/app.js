/* 農業ドローン活用マップ（十勝／北海道） / Agricultural Drone Activity Map (Tokachi / Hokkaido)
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
const fmt = n => (n == null ? "—" : n.toLocaleString("en-US"));

const state = {
  scope: "tokachi",      // "tokachi" | "hokkaido"
  month: "all",          // "all" | "YYYY-MM"
  selection: null,       // null=スコープ集計 / muni record
  base: "photo",         // "photo"=衛星写真（既定） | "std"=標準地図
};
let lang = localStorage.getItem("lang") || "ja";   // "ja" | "en"

let META, MUNI, PREF, GEO;
let map, popup, hoveredId = null, mapReady = false;
const byCity = new Map();           // city -> aggregation record
let charts = {};

const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル / GSI Tiles</a>';

/* ====================== i18n ====================== */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const AIR_EN = {
  "マルチローター":"Multirotor","ヘリコプター":"Helicopter","飛行機":"Airplane",
  "滑空機":"Glider","飛行船":"Airship","その他":"Other","不明":"Unknown",
};
const PREF_EN = {
  "北海道":"Hokkaido","青森県":"Aomori","岩手県":"Iwate","宮城県":"Miyagi","秋田県":"Akita",
  "山形県":"Yamagata","福島県":"Fukushima","茨城県":"Ibaraki","栃木県":"Tochigi","群馬県":"Gunma",
  "埼玉県":"Saitama","千葉県":"Chiba","東京都":"Tokyo","神奈川県":"Kanagawa","新潟県":"Niigata",
  "富山県":"Toyama","石川県":"Ishikawa","福井県":"Fukui","山梨県":"Yamanashi","長野県":"Nagano",
  "岐阜県":"Gifu","静岡県":"Shizuoka","愛知県":"Aichi","三重県":"Mie","滋賀県":"Shiga",
  "京都府":"Kyoto","大阪府":"Osaka","兵庫県":"Hyogo","奈良県":"Nara","和歌山県":"Wakayama",
  "鳥取県":"Tottori","島根県":"Shimane","岡山県":"Okayama","広島県":"Hiroshima","山口県":"Yamaguchi",
  "徳島県":"Tokushima","香川県":"Kagawa","愛媛県":"Ehime","高知県":"Kochi","福岡県":"Fukuoka",
  "佐賀県":"Saga","長崎県":"Nagasaki","熊本県":"Kumamoto","大分県":"Oita","宮崎県":"Miyazaki",
  "鹿児島県":"Kagoshima","沖縄県":"Okinawa",
};
const T = {
  ja: {
    app_title: "農業ドローン活用マップ",
    app_subtitle: "十勝／北海道　—　農林水産業目的の無人航空機 飛行計画（申請）",
    notice_strong: "本マップは飛行「計画（申請）」データであり、実際の飛行・実態を示すものではありません。",
    notice_rest: "紙資料のスキャン→自動抽出によるデータのため、完全性・正確性は保証されません。座標は市区町村重心レベルに秘匿化されています。",
    disp_settings: "表示設定", area: "表示範囲",
    scope_tokachi: "十勝管内", scope_hokkaido: "北海道全体",
    month_label: "対象月", month_all: "全期間（累計）",
    legend_title: "凡例（計画件数）", legend_zero: "0（計画なし）",
    pref_rank_title: "都道府県ランキング（全国）",
    pref_rank_note: "農業目的の飛行計画 件数（全期間）。北海道を強調表示。",
    detail_summary_h: "地域サマリー", trend_title: "月別推移",
    trend_note: "新規計画数（計画IDの初出月ベース）。",
    aircraft_title: "機体の種類", method_title: "飛行方法（散布関連の比率）",
    method_note: "農薬散布等に関わる飛行方法を含む計画の割合（全期間）。",
    footer_attr: "出典：国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』を加工して作成",
    footer_small1: "境界データ：国土交通省 国土数値情報（行政区域データ N03, 2025年）を加工して作成 ／ 背景地図：地理院タイル（標準地図／衛星写真） ／ ライセンス：公共データ利用規約（第1.0版, CC BY 4.0 互換）。",
    footer_small2: '本データは申請ベースの参考情報です。個人・事業者を特定する二次加工は行っていません。集計方法の詳細は <a href="data/meta.json">meta.json</a> を参照してください。',
    period_all: "全期間", scope_short_hok: "北海道", scope_short_tok: "十勝",
    plans_unit: " 件", plans_word: "件",
    kpi_muni: "計画のある市町村数",
    detail_cum: "累計 計画件数", detail_select_month: "（月を選択）",
    detail_main_aircraft: "主な機体", detail_spray: "散布関連（物件投下）",
    detail_bvlos: "目視外を含む計画", detail_night: "夜間を含む計画",
    detail_note_muni: "クリックで他の市区町村に切替。スコープ集計に戻すには表示範囲を切り替えてください。",
    detail_note_scope: "市区町村をクリックすると、その地域の内訳に切り替わります。",
    summary_prefix: "地域サマリー：", tok_badge: "十勝",
    trend_hok: "北海道", trend_tok: "十勝",
    method_labels: ["物件投下（散布）", "目視外", "夜間", "30m未満接近"],
    basemap_photo: "衛星写真", basemap_std: "標準地図",
    period_badge: (a,b) => `対象期間: ${a} 〜 ${b}（月次）`,
    gen_stamp: d => `生成日: ${d}`,
    kpi_plans: (p,s) => `計画件数（${p}・${s}）`,
    kpi_top: (n,p) => `最多市町村（${n} 件・${p}）`,
    kpi_rank_val: r => `全国 ${r}位`,
    kpi_rank: n => `北海道の農業計画 全国順位（全期間 / ${n}都道府県中）`,
    kpi_share: "十勝の道内シェア（全期間・計画件数）",
    cap_all: "全期間（累計）の計画件数。市区町村をクリックで詳細表示。",
    cap_month: mo => `${mo} の計画件数。市区町村をクリックで詳細表示。`,
  },
  en: {
    app_title: "Agricultural Drone Activity Map",
    app_subtitle: "Tokachi / Hokkaido — UAV flight plans (applications) for agriculture, forestry & fisheries",
    notice_strong: "This map shows flight “plans (applications)”, not actual flights or operations.",
    notice_rest: "Data is auto-extracted from scanned paper forms, so completeness and accuracy are not guaranteed. Coordinates are anonymised to municipality-centroid level.",
    disp_settings: "Display settings", area: "Area",
    scope_tokachi: "Tokachi region", scope_hokkaido: "All Hokkaido",
    month_label: "Month", month_all: "All period (cumulative)",
    legend_title: "Legend (no. of plans)", legend_zero: "0 (none)",
    pref_rank_title: "Prefecture ranking (national)",
    pref_rank_note: "Agricultural flight plans (all period). Hokkaido highlighted.",
    detail_summary_h: "Regional summary", trend_title: "Monthly trend",
    trend_note: "New plans (by first-seen month of each plan ID).",
    aircraft_title: "Aircraft type", method_title: "Flight methods (spraying-related share)",
    method_note: "Share of plans including spraying-related flight methods (all period).",
    footer_attr: "Source: MLIT Project LINKS, “UAV Flight Plan Data (FY2025)”, processed by the author.",
    footer_small1: "Boundaries: MLIT National Land Numerical Information (Administrative Districts N03, 2025), processed. / Basemap: GSI Tiles (Standard / Satellite). / License: Public Data License (v1.0, CC BY 4.0 compatible).",
    footer_small2: 'This is reference information based on applications. No re-processing that could identify individuals or operators has been performed. See <a href="data/meta.json">meta.json</a> for aggregation details.',
    period_all: "All period", scope_short_hok: "Hokkaido", scope_short_tok: "Tokachi",
    plans_unit: "", plans_word: "plans",
    kpi_muni: "Municipalities with plans",
    detail_cum: "Cumulative plans", detail_select_month: "(select a month)",
    detail_main_aircraft: "Main aircraft", detail_spray: "Spraying (object dropping)",
    detail_bvlos: "Incl. BVLOS", detail_night: "Incl. night flight",
    detail_note_muni: "Click another municipality to switch. Toggle the area to return to the regional summary.",
    detail_note_scope: "Click a municipality to see its breakdown.",
    summary_prefix: "Regional summary: ", tok_badge: "Tokachi",
    trend_hok: "Hokkaido", trend_tok: "Tokachi",
    method_labels: ["Object drop (spraying)", "BVLOS", "Night", "<30m proximity"],
    basemap_photo: "Satellite", basemap_std: "Standard",
    period_badge: (a,b) => `Period: ${a} – ${b} (monthly)`,
    gen_stamp: d => `Generated: ${d}`,
    kpi_plans: (p,s) => `Plans (${p}, ${s})`,
    kpi_top: (n,p) => `Top municipality (${n}, ${p})`,
    kpi_rank_val: r => `#${r} in Japan`,
    kpi_rank: n => `Hokkaido's national rank (all period / of ${n})`,
    kpi_share: "Tokachi's share within Hokkaido (all period)",
    cap_all: "Plans (all period). Click a municipality for details.",
    cap_month: mo => `Plans in ${mo}. Click a municipality for details.`,
  },
};
function L(k){ return T[lang][k]; }
function monthLabel(m){ const [y,mo] = m.split("-"); return lang === "ja" ? `${y}年${+mo}月` : `${MON[+mo-1]} ${y}`; }
function monthShort(m){ const [y,mo] = m.split("-"); return lang === "ja" ? `${y.slice(2)}/${+mo}` : `${MON[+mo-1]} '${y.slice(2)}`; }
function plansVal(n){ return `${fmt(n)}${L("plans_unit")}`; }
function scopeName(scope){ return scope === "hokkaido" ? L("scope_hokkaido") : L("scope_tokachi"); }
function scopeShort(scope){ return scope === "hokkaido" ? L("scope_short_hok") : L("scope_short_tok"); }
function aircraftLabel(v){ return lang === "ja" ? v : (AIR_EN[v] || v); }
function prefLabel(v){ return lang === "ja" ? v : (PREF_EN[v] || v); }

init();

async function init(){
  const [meta, muni, pref, geo] = await Promise.all(
    Object.values(DATA).map(u => fetch(u).then(r => r.json()))
  );
  META = meta; MUNI = muni; PREF = pref; GEO = geo;
  MUNI.municipalities.forEach(m => byCity.set(m.city, m));

  setupLangToggle();
  setupMonthSelect();
  setupScopeToggle();
  applyStaticI18n();
  initMap();          // 地図準備後に style.load 内で choropleth を描画
  buildPrefChart();
  render();           // 地図以外（KPI・チャート・詳細）を即時描画
}

/* ---------- i18n 適用 ---------- */
function applyStaticI18n(){
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = L(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = L(el.dataset.i18nHtml); });
  document.title = L("app_title") + (lang === "ja"
    ? "（十勝／北海道） | Project LINKS 飛行計画データ"
    : " (Tokachi / Hokkaido) | Project LINKS Flight Plan Data");
  refreshPeriodBadge();
  refreshGenStamp();
  buildLegend();
}
function refreshPeriodBadge(){
  document.getElementById("periodBadge").textContent =
    L("period_badge")(monthLabel(MUNI.months[0]), monthLabel(MUNI.months[MUNI.months.length-1]));
}
function refreshGenStamp(){
  document.getElementById("genStamp").textContent =
    META.generated_at ? L("gen_stamp")(META.generated_at.slice(0,10)) : "";
}
function setupLangToggle(){
  document.querySelectorAll("#langSeg button").forEach(b => {
    b.classList.toggle("active", b.dataset.lang === lang);
    b.addEventListener("click", () => setLang(b.dataset.lang));
  });
}
function setLang(l){
  if(l === lang) return;
  lang = l;
  localStorage.setItem("lang", l);
  document.querySelectorAll("#langSeg button").forEach(b => b.classList.toggle("active", b.dataset.lang === l));
  applyStaticI18n();
  refreshMonthOptions();
  refreshBasemapButtons();
  buildPrefChart();
  render();
}
function refreshMonthOptions(){
  const sel = document.getElementById("monthSel");
  [...sel.options].forEach(o => { o.textContent = o.value === "all" ? L("month_all") : monthLabel(o.value); });
}
function refreshBasemapButtons(){
  document.querySelectorAll(".basemap-ctrl button").forEach(b => {
    b.textContent = b.dataset.base === "photo" ? L("basemap_photo") : L("basemap_std");
  });
}

/* ---------- コントロール ---------- */
function setupMonthSelect(){
  const sel = document.getElementById("monthSel");
  MUNI.months.forEach(m => {
    const o = document.createElement("option");
    o.value = m; o.textContent = monthLabel(m);
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
// 地図上の背景地図切替コントロール（MapLibre カスタムコントロール）
class BasemapControl {
  onAdd(m){
    this._map = m;
    const c = document.createElement("div");
    c.className = "maplibregl-ctrl maplibregl-ctrl-group basemap-ctrl";
    [["photo", L("basemap_photo")], ["std", L("basemap_std")]].forEach(([base, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.dataset.base = base;
      if(base === state.base) b.classList.add("active");
      b.addEventListener("click", () => setBase(base));
      c.appendChild(b);
    });
    this._el = c;
    return c;
  }
  onRemove(){ this._el.remove(); this._map = undefined; }
}
function setBase(base){
  state.base = base;
  setBasemap();
  document.querySelectorAll(".basemap-ctrl button").forEach(b =>
    b.classList.toggle("active", b.dataset.base === base));
}
function buildLegend(){
  const el = document.getElementById("legend");
  el.innerHTML = "";
  const rows = [[L("legend_zero"), "#eef1ec"]];
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
function fillColorExpr(){
  const expr = ["step", ["to-number", ["coalesce", ["get", "v"], 0]], "#eef1ec"];
  for(let i = 0; i < BREAKS.length; i++){ expr.push(BREAKS[i], COLORS[i]); }
  return expr;
}
function scopeFilter(){
  return state.scope === "hokkaido" ? null : ["==", ["get", "is_tokachi"], true];
}
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
    container: "map", style: baseStyle(),
    center: [143.2, 43.0], zoom: 7, attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new BasemapControl(), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "muni-popup" });

  map.on("style.load", () => {
    if (map.getSource("muni")) return;
    map.addSource("muni", { type: "geojson", data: buildFC() });
    map.addLayer({ id: "muni-fill", type: "fill", source: "muni",
      paint: { "fill-color": fillColorExpr(), "fill-opacity": 0.78 } });
    map.addLayer({ id: "muni-line", type: "line", source: "muni",
      paint: { "line-color": "#ffffff",
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.6, 0.8] } });
    applyScope();
    bindMapEvents();
    mapReady = true;
    fitScope();
    render();
    window.__map = map;
  });
}
function bindMapEvents(){
  map.on("mousemove", "muni-fill", e => {
    if(!e.features.length) return;
    map.getCanvas().style.cursor = "pointer";
    const f = e.features[0];
    if(hoveredId !== null && hoveredId !== f.id)
      map.setFeatureState({ source: "muni", id: hoveredId }, { hover: false });
    hoveredId = f.id;
    map.setFeatureState({ source: "muni", id: hoveredId }, { hover: true });
    popup.setLngLat(e.lngLat)
      .setHTML(`<b>${f.properties.name}</b><br>${fmt(f.properties.v)} ${L("plans_word")}`)
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
function restyle(){
  if(!mapReady) return;
  const src = map.getSource("muni");
  if(src) src.setData(buildFC());
}

/* ---------- スコープ集計 ---------- */
function scopeAgg(){
  const recs = MUNI.municipalities.filter(m => state.scope === "hokkaido" || m.is_tokachi);
  const agg = { city: scopeName(state.scope), total: 0,
    by_month: {}, aircraft: {}, methods: { "夜間":0,"目視外":0,"物件投下":0,"30m未満":0 }, _isScope: true };
  MUNI.months.forEach(m => agg.by_month[m] = 0);
  recs.forEach(r => {
    agg.total += r.total;
    MUNI.months.forEach(m => agg.by_month[m] += (r.by_month[m] || 0));
    for(const [k,v] of Object.entries(r.aircraft || {})) agg.aircraft[k] = (agg.aircraft[k]||0) + v;
    for(const k of Object.keys(agg.methods)) agg.methods[k] += (r.methods?.[k] || 0);
  });
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
    state.month === "all" ? L("cap_all") : L("cap_month")(monthLabel(state.month));
}

function renderKpis(agg){
  const el = document.getElementById("kpis");
  const periodLabel = state.month === "all" ? L("period_all") : monthLabel(state.month);
  const scopeVal = sumScope(state.scope);
  const top = [...MUNI.municipalities]
    .filter(m => state.scope === "hokkaido" || m.is_tokachi)
    .map(m => ({ city: m.city, v: valueOf(m) }))
    .sort((a,b) => b.v - a.v)[0] || { city: "—", v: 0 };

  const prefEntries = Object.entries(PREF.prefectures);
  const hokRank = prefEntries.findIndex(([k]) => k === "北海道") + 1;

  let card4;
  if(state.scope === "hokkaido"){
    card4 = kpi(L("kpi_rank_val")(hokRank), L("kpi_rank")(prefEntries.length));
  }else{
    const hokTotal = sumScopeAll("hokkaido");
    const tokTotal = sumScopeAll("tokachi");
    const share = hokTotal ? Math.round(tokTotal / hokTotal * 1000) / 10 : 0;
    card4 = kpi(`${share}%`, L("kpi_share"));
  }
  el.innerHTML =
    kpi(plansVal(scopeVal), L("kpi_plans")(periodLabel, scopeShort(state.scope))) +
    kpi(`${fmt(agg.active)} / ${fmt(agg.municipalities)}`, L("kpi_muni")) +
    kpi(`${top.city}`, L("kpi_top")(fmt(top.v), periodLabel)) +
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
  const tokBadge = (!isScope && t.is_tokachi) ? `<span class="badge-tokachi">${L("tok_badge")}</span>` : "";
  title.innerHTML = (isScope ? L("summary_prefix") : "") + t.city + tokBadge;

  const periodVal = isScope ? valueScopeAll(t) : t.total;
  const monVal = state.month === "all" ? null : (t.by_month[state.month] || 0);
  const topAir = Object.entries(t.aircraft||{}).sort((a,b)=>b[1]-a[1])[0];
  const dropRate = t.total ? Math.round((t.methods?.["物件投下"]||0)/t.total*100) : 0;

  let html = `<div class="detail-grid">
    ${kpi(plansVal(periodVal), L("detail_cum"))}
    ${kpi(monVal==null?"—":fmt(monVal), state.month==="all"?L("detail_select_month"):monthLabel(state.month))}
  </div>`;
  html += `<div class="detail-list">`;
  html += row(L("detail_main_aircraft"), topAir ? `${aircraftLabel(topAir[0])} (${fmt(topAir[1])})` : "—");
  html += row(L("detail_spray"), `${dropRate}%`);
  if(!isScope){
    html += row(L("detail_bvlos"), pct(t,"目視外"));
    html += row(L("detail_night"), pct(t,"夜間"));
  }
  html += `</div>`;
  html += `<p class="${isScope ? "placeholder" : "card-note"}" style="margin-top:10px">${isScope ? L("detail_note_scope") : L("detail_note_muni")}</p>`;
  body.innerHTML = html;
}
function valueScopeAll(t){ return Object.values(t.by_month).reduce((a,b)=>a+b,0); }
function row(k,v){ return `<div class="row"><span>${k}</span><strong>${v}</strong></div>`; }
function pct(t,key){ const r = t.total ? Math.round((t.methods?.[key]||0)/t.total*100) : 0; return `${r}%`; }

/* ---------- チャート ---------- */
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }

function buildPrefChart(){
  const entries = Object.entries(PREF.prefectures).slice(0, 12);
  const labels = entries.map(e => prefLabel(e[0]));
  const vals = entries.map(e => e[1]);
  const bg = entries.map(e => e[0] === "北海道" ? getCss("--green-6") : "#c7d6bd");
  destroy("pref");
  charts.pref = new Chart(document.getElementById("prefChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: vals, backgroundColor: bg, borderRadius: 4 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmt(c.parsed.x)} ${L("plans_word")}` } } },
      scales: { x: { ticks: { callback: v => fmt(v) }, grid: { color: "#eef1ec" } }, y: { ticks: { font: { size: 11 } }, grid: { display: false } } },
    },
  });
}

function renderTrend(t){
  const labels = MUNI.months.map(monthShort);
  let datasets;
  if(t._isScope){
    datasets = [
      lineDs(L("trend_hok"), MUNI.months.map(m => MUNI.month_totals.hokkaido[m]||0), getCss("--green-3"), false),
      lineDs(L("trend_tok"), MUNI.months.map(m => MUNI.month_totals.tokachi[m]||0), getCss("--green-6"), true),
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
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} ${L("plans_word")}` } } },
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
    data: { labels: entries.map(e=>aircraftLabel(e[0])),
      datasets: [{ data: entries.map(e=>e[1]), backgroundColor: entries.map((_,i)=>AIR_COLORS[i%AIR_COLORS.length]) }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "55%",
      plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmt(c.parsed)} ${L("plans_word")}` } } } },
  });
}

function renderMethod(t){
  const keys = ["物件投下","目視外","夜間","30m未満"];
  const labels = L("method_labels");
  const total = t.total || 0;
  const vals = keys.map(k => total ? Math.round((t.methods?.[k]||0)/total*1000)/10 : 0);
  destroy("method");
  charts.method = new Chart(document.getElementById("methodChart"), {
    type: "bar",
    data: { labels, datasets: [{ data: vals, backgroundColor: "#66ab3a", borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.x}% (${fmt(t.methods?.[keys[c.dataIndex]]||0)} ${L("plans_word")})` } } },
      scales: { x: { beginAtZero: true, max: 100, ticks: { callback: v => v+"%" }, grid: { color: "#eef1ec" } },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } } } },
  });
}
function blankCanvas(id){ const c = document.getElementById(id); const ctx = c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height); }
