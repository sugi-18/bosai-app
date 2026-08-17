# 地域防災力評価システム

自治会の住民アンケートから防災力を採点し、レーダーチャートと改善提案を自動生成するWebシステムです。
紙とExcelで行っていた「地域防災力評価・改善サイクル」をWeb化したものです。

- 回答画面：住民が40問に答えると、その場で採点・グラフ化・提案表示
- 管理画面：自治会単位の集計と、調査回をまたいだ経年比較
- 保存先：Supabase（PostgreSQL）
- 公開：GitHub Pages（サーバー不要・無料）

---

## ブラウザだけで公開する手順

ターミナル（コマンド入力画面）を使わない方法です。順番に進めてください。

### 手順1　Supabase を用意する

`SETUP.md` の**第1部**をそのまま実行してください。ここだけは先に済ませる必要があります。
終わったときに、次の2つが手元にある状態になります。

- Project URL（`https://xxxxx.supabase.co`）
- anon public キー（`eyJ...` で始まる長い文字列）

### 手順2　GitHub でリポジトリを作る

1. GitHub にログインし、右上の「+」→「New repository」
2. Repository name に **`bosai-app`** と入力
   - 別の名前にする場合は、あとで `vite.config.js` の `base` も同じ名前に直します
3. Public を選ぶ（Private だと GitHub Pages が有料になります）
4. 「Add a README file」には**チェックを入れない**
5. 「Create repository」

### 手順3　ファイルをアップロードする

作られた画面に「uploading an existing file」というリンクがあるので押します。

1. ダウンロードした zip を解凍し、`bosai-app` フォルダを開く
2. **フォルダの中身を全部選択**して、GitHub の点線枠にドラッグ＆ドロップ
   （`bosai-app` フォルダごとではなく、中身を入れます）
3. 下の「Commit changes」を押す

> **`.github` フォルダが見当たらないとき**
> ドットで始まるフォルダは、パソコンの標準設定では隠れています。
> - Windows：エクスプローラーの「表示」→「隠しファイル」にチェック
> - Mac：Finder で `command + shift + .` を押す
>
> それでもうまくいかない場合は、手順7の方法で直接作れます。

### 手順4　接続情報を登録する

リポジトリの「Settings」タブ →左メニュー「Secrets and variables」→「Actions」
→「New repository secret」を押し、次の2つを登録します。**名前は完全一致**させてください。

| Name | Secret |
|---|---|
| `VITE_SUPABASE_URL` | 手順1で控えた Project URL |
| `VITE_SUPABASE_ANON_KEY` | 手順1で控えた anon public キー |

### 手順5　GitHub Pages を有効にする

「Settings」タブ →左メニュー「Pages」
→ Source を **「GitHub Actions」** に変更します。
（「Deploy from a branch」ではありません）

### 手順6　公開されるのを待つ

「Actions」タブを開くと、公開作業が動いています。
緑のチェックが付けば完了です。2〜3分かかります。

公開されたURLはこうなります。

- 回答画面：`https://sugi-18.github.io/bosai-app/?code=iwase2026`
- 管理画面：`https://sugi-18.github.io/bosai-app/admin.html`

`ABC123` の部分は、SETUP.md の 1-3 で決めた合言葉（`access_code`）に置き換えてください。

### 手順7　`.github` フォルダが送れなかった場合

リポジトリの「Add file」→「Create new file」を押し、
ファイル名の欄に次のように**スラッシュ込みで**入力します。

```
.github/workflows/deploy.yml
```

スラッシュを打った時点で、自動的にフォルダとして扱われます。
中身は解凍したフォルダ内の同名ファイルをコピーして貼り付け、「Commit changes」。

`keep-alive.yml` も同じ要領で作ってください。

---

## フォルダの中身

```
bosai-app/
├─ index.html                 回答画面の入口
├─ admin.html                 管理画面の入口
├─ vite.config.js             公開設定（リポジトリ名を変えたらここも直す）
├─ package.json               使用パッケージの一覧
├─ .env.local.example         接続情報の記入例
├─ .gitignore                 GitHubに送らないファイルの指定
├─ README.md                  このファイル
├─ SETUP.md                   詳しい構築手順書
├─ sql/
│   ├─ 01-schema.sql          テーブル・集計ビュー・設問マスタ
│   └─ 02-addendum.sql        回答画面用の追加設定
├─ src/
│   ├─ main.jsx               回答画面の起動
│   ├─ admin-main.jsx         管理画面の起動
│   ├─ BosaiSurvey.jsx        回答画面（Supabase接続済み）
│   ├─ AdminDashboard.jsx     管理・集計画面（※現在はデモデータ表示）
│   └─ lib/
│       └─ bosai-supabase-api.js   データ読み書きの窓口
└─ .github/workflows/
    ├─ deploy.yml             pushすると自動で公開
    └─ keep-alive.yml         Supabaseの自動停止を防ぐ
```

---

## いまの状態と、次にやること

| 機能 | 状態 |
|---|---|
| 回答画面 | Supabase 接続済み。公開すればすぐ使えます |
| 採点・レーダーチャート・提案生成 | 完成 |
| 経年比較・項目別増減 | 画面は完成。**データはまだデモ表示** |
| 管理画面のログイン | **未実装**。次に作る部分 |
| 紙回答の代理入力 | 未実装 |

管理画面は、いまは埋め込みのサンプルデータを表示します。
第1回の27名分は実データ、第2回・第3回は画面確認用のデモ生成データです。
Supabase から実データを読むようにするには、ログイン画面の追加と、
`src/lib/bosai-supabase-api.js` の集計関数への差し替えが必要です。

---

## 運用でつまずきやすい点

**Supabase は1週間使わないと自動停止します。** 年1回の調査だと必ず止まります。
`.github/workflows/keep-alive.yml` が週2回アクセスして防ぎますが、
GitHub は60日間コミットの無いリポジトリの定期実行を止めるため、
2か月に1度は何かコミットするか、Actions タブで再有効化してください。

**無料プランに自動バックアップはありません。** 調査が終わるたびに
管理画面から CSV を書き出し、手元にも保管してください。

**anon キーは公開されます。** これは仕様どおりで、データを守っているのは
SQL で設定した RLS（行レベルセキュリティ）です。
`service_role` キーだけは、絶対にこのリポジトリに置かないでください。
