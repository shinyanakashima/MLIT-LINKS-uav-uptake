#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
無人航空機飛行計画データ（2025年度）から農業（農林水産業）目的の飛行計画を抽出し、
北海道・十勝向けの軽量集計 JSON を生成する。

入力: data/raw/*.geojson（月次・1行=1 Feature の GeoJSON。巨大なため行ストリーム処理）
出力:
  - web/data/agri_municipalities.json  北海道の市区町村別 農業ドローン計画 集計
  - web/data/prefecture_summary.json   全国 都道府県別 農業ドローン計画 件数（文脈用）
  - web/data/meta.json                 生成メタ情報・出典・注記

設計メモ（データの癖への対応）:
  - フィールド名の表記ゆれ（末尾スペース・全角括弧・CJK部首字）は NFKC 正規化 + strip で吸収。
  - 月別集計は「ファイル＝対象月」を信頼単位にする（飛行予定日時の品質が低いため）。
  - 包括申請ノイズ（業務目的フラグが極端に多い行）は除外。
  - 出発地緯度経度は市区町村重心（秘匿化）。粒度は市区町村どまりで扱う。
"""
import json
import os
import sys
import glob
import unicodedata
import datetime
from collections import defaultdict

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "web", "data")
SOURCES_TSV = os.path.join(os.path.dirname(__file__), "sources.tsv")

# 業務目的フラグが何個以上立っていたら「包括申請ノイズ」として除外するか
COMPREHENSIVE_FLAG_THRESHOLD = 8

# --- キー正規化 ---------------------------------------------------------------
def norm(s):
    """NFKC 正規化 + 前後空白除去。全角括弧・CJK部首字・末尾スペースの揺れを吸収。"""
    if s is None:
        return ""
    return unicodedata.normalize("NFKC", str(s)).strip()

# 正規化後のキー名（NFKC 適用済み）
K_AGRI = norm("飛行目的（業務）_農林水産業")
K_PLANID = norm("飛行計画ID_独自（新規）")
K_DEP = norm("出発地")
K_LAT = norm("出発地緯度")
K_LON = norm("出発地経度")
K_KIND = norm("機体の種類")
K_PLAN_START = norm("飛行予定日時_開始")
K_NO = norm("No")

BIZ_PURPOSE_KEYS = [norm(k) for k in [
    "飛行目的（業務）_空撮", "飛行目的（業務）_報道取材", "飛行目的（業務）_警備",
    "飛行目的（業務）_農林水産業", "飛行目的（業務）_測量", "飛行目的（業務）_環境調査",
    "飛行目的（業務）_設備メンテナンス", "飛行目的（業務）_インフラ点検・保守",
    "飛行目的（業務）_資材管理", "飛行目的（業務）_輸送・宅配", "飛行目的（業務）_自然観測",
    "飛行目的（業務）_事故・災害対応等", "飛行目的（業務）_その他",
]]

K_NIGHT = norm("飛行方法_夜間")
K_BVLOS = norm("飛行方法_目視外")
K_DROP = norm("飛行方法_物件投下")
K_NEAR30 = norm("飛行方法_30m")

# 機体種別の短縮ラベル化
def aircraft_label(v):
    v = norm(v)
    if not v:
        return "不明"
    if "マルチローター" in v:
        return "マルチローター"
    if "ヘリコプター" in v:
        return "ヘリコプター"
    if "飛行機" in v:
        return "飛行機"
    if "滑空機" in v:
        return "滑空機"
    if "飛行船" in v:
        return "飛行船"
    return "その他"

def is_one(v):
    return norm(v) in ("1", "1.0")

# --- 十勝管内19市町村 ---------------------------------------------------------
TOKACHI_TOWNS = {
    "帯広市", "音更町", "士幌町", "上士幌町", "鹿追町", "新得町", "清水町", "芽室町",
    "中札内村", "更別村", "大樹町", "広尾町", "幕別町", "池田町", "豊頃町", "本別町",
    "足寄町", "陸別町", "浦幌町",
}

def parse_hokkaido_city(dep):
    """出発地文字列（例: 北海道河西郡更別村 / 北海道帯広市）から
    都道府県・市区町村名を抽出。郡は除去する。北海道以外は None。"""
    dep = norm(dep)
    if not dep.startswith("北海道"):
        return None
    rest = dep[len("北海道"):]
    # 郡があれば除去（"○○郡" まで）
    if "郡" in rest:
        rest = rest.split("郡", 1)[1]
    rest = rest.strip()
    if not rest:
        return None
    return rest  # 例: 更別村, 帯広市

# --- メイン -------------------------------------------------------------------
def load_sources():
    rows = []
    with open(SOURCES_TSV, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            fname, rid, month = line.split("\t")
            rows.append((fname, rid, month))
    return rows

def main():
    sources = load_sources()
    months = sorted({m for _, _, m in sources})

    # 集計コンテナ
    # muni[city] = {...}
    muni = {}
    pref_counts = defaultdict(int)  # 全国 都道府県別 農業件数
    pref_counts_raw = defaultdict(int)  # 都道府県抽出（北海道以外は先頭2-3文字）

    totals = {
        "features_scanned": 0,           # 走査した Feature（飛行エリアのポリゴン）総数
        "agri_features": 0,              # うち農林水産業=1 の Feature 数
        "agri_unique_plans": 0,          # 重複排除後の農業 飛行計画（申請）数
        "agri_excluded_comprehensive": 0,  # 包括申請ノイズとして除外した計画数
        "hokkaido_agri_plans": 0,        # 北海道発の農業 計画数
        "tokachi_agri_plans": 0,         # 十勝管内発の農業 計画数
    }
    # 飛行計画ID は複数の飛行エリア（Feature）に分割されるため、ID 単位で重複排除する。
    # ファイルは月次の時系列順に処理し、初出の月＝新規計画の月として扱う。
    seen_plans = set()
    # 月別の全道・十勝合計
    month_hokkaido = defaultdict(int)
    month_tokachi = defaultdict(int)

    def get_muni(city):
        if city not in muni:
            muni[city] = {
                "city": city,
                "is_tokachi": city in TOKACHI_TOWNS,
                "total": 0,
                "by_month": defaultdict(int),
                "aircraft": defaultdict(int),
                "methods": {"夜間": 0, "目視外": 0, "物件投下": 0, "30m未満": 0},
                "_lat_sum": 0.0, "_lon_sum": 0.0, "_ll_n": 0,
            }
        return muni[city]

    def pref_of(dep):
        dep = norm(dep)
        for p in ("北海道",):
            if dep.startswith(p):
                return p
        # 都府県は3文字（神奈川県/和歌山県/鹿児島県）or 4文字なし。簡易判定。
        for length in (4, 3):
            cand = dep[:length]
            if cand.endswith(("都", "道", "府", "県")):
                return cand
        return None

    for fname, rid, month in sources:
        path = os.path.join(RAW_DIR, fname)
        if not os.path.isfile(path):
            print(f"[WARN] missing {fname}, skip", file=sys.stderr)
            continue
        print(f"[INFO] processing {fname} (month={month}) ...", file=sys.stderr)
        n_file = 0
        with open(path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s.startswith('{ "type": "Feature"') and not s.startswith('{"type": "Feature"'):
                    continue
                if s.endswith(","):
                    s = s[:-1]
                try:
                    feat = json.loads(s)
                except json.JSONDecodeError:
                    continue
                props_raw = feat.get("properties", {})
                # キー正規化
                props = {norm(k): v for k, v in props_raw.items()}
                totals["features_scanned"] += 1
                n_file += 1

                if not is_one(props.get(K_AGRI)):
                    continue
                totals["agri_features"] += 1

                # 飛行計画ID 単位で重複排除（同一計画は複数ポリゴンに分かれて出現）
                plan_id = norm(props.get(K_PLANID))
                if not plan_id or plan_id in seen_plans:
                    continue
                seen_plans.add(plan_id)
                totals["agri_unique_plans"] += 1

                # 包括申請ノイズ除外
                flagcount = sum(1 for k in BIZ_PURPOSE_KEYS if is_one(props.get(k)))
                if flagcount >= COMPREHENSIVE_FLAG_THRESHOLD:
                    totals["agri_excluded_comprehensive"] += 1
                    continue

                dep = props.get(K_DEP)
                pref = pref_of(dep)
                if pref:
                    pref_counts[pref] += 1

                city = parse_hokkaido_city(dep)
                if not city:
                    continue
                totals["hokkaido_agri_plans"] += 1
                month_hokkaido[month] += 1

                m = get_muni(city)
                m["total"] += 1
                m["by_month"][month] += 1
                m["aircraft"][aircraft_label(props.get(K_KIND))] += 1
                if is_one(props.get(K_NIGHT)):
                    m["methods"]["夜間"] += 1
                if is_one(props.get(K_BVLOS)):
                    m["methods"]["目視外"] += 1
                if is_one(props.get(K_DROP)):
                    m["methods"]["物件投下"] += 1
                if is_one(props.get(K_NEAR30)):
                    m["methods"]["30m未満"] += 1
                # 代表座標
                try:
                    lat = float(props.get(K_LAT)); lon = float(props.get(K_LON))
                    if 41 <= lat <= 46 and 139 <= lon <= 149:  # 北海道概略範囲
                        m["_lat_sum"] += lat; m["_lon_sum"] += lon; m["_ll_n"] += 1
                except (TypeError, ValueError):
                    pass

                if m["is_tokachi"]:
                    totals["tokachi_agri_plans"] += 1
                    month_tokachi[month] += 1
        print(f"[INFO]   features in file: {n_file}", file=sys.stderr)

    # --- 出力整形 ---
    os.makedirs(OUT_DIR, exist_ok=True)
    muni_out = []
    for city, m in muni.items():
        lat = round(m["_lat_sum"] / m["_ll_n"], 5) if m["_ll_n"] else None
        lon = round(m["_lon_sum"] / m["_ll_n"], 5) if m["_ll_n"] else None
        muni_out.append({
            "city": city,
            "is_tokachi": m["is_tokachi"],
            "total": m["total"],
            "by_month": {mo: m["by_month"].get(mo, 0) for mo in months},
            "aircraft": dict(sorted(m["aircraft"].items(), key=lambda kv: -kv[1])),
            "methods": m["methods"],
            "lat": lat, "lon": lon,
        })
    muni_out.sort(key=lambda x: -x["total"])

    with open(os.path.join(OUT_DIR, "agri_municipalities.json"), "w", encoding="utf-8") as f:
        json.dump({
            "months": months,
            "municipalities": muni_out,
            "month_totals": {
                "hokkaido": {mo: month_hokkaido.get(mo, 0) for mo in months},
                "tokachi": {mo: month_tokachi.get(mo, 0) for mo in months},
            },
        }, f, ensure_ascii=False, separators=(",", ":"))

    pref_out = dict(sorted(pref_counts.items(), key=lambda kv: -kv[1]))
    with open(os.path.join(OUT_DIR, "prefecture_summary.json"), "w", encoding="utf-8") as f:
        json.dump({"prefectures": pref_out}, f, ensure_ascii=False, separators=(",", ":"))

    meta = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": {
            "project": "国土交通省 Project LINKS",
            "dataset": "無人航空機飛行計画データ（2025年度）",
            "url": "https://www.geospatial.jp/ckan/dataset/links-mujinkoukuukihikoukeikaku-2025_",
            "license": "公共データ利用規約（第1.0版）/ CC BY 4.0 互換",
            "attribution": "出典：国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』を加工して作成",
        },
        "period": {"from": months[0], "to": months[-1], "months": months},
        "method": {
            "filter": "飛行目的（業務）_農林水産業 = 1 の飛行計画（申請）を抽出",
            "counting_unit": "飛行計画ID（独自）単位で重複排除した『計画（申請）件数』。1計画が複数の飛行エリア（ポリゴン）に分割されるため、ポリゴン数ではなく計画数で数える。",
            "month_basis": "計画ID が初めて出現した月次ファイルを『新規計画の月』として扱う（飛行予定日時は品質が低いため集計に用いない）。",
            "comprehensive_excluded": f"業務目的フラグが{COMPREHENSIVE_FLAG_THRESHOLD}個以上の計画（包括申請ノイズ）を除外",
            "granularity": "出発地（市区町村重心・秘匿化）粒度。実飛行ではなく申請ベース。",
        },
        "caveats": [
            "本データは飛行『計画（申請）』であり、実際の飛行・実態を示すものではありません。",
            "紙資料のスキャン→自動抽出によるデータのため、完全性・正確性は保証されません。",
            "座標は市区町村重心レベルに秘匿化されています。個人・事業者の特定はできません。",
        ],
        "totals": totals,
    }
    with open(os.path.join(OUT_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print("\n=== SUMMARY ===", file=sys.stderr)
    for k, v in totals.items():
        print(f"  {k}: {v:,}", file=sys.stderr)
    print(f"  hokkaido municipalities: {len(muni_out)}", file=sys.stderr)
    print(f"  tokachi municipalities present: {sum(1 for x in muni_out if x['is_tokachi'])}", file=sys.stderr)

if __name__ == "__main__":
    main()
