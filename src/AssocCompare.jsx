/**
 * 地域防災力評価システム / 自治会どうしの比較
 *
 * 置き場所： src/AssocCompare.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * ねらい：
 *   総会などで説明するときの参考情報です。
 *   「うちの自治会は、よそと比べてどのあたりか」が分かると、
 *   点数の高い・低いを自分たちの言葉で受け止めやすくなります。
 *
 * 見せ方について：
 *   ・比べるのは、各自治会の「いちばん新しい調査回」です
 *   ・回答が5名に満たない調査回は、集計から外しています
 *     （人数が少ないと、個人の回答が推測できてしまうため）
 *   ・自分が管理していない自治会は、名前を伏せて表示します
 *
 *   順位づけそのものが目的ではないので、
 *   「差が小さいときは横並びとみてよい」という趣旨の注記を添えています。
 */
import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip, Legend, Cell, ReferenceLine,
} from "recharts";
import { supabase, withClockSkewRetry } from "./lib/bosai-supabase-api";

const r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => Number(x ?? 0);
const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1));

const K_CATS = ["被害拡大防止", "備蓄状況", "連絡体制", "知識習得", "地域防災活動"];
const S_CATS = ["避難", "消火", "救出救助", "応急救護"];

const MISSING = /function .*(get_association_comparison|get_category_comparison)|does not exist|PGRST202/i;

