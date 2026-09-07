/**
 * 地域防災力評価システム / 改善アクション管理
 *
 * 置き場所： src/ActionPlan.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * 「評価 → 改善 → 再評価」のうち、これまで人の頭の中にしかなかった
 * 「改善」の部分を記録する画面です。
 * 提案を登録しておくと、次の調査回でその項目の点数がどう動いたかを
 * 自動で突き合わせます。
 *
 * 前提：sql/03-improvement.sql を Supabase で実行済みであること
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./lib/bosai-supabase-api";

const STATUSES = [
  { key: "planned", label: "予定",   color: "#e0a12c" },
  { key: "doing",   label: "実施中", color: "#0b6fa4" },
  { key: "done",    label: "実施済", color: "#0f7a5a" },
  { key: "dropped", label: "見送り", color: "#9aa3b4" },
];
const statusOf = (k) => STATUSES.find((s) => s.key === k) ?? STATUSES[0];

const fmtDelta = (d) => (d > 0 ? `+${Number(d).toFixed(2)}` : Number(d).toFixed(2));
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  title: "", detail: "", item: "", status: "planned",
  planned_on: "", done_on: "", owner_name: "",
  baseline_round_id: "", review_round_id: "", note: "",
};

/* ------------------------------------------------------------
   データ取得
   ------------------------------------------------------------ */
