# 地域防災力評価システム 構築手順書

Webシステムを初めて作る方向けに、上から順にそのまま進められる形で書いています。
所要時間の目安は、第1部が30分、第2部が1時間、第3部が30分です。

---

## 全体の考え方

3つの登場人物がいます。

| 役割 | 何をするか | 費用 |
|---|---|---|
| **GitHub リポジトリ** | ソースコードの置き場所。変更履歴も残る | 無料 |
| **GitHub Pages** | 画面のファイル（HTML/JavaScript）を配る | 無料 |
| **Supabase** | データベース・回答の保存・管理者ログイン | 無料枠あり |

大事なのは、**GitHub Pages は計算をしない**という点です。ファイルを配るだけで、
回答の保存も集計も、住民のブラウザから Supabase へ直接やり取りします。
だからレンタルサーバーを借りずに済みます。

---

# 第1部　Supabase の設定

## 1-1　アカウントとプロジェクトを作る

1. https://supabase.com を開き、右上の「Start your project」から GitHub アカウントでサインアップ
2. 「New project」を押し、次を入力

| 項目 | 入れる値 | 補足 |
|---|---|---|
| Name | `bosai-hyoka` など | 後から変更可 |
| Database Password | 自動生成されたものをコピー | **必ず控える**。再表示できません |
| Region | `Northeast Asia (Tokyo)` | 日本からの通信が速くなります |
| Plan | Free | |

3. 「Create new project」を押す。2〜3分待つとダッシュボードが使えるようになります

> **控えておくもの**
> データベースのパスワードは、パスワード管理アプリか、鍵のかかる場所に保管してください。
> 紛失した場合は再発行になります。

## 1-2　テーブルを作る（SQLを流す）

左メニューの「SQL Editor」→「New query」を開きます。

1. `supabase-schema.sql` の中身を全部コピーして貼り付け、右下の「Run」
2. 続けて新しいクエリを開き、`supabase-schema-addendum.sql` も同じように「Run」

`Success. No rows returned` と出れば成功です。
左メニューの「Table Editor」に `associations` `survey_rounds` `respondents`
`answers` `item_master` が並んでいれば、正しく作れています。
`item_master` を開くと、40項目の設問がすでに入っているはずです。

> エラーが出たら、メッセージの最後の行を読んでください。
> 「already exists」なら、すでに作られているという意味なので問題ありません。

## 1-3　自治会と調査回を登録する

SQL Editor で、次を自分の値に書き換えて実行します。

```sql
-- 自治会を1件つくる
insert into associations (name, municipality, household_count)
values ('〇〇自治会', '△△市', 320);

-- 第1回の調査をつくる（access_code は回答URLに載せる合言葉）
insert into survey_rounds (association_id, label, phase, sequence, access_code, status)
select id, '2026年度 第1回（取組み前）', 'baseline', 1, 'ABC123', 'open'
from associations where name = '〇〇自治会';
```

`access_code` は自由な英数字で構いませんが、他人に推測されにくい6〜8文字にしてください。
`status` を `'open'` にした調査回だけが回答を受け付けます。

## 1-4　管理者アカウントを作る

集計画面にログインする人のアカウントです。

1. 左メニュー「Authentication」→「Users」→「Add user」→「Create new user」
2. メールアドレスとパスワードを入力し、`Auto Confirm User` にチェックを入れて作成
3. 作成されたユーザーの行にある UID（長い文字列）をコピー
4. SQL Editor で次を実行

```sql
insert into association_admins (association_id, user_id, role)
select a.id, '<ここにコピーしたUID>', 'owner'
from associations a where a.name = '〇〇自治会';
```

これをしないと、ログインできても集計データが1件も見えません。
「管理画面が空っぽ」というトラブルの原因はほぼこれです。

## 1-5　接続情報を取得する

左メニュー「Project Settings」→「API」に、次の2つがあります。

| 名前 | 用途 |
|---|---|
| **Project URL** | `https://xxxxx.supabase.co` の形 |
| **anon public** | 公開してよい鍵 |
| ~~service_role~~ | **絶対に公開しない鍵** |

### 鍵についての大事な話

`anon` キーは、**公開されることを前提に設計された鍵**です。
GitHub Pages で公開したJavaScriptの中に必ず含まれ、誰でも読めます。これは異常ではありません。

