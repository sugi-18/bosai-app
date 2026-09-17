/**
 * 地域防災力評価システム / 回答の修正・削除
 *
 * 置き場所： src/RespondentEdit.jsx
 * RespondentCards.jsx（個票）から呼び出して使います。
 *
 * 紙の回答を代理入力したあとで打ち間違いが見つかることがあるため、
 * 40項目の点数と属性をあとから直せるようにしたものです。
 * 直した項目だけを保存するので、触っていない項目は元のまま残ります。
 */
import React, { useState, useMemo } from "react";
import {
  updateRespondent, updateAnswers, deleteRespondent,
} from "./lib/bosai-supabase-api";

const AGES = ["20代", "30代", "40代", "50代", "60代", "70代", "80代以上"];
const SEX = ["男性", "女性", "その他"];
const HOUSE = ["単身", "2人", "3人", "4人", "5人", "6人", "7人以上"];
const RESIDENCE = ["1年未満", "1〜4年", "5〜9年", "10〜19年", "20年以上"];
const MEMBER = ["住民", "役員・区長", "その他"];
const PRIOR = ["回答した", "回答していない", "わからない"];

const key = (sec, no) => `${sec}-${no}`;

/** 点数から選択肢の位置を割り出す。配点を変えても壊れないよう毎回引き直す */
function indexOfScore(item, score) {
  const opts = Array.isArray(item.options) ? item.options : [];
  const i = opts.findIndex((o) => Number(o.score) === Number(score));
  return i < 0 ? null : i;
}

