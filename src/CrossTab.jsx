/**
 * 地域防災力評価システム / 属性別クロス集計
 *
 * 置き場所： src/CrossTab.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * 平均点は「地域全体で70点」までしか教えてくれません。
 * この画面は、その平均の中に隠れている層ごとの差を出します。
 *   例）居住年数1年未満の世帯だけ「地域の取り決めの把握」が極端に低い
 *
 * 前提：sql/03-improvement.sql を Supabase で実行済みであること
 *       （v_respondent_attributes ビューを使います）
 */
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/bosai-supabase-api";

const r2 = (x) => Math.round(x * 100) / 100;
const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1));

/** 層が小さすぎると平均が1人で大きく振れるため、参考値として扱う目安 */
const SMALL_N = 5;
/** 設問ごとの差を見るとき、この人数に満たない層は比較から外す */
const MIN_ITEM_N = 3;

const NA = "未記入";

const AXES = [
  { key: "member_type",     label: "立場",     order: ["住民", "役員・区長", "その他"] },
  { key: "age_band",        label: "年代",     order: ["20代", "30代", "40代", "50代", "60代", "70代", "80代以上"] },
  { key: "household_size",  label: "世帯人数", order: ["単身", "2人", "3人", "4人", "5人", "6人", "7人以上"] },
  { key: "residence_years", label: "居住年数", order: ["1年未満", "1〜4年", "5〜9年", "10〜19年", "20年以上"] },
  { key: "sex",             label: "性別",     order: ["男性", "女性", "その他"] },
];

const METRICS = [
  { key: "grand_total",  label: "総合得点",   max: 200 },
  { key: "koudou_total", label: "防災行動力", max: 100 },
  { key: "shodou_total", label: "初動対応力", max: 100 },
];

/* ------------------------------------------------------------
   データ取得
   ------------------------------------------------------------ */
async function fetchPeople(roundId) {
  const { data, error } = await supabase
    .from("v_respondent_attributes")
    .select("respondent_id,member_type,age_band,sex,household_size,residence_years," +
            "koudou_total,shodou_total,grand_total")
    .eq("round_id", roundId);
  if (error) throw error;
  return data ?? [];
}

/** 1000行ずつ繰り返し取得する（40項目×26名で既に1000行を超えるため） */
async function fetchAnswers(roundId) {
  const CHUNK = 1000;
  let from = 0;
  let out = [];
  for (;;) {
    const { data, error } = await supabase
      .from("answers")
      .select("respondent_id,section,item_no,score,respondents!inner(round_id)")
      .eq("respondents.round_id", roundId)
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    out = out.concat(data ?? []);
    if (!data || data.length < CHUNK) break;
    from += CHUNK;
  }
  return out;
}

/* ============================================================
   本体
   ============================================================ */
