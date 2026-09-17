/**
 * 地域防災力評価システム / Supabase データアクセス層
 *
 *   npm i @supabase/supabase-js
 *   .env に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を置く
 *
 * 画面側はこのファイルの関数だけを呼ぶようにしておくと、
 * 保存先を差し替えたくなったときにここだけ直せば済みます。
 */
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

/* ============================================================
   時計のずれによる一時的なエラーへの対処

   Supabase側で、ログイン発行サーバー（Auth）とデータ取得サーバー
   （PostgREST）の時計が数秒ずれていると、発行されたばかりの
   ログイン情報が「未来の時刻で発行されている」として弾かれ、
   "JWT issued at future" というエラーになります。
   ずれは通常数秒なので、少し待って呼び直せば通ります。

   根本的にはSupabase側の問題なので、頻発する場合は
   プロジェクトの再起動やサポートへの連絡が必要です。
   ============================================================ */

const CLOCK_SKEW = /issued at future|PGRST30[13]/i;

/** 時計のずれで失敗したときだけ、少し待って呼び直す */
export async function withClockSkewRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!CLOCK_SKEW.test(e?.message ?? "")) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}


/* ============================================================
   住民向け（未ログイン）
   ============================================================ */

/** 回答URLのコードから、受付中の調査回を引く */
export async function getOpenRound(accessCode) {
  const { data, error } = await supabase.rpc("get_open_round", { p_access_code: accessCode });
  if (error) throw error;
  if (!data?.length) throw new Error("受付中の調査が見つかりません。コードをご確認ください。");
  return data[0];
}

/** 設問マスタ（設問文・選択肢・配点）をDBから取得 */
export async function getItemMaster() {
  const { data, error } = await supabase
    .from("item_master")
    .select("section,item_no,category,label,input_type,options,quiz,improvement_tip")
    .order("section")
    .order("item_no");
  if (error) throw error;
  return {
    koudou: data.filter((d) => d.section === "koudou"),
    shodou: data.filter((d) => d.section === "shodou"),
  };
}

/**
 * 回答を投函する。40項目そろっていなければサーバー側で丸ごと失敗する。
 * answers の形: [{section, item_no, score, choice_index?, quiz_correct?}, ...]
 */
export async function submitResponse({ accessCode, meta, answers }) {
  if (answers.length !== 40) {
    throw new Error(`40項目の回答が必要です（現在 ${answers.length} 件）`);
  }
  const { data, error } = await supabase.rpc("submit_response", {
    p_access_code: accessCode,
    p_meta: meta ?? {},
    p_answers: answers,
  });
  if (error) throw error;
  return data; // respondent_id
}

/**
 * 回答後に見せる地域平均。回答者5名未満の調査回では空配列が返る
 * （個人の推定を防ぐためサーバー側で伏せている）
 */
export async function getRoundItemAverages(accessCode) {
  const { data, error } = await supabase.rpc("get_round_item_averages", { p_access_code: accessCode });
  if (error) throw error;
  const koudou = Array(20).fill(null);
  const shodou = Array(20).fill(null);
  (data ?? []).forEach((row) => {
    const arr = row.section === "koudou" ? koudou : shodou;
    arr[row.item_no - 1] = Number(row.avg_score);
  });
  return { koudou, shodou, available: (data ?? []).length > 0 };
}

/** 匿名コードがその調査回ですでに使われているか */
export async function isResidentCodeTaken(accessCode, residentCode) {
  if (!residentCode) return false;
  const { data, error } = await supabase.rpc("resident_code_taken", {
    p_access_code: accessCode,
    p_resident_code: residentCode,
  });
  if (error) throw error;
  return data === true;
}

