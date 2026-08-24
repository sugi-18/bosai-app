/**
 * 地域防災力評価システム / 住民向け 回答画面（Supabase接続版）
 *
 * Vite + React プロジェクトのソースです。
 *
 * src/
 *   lib/bosai-supabase-api.js
 *   BosaiSurvey.jsx
 *
 * 回答URLの形：
 *   https://example.org/survey?code=iwase2026
 *
 * 調査コードは大文字・小文字を区別しません。
 * 例：
 *   iwase2026
 *   IWASE2026
 *   Iwase2026
 * いずれも同じ調査コードとして扱います。
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

import {
  getOpenRound,
  getItemMaster,
  submitResponse,
  getRoundItemAverages,
  isResidentCodeTaken,
} from "./lib/bosai-supabase-api";

import ResultImage from "./ResultImage";


/* ============================================================
   定数
   ============================================================ */

const AGES = [
  "20代",
  "30代",
  "40代",
  "50代",
  "60代",
  "70代",
  "80代以上",
];

const SEX = [
  "男性",
  "女性",
  "その他",
];

const HOUSE = [
  "単身",
  "2人",
  "3人",
  "4人",
  "5人",
  "6人",
  "7人以上",
];

const RESIDENCE = [
  "1年未満",
  "1〜4年",
  "5〜9年",
  "10〜19年",
  "20年以上",
];

/* 文字の大きさ。1=標準 2=大 3=特大 */
const FONT_SIZES = [
  { v: 1, label: "標準" },
  { v: 2, label: "大" },
  { v: 3, label: "特大" },
];

const PREF_KEY = "bosai-survey-pref";

/** 表示の好み（文字の大きさ・1問ずつ表示）を控えておく */
function loadPref() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

function savePref(pref) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(pref));
  } catch {
    /* 保存できなくても回答には支障がない */
  }
}

const K_CATS = [
  "被害拡大防止",
  "備蓄状況",
  "連絡体制",
  "知識習得",
  "地域防災活動",
];

const S_CATS = [
  "避難",
  "消火",
  "救出救助",
  "応急救護",
];

const DRAFT_KEY = (roundId) =>
  `bosai-draft:${roundId}`;

const sum = (a) =>
  a.reduce((x, y) => x + y, 0);

const r2 = (x) =>
  Math.round(x * 100) / 100;


/* ============================================================
   調査コードの正規化
   ============================================================ */

/*
 * 調査コードは大文字・小文字を区別しない。
 *
 * 例：
 *   IWASE2026
 *   iwase2026
 *   IwAsE2026
 *
 * → すべて
 *
 *   iwase2026
 *
 * として扱う。
 */
function normalizeAccessCode(code) {
  return String(code ?? "")
    .trim()
    .toLowerCase();
}


/* ============================================================
   下書き保存
   ============================================================ */

function loadDraft(roundId) {
  try {
    const raw = window.localStorage.getItem(
      DRAFT_KEY(roundId)
    );

    return raw ? JSON.parse(raw) : null;

  } catch {
    return null;
  }
}


function saveDraft(roundId, state) {
  try {
    window.localStorage.setItem(
      DRAFT_KEY(roundId),
      JSON.stringify(state)
    );

  } catch {
    /* 保存できなくても続行 */
  }
}


function clearDraft(roundId) {
  try {
    window.localStorage.removeItem(
      DRAFT_KEY(roundId)
    );

  } catch {
    /* noop */
  }
}


/* ============================================================
   本体
   ============================================================ */