export default function RespondentEdit({ person, answers, master, onSaved, onClose }) {
  const items = useMemo(() => [
    ...(master.shodou ?? []).map((it) => ({ ...it, secLabel: "初動対応力" })),
    ...(master.koudou ?? []).map((it) => ({ ...it, secLabel: "防災行動力" })),
  ], [master]);

  const original = useMemo(() => {
    const m = {};
    answers.forEach((a) => { m[key(a.section, a.item_no)] = Number(a.score); });
    return m;
  }, [answers]);

  const [scores, setScores] = useState(original);
  const [meta, setMeta] = useState({
    resident_code: person.resident_code ?? "",
    member_type: person.member_type ?? "住民",
    age_band: person.age_band ?? "",
    sex: person.sex ?? "",
    household_size: person.household_size ?? "",
    residence_years: person.residence_years ?? "",
    prior_round_answered: person.prior_round_answered ?? "",
    certifications: person.certifications ?? "",
    job_constraint: person.job_constraint ?? "",
    health_constraint: person.health_constraint ?? "",
    learning_interest: person.learning_interest ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const changed = useMemo(
    () => items.filter((it) => {
      const k = key(it.section, it.item_no);
      return Number(scores[k]) !== Number(original[k]);
    }),
    [items, scores, original]
  );

  const setScore = (sec, no, v) =>
    setScores((p) => ({ ...p, [key(sec, no)]: v === "" ? null : Number(v) }));

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await updateRespondent(person.id, {
        resident_code: meta.resident_code.trim() || null,
        member_type: meta.member_type || "住民",
        age_band: meta.age_band || null,
        sex: meta.sex || null,
        household_size: meta.household_size || null,
        residence_years: meta.residence_years || null,
        prior_round_answered: meta.prior_round_answered || null,
        certifications: meta.certifications.trim() || null,
        job_constraint: meta.job_constraint.trim() || null,
        health_constraint: meta.health_constraint.trim() || null,
        learning_interest: meta.learning_interest.trim() || null,
      });

      if (changed.length > 0) {
        const rows = changed.map((it) => {
          const score = Number(scores[key(it.section, it.item_no)]);
          const row = { section: it.section, item_no: it.item_no, score };
          if (it.input_type === "quiz5") {
            row.choice_index = null;
            row.quiz_correct = null;   // 何問目が正解かまでは追えないため空にする
          } else {
            row.choice_index = indexOfScore(it, score);
          }
          return row;
        });
        await updateAnswers(person.id, rows);
      }

      onSaved();
    } catch (e) {
      setErr(e.message ?? String(e));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    const name = person.resident_code || "（番号なし）";
    if (!window.confirm(
      `回答番号 ${name} を削除します。\n40項目の回答もすべて消え、元に戻せません。\nよろしいですか？`
    )) return;
    setBusy(true); setErr("");
    try {
      await deleteRespondent(person.id);
      onSaved();
    } catch (e) {
      setErr(e.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="re">
      <style>{RE_CSS}</style>

      <div className="re-head no-print">
        <div>
          <h2>回答の修正</h2>
          <p className="dz-muted">
            回答番号 {person.resident_code || "（番号なし）"}
            {person.entry_mode === "paper" ? "・紙（代理入力）" : "・Web"}
          </p>
        </div>
        <button className="dz-btn xs ghost" disabled={busy} onClick={onClose}>やめる</button>
      </div>

      {err && <p className="dz-err">{err}</p>}

      <div className="dz-card">
        <h3>属性</h3>
        <div className="re-grid">
          <div className="re-f">
            <label htmlFor="re-code">回答番号</label>
            <input id="re-code" value={meta.resident_code} maxLength={40}
              onChange={(e) => setMeta({ ...meta, resident_code: e.target.value })} />
          </div>
          <Sel id="re-mt" label="立場" value={meta.member_type} options={MEMBER} required
            onChange={(v) => setMeta({ ...meta, member_type: v })} />
          <Sel id="re-age" label="年齢" value={meta.age_band} options={AGES}
            onChange={(v) => setMeta({ ...meta, age_band: v })} />
          <Sel id="re-sex" label="性別" value={meta.sex} options={SEX}
            onChange={(v) => setMeta({ ...meta, sex: v })} />
          <Sel id="re-hh" label="世帯人数" value={meta.household_size} options={HOUSE}
            onChange={(v) => setMeta({ ...meta, household_size: v })} />
          <Sel id="re-ry" label="居住年数" value={meta.residence_years} options={RESIDENCE}
            onChange={(v) => setMeta({ ...meta, residence_years: v })} />
          <Sel id="re-pra" label="前回への回答" value={meta.prior_round_answered} options={PRIOR}
            onChange={(v) => setMeta({ ...meta, prior_round_answered: v })} />
        </div>

        <div className="re-grid" style={{ marginTop: 14 }}>
          {[
            ["re-cert", "資格・経験", "certifications"],
            ["re-learn", "今後学びたいこと", "learning_interest"],
            ["re-job", "職業上の制約", "job_constraint"],
            ["re-health", "健康上の制約", "health_constraint"],
          ].map(([id, label, k]) => (
            <div className="re-f wide" key={id}>
              <label htmlFor={id}>{label}</label>
              <input id={id} value={meta[k]}
                onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} />
            </div>
          ))}
        </div>
      </div>

      <div className="dz-card">
        <h3>40項目の点数</h3>
        <p className="dz-muted">
          直したい項目だけ選び直してください。触っていない項目はそのまま残ります。
          変更した項目には印が付きます。
        </p>

        <div className="re-items">
          {items.map((it) => {
            const k = key(it.section, it.item_no);
            const cur = scores[k];
            const isChanged = Number(cur) !== Number(original[k]);
            return (
              <div className={`re-item${isChanged ? " on" : ""}`} key={k}>
                <span className="re-no">{it.secLabel === "初動対応力" ? "初" : "行"}{it.item_no}</span>
                <span className="re-label">
                  {it.label}
                  <i>{it.category}</i>
                </span>
                {it.input_type === "quiz5" ? (
                  <span className="re-input">
                    <select value={cur ?? ""} onChange={(e) => setScore(it.section, it.item_no, e.target.value)}>
                      {[0, 1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n}問正解（{n}点）</option>
                      ))}
                    </select>
                  </span>
                ) : (
                  <span className="re-input">
                    <select value={cur ?? ""} onChange={(e) => setScore(it.section, it.item_no, e.target.value)}>
                      {(it.options ?? []).map((o, i) => (
                        <option key={i} value={o.score}>{o.label}（{o.score}点）</option>
                      ))}
                    </select>
                  </span>
                )}
                {isChanged && (
                  <span className="re-was">元 {original[k]}点</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="re-actions no-print">
        <button className="dz-btn" disabled={busy} onClick={save}>
          {busy ? "保存しています…" : changed.length > 0
            ? `${changed.length}項目の修正を保存` : "属性の修正を保存"}
        </button>
        <button className="dz-btn ghost" disabled={busy} onClick={onClose}>やめる</button>
        <button className="re-del" disabled={busy} onClick={remove}>この回答を削除</button>
      </div>

      {changed.length > 0 && (
        <p className="re-warn">
          点数を直すと、地域の平均や項目別の集計もその場で変わります。
          総会資料を配ったあとで直す場合は、配布物との食い違いにご注意ください。
        </p>
      )}
    </div>
  );
}

function Sel({ id, label, value, options, onChange, required }) {
  return (
    <div className="re-f">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {!required && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

const RE_CSS = `
.re-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
 margin:18px 0 4px;}
.re-head h2{font-size:20px;font-weight:900;margin:0;}
.re-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:13px;
 margin-top:12px;}
.re-f.wide{grid-column:span 2;}
.re-f label{display:block;font-weight:700;font-size:13px;margin-bottom:5px;}
.re-f input,.re-f select{width:100%;font:inherit;font-size:15px;padding:9px 10px;
 border:2px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);}
.re-f input:focus,.re-f select:focus{outline:3px solid var(--amber);outline-offset:2px;}
.re-items{margin-top:14px;border-top:1px solid var(--line);}
.re-item{display:grid;grid-template-columns:40px 1fr 230px 78px;gap:10px;align-items:center;
 padding:8px 6px;border-bottom:1px solid var(--line);}
.re-item.on{background:var(--amber-l);}
.re-no{font-size:12px;font-weight:900;color:var(--sub);text-align:center;
 background:var(--paper);border-radius:4px;padding:3px 0;}
.re-item.on .re-no{background:#fff;}
.re-label{font-size:14px;font-weight:700;line-height:1.4;}
.re-label i{display:block;font-style:normal;font-size:11px;font-weight:400;color:var(--sub);}
.re-input select{width:100%;font:inherit;font-size:14px;padding:7px 9px;
 border:2px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);}
.re-input select:focus{outline:3px solid var(--amber);outline-offset:2px;}
.re-was{font-size:11px;font-weight:800;color:var(--red);text-align:right;}
.re-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:20px;}
.re-del{margin-left:auto;background:none;border:0;font:inherit;font-size:13px;font-weight:700;
 color:var(--red);text-decoration:underline;cursor:pointer;padding:8px;}
.re-del:focus-visible{outline:3px solid var(--amber);outline-offset:2px;}
.re-warn{background:var(--amber-l);border-left:5px solid var(--amber);padding:10px 14px;
 border-radius:0 6px 6px 0;font-size:13px;margin-top:16px;}
@media (max-width:760px){
  .re-item{grid-template-columns:40px 1fr;row-gap:6px;}
  .re-input,.re-was{grid-column:2;}
  .re-was{text-align:left;}
  .re-f.wide{grid-column:span 1;}
}
`;
