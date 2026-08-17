/**
 * 地域防災力評価システム / 回答者ごとの個票カード
 *
 * 置き場所： src/RespondentCards.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * 一覧から回答番号を選ぶと、その回答者の40項目すべての回答内容と得点、
 * 地域平均との比較を表示します。印刷して本人に返却することもできます。
 */
import React, { useState, useEffect, useMemo } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip,
} from "recharts";
import { supabase } from "./lib/bosai-supabase-api";

const r2 = (x) => Math.round(x * 100) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);

/* ---------- データ取得 ---------- */
async function fetchRoster(roundId) {
  const [{ data: people, error: e1 }, { data: totals, error: e2 }] = await Promise.all([
    supabase.from("respondents")
      .select("id,resident_code,member_type,age_band,sex,household_size,entry_mode,submitted_at," +
              "certifications,job_constraint,health_constraint,learning_interest")
      .eq("round_id", roundId),
    supabase.from("v_respondent_totals")
      .select("respondent_id,koudou_total,shodou_total,grand_total")
      .eq("round_id", roundId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const byId = Object.fromEntries((totals ?? []).map((t) => [t.respondent_id, t]));
  return (people ?? []).map((p) => ({ ...p, ...(byId[p.id] ?? {}) }))
    .sort((a, b) => (a.resident_code ?? "zzz").localeCompare(b.resident_code ?? "zzz", "ja"));
}

async function fetchAnswers(respondentId) {
  const { data, error } = await supabase
    .from("answers")
    .select("section,item_no,score,choice_index,quiz_correct")
    .eq("respondent_id", respondentId);
  if (error) throw error;
  return data ?? [];
}

/* ---------- 個票 ---------- */
function Card({ person, answers, master, areaAvg, onClose, onPrev, onNext }) {
  const pick = (section, no) => answers.find((a) => a.section === section && a.item_no === no);

  const scores = useMemo(() => ({
    k: master.koudou.map((it) => Number(pick("koudou", it.item_no)?.score ?? 0)),
    s: master.shodou.map((it) => Number(pick("shodou", it.item_no)?.score ?? 0)),
  }), [answers, master]);

  const kTotal = r2(sum(scores.k));
  const sTotal = r2(sum(scores.s));
  const total = r2(kTotal + sTotal);

  const rows = (items, section, key) => items.map((it, i) => {
    const a = pick(section, it.item_no);
    let answerText;
    if (it.input_type === "quiz5") {
      const q = a?.quiz_correct;
      answerText = Array.isArray(q)
        ? q.map((v) => (v ? "〇" : "×")).join(" ")
        : "未回答";
    } else if (a?.choice_index === null || a?.choice_index === undefined) {
      answerText = a ? "未回答" : "—";
    } else {
      answerText = it.options?.[a.choice_index]?.label ?? `選択${a.choice_index + 1}`;
    }
    const mine = scores[key][i];
    const area = areaAvg ? areaAvg[key][i] : null;
    return { it, answerText, mine, area, diff: area === null ? null : r2(mine - area) };
  });

  const weak = [
    ...rows(master.shodou, "shodou", "s").map((r) => ({ ...r, sec: "初動対応力" })),
    ...rows(master.koudou, "koudou", "k").map((r) => ({ ...r, sec: "防災行動力" })),
  ].filter((r) => r.mine <= 2.5).sort((a, b) => a.mine - b.mine).slice(0, 6);

  const RadarBlock = ({ title, items, key2 }) => {
    const data = items.map((it, i) => ({
      no: String(it.item_no), label: it.label,
      本人: scores[key2][i],
      ...(areaAvg ? { 地域平均: areaAvg[key2][i] } : {}),
    }));
    return (
      <div className="dz-chart">
        <h3>{title}</h3>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke="#d3dbd5" />
              <PolarAngleAxis dataKey="no" tick={{ fontSize: 11, fill: "#5b6b62" }} />
              <PolarRadiusAxis domain={[0, 5]} tickCount={6} angle={90} tick={{ fontSize: 10, fill: "#9aa8a0" }} />
              <Tooltip formatter={(v, n) => [`${r2(v)} 点`, n]}
                labelFormatter={(l) => { const d = data.find((x) => x.no === l); return `${l}. ${d ? d.label : ""}`; }}
                contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d3dbd5" }} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <Radar name="本人" dataKey="本人" stroke="#00703c" fill="#00703c" fillOpacity={0.28} strokeWidth={2} />
              {areaAvg && <Radar name="地域平均" dataKey="地域平均" stroke="#e0a12c" fill="#e0a12c" fillOpacity={0.12} strokeWidth={2} />}
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const Table = ({ title, items, section, key2 }) => (
    <>
      <h3>{title}</h3>
      <div className="dz-scroll">
        <table className="dz-table rc-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>No</th>
              <th style={{ width: 100 }}>分類</th>
              <th>項目</th>
              <th style={{ width: 150 }}>回答</th>
              <th style={{ width: 60 }}>得点</th>
              {areaAvg && <><th style={{ width: 70 }}>地域平均</th><th style={{ width: 60 }}>差</th></>}
            </tr>
          </thead>
          <tbody>
            {rows(items, section, key2).map((r) => (
              <tr key={r.it.item_no} className={r.mine <= 2.5 ? "low" : ""}>
                <td className="n">{r.it.item_no}</td>
                <td className="sub">{r.it.category}</td>
                <td>{r.it.label}</td>
                <td className="ans">{r.answerText}</td>
                <td className="n"><b>{r.mine}</b></td>
                {areaAvg && (
                  <>
                    <td className="n sub">{r.area.toFixed(2)}</td>
                    <td className={`n ${r.diff > 0 ? "up" : r.diff < 0 ? "down" : ""}`}>
                      {r.diff > 0 ? `+${r.diff.toFixed(1)}` : r.diff.toFixed(1)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const attrs = [
    ["立場", person.member_type], ["年齢", person.age_band], ["性別", person.sex],
    ["世帯人数", person.household_size],
    ["入力方法", person.entry_mode === "paper" ? "紙（代理入力）" : "Web"],
  ].filter(([, v]) => v);

  const freeText = [
    ["資格・経験", person.certifications],
    ["今後学びたいこと", person.learning_interest],
    ["職業上の制約", person.job_constraint],
  ].filter(([, v]) => (v ?? "").trim() !== "");

  return (
    <div className="rc-card">
      <div className="rc-head no-print">
        <div className="rc-nav">
          <button className="dz-btn xs ghost" onClick={onClose}>一覧に戻る</button>
          <button className="dz-btn xs ghost" onClick={onPrev} disabled={!onPrev}>← 前の人</button>
          <button className="dz-btn xs ghost" onClick={onNext} disabled={!onNext}>次の人 →</button>
        </div>
        <button className="dz-btn xs" onClick={() => window.print()}>この個票を印刷</button>
      </div>

      <div className="rc-title">
        <h2>回答番号　{person.resident_code || "（番号なし）"}</h2>
        <p className="dz-muted">
          {attrs.map(([k, v]) => `${k}：${v}`).join("　／　")}
        </p>
      </div>

      <div className="dz-kpis">
        <div className="dz-kpi"><div className="k">防災行動力</div>
          <div className="v">{kTotal.toFixed(1)}<span className="u"> /100</span></div></div>
        <div className="dz-kpi"><div className="k">初動対応力</div>
          <div className="v">{sTotal.toFixed(1)}<span className="u"> /100</span></div></div>
        <div className="dz-kpi hi"><div className="k">総合得点</div>
          <div className="v">{total.toFixed(1)}<span className="u"> /200</span></div></div>
      </div>

      <div className="dz-charts">
        <RadarBlock title="防災行動力" items={master.koudou} key2="k" />
        <RadarBlock title="初動対応力" items={master.shodou} key2="s" />
      </div>

      {weak.length > 0 && (
        <>
          <h3>この方が優先して取り組むとよい項目</h3>
          {weak.map((w, i) => (
            <div className="dz-row" key={`${w.sec}${w.it.item_no}`}>
              <span className="dz-tag" style={{ background: w.mine <= 1 ? "#c1272d" : w.mine <= 2 ? "#e0a12c" : "#00703c" }}>
                {i + 1}
              </span>
              <span>
                <b>{w.sec}／{w.it.category}／{w.it.item_no}. {w.it.label}</b>
                <span className="sc">回答「{w.answerText}」・{w.mine}点</span>
                <p>{w.it.improvement_tip}</p>
              </span>
            </div>
          ))}
        </>
      )}

      <Table title="初動対応力の回答一覧" items={master.shodou} section="shodou" key2="s" />
      <Table title="防災行動力の回答一覧" items={master.koudou} section="koudou" key2="k" />

      {freeText.length > 0 && (
        <>
          <h3>記入欄</h3>
          {freeText.map(([k, v]) => (
            <div className="rc-ft" key={k}><b>{k}</b><p>{v}</p></div>
          ))}
        </>
      )}
      {(person.health_constraint ?? "").trim() !== "" && (
        <p className="dz-muted" style={{ marginTop: 10 }}>
          ※健康上の活動制約の記入があります。内容は「自由記述の回答」から確認してください。
        </p>
      )}
    </div>
  );
}

/* ============================================================
   本体
   ============================================================ */
export default function RespondentCards({ roundId, roundLabel, master, areaAvg }) {
  const [roster, setRoster] = useState([]);
  const [sel, setSel] = useState(null);          // 選択中のindex
  const [answers, setAnswers] = useState([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("code");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!roundId) { setRoster([]); setSel(null); return; }
      setLoading(true); setErr("");
      try {
        const d = await fetchRoster(roundId);
        if (!cancelled) { setRoster(d); setSel(null); }
      } catch (e) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [roundId]);

  const view = useMemo(() => {
    const f = roster.filter((p) =>
      q.trim() === "" ||
      (p.resident_code ?? "").toLowerCase().includes(q.trim().toLowerCase())
    );
    const s = [...f];
    if (sort === "high") s.sort((a, b) => (b.grand_total ?? 0) - (a.grand_total ?? 0));
    if (sort === "low") s.sort((a, b) => (a.grand_total ?? 0) - (b.grand_total ?? 0));
    return s;
  }, [roster, q, sort]);

  const openAt = async (i) => {
    setSel(i); setErr("");
    try { setAnswers(await fetchAnswers(view[i].id)); }
    catch (e) { setErr(e.message); }
  };

  if (!roundId) return null;

  return (
    <div className="dz-card">
      <style>{RC_CSS}</style>
      <h2>回答者ごとの個票</h2>
      <p className="dz-muted">{roundLabel}／回答番号を選ぶと、その方の全40項目の回答と地域平均との比較が見られます。</p>

      {err && <p className="dz-err">{err}</p>}
      {loading && <p className="dz-muted" style={{ marginTop: 12 }}>読み込んでいます…</p>}

      {sel === null ? (
        <>
          <div className="rc-bar">
            <div className="dz-field" style={{ flex: "1 1 200px" }}>
              <label htmlFor="rc-q">回答番号で絞り込む</label>
              <input id="rc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例）A012" />
            </div>
            <div className="dz-field" style={{ flex: "0 1 200px" }}>
              <label htmlFor="rc-sort">並び順</label>
              <select id="rc-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="code">回答番号順</option>
                <option value="low">総合点が低い順</option>
                <option value="high">総合点が高い順</option>
              </select>
            </div>
            <p className="rc-num">{view.length} 名</p>
          </div>

          {view.length === 0 && !loading ? (
            <p className="dz-muted" style={{ marginTop: 14 }}>該当する回答者がいません。</p>
          ) : (
            <div className="dz-scroll">
              <table className="dz-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>回答番号</th><th style={{ width: 90 }}>立場</th>
                    <th style={{ width: 80 }}>年齢</th><th style={{ width: 70 }}>入力</th>
                    <th style={{ width: 90 }}>防災行動力</th><th style={{ width: 90 }}>初動対応力</th>
                    <th style={{ width: 90 }}>総合</th><th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((p, i) => (
                    <tr key={p.id} className="rc-tr" onClick={() => openAt(i)}>
                      <td><b>{p.resident_code || "（番号なし）"}</b></td>
                      <td className="sub">{p.member_type ?? "—"}</td>
                      <td className="sub">{p.age_band ?? "—"}</td>
                      <td className="sub">{p.entry_mode === "paper" ? "紙" : "Web"}</td>
                      <td className="n">{Number(p.koudou_total ?? 0).toFixed(1)}</td>
                      <td className="n">{Number(p.shodou_total ?? 0).toFixed(1)}</td>
                      <td className="n"><b>{Number(p.grand_total ?? 0).toFixed(1)}</b></td>
                      <td><button className="dz-btn xs ghost">個票を開く</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <Card
          person={view[sel]}
          answers={answers}
          master={master}
          areaAvg={areaAvg}
          onClose={() => setSel(null)}
          onPrev={sel > 0 ? () => openAt(sel - 1) : null}
          onNext={sel < view.length - 1 ? () => openAt(sel + 1) : null}
        />
      )}
    </div>
  );
}

const RC_CSS = `
.rc-bar{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-top:14px;}
.rc-num{margin:0 0 10px auto;font-size:13px;color:var(--sub);font-variant-numeric:tabular-nums;}
.rc-tr{cursor:pointer;}
.rc-tr:hover{background:var(--green-l);}
.dz-table td.sub{color:var(--sub);font-size:13px;}
.rc-card{margin-top:8px;}
.rc-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;
 padding-bottom:14px;border-bottom:1px solid var(--line);}
.rc-nav{display:flex;gap:8px;flex-wrap:wrap;}
.rc-title{margin:18px 0 4px;}
.rc-title h2{font-size:20px;font-weight:900;margin:0;}
.rc-table td.ans{font-size:13px;font-weight:700;}
.rc-table tr.low td{background:#fdf7ec;}
.rc-ft{padding:10px 0;border-bottom:1px solid var(--line);}
.rc-ft:last-child{border-bottom:0;}
.rc-ft b{font-size:12px;letter-spacing:.1em;color:var(--sub);}
.rc-ft p{margin:3px 0 0;font-size:15px;white-space:pre-wrap;}
@media print{
  .no-print{display:none !important;}
  .dz-head,.dz-band,.dz-actions{display:none !important;}
  .rc-card{page-break-inside:auto;}
  .dz-chart{page-break-inside:avoid;}
  .rc-table{font-size:11px;}
}
`;
