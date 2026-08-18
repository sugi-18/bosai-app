/**
 * 地域防災力評価システム / 管理・集計画面（Supabase接続版）
 *
 * 置き場所： src/AdminDashboard.jsx
 *
 * ★ import のパスについて
 *   src/lib/bosai-supabase-api.js に置いている場合 → 下記のまま
 *   src/bosai-supabase-api.js に置いている場合   → "./lib/..." から "./..." に直す
 *   BosaiSurvey.jsx の import 行と同じ書き方に揃えてください。
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Legend, Tooltip, Cell, ReferenceLine,
} from "recharts";
import {
  signIn, signOut, getSession, onAuthChange,
  getMyAssociations, getRoundSummaries, getItemAverages, getTotalsByAttribute,
  getItemMaster, createRound, setRoundStatus,
} from "./lib/bosai-supabase-api";
import PaperEntry from "./PaperEntry";
import FreeTextPanel from "./FreeTextPanel";
import RespondentCards from "./RespondentCards";

/* ============================================================
   定数・補助
   ============================================================ */
const K_CATS = ["被害拡大防止", "備蓄状況", "連絡体制", "知識習得", "地域防災活動"];
const S_CATS = ["避難", "消火", "救出救助", "応急救護"];
const AGES = ["20代", "30代", "40代", "50代", "60代", "70代", "80代以上"];

const sum = (a) => a.reduce((x, y) => x + y, 0);
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? r2(sum(a) / a.length) : 0);
const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2));
const stateOf = (v) => (v < 1.5 ? "重点課題" : v < 2.5 ? "要強化" : v < 3.5 ? "標準" : "良好");

/** v_item_averages の行配列を、項目番号順の20要素配列に変換する */
function toArray(rows, section) {
  const out = Array(20).fill(0);
  rows.filter((r) => r.section === section)
      .forEach((r) => { out[r.item_no - 1] = Number(r.avg_score); });
  return out;
}

/* ============================================================
   ログイン画面
   ============================================================ */
