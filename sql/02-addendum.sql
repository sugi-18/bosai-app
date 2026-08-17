-- ============================================================
--  追加スキーマ：回答画面（住民向け・未ログイン）を動かすための3点
--  supabase-schema.sql を実行済みの環境に、追記で流してください
-- ============================================================

-- ------------------------------------------------------------
-- 1. 設問の注記（「過去5年間で1度でも…」）を持たせる
-- ------------------------------------------------------------
alter table item_master add column if not exists note text;

update item_master
   set note = '過去5年間で1度でもご参加（訓練）されていれば、「参加（訓練）している」を選択してください。'
 where (section = 'koudou' and item_no between 14 and 18)
    or (section = 'shodou' and item_no in (1, 8, 9, 13, 14, 17, 18));


-- ------------------------------------------------------------
-- 2. 回答後に見せる「地域平均」
--    生データはRLSで住民に見せない。平均だけをRPC経由で返し、
--    回答数が少ないうちは個人が推定できてしまうので返さない
-- ------------------------------------------------------------
create or replace function get_round_item_averages(p_access_code text)
returns table (section section_t, item_no smallint, avg_score numeric, respondents bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_round uuid; v_n integer;
begin
  select id into v_round from survey_rounds
   where access_code = p_access_code and status in ('open', 'closed');
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


-- ------------------------------------------------------------
-- 3. 匿名コードの二重回答チェック
--    送信ボタンを押す前に気づけるようにする。
--    存在有無だけを返し、コードの一覧は漏らさない
-- ------------------------------------------------------------
create or replace function resident_code_taken(p_access_code text, p_resident_code text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from respondents r
      join survey_rounds sr on sr.id = r.round_id
     where sr.access_code = p_access_code
       and r.resident_code = p_resident_code
  );
$$;


revoke all on function get_round_item_averages(text) from public;
revoke all on function resident_code_taken(text, text) from public;
grant execute on function get_round_item_averages(text) to anon, authenticated;
grant execute on function resident_code_taken(text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 補足：submit_response は一意制約 (round_id, resident_code) により
-- 二重投函でエラーになります。画面側で下記コードを拾って
-- 「すでに回答済みです」と表示してください
--   error.code === '23505'  → unique_violation
-- ------------------------------------------------------------
