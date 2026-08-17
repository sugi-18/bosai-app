/**
 * 地域防災力評価システム / 自由記述の一覧
 *
 * 置き場所： src/FreeTextPanel.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * 点数化されない4項目（資格・経験／今後学びたい事柄／職業上の制約／健康上の制約）を
 * 一覧で確認するための画面です。点数と違い、そのまま次の訓練計画の材料になります。
 */
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./lib/bosai-supabase-api";

const FIELDS = [
  {
    key: "certifications",
    tab: "資格・経験",
    lead: "訓練の指導役や、発災時に頼れる人を把握するために使います。該当者に事前に声をかけておくと、訓練の組み立てが楽になります。",
    sensitive: false,
  },
  {
    key: "learning_interest",
    tab: "今後学びたいこと",
    lead: "住民が自分から挙げた要望です。ここに挙がった内容を次回の訓練メニューに入れると、参加率が上がりやすくなります。",
    sensitive: false,
  },
  {
    key: "job_constraint",
    tab: "職業上の制約",
    lead: "発災時に地域で動けない人がどれくらいいるかの目安です。昼間の人手を見積もる材料になります。",
    sensitive: false,
  },
  {
    key: "health_constraint",
    tab: "健康上の制約",
    lead: "避難支援の計画づくりに必要な情報です。個人の健康に関わる内容を含むため、閲覧と持ち出しは必要な範囲にとどめてください。",
    sensitive: true,
  },
];

/** 指定した調査回の自由記述を取得する（管理者のみ・RLSで保護） */
export async function getFreeTextResponses(roundId) {
  const { data, error } = await supabase
    .from("respondents")
    .select(
      "id,resident_code,member_type,age_band,entry_mode,submitted_at," +
      "certifications,job_constraint,health_constraint,learning_interest"
    )
    .eq("round_id", roundId)
    .order("submitted_at");
  if (error) throw error;
  return data ?? [];
}

export default function FreeTextPanel({ roundId, roundLabel }) {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("certifications");
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!roundId) { setRows([]); return; }
      setLoading(true); setErr("");
      try {
        const d = await getFreeTextResponses(roundId);
        if (!cancelled) setRows(d);
      } catch (e) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [roundId]);

  const counts = useMemo(() => {
    const c = {};
    FIELDS.forEach((f) => {
      c[f.key] = rows.filter((r) => (r[f.key] ?? "").trim() !== "").length;
    });
    return c;
  }, [rows]);

  const current = FIELDS.find((f) => f.key === tab);
  const list = useMemo(
    () => rows.filter((r) => (r[tab] ?? "").trim() !== ""),
    [rows, tab]
  );

  const exportCsv = () => {
    const head = ["回答番号", "立場", "年代", "入力方法", "資格・経験", "今後学びたいこと", "職業上の制約", "健康上の制約"];
    const body = rows
      .filter((r) => FIELDS.some((f) => (r[f.key] ?? "").trim() !== ""))
      .map((r) => [
        r.resident_code ?? "", r.member_type ?? "", r.age_band ?? "",
        r.entry_mode === "paper" ? "紙（代理入力）" : "Web",
        r.certifications ?? "", r.learning_interest ?? "",
        r.job_constraint ?? "", r.health_constraint ?? "",
      ]);
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `自由記述_${roundLabel ?? ""}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!roundId) return null;

  const hidden = current.sensitive && !revealed;

  return (
    <div className="dz-card">
      <style>{FT_CSS}</style>
      <h2>自由記述の回答</h2>
      <p className="dz-muted">
        {roundLabel}／点数にならない記入欄です。回答者本人の言葉なので、そのまま計画の材料になります。
      </p>

      {err && <p className="dz-err">{err}</p>}
      {loading && <p className="dz-muted" style={{ marginTop: 12 }}>読み込んでいます…</p>}

      <div className="ft-tabs">
        {FIELDS.map((f) => (
          <button key={f.key} type="button"
            className={`ft-tab${tab === f.key ? " on" : ""}`}
            onClick={() => { setTab(f.key); setRevealed(false); }}>
            {f.tab}<i>{counts[f.key] ?? 0}</i>
          </button>
        ))}
      </div>

      <p className="ft-lead">{current.lead}</p>

      {hidden ? (
        <div className="ft-guard">
          <p>個人の健康に関わる記述です。表示は必要なときだけにしてください。</p>
          <button className="dz-btn xs" onClick={() => setRevealed(true)}>
            {counts[tab]}件を表示する
          </button>
        </div>
      ) : list.length === 0 ? (
        <p className="dz-muted" style={{ marginTop: 14 }}>この項目への記入はありませんでした。</p>
      ) : (
        <div className="ft-list">
          {list.map((r) => (
            <div className="ft-item" key={r.id}>
              <div className="ft-who">
                <b>{r.resident_code || "番号なし"}</b>
                <span>{[r.member_type, r.age_band].filter(Boolean).join("・") || "属性未記入"}</span>
                {r.entry_mode === "paper" && <span className="ft-paper">紙</span>}
              </div>
              <p className="ft-text">{r[tab]}</p>
            </div>
          ))}
        </div>
      )}

      <div className="dz-actions">
        <button className="dz-btn ghost" onClick={exportCsv} disabled={rows.length === 0}>
          自由記述をCSVで書き出す
        </button>
      </div>
      <p className="dz-muted" style={{ marginTop: 10 }}>
        書き出したCSVには健康上の記述も含まれます。保存先と共有範囲にご注意ください。
      </p>
    </div>
  );
}

const FT_CSS = `
.ft-tabs{display:flex;gap:2px;flex-wrap:wrap;margin-top:16px;border-bottom:2px solid var(--line);}
.ft-tab{appearance:none;border:0;background:transparent;font:inherit;font-size:14px;font-weight:700;
 padding:9px 14px;cursor:pointer;color:var(--sub);border-bottom:3px solid transparent;margin-bottom:-2px;}
.ft-tab:hover{color:var(--ink);}
.ft-tab.on{color:var(--green-d);border-bottom-color:var(--green);}
.ft-tab i{display:inline-block;font-style:normal;margin-left:7px;background:var(--paper);
 border-radius:99px;padding:1px 8px;font-size:12px;font-variant-numeric:tabular-nums;}
.ft-tab.on i{background:var(--green-l);color:var(--green-d);}
.ft-tab:focus-visible{outline:3px solid var(--amber);outline-offset:-3px;}
.ft-lead{font-size:13px;color:var(--sub);margin:14px 0 0;}
.ft-guard{background:var(--amber-l);border-left:5px solid var(--amber);padding:14px 16px;
 border-radius:0 6px 6px 0;margin-top:14px;}
.ft-guard p{margin:0 0 10px;font-size:14px;}
.ft-list{margin-top:14px;}
.ft-item{padding:12px 0;border-bottom:1px solid var(--line);}
.ft-item:last-child{border-bottom:0;}
.ft-who{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;}
.ft-who b{font-size:13px;font-variant-numeric:tabular-nums;}
.ft-who span{font-size:12px;color:var(--sub);}
.ft-paper{background:var(--paper);border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700;}
.ft-text{margin:4px 0 0;font-size:15px;line-height:1.6;white-space:pre-wrap;}
`;
