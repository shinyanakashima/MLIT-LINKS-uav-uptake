#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国土数値情報 行政区域データ（N03, 北海道）から、市区町村別の軽量境界 GeoJSON を生成する。

入力: data/raw/N03-20250101_01.geojson（北海道全市区町村・詳細ポリゴン ~49MB）
出力: web/data/hokkaido_municipalities.geojson（簡略化・市区町村単位に dissolve）

各市区町村のポリゴンを統合（dissolve）し、Douglas-Peucker で簡略化、座標を丸めて軽量化する。
プロパティ:
  name      市区町村名（出発地集計の city と一致させる結合キー）
  code      行政区域コード（N03_007）
  subpref   振興局名（N03_002）
  is_tokachi 十勝総合振興局かどうか
"""
import json
import os
from collections import defaultdict

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

SRC = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "N03-20250101_01.geojson")
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "data", "hokkaido_municipalities.geojson")

SIMPLIFY_TOL = 0.0008   # 度（約80m）
COORD_DECIMALS = 4      # 約11m

TOKACHI_SUBPREF = "十勝総合振興局"

def muni_name(p):
    return (p.get("N03_004") or "") + (p.get("N03_005") or "")

def round_coords(obj):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(obj[0]), COORD_DECIMALS), round(float(obj[1]), COORD_DECIMALS)]
        return [round_coords(x) for x in obj]
    return obj

def main():
    gj = json.load(open(SRC, encoding="utf-8"))
    groups = defaultdict(list)
    meta = {}
    for feat in gj["features"]:
        p = feat["properties"]
        name = muni_name(p)
        if not name:
            continue
        groups[name].append(shape(feat["geometry"]))
        if name not in meta:
            meta[name] = {
                "name": name,
                "code": p.get("N03_007"),
                "subpref": p.get("N03_002"),
                "is_tokachi": p.get("N03_002") == TOKACHI_SUBPREF,
            }

    out_features = []
    for name, geoms in groups.items():
        geom = unary_union(geoms)
        geom = geom.simplify(SIMPLIFY_TOL, preserve_topology=True)
        g = mapping(geom)
        g = {"type": g["type"], "coordinates": round_coords(g["coordinates"])}
        out_features.append({
            "type": "Feature",
            "properties": meta[name],
            "geometry": g,
        })

    out_features.sort(key=lambda f: f["properties"]["code"] or "")
    fc = {"type": "FeatureCollection", "features": out_features}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))

    tok = sum(1 for f in out_features if f["properties"]["is_tokachi"])
    print(f"municipalities: {len(out_features)}  (tokachi: {tok})")
    print(f"output: {OUT}  size: {os.path.getsize(OUT)/1e6:.2f} MB")

if __name__ == "__main__":
    main()