export default function BosaiSurvey() {

  /* ---- 起動時の状態 ---- */

  const [phase, setPhase] = useState("loading");
  // loading | code | intro | survey | sending | done | error

  const [fatal, setFatal] = useState("");

  const [accessCode, setAccessCode] = useState("");

  const [codeInput, setCodeInput] = useState("");

  const [round, setRound] = useState(null);

  const [master, setMaster] = useState({
    koudou: [],
    shodou: [],
  });


  /* ---- 回答 ---- */

  const [kSel, setKSel] = useState(
    Array(20).fill(null)
  );

  const [sSel, setSSel] = useState(
    Array(20).fill(null)
  );

  const [quiz, setQuiz] = useState({});

  const [meta, setMeta] = useState({
    resident_code: "",
    member_type: "住民",
    age_band: "",
    sex: "",
    household_size: "",
    residence_years: "",
    certifications: "",
    job_constraint: "",
    health_constraint: "",
    learning_interest: "",
  });

  const [step, setStep] = useState(0);

  const [codeWarn, setCodeWarn] = useState("");


  /* ---- 表示の好み ---- */

  const [fontScale, setFontScale] = useState(
    () => loadPref().fontScale ?? 1
  );

  const [oneByOne, setOneByOne] = useState(
    () => loadPref().oneByOne ?? false
  );

  const [qIdx, setQIdx] = useState(0);

  useEffect(() => {
    savePref({ fontScale, oneByOne });
  }, [fontScale, oneByOne]);


  /* ---- 結果 ---- */

  const [result, setResult] = useState(null);

  const [areaAvg, setAreaAvg] = useState(null);

  const [sendError, setSendError] = useState("");


  /* ============================================================
     1. URLまたは入力されたcodeで調査回と設問マスタを取得
     ============================================================ */

  const boot = useCallback(async (code) => {

    setPhase("loading");

    setFatal("");


    /*
     * ここで調査コードを正規化する。
     *
     * IWASE2026
     * iwase2026
     * Iwase2026
     *
     * すべて iwase2026 になる。
     */
    const normalizedCode =
      normalizeAccessCode(code);


    try {

      const [r, m] = await Promise.all([
        getOpenRound(normalizedCode),
        getItemMaster(),
      ]);


      setRound(r);

      setMaster(m);

      /*
       * 以降の送信処理でも同じ正規化済みコードを使用。
       */
      setAccessCode(normalizedCode);


      /* --------------------------------------------------------
         知識チェック項目の初期化
         -------------------------------------------------------- */

      const q = {};

      m.shodou
        .filter(
          (it) =>
            it.input_type === "quiz5"
        )
        .forEach((it) => {

          q[it.item_no] =
            Array(5).fill(null);

        });


      /* --------------------------------------------------------
         下書き復元
         -------------------------------------------------------- */

      const draft =
        loadDraft(r.round_id);


      if (draft) {

        setKSel(draft.kSel);

        setSSel(draft.sSel);

        setQuiz({
          ...q,
          ...draft.quiz,
        });

        setMeta((prev) => ({
          ...prev,
          ...draft.meta,
        }));

        setStep(
          draft.step ?? 0
        );

      } else {

        setQuiz(q);

      }


      setPhase("intro");


    } catch (e) {

      setFatal(
        e.message ??
        "読み込みに失敗しました"
      );

      setPhase("code");

    }

  }, []);


  /* ============================================================
     URLのcodeを取得
     ============================================================ */

  useEffect(() => {

    const code =
      new URLSearchParams(
        window.location.search
      ).get("code");


    if (code) {

      /*
       * normalizeAccessCode() は boot() 内で行うため、
       * ここではそのまま渡す。
       */
      boot(code);

    } else {

      setPhase("code");

    }

  }, [boot]);


  /* ============================================================
     2. 下書きの自動保存
     ============================================================ */

  useEffect(() => {

    if (
      !round ||
      phase !== "survey"
    ) {
      return;
    }


    saveDraft(
      round.round_id,
      {
        kSel,
        sSel,
        quiz,
        meta,
        step,
      }
    );

  }, [
    round,
    phase,
    kSel,
    sSel,
    quiz,
    meta,
    step,
  ]);


  /* ============================================================
     3. 得点の算出
     ============================================================ */

  const scoreOf = (
    item,
    selIndex
  ) => {

    if (
      selIndex == null ||
      !item.options
    ) {
      return 0;
    }

    return Number(
      item.options[selIndex]?.score ?? 0
    );
  };


  const kScores = useMemo(
    () =>
      master.koudou.map(
        (it, i) =>
          scoreOf(
            it,
            kSel[i]
          )
      ),
    [
      master,
      kSel,
    ]
  );


  const sScores = useMemo(
    () =>
      master.shodou.map(
        (it, i) =>
          it.input_type === "quiz5"
            ? (
                quiz[it.item_no] ?? []
              ).filter(
                (x) => x === true
              ).length

            : scoreOf(
                it,
                sSel[i]
              )
      ),
    [
      master,
      sSel,
      quiz,
    ]
  );


  /* ============================================================
     回答数
     ============================================================ */

  const answered = useMemo(() => {

    if (!master.koudou.length) {
      return 0;
    }


    const k =
      kSel.filter(
        (v) => v != null
      ).length;


    const s =
      master.shodou.filter(
        (it, i) =>
          it.input_type !== "quiz5" &&
          sSel[i] != null
      ).length;


    const q =
      Object.values(quiz)
        .filter(
          (a) =>
            a.every(
              (x) => x !== null
            )
        )
        .length;


    return k + s + q;

  }, [
    master,
    kSel,
    sSel,
    quiz,
  ]);


  const totalQ =
    40 -
    Object.keys(quiz).length * 0;


  const pct =
    Math.round(
      (answered / 40) * 100
    );


  /* 残りの所要時間の目安。1問あたり18秒で見積もる */

  const remainMin =
    Math.max(
      0,
      Math.ceil(
        ((40 - answered) * 18) / 60
      )
    );


  /* 1問ずつ表示するときの並び（初動対応力20問 → 防災行動力20問） */

  const flat = useMemo(
    () => [
      ...master.shodou.map((it) => ({
        sec: "s",
        it,
      })),
      ...master.koudou.map((it) => ({
        sec: "k",
        it,
      })),
    ],
    [master]
  );


  /* ============================================================
     未回答
     ============================================================ */

  const unanswered = useMemo(() => {

    const list = [];


    master.shodou.forEach(
      (it, i) => {

        if (
          it.input_type === "quiz5"
        ) {

          if (
            !(
              quiz[it.item_no] ?? []
            ).every(
              (x) => x !== null
            )
          ) {

            list.push(
              `初動対応力 ${it.item_no}`
            );

          }

        } else if (
          sSel[i] == null
        ) {

          list.push(
            `初動対応力 ${it.item_no}`
          );

        }

      }
    );


    master.koudou.forEach(
      (it, i) => {

        if (
          kSel[i] == null
        ) {

          list.push(
            `防災行動力 ${it.item_no}`
          );

        }

      }
    );


    return list;

  }, [
    master,
    kSel,
    sSel,
    quiz,
  ]);


  /* ============================================================
     4. 匿名コードの重複チェック
     ============================================================ */

  const checkResidentCode =
    async () => {

      setCodeWarn("");


      if (
        !meta.resident_code
      ) {
        return;
      }


      try {

        if (
          await isResidentCodeTaken(
            accessCode,
            meta.resident_code
          )
        ) {

          setCodeWarn(
            "この番号ではすでに回答が届いています。番号をご確認ください。"
          );

        }

      } catch {

        /*
         * 確認できなくても送信は試せる。
         */

      }

    };


  /* ============================================================
     5. 送信
     ============================================================ */

  const send = async () => {

    setSendError("");

    setPhase("sending");


    const answers = [

      ...master.koudou.map(
        (it, i) => ({
          section: "koudou",
          item_no: it.item_no,
          score: kScores[i],
          choice_index: kSel[i],
        })
      ),


      ...master.shodou.map(
        (it, i) =>
          it.input_type === "quiz5"

            ? {
                section: "shodou",
                item_no: it.item_no,
                score: sScores[i],
                quiz_correct:
                  quiz[it.item_no]
                    .map(
                      (x) => x === true
                    ),
              }

            : {
                section: "shodou",
                item_no: it.item_no,
                score: sScores[i],
                choice_index: sSel[i],
              }
      ),

    ];


    try {

      await submitResponse({
        accessCode,
        meta,
        answers,
      });


      clearDraft(
        round.round_id
      );


      setResult({
        k: kScores,
        s: sScores,
      });


      try {

        setAreaAvg(
          await getRoundItemAverages(
            accessCode
          )
        );

      } catch {

        /*
         * 平均は無くても結果は表示する。
         */

      }


      setPhase("done");


      window.scrollTo({
        top: 0,
      });


    } catch (e) {

      setSendError(

        e.code === "23505"

          ? "この番号ではすでに回答が届いています。番号をご確認ください。"

          : (
              e.message ??
              "送信に失敗しました。通信状況をご確認のうえ、もう一度お試しください。"
            )

      );


      setPhase("survey");

    }

  };


  /* ============================================================
     画面
     ============================================================ */

  const steps = [

    {
      key: "shodou",
      title: "初動対応力",
      sub: "発災直後に動けるか（20項目）",
    },

    {
      key: "koudou",
      title: "防災行動力",
      sub: "平時にどこまで備えているか（20項目）",
    },

    {
      key: "meta",
      title: "その他",
      sub: "属性・資格・活動制約（任意）",
    },

  ];


  const toTop = () => {

    /* いま描かれている内容が入れ替わったあとで先頭に戻す。
       スマートフォンでは、描画前にスクロールを始めると
       元の位置に引き戻されてしまうため二段構えにしている */

    const jump = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    jump();

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(jump);
    }

  };


  const next = () => {

    setStep(
      (s) => s + 1
    );

    toTop();

  };


  const back = () => {

    setStep(
      (s) => s - 1
    );

    toTop();

  };


  /* ---- 1問ずつ表示のときの前後移動 ---- */

  const goNext = () => {

    if (oneByOne && step < 2) {

      if (qIdx < flat.length - 1) {
        setQIdx(qIdx + 1);
        toTop();
        return;
      }

      setStep(2);
      toTop();
      return;

    }

    next();

  };


  const goBack = () => {

    if (oneByOne && step === 2) {
      setStep(0);
      setQIdx(Math.max(0, flat.length - 1));
      toTop();
      return;
    }

    if (oneByOne && step < 2) {
      if (qIdx > 0) {
        setQIdx(qIdx - 1);
        toTop();
      }
      return;
    }

    back();

  };


  /* まとめて表示 ⇔ 1問ずつ表示。今いる場所を保ったまま切り替える */

  const toggleMode = () => {

    if (!oneByOne) {

      if (step === 1) {
        setQIdx(
          Math.min(20, Math.max(0, flat.length - 1))
        );
        setStep(0);
      } else if (step === 0) {
        setQIdx(0);
      }

      setOneByOne(true);

    } else {

      if (step < 2) {
        setStep(qIdx >= 20 ? 1 : 0);
      }

      setOneByOne(false);

    }

    toTop();

  };


  useEffect(() => {
    toTop();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [step, qIdx, phase]);


  const current =
    flat.length > 0
      ? flat[Math.min(qIdx, flat.length - 1)]
      : null;


  const bandTitle =
    oneByOne && step < 2
      ? current?.sec === "k"
        ? "防災行動力"
        : "初動対応力"
      : steps[step].title;


  const bandSub =
    oneByOne && step < 2
      ? `設問 ${qIdx + 1} / ${flat.length}`
      : steps[step].sub;


  return (

    <div className={`bs${fontScale > 1 ? ` fs-${fontScale}` : ""}`}>

      <style>
        {CSS}
      </style>


      <header className="bs-head">

        <div className="bs-head-in">

          <p className="bs-eyebrow">
            地域防災力評価・改善サイクル
          </p>

          <h1 className="bs-title">
            地域防災力に関するアンケート
          </h1>

          {round && (
            <p className="bs-lede">
              {round.association_name}
              {"　"}
              {round.round_label}
            </p>
          )}


          {(phase === "intro" ||
            phase === "survey" ||
            phase === "sending") && (

            <div className="bs-tools">

              <div
                className="bs-fs"
                role="group"
                aria-label="文字の大きさ"
              >

                <span className="bs-tools-k">
                  文字の大きさ
                </span>

                {FONT_SIZES.map((o) => (

                  <button
                    key={o.v}
                    type="button"
                    aria-pressed={fontScale === o.v}
                    onClick={() =>
                      setFontScale(o.v)
                    }
                  >
                    {o.label}
                  </button>

                ))}

              </div>


              <button
                type="button"
                className="bs-mode"
                aria-pressed={oneByOne}
                onClick={toggleMode}
              >
                {oneByOne
                  ? "まとめて表示にする"
                  : "1問ずつ表示にする"}
              </button>

            </div>

          )}

        </div>

      </header>


      <main className="bs-wrap">


        {/* ======================================================
            読み込み中
            ====================================================== */}

        {phase === "loading" && (

          <div className="bs-card">

            <p>
              読み込んでいます…
            </p>

          </div>

        )}


        {/* ======================================================
            コード入力
            ====================================================== */}

        {phase === "code" && (

          <div className="bs-card">

            <h2>
              調査コードの入力
            </h2>


            <p className="bs-muted">

              回覧された用紙または
              QRコードに記載の調査コードを
              入力してください。

            </p>


            {fatal && (
              <p className="bs-error">
                {fatal}
              </p>
            )}


            <div
              className="bs-field"
              style={{
                marginTop: 14,
                maxWidth: 320,
              }}
            >

              <label htmlFor="code">
                調査コード
              </label>


              <input
                id="code"
                value={codeInput}
                autoCapitalize="none"
                onChange={(e) =>
                  setCodeInput(
                    e.target.value
                  )
                }
                placeholder="例）iwase2026"
              />

            </div>


            <div className="bs-actions">

              <button
                className="bs-btn"
                disabled={
                  codeInput.trim().length < 4
                }
                onClick={() =>
                  boot(
                    codeInput.trim()
                  )
                }
              >
                次へ進む
              </button>

            </div>

          </div>

        )}


        {/* ======================================================
            はじめに
            ====================================================== */}

        {phase === "intro" && (

          <div className="bs-card">

            <h2>
              この調査について
            </h2>


            <p style={{ marginTop: 8 }}>

              地域の防災力を測り、
              次の防災訓練や取り組みに
              反映するための調査です。

              全40問、10分ほどで終わります。

              正解を問うものではないので、
              いまの状況をそのまま
              選んでください。

            </p>


            <div
              className="bs-note"
              style={{ marginTop: 14 }}
            >

              お名前や住所はうかがいません。
              回答は個人が分からない形で集計します。

              途中で画面を閉じても、
              同じ端末から開けば
              続きから再開できます。

            </div>


            <div
              className="bs-field"
              style={{
                marginTop: 18,
                maxWidth: 340,
              }}
            >

              <label htmlFor="rc">
                回答番号
                （用紙に記載がある場合のみ）
              </label>


              <input
                id="rc"
                value={meta.resident_code}
                onBlur={checkResidentCode}
                onChange={(e) =>
                  setMeta({
                    ...meta,
                    resident_code:
                      e.target.value.trim(),
                  })
                }
                placeholder="例）A012"
              />


              <p
                className="bs-muted"
                style={{ marginTop: 6 }}
              >

                翌年以降の調査と突き合わせて、
                地域の伸びを測るために使います。
                空欄でも回答できます。

              </p>


              {codeWarn && (
                <p className="bs-error">
                  {codeWarn}
                </p>
              )}

            </div>


            <div
              className="bs-field"
              style={{
                marginTop: 16,
                maxWidth: 340,
              }}
            >

              <label htmlFor="mt">
                お立場
              </label>


              <select
                id="mt"
                value={meta.member_type}
                onChange={(e) =>
                  setMeta({
                    ...meta,
                    member_type:
                      e.target.value,
                  })
                }
              >

                <option>
                  住民
                </option>

                <option>
                  役員・区長
                </option>

              </select>

            </div>


            <div className="bs-actions">

              <button
                className="bs-btn"
                onClick={() => {

                  setPhase("survey");

                  window.scrollTo({
                    top: 0,
                  });

                }}
              >
                回答をはじめる
              </button>

            </div>

          </div>

        )}


        {/* ======================================================
            回答
            ====================================================== */}

        {(phase === "survey" ||
          phase === "sending") && (

          <>

            <div className="bs-prog">

              <div className="bs-prog-txt">

                <span>
                  {bandTitle}
                  {oneByOne && step < 2
                    ? `（設問 ${qIdx + 1}／${flat.length}）`
                    : `（${step + 1}／${steps.length}）`}
                </span>

                <span>
                  回答済み {answered} / 40問
                  {remainMin > 0 &&
                    `・残り約${remainMin}分`}
                </span>

              </div>


              <div className="bs-prog-bar">

                <div
                  className="bs-prog-fill"
                  style={{
                    width: `${pct}%`,
                  }}
                />

              </div>

            </div>


            <div className="bs-band">

              <b>
                {bandTitle}
              </b>

              <span>
                {bandSub}
              </span>

            </div>


            {!oneByOne &&
              step === 0 &&
              S_CATS.map((cat) => (

                <div
                  className="bs-card"
                  key={cat}
                >

                  <h2>
                    {cat}
                  </h2>


                  {master.shodou
                    .filter(
                      (it) =>
                        it.category === cat
                    )
                    .map((it) => {

                      const i =
                        it.item_no - 1;


                      return it.input_type === "quiz5"

                        ? (

                          <QuizBlock
                            key={it.item_no}
                            item={it}
                            answers={
                              quiz[it.item_no] ??
                              Array(5).fill(null)
                            }
                            onChange={
                              (qi, v) =>
                                setQuiz((p) => {

                                  const n = {
                                    ...p,
                                    [it.item_no]:
                                      [
                                        ...(p[it.item_no] ??
                                          Array(5).fill(null)),
                                      ],
                                  };


                                  n[it.item_no][qi] =
                                    v;


                                  return n;

                                })
                            }
                          />

                        )

                        : (

                          <Question
                            key={it.item_no}
                            item={it}
                            value={sSel[i]}
                            onChange={
                              (v) =>
                                setSSel((p) => {

                                  const n =
                                    [...p];

                                  n[i] = v;

                                  return n;

                                })
                            }
                          />

                        );

                    })}

                </div>

              ))}


            {!oneByOne &&
              step === 1 &&
              K_CATS.map((cat) => (

                <div
                  className="bs-card"
                  key={cat}
                >

                  <h2>
                    {cat}
                  </h2>


                  {master.koudou
                    .filter(
                      (it) =>
                        it.category === cat
                    )
                    .map((it) => {

                      const i =
                        it.item_no - 1;


                      return (

                        <Question
                          key={it.item_no}
                          item={it}
                          value={kSel[i]}
                          onChange={
                            (v) =>
                              setKSel((p) => {

                                const n =
                                  [...p];

                                n[i] = v;

                                return n;

                              })
                          }
                        />

                      );

                    })}

                </div>

              ))}


            {oneByOne &&
              step < 2 &&
              current && (

              <div className="bs-card bs-one">

                <p className="bs-one-pos">
                  {current.sec === "s"
                    ? "初動対応力"
                    : "防災行動力"}
                  ・{current.it.category}
                  {"　"}
                  設問 {qIdx + 1} / {flat.length}
                </p>


                {current.it.input_type === "quiz5"

                  ? (

                    <QuizBlock
                      item={current.it}
                      answers={
                        quiz[current.it.item_no] ??
                        Array(5).fill(null)
                      }
                      onChange={(qi, v) =>
                        setQuiz((p) => {

                          const n = {
                            ...p,
                            [current.it.item_no]: [
                              ...(p[current.it.item_no] ??
                                Array(5).fill(null)),
                            ],
                          };

                          n[current.it.item_no][qi] = v;

                          return n;

                        })
                      }
                    />

                  )

                  : current.sec === "s"

                    ? (

                      <Question
                        item={current.it}
                        value={
                          sSel[current.it.item_no - 1]
                        }
                        onChange={(v) =>
                          setSSel((p) => {

                            const n = [...p];

                            n[current.it.item_no - 1] = v;

                            return n;

                          })
                        }
                      />

                    )

                    : (

                      <Question
                        item={current.it}
                        value={
                          kSel[current.it.item_no - 1]
                        }
                        onChange={(v) =>
                          setKSel((p) => {

                            const n = [...p];

                            n[current.it.item_no - 1] = v;

                            return n;

                          })
                        }
                      />

                    )}

              </div>

            )}


            {step === 2 && (

              <div className="bs-card">

                <h2>
                  その他
                </h2>


                <p className="bs-muted">

                  分析にのみ使います。
                  答えたくない項目は
                  空欄のままで構いません。

                </p>


                <div
                  className="bs-grid"
                  style={{
                    marginTop: 16,
                  }}
                >

                  <Select
                    id="age"
                    label="年齢"
                    value={meta.age_band}
                    options={AGES}
                    onChange={(v) =>
                      setMeta({
                        ...meta,
                        age_band: v,
                      })
                    }
                  />


                  <Select
                    id="sex"
                    label="性別"
                    value={meta.sex}
                    options={SEX}
                    onChange={(v) =>
                      setMeta({
                        ...meta,
                        sex: v,
                      })
                    }
                  />


                  <Select
                    id="hh"
                    label="世帯居住人数"
                    value={
                      meta.household_size
                    }
                    options={HOUSE}
                    onChange={(v) =>
                      setMeta({
                        ...meta,
                        household_size: v,
                      })
                    }
                  />


                  <Select
                    id="ry"
                    label="今のお住まいでの居住年数"
                    value={
                      meta.residence_years
                    }
                    options={RESIDENCE}
                    onChange={(v) =>
                      setMeta({
                        ...meta,
                        residence_years: v,
                      })
                    }
                  />

                </div>


                <div
                  className="bs-field"
                  style={{
                    marginTop: 16,
                  }}
                >

                  <label htmlFor="cert">
                    防災に関係する資格や経験
                    （例：看護師、消防団、救命講習受講経験）
                  </label>


                  <input
                    id="cert"
                    value={
                      meta.certifications
                    }
                    onChange={(e) =>
                      setMeta({
                        ...meta,
                        certifications:
                          e.target.value,
                      })
                    }
                  />

                </div>


                <div
                  className="bs-grid"
                  style={{
                    marginTop: 16,
                  }}
                >

                  <div className="bs-field">

                    <label htmlFor="jc">
                      職業上の災害時活動制約
                    </label>


                    <input
                      id="jc"
                      value={
                        meta.job_constraint
                      }
                      placeholder="例）会社の規定で参集がある為活動できない"
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          job_constraint:
                            e.target.value,
                        })
                      }
                    />

                  </div>


                  <div className="bs-field">

                    <label htmlFor="hc">
                      健康上の災害時活動制約
                    </label>


                    <input
                      id="hc"
                      value={
                        meta.health_constraint
                      }
                      placeholder="例）車いす使用のため避難に支障がある"
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          health_constraint:
                            e.target.value,
                        })
                      }
                    />

                  </div>

                </div>


                <div
                  className="bs-field"
                  style={{
                    marginTop: 16,
                  }}
                >

                  <label htmlFor="want">
                    今後学びたい事柄や
                    取り組みたい内容
                  </label>


                  <textarea
                    id="want"
                    rows={3}
                    value={
                      meta.learning_interest
                    }
                    onChange={(e) =>
                      setMeta({
                        ...meta,
                        learning_interest:
                          e.target.value,
                      })
                    }
                  />

                </div>


                {unanswered.length > 0 && (

                  <div
                    className="bs-note"
                    style={{
                      marginTop: 18,
                    }}
                  >

                    未回答が
                    {unanswered.length}
                    項目あります：

                    {unanswered
                      .slice(0, 6)
                      .join("、")}

                    {unanswered.length > 6 &&
                      " ほか"}

                    <br />

                    すべて回答してから
                    送信してください。

                  </div>

                )}


                {sendError && (

                  <p className="bs-error">
                    {sendError}
                  </p>

                )}

              </div>

            )}


            <div className="bs-actions">

              {(oneByOne
                ? step === 2 || qIdx > 0
                : step > 0) && (

                <button
                  className="bs-btn ghost"
                  onClick={goBack}
                >
                  前へ戻る
                </button>

              )}


              {step <
                steps.length - 1 && (

                <button
                  className="bs-btn"
                  onClick={goNext}
                >
                  次へ進む
                </button>

              )}


              {step ===
                steps.length - 1 && (

                <button
                  className="bs-btn"
                  onClick={send}
                  disabled={
                    phase === "sending" ||
                    unanswered.length > 0
                  }
                >

                  {phase === "sending"
                    ? "送信しています…"
                    : "回答を送信する"}

                </button>

              )}

            </div>

          </>

        )}


        {/* ======================================================
            完了
            ====================================================== */}

        {phase === "done" &&
          result && (

          <Done
            master={master}
            result={result}
            areaAvg={areaAvg}
            round={round}
          />

        )}

      </main>

    </div>

  );

}


