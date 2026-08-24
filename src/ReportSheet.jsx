/**
 * 地域防災力評価システム / 総会用の1枚レポート
 *
 * 置き場所： src/ReportSheet.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * 画面上の集計を、A4縦1枚に収まる形にまとめて印刷・PDF保存するための画面です。
 * 自治会の総会や役員会は結局「紙で配る」場面が多いので、
 * そこへの橋渡しをする機能です。
 *
 * グラフは使わず、印刷しても崩れない横棒と表だけで構成しています。
 */
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/bosai-supabase-api";

const r2 = (x) => Math.round(x * 100) / 100;
const fmtDelta = (d) => (d > 0 ? `+${Number(d).toFixed(2)}` : Number(d).toFixed(2));
const fmtDelta1 = (d) => (d > 0 ? `+${Number(d).toFixed(1)}` : Number(d).toFixed(1));

const stateOf = (v) => (v < 1.5 ? "重点課題" : v < 2.5 ? "要強化" : v < 3.5 ? "標準" : "良好");
const colorOf = (v) => (v < 1.5 ? "#c1272d" : v < 2.5 ? "#e0a12c" : v < 3.5 ? "#8a968e" : "#00703c");

const ST_LABEL = { planned: "予定", doing: "実施中", done: "実施済", dropped: "見送り" };

/** 実施中・実施済の取り組みだけを、効果の大きい順に */
async function fetchActions(associationId) {
  const { data, error } = await supabase
    .from("v_action_effect")
    .select("action_id,title,status,owner_name,done_on,category,item_label,baseline_score,review_score,delta")
    .eq("association_id", associationId);
  if (error) throw error;
  return (data ?? [])
    .filter((a) => a.status === "done" || a.status === "doing")
    .sort((a, b) => {
      const da = a.delta === null || a.delta === undefined ? -99 : Number(a.delta);
      const db = b.delta === null || b.delta === undefined ? -99 : Number(b.delta);
      return db - da;
    });
}

/* ============================================================
   A4の中身
   ============================================================ */