では何がデータを守っているかというと、第1部で流した **RLS（行レベルセキュリティ）** です。
`anon` キーだけを持つ人にできることは、次に限定してあります。

- 設問マスタを読む
- `submit_response` で回答を投函する
- 5名以上回答済みの調査回の「平均点」だけを取る

回答の生データ、氏名欄、他人の点数は一切読めません。

一方 `service_role` キーは RLS を全部無視できる管理者鍵です。
**フロントエンドのコードにも、GitHubにも、絶対に書かないでください。**
このシステムでは使いません。

---

# 第2部　手元のパソコンで動かす

## 2-1　Node.js を入れる

https://nodejs.org/ja から **LTS版** をダウンロードしてインストールします。

インストール後、ターミナル（Windowsなら PowerShell、Macなら ターミナル.app）で確認します。

```bash
node -v
```

`v20.x.x` のようにバージョンが出れば成功です。

## 2-2　プロジェクトを作る

```bash
cd ~/Documents
npm create vite@latest bosai-app -- --template react
cd bosai-app
npm install
npm install @supabase/supabase-js recharts
```

## 2-3　ファイルを配置する

作られたフォルダを、次の形に整えます。

```
bosai-app/
├─ index.html              回答画面の入口
├─ admin.html              管理画面の入口（新規作成）
├─ vite.config.js          公開設定（書き換え）
├─ .env.local              接続情報（新規作成・Gitに入れない）
├─ .gitignore
├─ src/
│   ├─ main.jsx            回答画面の起動コード（書き換え）
│   ├─ admin-main.jsx      管理画面の起動コード（新規作成）
│   ├─ BosaiSurvey.jsx     ← bosai-survey-app.jsx をこの名前で置く
│   ├─ AdminDashboard.jsx  ← bosai-admin-dashboard.jsx をこの名前で置く
│   └─ lib/
│       └─ bosai-supabase-api.js
└─ .github/
    └─ workflows/
        ├─ deploy.yml
        └─ keep-alive.yml
```

`src/App.jsx` と `src/App.css` と `src/index.css` は使わないので削除して構いません。

### index.html

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>地域防災力に関するアンケート</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### admin.html

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>地域防災力評価　管理・集計</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/admin-main.jsx"></script>
  </body>
</html>
```

### src/main.jsx

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import BosaiSurvey from "./BosaiSurvey.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><BosaiSurvey /></React.StrictMode>
);
```

### src/admin-main.jsx

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import AdminDashboard from "./AdminDashboard.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><AdminDashboard /></React.StrictMode>
);
```

### vite.config.js

`base` はリポジトリ名に合わせます。ここを間違えると公開後に真っ白な画面になります。

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "/bosai-app/",          // ← 自分のリポジトリ名に変える
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
```

## 2-4　接続情報を書く

プロジェクトの一番上に `.env.local` というファイルを作ります。

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...（anon public キー）
```

そして `.gitignore` に次の行があることを確認してください（無ければ追記）。

```
node_modules
dist
.env.local
```

## 2-5　動かしてみる

```bash
npm run dev
```

表示されたURLの末尾に、第1部で決めた合言葉を付けて開きます。

- 回答画面：`http://localhost:5173/?code=ABC123`
- 管理画面：`http://localhost:5173/admin.html`

回答画面が表示され、40問答えて送信できれば成功です。
Supabase の Table Editor で `respondents` と `answers` を開くと、
実際にデータが届いているのが確認できます。

---

# 第3部　GitHub Pages で公開する

## 3-1　リポジトリを作る

GitHub で「New repository」を押し、名前を `bosai-app`（`vite.config.js` の `base` と同じ）にします。

公開範囲は **Public** を選んでください。
Private リポジトリで GitHub Pages を使うには有料プランが必要です。
Public にするとソースコードは誰でも読めますが、`.env.local` は Git に含めないので
接続情報は入りません（ビルド後のJavaScriptには含まれますが、1-5で説明したとおり
`anon` キーは公開前提の鍵です）。

作成後、ターミナルで次を実行します。

```bash
git init
git add .
git commit -m "初回コミット"
git branch -M main
git remote add origin https://github.com/<あなたのID>/bosai-app.git
git push -u origin main
```

## 3-2　接続情報を GitHub に登録する

