-- ============================================================
--  地域防災力評価システム / 追加スキーマ 第8弾
--
--  追加すること：
--    1. 第2回以降の調査で、「前回の調査に回答したか」を
--       うかがう項目を追加する
--       → 属性別の比較で「継続して回答した方」だけを取り出せます
--    2. アンケート用紙に「回答番号」欄を入れるかどうかを、
--       調査回ごとに管理画面から決められるようにする
--
--  実行方法：
--    Supabase の SQL Editor に全文を貼って Run してください。
--    何度実行しても壊れません。
--    06 → 07 → 08 → 09 の順に実行済みであることが前提です。
-- ============================================================


-- ============================================================
--  1. 「前回の調査に回答したか」を入れる場所
--
--  回答番号（resident_code）を配っていれば、
--  番号どうしを突き合わせて同じ方を追えます。
--  ただ、番号を配らない調査のほうが多いため、
--  ご本人の申告でも継続回答者を取り出せるようにします。
--
--  「わからない」を選べるようにしているのは、
--  1年前のことを覚えていない方に
--  どちらかを無理に選ばせると、
--  かえって集計が不正確になるためです。
-- ============================================================
alter table respondents
  add column if not exists prior_round_answered text
  check (prior_round_answered in ('回答した', '回答していない', 'わからない'));

comment on column respondents.prior_round_answered is
  '前回の調査に回答したかどうか（第2回以降の調査でのみ質問する）';


-- ============================================================
--  2. 用紙に「回答番号」欄を入れるかどうか
--
--  番号を配らない調査では、用紙に空欄があると
--  「何を書けばよいのか」と迷わせてしまいます。
--  既定は「入れない」にしてあります。
-- ============================================================
alter table survey_rounds
  add column if not exists show_resident_code boolean not null default false;

comment on column survey_rounds.show_resident_code is
  'アンケート用紙に回答番号の記入欄を印刷するか';


-- ============================================================
--  3. 属性別の比較で使えるようにする
--     （集計用のビューに、新しい項目を足す）
-- ============================================================
--  ※ 新しい項目は、いちばん最後に足しています。
--    PostgreSQLの create or replace view は、
--    既にある列の並びを変えたり名前を付け替えたりできず、
--    末尾に足すことだけが許されているためです。
create or replace view v_respondent_attributes with (security_invoker = on) as
select r.id            as respondent_id,
       r.round_id,
       r.member_type,
       r.age_band,
       r.sex,
       r.household_size,
       r.residence_years,
       r.entry_mode,
       coalesce(sum(a.score) filter (where a.section = 'koudou'), 0) as koudou_total,
       coalesce(sum(a.score) filter (where a.section = 'shodou'), 0) as shodou_total,
       coalesce(sum(a.score), 0)                                     as grand_total,
       r.prior_round_answered
from respondents r
left join answers a on a.respondent_id = r.id
group by r.id;


-- ============================================================
--  4. 回答画面が「第2回以降かどうか」を知れるようにする
--
--  回答画面は合言葉しか持っていないため、
--  その調査回が何回目なのかを知る手立てがありません。
--  前の調査回があるかどうかと、その名称を返すようにします。
--
--  返す値が増えるので、いったん削除してから作り直します
--  （PostgreSQLでは、返す形が変わる場合は作り直しが必要です）。
-- ============================================================
drop function if exists get_open_round(text);

create function get_open_round(p_access_code text)
returns table (
  round_id           uuid,
  association_name   text,
  round_label        text,
  phase              round_phase_t,
  prior_round_exists boolean,
  prior_round_label  text
)
language sql stable security definer set search_path = public as $$
  select sr.id, a.name, sr.label, sr.phase,
         exists (
           select 1 from survey_rounds s2
            where s2.association_id = sr.association_id
              and s2.sequence < sr.sequence
         ),
         (
           select s3.label from survey_rounds s3
            where s3.association_id = sr.association_id
              and s3.sequence < sr.sequence
            order by s3.sequence desc
            limit 1
         )
  from survey_rounds sr
  join associations a on a.id = sr.association_id
  where lower(sr.access_code) = lower(btrim(p_access_code))
    and sr.status = 'open';
$$;

revoke all on function get_open_round(text) from public;
grant execute on function get_open_round(text) to anon, authenticated;


-- ============================================================
--  5. 回答の登録で、新しい項目を受け取れるようにする
-- ============================================================
create or replace function submit_response(
  p_access_code text,
  p_meta        jsonb default '{}'::jsonb,
  p_answers     jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_round_id uuid;
  v_id       uuid;
  v_count    int;
begin
  select sr.id into v_round_id
    from survey_rounds sr
   where lower(sr.access_code) = lower(btrim(p_access_code))
     and sr.status = 'open';

  if v_round_id is null then
    raise exception '受付中の調査が見つかりません';
  end if;

  insert into respondents (
    round_id, resident_code, member_type, age_band, sex, household_size,
    residence_years, prior_round_answered,
    certifications, job_constraint, health_constraint, learning_interest, entry_mode
  ) values (
    v_round_id,
    nullif(p_meta->>'resident_code', ''),
    coalesce(nullif(p_meta->>'member_type', ''), '住民'),
    nullif(p_meta->>'age_band', ''),
    nullif(p_meta->>'sex', ''),
    nullif(p_meta->>'household_size', ''),
    nullif(p_meta->>'residence_years', ''),
    nullif(p_meta->>'prior_round_answered', ''),
    nullif(p_meta->>'certifications', ''),
    nullif(p_meta->>'job_constraint', ''),
    nullif(p_meta->>'health_constraint', ''),
    nullif(p_meta->>'learning_interest', ''),
    coalesce(nullif(p_meta->>'entry_mode', ''), 'web')
  ) returning id into v_id;

  insert into answers (respondent_id, section, item_no, score, choice_index, quiz_correct)
  select v_id,
         (e->>'section')::section_t,
         (e->>'item_no')::smallint,
         (e->>'score')::numeric,
         nullif(e->>'choice_index', '')::smallint,
         case when e ? 'quiz_correct'
              then (select array_agg(x::boolean) from jsonb_array_elements_text(e->'quiz_correct') x)
         end
  from jsonb_array_elements(p_answers) e;

  select count(*) into v_count from answers where respondent_id = v_id;
  if v_count <> 40 then
    raise exception '40項目すべての回答が必要です（受信: %件）', v_count;
  end if;

  return v_id;
end $$;

revoke all on function submit_response(text, jsonb, jsonb) from public;
grant execute on function submit_response(text, jsonb, jsonb) to anon, authenticated;


-- ============================================================
--  6. 確認
--     下の行を選んで Run すると、追加された項目が見られます。
-- ============================================================
-- select round_id, round_label, prior_round_exists, prior_round_label
--   from get_open_round('合言葉をここに');
-- select prior_round_answered, count(*) from respondents group by 1;
