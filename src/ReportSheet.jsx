/**
 * 地域防災力評価システム / 総会用の印刷資料
 *
 * 置き場所： src/ReportSheet.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * A4縦・最大2枚（裏表）に収まる形で、集計と取り組みをまとめます。
 *
 * グラフは外部のグラフ部品を使わず、SVGを自分で描いています。
 * 画面用のグラフ部品は表示領域の大きさに合わせて描き直す作りのため、
 * 印刷時に潰れたり切れたりしやすいためです。
 */
import React, { useState, useEffect, useMemo } from "react";
import { supabase, beginPrintScope, endPrintScope } from "./lib/bosai-supabase-api";

const r2 = (x) => Math.round(x * 100) / 100;
const fmtDelta = (d) => (d > 0 ? `+${Number(d).toFixed(2)}` : Number(d).toFixed(2));
const fmtDelta1 = (d) => (d > 0 ? `+${Number(d).toFixed(1)}` : Number(d).toFixed(1));

const stateOf = (v) => (v < 1.5 ? "重点課題" : v < 2.5 ? "要強化" : v < 3.5 ? "標準" : "良好");
const colorOf = (v) => (v < 1.5 ? "#c1272d" : v < 2.5 ? "#e0a12c" : v < 3.5 ? "#8a93a5" : "#1b3a6b");

const ST = {
  planned: { label: "予定", color: "#e0a12c" },
  doing: { label: "実施中", color: "#0b6fa4" },
  done: { label: "実施済", color: "#0f7a5a" },
  dropped: { label: "見送り", color: "#9aa3b4" },
};
const ST_ORDER = ["doing", "planned", "done", "dropped"];

/** 状態を問わずすべて取得する。自治会内での検討に使うため */
async function fetchActions(associationId) {
  const { data, error } = await supabase
    .from("v_action_effect")
    .select("action_id,title,status,owner_name,planned_on,done_on,category,item_label," +
            "baseline_score,review_score,delta")
    .eq("association_id", associationId);
  if (error) throw error;
  return (data ?? []).sort((a, b) => {
    const d = ST_ORDER.indexOf(a.status) - ST_ORDER.indexOf(b.status);
    if (d !== 0) return d;
    const da = a.delta === null || a.delta === undefined ? -99 : Number(a.delta);
    const db = b.delta === null || b.delta === undefined ? -99 : Number(b.delta);
    return db - da;
  });
}

/* ============================================================
   レーダーチャート（印刷用に自前で描画）
   ============================================================ */
