/**
 * 地域防災力評価システム / アンケート用紙の印刷
 *
 * 置き場所： src/SurveyForm.jsx
 * AdminDashboard.jsx から呼び出して使います。
 *
 * ねらい：
 *   紙で配る用紙と、役員が打ち込む「紙回答の代理入力」画面を、
 *   同じ並び・同じ番号にそろえることです。
 *
 *   ・用紙の並び順　　＝ 代理入力画面の並び順
 *     （回答者情報 → 初動対応力 → 知識チェック → 防災行動力 → その他）
 *   ・選択肢の□に振った数字 ＝ 代理入力画面で押す数字キー
 *     （□1 参加している → キーボードの「1」）
 *
 *   このため、用紙を左手に持って数字キーだけを叩けば入力が終わります。
 *   目線を紙と画面のあいだで往復させる必要がありません。
 *
 *   用紙の右上には、その調査回の回答URLのQRコードが入ります。
 *   紙を受け取った方が「やっぱりスマホで答える」と決めても、
 *   そのまま同じ調査回に回答できます。
 */
import React, { useState, useEffect, useMemo } from "react";
import { supabase, beginPrintScope, endPrintScope, updateRound } from "./lib/bosai-supabase-api";
import { QrImage } from "./QrCode";

const AGES = ["20代", "30代", "40代", "50代", "60代", "70代", "80代以上"];
const SEX = ["男性", "女性", "その他"];
const HOUSE = ["単身", "2人", "3人", "4人", "5人", "6人", "7人以上"];
const RESIDENCE = ["1年未満", "1〜4年", "5〜9年", "10〜19年", "20年以上"];
const MEMBER = ["住民", "役員・区長", "その他"];

/* 注記（過去5年ルール）が付く項目。DBから読めなかったときの控えです */
const FALLBACK_NOTE = {
  koudou: [14, 15, 16, 17, 18],
  shodou: [1, 8, 9, 13, 14, 17, 18],
};

const NOTE_TEXT =
  "※印の項目は、過去5年間で1度でもご参加（訓練・実施）されていれば、" +
  "「参加している」「訓練した」「実施している」をお選びください。";

/** 同じ分類が続くあいだをひとまとめにして、表の分類欄をつなげる */
function groupByCategory(items) {
  const out = items.map((it) => ({ it, span: 0 }));
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j + 1 < out.length && out[j + 1].it.category === out[i].it.category) j += 1;
    out[i].span = j - i + 1;
    i = j + 1;
  }
  return out;
}

/** □ と番号の付いた選択肢 */
function Opt({ n, label }) {
  return (
    <span className="sf-opt">
      <span className="sf-box" aria-hidden="true" />
      <i>{n}</i>
      {label}
    </span>
  );
}

/** 記入用の下線 */
function Line({ w = "100%" }) {
  return <span className="sf-line" style={{ width: w }} aria-hidden="true" />;
}

/* ============================================================
   用紙の中身
   ============================================================ */
