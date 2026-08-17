import React, { useState, useMemo } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Legend, Tooltip, Cell, ReferenceLine,
} from "recharts";

/* ============================================================
   地域防災力評価システム / 自治会向け 管理・集計ダッシュボード
   Supabase の集計ビュー（v_round_summary / v_item_averages /
   v_item_trend / v_respondent_totals）を読む前提の画面です。
   この試作では、下の loadRounds() が返すデータを差し替えるだけで
   実データに接続できます。
   ============================================================ */

/* ---------- 項目マスタ（DBの item_master と同じ内容） ---------- */
const K = (no, cat, label, type, tip) => ({ section: "koudou", no, cat, label, type, tip });
const S = (no, cat, label, type, tip) => ({ section: "shodou", no, cat, label, type, tip });

const KOUDOU = [
  K(1, "被害拡大防止", "家具転倒防止措置", "c3", "寝室と居間の背の高い家具から順に、L字金具や突っ張り棒で固定する"),
  K(2, "被害拡大防止", "住宅用火災警報器の設置", "c3", "寝室と階段上部の設置状況を確認し、未設置の部屋に追加する"),
  K(3, "被害拡大防止", "住宅用火災警報器の点検・電池交換", "c3", "年1回まとめて点検する日を決め、設置10年経過品は本体ごと交換する"),
  K(4, "被害拡大防止", "感震ブレーカーの設置", "c2", "分電盤タイプまたは簡易タイプの感震ブレーカーを設置し、通電火災を防ぐ"),
  K(5, "被害拡大防止", "家庭用消火器等の設置（使用期限確認）", "c2", "住宅用消火器を1本備え、使用期限を確認する"),
  K(6, "備蓄状況", "食料品（日常備蓄：3日分目安）", "c3", "普段食べる食品を多めに買い、古い順に使うローリングストックに切り替える"),
  K(7, "備蓄状況", "飲料水（日常備蓄：3日分目安）", "c3", "1人1日3L×3日分（9L）を目安に、箱買いして玄関近くに置く"),
  K(8, "備蓄状況", "生活用品（日常備蓄：3日分目安）", "c3", "携帯トイレ・ラジオ・乾電池・常備薬など、水と食料以外の3日分をそろえる"),
  K(9, "備蓄状況", "非常用持出セット", "c2", "持ち出し用リュックを玄関に置き、年1回中身を入れ替える"),
  K(10, "連絡体制", "災害時の家族集合場所の決定", "c2", "一次集合場所と広域避難場所の2か所を家族で決め、紙に書いて全員が持つ"),
  K(11, "連絡体制", "家族それぞれの避難場所・避難ルートの把握", "c2", "日中の居場所からの避難ルートを、家族で一度歩いて確認する"),
  K(12, "連絡体制", "家庭内の連絡手段の確保", "c2", "災害用伝言ダイヤル171を、体験利用日に家族で試す"),
  K(13, "連絡体制", "防災個別計画（マイ・タイムライン）の作成", "c2", "自治会でマイ・タイムライン作成講座を開き、その場で1枚仕上げる"),
  K(14, "知識習得", "防災関連の研修会、講演会等への参加", "c2", "市区町村や消防署の講演会情報を回覧・掲示板で毎回共有する"),
  K(15, "知識習得", "防災関連知識の自発的学習", "c2", "ハザードマップと地区防災計画を読む機会を、広報や回覧でつくる"),
  K(16, "知識習得", "防災関連イベントや体験学習施設等への参加", "c2", "防災体験施設への地域見学会を企画し、家族参加型にする"),
  K(17, "地域防災活動", "地域の防災訓練への参加", "c2", "日程を早期に周知し、短時間・出入り自由の形式を用意する"),
  K(18, "地域防災活動", "地域の防災勉強会・意見交換会への参加", "c2", "班単位の少人数意見交換会を年1回開き、発言しやすい場にする"),
  K(19, "地域防災活動", "避難所運営に対する意識", "c3", "避難所運営ゲーム（HUG）等で役割を体験し、担当者を事前に決めておく"),
  K(20, "地域防災活動", "発災時の自治会活動内容の把握", "c3", "発災時の自治会の役割分担表を1枚にまとめ、全戸配布する"),
];