function Radar({ title, items, values, compare, nameA, nameB, size = 240 }) {
  const n = items.length;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const R = size * 0.34;

  const point = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (R * Math.max(0, Math.min(5, Number(v) || 0))) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poly = (arr) => arr.map((v, i) => point(i, v).join(",")).join(" ");

  const axisEnd = (i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  };
  const labelPos = (i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + (R + 11) * Math.cos(a), cy + (R + 11) * Math.sin(a) + 3];
  };

  const hasCompare = Array.isArray(compare);

  return (
    <div className="rs-radar">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${size} ${size + 8}`} width="100%" role="img"
        aria-label={`${title}の項目別レーダーチャート`}>
        {[1, 2, 3, 4, 5].map((ring) => (
          <polygon key={ring}
            points={items.map((_, i) => point(i, ring).join(",")).join(" ")}
            fill="none" stroke="#dfe4ee" strokeWidth="0.6" />
        ))}
        {items.map((_, i) => {
          const [x, y] = axisEnd(i);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#dfe4ee" strokeWidth="0.6" />;
        })}

        {hasCompare && (
          <polygon points={poly(compare)} fill="#9aa3b4" fillOpacity="0.22"
            stroke="#8a93a5" strokeWidth="1.2" />
        )}
        <polygon points={poly(values)} fill="#1b3a6b" fillOpacity="0.24"
          stroke="#1b3a6b" strokeWidth="1.6" />

        {items.map((it, i) => {
          const [x, y] = labelPos(i);
          return (
            <text key={i} x={x} y={y} fontSize="6.5" fill="#5a6478"
              textAnchor="middle">{it.item_no}</text>
          );
        })}
      </svg>
      <p className="rs-legend-row">
        {hasCompare && <span><i className="sw gray" />{nameA}</span>}
        <span><i className="sw main" />{nameB}</span>
        <span className="rs-dim">数字は設問番号／5点満点</span>
      </p>
    </div>
  );
}

/* ============================================================
   推移グラフ（印刷用に自前で描画）
   ============================================================ */
function Trend({ data, width = 540, height = 165 }) {
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const n = data.length;
  const x = (i) => padL + (n === 1 ? w / 2 : (w * i) / (n - 1));
  const y = (v) => padT + h - (h * Math.max(0, Math.min(200, v))) / 200;

  const series = [
    { key: "総合", color: "#12274a", w: 2.2 },
    { key: "防災行動力", color: "#4f7cb8", w: 1.4 },
    { key: "初動対応力", color: "#e0a12c", w: 1.4 },
  ];

  return (
    <div className="rs-trend">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img"
        aria-label="調査回ごとの得点の推移">
        {[0, 50, 100, 150, 200].map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={width - padR} y2={y(v)}
              stroke="#e6eaf1" strokeWidth="0.7" />
            <text x={padL - 4} y={y(v) + 3} fontSize="7" fill="#8a93a5"
              textAnchor="end">{v}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={height - 6} fontSize="7.5" fill="#5a6478"
            textAnchor="middle">{d.name}</text>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <polyline
              points={data.map((d, i) => `${x(i)},${y(Number(d[s.key] ?? 0))}`).join(" ")}
              fill="none" stroke={s.color} strokeWidth={s.w} />
            {data.map((d, i) => (
              <circle key={i} cx={x(i)} cy={y(Number(d[s.key] ?? 0))} r="2.4" fill={s.color} />
            ))}
          </g>
        ))}
      </svg>
      <p className="rs-legend-row">
        {series.map((s) => (
          <span key={s.key}><i className="sw" style={{ background: s.color }} />{s.key}</span>
        ))}
        <span className="rs-dim">200点満点</span>
      </p>
    </div>
  );
}

/* ============================================================
   A4の中身
   ============================================================ */
function Sheet({
  association, cmpRound, baseRound, catRows, focus, up, actions,
  master, cmpAvg, baseAvg, trend,
}) {
  const total = Number(cmpRound.total_avg ?? 0);
  const koudou = Number(cmpRound.koudou_avg ?? 0);
  const shodou = Number(cmpRound.shodou_avg ?? 0);
  const dTotal = baseRound ? r2(total - Number(baseRound.total_avg ?? 0)) : null;
  const dK = baseRound ? r2(koudou - Number(baseRound.koudou_avg ?? 0)) : null;
  const dS = baseRound ? r2(shodou - Number(baseRound.shodou_avg ?? 0)) : null;

  const showTrend = Boolean(baseRound) && Array.isArray(trend) && trend.length >= 2;
  const hasPage2 = actions.length > 0 || showTrend || up.length > 0;

  const kpi = (label, v, max, d) => (
    <div className="rs-kpi">
      <span className="rs-kpi-k">{label}</span>
      <span className="rs-kpi-v">{v.toFixed(1)}<i>/{max}</i></span>
      {d !== null && (
        <span className={`rs-kpi-d ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>
          {d === 0 ? "増減なし" : `${fmtDelta1(d)} 前回比`}
        </span>
      )}
    </div>
  );

  const actionTable = (
    <table className="rs-table">
      <thead>
        <tr>
          <th style={{ width: 46 }}>状態</th>
          <th>やること</th>
          <th style={{ width: "16%" }}>結び付く項目</th>
          <th style={{ width: 58 }}>予定／実施</th>
          <th style={{ width: 34 }}>前</th>
          <th style={{ width: 34 }}>後</th>
          <th style={{ width: 40 }}>増減</th>
        </tr>
      </thead>
      <tbody>
        {actions.map((a) => {
          const has = a.delta !== null && a.delta !== undefined;
          const st = ST[a.status] ?? ST.planned;
          return (
            <tr key={a.action_id}>
              <td><span className="rs-st" style={{ background: st.color }}>{st.label}</span></td>
              <td>{a.title}{a.owner_name ? `（${a.owner_name}）` : ""}</td>
              <td className="rs-dim">{a.item_label ?? "—"}</td>
              <td className="rs-dim">{a.done_on ?? a.planned_on ?? "—"}</td>
              <td className="n">{has ? Number(a.baseline_score).toFixed(2) : "—"}</td>
              <td className="n">{has ? Number(a.review_score).toFixed(2) : "—"}</td>
              <td className={`n ${has && a.delta > 0 ? "up" : has && a.delta < 0 ? "down" : ""}`}>
                {has ? fmtDelta(a.delta) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div id="bosai-sheet" className="print-target">

      {/* ============ 1枚目 ============ */}
      <div className="rs-sheet">
        <header className="rs-head">
          <div>
            <p className="rs-eyebrow">地域防災力評価・改善サイクル</p>
            <h1>{association.name}　防災力アンケート結果</h1>
          </div>
          <div className="rs-headmeta">
            <b>{cmpRound.label}</b>
            <span>実施 {cmpRound.conducted_on}</span>
            <span>回答 {cmpRound.respondents ?? 0}名</span>
          </div>
        </header>

        <div className="rs-kpis">
          {kpi("総合得点", total, 200, dTotal)}
          {kpi("防災行動力", koudou, 100, dK)}
          {kpi("初動対応力", shodou, 100, dS)}
        </div>
        {baseRound && (
          <p className="rs-cmpnote">前回比は「{baseRound.label}」との比較です。</p>
        )}

        {cmpAvg && (
          <section className="rs-sec rs-full">
            <h2>項目別の評価<i>各20項目・5点満点</i></h2>
            <div className="rs-radars">
              <Radar title="防災行動力" items={master.koudou ?? []}
                values={cmpAvg.k} compare={baseAvg?.k}
                nameA={baseRound?.label ?? "基準"} nameB={cmpRound.label} />
              <Radar title="初動対応力" items={master.shodou ?? []}
                values={cmpAvg.s} compare={baseAvg?.s}
                nameA={baseRound?.label ?? "基準"} nameB={cmpRound.label} />
            </div>
          </section>
        )}

        <div className="rs-cols">
          <section className="rs-sec">
            <h2>区分別の状況<i>5点満点</i></h2>
            {catRows.map((c) => (
              <div className="rs-bar" key={c.cat}>
                <span className="rs-bar-n">{c.cat}</span>
                <span className="rs-track">
                  <span style={{ width: `${(c.now / 5) * 100}%`, background: colorOf(c.now) }} />
                </span>
                <span className="rs-bar-v">{c.now.toFixed(2)}</span>
                <span className={`rs-bar-d ${c.d > 0 ? "up" : c.d < 0 ? "down" : ""}`}>
                  {c.d === null ? "" : fmtDelta(c.d)}
                </span>
              </div>
            ))}
          </section>

          <section className="rs-sec">
            <h2>とくに低い項目<i>5点満点</i></h2>
            {focus.length === 0 ? (
              <p className="rs-none">2.0点を下回る項目はありませんでした。</p>
            ) : (
              <ol className="rs-focus">
                {focus.map((f) => (
                  <li key={`${f.section}-${f.item_no}`}>
                    <span className="rs-f-top">
                      <b>{f.label}</b>
                      <em style={{ color: colorOf(f.now) }}>{f.now.toFixed(2)}</em>
                    </span>
                    <span className="rs-f-sub">{f.sec}／{f.category}・{stateOf(f.now)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {!hasPage2 && (
          <section className="rs-sec rs-full">
            <h2>改善の取り組み</h2>
            <p className="rs-none">
              記録されている取り組みはありません。
              管理画面の「改善の取り組み」から登録できます。
            </p>
          </section>
        )}

        <footer className="rs-foot">
          <span>{association.name}　作成日 {new Date().toISOString().slice(0, 10)}</span>
          <span>
            各項目は5点満点。総合得点は防災行動力100点＋初動対応力100点の200点満点です。
            {hasPage2 && "（1／2）"}
          </span>
        </footer>
      </div>

      {/* ============ 2枚目 ============ */}
      {hasPage2 && (
        <div className="rs-sheet">
          <header className="rs-head slim">
            <div>
              <h1>{association.name}　改善の取り組みと推移</h1>
            </div>
            <div className="rs-headmeta">
              <b>{cmpRound.label}</b>
            </div>
          </header>

          {showTrend && (
            <section className="rs-sec rs-full">
              <h2>得点の推移<i>回答のあった調査回すべて</i></h2>
              <Trend data={trend} />
            </section>
          )}

          <section className="rs-sec rs-full">
            <h2>改善の取り組み<i>予定・実施中を含むすべて</i></h2>
            {actions.length === 0 ? (
              <p className="rs-none">
                記録されている取り組みはありません。
                管理画面の「改善の取り組み」から登録できます。
              </p>
            ) : actionTable}
          </section>

          {up.length > 0 && (
            <section className="rs-sec rs-full">
              <h2>前回から伸びた項目</h2>
              <div className="rs-ups">
                {up.map((x) => (
                  <span className="rs-up" key={`${x.section}-${x.item_no}`}>
                    <b>{x.label}</b>
                    <i>{x.prev.toFixed(2)} → {x.now.toFixed(2)}</i>
                    <em>{fmtDelta(x.d)}</em>
                  </span>
                ))}
              </div>
            </section>
          )}

          <footer className="rs-foot">
            <span>{association.name}　作成日 {new Date().toISOString().slice(0, 10)}</span>
            <span>「前」「後」は、取り組みに結び付けた設問の平均点です（5点満点）。（2／2）</span>
          </footer>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   本体
   ============================================================ */
export default function ReportSheet({
  association, cmpRound, baseRound, catRows, deltas, focus,
  master, cmpAvg, baseAvg, trend,
}) {
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !association?.id) return;
      setLoading(true);
      try {
        const a = await fetchActions(association.id);
        if (!cancelled) setActions(a.slice(0, 16));
      } catch {
        if (!cancelled) setActions([]);   // 未登録・未実行でも資料は出せる
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, association?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  /*
   * この資料を開いているあいだは「ここだけを印刷する」状態にしておきます。
   * ブラウザが画面の印刷ボタンを止めてしまい、利用者が Ctrl+P で
   * 印刷し直した場合でも、管理画面まるごとではなくこの資料だけが出ます。
   */
  useEffect(() => {
    if (!open || loading) return undefined;
    beginPrintScope("#bosai-sheet");
    return () => endPrintScope();
  }, [open, loading, actions]);

  const topFocus = useMemo(() => (focus ?? []).slice(0, 6), [focus]);
  const topUp = useMemo(
    () => (deltas?.up ?? []).filter((x) => x.d > 0).slice(0, 6),
    [deltas]
  );

  if (!association || !cmpRound) return null;

  return (
    <div className="dz-card">
      <style>{RS_CSS}</style>
      {open && <style>{RS_PRINT_CSS}</style>}

      <h2 className="no-print">総会用の印刷資料</h2>
      <p className="dz-muted no-print">
        A4縦にまとめて印刷できます。取り組みや推移がある場合は自動で裏面（2枚目）に続きます。
        印刷画面で「送信先」を「PDFに保存」にすれば、そのまま配布用のPDFになります。
      </p>
      <div className="dz-actions no-print">
        <button className="dz-btn" onClick={() => setOpen(true)}>印刷資料を開く</button>
      </div>

      {open && (
        <div className="rs-overlay" role="dialog" aria-label="総会用の印刷資料">
          <div className="rs-bar-top">
            <span className="rs-bar-title">印刷プレビュー（A4縦）</span>
            <div className="rs-bar-ops">
              <button className="dz-btn" onClick={() => window.print()}>印刷／PDFに保存</button>
              <button className="dz-btn xs ghost light" onClick={() => setOpen(false)}>閉じる</button>
            </div>
          </div>
          <div className="rs-stage">
            {loading
              ? <p className="rs-loading">取り組みの記録を読み込んでいます…</p>
              : (
                <Sheet association={association} cmpRound={cmpRound} baseRound={baseRound}
                  catRows={catRows ?? []} focus={topFocus} up={topUp} actions={actions}
                  master={master ?? { koudou: [], shodou: [] }}
                  cmpAvg={cmpAvg} baseAvg={baseAvg} trend={trend ?? []} />
              )}
          </div>
          <p className="rs-tip">
            ボタンを押しても印刷画面が出ないときは、<b>この画面を開いたまま</b>
            キーボードの <b>Ctrl+P</b>（Macは <b>⌘+P</b>）を押してください。
            ブラウザが自動の印刷を止めることがありますが、その場合でもこの資料だけが刷られます。
            <br />
            文字が入りきらない場合は、印刷画面の「倍率」を90%にすると収まります。
            棒グラフやレーダーの色が出ないときは「背景のグラフィック」にチェックを入れてください。
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   画面表示用のスタイル
   ============================================================ */
const RS_CSS = `
.rs-overlay{position:fixed;inset:0;z-index:900;background:#26304a;
 display:flex;flex-direction:column;align-items:center;overflow:auto;padding-bottom:28px;}
.rs-bar-top{position:sticky;top:0;z-index:2;width:100%;background:#12274a;color:#fff;
 display:flex;justify-content:space-between;align-items:center;gap:16px;padding:11px 18px;
 border-bottom:4px solid #e0a12c;}
.rs-bar-title{font-size:14px;font-weight:800;letter-spacing:.08em;}
.rs-bar-ops{display:flex;gap:10px;align-items:center;}
.rs-stage{padding:22px 14px 0;display:flex;flex-direction:column;align-items:center;}
.rs-loading{color:#fff;padding:40px;font-size:14px;}
.rs-tip{color:rgba(255,255,255,.75);font-size:12px;margin:14px 18px 0;text-align:center;
 max-width:640px;}

/* ---- A4のシート ---- */
.rs-sheet{width:210mm;min-height:297mm;background:#fff;color:#141a28;
 padding:13mm 12mm;box-sizing:border-box;box-shadow:0 6px 30px rgba(0,0,0,.35);
 font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",YuGothic,
 "Noto Sans JP",Meiryo,sans-serif;line-height:1.45;font-size:9.5pt;
 display:flex;flex-direction:column;margin-bottom:20px;}
.rs-sheet:last-child{margin-bottom:0;}
.rs-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;
 border-bottom:3px solid #12274a;padding-bottom:7px;}
.rs-head.slim{border-bottom-width:2px;}
.rs-eyebrow{font-size:7pt;letter-spacing:.3em;color:#5a6478;margin:0 0 2px;}
.rs-head h1{font-size:15pt;font-weight:900;margin:0;letter-spacing:.01em;}
.rs-head.slim h1{font-size:12.5pt;}
.rs-headmeta{text-align:right;display:flex;flex-direction:column;gap:1px;}
.rs-headmeta b{font-size:9.5pt;font-weight:800;}
.rs-headmeta span{font-size:8pt;color:#5a6478;}

.rs-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px;}
.rs-kpi{border:1px solid #d4d9e2;border-radius:4px;padding:7px 10px;}
.rs-kpi-k{display:block;font-size:7.5pt;letter-spacing:.14em;color:#5a6478;}
.rs-kpi-v{display:block;font-size:19pt;font-weight:900;line-height:1.15;
 font-variant-numeric:tabular-nums;}
.rs-kpi-v i{font-style:normal;font-size:9pt;color:#5a6478;font-weight:700;margin-left:2px;}
.rs-kpi-d{display:block;font-size:8pt;font-weight:800;font-variant-numeric:tabular-nums;
 color:#5a6478;}
.rs-cmpnote{font-size:7.5pt;color:#5a6478;margin:3px 0 0;}

.rs-cols{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8px;}
.rs-sec{break-inside:avoid;}
.rs-sec h2{font-size:9.5pt;font-weight:900;margin:0 0 5px;padding:3px 8px;
 background:#1b3a6b;color:#fff;border-radius:3px;display:flex;justify-content:space-between;
 align-items:baseline;}
.rs-sec h2 i{font-style:normal;font-size:7pt;font-weight:400;opacity:.85;}
.rs-full{margin-top:9px;}
.rs-none{font-size:8.5pt;color:#5a6478;margin:0;}

.rs-radars{display:grid;grid-template-columns:1fr 1fr;gap:8mm;}
.rs-radar h3{font-size:8.5pt;font-weight:800;margin:0 0 1px;text-align:center;}
.rs-radar svg{display:block;}
.rs-legend-row{display:flex;flex-wrap:wrap;gap:9px;justify-content:center;align-items:center;
 font-size:7pt;color:#141a28;margin:1px 0 0;}
.rs-legend-row .sw{display:inline-block;width:9px;height:9px;border-radius:2px;
 margin-right:3px;vertical-align:-1px;}
.rs-legend-row .sw.main{background:#1b3a6b;}
.rs-legend-row .sw.gray{background:#9aa3b4;}
.rs-legend-row .rs-dim{color:#8a93a5;}
.rs-trend svg{display:block;}

.rs-bar{display:grid;grid-template-columns:52px 1fr 30px 34px;gap:5px;align-items:center;
 margin-bottom:3px;}
.rs-bar-n{font-size:8pt;font-weight:700;}
.rs-track{display:block;height:9px;background:#e6eaf1;border-radius:2px;overflow:hidden;}
.rs-track span{display:block;height:100%;}
.rs-bar-v{font-size:8.5pt;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;}
.rs-bar-d{font-size:7.5pt;font-weight:800;text-align:right;color:#5a6478;
 font-variant-numeric:tabular-nums;}

.rs-focus{list-style:none;margin:0;padding:0;counter-reset:f;}
.rs-focus li{counter-increment:f;padding:2px 0 2px 16px;position:relative;
 border-bottom:1px dotted #d4d9e2;}
.rs-focus li:before{content:counter(f);position:absolute;left:0;top:2px;font-size:7.5pt;
 font-weight:900;color:#c1272d;}
.rs-f-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}
.rs-f-top b{font-size:8.5pt;font-weight:800;line-height:1.3;}
.rs-f-top em{font-style:normal;font-size:9.5pt;font-weight:900;
 font-variant-numeric:tabular-nums;}
.rs-f-sub{display:block;font-size:7pt;color:#5a6478;}

.rs-table{width:100%;border-collapse:collapse;font-size:8pt;}
.rs-table th,.rs-table td{border:1px solid #d4d9e2;padding:3px 5px;text-align:left;
 vertical-align:top;line-height:1.35;}
.rs-table th{background:#e4eaf4;font-weight:800;font-size:7.5pt;}
.rs-table td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;}
.rs-st{display:inline-block;color:#fff;font-weight:800;font-size:7pt;border-radius:2px;
 padding:1px 5px;}
.rs-dim{color:#5a6478;}

.rs-ups{display:flex;flex-wrap:wrap;gap:5px;}
.rs-up{display:flex;align-items:baseline;gap:6px;border:1px solid #d4d9e2;border-radius:3px;
 padding:3px 8px;}
.rs-up b{font-size:8pt;font-weight:800;}
.rs-up i{font-style:normal;font-size:7pt;color:#5a6478;font-variant-numeric:tabular-nums;}
.rs-up em{font-style:normal;font-size:8pt;font-weight:900;color:#1b3a6b;
 font-variant-numeric:tabular-nums;}

.rs-foot{display:flex;justify-content:space-between;gap:12px;margin-top:auto;padding-top:5px;
 border-top:1px solid #d4d9e2;font-size:7pt;color:#5a6478;}
.rs-sheet .up{color:#0f7a5a;}
.rs-sheet .down{color:#c1272d;}

@media (max-width:820px){
  .rs-stage{padding:14px 0 0;}
  .rs-sheet{width:100%;min-height:0;padding:8mm;box-shadow:none;}
  .rs-cols,.rs-radars{grid-template-columns:1fr;gap:12px;}
}
`;

/* ============================================================
   印刷用のスタイル
   印刷資料を開いている間だけ読み込みます。
   常に読み込んでいると、個票の印刷や画面全体の印刷まで
   このシート以外が消えてしまうためです。
   ============================================================ */
const RS_PRINT_CSS = `
@media print{
  /* 対象以外を隠すのは共通のしくみに任せ、ここは体裁だけを整える */
  .rs-overlay{position:static!important;background:none!important;padding:0!important;
   overflow:visible!important;display:block!important;}
  .rs-bar-top,.rs-tip{display:none!important;}
  .rs-stage{padding:0!important;display:block!important;}

  /* 幅を 210mm と決め打ちすると、@page の余白（左右あわせて24mm）の分だけ
     横にはみ出し、そのはみ出しを刷るための白紙が増えます。
     紙の余白を差し引いた幅に自動で合わせます。 */
  #bosai-sheet{width:auto!important;max-width:none!important;
   margin:0!important;padding:0!important;}
  .rs-sheet{width:auto!important;max-width:none!important;
   min-height:0!important;height:auto!important;display:block!important;
   margin:0!important;padding:0!important;box-shadow:none!important;}

  /* 改ページは「2枚目の前」に入れる。
     1枚目の後ろに入れると、2枚目が無いときに白紙が1枚増えます。 */
  .rs-sheet + .rs-sheet{break-before:page;page-break-before:always;}

  .rs-cols,.rs-radars{grid-template-columns:1fr 1fr!important;}
  .rs-sec,.rs-table,.rs-bar,.rs-focus li,.rs-radar,.rs-trend{break-inside:avoid;}
  .rs-foot{margin-top:10px!important;}
  @page{size:A4 portrait;margin:12mm;}
}
`;