/* ============================================================
   Select
   ============================================================ */

function Select({
  id,
  label,
  value,
  options,
  onChange,
}) {

  return (

    <div className="bs-field">

      <label htmlFor={id}>
        {label}
      </label>


      <select
        id={id}
        value={value}
        onChange={(e) =>
          onChange(e.target.value)
        }
      >

        <option value="">
          選択してください
        </option>

        {options.map((o) => (

          <option key={o}>
            {o}
          </option>

        ))}

      </select>

    </div>

  );

}


/* ============================================================
   Question
   ============================================================ */

function Question({
  item,
  value,
  onChange,
}) {

  return (

    <div className="bs-q">

      <div className="bs-q-head">

        <span className="bs-qno">
          {item.item_no}
        </span>


        <span>

          <span className="bs-qcat">
            {item.category}
          </span>

          <span className="bs-qlabel">
            {item.label}
          </span>

        </span>

      </div>


      {item.note && (

        <p className="bs-note sm">
          {item.note}
        </p>

      )}


      <div
        className="bs-opts"
        role="group"
        aria-label={item.label}
      >

        {(item.options ?? []).map(
          (o, i) => (

            <button
              key={o.label}
              type="button"
              className="bs-opt"
              aria-pressed={
                value === i
              }
              onClick={() =>
                onChange(i)
              }
            >

              <span className="bs-dot" />

              <span>
                {o.label}
              </span>

            </button>

          )
        )}

      </div>

    </div>

  );

}