GitHub のリポジトリページで
「Settings」→「Secrets and variables」→「Actions」→「New repository secret」

次の2つを登録します。名前は完全一致させてください。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 3-3　自動公開の設定を置く

`deploy.yml` を `.github/workflows/deploy.yml` に置きます。
main ブランチに push するたびに、自動でビルドして公開する設定です。

## 3-4　Pages を有効にする

「Settings」→「Pages」→ Source を **GitHub Actions** に変更します。
（「Deploy from a branch」ではありません）

## 3-5　公開する

```bash
git add .
git commit -m "GitHub Pages 対応"
git push
```

「Actions」タブで進行状況が見られます。緑のチェックが付けば完了です。
2〜3分かかります。

公開されるURLはこうなります。

- 回答画面：`https://<あなたのID>.github.io/bosai-app/?code=ABC123`
- 管理画面：`https://<あなたのID>.github.io/bosai-app/admin.html`

回答画面のURLを QRコード作成サイトで画像にして、回覧板や掲示板に貼れば運用開始です。

---

# 第4部　運用上の注意

## 4-1　7日間使わないと止まる（最重要）

Supabase の無料プランは、<b>1週間アクセスがないとプロジェクトが自動的に一時停止</b>されます。
年1回の調査だと、次の調査のときに必ず止まっています。

止まっても管理画面から復帰できますし、データが消えるわけではありません。
ただ、住民に配ったQRコードから「つながらない」と言われるのは避けたいところです。

対策として `keep-alive.yml` を `.github/workflows/keep-alive.yml` に置いてください。
週2回、GitHub Actions が設問マスタを1件読みに行くだけの仕組みで、これで停止を防げます。

> **もう一つの注意**：GitHub は、60日間コミットが無いリポジトリの定期実行を自動停止します。
> 2か月に1回はREADMEの更新などで何かコミットするか、
> Actions タブに出る「Enable workflow」を押し直してください。

## 4-2　無料プランにバックアップは無い

無料プランは自動バックアップの保持期間が0日です。
調査が終わったら、必ず手元にデータを取り出してください。

- 管理画面の「CSVをダウンロード」ボタン
- または Supabase の Table Editor で各テーブルを CSV エクスポート

紙とExcelの時代と同じで、**年度ごとのCSVを自分の手元にも保管する**のが安全です。

## 4-3　有料プランを検討する目安

Pro プランは月25ドルです。次のいずれかに当てはまったら検討してください。

- 停止を気にせず常時公開しておきたい
- 自動バックアップが必要
- 複数自治会に広げて、止まると誰かが困る状態になった

数百名・年1〜2回の単一自治会なら、無料枠で十分足ります（データベース500MBに対し、
1000人分の回答でも数MB程度です）。

## 4-4　更新の流れ

一度作ってしまえば、以降はこの繰り返しです。

| やりたいこと | 作業場所 |
|---|---|
| 設問の文言を直す | Supabase の SQL Editor で `item_master` を UPDATE（再ビルド不要） |
| 新しい調査回を始める | `survey_rounds` に1行 INSERT、`status` を `'open'` に |
| 調査を締め切る | `status` を `'closed'` に UPDATE |
| 画面のデザインを変える | ソースを直して `git push`（数分で自動反映） |

---

# 困ったときは

| 症状 | 原因と対処 |
|---|---|
| 公開後、画面が真っ白 | `vite.config.js` の `base` がリポジトリ名と違う。ブラウザで F12 を押し、Console に404が出ていないか確認 |
| 「調査が見つかりません」 | `survey_rounds.status` が `open` でない／`access_code` の綴り違い（大文字小文字も区別されます） |
| 送信すると赤いエラー | Supabase プロジェクトが一時停止中。ダッシュボードで Restore を押す |
| 管理画面にログインできるがデータが0件 | `association_admins` に自分の UID が入っていない（1-4を再確認） |
| Actions タブが赤い | Secrets の名前が違う。`VITE_` の接頭辞まで完全一致が必要 |
| ローカルでは動くが公開版で動かない | Secrets 未登録のままビルドされている。登録後もう一度 push |

エラーメッセージは、**最後の1〜2行に本当の原因が書いてあることがほとんど**です。
分からない文言はそのまま検索するか、聞いてください。