export default function CrossTab({ roundId, roundLabel, master }) {
  const [people, setPeople] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [axisKey, setAxisKey] = useState("age_band");
  const [metricKey, setMetricKey] = useState("grand_total");
  const [hideSmall, setHideSmall] = useState(false);

  const axis = AXES.find((a) => a.key === axisKey);
  const metric = METRICS.find((m) => m.key === metricKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!roundId) { setPeople([]); setAnswers([]); return; }
      setLoading(true); setErr("");
      try {
        const [p, a] = await Promise.all([fetchPeople(roundId), fetchAnswers(roundId)]);
        if (cancelled) return;
        setPeople(p); setAnswers(a);
      } catch (e) {
        if (!cancelled) setErr(e.message ?? String(e));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [roundId]);

  /* ---- 層の一覧（人数の多い順ではなく、意味のある順に固定） ---- */
  const segments = useMemo(() => {
    if (people.length === 0) return [];
    const seen = new Map();
    people.forEach((p) => {
      const v = (p[axisKey] ?? "").trim() || NA;
      seen.set(v, (seen.get(v) ?? 0) + 1);
    });
    const named = axis.order.filter((o) => seen.has(o));
    const extra = [...seen.keys()].filter((k) => k !== NA && !axis.order.includes(k));
    const list = [...named, ...extra];
    if (seen.has(NA)) list.push(NA);
    return list.map((name) => {
      const rows = people.filter((p) => ((p[axisKey] ?? "").trim() || NA) === name);
      const vals = rows.map((p) => Number(p[metricKey] ?? 0));
      return {
        name,
        n: rows.length,
        avg: vals.length ? r2(vals.reduce((x, y) => x + y, 0) / vals.length) : 0,
        ids: new Set(rows.map((p) => p.respondent_id)),
        small: rows.length < SMALL_N,
      };
    });
  }, [people, axis, axisKey, metricKey]);

  const overall = useMemo(() => {
    if (people.length === 0) return 0;
    return r2(people.reduce((s, p) => s + Number(p[metricKey] ?? 0), 0) / people.length);
  }, [people, metricKey]);

  const shown = hideSmall ? segments.filter((s) => !s.small) : segments;
  const hasSmall = segments.some((s) => s.small);
  const axisEmpty = segments.length === 1 && segments[0].name === NA;

  /* ---- 設問ごとの層間の差 ---- */
  const gaps = useMemo(() => {
    if (segments.length < 2 || answers.length === 0) return [];
    const usable = segments.filter((s) => s.name !== NA && s.n >= MIN_ITEM_N);
    if (usable.length < 2) return [];

    const segOf = new Map();
    usable.forEach((s) => s.ids.forEach((id) => segOf.set(id, s.name)));

    const table = new Map();   // 設問 → 層 → {n, sum}
    answers.forEach((a) => {
      const seg = segOf.get(a.respondent_id);
      if (!seg) return;
      const k = `${a.section}-${a.item_no}`;
      let row = table.get(k);
      if (!row) { row = new Map(); table.set(k, row); }
      let cell = row.get(seg);
      if (!cell) { cell = { n: 0, sum: 0 }; row.set(seg, cell); }
      cell.n += 1; cell.sum += Number(a.score);
    });

    const items = [...(master.koudou ?? []).map((it) => ({ ...it, secLabel: "防災行動力" })),
                   ...(master.shodou ?? []).map((it) => ({ ...it, secLabel: "初動対応力" }))];

    return items.map((it) => {
      const row = table.get(`${it.section}-${it.item_no}`);
      if (!row) return null;
      const cells = [...row.entries()]
        .map(([name, c]) => ({ name, n: c.n, avg: r2(c.sum / c.n) }))
        .filter((c) => c.n >= MIN_ITEM_N);
      if (cells.length < 2) return null;
      const sorted = [...cells].sort((a, b) => a.avg - b.avg);
      const low = sorted[0];
      const high = sorted[sorted.length - 1];
      return { ...it, low, high, spread: r2(high.avg - low.avg), cells };
    })
      .filter(Boolean)
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 8);
  }, [segments, answers, master]);

  const exportCsv = () => {
    const head = [axis.label, "人数", ...METRICS.map((m) => m.label), "全体との差（総合）"];
    const body = segments.map((s) => {
      const rows = people.filter((p) => ((p[axisKey] ?? "").trim() || NA) === s.name);
      const avgOf = (k) => (rows.length
        ? (rows.reduce((x, p) => x + Number(p[k] ?? 0), 0) / rows.length).toFixed(1) : "");
      const g = rows.length
        ? rows.reduce((x, p) => x + Number(p.grand_total ?? 0), 0) / rows.length : 0;
      const all = people.reduce((x, p) => x + Number(p.grand_total ?? 0), 0) / people.length;
      return [s.name, s.n, ...METRICS.map((m) => avgOf(m.key)), (g - all).toFixed(1)];
    });
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `属性別_${axis.label}_${roundLabel ?? ""}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!roundId) return null;

  /* ---- ビューが無いときの案内 ---- */
  const needsSql = err && /v_respondent_attributes|schema cache|does not exist/i.test(err);

  return (
    <div className="dz-card">
      <style>{CT_CSS}</style>
      <h2>属性別の比較</h2>
      <p className="dz-muted">
        {roundLabel}／層ごとに分けて見ると、全体平均に隠れている弱点が出てきます。
      </p>

      {needsSql ? (
        <div className="ct-guard">
          <p><b>この画面には準備がもう一手間必要です。</b></p>
          <p>
            Supabase の SQL Editor で <code>sql/03-improvement.sql</code> を実行してください。
            実行後にこのページを再読み込みすると表示されます。
          </p>
        </div>
      ) : err ? (
        <p className="dz-err">{err}</p>
      ) : loading ? (
        <p className="dz-muted" style={{ marginTop: 12 }}>読み込んでいます…</p>
      ) : people.length === 0 ? (
        <p className="ct-none">この調査回にはまだ回答がありません。</p>
      ) : (
        <>
          <div className="ct-controls">
            <div className="ct-ctl">
              <label htmlFor="ct-axis">分ける軸</label>
              <select id="ct-axis" value={axisKey} onChange={(e) => setAxisKey(e.target.value)}>
                {AXES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
            <div className="ct-ctl">
              <label htmlFor="ct-metric">見る点数</label>
              <select id="ct-metric" value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
                {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
            {hasSmall && (
              <label className="ct-check">
                <input type="checkbox" checked={hideSmall}
                  onChange={(e) => setHideSmall(e.target.checked)} />
                {SMALL_N}名未満の層を隠す
              </label>
            )}
            <button className="dz-btn xs ghost" onClick={exportCsv}>CSVで書き出す</button>
          </div>

          {axisEmpty ? (
            <div className="ct-guard">
              <p>
                この調査回では「{axis.label}」を集めていません。
                {axisKey === "residence_years" &&
                  "居住年数は回答画面に選択欄を追加してから集まりはじめます。"}
              </p>
            </div>
          ) : (
            <>
              <div className="ct-bars">
                {shown.map((s) => {
                  const p = metric.max ? (s.avg / metric.max) * 100 : 0;
                  const diff = r2(s.avg - overall);
                  return (
                    <div className={`ct-row${s.small ? " small" : ""}`} key={s.name}>
                      <span className="ct-name">
                        {s.name}
                        <i>{s.n}名{s.small ? "・参考値" : ""}</i>
                      </span>
                      <span className="ct-track">
                        <span style={{ width: `${Math.max(p, 0)}%`,
                          background: s.avg >= overall ? "#1b3a6b" : "#9aa3b4" }} />
                        <span className="ct-mark" style={{ left: `${(overall / metric.max) * 100}%` }} />
                      </span>
                      <span className="ct-val">{s.avg.toFixed(1)}</span>
                      <span className={`ct-diff ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`}>
                        {diff === 0 ? "±0.0" : fmtDelta(diff)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="ct-legend">
                縦の点線は全体平均 {overall.toFixed(1)} 点（{metric.label}／満点 {metric.max}）です。
                右端は全体平均との差を表します。
              </p>

              {hasSmall && !hideSmall && (
                <p className="ct-warn">
                  {SMALL_N}名未満の層は「参考値」と表示しています。1人の回答で平均が大きく動くため、
                  会議の資料に載せるときは人数を必ず添えてください。
                </p>
              )}

              {gaps.length > 0 && (
                <>
                  <h3>層による差が大きい設問</h3>
                  <p className="dz-muted">
                    {axis.label}で分けたとき、上下の開きが大きかった順です。
                    ここが「誰に向けて何をするか」を分ける手がかりになります。
                    （{MIN_ITEM_N}名未満の層は比較から外しています）
                  </p>
                  <div className="ct-gaps">
                    {gaps.map((g) => (
                      <div className="ct-gap" key={`${g.section}-${g.item_no}`}>
                        <div className="ct-gap-head">
                          <b>{g.label}</b>
                          <span className="ct-gap-meta">{g.secLabel}／{g.category}</span>
                        </div>
                        <div className="ct-gap-body">
                          <span className="ct-lo">
                            <i>低い層</i>{g.low.name}<b>{g.low.avg.toFixed(2)}</b>
                            <em>{g.low.n}名</em>
                          </span>
                          <span className="ct-arrow" aria-hidden="true">→</span>
                          <span className="ct-hi">
                            <i>高い層</i>{g.high.name}<b>{g.high.avg.toFixed(2)}</b>
                            <em>{g.high.n}名</em>
                          </span>
                          <span className="ct-spread">差 {g.spread.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {gaps.length === 0 && segments.length >= 2 && (
                <p className="ct-none">
                  設問ごとの比較には、1つの層に{MIN_ITEM_N}名以上が必要です。
                  回答が集まると自動で表示されます。
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   スタイル
   ============================================================ */
const CT_CSS = `
.ct-controls{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-top:16px;}
.ct-ctl label{display:block;font-weight:700;font-size:12px;letter-spacing:.08em;
 color:var(--sub);margin-bottom:5px;}
.ct-ctl select{font:inherit;font-size:14px;padding:9px 11px;border:2px solid var(--line);
 border-radius:6px;background:#fff;color:var(--ink);min-width:150px;}
.ct-check{display:flex;align-items:center;gap:7px;font-size:13px;padding-bottom:10px;
 cursor:pointer;}
.ct-check input{width:17px;height:17px;accent-color:var(--navy);}
.ct-bars{margin-top:20px;}
.ct-row{display:grid;grid-template-columns:118px 1fr 52px 52px;gap:12px;align-items:center;
 padding:7px 0;}
.ct-row.small{opacity:.62;}
.ct-name{font-size:14px;font-weight:800;line-height:1.3;}
.ct-name i{display:block;font-style:normal;font-size:11px;font-weight:400;color:var(--sub);}
.ct-track{position:relative;display:block;height:20px;background:#e2e6ef;border-radius:4px;}
.ct-track > span:first-child{display:block;height:100%;border-radius:4px;}
.ct-mark{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed #e0a12c;}
.ct-val{font-size:15px;font-weight:900;text-align:right;font-variant-numeric:tabular-nums;}
.ct-diff{font-size:13px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;
 color:var(--sub);}
.ct-legend{font-size:12px;color:var(--sub);margin:12px 0 0;}
.ct-warn{background:var(--amber-l);border-left:5px solid var(--amber);padding:10px 14px;
 border-radius:0 6px 6px 0;font-size:13px;margin-top:14px;}
.ct-guard{background:var(--amber-l);border-left:5px solid var(--amber);padding:14px 16px;
 border-radius:0 6px 6px 0;margin-top:16px;}
.ct-guard p{margin:0 0 8px;font-size:14px;}
.ct-guard p:last-child{margin-bottom:0;}
.ct-guard code{background:#fff;border:1px solid var(--line);border-radius:4px;padding:1px 6px;
 font-size:13px;}
.ct-none{font-size:13px;color:var(--sub);margin:14px 0 0;}
.ct-gaps{margin-top:14px;border-top:1px solid var(--line);}
.ct-gap{padding:11px 0;border-bottom:1px solid var(--line);}
.ct-gap-head b{font-size:14px;font-weight:800;}
.ct-gap-meta{font-size:11px;color:var(--sub);margin-left:9px;}
.ct-gap-body{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:5px;}
.ct-lo,.ct-hi{font-size:13px;}
.ct-lo i,.ct-hi i{font-style:normal;font-size:10px;letter-spacing:.1em;color:var(--sub);
 margin-right:7px;}
.ct-lo b{font-size:15px;font-weight:900;color:var(--red);margin-left:7px;
 font-variant-numeric:tabular-nums;}
.ct-hi b{font-size:15px;font-weight:900;color:var(--navy);margin-left:7px;
 font-variant-numeric:tabular-nums;}
.ct-lo em,.ct-hi em{font-style:normal;font-size:11px;color:var(--sub);margin-left:5px;}
.ct-arrow{color:var(--sub);}
.ct-spread{margin-left:auto;font-size:12px;font-weight:800;background:var(--paper);
 border-radius:4px;padding:2px 9px;font-variant-numeric:tabular-nums;}
@media (max-width:640px){
  .ct-row{grid-template-columns:96px 1fr 46px;row-gap:3px;}
  .ct-diff{grid-column:2 / span 2;text-align:left;}
  .ct-spread{margin-left:0;}
}
`;
