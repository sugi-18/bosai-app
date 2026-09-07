-- ============================================================
--  地域防災力評価システム / 追加スキーマ 第5弾
--
--  目的：
--    ・調査回の区分に「その他」を追加する
--    ・回答URLの合言葉について、大文字・小文字の区別をなくす
--      （get_open_round と get_round_item_averages が
--        まだ厳密一致のままだったため、あわせて直しています）
--
--  実行方法：
--    Supabase の SQL Editor に全文を貼って Run してください。
--    何度実行しても壊れません（同じ結果になります）。
--
--  ★ もし「ALTER TYPE ... cannot run inside a transaction block」
--    というエラーが出たときは、下の【1】の1行だけを選んで Run し、
--    そのあと【2】以降をまとめて Run してください。
-- ============================================================


-- ============================================================
--  【1】調査回の区分に「その他」を足す
--
--  これまでは baseline（現時点評価）と follow_up（取組み後評価）の
--  2つしかありませんでした。年度途中の追加調査や、
--  一部の班だけを対象にした調査など、
--  どちらにも当てはまらない回を記録できるようにします。
--
--  すでにある調査回の区分は変わりません。
-- ============================================================
alter type round_phase_t add value if not exists 'other';


-- ============================================================
--  【2】合言葉の大文字・小文字を区別しない
--
--  合言葉は「ABC123」のように大文字で発行されますが、
--  紙を見て打ち込む方は小文字で入れることがあります。
--  見た目が同じなのに「調査が見つかりません」と出ると、
--  原因に気づけません。すべて小文字にそろえて突き合わせます。
--
--  前後の空白（コピーのときに紛れ込みがちです）も取り除きます。
-- ============================================================

-- 回答画面が最初に呼ぶ：コードから受付中の調査回を引く
create or replace function get_open_round(p_access_code text)
returns table (round_id uuid, association_name text, round_label text, phase round_phase_t)
language sql stable security definer set search_path = public as $$
  select sr.id, a.name, sr.label, sr.phase
  from survey_rounds sr
  join associations a on a.id = sr.association_id
  where lower(sr.access_code) = lower(btrim(p_access_code))
    and sr.status = 'open';
$$;

-- 回答後に見せる地域平均（管理画面や個票の比較で使います）
create or replace function get_round_item_averages(p_access_code text)
returns table (section section_t, item_no smallint, avg_score numeric, respondents bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_round uuid; v_n integer;
begin
  select id into v_round from survey_rounds
   where lower(access_code) = lower(btrim(p_access_code))
     and status in ('open', 'closed');
  if v_round is null then
    raise exception '調査が見つかりません';
  end if;

  select count(*) into v_n from respondents where round_id = v_round;
  if v_n < 5 then
    return;            -- 5名未満は平均を出さない（個人の推定を防ぐ）
  end if;

  return query
    select a.section, a.item_no,
           round(avg(a.score)::numeric, 2),
           count(*)
      from answers a
      join respondents r on r.id = a.respondent_id
     where r.round_id = v_round
     group by a.section, a.item_no;
end $$;

-- 匿名コードの二重回答チェック
create or replace function resident_code_taken(p_access_code text, p_resident_code text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from respondents r
      join survey_rounds sr on sr.id = r.round_id
     where lower(sr.access_code) = lower(btrim(p_access_code))
       and r.resident_code = p_resident_code
  );
$$;

revoke all on function get_open_round(text) from public;
revoke all on function get_round_item_averages(text) from public;
revoke all on function resident_code_taken(text, text) from public;
grant execute on function get_open_round(text) to anon, authenticated;
grant execute on function get_round_item_averages(text) to anon, authenticated;
grant execute on function resident_code_taken(text, text) to anon, authenticated;


-- ============================================================
--  【3】確認
--     下の行を選んで Run すると、使える区分の一覧が見られます。
--     baseline / follow_up / other の3つが並べば成功です。
-- ============================================================
-- select unnest(enum_range(null::round_phase_t)) as 区分;