/* ============================================================
   QuizBlock
   ============================================================ */

function QuizBlock({
  item,
  answers,
  onChange,
}) {

  const done =
    answers.every(
      (a) => a !== null
    );


  const correct =
    answers.filter(
      (a) => a === true
    ).length;


  return (

    <div className="bs-q">

      <div className="bs-q-head">

        <span className="bs-qno">
          {item.item_no}
        </span>


        <span>

          <span className="bs-qcat">
            {item.category}
            ・知識チェック
          </span>

          <span className="bs-qlabel">
            {item.label}
            （5問）
          </span>

        </span>

      </div>


      <div className="bs-quiz">

        {(item.quiz ?? []).map(
          (q, i) => (

            <div
              className="bs-quizrow"
              key={i}
            >

              <p>
                {i + 1}. {q}
              </p>


              <div
                className="bs-ox"
                role="group"
                aria-label={q}
              >

                <button
                  type="button"
                  aria-label="はい"
                  aria-pressed={
                    answers[i] === true
                  }
                  onClick={() =>
                    onChange(i, true)
                  }
                >
                  〇
                </button>


                <button
                  type="button"
                  className="x"
                  aria-label="いいえ"
                  aria-pressed={
                    answers[i] === false
                  }
                  onClick={() =>
                    onChange(i, false)
                  }
                >
                  ×
                </button>

              </div>

            </div>

          )
        )}

      </div>


      <p
        className="bs-muted"
        style={{
          marginTop: 8,
        }}
      >

        {done
          ? `${correct} / 5点`
          : `未回答 ${
              answers.filter(
                (a) => a === null
              ).length
            }問`}

      </p>

    </div>

  );

}