const SHODOU = [
  S(1, "避難", "防災訓練（避難）への参加", "c2", "避難訓練の日程を複数設定し、参加しやすい時間帯を用意する"),
  S(2, "避難", "近隣の避難場所、避難ルートの把握", "c3", "避難場所とルートを地図にして全戸配布し、実際に歩く機会を設ける"),
  S(3, "避難", "近隣の要支援者の把握", "c3", "班ごとに要支援者名簿を整備し、支援担当を事前に割り当てる"),
  S(4, "避難", "近隣の要支援者の支援", "c3", "要支援者ごとの個別避難計画を作り、避難支援訓練で実際に動いてみる"),
  S(5, "避難", "地域の発災時の取り決め内容の把握", "c3", "安否確認の方法や集合順序など、地域ルールを1枚にまとめて配布する"),
  S(6, "避難", "地域の発災時の取り決め内容の実行", "c3", "安否確認（タオル掲示等）の合図を、実際に全戸で試す訓練を行う"),
  S(7, "避難", "地域の防災倉庫の位置・備品の把握", "c3", "防災倉庫の場所と備品リストを公開し、点検作業を住民参加型にする"),
  S(8, "消火", "防災訓練（消火）への参加", "c2", "消火訓練を短時間の体験型にし、当日参加もできるようにする"),
  S(9, "消火", "消火器使用訓練の実施", "c2", "水消火器を使った実技訓練を年1回、全班で実施する"),
  S(10, "消火", "消火器の使用", "c3", "ピン・ホース・レバーの3動作を、全員が一度は自分の手で体験する"),
  S(11, "消火", "消火用資機材（消火器以外）の使用方法", "c3", "スタンドパイプや可搬ポンプの使用方法を訓練メニューに加える"),
  S(12, "消火", "消火についての基礎知識", "q", "消火栓・防火水槽の位置と、初期消火か避難かの判断基準を学ぶ機会をつくる"),
  S(13, "救出救助", "防災訓練（救出救助）への参加", "c2", "救出救助を訓練メニューに追加し、まず見学だけでも参加できる形にする"),
  S(14, "救出救助", "救助用資機材（ジャッキ・バール）使用訓練の実施", "c2", "消防署の協力を得て、ジャッキ・バールの使用訓練を実施する"),
  S(15, "救出救助", "救助用資機材（ジャッキ・バール）の使用", "c3", "資機材の保管場所を周知し、班ごとに複数名が扱えるようにする"),
  S(16, "救出救助", "救出救助についての基礎知識", "q", "危険箇所の把握、テコの原理、クラッシュ症候群を扱う講習を行う"),
  S(17, "応急救護", "防災訓練（応急救護）への参加", "c2", "普通救命講習を地域単位で受講できるよう、消防署と日程調整する"),
  S(18, "応急救護", "AED使用訓練の実施", "c2", "AED実技を含む救命講習を年1回、地域で開催する"),
  S(19, "応急救護", "AEDの使用", "c3", "地域内のAED設置場所マップを作り、実機で操作を体験する"),
  S(20, "応急救護", "応急救護についての基礎知識", "q", "胸骨圧迫・止血・三角巾の基本を扱う短時間講習を行う"),
];

const K_CATS = ["被害拡大防止", "備蓄状況", "連絡体制", "知識習得", "地域防災活動"];
const S_CATS = ["避難", "消火", "救出救助", "応急救護"];
const AGES = ["40代", "50代", "60代", "70代", "80代以上"];

