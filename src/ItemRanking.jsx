/**
 * 地域防災力評価システム / 設問別ドリルダウン
 *
 * 置き場所： src/ItemRanking.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * 40項目を平均点の低い順に並べ、項目を開くと
 * 「何人がどの選択肢を選んだか」まで見られるようにしたものです。
 * 区分別平均が「どのあたりが弱いか」を示すのに対して、
 * ここは「次に何をやるか」を決めるための画面です。
 */
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/bosai-supabase-api";

const r2 = (x) => Math.round(x * 100) / 100;
const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

const stateOf = (v) =>
  v === null ? "—" : v < 1.5 ? "重点課題" : v < 2.5 ? "要強化" : v < 3.5 ? "標準" : "良好";
const colorOf = (v) =>
  v === null ? "#d4d9e2" : v < 1.5 ? "#c1272d" : v < 2.5 ? "#e0a12c" : v < 3.5 ? "#9aa3b4" : "#1b3a6b";

const SORTS = [
  { key: "low", label: "平均点の低い順" },
  { key: "drop", label: "前回から下がった順" },
  { key: "high", label: "平均点の高い順" },
  { key: "no", label: "設問番号順" },
];

/* ------------------------------------------------------------
   回答データの取得
   Supabaseは1回のリクエストで1000行までしか返さないため、
   1000行ずつ繰り返し取得します（40項目×26名でも1040行になります）
   ------------------------------------------------------------ */
async function fetchAllAnswers(roundId) {
  const CHUNK = 1000;
  let from = 0;
  let out = [];
  for (;;) {
    const { data, error } = await supabase
      .from("answers")
      .select("section,item_no,score,choice_index,quiz_correct,respondents!inner(round_id)")
      .eq("respondents.round_id", roundId)
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    out = out.concat(data ?? []);
    if (!data || data.length < CHUNK) break;
    from += CHUNK;
  }
  return out;
}

/* ------------------------------------------------------------
   1項目分の内訳
   ------------------------------------------------------------ */
function Detail({ row }) {
  const st = row.st;
  if (!st || st.n === 0) {
    return <p className="ir-none">この項目への回答がありません。</p>;
  }

  /* 知識チェック（5問）は、5問それぞれの正答率を出す */
  if (row.input_type === "quiz5") {
    const qs = Array.isArray(row.quiz) ? row.quiz : [];
    return (
      <div className="ir-detail">
        <h4>5問それぞれの正答率</h4>
        <p className="ir-hint">
          正答率の低い設問が、そのまま次の講習で扱うべき内容です。
        </p>
        {qs.map((q, i) => {
          const c = st.quiz[i] ?? 0;
          const p = pct(c, st.quizN);
          return (
            <div className="ir-bar" key={i}>
              <div className="ir-bar-head">
                <span className="ir-bar-label">{i + 1}. {q}</span>
                <span className="ir-bar-num">{c}／{st.quizN}名（{p}%）</span>
              </div>
              <div className="ir-track">
                <span style={{ width: `${p}%`, background: p < 40 ? "#c1272d" : p < 70 ? "#e0a12c" : "#1b3a6b" }} />
              </div>
            </div>
          );
        })}
        <h4>改善のヒント</h4>
        <p className="ir-tip">{row.improvement_tip}</p>
      </div>
    );
  }

  /* 選択式は、選択肢ごとの人数と割合 */
  const opts = Array.isArray(row.options) ? row.options : [];
  const na = st.counts.na ?? 0;
  return (
    <div className="ir-detail">
      <h4>回答の内訳</h4>
      {opts.map((o, i) => {
        const c = st.counts[i] ?? 0;
        const p = pct(c, st.n);
        return (
          <div className="ir-bar" key={i}>
            <div className="ir-bar-head">
              <span className="ir-bar-label">{o.label}<i>{o.score}点</i></span>
              <span className="ir-bar-num">{c}名（{p}%）</span>
            </div>
            <div className="ir-track">
              <span style={{ width: `${p}%`, background: colorOf(Number(o.score)) }} />
            </div>
          </div>
        );
      })}
      {na > 0 && <p className="ir-none">選択肢の記録がない回答が {na} 件あります（古い代理入力分など）。</p>}
      <h4>改善のヒント</h4>
      <p className="ir-tip">{row.improvement_tip}</p>
    </div>
  );
}

/* ============================================================
   本体
   ============================================================ */
