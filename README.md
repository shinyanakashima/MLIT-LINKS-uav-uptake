# 農業ドローン活用マップ（十勝／北海道）

国土交通省 Project LINKS が公開する **無人航空機飛行計画データ（2025年度）** をもとに、
**農林水産業を目的としたドローンの飛行計画（申請）** を市区町村別に集計し、北海道・十勝地域を中心に地図で可視化する静的 Web アプリケーションです。

🌐 **公開サイト**: https://shinyanakashima.github.io/MLIT-LINKS-uav-uptake/

*An interactive choropleth map of agricultural drone flight-plan applications in Hokkaido / Tokachi, Japan, built from MLIT Project LINKS open data. The UI is available in Japanese and English.*

> [!IMPORTANT]
> このマップが示すのは飛行「**計画（申請）**」であり、実際の飛行や運用実態ではありません。
> 元データは紙資料のスキャンからの自動抽出のため、完全性・正確性は保証されません。
> 位置情報は市区町村の重心レベルに秘匿化されており、個人・事業者は特定できません。

## このアプリでわかること

地域ごとの「農業ドローンの普及度（＝飛行計画の申請件数）」を地図とグラフで比較できます。
JA・自治体・農業法人・農業 IT 関係者などが、地域の傾向把握や連携検討の参考にすることを想定しています。

集計期間 **2024年7月〜2025年6月** の主な結果:

| 指標 | 件数 |
|---|---:|
| 走査した飛行計画（全用途・全国、ポリゴン単位） | 2,971,260 |
| 農林水産業目的のポリゴン | 1,229,417 |
| 農林水産業目的の飛行計画（計画ID単位で重複排除） | 243,290 |
| ― うち北海道発 | 18,833（都道府県別で**全国1位**） |
| ― うち十勝管内発 | 1,690 |

- 農業目的の飛行計画件数は、**北海道が都道府県別で全国1位**。
- 月別では融雪後の春〜初夏（5〜6月）に新規計画が集中し、**農薬散布シーズンの季節性**がはっきり表れます。

## 主な機能

- 市区町村別のコロプレス地図（**十勝管内／北海道全体** を切替）
- 対象月フィルタ（全期間の累計／各月）
- 市区町村クリックで詳細表示（累計件数・主な機体種別・散布関連の飛行方法比率）
- 月別推移グラフ（北海道／十勝、または選択した市区町村）
- 機体の種類、飛行方法（物件投下＝散布／目視外／夜間／30m未満接近）の内訳
- 全国 都道府県ランキング（北海道を強調表示）
- 背景地図の切替（地理院タイルの**標準地図／衛星写真**）
- **日本語／英語** の表示切替

## 技術構成

- 完全な静的サイト（ビルド工程なし）。`web/` をそのまま配信するだけで動作します。
- 地図: [MapLibre GL JS]、背景: [地理院タイル]（API キー不要）。
- グラフ: [Chart.js]。
- 外部 CDN に依存しないよう、ライブラリは `web/vendor/` に同梱しています。
- 公開データ（集計 JSON + 簡略化境界 GeoJSON）は合計でも数 MB 程度に抑えています。

## ディレクトリ構成

```
web/                       公開する静的サイト（これだけで動作）
  index.html
  css/style.css
  js/app.js                アプリ本体（地図・集計表示・i18n）
  vendor/                  MapLibre GL JS / Chart.js（同梱）
  data/                    生成済みの軽量データ（リポジトリに同梱）
    agri_municipalities.json        市区町村別の農業飛行計画 集計
    hokkaido_municipalities.geojson 簡略化した市区町村境界
    prefecture_summary.json         都道府県別の件数
    meta.json                       生成メタ情報・出典・注記
scripts/                   データ生成パイプライン（再現用）
  download.sh              生データの取得（飛行計画 GeoJSON / N03 境界 / 仕様書）
  sources.tsv              飛行計画データの一覧（ファイル名・CKAN リソースID・対象月）
  preprocess.py            飛行計画 → 市区町村別の軽量集計 JSON を生成
  build_boundaries.py      行政区域データ N03 → 簡略化境界 GeoJSON を生成
  verify_web.mjs           Playwright によるレンダリング検証
.github/workflows/deploy.yml  GitHub Pages への自動デプロイ
```

`web/data/` の生成済みデータはリポジトリに含まれているため、**取得・前処理を行わなくてもサイトは動作します**。
生データ（`data/raw/`、合計約 9GB）は再取得可能なため Git 管理対象外です。

## ローカルで動かす

```bash
# 静的ファイルを配信するだけ（生成済みデータを同梱しているため前処理は不要）
python3 -m http.server --directory web 8000
# → http://localhost:8000
```

## データを再生成する（任意）

最新データへの更新や集計条件の変更を行う場合の手順です。

```bash
# 1. 生データを取得（約9GB。回線状況により時間がかかります）
bash scripts/download.sh

# 2. 飛行計画 → 市区町村別 集計 JSON を生成
pip install shapely
python3 scripts/preprocess.py

# 3. 行政区域データ → 簡略化境界 GeoJSON を生成
python3 scripts/build_boundaries.py

# 4. レンダリング検証（任意。Playwright が必要）
npm install && npx playwright install chromium
node scripts/verify_web.mjs
```

## 集計方法（データの特性への対応）

元データには扱いに注意が必要な特性があり、`scripts/preprocess.py` で以下のように処理しています。

- **計数単位**: 1件の飛行計画は複数の飛行エリア（ポリゴン）に分割されて格納されます（平均で1計画あたり約6.5ポリゴン）。
  そのため**飛行計画ID 単位で重複排除**し、「計画（申請）件数」として数えます。
- **フィールド名の表記ゆれ**: 末尾の空白、全角括弧、CJK 部首字（例: `機体認証(⼀種)`）などの揺れを
  Unicode 正規化（NFKC）+ トリムで吸収してから参照します。
- **日時の品質**: 「飛行予定日時」は品質が低いため時系列集計には用いず、
  各計画 ID が**最初に出現した月次ファイル**を「新規計画の月」として扱います。
- **包括申請ノイズ**: 業務目的フラグが極端に多い計画（しきい値 8 以上）は集計から除外します。
- **粒度**: 出発地の座標は市区町村重心レベルに秘匿化されているため、集計は市区町村単位までとし、
  個人・事業者を特定するような二次加工は行いません。

詳細な集計条件・件数・注記は [`web/data/meta.json`](web/data/meta.json) に出力されます。

## デプロイ

静的サイトのため GitHub Pages で公開できます。`.github/workflows/deploy.yml` が `web/` を配信します。
`main` への push、または Actions の手動実行（workflow_dispatch）でデプロイされます。

## データソースとライセンス

- **飛行計画データ**: 国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』
  <https://www.geospatial.jp/ckan/dataset/links-mujinkoukuukihikoukeikaku-2025_>
- **行政区域境界**: 国土交通省 国土数値情報（行政区域データ N03, 2025年）
- **背景地図**: 地理院タイル（標準地図／衛星写真〔シームレス空中写真〕）

ライセンスは **公共データ利用規約（第1.0版）**（CC BY 4.0 互換）。商用利用可、出典表記が必要です。

> 出典：国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』を加工して作成

[MapLibre GL JS]: https://maplibre.org/
[地理院タイル]: https://maps.gsi.go.jp/development/ichiran.html
[Chart.js]: https://www.chartjs.org/