async function fetchActions(associationId) {
  const [{ data: rows, error: e1 }, { data: eff, error: e2 }] = await Promise.all([
    supabase.from("improvement_actions")
      .select("*").eq("association_id", associationId)
      .order("created_at", { ascending: false }),
    supabase.from("v_action_effect")
      .select("action_id,category,item_label,baseline_score,review_score,delta")
      .eq("association_id", associationId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const byId = Object.fromEntries((eff ?? []).map((e) => [e.action_id, e]));
  return (rows ?? []).map((r) => ({ ...r, ...(byId[r.id] ?? {}) }));
}

/* ------------------------------------------------------------
   入力フォーム（新規・編集で共用）
   ------------------------------------------------------------ */
function Form({ value, onChange, master, rounds, onSave, onCancel, onDelete, busy }) {
  const set = (k, v) => onChange({ ...value, [k]: v });

  const items = [
    ...(master.koudou ?? []).map((it) => ({ ...it, secLabel: "防災行動力" })),
    ...(master.shodou ?? []).map((it) => ({ ...it, secLabel: "初動対応力" })),
  ];

  /* 項目を選んだら、その項目の改善のヒントを下書きとして入れる */
  const pickItem = (v) => {
    const it = items.find((x) => `${x.section}-${x.item_no}` === v);
    if (it && !value.title.trim()) {
      onChange({ ...value, item: v, title: it.improvement_tip });
    } else {
      set("item", v);
    }
  };

  return (
    <div className="ap-form">
      <div className="ap-grid">
        <div className="ap-f wide">
          <label htmlFor="ap-title">やること</label>
          <input id="ap-title" value={value.title} maxLength={200}
            placeholder="例）水消火器を使った実技訓練を全班で実施する"
            onChange={(e) => set("title", e.target.value)} />
        </div>

        <div className="ap-f wide">
          <label htmlFor="ap-item">結び付ける設問</label>
          <select id="ap-item" value={value.item} onChange={(e) => pickItem(e.target.value)}>
            <option value="">結び付けない（全体の取り組み）</option>
            {items.map((it) => (
              <option key={`${it.section}-${it.item_no}`} value={`${it.section}-${it.item_no}`}>
                {it.secLabel}／{it.category}／{it.item_no}. {it.label}
              </option>
            ))}
          </select>
          <p className="ap-help">
            設問を結び付けると、次の調査回でその点数がどう動いたかを自動で表示します。
          </p>
        </div>

        <div className="ap-f">
          <label htmlFor="ap-status">状態</label>
          <select id="ap-status" value={value.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <div className="ap-f">
          <label htmlFor="ap-owner">担当</label>
          <input id="ap-owner" value={value.owner_name} maxLength={60}
            placeholder="例）防災部・田中"
            onChange={(e) => set("owner_name", e.target.value)} />
        </div>

        <div className="ap-f">
          <label htmlFor="ap-planned">実施予定日</label>
          <input id="ap-planned" type="date" value={value.planned_on}
            onChange={(e) => set("planned_on", e.target.value)} />
        </div>

        <div className="ap-f">
          <label htmlFor="ap-done">実施日</label>
          <input id="ap-done" type="date" value={value.done_on}
            onChange={(e) => set("done_on", e.target.value)} />
        </div>

        <div className="ap-f">
          <label htmlFor="ap-base">課題が見つかった回</label>
          <select id="ap-base" value={value.baseline_round_id}
            onChange={(e) => set("baseline_round_id", e.target.value)}>
            <option value="">指定しない</option>
            {rounds.map((r) => <option key={r.round_id} value={r.round_id}>{r.label}</option>)}
          </select>
        </div>

        <div className="ap-f">
          <label htmlFor="ap-review">効果を確かめる回</label>
          <select id="ap-review" value={value.review_round_id}
            onChange={(e) => set("review_round_id", e.target.value)}>
            <option value="">まだ決めない</option>
            {rounds.map((r) => <option key={r.round_id} value={r.round_id}>{r.label}</option>)}
          </select>
          <p className="ap-help">
            次の調査回を作ったあとで選べば十分です。両方そろうと点数の変化が出ます。
          </p>
        </div>

        <div className="ap-f wide">
          <label htmlFor="ap-detail">内容・メモ</label>
          <textarea id="ap-detail" rows={3} value={value.detail}
            placeholder="日程、協力先（消防署など）、当日の段取りなど"
            onChange={(e) => set("detail", e.target.value)} />
        </div>
      </div>

      <div className="ap-actions">
        <button className="dz-btn" disabled={busy || !value.title.trim()} onClick={onSave}>
          {busy ? "保存しています…" : "保存"}
        </button>
        <button className="dz-btn xs ghost" disabled={busy} onClick={onCancel}>やめる</button>
        {onDelete && (
          <button className="ap-del" disabled={busy} onClick={onDelete}>削除</button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   本体
   ============================================================ */
export default function ActionPlan({ association, rounds, master, cmpId, focus }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY);

  const load = useCallback(async () => {
    if (!association?.id) return;
    setLoading(true); setErr("");
    try {
      setRows(await fetchActions(association.id));
    } catch (e) { setErr(e.message ?? String(e)); }
    finally { setLoading(false); }
  }, [association?.id]);

  useEffect(() => { load(); }, [load]);

  const needsSql = err && /improvement_actions|v_action_effect|schema cache|does not exist/i.test(err);

  /* ---- 保存 ---- */
  const toRow = (d) => {
    const [section, itemNo] = d.item ? d.item.split("-") : [null, null];
    return {
      association_id: association.id,
      title: d.title.trim(),
      detail: d.detail.trim() || null,
      section: section || null,
      item_no: itemNo ? Number(itemNo) : null,
      status: d.status,
      planned_on: d.planned_on || null,
      done_on: d.done_on || null,
      owner_name: d.owner_name.trim() || null,
      baseline_round_id: d.baseline_round_id || null,
      review_round_id: d.review_round_id || null,
    };
  };

  const save = async () => {
    setBusy(true); setMsg(""); setErr("");
    try {
      const { error } = await supabase.from("improvement_actions").insert(toRow(draft));
      if (error) throw error;
      setDraft(EMPTY); setAdding(false);
      setMsg("登録しました。");
      await load();
    } catch (e) { setErr(`登録できませんでした：${e.message}`); }
    finally { setBusy(false); }
  };

  const update = async () => {
    setBusy(true); setMsg(""); setErr("");
    try {
      const { association_id, ...patch } = toRow(editDraft);
      const { error } = await supabase.from("improvement_actions")
        .update(patch).eq("id", editId);
      if (error) throw error;
      setEditId(null);
      setMsg("更新しました。");
      await load();
    } catch (e) { setErr(`更新できませんでした：${e.message}`); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("この取り組みを削除します。元に戻せません。よろしいですか？")) return;
    setBusy(true); setMsg(""); setErr("");
    try {
      const { error } = await supabase.from("improvement_actions").delete().eq("id", editId);
      if (error) throw error;
      setEditId(null);
      setMsg("削除しました。");
      await load();
    } catch (e) { setErr(`削除できませんでした：${e.message}`); }
    finally { setBusy(false); }
  };

  /* 一覧の状態プルダウンから直接変える */
  const quickStatus = async (id, status) => {
    setBusy(true); setErr("");
    try {
      const patch = { status };
      if (status === "done") patch.done_on = rows.find((r) => r.id === id)?.done_on ?? today();
      const { error } = await supabase.from("improvement_actions").update(patch).eq("id", id);
      if (error) throw error;
      await load();
    } catch (e) { setErr(`変更できませんでした：${e.message}`); }
    finally { setBusy(false); }
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setEditDraft({
      title: r.title ?? "", detail: r.detail ?? "",
      item: r.section && r.item_no ? `${r.section}-${r.item_no}` : "",
      status: r.status ?? "planned",
      planned_on: r.planned_on ?? "", done_on: r.done_on ?? "",
      owner_name: r.owner_name ?? "",
      baseline_round_id: r.baseline_round_id ?? "",
      review_round_id: r.review_round_id ?? "",
    });
  };

  /* ---- 提案からの登録 ---- */
  const startFromFocus = (f) => {
    setEditId(null);
    setAdding(true);
    setDraft({
      ...EMPTY,
      title: f.improvement_tip ?? "",
      item: `${f.section}-${f.item_no}`,
      baseline_round_id: cmpId ?? "",
    });
    setTimeout(() => document.getElementById("ap-title")?.focus(), 80);
  };

  const linked = useMemo(
    () => new Set(rows.filter((r) => r.section && r.item_no).map((r) => `${r.section}-${r.item_no}`)),
    [rows]
  );
  const unlinked = useMemo(
    () => (focus ?? []).filter((f) => !linked.has(`${f.section}-${f.item_no}`)),
    [focus, linked]
  );

  const counts = useMemo(() => {
    const c = { all: rows.length };
    STATUSES.forEach((s) => { c[s.key] = rows.filter((r) => r.status === s.key).length; });
    return c;
  }, [rows]);

  const view = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const roundLabel = (id) => rounds.find((r) => r.round_id === id)?.label ?? "";

  const exportCsv = () => {
    const head = ["やること", "状態", "担当", "実施予定日", "実施日", "区分", "設問",
      "課題が見つかった回", "その時の点数", "効果を確かめる回", "その時の点数", "増減", "メモ"];
    const body = rows.map((r) => [
      r.title, statusOf(r.status).label, r.owner_name ?? "",
      r.planned_on ?? "", r.done_on ?? "",
      r.category ?? "", r.item_label ?? "",
      roundLabel(r.baseline_round_id), r.baseline_score ?? "",
      roundLabel(r.review_round_id), r.review_score ?? "",
      r.delta ?? "", r.detail ?? "",
    ]);
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `改善の取り組み_${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!association) return null;

  return (
    <div className="dz-card">
      <style>{AP_CSS}</style>
      <h2>改善の取り組み</h2>
      <p className="dz-muted">
        次回への提案を、やることとして記録します。設問を結び付けておくと、
        次の調査回で点数がどう動いたかがここに出ます。
      </p>

      {needsSql ? (
        <div className="ap-guard">
          <p><b>この画面には準備がもう一手間必要です。</b></p>
          <p>
            Supabase の SQL Editor で <code>sql/03-improvement.sql</code> を実行してください。
            実行後にこのページを再読み込みすると表示されます。
          </p>
        </div>
      ) : (
        <>
          {err && <p className="dz-err">{err}</p>}
          {msg && <p className="ap-msg">{msg}</p>}
          {loading && <p className="dz-muted" style={{ marginTop: 12 }}>読み込んでいます…</p>}

          {/* --- 提案からの登録 --- */}
          {unlinked.length > 0 && (
            <div className="ap-focus">
              <h3>提案から登録する</h3>
              <p className="ap-help">
                上の「次回への提案」のうち、まだ取り組みとして登録していないものです。
                押すと下書きが入った状態で入力欄が開きます。
              </p>
              <div className="ap-chips">
                {unlinked.map((f) => (
                  <button className="ap-chip" type="button" key={`${f.section}-${f.item_no}`}
                    onClick={() => startFromFocus(f)}>
                    <b>{f.label}</b>
                    <i>{f.now.toFixed(2)}点</i>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* --- 一覧 --- */}
          <div className="ap-tabs">
            {[{ key: "all", label: "すべて" }, ...STATUSES].map((s) => (
              <button key={s.key} type="button"
                className={`ap-tab${filter === s.key ? " on" : ""}`}
                onClick={() => setFilter(s.key)}>
                {s.label}<i>{counts[s.key] ?? 0}</i>
              </button>
            ))}
          </div>

          {view.length === 0 ? (
            <p className="ap-none">
              {rows.length === 0
                ? "まだ取り組みが登録されていません。上の提案から登録するか、下の「取り組みを追加」から始めてください。"
                : "この状態の取り組みはありません。"}
            </p>
          ) : (
            <div className="ap-list">
              {view.map((r) => {
                const st = statusOf(r.status);
                const isEdit = editId === r.id;
                const hasEffect = r.delta !== null && r.delta !== undefined;
                return (
                  <div className={`ap-item${isEdit ? " on" : ""}`} key={r.id}>
                    <div className="ap-head">
                      <span className="ap-status" style={{ background: st.color }}>{st.label}</span>
                      <div className="ap-body">
                        <b>{r.title}</b>
                        <div className="ap-meta">
                          {r.item_label && <span>{r.category}／{r.item_label}</span>}
                          {r.owner_name && <span>担当：{r.owner_name}</span>}
                          {r.planned_on && <span>予定：{r.planned_on}</span>}
                          {r.done_on && <span>実施：{r.done_on}</span>}
                        </div>
                        {r.detail && <p className="ap-detail">{r.detail}</p>}

                        {hasEffect ? (
                          <div className="ap-effect">
                            <span className="ap-eff-lab">効果</span>
                            <span>{roundLabel(r.baseline_round_id)}</span>
                            <b>{Number(r.baseline_score).toFixed(2)}</b>
                            <span className="ap-arrow" aria-hidden="true">→</span>
                            <span>{roundLabel(r.review_round_id)}</span>
                            <b>{Number(r.review_score).toFixed(2)}</b>
                            <span className={`ap-eff-d ${r.delta > 0 ? "up" : r.delta < 0 ? "down" : ""}`}>
                              {fmtDelta(r.delta)}
                            </span>
                          </div>
                        ) : r.review_round_id ? (
                          <p className="ap-pending">
                            「{roundLabel(r.review_round_id)}」に回答が集まると、点数の変化がここに出ます。
                          </p>
                        ) : null}
                      </div>
                      <div className="ap-ops">
                        <select value={r.status} disabled={busy}
                          aria-label="状態を変える"
                          onChange={(e) => quickStatus(r.id, e.target.value)}>
                          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                        <button className="dz-btn xs ghost" disabled={busy}
                          onClick={() => (isEdit ? setEditId(null) : startEdit(r))}>
                          {isEdit ? "閉じる" : "編集"}
                        </button>
                      </div>
                    </div>
                    {isEdit && (
                      <Form value={editDraft} onChange={setEditDraft} master={master} rounds={rounds}
                        onSave={update} onCancel={() => setEditId(null)} onDelete={remove} busy={busy} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* --- 追加 --- */}
          {adding ? (
            <div className="ap-new">
              <h3>取り組みを追加</h3>
              <Form value={draft} onChange={setDraft} master={master} rounds={rounds}
                onSave={save} onCancel={() => { setAdding(false); setDraft(EMPTY); }} busy={busy} />
            </div>
          ) : (
            <div className="dz-actions">
              <button className="dz-btn" onClick={() => { setEditId(null); setAdding(true); }}>
                取り組みを追加
              </button>
              <button className="dz-btn ghost" onClick={exportCsv} disabled={rows.length === 0}>
                CSVで書き出す
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   スタイル
   ============================================================ */
const AP_CSS = `
.ap-guard{background:var(--amber-l);border-left:5px solid var(--amber);padding:14px 16px;
 border-radius:0 6px 6px 0;margin-top:16px;}
.ap-guard p{margin:0 0 8px;font-size:14px;}
.ap-guard p:last-child{margin-bottom:0;}
.ap-guard code{background:#fff;border:1px solid var(--line);border-radius:4px;padding:1px 6px;
 font-size:13px;}
.ap-msg{background:var(--navy-l);border-left:5px solid var(--navy);padding:9px 14px;
 border-radius:0 6px 6px 0;font-size:14px;margin-top:14px;}
.ap-focus{margin-top:20px;padding:14px 16px;background:var(--paper);border-radius:6px;}
.ap-focus h3{margin:0 0 4px;font-size:15px;font-weight:800;}
.ap-help{font-size:12px;color:var(--sub);margin:4px 0 0;line-height:1.55;}
.ap-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px;}
.ap-chip{display:flex;align-items:baseline;gap:8px;background:#fff;border:2px solid var(--line);
 border-radius:99px;padding:6px 14px;font:inherit;cursor:pointer;text-align:left;}
.ap-chip:hover{border-color:var(--navy);background:var(--navy-l);}
.ap-chip:focus-visible{outline:3px solid var(--amber);outline-offset:2px;}
.ap-chip b{font-size:13px;font-weight:800;}
.ap-chip i{font-style:normal;font-size:11px;color:var(--red);font-variant-numeric:tabular-nums;}
.ap-tabs{display:flex;gap:2px;flex-wrap:wrap;margin-top:20px;border-bottom:2px solid var(--line);}
.ap-tab{appearance:none;border:0;background:transparent;font:inherit;font-size:14px;
 font-weight:700;padding:9px 14px;cursor:pointer;color:var(--sub);
 border-bottom:3px solid transparent;margin-bottom:-2px;}
.ap-tab:hover{color:var(--ink);}
.ap-tab.on{color:var(--navy-d);border-bottom-color:var(--navy);}
.ap-tab i{display:inline-block;font-style:normal;margin-left:7px;background:var(--paper);
 border-radius:99px;padding:1px 8px;font-size:12px;font-variant-numeric:tabular-nums;}
.ap-tab.on i{background:var(--navy-l);color:var(--navy-d);}
.ap-tab:focus-visible{outline:3px solid var(--amber);outline-offset:-3px;}
.ap-none{font-size:14px;color:var(--sub);margin:18px 0 0;}
.ap-list{margin-top:6px;}
.ap-item{border-bottom:1px solid var(--line);padding:14px 0;}
.ap-item.on{background:var(--paper);}
.ap-head{display:flex;gap:12px;align-items:flex-start;}
.ap-status{flex:none;min-width:62px;text-align:center;padding:3px 8px;border-radius:4px;
 color:#fff;font-weight:900;font-size:12px;}
.ap-body{flex:1 1 auto;min-width:0;}
.ap-body > b{display:block;font-size:15px;font-weight:800;line-height:1.5;}
.ap-meta{display:flex;flex-wrap:wrap;gap:12px;margin-top:3px;}
.ap-meta span{font-size:12px;color:var(--sub);}
.ap-detail{font-size:14px;margin:6px 0 0;white-space:pre-wrap;line-height:1.6;}
.ap-effect{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:9px;
 background:#fff;border:1px solid var(--line);border-radius:6px;padding:8px 12px;}
.ap-effect span{font-size:12px;color:var(--sub);}
.ap-effect b{font-size:15px;font-weight:900;font-variant-numeric:tabular-nums;color:var(--ink);}
.ap-eff-lab{font-weight:800;letter-spacing:.1em;}
.ap-eff-d{font-size:14px!important;font-weight:900;font-variant-numeric:tabular-nums;
 margin-left:4px;}
.ap-eff-d.up{color:var(--navy);}
.ap-eff-d.down{color:var(--red);}
.ap-pending{font-size:12px;color:var(--sub);margin:8px 0 0;}
.ap-ops{flex:none;display:flex;flex-direction:column;gap:7px;align-items:stretch;}
.ap-ops select{font:inherit;font-size:13px;padding:6px 9px;border:2px solid var(--line);
 border-radius:6px;background:#fff;color:var(--ink);}
.ap-new{margin-top:20px;padding-top:6px;}
.ap-new h3{font-size:15px;font-weight:800;margin:0 0 4px;}
.ap-form{margin-top:12px;}
.ap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;}
.ap-f.wide{grid-column:1 / -1;}
.ap-f label{display:block;font-weight:700;font-size:13px;margin-bottom:5px;}
.ap-f input,.ap-f select,.ap-f textarea{width:100%;font:inherit;font-size:15px;padding:10px;
 border:2px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);}
.ap-f textarea{resize:vertical;line-height:1.6;}
.ap-f input:focus,.ap-f select:focus,.ap-f textarea:focus{outline:3px solid var(--amber);
 outline-offset:2px;}
.ap-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:16px;}
.ap-del{margin-left:auto;background:none;border:0;font:inherit;font-size:13px;font-weight:700;
 color:var(--red);text-decoration:underline;cursor:pointer;padding:6px;}
.ap-del:focus-visible{outline:3px solid var(--amber);outline-offset:2px;}
@media (max-width:600px){
  .ap-head{flex-wrap:wrap;}
  .ap-ops{flex-direction:row;width:100%;}
  .ap-ops select{flex:1 1 auto;}
}
`;