/* ---------- 第1回：実データ（役員・区長27名） ---------- */
const R1_K = [
  [2.5,2.5,0,0,2.5,5,2.5,2.5,5,2.5,2.5,2.5,2.5,0,0,0,0,0,2.5,2.5,2.5,2.5,0,2.5,0,0,5],
  [0,5,0,2.5,0,5,2.5,2.5,5,0,2.5,5,5,5,0,0,0,5,0,5,5,0,5,5,5,5,5],
  [0,5,0,2.5,0,5,0,2.5,2.5,0,5,5,0,2.5,0,0,0,5,0,2.5,5,0,2.5,0,2.5,5,5],
  [0,0,0,0,0,0,0,0,0,0,0,5,5,0,0,0,0,5,0,5,5,0,5,0,5,5,0],
  [0,5,0,0,0,5,0,5,0,0,5,0,5,0,5,0,0,5,0,5,0,0,5,0,0,5,0],
  [5,5,2.5,2.5,0,5,0,2.5,5,0,5,5,5,2.5,2.5,2.5,2.5,5,2.5,2.5,5,5,2.5,2.5,5,0,0],
  [5,5,2.5,2.5,0,5,0,2.5,5,5,5,5,5,2.5,2.5,2.5,2.5,5,0,2.5,5,2.5,0,2.5,5,0,5],
  [0,5,2.5,2.5,0,2.5,0,2.5,5,0,5,2.5,2.5,2.5,2.5,2.5,2.5,5,0,2.5,5,0,2.5,2.5,5,0,0],
  [0,5,0,0,0,5,5,0,0,0,0,0,0,5,5,0,0,5,0,5,5,0,0,0,5,0,5],
  [0,0,0,0,0,5,0,0,0,0,0,0,5,0,0,0,0,0,0,0,5,0,0,5,0,0,5],
  [0,0,5,0,0,5,0,0,0,5,0,0,5,0,5,0,0,5,0,0,5,0,0,5,0,0,5],
  [0,5,5,5,0,5,5,0,5,5,0,5,5,5,5,0,5,5,5,5,0,0,5,0,5,0,5],
  [0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0],
  [5,5,5,0,0,5,0,0,0,0,0,0,5,0,5,0,0,0,0,0,0,5,0,0,5,5,5],
  [0,5,0,0,0,5,0,0,0,0,0,0,0,5,5,0,0,5,0,0,0,0,0,0,5,0,0],
  [5,5,0,0,5,5,0,5,0,0,0,0,5,0,5,0,0,0,0,0,0,5,0,5,5,5,0],
  [5,5,0,0,5,5,0,0,0,0,0,0,5,0,5,0,0,0,0,0,0,0,0,0,5,5,5],
  [5,0,0,0,0,5,0,0,0,0,0,0,0,0,5,0,0,0,0,0,5,0,0,0,5,5,0],
  [5,5,2.5,0,5,5,2.5,2.5,0,0,0,2.5,5,2.5,2.5,0,0,0,0,0,2.5,0,0,2.5,5,5,5],
  [2.5,5,2.5,0,2.5,5,0,0,0,2.5,0,0,2.5,0,2.5,0,0,0,0,0,5,0,0,0,2.5,5,0],
];
const R1_S = [
  [5,5,0,0,5,5,5,0,0,0,0,0,5,0,5,0,0,0,0,0,0,0,0,5,5,5,5],
  [5,5,5,2.5,2.5,5,2.5,0,5,2.5,5,2.5,5,2.5,2.5,0,2.5,5,5,2.5,2.5,2.5,0,2.5,5,2.5,5],
  [5,0,2.5,0,0,2.5,0,0,0,0,0,2.5,2.5,0,0,0,0,0,2.5,0,0,5,0,2.5,0,2.5,0],
  [2.5,0,2.5,2.5,2.5,5,2.5,2.5,2.5,2.5,2.5,2.5,5,5,2.5,2.5,2.5,0,2.5,2.5,2.5,5,0,2.5,2.5,2.5,5],
  [2.5,0,0,0,0,5,0,0,0,0,0,0,2.5,0,0,0,0,0,0,0,2.5,0,0,0,0,2.5,0],
  [2.5,0,0,0,0,2.5,0,0,0,0,0,0,2.5,0,0,0,0,0,0,0,2.5,0,0,0,0,2.5,0],
  [5,5,5,2.5,2.5,5,0,0,0,5,0,0,5,0,0,0,0,0,0,0,5,0,0,2.5,2.5,5,5],
  [5,5,5,0,5,5,5,5,0,0,0,0,5,0,0,0,0,0,0,0,0,5,0,5,5,5,5],
  [5,5,5,0,5,5,5,5,0,0,0,0,5,0,0,0,0,0,0,0,0,5,0,5,5,5,5],
  [5,5,5,2.5,5,5,5,5,2.5,2.5,5,5,5,5,0,2.5,5,5,2.5,2.5,5,5,2.5,2.5,5,5,5],
  [2.5,0,5,0,0,5,2.5,2.5,0,0,0,0,0,0,0,0,0,0,0,0,2.5,0,0,0,2.5,0,0],
  [2,3,5,1,0,4,2,2,0,3,1,2,2,3,0,0,1,3,0,1,2,1,0,0,0,1,0],
  [0,0,0,0,0,5,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,2.5,2.5,0,0,0,0,0,0,0,0,0,0,0,0,0,5,5,0,0,0,0,0],
  [1,1,3,0,0,2,0,0,0,1,0,1,2,0,0,0,0,0,1,0,1,2,0,0,0,1,0],
  [5,0,5,0,0,5,0,5,0,0,0,0,5,0,0,0,0,0,0,0,0,5,0,5,5,0,0],
  [5,5,5,0,5,5,0,5,0,0,0,0,5,0,0,0,0,0,0,0,0,5,0,5,5,5,5],
  [2.5,2.5,5,0,2.5,2.5,2.5,2.5,0,0,2.5,5,5,5,0,0,0,0,2.5,0,2.5,5,0,2.5,5,2.5,5],
  [4,2,3,0,2,5,1,2,0,0,0,4,3,2,0,0,1,3,0,0,1,3,0,0,0,1,0],
];