function Sheet({ association, cmpRound, baseRound, catRows, focus, up, actions }) {
  const total = Number(cmpRound.total_avg ?? 0);
  const koudou = Number(cmpRound.koudou_avg ?? 0);
  const shodou = Number(cmpRound.shodou_avg ?? 0);
  const dTotal = baseRound ? r2(total - Number(baseRound.total_avg ?? 0)) : null;
  const dK = baseRound ? r2(koudou - Number(baseRound.koudou_avg ?? 0)) : null;
  const dS = baseRound ? r2(shodou - Number(baseRound.shodou_avg ?? 0)) : null;

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

  return (
    <div className="rs-sheet" id="bosai-sheet">
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

      <div className="rs-cols">
        {/* 区分別 */}
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

        {/* 重点課題 */}
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

      {/* 取り組み */}
      <section className="rs-sec rs-full">
        <h2>今年度の取り組みと効果</h2>
        {actions.length === 0 ? (
          <p className="rs-none">
            記録されている取り組みはありません。管理画面の「改善の取り組み」から登録できます。
          </p>
        ) : (
          <table className="rs-table">
            <thead>
              <tr>
                <th>やったこと</th>
                <th style={{ width: "17%" }}>結び付く項目</th>
                <th style={{ width: 44 }}>状態</th>
                <th style={{ width: 40 }}>前</th>
                <th style={{ width: 40 }}>後</th>
                <th style={{ width: 46 }}>増減</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => {
                const has = a.delta !== null && a.delta !== undefined;
                return (
                  <tr key={a.action_id}>
                    <td>{a.title}{a.owner_name ? `（${a.owner_name}）` : ""}</td>
                    <td className="rs-dim">{a.item_label ?? "—"}</td>
                    <td>{ST_LABEL[a.status] ?? ""}</td>
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
        )}
      </section>

      {/* 伸びた項目 */}
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
        <span>作成日 {new Date().toISOString().slice(0, 10)}</span>
        <span>各項目は5点満点。総合得点は防災行動力100点＋初動対応力100点の200点満点です。</span>
      </footer>
    </div>
  );
}

/* ============================================================
   本体
   ============================================================ */
export default function ReportSheet({ association, cmpRound, baseRound, catRows, deltas, focus }) {
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
        if (!cancelled) setActions(a.slice(0, 6));
      } catch {
        if (!cancelled) setActions([]);   // 未登録・未実行でもレポートは出せる
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

  const topFocus = useMemo(() => (focus ?? []).slice(0, 6), [focus]);
  const topUp = useMemo(
    () => (deltas?.up ?? []).filter((x) => x.d > 0).slice(0, 4),
    [deltas]
  );

  if (!association || !cmpRound) return null;

  return (
    <div className="dz-card">
      <style>{RS_CSS}</style>
      {open && <style>{RS_PRINT_CSS}</style>}
      <h2>総会用の1枚レポート</h2>
      <p className="dz-muted">
        ここまでの集計を、A4縦1枚に収めた形で印刷できます。
        印刷画面で「送信先」を「PDFに保存」にすれば、そのまま配布用のPDFになります。
      </p>
      <div className="dz-actions">
        <button className="dz-btn" onClick={() => setOpen(true)}>1枚レポートを開く</button>
      </div>

      {open && (
        <div className="rs-overlay" role="dialog" aria-label="総会用の1枚レポート">
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
                  catRows={catRows ?? []} focus={topFocus} up={topUp} actions={actions} />
              )}
          </div>
          <p className="rs-tip">
            文字が入りきらない場合は、印刷画面の「倍率」を90%にすると収まります。
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   スタイル
   画面表示用と印刷用を分けています。
   印刷時は body 全体を非表示にし、シートだけを出します。
   ============================================================ */
const RS_CSS = `
.rs-overlay{position:fixed;inset:0;z-index:900;background:#3a453f;
 display:flex;flex-direction:column;align-items:center;overflow:auto;padding-bottom:28px;}
.rs-bar-top{position:sticky;top:0;z-index:2;width:100%;background:#004f2a;color:#fff;
 display:flex;justify-content:space-between;align-items:center;gap:16px;padding:11px 18px;
 border-bottom:4px solid #e0a12c;}
.rs-bar-title{font-size:14px;font-weight:800;letter-spacing:.08em;}
.rs-bar-ops{display:flex;gap:10px;align-items:center;}
.rs-stage{padding:22px 14px 0;}
.rs-loading{color:#fff;padding:40px;font-size:14px;}
.rs-tip{color:rgba(255,255,255,.75);font-size:12px;margin:14px 18px 0;text-align:center;}

/* ---- A4のシート ---- */
.rs-sheet{width:210mm;min-height:297mm;background:#fff;color:#16211c;
 padding:14mm 13mm;box-sizing:border-box;box-shadow:0 6px 30px rgba(0,0,0,.35);
 font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",YuGothic,
 "Noto Sans JP",Meiryo,sans-serif;line-height:1.5;font-size:10pt;}
.rs-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;
 border-bottom:3px solid #004f2a;padding-bottom:8px;}
.rs-eyebrow{font-size:7pt;letter-spacing:.3em;color:#5b6b62;margin:0 0 2px;}
.rs-head h1{font-size:16pt;font-weight:900;margin:0;letter-spacing:.01em;}
.rs-headmeta{text-align:right;display:flex;flex-direction:column;gap:1px;}
.rs-headmeta b{font-size:10pt;font-weight:800;}
.rs-headmeta span{font-size:8pt;color:#5b6b62;}

.rs-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;}
.rs-kpi{border:1px solid #d3dbd5;border-radius:4px;padding:8px 11px;}
.rs-kpi-k{display:block;font-size:7.5pt;letter-spacing:.14em;color:#5b6b62;}
.rs-kpi-v{display:block;font-size:20pt;font-weight:900;line-height:1.15;
 font-variant-numeric:tabular-nums;}
.rs-kpi-v i{font-style:normal;font-size:9pt;color:#5b6b62;font-weight:700;margin-left:2px;}
.rs-kpi-d{display:block;font-size:8pt;font-weight:800;font-variant-numeric:tabular-nums;
 color:#5b6b62;}
.rs-cmpnote{font-size:7.5pt;color:#5b6b62;margin:4px 0 0;}

.rs-cols{display:grid;grid-template-columns:1fr 1fr;gap:9mm;margin-top:9px;}
.rs-sec{break-inside:avoid;}
.rs-sec h2{font-size:9.5pt;font-weight:900;margin:0 0 6px;padding:3px 8px;
 background:#00703c;color:#fff;border-radius:3px;display:flex;justify-content:space-between;
 align-items:baseline;}
.rs-sec h2 i{font-style:normal;font-size:7pt;font-weight:400;opacity:.85;}
.rs-full{margin-top:10px;}
.rs-none{font-size:8.5pt;color:#5b6b62;margin:0;}

.rs-bar{display:grid;grid-template-columns:52px 1fr 30px 34px;gap:5px;align-items:center;
 margin-bottom:3px;}
.rs-bar-n{font-size:8pt;font-weight:700;}
.rs-track{display:block;height:9px;background:#e6ebe7;border-radius:2px;overflow:hidden;}
.rs-track span{display:block;height:100%;}
.rs-bar-v{font-size:8.5pt;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;}
.rs-bar-d{font-size:7.5pt;font-weight:800;text-align:right;color:#5b6b62;
 font-variant-numeric:tabular-nums;}

.rs-focus{list-style:none;margin:0;padding:0;counter-reset:f;}
.rs-focus li{counter-increment:f;padding:3px 0 3px 17px;position:relative;
 border-bottom:1px dotted #d3dbd5;}
.rs-focus li:before{content:counter(f);position:absolute;left:0;top:3px;font-size:7.5pt;
 font-weight:900;color:#c1272d;}
.rs-f-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}
.rs-f-top b{font-size:8.5pt;font-weight:800;line-height:1.35;}
.rs-f-top em{font-style:normal;font-size:9.5pt;font-weight:900;
 font-variant-numeric:tabular-nums;}
.rs-f-sub{display:block;font-size:7pt;color:#5b6b62;}

.rs-table{width:100%;border-collapse:collapse;font-size:8pt;}
.rs-table th,.rs-table td{border:1px solid #d3dbd5;padding:3px 6px;text-align:left;
 vertical-align:top;line-height:1.4;}
.rs-table th{background:#e3efe8;font-weight:800;font-size:7.5pt;}
.rs-table td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;}
.rs-dim{color:#5b6b62;}

.rs-ups{display:flex;flex-wrap:wrap;gap:5px;}
.rs-up{display:flex;align-items:baseline;gap:6px;border:1px solid #d3dbd5;border-radius:3px;
 padding:3px 8px;}
.rs-up b{font-size:8pt;font-weight:800;}
.rs-up i{font-style:normal;font-size:7pt;color:#5b6b62;font-variant-numeric:tabular-nums;}
.rs-up em{font-style:normal;font-size:8pt;font-weight:900;color:#00703c;
 font-variant-numeric:tabular-nums;}

.rs-foot{display:flex;justify-content:space-between;gap:12px;margin-top:12px;padding-top:5px;
 border-top:1px solid #d3dbd5;font-size:7pt;color:#5b6b62;}
.rs-sheet .up{color:#00703c;}
.rs-sheet .down{color:#c1272d;}

@media (max-width:820px){
  .rs-stage{padding:14px 0 0;}
  .rs-sheet{width:100%;min-height:0;padding:8mm;box-shadow:none;}
  .rs-cols{grid-template-columns:1fr;gap:12px;}
}

`;


/* ============================================================
   印刷用のスタイル
   1枚レポートを開いている間だけ読み込みます。
   常に読み込んでいると、個票の印刷や画面全体の印刷まで
   このシート以外が消えてしまうためです。
   ============================================================ */
const RS_PRINT_CSS = `
@media print{
  body *{visibility:hidden!important;}
  #bosai-sheet,#bosai-sheet *{visibility:visible!important;}
  #bosai-sheet{position:absolute!important;left:0;top:0;width:210mm!important;
   min-height:0!important;margin:0!important;padding:0!important;box-shadow:none!important;}
  .rs-overlay{position:static!important;background:none!important;padding:0!important;
   overflow:visible!important;}
  .rs-bar-top,.rs-tip{display:none!important;}
  .rs-stage{padding:0!important;}
  .rs-cols{grid-template-columns:1fr 1fr!important;}
  .rs-sec,.rs-table,.rs-bar,.rs-focus li{break-inside:avoid;}
  @page{size:A4 portrait;margin:12mm;}
}
`;