/* ============================================================
   Done
   ============================================================ */

function Done({
  master,
  result,
  areaAvg,
  round,
}) {

  const kTotal =
    r2(sum(result.k));


  const sTotal =
    r2(sum(result.s));


  const total =
    r2(kTotal + sTotal);


  const weak = [

    ...master.shodou.map(
      (it, i) => ({
        ...it,
        score: result.s[i],
        sec: "初動対応力",
      })
    ),

    ...master.koudou.map(
      (it, i) => ({
        ...it,
        score: result.k[i],
        sec: "防災行動力",
      })
    ),

  ]
    .filter(
      (x) => x.score <= 2.5
    )
    .sort(
      (a, b) =>
        a.score - b.score
    )
    .slice(0, 6);


  return (

    <>

      <div className="bs-band">

        <b>
          回答ありがとうございました
        </b>

        <span>
          結果をお返しします
        </span>

      </div>


      <div className="bs-scores">

        <div className="bs-score">

          <div className="k">
            防災行動力
          </div>

          <div className="v">
            {kTotal}
            <span className="u">
              {" "}
              /100
            </span>
          </div>

          <div className="bs-meter">

            <i
              style={{
                width: `${kTotal}%`,
              }}
            />

          </div>

        </div>


        <div className="bs-score">

          <div className="k">
            初動対応力
          </div>

          <div className="v">
            {sTotal}
            <span className="u">
              {" "}
              /100
            </span>
          </div>

          <div className="bs-meter">

            <i
              style={{
                width: `${sTotal}%`,
              }}
            />

          </div>

        </div>


        <div className="bs-score total">

          <div className="k">
            総合得点
          </div>

          <div className="v">
            {total}
            <span className="u">
              {" "}
              /200
            </span>
          </div>

          <div className="bs-meter">

            <i
              style={{
                width: `${total / 2}%`,
              }}
            />

          </div>

        </div>

      </div>


      <div className="bs-charts">

        <ResultRadar
          title="防災行動力"
          items={master.koudou}
          mine={result.k}
          area={areaAvg?.koudou}
        />


        <ResultRadar
          title="初動対応力"
          items={master.shodou}
          mine={result.s}
          area={areaAvg?.shodou}
        />

      </div>


      {areaAvg &&
        !areaAvg.available && (

        <p className="bs-note">

          地域平均は、
          回答が5名分そろってから
          表示されます。

        </p>

      )}


      <div className="bs-card">

        <h2>
          まず取り組むと効果の大きい項目
        </h2>


        <p className="bs-muted">

          2.5点以下の項目を、
          点数の低い順に並べています。

        </p>


        {weak.length === 0

          ? (

            <p
              style={{
                marginTop: 10,
              }}
            >
              2.5点以下の項目はありませんでした。
            </p>

          )

          : (

            weak.map(
              (w, i) => (

                <div
                  className="bs-prop"
                  key={`${w.section}-${w.item_no}`}
                >

                  <span
                    className="bs-rank"
                    style={{
                      background:
                        w.score <= 1
                          ? "#c1272d"
                          : w.score <= 2
                            ? "#e0a12c"
                            : "#00703c",
                    }}
                  >
                    {i + 1}
                  </span>


                  <span>

                    <b>
                      {w.sec}
                      ／
                      {w.category}
                      ／
                      {w.item_no}.
                      {" "}
                      {w.label}
                    </b>


                    <span className="sc">
                      現状 {r2(w.score)} 点
                    </span>


                    <p>
                      {w.improvement_tip}
                    </p>

                  </span>

                </div>

              )
            )

          )}

      </div>


      <div className="bs-card">

        <p className="bs-muted">

          結果を手元に残しておきたい方は、
          下のボタンからどうぞ。
          地域全体の集計結果は、
          後日自治会からお知らせします。

        </p>


        <ResultImage
          master={master}
          result={result}
          areaAvg={areaAvg}
          roundLabel={round?.round_label}
          assocName={round?.association_name}
          weak={weak}
        />


        <div className="bs-actions">

          <button
            className="bs-btn ghost"
            onClick={() =>
              window.print()
            }
          >
            この画面を印刷する
          </button>

        </div>


        <p
          className="bs-muted"
          style={{ marginTop: 10 }}
        >

          スマートフォンでは印刷が使えないことがあります。
          その場合は上の「結果を画像で保存する」をお使いください。

        </p>

      </div>

    </>

  );

}


