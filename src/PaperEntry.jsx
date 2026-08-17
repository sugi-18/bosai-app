/**
 * 地域防災力評価システム / 紙回答の代理入力
 *
 * 置き場所： src/PaperEntry.jsx
 * AdminDashboard.jsx から呼び出して使います（単独ページではありません）。
 *
 * 設計方針：
 *   紙の用紙を見ながら打つので、目線を画面に戻さず入力できることを優先しています。
 *   数字キーを押すと選択して自動で次へ進むため、マウスは基本的に使いません。
 *   入力順は用紙の並び（初動対応力 → 知識チェック → 防災行動力 → その他）に揃えてあります。
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { enterPaperResponse } from "./lib/bosai-supabase-api";

const AGES = ["20代", "30代", "40代", "50代", "60代", "70代", "80代以上"];
const SEX = ["男性", "女性", "その他"];
const HOUSE = ["単身", "2人", "3人", "4人", "5人", "6人", "7人以上"];

const blank = (v) => (v === "" || v === undefined ? null : v);

export default function PaperEntry({ association, rounds, master, onSaved }) {
  const [open, setOpen] = useState(false);
  const [roundId, setRoundId] = useState("");
  const [choice, setChoice] = useState({});   // "shodou-3" -> 選択肢index
  const [quiz, setQuiz] = useState({});       // "12-0" -> true/false
  const [meta, setMeta] = useState({});
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [log, setLog] = useState([]);         // 入力済みの記録
  const rowRefs = useRef([]);

  /* 受付中の調査回を初期選択 */
  useEffect(() => {
    if (roundId || !rounds.length) return;
    const openRound = rounds.find((r) => r.status === "open") ?? rounds[rounds.length - 1];
    if (openRound) setRoundId(openRound.round_id);
  }, [rounds, roundId]);

  /* 用紙の並びに合わせた入力欄の一覧 */
  const inputs = useMemo(() => {
    const list = [];
    master.shodou.filter((it) => it.input_type !== "quiz5")
      .forEach((it) => list.push({ kind: "choice", section: "shodou", item: it }));
    master.shodou.filter((it) => it.input_type === "quiz5")
      .forEach((it) => (it.quiz ?? []).forEach((q, qi) =>
        list.push({ kind: "quiz", section: "shodou", item: it, qi, q })));
    master.koudou.forEach((it) => list.push({ kind: "choice", section: "koudou", item: it }));
    return list;
  }, [master]);

  const filled = useMemo(() => inputs.filter((inp) =>
    inp.kind === "quiz"
      ? quiz[`${inp.item.item_no}-${inp.qi}`] !== undefined
      : choice[`${inp.section}-${inp.item.item_no}`] !== undefined
  ).length, [inputs, choice, quiz]);

  const pick = useCallback((inp, n) => {
    if (inp.kind === "quiz") {
      if (n > 1) return false;
      setQuiz((p) => ({ ...p, [`${inp.item.item_no}-${inp.qi}`]: n === 0 }));
    } else {
      if (n >= (inp.item.options?.length ?? 0)) return false;
      setChoice((p) => ({ ...p, [`${inp.section}-${inp.item.item_no}`]: n }));
    }
    return true;
  }, []);

  /* キーボード操作 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const cur = inputs[cursor];
      if (!cur) return;

      if (e.key >= "1" && e.key <= "3") {
        if (pick(cur, Number(e.key) - 1)) {
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, inputs.length - 1));
        }
      } else if (e.key === "Backspace" || e.key === "ArrowUp") {
        e.preventDefault(); setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault(); setCursor((c) => Math.min(inputs.length - 1, c + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cursor, inputs, pick]);

  /* 現在行を画面内に保つ */
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cursor]);

  const reset = () => {
    setChoice({}); setQuiz({}); setMeta({}); setCursor(0); setErr("");
    window.scrollTo({ top: rowRefs.current[0]?.offsetTop ?? 0, behavior: "smooth" });
  };

  /* 登録 */
  const save = async () => {
    setErr(""); setMsg("");
    const missing = inputs.length - filled;
    if (missing > 0 && !window.confirm(
      `未入力が ${missing} 箇所あります。未入力は0点として登録されます。このまま登録しますか？`
    )) return;

    setSaving(true);
    try {
      const answers = [];
      master.koudou.forEach((it) => {
        const idx = choice[`koudou-${it.item_no}`];
        answers.push({
          section: "koudou", item_no: it.item_no,
          score: idx === undefined ? 0 : Number(it.options[idx].score),
          choice_index: idx ?? null,
        });
      });
      master.shodou.forEach((it) => {
        if (it.input_type === "quiz5") {
          const arr = [0, 1, 2, 3, 4].map((i) => quiz[`${it.item_no}-${i}`] === true);
          answers.push({
            section: "shodou", item_no: it.item_no,
            score: arr.filter(Boolean).length, quiz_correct: arr,
          });
        } else {
          const idx = choice[`shodou-${it.item_no}`];
          answers.push({
            section: "shodou", item_no: it.item_no,
            score: idx === undefined ? 0 : Number(it.options[idx].score),
            choice_index: idx ?? null,
          });
        }
      });

      await enterPaperResponse({
        roundId,
        meta: {
          resident_code: blank(meta.resident_code?.trim()),
          member_type: meta.member_type || "住民",
          age_band: blank(meta.age_band),
          sex: blank(meta.sex),
          household_size: blank(meta.household_size),
          certifications: blank(meta.certifications?.trim()),
          job_constraint: blank(meta.job_constraint?.trim()),
          health_constraint: blank(meta.health_constraint?.trim()),
          learning_interest: blank(meta.learning_interest?.trim()),
        },
        answers,
      });

      const total = answers.reduce((s, a) => s + a.score, 0);
      setLog((p) => [{
        code: meta.resident_code?.trim() || `（番号なし）`,
        total: Math.round(total * 10) / 10,
        at: new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
      }, ...p].slice(0, 20));
      setMsg(`${log.length + 1}件目を登録しました。次の用紙をどうぞ。`);
      reset();
      onSaved?.();
    } catch (e) {
      setErr(
        e.code === "23505"
          ? "この回答番号は、この調査回ですでに登録されています。番号をご確認ください。"
          : `登録できませんでした：${e.message}`
      );
    } finally { setSaving(false); }
  };

  /* ---------- 描画 ---------- */
  if (!open) {
    return (
      <div className="dz-card">
        <h2>紙回答の代理入力</h2>
        <p className="dz-muted">
          紙で提出された用紙を、役員が代わりに入力します。
          Web回答と同じ扱いで集計に加わり、紙で出した分だけ結果が欠ける状態を防げます。
        </p>
        <div className="dz-actions">
          <button className="dz-btn" onClick={() => setOpen(true)} disabled={!rounds.length}>
            入力画面を開く
          </button>
        </div>
      </div>
    );
  }

  const round = rounds.find((r) => r.round_id === roundId);
  let seq = -1;

  return (
    <div className="dz-card">
      <style>{PE_CSS}</style>

      <div className="pe-top">
        <div>
          <h2>紙回答の代理入力</h2>
          <p className="dz-muted">{association?.name}</p>
        </div>
        <button className="dz-btn xs ghost" onClick={() => setOpen(false)}>閉じる</button>
      </div>

      <div className="pe-bar">
        <div className="dz-field" style={{ flex: "1 1 260px" }}>
          <label htmlFor="pe-round">登録先の調査回</label>
          <select id="pe-round" value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            {rounds.map((r) => (
              <option key={r.round_id} value={r.round_id}>
                {r.label}{r.status !== "open" ? "（受付終了）" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="pe-count">
          <span className="k">入力済み</span>
          <span className="v">{filled}<i> / {inputs.length}</i></span>
        </div>
        <div className="pe-count">
          <span className="k">この画面での登録</span>
          <span className="v">{log.length}<i> 件</i></span>
        </div>
      </div>

      <p className="pe-help">
        <b>キーボードで入力できます。</b>
        数字キー <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> で選択すると自動で次へ進みます。
        知識チェックは <kbd>1</kbd>＝〇、<kbd>2</kbd>＝×。
        <kbd>↑</kbd> または <kbd>BS</kbd> で1つ戻り、<kbd>↓</kbd> で飛ばします。
      </p>

      {/* ---- 回答者情報 ---- */}
      <h3>回答者情報</h3>
      <div className="pe-meta">
        <div className="dz-field">
          <label htmlFor="pe-code">回答番号</label>
          <input id="pe-code" value={meta.resident_code ?? ""}
            onChange={(e) => setMeta({ ...meta, resident_code: e.target.value })}
            placeholder="用紙に記載があれば" />
        </div>
        <div className="dz-field">
          <label htmlFor="pe-mt">立場</label>
          <select id="pe-mt" value={meta.member_type ?? "住民"}
            onChange={(e) => setMeta({ ...meta, member_type: e.target.value })}>
            <option>住民</option><option>役員・区長</option>
          </select>
        </div>
        <div className="dz-field">
          <label htmlFor="pe-age">年齢</label>
          <select id="pe-age" value={meta.age_band ?? ""}
            onChange={(e) => setMeta({ ...meta, age_band: e.target.value })}>
            <option value="">—</option>{AGES.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="dz-field">
          <label htmlFor="pe-sex">性別</label>
          <select id="pe-sex" value={meta.sex ?? ""}
            onChange={(e) => setMeta({ ...meta, sex: e.target.value })}>
            <option value="">—</option>{SEX.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="dz-field">
          <label htmlFor="pe-hh">世帯人数</label>
          <select id="pe-hh" value={meta.household_size ?? ""}
            onChange={(e) => setMeta({ ...meta, household_size: e.target.value })}>
            <option value="">—</option>{HOUSE.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* ---- 設問 ---- */}
      <h3>初動対応力</h3>
      <div className="pe-rows">
        {inputs.map((inp, i) => {
          seq = i;
          const isQuiz = inp.kind === "quiz";
          const key = isQuiz ? `${inp.item.item_no}-${inp.qi}` : `${inp.section}-${inp.item.item_no}`;
          const val = isQuiz ? quiz[key] : choice[key];
          const opts = isQuiz
            ? [{ label: "〇" }, { label: "×" }]
            : (inp.item.options ?? []);

          /* 区切りの見出し */
          const prev = inputs[i - 1];
          const heading =
            (isQuiz && (!prev || prev.kind !== "quiz" || prev.item.item_no !== inp.item.item_no))
              ? `知識チェック：${inp.item.label}`
              : (!isQuiz && inp.section === "koudou" && prev?.section !== "koudou")
                ? "＿KOUDOU＿"
                : null;

          return (
            <React.Fragment key={key}>
              {heading === "＿KOUDOU＿" && <h3 className="pe-sec">防災行動力</h3>}
              {heading && heading !== "＿KOUDOU＿" && <h4 className="pe-sub">{heading}</h4>}

              <div
                ref={(el) => (rowRefs.current[i] = el)}
                className={`pe-row${cursor === i ? " on" : ""}${val === undefined ? "" : " done"}`}
                onClick={() => setCursor(i)}
              >
                <span className="pe-no">{isQuiz ? `${inp.qi + 1}` : inp.item.item_no}</span>
                <span className="pe-label">
                  {isQuiz ? inp.q : inp.item.label}
                  {!isQuiz && <em>{inp.item.category}</em>}
                </span>
                <span className="pe-opts">
                  {opts.map((o, n) => (
                    <button key={o.label} type="button"
                      className={`pe-opt${(isQuiz ? (val === (n === 0)) && val !== undefined : val === n) ? " sel" : ""}`}
                      onClick={(e) => { e.stopPropagation(); pick(inp, n); setCursor(Math.min(i + 1, inputs.length - 1)); }}>
                      <b>{n + 1}</b>{o.label}
                    </button>
                  ))}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* ---- 自由記述 ---- */}
      <h3>その他（任意）</h3>
      <div className="pe-meta">
        <div className="dz-field" style={{ gridColumn: "span 2" }}>
          <label htmlFor="pe-cert">防災に関係する資格や経験</label>
          <input id="pe-cert" value={meta.certifications ?? ""}
            onChange={(e) => setMeta({ ...meta, certifications: e.target.value })} />
        </div>
        <div className="dz-field" style={{ gridColumn: "span 2" }}>
          <label htmlFor="pe-job">職業上の活動制約</label>
          <input id="pe-job" value={meta.job_constraint ?? ""}
            onChange={(e) => setMeta({ ...meta, job_constraint: e.target.value })} />
        </div>
        <div className="dz-field" style={{ gridColumn: "span 2" }}>
          <label htmlFor="pe-health">健康上の活動制約</label>
          <input id="pe-health" value={meta.health_constraint ?? ""}
            onChange={(e) => setMeta({ ...meta, health_constraint: e.target.value })} />
        </div>
        <div className="dz-field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="pe-want">今後学びたい事柄</label>
          <input id="pe-want" value={meta.learning_interest ?? ""}
            onChange={(e) => setMeta({ ...meta, learning_interest: e.target.value })} />
        </div>
      </div>

      {err && <p className="dz-err">{err}</p>}
      {msg && <p className="dz-note">{msg}</p>}

      <div className="pe-save">
        <button className="dz-btn" onClick={save} disabled={saving || !roundId}>
          {saving ? "登録しています…" : "この1枚を登録して次へ"}
        </button>
        <button className="dz-btn ghost" onClick={reset} disabled={saving}>入力を消す</button>
        {round && round.status !== "open" && (
          <span className="dz-sub">※受付終了の調査回に追加登録します</span>
        )}
      </div>

      {log.length > 0 && (
        <>
          <h3>この画面で登録した分</h3>
          <div className="dz-scroll">
            <table className="dz-table">
              <thead><tr><th style={{ width: 60 }}>順</th><th>回答番号</th>
                <th style={{ width: 110 }}>総合得点</th><th style={{ width: 90 }}>時刻</th></tr></thead>
              <tbody>
                {log.map((l, i) => (
                  <tr key={`${l.at}-${i}`}>
                    <td className="n">{log.length - i}</td>
                    <td>{l.code}</td>
                    <td className="n">{l.total} / 200</td>
                    <td>{l.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dz-muted" style={{ marginTop: 8 }}>
            打ち間違いに気づいた場合は、Supabase の Table Editor で respondents から該当行を削除してください
            （answers も一緒に消えます）。
          </p>
        </>
      )}
    </div>
  );
}

const PE_CSS = `
.pe-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}
.pe-bar{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end;margin-top:14px;
 padding-bottom:14px;border-bottom:1px solid var(--line);}
.pe-count .k{display:block;font-size:11px;letter-spacing:.14em;color:var(--sub);}
.pe-count .v{font-size:26px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.2;}
.pe-count .v i{font-size:14px;font-style:normal;color:var(--sub);font-weight:700;}
.pe-help{background:var(--green-l);border-radius:6px;padding:10px 14px;font-size:13px;margin:14px 0 0;}
.pe-help kbd{display:inline-block;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;
 background:#fff;padding:1px 7px;font-family:inherit;font-size:12px;font-weight:800;margin:0 1px;}
.pe-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:8px;}
.pe-sec{font-size:15px;font-weight:900;margin:22px 0 6px;padding-top:14px;border-top:2px solid var(--green);}
.pe-sub{font-size:13px;font-weight:800;color:var(--green-d);margin:16px 0 4px;}
.pe-rows{margin-top:6px;}
.pe-row{display:flex;gap:10px;align-items:center;padding:5px 8px;border-radius:5px;
 border-left:4px solid transparent;cursor:pointer;}
.pe-row:hover{background:#f6f8f6;}
.pe-row.on{background:var(--amber-l);border-left-color:var(--amber);}
.pe-row.done .pe-no{background:var(--green);color:#fff;}
.pe-no{flex:none;width:26px;height:24px;display:grid;place-items:center;background:var(--paper);
 color:var(--sub);border-radius:4px;font-size:12px;font-weight:900;font-variant-numeric:tabular-nums;}
.pe-label{flex:1 1 auto;font-size:13.5px;line-height:1.4;min-width:180px;}
.pe-label em{display:block;font-style:normal;font-size:10.5px;letter-spacing:.1em;color:var(--sub);}
.pe-opts{flex:none;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;}
.pe-opt{border:1.5px solid var(--line);background:#fff;border-radius:5px;padding:4px 9px;
 font:inherit;font-size:12.5px;cursor:pointer;color:var(--ink);white-space:nowrap;}
.pe-opt b{display:inline-block;min-width:13px;color:var(--sub);font-size:11px;margin-right:4px;}
.pe-opt:hover{border-color:var(--green);}
.pe-opt.sel{background:var(--green);border-color:var(--green);color:#fff;font-weight:800;}
.pe-opt.sel b{color:rgba(255,255,255,.7);}
.pe-save{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:22px;
 position:sticky;bottom:0;background:#fff;padding:14px 0;border-top:1px solid var(--line);}
@media (max-width:700px){
 .pe-row{flex-wrap:wrap;}
 .pe-opts{width:100%;justify-content:flex-start;padding-left:36px;}
}
`;