function Login({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      await signIn(email.trim(), password);
      onDone();
    } catch (e) {
      setErr(
        String(e.message).includes("Invalid login credentials")
          ? "メールアドレスまたはパスワードが違います。"
          : `ログインできませんでした：${e.message}`
      );
    } finally { setBusy(false); }
  };

  return (
    <div className="dz-login">
      <div className="dz-card" style={{ maxWidth: 420, width: "100%", marginTop: 0 }}>
        <h2>管理者ログイン</h2>
        <p className="dz-muted">自治会の集計結果を見るには、管理者アカウントが必要です。</p>
        <div className="dz-field" style={{ marginTop: 18 }}>
          <label htmlFor="email">メールアドレス</label>
          <input id="email" type="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="dz-field" style={{ marginTop: 14 }}>
          <label htmlFor="pw">パスワード</label>
          <input id="pw" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        {err && <p className="dz-err">{err}</p>}
        <div className="dz-actions">
          <button className="dz-btn" onClick={submit} disabled={busy || !email || !password}>
            {busy ? "確認しています…" : "ログイン"}
          </button>
        </div>
        <p className="dz-muted" style={{ marginTop: 18, fontSize: 12 }}>
          アカウントは Supabase の Authentication → Users で作成します。
          作成後、association_admins テーブルへの登録も必要です（SETUP.md の 1-4）。
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   小さな部品
   ============================================================ */
function Kpi({ label, value, unit, delta, hi }) {
  return (
    <div className={`dz-kpi${hi ? " hi" : ""}`}>
      <div className="k">{label}</div>
      <div className="v">{value}{unit && <span className="u"> {unit}</span>}</div>
      {delta !== undefined && delta !== null && !Number.isNaN(delta) && (
        <div className={`d ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
          {delta === 0 ? "増減なし" : `${fmtDelta(delta)} 前回比`}
        </div>
      )}
    </div>
  );
}

function CompareRadar({ title, items, a, b, aName, bName }) {
  const hasA = Array.isArray(a);
  const data = items.map((it, i) => ({
    no: String(it.item_no), label: it.label,
    ...(hasA ? { [aName]: a[i] } : {}),
    [bName]: b[i],
  }));
  return (
    <div className="dz-chart">
      <h3>{title}</h3>
      <div style={{ width: "100%", height: 330 }}>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="#d3dbd5" />
            <PolarAngleAxis dataKey="no" tick={{ fontSize: 11, fill: "#5b6b62" }} />
            <PolarRadiusAxis domain={[0, 5]} tickCount={6} angle={90} tick={{ fontSize: 10, fill: "#9aa8a0" }} />
            <Tooltip formatter={(v, n) => [`${r2(v)} 点`, n]}
              labelFormatter={(l) => { const d = data.find((x) => x.no === l); return `${l}. ${d ? d.label : ""}`; }}
              contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d3dbd5" }} />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            {hasA && <Radar name={aName} dataKey={aName} stroke="#9aa8a0" fill="#9aa8a0" fillOpacity={0.16} strokeWidth={2} />}
            <Radar name={bName} dataKey={bName} stroke="#00703c" fill="#00703c" fillOpacity={0.3} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ============================================================
   調査回の運用パネル
   ============================================================ */
function RoundManager({ association, rounds, onChanged }) {
  const [label, setLabel] = useState("");
  const [phase, setPhase] = useState("baseline");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const surveyBase = `${window.location.origin}${window.location.pathname.replace(/admin\.html$/, "")}`;

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await createRound({ associationId: association.id, label: label.trim(), phase });
      setMsg(`「${r.label}」を作成しました。合言葉は ${r.access_code} です。受付を開始すると回答できるようになります。`);
      setLabel("");
      onChanged();
    } catch (e) { setMsg(`作成できませんでした：${e.message}`); }
    finally { setBusy(false); }
  };

  const toggle = async (round) => {
    setBusy(true); setMsg("");
    try {
      await setRoundStatus(round.round_id, round.status === "open" ? "closed" : "open");
      onChanged();
    } catch (e) { setMsg(`変更できませんでした：${e.message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="dz-card">
      <h2>調査回の管理</h2>
      <p className="dz-muted">受付中（open）の調査回だけが回答を受け付けます。</p>

      <div className="dz-scroll">
        <table className="dz-table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>調査回</th><th style={{ width: 90 }}>状態</th><th style={{ width: 80 }}>回答数</th>
              <th>回答URL</th><th style={{ width: 110 }}>操作</th></tr>
          </thead>
          <tbody>
            {rounds.map((r) => {
              const url = `${surveyBase}?code=${r.access_code ?? ""}`;
              return (
                <tr key={r.round_id}>
                  <td>{r.label}<br /><span className="dz-sub">{r.conducted_on}</span></td>
                  <td><span className={`dz-pill ${r.status}`}>
                    {r.status === "open" ? "受付中" : r.status === "closed" ? "終了" : "準備中"}
                  </span></td>
                  <td className="n">{r.respondents ?? 0}</td>
                  <td>
                    {r.access_code
                      ? <button className="dz-link" onClick={() => navigator.clipboard?.writeText(url)}
                          title="クリックでコピー">{url}</button>
                      : <span className="dz-sub">—</span>}
                  </td>
                  <td>
                    <button className="dz-btn xs ghost" disabled={busy} onClick={() => toggle(r)}>
                      {r.status === "open" ? "受付を終了" : "受付を開始"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>新しい調査回を作る</h3>
      <div className="dz-newround">
        <div className="dz-field" style={{ flex: "2 1 260px" }}>
          <label htmlFor="rl">名称</label>
          <input id="rl" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="例）2027年度 第1回（取組み後）" />
        </div>
        <div className="dz-field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="rp">区分</label>
          <select id="rp" value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="baseline">現時点評価（取組み前）</option>
            <option value="follow_up">取組み後評価</option>
          </select>
        </div>
        <button className="dz-btn" disabled={busy || !label.trim()} onClick={add}>作成</button>
      </div>
      {msg && <p className="dz-note">{msg}</p>}
    </div>
  );
}

/* ============================================================
   本体
   ============================================================ */
export default function AdminDashboard() {
  const [session, setSession] = useState(undefined);   // undefined=確認中
  const [assocs, setAssocs] = useState([]);
  const [assocId, setAssocId] = useState("");
  const [rounds, setRounds] = useState([]);
  const [master, setMaster] = useState({ koudou: [], shodou: [] });
  const [baseId, setBaseId] = useState("");
  const [cmpId, setCmpId] = useState("");
  const [baseAvg, setBaseAvg] = useState(null);
  const [cmpAvg, setCmpAvg] = useState(null);
  const [ageRows, setAgeRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  /* ---- ログイン状態 ---- */
  useEffect(() => {
    getSession().then(setSession).catch(() => setSession(null));
    return onAuthChange(setSession);
  }, []);

  /* ---- 自治会と設問マスタ ---- */
  const loadBase = useCallback(async () => {
    setErr("");
    try {
      const [a, m] = await Promise.all([getMyAssociations(), getItemMaster()]);
      setAssocs(a);
      setMaster(m);
      if (a.length) setAssocId((prev) => prev || a[0].id);
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { if (session) loadBase(); }, [session, loadBase]);

  /* ---- 調査回一覧 ---- */
  const loadRounds = useCallback(async () => {
    if (!assocId) return;
    setErr("");
    try {
      const rs = await getRoundSummaries(assocId);
      setRounds(rs);
      const withData = rs.filter((r) => (r.respondents ?? 0) > 0);
      if (withData.length >= 2) {
        setBaseId(withData[withData.length - 2].round_id);
        setCmpId(withData[withData.length - 1].round_id);
      } else if (withData.length === 1) {
        setBaseId(""); setCmpId(withData[0].round_id);
      } else { setBaseId(""); setCmpId(""); }
    } catch (e) { setErr(e.message); }
  }, [assocId]);

  useEffect(() => { loadRounds(); }, [loadRounds]);

  /* ---- 選ばれた調査回の集計 ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cmpId) { setCmpAvg(null); setBaseAvg(null); setAgeRows([]); return; }
      setLoading(true); setErr("");
      try {
        const [cRows, bRows, totals] = await Promise.all([
          getItemAverages(cmpId),
          baseId ? getItemAverages(baseId) : Promise.resolve(null),
          getTotalsByAttribute(cmpId),
        ]);
        if (cancelled) return;
        setCmpAvg({ k: toArray(cRows, "koudou"), s: toArray(cRows, "shodou") });
        setBaseAvg(bRows ? { k: toArray(bRows, "koudou"), s: toArray(bRows, "shodou") } : null);
        setAgeRows(totals);
      } catch (e) { if (!cancelled) setErr(e.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [baseId, cmpId]);

  /* ---- 画面用に整形 ---- */
  const baseRound = rounds.find((r) => r.round_id === baseId);
  const cmpRound = rounds.find((r) => r.round_id === cmpId);

  const trend = useMemo(() => rounds
    .filter((r) => (r.respondents ?? 0) > 0)
    .map((r) => ({
      name: r.label.replace(/（.*/, ""),
      防災行動力: Number(r.koudou_avg ?? 0),
      初動対応力: Number(r.shodou_avg ?? 0),
      総合: Number(r.total_avg ?? 0),
    })), [rounds]);

  const deltas = useMemo(() => {
    if (!cmpAvg) return { up: [], down: [], all: [] };
    const build = (items, key, sec) => items.map((it, i) => {
      const now = cmpAvg[key][i];
      const prev = baseAvg ? baseAvg[key][i] : null;
      return { ...it, sec, now, prev, d: prev === null ? null : r2(now - prev) };
    });
    const all = [...build(master.shodou, "s", "初動対応力"), ...build(master.koudou, "k", "防災行動力")];
    const withD = all.filter((x) => x.d !== null);
    return {
      all,
      up: [...withD].sort((a, b) => b.d - a.d).slice(0, 5),
      down: [...withD].sort((a, b) => a.d - b.d).slice(0, 5),
    };
  }, [master, baseAvg, cmpAvg]);

  const focus = useMemo(
    () => deltas.all.filter((x) => x.now < 2.0).sort((a, b) => a.now - b.now).slice(0, 8),
    [deltas]
  );

  const catRows = useMemo(() => {
    if (!cmpAvg) return [];
    const build = (items, key, cats) => cats.map((c) => {
      const idx = items.map((it, i) => (it.category === c ? i : -1)).filter((i) => i >= 0);
      const now = mean(idx.map((i) => cmpAvg[key][i]));
      const prev = baseAvg ? mean(idx.map((i) => baseAvg[key][i])) : null;
      return { cat: c, now, prev, d: prev === null ? null : r2(now - prev) };
    });
    return [...build(master.koudou, "k", K_CATS), ...build(master.shodou, "s", S_CATS)];
  }, [master, baseAvg, cmpAvg]);

  const byAge = useMemo(() => AGES.map((age) => {
    const g = ageRows.filter((r) => r.age_band === age);
    return { age, 平均総合点: g.length ? r2(mean(g.map((r) => Number(r.grand_total)))) : 0, n: g.length };
  }).filter((x) => x.n > 0), [ageRows]);

  const cmpTotal = Number(cmpRound?.total_avg ?? 0);

  const exportCsv = () => {
    if (!cmpAvg) return;
    const head = ["区分", "No", "分類", "項目",
      baseRound ? baseRound.label : "（比較なし）", cmpRound.label, "増減"];
    const rows = deltas.all.map((x) => [
      x.sec, x.item_no, x.category, x.label,
      x.prev === null ? "" : x.prev.toFixed(2), x.now.toFixed(2),
      x.d === null ? "" : x.d.toFixed(2),
    ]);
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `地域防災力_集計_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ============================================================
     描画
     ============================================================ */
  if (session === undefined) {
    return <div className="dz"><style>{CSS}</style>
      <div className="dz-wrap"><div className="dz-card"><p>確認しています…</p></div></div></div>;
  }
  if (session === null) {
    return <div className="dz"><style>{CSS}</style><Login onDone={() => {}} /></div>;
  }

  const association = assocs.find((a) => a.id === assocId);

  return (
    <div className="dz">
      <style>{CSS}</style>

      <header className="dz-head">
        <div className="dz-head-in">
          <div className="dz-headrow">
            <div>
              <p className="dz-eyebrow">地域防災力評価・改善サイクル</p>
              <h1 className="dz-title">{association ? association.name : "管理・集計"}</h1>
            </div>
            <button className="dz-btn xs ghost light" onClick={() => signOut()}>ログアウト</button>
          </div>

          <div className="dz-sel">
            {assocs.length > 1 && (
              <div>
                <label htmlFor="as">自治会</label>
                <select id="as" value={assocId} onChange={(e) => setAssocId(e.target.value)}>
                  {assocs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="base">基準にする回</label>
              <select id="base" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                <option value="">（比較しない）</option>
                {rounds.filter((r) => (r.respondents ?? 0) > 0 && r.round_id !== cmpId)
                  .map((r) => <option key={r.round_id} value={r.round_id}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cmp">表示する回</label>
              <select id="cmp" value={cmpId} onChange={(e) => setCmpId(e.target.value)}>
                {rounds.filter((r) => (r.respondents ?? 0) > 0)
                  .map((r) => <option key={r.round_id} value={r.round_id}>{r.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      </header>

      <main className="dz-wrap">
        {err && <p className="dz-err card">{err}</p>}

        {assocs.length === 0 && !err && (
          <div className="dz-card">
            <h2>担当する自治会が見つかりません</h2>
            <p>ログインはできていますが、このアカウントはどの自治会にも紐付いていません。
              Supabase の SQL Editor で次を実行してください（UID は Authentication → Users で確認できます）。</p>
            <pre className="dz-pre">{`insert into association_admins (association_id, user_id, role)
select a.id, '<あなたのUID>', 'owner'
from associations a where a.name = '〇〇自治会';`}</pre>
          </div>
        )}

        {association && (
          <>
            {!cmpId ? (
              <div className="dz-card">
                <h2>まだ回答が届いていません</h2>
                <p className="dz-muted">
                  下の「調査回の管理」で受付を開始し、回答URLを配布してください。
                  回答が1件でも届くと、ここに集計が表示されます。
                </p>
              </div>
            ) : (
              <>
                <div className="dz-kpis">
                  <Kpi label="回答数" value={cmpRound.respondents ?? 0} unit="名"
                    delta={baseRound ? (cmpRound.respondents ?? 0) - (baseRound.respondents ?? 0) : undefined} />
                  <Kpi label="回答率" value={cmpRound.response_rate ?? "—"} unit={cmpRound.response_rate ? "%" : ""}
                    delta={baseRound && cmpRound.response_rate && baseRound.response_rate
                      ? r2(cmpRound.response_rate - baseRound.response_rate) : undefined} />
                  <Kpi label="防災行動力" value={Number(cmpRound.koudou_avg ?? 0).toFixed(1)} unit="/100"
                    delta={baseRound ? r2(cmpRound.koudou_avg - baseRound.koudou_avg) : undefined} />
                  <Kpi label="初動対応力" value={Number(cmpRound.shodou_avg ?? 0).toFixed(1)} unit="/100"
                    delta={baseRound ? r2(cmpRound.shodou_avg - baseRound.shodou_avg) : undefined} />
                  <Kpi label="総合得点" value={cmpTotal.toFixed(1)} unit="/200"
                    delta={baseRound ? r2(cmpRound.total_avg - baseRound.total_avg) : undefined} hi />
                </div>

                {loading && <p className="dz-muted" style={{ marginTop: 12 }}>集計しています…</p>}

                {trend.length >= 2 && (
                  <>
                    <div className="dz-band"><b>推移</b><span>回答のあった調査回すべて</span></div>
                    <div className="dz-chart" style={{ marginTop: 16, padding: "16px 12px 8px" }}>
                      <div style={{ width: "100%", height: 260 }}>
                        <ResponsiveContainer>
                          <LineChart data={trend} margin={{ top: 16, right: 20, left: 0, bottom: 4 }}>
                            <CartesianGrid stroke="#e6ebe7" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                            <YAxis domain={[0, 200]} tick={{ fontSize: 12 }} />
                            <Tooltip formatter={(v, n) => [`${v} 点`, n]}
                              contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d3dbd5" }} />
                            <Legend wrapperStyle={{ fontSize: 13 }} />
                            <Line type="monotone" dataKey="総合" stroke="#004f2a" strokeWidth={3} dot={{ r: 5 }} />
                            <Line type="monotone" dataKey="防災行動力" stroke="#00703c" strokeWidth={2} dot={{ r: 4 }} />
                            <Line type="monotone" dataKey="初動対応力" stroke="#e0a12c" strokeWidth={2} dot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </>
                )}

                {cmpAvg && (
                  <>
                    <div className="dz-band">
                      <b>項目別の評価</b>
                      <span>{baseRound ? `${baseRound.label} → ${cmpRound.label}` : cmpRound.label}</span>
                    </div>
                    <div className="dz-charts">
                      <CompareRadar title="防災行動力" items={master.koudou}
                        a={baseAvg?.k} b={cmpAvg.k}
                        aName={baseRound?.label ?? "基準"} bName={cmpRound.label} />
                      <CompareRadar title="初動対応力" items={master.shodou}
                        a={baseAvg?.s} b={cmpAvg.s}
                        aName={baseRound?.label ?? "基準"} bName={cmpRound.label} />
                    </div>

                    <div className="dz-card">
                      <h2>区分別の平均</h2>
                      <div className="dz-scroll">
                        <table className="dz-table" style={{ marginTop: 10 }}>
                          <thead>
                            <tr>
                              <th>区分</th>
                              {baseRound && <th style={{ width: 110 }}>{baseRound.label}</th>}
                              <th style={{ width: 110 }}>{cmpRound.label}</th>
                              {baseRound && <th style={{ width: 90 }}>増減</th>}
                              <th style={{ width: 100 }}>状態</th>
                            </tr>
                          </thead>
                          <tbody>
                            {catRows.map((r) => (
                              <tr key={r.cat}>
                                <td>{r.cat}</td>
                                {baseRound && <td className="n">{r.prev.toFixed(2)}</td>}
                                <td className="n">{r.now.toFixed(2)}</td>
                                {baseRound && (
                                  <td className={`n ${r.d > 0 ? "up" : r.d < 0 ? "down" : ""}`}
                                    style={{ fontWeight: 800 }}>{fmtDelta(r.d)}</td>
                                )}
                                <td>{stateOf(r.now)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {baseRound && (
                      <div className="dz-card">
                        <h2>項目別の増減</h2>
                        <div className="dz-two" style={{ marginTop: 10 }}>
                          <div>
                            <h3 style={{ marginTop: 0 }}>伸びた項目</h3>
                            {deltas.up.map((x) => (
                              <div className="dz-row" key={`u${x.sec}${x.item_no}`}>
                                <span className="dz-tag" style={{ background: "#00703c" }}>{fmtDelta(x.d)}</span>
                                <span><b>{x.category}／{x.item_no}. {x.label}</b>
                                  <span className="sc">{x.prev.toFixed(2)} → {x.now.toFixed(2)} 点</span></span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <h3 style={{ marginTop: 0 }}>下がった・伸びていない項目</h3>
                            {deltas.down.map((x) => (
                              <div className="dz-row" key={`d${x.sec}${x.item_no}`}>
                                <span className="dz-tag" style={{ background: x.d < 0 ? "#c1272d" : "#9aa8a0" }}>{fmtDelta(x.d)}</span>
                                <span><b>{x.category}／{x.item_no}. {x.label}</b>
                                  <span className="sc">{x.prev.toFixed(2)} → {x.now.toFixed(2)} 点</span></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="dz-band"><b>次回への提案</b><span>2.0点未満の項目</span></div>
                    <div className="dz-card">
                      {focus.length === 0
                        ? <p className="dz-muted">2.0点未満の項目はありません。</p>
                        : focus.map((x, i) => (
                          <div className="dz-row" key={`f${x.sec}${x.item_no}`}>
                            <span className="dz-tag" style={{ background: x.now < 1 ? "#c1272d" : "#e0a12c" }}>{i + 1}</span>
                            <span>
                              <b>{x.sec}／{x.category}／{x.item_no}. {x.label}</b>
                              <span className="sc">
                                現状 {x.now.toFixed(2)} 点{x.d !== null && `（前回比 ${fmtDelta(x.d)}）`}
                              </span>
                              <p>{x.improvement_tip}</p>
                            </span>
                          </div>
                        ))}
                    </div>

                    {byAge.length > 0 && (
                      <div className="dz-card">
                        <h2>年代別の総合得点</h2>
                        <p className="dz-muted">
                          {cmpRound.label}。世代で差が出る場合、周知の手段を分ける判断材料になります。
                        </p>
                        <div style={{ width: "100%", height: 240, marginTop: 8 }}>
                          <ResponsiveContainer>
                            <BarChart data={byAge} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
                              <CartesianGrid stroke="#e6ebe7" vertical={false} />
                              <XAxis dataKey="age" tick={{ fontSize: 13 }} />
                              <YAxis domain={[0, 200]} tick={{ fontSize: 12 }} />
                              <Tooltip contentStyle={{ fontSize: 13, borderRadius: 6, border: "1px solid #d3dbd5" }}
                                formatter={(v, n, p) => [`${v} 点（${p.payload.n}名）`, "平均総合点"]} />
                              <ReferenceLine y={cmpTotal} stroke="#e0a12c" strokeDasharray="4 4"
                                label={{ value: "全体平均", position: "right", fontSize: 11, fill: "#8a6a1e" }} />
                              <Bar dataKey="平均総合点" radius={[4, 4, 0, 0]}>
                                {byAge.map((d) => (
                                  <Cell key={d.age} fill={d.平均総合点 >= cmpTotal ? "#00703c" : "#9aa8a0"} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    <div className="dz-card">
                      <h2>書き出し</h2>
                      <p className="dz-muted">
                        全40項目の平均点を含むCSVです。無料プランに自動バックアップは無いので、
                        調査が終わるたびに保存してください。
                      </p>
                      <div className="dz-actions">
                        <button className="dz-btn" onClick={exportCsv}>CSVをダウンロード</button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

          　<RespondentCards roundId={cmpId} roundLabel={cmpRound?.label} master={master} areaAvg={cmpAvg} />
            <FreeTextPanel roundId={cmpId} roundLabel={cmpRound?.label} />
            <PaperEntry association={association} rounds={rounds} master={master} onSaved={loadRounds} />
            <RoundManager association={association} rounds={rounds} onChanged={loadRounds} />
          </>
        )}
      </main>
    </div>
  );
}

/* ============================================================
   スタイル
   ============================================================ */
const CSS = `
.dz{--ink:#16211c;--sub:#5b6b62;--line:#d3dbd5;--paper:#eef2ee;--green:#00703c;--green-d:#004f2a;
 --green-l:#e3efe8;--red:#c1272d;--amber:#e0a12c;--amber-l:#fbf1dd;
 color:var(--ink);background:var(--paper);font-size:16px;line-height:1.7;min-height:100vh;
 font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",YuGothic,"Noto Sans JP",Meiryo,sans-serif;}
.dz *{box-sizing:border-box;}
.dz-wrap{max-width:1080px;margin:0 auto;padding:0 16px 72px;}
.dz-login{display:grid;place-items:center;min-height:100vh;padding:20px;}
.dz-head{background:var(--green-d);color:#fff;border-bottom:6px solid var(--amber);}
.dz-head-in{max-width:1080px;margin:0 auto;padding:18px 16px;}
.dz-headrow{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}
.dz-eyebrow{font-size:11px;letter-spacing:.3em;opacity:.72;margin:0 0 4px;}
.dz-title{font-size:24px;font-weight:900;margin:0;letter-spacing:.02em;}
.dz-sel{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px;}
.dz-sel label{font-size:12px;letter-spacing:.14em;opacity:.8;display:block;margin-bottom:4px;}
.dz-sel select{font:inherit;font-size:15px;padding:9px 12px;border-radius:6px;border:0;
 background:#fff;color:var(--ink);min-width:190px;}
.dz-card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;margin-top:16px;}
.dz-card h2{font-size:18px;font-weight:900;margin:0 0 2px;}
.dz-card h3{font-size:15px;font-weight:800;margin:22px 0 6px;}
.dz-muted{color:var(--sub);font-size:13px;margin:0;}
.dz-sub{color:var(--sub);font-size:12px;}
.dz-err{color:var(--red);font-weight:700;font-size:15px;margin:12px 0 0;}
.dz-err.card{background:#fff;border:1px solid var(--red);border-radius:6px;padding:14px 18px;}
.dz-band{display:flex;gap:12px;align-items:baseline;background:var(--green);color:#fff;
 padding:9px 14px;border-radius:4px;margin-top:24px;}
.dz-band b{font-size:17px;font-weight:900;letter-spacing:.04em;}
.dz-band span{font-size:12px;opacity:.85;}
.dz-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:2px;
 background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-top:16px;}
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
.dz-table th,.dz-table td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top;}
.dz-table th{background:var(--green-l);font-weight:800;font-size:13px;}
.dz-table td.n{text-align:right;font-variant-numeric:tabular-nums;}
.dz-scroll{overflow-x:auto;}
.dz-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;}
.dz-row{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);align-items:flex-start;}
.dz-row:last-child{border-bottom:0;}
.dz-tag{flex:none;min-width:58px;text-align:center;padding:3px 6px;border-radius:4px;color:#fff;
 font-weight:900;font-size:13px;font-variant-numeric:tabular-nums;}
.dz-row b{display:block;font-size:14px;line-height:1.45;}
.dz-row p{margin:3px 0 0;font-size:14px;}
.dz-row .sc{font-size:12px;color:var(--sub);font-variant-numeric:tabular-nums;}
.dz-note{background:var(--amber-l);border-left:5px solid var(--amber);padding:10px 14px;
 border-radius:0 6px 6px 0;font-size:14px;margin-top:16px;}
.dz-pre{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:12px;
 font-size:13px;overflow-x:auto;white-space:pre;margin-top:12px;}
.dz-pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:800;}
.dz-pill.open{background:var(--green);color:#fff;}
.dz-pill.closed{background:#9aa8a0;color:#fff;}
.dz-pill.draft{background:var(--amber-l);color:#8a6a1e;}
.dz-link{background:none;border:0;padding:0;font:inherit;font-size:13px;color:var(--green-d);
 text-decoration:underline;cursor:pointer;word-break:break-all;text-align:left;}
.dz-field label{display:block;font-weight:700;font-size:13px;margin-bottom:5px;}
.dz-field input,.dz-field select{width:100%;font:inherit;font-size:15px;padding:11px;
 border:2px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);}
.dz-newround{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:8px;}
.dz-btn{appearance:none;border:0;border-radius:6px;font:inherit;font-size:15px;font-weight:800;
 padding:12px 22px;cursor:pointer;background:var(--green);color:#fff;}
.dz-btn:hover{background:var(--green-d);}
.dz-btn:disabled{background:#b6c2ba;cursor:not-allowed;}
.dz-btn.ghost{background:#fff;color:var(--green-d);border:2px solid var(--green);}
.dz-btn.ghost:hover{background:var(--green-l);}
.dz-btn.ghost.light{background:transparent;color:#fff;border-color:rgba(255,255,255,.6);}
.dz-btn.ghost.light:hover{background:rgba(255,255,255,.15);}
.dz-btn.xs{font-size:13px;padding:7px 12px;}
.dz-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;}
.dz-btn:focus-visible,.dz-sel select:focus-visible,.dz-field input:focus,
.dz-field select:focus,.dz-link:focus-visible{outline:3px solid var(--amber);outline-offset:2px;}
@media (max-width:600px){.dz-kpi .v{font-size:27px;}.dz-title{font-size:19px;}}
@media (prefers-reduced-motion:reduce){.dz *{transition:none!important;}}
`;