/* ============================================================
   ResultRadar
   ============================================================ */

function ResultRadar({
  title,
  items,
  mine,
  area,
}) {

  const hasArea =
    Array.isArray(area) &&
    area.some(
      (v) => v != null
    );


  const data =
    items.map(
      (it, i) => ({

        no:
          String(it.item_no),

        label:
          it.label,

        あなた:
          mine[i],

        ...(hasArea
          ? {
              地域平均:
                area[i] ?? 0,
            }
          : {}),

      })
    );


  return (

    <div className="bs-chart">

      <h3>
        {title}
      </h3>


      <div
        style={{
          width: "100%",
          height: 330,
        }}
      >

        <ResponsiveContainer>

          <RadarChart
            data={data}
            outerRadius="72%"
          >

            <PolarGrid
              stroke="#d3dbd5"
            />


            <PolarAngleAxis
              dataKey="no"
              tick={{
                fontSize: 11,
                fill: "#5b6b62",
              }}
            />


            <PolarRadiusAxis
              domain={[0, 5]}
              tickCount={6}
              angle={90}
              tick={{
                fontSize: 10,
                fill: "#9aa8a0",
              }}
            />


            <Tooltip
              formatter={(v, n) => [
                `${r2(v)} 点`,
                n,
              ]}
              labelFormatter={(l) => {

                const d =
                  data.find(
                    (x) =>
                      x.no === l
                  );

                return `${l}. ${
                  d
                    ? d.label
                    : ""
                }`;

              }}
              contentStyle={{
                fontSize: 13,
                borderRadius: 6,
                border:
                  "1px solid #d3dbd5",
              }}
            />


            <Legend
              wrapperStyle={{
                fontSize: 13,
              }}
            />


            <Radar
              name="あなた"
              dataKey="あなた"
              stroke="#00703c"
              fill="#00703c"
              fillOpacity={0.28}
              strokeWidth={2}
            />


            {hasArea && (

              <Radar
                name="地域平均"
                dataKey="地域平均"
                stroke="#e0a12c"
                fill="#e0a12c"
                fillOpacity={0.12}
                strokeWidth={2}
              />

            )}

          </RadarChart>

        </ResponsiveContainer>

      </div>

    </div>

  );

}


/* ============================================================
   スタイル
   ============================================================ */