export default function AssocCompare({ association }) {
  const [rows, setRows] = useState(null);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [needSql, setNeedSql] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;
      setLoading(true); setErr(""); setNeedSql(false);
      try {
        const [a, c] = await withClockSkewRetry(() => Promise.all([
          supabase.rpc("get_association_comparison"),
          supabase.rpc("get_category_comparison"),
        ]));
        if (a.error) throw a.error;
        if (c.error) throw c.error;
        if (cancelled) return;
        setRows(a.data ?? []);
        setCats(c.data ?? []);
      } catch (e) {
        if (cancelled) return;
        if (MISSING.test(String(e?.message ?? "") + String(e?.code ?? ""))) setNeedSql(true);
        else setErr(e.message ?? String(e));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open]);

  /* 表示中の自治会を基準にした差 */
  const me = useMemo(
    () => (rows ?? []).find((r) => r.is_mine && r.display_name === association?.name),
    [rows, association]
  );

  const chart = useMemo(() => (rows ?? []).map((r) => ({
    name: r.display_name,
    総合得点: num(r.total_avg),
    self: r.display_name === association?.name,
  })), [rows, association]);

  const overall = useMemo(() => {
    if (!rows?.length) return null;
    const w = rows.reduce((acc, r) => {
      const n = num(r.respondents);
      return {
        n: acc.n + n,
        k: acc.k + num(r.koudou_avg) * n,
        s: acc.s + num(r.shodou_avg) * n,
        g: acc.g + num(r.total_avg) * n,
      };
    }, { n: 0, k: 0, s: 0, g: 0 });
    if (!w.n) return null;
    return { assocs: rows.length, n: w.n, k: r2(w.k / w.n), s: r2(w.s / w.n), g: r2(w.g / w.n) };
  }, [rows]);

  /* 区分別：行＝区分、列＝自治会 */
  const names = useMemo(
    () => [...new Set((cats ?? []).map((c) => c.display_name))],
    [cats]
  );
  const catTable = useMemo(() => {
    const byKey = {};
    (cats ?? []).forEach((c) => {
      byKey[`${c.category}|${c.display_name}`] = num(c.avg_score);
    });
    return [...S_CATS, ...K_CATS].map((cat) => ({
      cat,
      sec: S_CATS.includes(cat) ? "初動対応力" : "防災行動力",
      values: names.map((nm) => byKey[`${cat}|${nm}`] ?? null),
    }));
  }, [cats, names]);

  if (!association) return null;

  return (
    <div className="dz-card">
      <style>{AC_CSS}</style>

      <h2>自治会どうしの比較</h2>
      <p className="dz-muted">
        総会などでご説明いただくときの参考情報です。
        各自治会について、<b>回答が5名以上そろっている調査回のうち、いちばん新しいもの</b>を並べます。
        回答が5名に満たない調査回を集計から外しているのは、
        人数が少ないと平均から個人の回答が推測できてしまうためです。
        次の調査の準備を始めていても、前回の結果で比較を続けられます。
      </p>

      {!open && (
        <div className="dz-actions">
          <button className="dz-btn" onClick={() => setOpen(true)}>比較を表示する</button>
        </div>
      )}

      {open && (
        <>
          {loading && <p className="dz-muted" style={{ marginTop: 14 }}>集計しています…</p>}

          {needSql && (
            <p className="dz-note">
              比較のしくみが、まだデータベースに登録されていません。
              Supabase の SQL Editor で sql/07-compare-and-member-type.sql を実行してから、
              もう一度お試しください。
            </p>
          )}

          {err && <p className="dz-err">{err}</p>}

          {!loading && !needSql && !err && (rows?.length ?? 0) === 0 && (
            <p className="dz-muted" style={{ marginTop: 14 }}>
              比べられる調査回がまだありません。
              回答が5名以上そろった調査回があると、ここに並びます。
            </p>
          )}

          {!loading && (rows?.length ?? 0) > 0 && (
            <>
              {rows.length === 1 && (
                <p className="dz-note">
                  いまのところ、比べられる自治会は1つだけです。
                  ほかの自治会でも調査が行われると、ここに並んで比較できるようになります。
                </p>
              )}

              {!me && (
                <p className="dz-note">
                  「{association.name}」は、まだ回答が5名以上そろった調査回がないため、
                  この比較には含まれていません。回答が5名に達すると自動的に並びます。
                </p>
              )}

              {/* ---- 総合得点の並び ---- */}
              <div className="dz-chart" style={{ marginTop: 16, padding: "16px 12px 8px" }}>
                <h3>総合得点（200点満点）</h3>
                <div style={{ width: "100%", height: Math.max(200, 52 * chart.length + 60) }}>
                  <ResponsiveContainer>
                    <BarChart data={chart} layout="vertical"
                      margin={{ top: 10, right: 30, left: 10, bottom: 4 }}>
                      <CartesianGrid stroke="#e6eaf0" horizontal={false} />
                      <XAxis type="number" domain={[0, 200]} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => [`${v} 点`, "総合得点"]}
                        contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d4d9e2" }} />
                      <Legend wrapperStyle={{ fontSize: 13 }} />
                      {overall && (
                        <ReferenceLine x={overall.g} stroke="#e0a12c" strokeWidth={2}
                          strokeDasharray="4 3"
                          label={{ value: "全体平均", position: "top", fontSize: 11, fill: "#8a6a1e" }} />
                      )}
                      <Bar dataKey="総合得点" radius={[0, 3, 3, 0]}>
                        {chart.map((d) => (
                          <Cell key={d.name} fill={d.self ? "#1b3a6b" : "#9aa3b4"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="ac-legend">
                  濃い色が「{association.name}」です。
                  点線は、参加しているすべての自治会をあわせた平均です。
                </p>
              </div>

              {/* ---- 一覧表 ---- */}
              <div className="dz-scroll">
                <table className="dz-table" style={{ marginTop: 16 }}>
                  <thead>
                    <tr>
                      <th>自治会</th>
                      <th style={{ width: 80 }}>回答数</th>
                      <th style={{ width: 100 }}>防災行動力</th>
                      <th style={{ width: 100 }}>初動対応力</th>
                      <th style={{ width: 100 }}>総合得点</th>
                      {me && <th style={{ width: 90 }}>当自治会との差</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const self = r.display_name === association.name;
                      const d = me ? r2(num(r.total_avg) - num(me.total_avg)) : null;
                      return (
                        <tr key={r.display_name} className={self ? "ac-self" : ""}>
                          <td>
                            <b>{r.display_name}</b>
                            {self && <span className="ac-badge">当自治会</span>}
                            {r.round_label && <><br /><span className="dz-sub">
                              {r.round_label}　{r.conducted_on}</span></>}
                          </td>
                          <td className="n">{num(r.respondents)}</td>
                          <td className="n">{num(r.koudou_avg).toFixed(1)}</td>
                          <td className="n">{num(r.shodou_avg).toFixed(1)}</td>
                          <td className="n"><b>{num(r.total_avg).toFixed(1)}</b></td>
                          {me && (
                            <td className={`n ${!self && d > 0 ? "up" : !self && d < 0 ? "down" : ""}`}>
                              {self ? "—" : fmtDelta(d)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {overall && rows.length > 1 && (
                      <tr className="ac-all">
                        <td><b>全体平均</b><br />
                          <span className="dz-sub">{overall.assocs}自治会・{overall.n}名</span></td>
                        <td className="n">{overall.n}</td>
                        <td className="n">{overall.k.toFixed(1)}</td>
                        <td className="n">{overall.s.toFixed(1)}</td>
                        <td className="n"><b>{overall.g.toFixed(1)}</b></td>
                        {me && (
                          <td className="n">
                            {fmtDelta(r2(overall.g - num(me.total_avg)))}
                          </td>
                        )}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* ---- 区分別 ---- */}
              {names.length > 0 && (
                <>
                  <h3>区分別の比較<span className="dz-sub">（5点満点）</span></h3>
                  <div className="dz-scroll">
                    <table className="dz-table">
                      <thead>
                        <tr>
                          <th style={{ width: 90 }}>区分</th>
                          <th style={{ width: 120 }}>分類</th>
                          {names.map((nm) => (
                            <th key={nm} className={nm === association.name ? "ac-selfth" : ""}>
                              {nm}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {catTable.map((row) => {
                          const vals = row.values.filter((v) => v !== null);
                          const best = vals.length ? Math.max(...vals) : null;
                          return (
                            <tr key={row.cat}>
                              <td className="dz-sub">{row.sec}</td>
                              <td>{row.cat}</td>
                              {row.values.map((v, i) => (
                                <td key={names[i]}
                                  className={`n${v !== null && v === best ? " ac-best" : ""}`}>
                                  {v === null ? "—" : v.toFixed(2)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <p className="dz-muted" style={{ marginTop: 14 }}>
                自治会によって世帯構成も地形も異なるため、順位そのものにはあまり意味がありません。
                0.2点程度の差は横並びとみて差し支えありません。
                「どの区分に差が出ているか」を、次の取り組みを決める手がかりとしてお使いください。
              </p>

              <div className="dz-actions">
                <button className="dz-btn ghost" onClick={() => setOpen(false)}>閉じる</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const AC_CSS = `
.ac-legend{font-size:12px;color:var(--sub);margin:4px 0 0;text-align:center;}
.ac-self td{background:var(--navy-l);}
.ac-badge{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:99px;
 background:var(--navy);color:#fff;font-size:11px;font-weight:800;vertical-align:1px;}
.ac-all td{background:#fbf1dd;}
.ac-selfth{background:var(--navy)!important;color:#fff;}
.dz-table td.ac-best{font-weight:900;color:var(--navy-d);}
`;