/** 回答画面のstateを投函形式に変換する */
export function buildAnswerPayload({ koudouScores, shodouScores, quizCorrect }) {
  const out = [];
  koudouScores.forEach((s, i) =>
    out.push({ section: "koudou", item_no: i + 1, score: s.score, choice_index: s.index })
  );
  shodouScores.forEach((s, i) => {
    const no = i + 1;
    if (quizCorrect[no]) {
      out.push({
        section: "shodou",
        item_no: no,
        score: quizCorrect[no].filter(Boolean).length,
        quiz_correct: quizCorrect[no],
      });
    } else {
      out.push({ section: "shodou", item_no: no, score: s.score, choice_index: s.index });
    }
  });
  return out;
}

/* ============================================================
   管理者向け（要ログイン）
   ============================================================ */

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** 現在のログイン状態を取得（画面起動時に呼ぶ） */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/** ログイン状態の変化を監視する。戻り値を呼ぶと監視を解除 */
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** 自分が管理する自治会 */
export async function getMyAssociations() {
  const { data, error } = await supabase
    .from("associations")
    .select("id,name,municipality,household_count")
    .order("name");
  if (error) throw error;
  return data;
}

/** 調査回の一覧とサマリ（回答数・回答率・平均点） */
export async function getRoundSummaries(associationId) {
  /*
   * 集計ビュー v_round_summary には合言葉（access_code）が含まれていません。
   * 集計用のビューに合言葉を混ぜると、閲覧権限を分けたくなったときに
   * 困るためです。回答URLの組み立てに必要なので、
   * ここで元のテーブルから引いて合わせています。
   */
  const [{ data, error }, { data: codes, error: e2 }] = await Promise.all([
    supabase.from("v_round_summary").select("*")
      .eq("association_id", associationId).order("sequence"),
    selectWithOptional(
      "survey_rounds", ["id", "access_code"], ["show_resident_code"],
      (q) => q.eq("association_id", associationId)),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const byId = Object.fromEntries((codes ?? []).map((c) => [c.id, c]));
  return (data ?? []).map((r) => ({
    ...r,
    access_code: byId[r.round_id]?.access_code ?? null,
    show_resident_code: byId[r.round_id]?.show_resident_code ?? false,
  }));
}

/**
 * あとから足した列を、まだSQLを流していない環境でも安全に読むための受け皿。
 *
 * 新しい列を select に書くと、列が無い環境では問い合わせ全体が失敗し、
 * 画面がまるごと真っ白になります。それでは原因も分かりません。
 * ここでは、失敗した理由が「その列が無い」ことだった場合にかぎり、
 * 新しい列を外してもう一度読み直します。
 * SQLを流したあとは、そのまま新しい列も読めます。
 */
export async function selectWithOptional(table, baseCols, optionalCols, refine) {
  const ask = (cols) => {
    const q = supabase.from(table).select(cols.join(","));
    return refine ? refine(q) : q;
  };

  const res = await ask([...baseCols, ...optionalCols]);
  const msg = res.error?.message ?? "";
  if (res.error && optionalCols.some((c) => msg.includes(c))) {
    return ask(baseCols);
  }
  return res;
}

/** 指定した調査回の項目別平均（40件） */
export async function getItemAverages(roundId) {
  const { data, error } = await supabase
    .from("v_item_averages")
    .select("*")
    .eq("round_id", roundId)
    .order("section")
    .order("item_no");
  if (error) throw error;
  return data;
}

/** 区分別平均（9区分） */
export async function getCategoryAverages(roundId) {
  const { data, error } = await supabase
    .from("v_category_averages")
    .select("*")
    .eq("round_id", roundId);
  if (error) throw error;
  return data;
}

/** 経年比較：全調査回の項目別平均と前回差 */
export async function getItemTrend(associationId) {
  const { data, error } = await supabase
    .from("v_item_trend")
    .select("*")
    .eq("association_id", associationId)
    .order("sequence")
    .order("section")
    .order("item_no");
  if (error) throw error;
  return data;
}

/** 経年比較：同一人（resident_code）の伸び */
export async function getRespondentTrend(associationId) {
  const { data, error } = await supabase
    .from("v_respondent_trend")
    .select("*")
    .eq("association_id", associationId)
    .order("resident_code")
    .order("sequence");
  if (error) throw error;
  return data;
}

/** 属性別クロス集計（年代別の平均点など） */
export async function getTotalsByAttribute(roundId) {
  const { data, error } = await supabase
    .from("v_respondent_totals")
    .select("respondent_id,age_band,member_type,koudou_total,shodou_total,grand_total")
    .eq("round_id", roundId);
  if (error) throw error;
  return data;
}

/* ============================================================
   調査回の運用
   ============================================================ */

/** 新しい調査回を作る。sequence は自動採番 */
export async function createRound({ associationId, label, phase = "baseline", targetHouseholds }) {
  const { data: rounds } = await supabase
    .from("survey_rounds").select("sequence")
    .eq("association_id", associationId).order("sequence", { ascending: false }).limit(1);
  const nextSeq = (rounds?.[0]?.sequence ?? 0) + 1;
  const accessCode = Math.random().toString(36).slice(2, 8).toUpperCase();

  const { data, error } = await supabase.from("survey_rounds").insert({
    association_id: associationId,
    label, phase, sequence: nextSeq,
    access_code: accessCode,
    target_households: targetHouseholds ?? null,
    status: "draft",
  }).select().single();
  if (error) throw error;
  return data;
}

export async function setRoundStatus(roundId, status) {
  const { error } = await supabase.from("survey_rounds").update({ status }).eq("id", roundId);
  if (error) throw error;
}

/** 調査回の内容を書き換える（名称・実施日・区分・合言葉など） */
export async function updateRound(roundId, patch) {
  const { error } = await supabase.from("survey_rounds").update(patch).eq("id", roundId);
  if (error) throw error;
}

/** 調査回を削除する。ぶら下がる回答もすべて消えます */
export async function deleteRound(roundId) {
  const { error } = await supabase.from("survey_rounds").delete().eq("id", roundId);
  if (error) throw error;
}

/** 回答者の属性を書き換える */
export async function updateRespondent(respondentId, patch) {
  const { error } = await supabase.from("respondents").update(patch).eq("id", respondentId);
  if (error) throw error;
}

/** 回答者を削除する。その人の40項目の回答もすべて消えます */
export async function deleteRespondent(respondentId) {
  const { error } = await supabase.from("respondents").delete().eq("id", respondentId);
  if (error) throw error;
}

/**
 * 回答の点数を書き換える。
 * rows は [{ section, item_no, score, choice_index, quiz_correct }] の形。
 * 既にある行を上書きするので、直したい項目だけ渡せば足ります。
 */
export async function updateAnswers(respondentId, rows) {
  const payload = rows.map((r) => ({ ...r, respondent_id: respondentId }));
  const { error } = await supabase
    .from("answers")
    .upsert(payload, { onConflict: "respondent_id,section,item_no" });
  if (error) throw error;
}

/** 自治会を新しく作る。実行した人がそのまま管理者になります */
export async function createAssociation({ name, municipality, householdCount }) {
  const { data, error } = await supabase.rpc("create_association", {
    p_name: name,
    p_municipality: municipality ?? null,
    p_household_count: householdCount ?? null,
  });
  if (error) throw error;
  return data;
}

/** 自治会の名称などを書き換える */
export async function updateAssociation(associationId, patch) {
  const { error } = await supabase.from("associations").update(patch).eq("id", associationId);
  if (error) throw error;
}

/** 紙で回答された分の代理入力（管理者権限で直接insert） */
export async function enterPaperResponse({ roundId, meta, answers }) {
  const payload = { round_id: roundId, entry_mode: "paper", ...meta };

  const add = (body) => supabase.from("respondents").insert(body).select("id").single();

  let { data: r, error: e1 } = await add(payload);

  /*
   * 「前回の調査に回答したか」は、あとから足した項目です。
   * まだSQLを流していない環境では、その項目のせいで登録できません。
   * 入力し終えたものを無駄にしないよう、その項目だけ外して登録し直します。
   */
  if (e1 && (e1.message ?? "").includes("prior_round_answered")) {
    const { prior_round_answered, ...rest } = payload;
    ({ data: r, error: e1 } = await add(rest));
  }
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from("answers")
    .insert(answers.map((a) => ({ ...a, respondent_id: r.id })));
  if (e2) {
    await supabase.from("respondents").delete().eq("id", r.id); // 部分登録を残さない
    throw e2;
  }
  return r.id;
}

/* ============================================================
   書き出し
   ============================================================ */

/** Excelでそのまま開けるCSV（BOM付きUTF-8） */
export function toCsv(rows, header) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
}

/**
 * 指定した部分だけを印刷する。
 *
 * 画面全体の印刷と、個票や総会資料など「一部分だけ」の印刷が
 * 同じ window.print() を共有しているため、印刷したい要素に目印を付け、
 * その間だけ body に印。CSS側でその印を見て、対象以外を隠します。
 *
 * ★ 白紙ページが出ていた原因と対処（重要）
 *   以前は「対象以外を visibility:hidden で見えなくする」方式でした。
 *   visibility:hidden は見えなくなるだけで場所は残るため、
 *   管理画面の長い中身がそのまま紙の高さとして数えられ、
 *   資料のあとに白紙が何枚も続いていました。
 *
 *   そこで、印刷したい要素とその親だけに print-keep / print-target の印を付け、
 *   それ以外は display:none で「場所ごと」消すやり方に変えています。
 *   親をたどって印を付けるのは、途中の親まで消してしまうと
 *   中身ごと消えてしまうためです。
 */
let printScope = null;

/**
 * 「ここだけを印刷する」状態にする。
 *
 * ★ 印刷ボタンが効かないときに全体が刷られてしまう件について
 *   ブラウザには「利用者が押していない印刷は実行しない」という決まりがあり、
 *   Firefox では「このWebサイトから自動的に印刷することは禁止されています」と
 *   出て、画面の印刷ボタンが効かないことがあります。
 *   そのあと利用者が Ctrl+P で印刷すると、以前の作りでは
 *   目印がもう外れていたため、管理画面まるごとが刷られていました。
 *
 *   そこで、印刷プレビューを開いているあいだはずっと目印を付けたままにします。
 *   こうしておけば、画面のボタンから刷っても、Ctrl+P やブラウザのメニューから
 *   刷っても、対象の資料だけが出ます。
 *   目印は印刷用の指定（@media print）にしか効かないので、
 *   画面の見え方は変わりません。
 */
export function beginPrintScope(selector) {
  endPrintScope();

  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;

  const marked = [];
  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    node.classList.add("print-keep");
    marked.push(node);
    node = node.parentElement;
  }

  el.classList.add("print-target");
  document.body.classList.add("printing-one");
  printScope = { el, marked };
}

/** 「ここだけを印刷する」状態を解除する */
export function endPrintScope() {
  if (!printScope) return;
  printScope.el.classList.remove("print-target");
  printScope.marked.forEach((n) => n.classList.remove("print-keep"));
  document.body.classList.remove("printing-one");
  printScope = null;
}

/**
 * 指定した部分だけをその場で印刷する。
 * 個票のように、プレビュー画面を挟まずに刷るところで使います。
 */
export function printElement(selector) {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) { window.print(); return; }

  beginPrintScope(el);

  /* 印刷が終わったら戻す。
     afterprint が来ない環境もあるので、時間でも戻るようにしておく。
     （目印が残っていても画面の見え方は変わらないため、急いで消す必要はない） */
  window.addEventListener("afterprint", endPrintScope, { once: true });
  setTimeout(endPrintScope, 120000);

  window.print();
}

export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