function Form({ association, round, master, url, noteSet, hasPriorRound }) {
  const showCode = Boolean(round?.show_resident_code);
  const hasNote = (section, no) => noteSet.has(`${section}-${no}`);

  const shodouChoice = (master.shodou ?? []).filter((it) => it.input_type !== "quiz5");
  const shodouQuiz = (master.shodou ?? []).filter((it) => it.input_type === "quiz5");
  const koudou = master.koudou ?? [];

  const choiceRows = (items, section) =>
    groupByCategory(items).map(({ it, span }) => (
      <tr key={`${section}-${it.item_no}`}>
        {span > 0 && <td className="sf-cat" rowSpan={span}><span>{it.category}</span></td>}
        <td className="sf-no">{it.item_no}</td>
        <td className="sf-item">
          {it.label}
          {hasNote(section, it.item_no) && <sup>※</sup>}
        </td>
        <td className="sf-ans">
          {(it.options ?? []).map((o, n) => (
            <Opt key={o.label} n={n + 1} label={o.label} />
          ))}
        </td>
      </tr>
    ));

  return (
    <div id="bosai-survey-form" className="sf-doc print-target">

      {/* ---------- 表題とQRコード ---------- */}
      <header className="sf-head">
        <div className="sf-head-l">
          <p className="sf-eyebrow">{association?.name}</p>
          <h1>地域防災力に関するアンケート調査</h1>
          <p className="sf-round">
            <b>{round?.label}</b>
            {round?.conducted_on ? `　実施日 ${round.conducted_on}` : ""}
          </p>
        </div>

        {url && (
          <div className="sf-head-r">
            <QrImage text={url} size={96} alt="回答画面のQRコード" />
            <b>スマートフォンでも回答できます</b>
            <span className="sf-url">{url}</span>
          </div>
        )}
      </header>

      <p className="sf-howto">
        あてはまるものを1つ選び、<b>□にレ点</b>を付けてください。□の中の小さな数字は集計用の番号です。
        ご記入いただいた内容は集計にのみ使い、個人が分かる形で公表することはありません。
      </p>

      {/* ---------- 回答者情報 ---------- */}
      <section className="sf-sec">
        <h2>回答者について</h2>
        <table className="sf-table sf-meta">
          <tbody>
            {/*
              * 前回の調査に回答されたかどうか。
              * 第2回以降の用紙にだけ入ります。
              * 集計で「続けて答えてくださった方」を取り出すのに使います。
              */}
            {hasPriorRound && (
              <tr>
                <th>{round?.prior_round_label ? `${round.prior_round_label}への回答` : "前回への回答"}</th>
                <td colSpan={3}>
                  <Opt n={1} label="回答した" />
                  <Opt n={2} label="回答していない" />
                  <Opt n={3} label="覚えていない" />
                </td>
              </tr>
            )}

            {/* 回答番号は、番号を配る調査のときだけ印刷します */}
            {showCode ? (
              <tr>
                <th>回答番号</th>
                <td>
                  <Line w="34mm" />
                  <span className="sf-hint">自治会からお配りした番号をご記入ください</span>
                </td>
                <th>立場</th>
                <td>
                  {MEMBER.map((m, i) => <Opt key={m} n={i + 1} label={m} />)}
                </td>
              </tr>
            ) : (
              <tr>
                <th>立場</th>
                <td colSpan={3}>
                  {MEMBER.map((m, i) => <Opt key={m} n={i + 1} label={m} />)}
                </td>
              </tr>
            )}
            <tr>
              <th>年齢</th>
              <td colSpan={3}>
                {AGES.map((a, i) => <Opt key={a} n={i + 1} label={a} />)}
              </td>
            </tr>
            <tr>
              <th>性別</th>
              <td colSpan={3}>
                {SEX.map((a, i) => <Opt key={a} n={i + 1} label={a} />)}
              </td>
            </tr>
            <tr>
              <th>世帯居住人数</th>
              <td colSpan={3}>
                {HOUSE.map((a, i) => <Opt key={a} n={i + 1} label={a} />)}
              </td>
            </tr>
            <tr>
              <th>居住年数</th>
              <td colSpan={3}>
                {RESIDENCE.map((a, i) => <Opt key={a} n={i + 1} label={a} />)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ---------- 初動対応力（選択式） ---------- */}
      <section className="sf-sec">
        <h2>初動対応力<i>災害が起きた直後に動けるか</i></h2>
        <table className="sf-table">
          <thead>
            <tr>
              <th style={{ width: "18mm" }}>分類</th>
              <th style={{ width: "7mm" }}>№</th>
              <th>項目</th>
              <th style={{ width: "80mm" }}>回答欄</th>
            </tr>
          </thead>
          <tbody>{choiceRows(shodouChoice, "shodou")}</tbody>
        </table>
        <p className="sf-note">{NOTE_TEXT}</p>
      </section>

      {/* ---------- 知識チェック ---------- */}
      <section className="sf-sec">
        <h2>知識チェック<i>知っていれば〇、知らなければ×</i></h2>
        <table className="sf-table">
          <thead>
            <tr>
              <th style={{ width: "18mm" }}>分類</th>
              <th style={{ width: "7mm" }}>№</th>
              <th>設問</th>
              <th style={{ width: "40mm" }}>回答欄（〇か×）</th>
            </tr>
          </thead>
          <tbody>
            {shodouQuiz.map((it) => (
              <React.Fragment key={`q-${it.item_no}`}>
                {(it.quiz ?? []).map((q, qi) => (
                  <tr key={`q-${it.item_no}-${qi}`}>
                    {qi === 0 && (
                      <td className="sf-cat" rowSpan={(it.quiz ?? []).length}>
                        <span>{it.category}</span>
                      </td>
                    )}
                    <td className="sf-no">{qi + 1}</td>
                    <td className="sf-item">{q}</td>
                    <td className="sf-ans">
                      <Opt n={1} label="〇" />
                      <Opt n={2} label="×" />
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---------- 防災行動力 ---------- */}
      <section className="sf-sec">
        <h2>防災行動力<i>日ごろの備えができているか</i></h2>
        <table className="sf-table">
          <thead>
            <tr>
              <th style={{ width: "18mm" }}>分類</th>
              <th style={{ width: "7mm" }}>№</th>
              <th>項目</th>
              <th style={{ width: "80mm" }}>回答欄</th>
            </tr>
          </thead>
          <tbody>{choiceRows(koudou, "koudou")}</tbody>
        </table>
        <p className="sf-note">{NOTE_TEXT}</p>
      </section>

      {/* ---------- その他 ---------- */}
      <section className="sf-sec">
        <h2>その他<i>お書きになれる範囲で結構です</i></h2>
        <table className="sf-table sf-free">
          <tbody>
            <tr>
              <th>防災に関係する<br />資格や経験</th>
              <td>
                <Line />
                <span className="sf-hint">例）看護師、消防団、救命講習の受講経験 など</span>
              </td>
            </tr>
            <tr>
              <th>職業上の<br />災害時活動制約</th>
              <td>
                <Opt n={1} label="無" />
                <Opt n={2} label="有" />
                <span className="sf-inline">内容　<Line w="82mm" /></span>
                <span className="sf-hint">例）会社の規定で参集があるため活動できない など</span>
              </td>
            </tr>
            <tr>
              <th>健康上の<br />災害時活動制約</th>
              <td>
                <Opt n={1} label="無" />
                <Opt n={2} label="有" />
                <span className="sf-inline">内容　<Line w="82mm" /></span>
                <span className="sf-hint">例）車いすを使用しているため避難に支障がある など</span>
              </td>
            </tr>
            <tr>
              <th>今後学びたいこと<br />取り組みたいこと</th>
              <td>
                <Line />
                <Line />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer className="sf-foot">
        <span>
          ご協力ありがとうございました。役員までご提出ください。
        </span>
        <span className="sf-entry">
          <b>担当者記入欄</b>
          <span className="sf-box" aria-hidden="true" />入力済
          　入力者 <Line w="24mm" />
          　入力日 <Line w="24mm" />
        </span>
      </footer>
    </div>
  );
}

/* ============================================================
   本体
   ============================================================ */
export default function SurveyForm({ association, rounds, master, onChanged }) {
  const [open, setOpen] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [roundId, setRoundId] = useState("");
  const [noteSet, setNoteSet] = useState(null);

  /*
   * 調査回の初期選択と、選択の直し。
   *
   * ★ 「用紙を開く」ボタンが押せなくなる不具合について
   *   以前は「まだ何も選ばれていなければ選ぶ」という書き方でした。
   *   そのため、別の自治会に切り替えたときに、
   *   前の自治会の調査回が選ばれたまま残ってしまいます。
   *   一覧に無い調査回が選ばれている状態なので、
   *   選択欄には先頭の調査回が表示されているのに、
   *   中身は空っぽ ―― ボタンだけが薄いまま、という見た目になっていました。
   *
   *   いまは「いま選ばれているものが一覧に無ければ選び直す」ようにしています。
   */
  useEffect(() => {
    const list = rounds ?? [];
    if (list.some((r) => r.round_id === roundId)) return;   // そのままでよい
    const pick = list.find((r) => r.status === "open") ?? list[list.length - 1];
    setRoundId(pick ? pick.round_id : "");
  }, [rounds, roundId]);

  /* 注記（過去5年ルール）の付く項目を読む。読めなくても用紙は出せる */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("item_master").select("section,item_no,note");
        if (error) throw error;
        const s = new Set(
          (data ?? [])
            .filter((d) => (d.note ?? "").trim() !== "")
            .map((d) => `${d.section}-${d.item_no}`)
        );
        if (!cancelled) setNoteSet(s);
      } catch {
        if (!cancelled) {
          const s = new Set();
          Object.entries(FALLBACK_NOTE).forEach(([sec, nos]) =>
            nos.forEach((n) => s.add(`${sec}-${n}`)));
          setNoteSet(s);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* プレビューを開いているあいだは背面を動かさない */
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
   * 開いているあいだは「ここだけを印刷する」状態にしておきます。
   * ブラウザが画面の印刷ボタンを止めた場合でも、
   * 利用者が Ctrl+P で刷り直せば、この用紙だけが出ます。
   */
  useEffect(() => {
    if (!open) return undefined;
    beginPrintScope("#bosai-survey-form");
    return () => endPrintScope();
  }, [open, roundId, noteSet]);

  const round = useMemo(
    () => (rounds ?? []).find((r) => r.round_id === roundId),
    [rounds, roundId]
  );

  /*
   * ひとつ前の調査回。
   * これがあれば第2回以降なので、
   * 用紙に「前回への回答」の欄を入れます。
   */
  const priorRound = useMemo(() => {
    if (!round) return null;
    return (rounds ?? [])
      .filter((r) => (r.sequence ?? 0) < (round.sequence ?? 0))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .pop() ?? null;
  }, [rounds, round]);

  /* 用紙に刷るための情報をひとまとめにする */
  const formRound = useMemo(
    () => (round ? { ...round, prior_round_label: priorRound?.label ?? null } : null),
    [round, priorRound]
  );

  /* 用紙に回答番号の欄を入れるかどうかを切り替える */
  const toggleCode = async (next) => {
    if (!round) return;
    setCodeBusy(true);
    try {
      await updateRound(round.round_id, { show_resident_code: next });
      onChanged?.();
    } catch {
      /* 保存できなくても用紙は出せるので、ここでは止めない */
    } finally { setCodeBusy(false); }
  };

  const url = useMemo(() => {
    if (!round?.access_code) return "";
    const base = `${window.location.origin}${window.location.pathname.replace(/admin\.html$/, "")}`;
    return `${base}?code=${round.access_code}`;
  }, [round]);

  if (!association) return null;

  return (
    <div className="dz-card">
      <style>{SF_CSS}</style>
      {open && <style>{SF_PRINT_CSS}</style>}

      <h2>アンケート用紙の印刷</h2>
      <p className="dz-muted">
        紙で配る用紙をここから印刷できます。用紙の並びと選択肢の番号は、
        下の「紙回答の代理入力」の画面とそろえてあります。
        用紙の□に振られた数字が、そのまま入力時に押す数字キーになります。
        右上には、その調査回の回答URLのQRコードが入ります。
      </p>

      <div className="dz-newround">
        <div className="dz-field" style={{ flex: "1 1 280px" }}>
          <label htmlFor="sf-round">印刷する調査回</label>
          <select id="sf-round" value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            {(rounds ?? []).map((r) => (
              <option key={r.round_id} value={r.round_id}>
                {r.label}{r.status !== "open" ? "（受付終了）" : ""}
              </option>
            ))}
          </select>
        </div>
        <button className="dz-btn" disabled={!round} onClick={() => setOpen(true)}>
          用紙を開く
        </button>
      </div>

      <label className="sf-opt-code">
        <input type="checkbox" disabled={!round || codeBusy}
          checked={Boolean(round?.show_resident_code)}
          onChange={(e) => toggleCode(e.target.checked)} />
        <span>
          <b>用紙に「回答番号」の記入欄を入れる</b>
          <i>
            番号を配らない調査では、空欄があると何を書くのか迷わせてしまいます。
            通常は外したままで構いません。設定は調査回ごとに残ります。
          </i>
        </span>
      </label>

      {priorRound && (
        <p className="dz-note">
          この調査回には前の回（{priorRound.label}）があるため、用紙の先頭に
          「{priorRound.label}への回答」をうかがう欄が入ります。
          回答画面にも同じ質問が出ます。
        </p>
      )}

      {round && !round.access_code && (
        <p className="dz-note">
          この調査回には合言葉が設定されていないため、QRコードは入りません。
          「調査回の管理」から合言葉をご確認ください。
        </p>
      )}

      {open && (
        <div className="sf-overlay" role="dialog" aria-label="アンケート用紙">
          <div className="sf-bar-top">
            <span className="sf-bar-title">アンケート用紙（A4縦・2枚）</span>
            <div className="sf-bar-ops">
              <button className="dz-btn" onClick={() => window.print()}>
                印刷／PDFに保存
              </button>
              <button className="dz-btn xs ghost light" onClick={() => setOpen(false)}>閉じる</button>
            </div>
          </div>

          <div className="sf-stage">
            <Form association={association} round={formRound} master={master ?? { koudou: [], shodou: [] }}
              url={url} noteSet={noteSet ?? new Set()} hasPriorRound={Boolean(priorRound)} />
          </div>

          <p className="sf-tip">
            ボタンを押しても印刷画面が出ないときは、<b>この画面を開いたまま</b>
            キーボードの <b>Ctrl+P</b>（Macは <b>⌘+P</b>）を押してください。
            <br />
            両面印刷にすると1枚に収まります。
            文字が小さいと感じる場合は、印刷画面の「倍率」を上げるか、
            用紙サイズを B4 や A3 にすると読みやすくなります。
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   画面表示用のスタイル
   ============================================================ */
const SF_CSS = `
.sf-opt-code{display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:12px 14px;
 background:var(--paper);border-radius:8px;cursor:pointer;}
.sf-opt-code input{margin-top:3px;width:17px;height:17px;flex:none;cursor:pointer;}
.sf-opt-code b{display:block;font-size:14px;}
.sf-opt-code i{display:block;font-style:normal;font-size:12px;color:var(--sub);margin-top:3px;
 line-height:1.6;}

.sf-overlay{position:fixed;inset:0;z-index:900;background:#26304a;
 display:flex;flex-direction:column;align-items:center;overflow:auto;padding-bottom:28px;}
.sf-bar-top{position:sticky;top:0;z-index:2;width:100%;background:#12274a;color:#fff;
 display:flex;justify-content:space-between;align-items:center;gap:16px;padding:11px 18px;
 border-bottom:4px solid #e0a12c;}
.sf-bar-title{font-size:14px;font-weight:800;letter-spacing:.08em;}
.sf-bar-ops{display:flex;gap:10px;align-items:center;}
.sf-stage{padding:22px 14px 0;display:flex;flex-direction:column;align-items:center;}
.sf-tip{color:rgba(255,255,255,.75);font-size:12px;margin:14px 18px 0;text-align:center;max-width:640px;}

.sf-doc{width:210mm;background:#fff;color:#141a28;padding:11mm;box-sizing:border-box;
 box-shadow:0 6px 30px rgba(0,0,0,.35);line-height:1.3;font-size:8.4pt;
 font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",YuGothic,
 "Noto Sans JP",Meiryo,sans-serif;}

.sf-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;
 border-bottom:2.5px solid #12274a;padding-bottom:4px;}
.sf-eyebrow{font-size:7pt;letter-spacing:.2em;color:#5a6478;margin:0 0 1px;}
.sf-head h1{font-size:13.5pt;font-weight:900;margin:0;letter-spacing:.02em;}
.sf-round{font-size:8.5pt;margin:2px 0 0;}
.sf-head-r{flex:none;width:38mm;text-align:center;display:flex;flex-direction:column;
 align-items:center;gap:1px;}
.sf-head-r img{border:1px solid #d4d9e2;}
.sf-head-r b{font-size:6.8pt;font-weight:800;line-height:1.2;white-space:nowrap;}
.sf-url{font-size:5.6pt;color:#5a6478;word-break:break-all;line-height:1.15;}

.sf-howto{font-size:7.6pt;margin:4px 0 0;padding:4px 7px;background:#e4eaf4;border-radius:3px;
 line-height:1.35;}

.sf-sec{margin-top:4px;}
.sf-sec h2{font-size:9.5pt;font-weight:900;margin:0 0 2px;padding:2px 7px;background:#1b3a6b;
 color:#fff;border-radius:3px;display:flex;justify-content:space-between;align-items:baseline;}
.sf-sec h2 i{font-style:normal;font-size:7pt;font-weight:400;opacity:.9;}

.sf-table{width:100%;border-collapse:collapse;table-layout:fixed;}
.sf-table th,.sf-table td{border:1px solid #7f889c;padding:1.2px 3px;text-align:left;
 vertical-align:middle;font-size:8pt;line-height:1.26;}
.sf-table thead th{background:#e4eaf4;font-weight:800;font-size:7.5pt;text-align:center;}
.sf-table tbody tr:nth-child(even) td{background:#f5f7fb;}
.sf-cat{width:18mm;text-align:center;font-weight:800;font-size:7.5pt;background:#eef1f7!important;}
.sf-cat span{writing-mode:horizontal-tb;}
.sf-no{width:7mm;text-align:center;font-weight:800;font-variant-numeric:tabular-nums;}
.sf-item{word-break:break-word;}
.sf-item sup{font-size:6.5pt;color:#c1272d;font-weight:800;}
.sf-ans{white-space:normal;}

.sf-opt{display:inline-flex;align-items:center;gap:1px;margin:0.5px 5px 0.5px 0;font-size:7.4pt;
 white-space:nowrap;}
.sf-opt i{font-style:normal;font-size:6.5pt;font-weight:800;color:#5a6478;margin-right:1px;}
.sf-box{display:inline-block;width:3.4mm;height:3.4mm;border:1px solid #141a28;border-radius:1px;
 background:#fff;flex:none;margin-right:1px;}

.sf-meta th{width:24mm;background:#eef1f7;font-weight:800;font-size:8pt;}
.sf-meta td{padding:2px 4px;}
.sf-line{display:inline-block;border-bottom:1px solid #141a28;height:9px;vertical-align:bottom;
 margin:2px 0;}
.sf-hint{display:block;font-size:6.5pt;color:#5a6478;line-height:1.3;}
.sf-inline{display:inline-flex;align-items:baseline;gap:2px;font-size:8pt;}
.sf-free th{width:30mm;background:#eef1f7;font-weight:800;font-size:8pt;line-height:1.25;}
.sf-free td{padding:3px 5px;}
.sf-note{font-size:7pt;color:#5a6478;margin:2px 0 0;}

.sf-foot{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;
 margin-top:6px;padding-top:4px;border-top:1px solid #7f889c;font-size:7.5pt;color:#5a6478;}
.sf-entry{display:flex;align-items:baseline;gap:3px;white-space:nowrap;}
.sf-entry b{color:#141a28;margin-right:4px;}

@media (max-width:820px){
  .sf-stage{padding:14px 0 0;}
  .sf-doc{width:100%;padding:8mm;box-shadow:none;}
}
`;

/* ============================================================
   印刷用のスタイル
   用紙を開いているあいだだけ読み込みます。
   ============================================================ */
const SF_PRINT_CSS = `
@media print{
  /* 対象以外を消すのは printElement のしくみに任せ、ここは体裁だけ整える */
  .sf-overlay{position:static!important;background:none!important;padding:0!important;
   overflow:visible!important;display:block!important;}
  .sf-bar-top,.sf-tip{display:none!important;}
  .sf-stage{padding:0!important;display:block!important;}

  /* 幅を紙いっぱいに広げない。A4の余白を差し引いた幅に自動で合わせる。
     ここを 210mm と決め打ちすると横にはみ出し、余分なページが出ます。 */
  .sf-doc{width:auto!important;max-width:none!important;margin:0!important;padding:0!important;
   box-shadow:none!important;}

  /* 決め打ちの改ページは入れません。
     項目が増えたときに空白の多いページができてしまうためです。
     見出しだけが紙の終わりに取り残されないようにだけ指定します。 */
  .sf-sec h2{break-after:avoid;page-break-after:avoid;}
  .sf-sec{break-inside:auto;}
  .sf-table thead{display:table-header-group;}
  .sf-table tr{break-inside:avoid;page-break-inside:avoid;}
  .sf-table tbody tr:nth-child(even) td{background:#f5f7fb!important;
   -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .sf-sec h2,.sf-table thead th,.sf-cat,.sf-meta th,.sf-free th,.sf-howto{
   -webkit-print-color-adjust:exact;print-color-adjust:exact;}

  @page{size:A4 portrait;margin:11mm;}
}
`;
