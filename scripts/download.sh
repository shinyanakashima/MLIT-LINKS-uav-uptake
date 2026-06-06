#!/usr/bin/env bash
# 無人航空機飛行計画データ（2025年度）と境界データ（N03 北海道）を data/raw に取得する。
# 出典: 国土交通省 Project LINKS / 国土数値情報
set -euo pipefail

cd "$(dirname "$0")/.."
RAW="data/raw"
mkdir -p "$RAW"

CKAN="https://www.geospatial.jp/ckan/dataset/9db8f0a7-5f94-424b-a978-740cfd58a5fa/resource"
UA="Mozilla/5.0"

echo "== 飛行計画データ（月次 GeoJSON）=="
while IFS=$'\t' read -r fname rid month; do
  [ -z "$fname" ] && continue
  if [ -f "$RAW/$fname" ]; then echo "skip  $fname"; continue; fi
  echo "fetch $fname"
  curl -fSL -m 600 -A "$UA" "$CKAN/$rid/download/$fname" -o "$RAW/$fname"
done < scripts/sources.tsv

echo "== データ仕様書（XLSX）=="
curl -fSL -m 120 -A "$UA" \
  "$CKAN/c8415c0c-3161-4d6f-be89-481485259b1b/download/99_dataspecificationdocument_2025.xlsx" \
  -o "$RAW/99_dataspecificationdocument_2025.xlsx" || echo "  (仕様書の取得に失敗。集計には必須ではありません)"

echo "== 行政区域データ N03（北海道, 2025）=="
N03_ZIP="$RAW/N03_hokkaido.zip"
if [ ! -f "$N03_ZIP" ]; then
  curl -fSL -m 600 -A "$UA" \
    "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_01_GML.zip" -o "$N03_ZIP"
fi
unzip -o "$N03_ZIP" "N03-20250101_01.geojson" -d "$RAW" >/dev/null
echo "完了: $RAW"
