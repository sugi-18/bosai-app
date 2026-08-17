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
  const { data, error } = await supabase
    .from("v_round_summary")
    .select("*")
    .eq("association_id", associationId)
    .order("sequence");
  if (error) throw error;
  return data;
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

/** 紙で回答された分の代理入力（管理者権限で直接insert） */
export async function enterPaperResponse({ roundId, meta, answers }) {
  const { data: r, error: e1 } = await supabase
    .from("respondents")
    .insert({ round_id: roundId, entry_mode: "paper", ...meta })
    .select("id").single();
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

export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
