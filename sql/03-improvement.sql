-- ============================================================
--  地域防災力評価システム / 追加スキーマ 第3弾
--
--  目的：以下の機能の土台を用意します
--    ・改善アクション管理（提案 → 実施 → 次回スコアで効果確認）
--    ・属性別クロス集計（立場・年代・世帯人数・居住年数）
--
--  ※ 班（丁目）別の集計は、世帯数が確定してから別ファイルで追加します。
--     このファイルには含めていません。
--
--  実行方法：Supabase の SQL Editor に全文を貼って Run するだけです。
--            01-schema.sql / 02-addendum.sql を実行済みの環境が前提です。
--            何度実行しても壊れません（同じ結果になります）。
-- ============================================================


-- ============================================================
--  1. 居住年数（属性別クロス集計用）
--     「転入して間もない世帯ほど地域の取り決めを知らない」が
--     見えるようにするための項目です。
--     既存の回答は空欄のまま残り、次回調査から埋まっていきます。
-- ============================================================
do $$ begin
  alter table respondents add column if not exists residence_years text;
  alter table respondents drop constraint if exists respondents_residence_years_check;
  alter table respondents add constraint respondents_residence_years_check
    check (residence_years is null or residence_years in
           ('1年未満', '1〜4年', '5〜9年', '10〜19年', '20年以上'));
end $$;


-- ============================================================
--  2. 改善アクション管理
--     ダッシュボードが出した提案を「やる／やった／見送った」で記録し、
--     次の調査回で該当項目の点数がどう動いたかを紐付けます。
--     section / item_no を空にすると「項目に紐付かない全体施策」になります。
-- ============================================================
create table if not exists improvement_actions (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references associations on delete cascade,
  section           section_t,
  item_no           smallint check (item_no between 1 and 20),
  title             text not null,                 -- 例）消火器の実技訓練を全班で実施
  detail            text,
  status            text not null default 'planned'
                    check (status in ('planned', 'doing', 'done', 'dropped')),
  planned_on        date,                          -- 実施予定日
  done_on           date,                          -- 実施日
  owner_name        text,                          -- 担当（役員名など）
  baseline_round_id uuid references survey_rounds on delete set null,  -- 課題として見つけた回
  review_round_id   uuid references survey_rounds on delete set null,  -- 効果を確認する回
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (section, item_no) references item_master (section, item_no)
);

create index if not exists idx_actions_assoc on improvement_actions (association_id, status);

-- 更新日時を自動で入れる
create or replace function touch_improvement_action() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_action on improvement_actions;
create trigger trg_touch_action before update on improvement_actions
for each row execute function touch_improvement_action();


-- ============================================================
--  3. 集計ビュー
-- ============================================================

-- ------------------------------------------------------------
-- 3-1. 回答者ごとの属性＋合計点（属性別クロス集計用）
--      既存の v_respondent_totals は触らず、別のビューとして足しています。
-- ------------------------------------------------------------
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
       coalesce(sum(a.score), 0)                                     as grand_total
from respondents r
left join answers a on a.respondent_id = r.id
group by r.id;


-- ------------------------------------------------------------
-- 3-2. 改善アクションの効果
--      アクションに紐付いた項目の点数が、
--      「課題として見つけた回」から「効果を確認する回」でどう動いたか。
-- ------------------------------------------------------------
create or replace view v_action_effect with (security_invoker = on) as
select act.id            as action_id,
       act.association_id,
       act.title,
       act.status,
       act.owner_name,
       act.planned_on,
       act.done_on,
       act.section,
       act.item_no,
       m.category,
       m.label           as item_label,
       act.baseline_round_id,
       act.review_round_id,
       b.avg_score       as baseline_score,
       v.avg_score       as review_score,
       round(v.avg_score - b.avg_score, 2) as delta
from improvement_actions act
left join item_master m
       on m.section = act.section and m.item_no = act.item_no
left join v_item_averages b
       on b.round_id = act.baseline_round_id
      and b.section  = act.section
      and b.item_no  = act.item_no
left join v_item_averages v
       on v.round_id = act.review_round_id
      and v.section  = act.section
      and v.item_no  = act.item_no;


-- ============================================================
--  4. RLS
--     住民（未ログイン）は触れません。管理者のみ読み書きできます。
-- ============================================================
alter table improvement_actions enable row level security;

drop policy if exists p_actions_admin on improvement_actions;

create policy p_actions_admin on improvement_actions for all
  using (is_association_admin(association_id))
  with check (is_association_admin(association_id));


-- ============================================================
--  5. 住民向けRPCの更新
--     ・アクセスコードの大文字小文字を区別しない扱いは維持しています
--     ・p_meta に residence_years を受け取れるようにしました
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
    residence_years,
    certifications, job_constraint, health_constraint, learning_interest, entry_mode
  ) values (
    v_round_id,
    nullif(p_meta->>'resident_code', ''),
    coalesce(nullif(p_meta->>'member_type', ''), '住民'),
    nullif(p_meta->>'age_band', ''),
    nullif(p_meta->>'sex', ''),
    nullif(p_meta->>'household_size', ''),
    nullif(p_meta->>'residence_years', ''),
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
--     実行後、下の2行を選択して Run すると結果が見られます
-- ============================================================
-- select * from v_respondent_attributes limit 5;
-- select * from v_action_effect;