/* ---------- 補助 ---------- */
const sum = (a) => a.reduce((x, y) => x + y, 0);
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? r2(sum(a) / a.length) : 0);
const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2));

/** 1段階だけ上げる（設問形式ごとの刻みに従う） */
function stepUp(v, type) {
  if (type === "c2") return 5;
  if (type === "c3") return v === 0 ? 2.5 : 5;
  return Math.min(5, Math.floor(v) + 1);
}
function lcg(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

/**
 * 調査回データの取得。
 * 実運用では getRoundSummaries / getItemAverages / getItemTrend の
 * 戻り値をここに流し込むだけで、以下の画面はそのまま動きます。
 */
function loadRounds() {
  const n = R1_K[0].length;
  const base = [];
  for (let i = 0; i < n; i++) {
    base.push({
      code: `A${String(i + 1).padStart(3, "0")}`,
      age: AGES[i % AGES.length],
      k: R1_K.map((row) => row[i]),
      s: R1_S.map((row) => row[i]),
    });
  }
  const round1 = { id: "r1", label: "第1回（2024年度）", date: "2024-06", real: true, people: base };

  // 第2回・第3回はUI確認用のデモ生成データ。実データではありません。
  const grow = (prev, seed, extra, strength) => {
    const rnd = lcg(seed);
    const people = prev.people.map((p) => ({
      code: p.code, age: p.age,
      k: p.k.map((v, i) => (v < 5 && rnd() < strength * (1 - v / 6) ? stepUp(v, KOUDOU[i].type) : v)),
      s: p.s.map((v, i) => (v < 5 && rnd() < strength * 1.15 * (1 - v / 6) ? stepUp(v, SHODOU[i].type) : v)),
    }));
    for (let j = 0; j < extra; j++) {
      const src = people[Math.floor(rnd() * people.length)];
      people.push({
        code: `N${seed}${j}`, age: AGES[Math.floor(rnd() * AGES.length)],
        k: src.k.map((v) => (rnd() < 0.3 ? Math.max(0, v - 2.5) : v)),
        s: src.s.map((v) => (rnd() < 0.3 ? Math.max(0, v - 2.5) : v)),
      });
    }
    return people;
  };
  const round2 = { id: "r2", label: "第2回（2025年度）", date: "2025-06", demo: true, people: grow(round1, 7, 9, 0.42) };
  const round3 = { id: "r3", label: "第3回（2026年度）", date: "2026-06", demo: true, people: grow(round2, 23, 12, 0.36) };
  return [round1, round2, round3];
}

const ROUNDS = loadRounds();
const HOUSEHOLDS = 62; // 対象世帯数（回答率の分母）

function roundStats(round) {
  const kAvg = KOUDOU.map((_, i) => mean(round.people.map((p) => p.k[i])));
  const sAvg = SHODOU.map((_, i) => mean(round.people.map((p) => p.s[i])));
  return {
    kAvg, sAvg,
    kTotal: r2(sum(kAvg)), sTotal: r2(sum(sAvg)),
    total: r2(sum(kAvg) + sum(sAvg)),
    n: round.people.length,
    rate: r2((round.people.length / HOUSEHOLDS) * 100),
  };
}

/* ---------- スタイル ---------- */
const CSS = `
.dz{--ink:#16211c;--sub:#5b6b62;--line:#d3dbd5;--paper:#eef2ee;--green:#00703c;--green-d:#004f2a;
 --green-l:#e3efe8;--red:#c1272d;--amber:#e0a12c;--amber-l:#fbf1dd;
 color:var(--ink);background:var(--paper);font-size:16px;line-height:1.7;min-height:100%;
 font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",YuGothic,"Noto Sans JP",Meiryo,sans-serif;}
.dz *{box-sizing:border-box;}
.dz-wrap{max-width:1080px;margin:0 auto;padding:0 16px 72px;}
.dz-head{background:var(--green-d);color:#fff;border-bottom:6px solid var(--amber);}
.dz-head-in{max-width:1080px;margin:0 auto;padding:18px 16px;}
.dz-eyebrow{font-size:11px;letter-spacing:.3em;opacity:.72;margin:0 0 4px;}
.dz-title{font-size:24px;font-weight:900;margin:0;letter-spacing:.02em;}
.dz-sel{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px;}
.dz-sel label{font-size:12px;letter-spacing:.14em;opacity:.8;display:block;margin-bottom:4px;}
.dz-sel select{font:inherit;font-size:15px;padding:9px 12px;border-radius:6px;border:0;background:#fff;color:var(--ink);min-width:190px;}
.dz-card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;margin-top:16px;}
.dz-card h2{font-size:18px;font-weight:900;margin:0 0 2px;}
.dz-card h3{font-size:15px;font-weight:800;margin:20px 0 6px;}
.dz-muted{color:var(--sub);font-size:13px;margin:0;}
.dz-band{display:flex;gap:12px;align-items:baseline;background:var(--green);color:#fff;padding:9px 14px;border-radius:4px;margin-top:22px;}
.dz-band b{font-size:17px;font-weight:900;letter-spacing:.04em;}
.dz-band span{font-size:12px;opacity:.85;}
.dz-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:2px;background:var(--line);
 border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-top:16px;}
.dz-kpi{background:#fff;padding:16px;}
.dz-kpi .k{font-size:11px;letter-spacing:.16em;color:var(--sub);}
.dz-kpi .v{font-size:34px;font-weight:900;line-height:1.15;font-variant-numeric:tabular-nums;}
.dz-kpi .u{font-size:14px;color:var(--sub);font-weight:700;margin-left:2px;}
.dz-kpi .d{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;}
.dz-kpi.hi{background:var(--green-d);color:#fff;}
.dz-kpi.hi .k,.dz-kpi.hi .u{color:rgba(255,255,255,.72);}
.up{color:var(--green);}.down{color:var(--red);}
.dz-kpi.hi .up{color:#8ee0b0;}.dz-kpi.hi .down{color:#ffb3b3;}
.dz-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-top:16px;}
.dz-chart{background:#fff;border:1px solid var(--line);border-radius:6px;padding:12px 8px 6px;}
.dz-chart h3{text-align:center;font-size:15px;margin:4px 0 0;}
.dz-table{width:100%;border-collapse:collapse;font-size:14px;}
.dz-table th,.dz-table td{border:1px solid var(--line);padding:7px 10px;text-align:left;}
.dz-table th{background:var(--green-l);font-weight:800;font-size:13px;}
.dz-table td.n{text-align:right;font-variant-numeric:tabular-nums;}
.dz-scroll{overflow-x:auto;margin-top:10px;}
.dz-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;}
.dz-row{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);align-items:flex-start;}
.dz-row:last-child{border-bottom:0;}
.dz-tag{flex:none;min-width:58px;text-align:center;padding:3px 6px;border-radius:4px;color:#fff;
 font-weight:900;font-size:13px;font-variant-numeric:tabular-nums;}
.dz-row b{display:block;font-size:14px;line-height:1.45;}
.dz-row p{margin:3px 0 0;font-size:14px;}
.dz-row .sc{font-size:12px;color:var(--sub);font-variant-numeric:tabular-nums;}
.dz-note{background:var(--amber-l);border-left:5px solid var(--amber);padding:10px 14px;border-radius:0 6px 6px 0;font-size:14px;margin-top:16px;}
.dz-btn{appearance:none;border:0;border-radius:6px;font:inherit;font-size:15px;font-weight:800;
 padding:12px 22px;cursor:pointer;background:var(--green);color:#fff;}
.dz-btn:hover{background:var(--green-d);}
.dz-btn.ghost{background:#fff;color:var(--green-d);border:2px solid var(--green);}
.dz-btn:focus-visible,.dz-sel select:focus-visible{outline:3px solid var(--amber);outline-offset:2px;}
.dz-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;}
@media (max-width:600px){.dz-kpi .v{font-size:27px;}.dz-title{font-size:19px;}}
@media (prefers-reduced-motion:reduce){.dz *{transition:none!important;animation:none!important;}}
`;

/* ---------- 部品 ---------- */
function Kpi({ label, value, unit, delta, hi }) {
  return (
    <div className={`dz-kpi${hi ? " hi" : ""}`}>
      <div className="k">{label}</div>
      <div className="v">{value}{unit && <span className="u"> {unit}</span>}</div>
      {delta !== undefined && delta !== null && (
        <div className={`d ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
          {delta === 0 ? "増減なし" : `${fmtDelta(delta)} 前回比`}
        </div>
      )}
    </div>
  );
}

function CompareRadar({ title, items, a, b, aName, bName }) {
  const data = items.map((it, i) => ({ no: String(it.no), label: it.label, [aName]: a[i], [bName]: b[i] }));
  return (
    <div className="dz-chart">
      <h3>{title}</h3>
      <div style={{ width: "100%", height: 330 }}>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="#d3dbd5" />
            <PolarAngleAxis dataKey="no" tick={{ fontSize: 11, fill: "#5b6b62" }} />
            <PolarRadiusAxis domain={[0, 5]} tickCount={6} angle={90} tick={{ fontSize: 10, fill: "#9aa8a0" }} />
            <Tooltip
              formatter={(v, n) => [`${r2(v)} 点`, n]}
              labelFormatter={(l) => { const d = data.find((x) => x.no === l); return `${l}. ${d ? d.label : ""}`; }}
              contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d3dbd5" }} />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            <Radar name={aName} dataKey={aName} stroke="#9aa8a0" fill="#9aa8a0" fillOpacity={0.16} strokeWidth={2} />
            <Radar name={bName} dataKey={bName} stroke="#00703c" fill="#00703c" fillOpacity={0.3} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ============================================================ */
export default function AdminDashboard() {
  const [baseId, setBaseId] = useState(ROUNDS[ROUNDS.length - 2].id);
  const [cmpId, setCmpId] = useState(ROUNDS[ROUNDS.length - 1].id);

  const baseRound = ROUNDS.find((r) => r.id === baseId);
  const cmpRound = ROUNDS.find((r) => r.id === cmpId);
  const A = useMemo(() => roundStats(baseRound), [baseRound]);
  const B = useMemo(() => roundStats(cmpRound), [cmpRound]);

  /* 総合得点の推移 */
  const trend = useMemo(() => ROUNDS.map((r) => {
    const st = roundStats(r);
    return { name: r.label.replace(/（.*/, ""), 防災行動力: st.kTotal, 初動対応力: st.sTotal, 総合: st.total, n: st.n };
  }), []);

  /* 項目別の増減 */
  const deltas = useMemo(() => {
    const all = [
      ...KOUDOU.map((it, i) => ({ ...it, prev: A.kAvg[i], now: B.kAvg[i], d: r2(B.kAvg[i] - A.kAvg[i]) })),
      ...SHODOU.map((it, i) => ({ ...it, prev: A.sAvg[i], now: B.sAvg[i], d: r2(B.sAvg[i] - A.sAvg[i]) })),
    ];
    return { up: [...all].sort((x, y) => y.d - x.d).slice(0, 5), down: [...all].sort((x, y) => x.d - y.d).slice(0, 5), all };
  }, [A, B]);

  /* 残る重点課題（比較回で2.0点未満） */
  const focus = useMemo(
    () => deltas.all.filter((x) => x.now < 2.0).sort((a, b) => a.now - b.now).slice(0, 8),
    [deltas]
  );

  /* 区分別 */
  const catRows = useMemo(() => {
    const build = (items, aArr, bArr, cats) => cats.map((c) => {
      const idx = items.map((it, i) => (it.cat === c ? i : -1)).filter((i) => i >= 0);
      const pa = mean(idx.map((i) => aArr[i]));
      const pb = mean(idx.map((i) => bArr[i]));
      return { cat: c, prev: pa, now: pb, d: r2(pb - pa) };
    });
    return [...build(KOUDOU, A.kAvg, B.kAvg, K_CATS), ...build(SHODOU, A.sAvg, B.sAvg, S_CATS)];
  }, [A, B]);

  /* 年代別の総合得点 */
  const byAge = useMemo(() => AGES.map((age) => {
    const g = cmpRound.people.filter((p) => p.age === age);
    return { age, 平均総合点: g.length ? r2(mean(g.map((p) => sum(p.k) + sum(p.s)))) : 0, n: g.length };
  }), [cmpRound]);

  const exportCsv = () => {
    const head = ["区分", "No", "項目", baseRound.label, cmpRound.label, "増減"];
    const rows = deltas.all.map((x) => [
      x.section === "koudou" ? "防災行動力" : "初動対応力",
      x.no, x.label, x.prev.toFixed(2), x.now.toFixed(2), x.d.toFixed(2),
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `地域防災力_経年比較_${baseRound.id}_${cmpRound.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="dz">
      <style>{CSS}</style>

      <header className="dz-head">
        <div className="dz-head-in">
          <p className="dz-eyebrow">地域防災力評価・改善サイクル</p>
          <h1 className="dz-title">〇〇自治会　管理・集計</h1>
          <div className="dz-sel">
            <div>
              <label htmlFor="base">基準にする回</label>
              <select id="base" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                {ROUNDS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cmp">比較する回</label>
              <select id="cmp" value={cmpId} onChange={(e) => setCmpId(e.target.value)}>
                {ROUNDS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      </header>

      <main className="dz-wrap">
        {(baseRound.demo || cmpRound.demo) && (
          <p className="dz-note">
            第1回は提供された実データ（役員・区長27名）です。第2回・第3回は画面の動きを確認するための<b>デモ生成データ</b>で、実際の調査結果ではありません。
          </p>
        )}

        <div className="dz-kpis">
          <Kpi label="回答数" value={B.n} unit="名" delta={B.n - A.n} />
          <Kpi label="回答率" value={B.rate.toFixed(1)} unit="%" delta={r2(B.rate - A.rate)} />
          <Kpi label="防災行動力" value={B.kTotal.toFixed(1)} unit="/100" delta={r2(B.kTotal - A.kTotal)} />
          <Kpi label="初動対応力" value={B.sTotal.toFixed(1)} unit="/100" delta={r2(B.sTotal - A.sTotal)} />
          <Kpi label="総合得点" value={B.total.toFixed(1)} unit="/200" delta={r2(B.total - A.total)} hi />
        </div>

        <div className="dz-band"><b>経年比較</b><span>{baseRound.label} → {cmpRound.label}</span></div>

        <div className="dz-chart" style={{ marginTop: 16, padding: "16px 12px 8px" }}>
          <h3>調査回ごとの平均得点の推移</h3>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 16, right: 20, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#e6ebe7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                <YAxis domain={[0, 200]} tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d3dbd5" }}
                  formatter={(v, n) => [`${v} 点`, n]} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line type="monotone" dataKey="総合" stroke="#004f2a" strokeWidth={3} dot={{ r: 5 }} />
                <Line type="monotone" dataKey="防災行動力" stroke="#00703c" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="初動対応力" stroke="#e0a12c" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dz-charts">
          <CompareRadar title="防災行動力" items={KOUDOU} a={A.kAvg} b={B.kAvg}
            aName={baseRound.label} bName={cmpRound.label} />
          <CompareRadar title="初動対応力" items={SHODOU} a={A.sAvg} b={B.sAvg}
            aName={baseRound.label} bName={cmpRound.label} />
        </div>

        <div className="dz-card">
          <h2>区分別の変化</h2>
          <p className="dz-muted">5点満点。取り組みの効果が区分単位でどう出たかを見ます。</p>
          <div className="dz-scroll">
            <table className="dz-table">
              <thead>
                <tr><th>区分</th><th style={{ width: 100 }}>{baseRound.label}</th>
                  <th style={{ width: 100 }}>{cmpRound.label}</th><th style={{ width: 90 }}>増減</th><th>状態</th></tr>
              </thead>
              <tbody>
                {catRows.map((r) => (
                  <tr key={r.cat}>
                    <td>{r.cat}</td>
                    <td className="n">{r.prev.toFixed(2)}</td>
                    <td className="n">{r.now.toFixed(2)}</td>
                    <td className={`n ${r.d > 0 ? "up" : r.d < 0 ? "down" : ""}`} style={{ fontWeight: 800 }}>{fmtDelta(r.d)}</td>
                    <td>{r.now < 1.5 ? "重点課題" : r.now < 2.5 ? "要強化" : r.now < 3.5 ? "標準" : "良好"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dz-card">
          <h2>項目別の増減</h2>
          <div className="dz-two" style={{ marginTop: 10 }}>
            <div>
              <h3 style={{ marginTop: 0 }}>伸びた項目</h3>
              {deltas.up.map((x) => (
                <div className="dz-row" key={`u${x.section}${x.no}`}>
                  <span className="dz-tag" style={{ background: "#00703c" }}>{fmtDelta(x.d)}</span>
                  <span><b>{x.cat}／{x.no}. {x.label}</b>
                    <span className="sc">{x.prev.toFixed(2)} → {x.now.toFixed(2)} 点</span></span>
                </div>
              ))}
            </div>
            <div>
              <h3 style={{ marginTop: 0 }}>下がった・伸びていない項目</h3>
              {deltas.down.map((x) => (
                <div className="dz-row" key={`d${x.section}${x.no}`}>
                  <span className="dz-tag" style={{ background: x.d < 0 ? "#c1272d" : "#9aa8a0" }}>{fmtDelta(x.d)}</span>
                  <span><b>{x.cat}／{x.no}. {x.label}</b>
                    <span className="sc">{x.prev.toFixed(2)} → {x.now.toFixed(2)} 点</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dz-band"><b>次年度への提案</b><span>{cmpRound.label}で2.0点未満の項目</span></div>
        <div className="dz-card">
          {focus.length === 0
            ? <p className="dz-muted">2.0点未満の項目はありません。しきい値を上げて点検してください。</p>
            : focus.map((x, i) => (
              <div className="dz-row" key={`f${x.section}${x.no}`}>
                <span className="dz-tag" style={{ background: x.now < 1 ? "#c1272d" : "#e0a12c" }}>{i + 1}</span>
                <span>
                  <b>{x.cat}／{x.no}. {x.label}</b>
                  <span className="sc">現状 {x.now.toFixed(2)} 点（前回比 {fmtDelta(x.d)}）</span>
                  <p>{x.tip}</p>
                </span>
              </div>
            ))}
        </div>

        <div className="dz-card">
          <h2>年代別の総合得点</h2>
          <p className="dz-muted">{cmpRound.label}・n={B.n}。世代で差が出る場合、周知の手段を分ける判断材料になります。</p>
          <div style={{ width: "100%", height: 240, marginTop: 8 }}>
            <ResponsiveContainer>
              <BarChart data={byAge} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#e6ebe7" vertical={false} />
                <XAxis dataKey="age" tick={{ fontSize: 13 }} />
                <YAxis domain={[0, 200]} tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d3dbd5" }}
                  formatter={(v, n, p) => [`${v} 点（${p.payload.n}名）`, "平均総合点"]} />
                <ReferenceLine y={B.total} stroke="#e0a12c" strokeDasharray="4 4"
                  label={{ value: "全体平均", position: "right", fontSize: 11, fill: "#8a6a1e" }} />
                <Bar dataKey="平均総合点" radius={[4, 4, 0, 0]}>
                  {byAge.map((d) => <Cell key={d.age} fill={d.平均総合点 >= B.total ? "#00703c" : "#9aa8a0"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dz-card">
          <h2>書き出し</h2>
          <p className="dz-muted">全40項目の平均点と増減を含むCSVです。報告書への貼り付けにそのまま使えます。</p>
          <div className="dz-actions">
            <button className="dz-btn" onClick={exportCsv}>経年比較CSVをダウンロード</button>
          </div>
        </div>
      </main>
    </div>
  );
}