const CSS = `

.bs{
 --ink:#16211c;
 --sub:#5b6b62;
 --line:#d3dbd5;
 --paper:#eef2ee;
 --card:#fff;
 --green:#00703c;
 --green-d:#004f2a;
 --green-l:#e3efe8;
 --red:#c1272d;
 --amber:#e0a12c;
 --amber-l:#fbf1dd;

 color:var(--ink);
 background:var(--paper);
 font-size:17px;
 line-height:1.7;
 min-height:100vh;

 font-family:
 "Hiragino Kaku Gothic ProN",
 "Hiragino Sans",
 "Yu Gothic",
 YuGothic,
 "Noto Sans JP",
 Meiryo,
 sans-serif;

 -webkit-font-smoothing:antialiased;
}

.bs *{
 box-sizing:border-box;
}

.bs-wrap{
 max-width:940px;
 margin:0 auto;
 padding:0 16px 72px;
}

.bs-head{
 background:var(--green-d);
 color:#fff;
 border-bottom:6px solid var(--amber);
}

.bs-head-in{
 max-width:940px;
 margin:0 auto;
 padding:20px 16px 16px;
}

.bs-eyebrow{
 font-size:12px;
 letter-spacing:.32em;
 opacity:.75;
 margin:0 0 4px;
}

.bs-title{
 font-size:26px;
 font-weight:900;
 margin:0;
 letter-spacing:.02em;
}

.bs-lede{
 font-size:14px;
 opacity:.85;
 margin:6px 0 0;
}

.bs-card{
 background:var(--card);
 border:1px solid var(--line);
 border-radius:6px;
 padding:20px;
 margin-top:16px;
}

.bs-card h2{
 font-size:19px;
 font-weight:900;
 margin:0 0 4px;
}

.bs-muted{
 color:var(--sub);
 font-size:14px;
 margin:0;
}

.bs-error{
 color:var(--red);
 font-weight:700;
 font-size:15px;
 margin:10px 0 0;
}

.bs-band{
 display:flex;
 gap:12px;
 align-items:baseline;
 background:var(--green);
 color:#fff;
 padding:10px 14px;
 border-radius:4px;
 margin-top:24px;
}

.bs-band b{
 font-size:18px;
 font-weight:900;
 letter-spacing:.04em;
}

.bs-band span{
 font-size:13px;
 opacity:.85;
}

.bs-q{
 border-bottom:1px solid var(--line);
 padding:16px 0;
}

.bs-q:last-child{
 border-bottom:0;
}

.bs-q-head{
 display:flex;
 gap:10px;
 align-items:flex-start;
 margin-bottom:10px;
}

.bs-qno{
 flex:none;
 min-width:30px;
 height:30px;
 display:grid;
 place-items:center;
 background:var(--green-l);
 color:var(--green-d);
 border-radius:4px;
 font-weight:900;
 font-size:14px;
 font-variant-numeric:tabular-nums;
}

.bs-qcat{
 display:block;
 font-size:11px;
 letter-spacing:.12em;
 color:var(--sub);
}

.bs-qlabel{
 font-weight:700;
 line-height:1.5;
}

.bs-note{
 background:var(--amber-l);
 border-left:4px solid var(--amber);
 padding:9px 13px;
 font-size:14px;
 border-radius:0 4px 4px 0;
 margin:12px 0 0;
}

.bs-note.sm{
 font-size:13px;
 margin:0 0 10px;
}

.bs-opts{
 display:flex;
 gap:8px;
 flex-wrap:wrap;
}

.bs-opt{
 flex:1 1 180px;
 min-height:56px;
 display:flex;
 align-items:center;
 gap:10px;
 border:2px solid var(--line);
 background:#fff;
 border-radius:6px;
 padding:8px 14px;
 font:inherit;
 font-size:16px;
 text-align:left;
 cursor:pointer;
 color:var(--ink);
}

.bs-opt:hover{
 border-color:var(--green);
}

.bs-opt[aria-pressed="true"]{
 border-color:var(--green);
 background:var(--green-l);
 font-weight:800;
}

.bs-dot{
 flex:none;
 width:20px;
 height:20px;
 border-radius:50%;
 border:2px solid var(--line);
}

.bs-opt[aria-pressed="true"] .bs-dot{
 border-color:var(--green);
 background:var(--green);
 box-shadow:
 inset 0 0 0 3px #fff;
}

.bs-quiz{
 border:2px solid var(--green-l);
 border-radius:6px;
 padding:4px 14px;
 margin-top:6px;
}

.bs-quizrow{
 display:flex;
 gap:12px;
 align-items:center;
 justify-content:space-between;
 padding:12px 0;
 border-bottom:1px dashed var(--line);
}

.bs-quizrow:last-child{
 border-bottom:0;
}

.bs-quizrow p{
 margin:0;
 font-size:15px;
 line-height:1.5;
}

.bs-ox{
 display:flex;
 gap:6px;
 flex:none;
}

.bs-ox button{
 width:52px;
 height:48px;
 border:2px solid var(--line);
 background:#fff;
 border-radius:6px;
 font:inherit;
 font-size:20px;
 font-weight:900;
 cursor:pointer;
 color:var(--sub);
}

.bs-ox button[aria-pressed="true"]{
 border-color:var(--green);
 background:var(--green);
 color:#fff;
}

.bs-ox button.x[aria-pressed="true"]{
 border-color:var(--red);
 background:var(--red);
}

.bs-grid{
 display:grid;
 grid-template-columns:
 repeat(auto-fit,minmax(240px,1fr));
 gap:14px;
}

.bs-field label{
 display:block;
 font-weight:700;
 font-size:14px;
 margin-bottom:6px;
}

.bs-field input,
.bs-field select,
.bs-field textarea{
 width:100%;
 font:inherit;
 font-size:16px;
 padding:12px;
 border:2px solid var(--line);
 border-radius:6px;
 background:#fff;
 color:var(--ink);
}

.bs-prog{
 position:sticky;
 top:0;
 z-index:20;
 background:var(--paper);
 padding:10px 0 8px;
 border-bottom:1px solid var(--line);
}

.bs-prog-bar{
 height:10px;
 background:#fff;
 border:1px solid var(--line);
 border-radius:99px;
 overflow:hidden;
}

.bs-prog-fill{
 height:100%;
 background:var(--green);
 transition:width .3s ease;
}

.bs-prog-txt{
 display:flex;
 justify-content:space-between;
 font-size:13px;
 color:var(--sub);
 margin-bottom:6px;
 font-variant-numeric:tabular-nums;
}

.bs-btn{
 appearance:none;
 border:0;
 border-radius:6px;
 font:inherit;
 font-size:17px;
 font-weight:800;
 padding:16px 28px;
 cursor:pointer;
 background:var(--green);
 color:#fff;
}

.bs-btn:hover{
 background:var(--green-d);
}

.bs-btn:disabled{
 background:#b6c2ba;
 cursor:not-allowed;
}

.bs-btn.ghost{
 background:#fff;
 color:var(--green-d);
 border:2px solid var(--green);
}

.bs-actions{
 display:flex;
 gap:12px;
 flex-wrap:wrap;
 margin-top:20px;
}

.bs-btn:focus-visible,
.bs-opt:focus-visible,
.bs-ox button:focus-visible,
.bs-field input:focus,
.bs-field select:focus,
.bs-field textarea:focus{
 outline:3px solid var(--amber);
 outline-offset:2px;
}

.bs-scores{
 display:grid;
 grid-template-columns:
 repeat(auto-fit,minmax(200px,1fr));
 gap:2px;
 background:var(--line);
 border:1px solid var(--line);
 border-radius:6px;
 overflow:hidden;
 margin-top:16px;
}

.bs-score{
 background:#fff;
 padding:18px 16px;
}

.bs-score .k{
 font-size:12px;
 letter-spacing:.18em;
 color:var(--sub);
}

.bs-score .v{
 font-size:40px;
 font-weight:900;
 line-height:1.1;
 font-variant-numeric:tabular-nums;
}

.bs-score .u{
 font-size:15px;
 font-weight:700;
 color:var(--sub);
 margin-left:2px;
}

.bs-score.total{
 background:var(--green-d);
 color:#fff;
}

.bs-score.total .k,
.bs-score.total .u{
 color:rgba(255,255,255,.72);
}

.bs-meter{
 height:8px;
 background:var(--paper);
 border-radius:99px;
 margin-top:8px;
 overflow:hidden;
}

.bs-meter i{
 display:block;
 height:100%;
 background:var(--green);
}

.bs-score.total .bs-meter{
 background:rgba(255,255,255,.2);
}

.bs-score.total .bs-meter i{
 background:var(--amber);
}

.bs-charts{
 display:grid;
 grid-template-columns:
 repeat(auto-fit,minmax(320px,1fr));
 gap:16px;
 margin-top:16px;
}

.bs-chart{
 background:#fff;
 border:1px solid var(--line);
 border-radius:6px;
 padding:12px 8px 4px;
}

.bs-chart h3{
 text-align:center;
 font-size:16px;
 margin:6px 0 0;
}

.bs-prop{
 display:flex;
 gap:14px;
 padding:14px 0;
 border-bottom:1px solid var(--line);
}

.bs-prop:last-child{
 border-bottom:0;
}

.bs-rank{
 flex:none;
 width:34px;
 height:34px;
 display:grid;
 place-items:center;
 border-radius:4px;
 font-weight:900;
 font-size:15px;
 color:#fff;
 font-variant-numeric:tabular-nums;
}

.bs-prop b{
 display:block;
 font-size:15px;
}

.bs-prop p{
 margin:4px 0 0;
 font-size:15px;
}

.bs-prop .sc{
 font-size:13px;
 color:var(--sub);
 font-variant-numeric:tabular-nums;
}

@media (max-width:600px){

 .bs{
   font-size:16px;
 }

 .bs-title{
   font-size:21px;
 }

 .bs-opt{
   flex:1 1 100%;
 }

 .bs-quizrow{
   flex-direction:column;
   align-items:flex-start;
   gap:8px;
 }

 .bs-score .v{
   font-size:32px;
 }

}

@media print{

 .bs-head,
 .bs-actions,
 .bs-prog{
   display:none;
 }

 .bs{
   background:#fff;
 }

}

@media (prefers-reduced-motion:reduce){

 .bs *{
   transition:none!important;
 }

}


/* ------------------------------------------------------------
   表示設定（文字の大きさ・1問ずつ表示）
   ------------------------------------------------------------ */

.bs-tools{
 display:flex;
 gap:14px;
 flex-wrap:wrap;
 align-items:center;
 margin-top:14px;
}

.bs-tools-k{
 font-size:12px;
 letter-spacing:.14em;
 opacity:.8;
 margin-right:2px;
}

.bs-fs{
 display:flex;
 gap:6px;
 align-items:center;
 flex-wrap:wrap;
}

.bs-fs button,
.bs-mode{
 appearance:none;
 font:inherit;
 font-size:14px;
 font-weight:700;
 padding:7px 14px;
 border-radius:6px;
 border:2px solid rgba(255,255,255,.55);
 background:transparent;
 color:#fff;
 cursor:pointer;
 min-height:40px;
}

.bs-fs button:hover,
.bs-mode:hover{
 background:rgba(255,255,255,.16);
}

.bs-fs button[aria-pressed="true"],
.bs-mode[aria-pressed="true"]{
 background:#fff;
 color:var(--green-d);
 border-color:#fff;
}

.bs-fs button:focus-visible,
.bs-mode:focus-visible{
 outline:3px solid var(--amber);
 outline-offset:2px;
}

/* ------------------------------------------------------------
   1問ずつ表示
   ------------------------------------------------------------ */

.bs-one{
 padding-top:8px;
}

.bs-one-pos{
 font-size:13px;
 letter-spacing:.1em;
 color:var(--sub);
 margin:0 0 4px;
 font-weight:700;
}

.bs-one .bs-q{
 border-bottom:0;
 padding-bottom:4px;
}

/* ------------------------------------------------------------
   文字の大きさ
   本文は .bs の font-size を継承するので、
   px指定になっている読みづらい箇所だけを個別に上げています
   ------------------------------------------------------------ */

.bs.fs-2{
 font-size:19px;
}

.bs.fs-3{
 font-size:22px;
}

.bs.fs-2 .bs-opt{
 font-size:18px;
 min-height:62px;
}

.bs.fs-3 .bs-opt{
 font-size:21px;
 min-height:70px;
}

.bs.fs-2 .bs-note{
 font-size:16px;
}

.bs.fs-3 .bs-note{
 font-size:18px;
}

.bs.fs-2 .bs-note.sm{
 font-size:15px;
}

.bs.fs-3 .bs-note.sm{
 font-size:17px;
}

.bs.fs-2 .bs-qcat{
 font-size:13px;
}

.bs.fs-3 .bs-qcat{
 font-size:15px;
}

.bs.fs-2 .bs-qno{
 font-size:16px;
 min-width:34px;
 height:34px;
}

.bs.fs-3 .bs-qno{
 font-size:18px;
 min-width:38px;
 height:38px;
}

.bs.fs-2 .bs-quizrow p,
.bs.fs-2 .bs-field label,
.bs.fs-2 .bs-field input,
.bs.fs-2 .bs-field select,
.bs.fs-2 .bs-btn{
 font-size:18px;
}

.bs.fs-3 .bs-quizrow p,
.bs.fs-3 .bs-field label,
.bs.fs-3 .bs-field input,
.bs.fs-3 .bs-field select,
.bs.fs-3 .bs-btn{
 font-size:21px;
}

.bs.fs-2 .bs-ox button{
 min-width:56px;
 min-height:56px;
 font-size:22px;
}

.bs.fs-3 .bs-ox button{
 min-width:64px;
 min-height:64px;
 font-size:26px;
}

`;