export default function ItemRanking({ roundId, roundLabel, master, baseAvg, baseLabel }) {
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState("low");
  const [sec, setSec] = useState("all");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!roundId) { setAnswers([]); return; }
      setLoading(true); setErr(""); setOpen(null);
      try {
        const d = await fetchAllAnswers(roundId);
        if (!cancelled) setAnswers(d);
      } catch (e) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [roundId]);

  /* ---- 項目ごとに集計 ---- */
  const stats = useMemo(() => {
    const map = new Map();
    answers.forEach((a) => {
      const k = `${a.section}-${a.item_no}`;
      let s = map.get(k);
      if (!s) { s = { n: 0, sum: 0, counts: {}, quiz: [0, 0, 0, 0, 0], quizN: 0 }; map.set(k, s); }
      s.n += 1;
      s.sum += Number(a.score);
      if (Array.isArray(a.quiz_correct)) {
        s.quizN += 1;
        a.quiz_correct.forEach((v, i) => { if (v) s.quiz[i] += 1; });
      } else {
        const idx = a.choice_index === null || a.choice_index === undefined ? "na" : a.choice_index;
        s.counts[idx] = (s.counts[idx] ?? 0) + 1;
      }
    });
    return map;
  }, [answers]);

  /* ---- 表示用の行 ---- */
  const rows = useMemo(() => {
    const build = (items, secLabel, key) => items.map((it) => {
      const st = stats.get(`${it.section}-${it.item_no}`);
      const now = st && st.n ? r2(st.sum / st.n) : null;
      const prevRaw = baseAvg ? baseAvg[key]?.[it.item_no - 1] : null;
      const prev = prevRaw === null || prevRaw === undefined ? null : Number(prevRaw);
      return {
        ...it, secLabel, key, st,
        now, n: st?.n ?? 0, prev,
        d: now === null || prev === null ? null : r2(now - prev),
      };
    });
    return [
      ...build(master.koudou ?? [], "防災行動力", "k"),
      ...build(master.shodou ?? [], "初動対応力", "s"),
    ];
  }, [master, stats, baseAvg]);

  const cats = useMemo(() => {
    const pool = sec === "all" ? rows : rows.filter((r) => r.secLabel === sec);
    return [...new Set(pool.map((r) => r.category))];
  }, [rows, sec]);

  const view = useMemo(() => {
    let v = rows;
    if (sec !== "all") v = v.filter((r) => r.secLabel === sec);
    if (cat !== "all") v = v.filter((r) => r.category === cat);
    const last = (x) => (x === null ? Number.POSITIVE_INFINITY : x);
    const lastDesc = (x) => (x === null ? Number.NEGATIVE_INFINITY : x);
    const sorted = [...v];
    if (sort === "low") sorted.sort((a, b) => last(a.now) - last(b.now));
    else if (sort === "high") sorted.sort((a, b) => lastDesc(b.now) - lastDesc(a.now));
    else if (sort === "drop") sorted.sort((a, b) => last(a.d) - last(b.d));
    else sorted.sort((a, b) => (a.secLabel === b.secLabel ? a.item_no - b.item_no : a.secLabel < b.secLabel ? -1 : 1));
    return sorted;
  }, [rows, sec, cat, sort]);

  const exportCsv = () => {
    const head = ["順位", "区分", "分類", "No", "項目", "平均点", "回答数",
      baseLabel ? `前回（${baseLabel}）` : "前回", "増減", "状態", "最も多かった回答"];
    const body = view.map((r, i) => {
      let top = "";
      if (r.input_type !== "quiz5" && r.st) {
        const opts = Array.isArray(r.options) ? r.options : [];
        let bi = -1, bc = -1;
        opts.forEach((_, k) => { const c = r.st.counts[k] ?? 0; if (c > bc) { bc = c; bi = k; } });
        if (bi >= 0) top = `${opts[bi].label}（${bc}名・${pct(bc, r.st.n)}%）`;
      }
      return [i + 1, r.secLabel, r.category, r.item_no, r.label,
        r.now === null ? "" : r.now.toFixed(2), r.n,
        r.prev === null ? "" : r.prev.toFixed(2),
        r.d === null ? "" : r.d.toFixed(2),
        stateOf(r.now), top];
    });
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `設問別_${roundLabel ?? ""}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!roundId) return null;

  return (
    <div className="dz-card">
      <style>{IR_CSS}</style>
      <h2>設問別の詳しい結果</h2>
      <p className="dz-muted">
        {roundLabel}／40項目を並べ替えて見られます。項目名を押すと、
        何人がどの選択肢を選んだかが開きます。
      </p>

      {err && <p className="dz-err">{err}</p>}
      {loading && <p className="dz-muted" style={{ marginTop: 12 }}>読み込んでいます…</p>}

      {!loading && !err && answers.length === 0 && (
        <p className="ir-none" style={{ marginTop: 14 }}>
          この調査回にはまだ回答がありません。
        </p>
      )}

      {answers.length > 0 && (
        <>
          <div className="ir-controls">
            <div className="ir-ctl">
              <label htmlFor="ir-sort">並び順</label>
              <select id="ir-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}
                    disabled={s.key === "drop" && !baseAvg}>
                    {s.label}{s.key === "drop" && !baseAvg ? "（比較する回が必要）" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="ir-ctl">
              <label htmlFor="ir-sec">区分</label>
              <select id="ir-sec" value={sec}
                onChange={(e) => { setSec(e.target.value); setCat("all"); }}>
                <option value="all">両方</option>
                <option value="防災行動力">防災行動力</option>
                <option value="初動対応力">初動対応力</option>
              </select>
            </div>
            <div className="ir-ctl">
              <label htmlFor="ir-cat">分類</label>
              <select id="ir-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="all">すべて</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button className="dz-btn xs ghost" onClick={exportCsv}>CSVで書き出す</button>
          </div>

          <p className="dz-muted" style={{ marginTop: 10 }}>{view.length} 項目を表示中</p>

          <div className="ir-list">
            {view.map((r, i) => {
              const k = `${r.section}-${r.item_no}`;
              const isOpen = open === k;
              return (
                <div className={`ir-item${isOpen ? " on" : ""}`} key={k}>
                  <button className="ir-head" type="button" aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : k)}>
                    <span className="ir-rank">{i + 1}</span>
                    <span className="ir-name">
                      <b>{r.label}</b>
                      <span className="ir-meta">{r.secLabel}／{r.category}／設問{r.item_no}</span>
                    </span>
                    <span className="ir-score">
                      <span className="ir-track sm">
                        <span style={{ width: `${((r.now ?? 0) / 5) * 100}%`, background: colorOf(r.now) }} />
                      </span>
                      <b style={{ color: colorOf(r.now) }}>
                        {r.now === null ? "—" : r.now.toFixed(2)}
                      </b>
                      <i>/5</i>
                    </span>
                    <span className={`ir-delta ${r.d > 0 ? "up" : r.d < 0 ? "down" : ""}`}>
                      {r.d === null ? "" : fmtDelta(r.d)}
                    </span>
                    <span className="ir-state" style={{ color: colorOf(r.now) }}>{stateOf(r.now)}</span>
                    <span className="ir-caret" aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  {isOpen && <Detail row={r} />}
                </div>
              );
            })}
          </div>

          {baseLabel && (
            <p className="dz-muted" style={{ marginTop: 12 }}>
              増減は「{baseLabel}」との比較です。
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   スタイル
   ============================================================ */
const IR_CSS = `
.ir-controls{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-top:16px;}
.ir-ctl label{display:block;font-weight:700;font-size:12px;letter-spacing:.08em;
 color:var(--sub);margin-bottom:5px;}
.ir-ctl select{font:inherit;font-size:14px;padding:9px 11px;border:2px solid var(--line);
 border-radius:6px;background:#fff;color:var(--ink);min-width:170px;}
.ir-list{margin-top:12px;border-top:1px solid var(--line);}
.ir-item{border-bottom:1px solid var(--line);}
.ir-item.on{background:var(--paper);}
.ir-head{display:grid;grid-template-columns:34px 1fr 132px 62px 74px 20px;gap:10px;
 align-items:center;width:100%;text-align:left;background:none;border:0;font:inherit;
 padding:11px 6px;cursor:pointer;color:inherit;}
.ir-head:hover{background:var(--navy-l);}
.ir-head:focus-visible{outline:3px solid var(--amber);outline-offset:-3px;}
.ir-rank{font-size:13px;font-weight:900;color:var(--sub);text-align:right;
 font-variant-numeric:tabular-nums;}
.ir-name b{display:block;font-size:14px;font-weight:800;line-height:1.4;}
.ir-meta{font-size:11px;color:var(--sub);}
.ir-score{display:flex;align-items:center;gap:7px;font-variant-numeric:tabular-nums;}
.ir-score b{font-size:15px;font-weight:900;}
.ir-score i{font-style:normal;font-size:11px;color:var(--sub);}
.ir-delta{font-size:13px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;}
.ir-state{font-size:12px;font-weight:800;text-align:right;}
.ir-caret{font-size:9px;color:var(--sub);text-align:center;}
.ir-track{display:block;height:8px;background:#e2e6ef;border-radius:99px;overflow:hidden;}
.ir-track.sm{width:56px;flex:none;}
.ir-track span{display:block;height:100%;border-radius:99px;}
.ir-detail{padding:6px 12px 20px 50px;}
.ir-detail h4{font-size:13px;font-weight:800;letter-spacing:.06em;color:var(--sub);
 margin:16px 0 10px;}
.ir-detail h4:first-child{margin-top:6px;}
.ir-bar{margin-bottom:11px;max-width:620px;}
.ir-bar-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline;
 margin-bottom:4px;}
.ir-bar-label{font-size:14px;}
.ir-bar-label i{font-style:normal;font-size:11px;color:var(--sub);margin-left:7px;}
.ir-bar-num{font-size:12px;color:var(--sub);white-space:nowrap;
 font-variant-numeric:tabular-nums;}
.ir-tip{font-size:14px;line-height:1.65;margin:0;max-width:620px;
 background:#fff;border-left:5px solid var(--navy);padding:11px 14px;border-radius:0 6px 6px 0;}
.ir-hint{font-size:12px;color:var(--sub);margin:-4px 0 12px;}
.ir-none{font-size:13px;color:var(--sub);margin:8px 0 0;}
@media (max-width:760px){
  .ir-head{grid-template-columns:28px 1fr 62px 20px;row-gap:4px;}
  .ir-score .ir-track{display:none;}
  .ir-delta,.ir-state{grid-column:2 / span 2;text-align:left;font-size:12px;}
  .ir-detail{padding-left:16px;}
}
`;
