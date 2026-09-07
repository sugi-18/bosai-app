-- ============================================================
--  地域防災力評価システム / 追加スキーマ 第6弾
--
--  目的：
--    ・回答者の「立場」に「その他」を追加する
--    ・自治会どうしを比べるための集計を用意する
--
--  実行方法：
--    Supabase の SQL Editor に全文を貼って Run してください。
--    何度実行しても壊れません（同じ結果になります）。
--    06-phase-other.sql を実行済みの環境が前提です。
-- ============================================================


-- ============================================================
--  1. 立場に「その他」を追加
--
--  これまでは「住民」と「役員・区長」の2つだけでした。
--  消防団・民生委員・近隣にお勤めの方など、
--  どちらとも言いにくい立場の方が答えられるようにします。
--
--  すでに登録されている回答の立場は変わりません。
-- ============================================================
do $$ begin
  alter table respondents drop constraint if exists respondents_member_type_check;
  alter table respondents add constraint respondents_member_type_check
    check (member_type in ('住民', '役員・区長', 'その他'));
end $$;


-- ============================================================
--  2. 自治会どうしの比較
--
--  総会で説明するときの参考として、
--  「よその自治会と比べてどうか」を出せるようにします。
--
--  返すのは平均点だけで、個々の回答は一切含みません。
--  また、次の2点で配慮しています。
--
--    ・回答が5名に満たない調査回は対象外にします
--      （人数が少ないと、個人の回答が推測できてしまうため）
--    ・自分が管理していない自治会は、名前を伏せて
--      「他の自治会 1」「他の自治会 2」…として返します
--
--  比べるのは、各自治会の「いちばん新しい調査回」です。
-- ============================================================

-- ------------------------------------------------------------
-- 2-1. 全体の得点（防災行動力・初動対応力・総合）
-- ------------------------------------------------------------
create or replace function get_association_comparison()
returns table (
  is_mine      boolean,
  display_name text,
  round_label  text,
  conducted_on date,
  respondents  bigint,
  koudou_avg   numeric,
  shodou_avg   numeric,
  total_avg    numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  return query
  with latest as (
    -- 自治会ごとに、いちばん新しい調査回を1つ選ぶ
    select distinct on (sr.association_id)
           sr.association_id, sr.id as round_id, sr.label, sr.conducted_on
      from survey_rounds sr
     order by sr.association_id, sr.sequence desc
  ),
  person as (
    -- 回答者1人ごとの合計点
    select r.round_id,
           sum(a.score) filter (where a.section = 'koudou') as kt,
           sum(a.score) filter (where a.section = 'shodou') as st,
           sum(a.score)                                     as gt
      from respondents r
      join answers a on a.respondent_id = r.id
     group by r.id
  ),
  agg as (
    select l.association_id, l.label, l.conducted_on,
           count(*)                        as n,
           round(avg(p.kt)::numeric, 2)    as k,
           round(avg(p.st)::numeric, 2)    as s,
           round(avg(p.gt)::numeric, 2)    as g
      from latest l
      join person p on p.round_id = l.round_id
     group by l.association_id, l.label, l.conducted_on
    having count(*) >= 5
  ),
  mine as (
    select aa.association_id from association_admins aa where aa.user_id = auth.uid()
  ),
  flagged as (
    select ag.*, (ag.association_id in (select m.association_id from mine m)) as mine_flag
      from agg ag
  ),
  labeled as (
    select f.*,
           row_number() over (partition by f.mine_flag
                              order by f.g desc, f.association_id) as rn
      from flagged f
  )
  select lb.mine_flag,
         case when lb.mine_flag then ass.name else '他の自治会 ' || lb.rn end,
         case when lb.mine_flag then lb.label        else null end,
         case when lb.mine_flag then lb.conducted_on else null end,
         lb.n, lb.k, lb.s, lb.g
    from labeled lb
    join associations ass on ass.id = lb.association_id
   order by lb.mine_flag desc, lb.g desc;
end $$;


-- ------------------------------------------------------------
-- 2-2. 区分別（避難・消火・備蓄状況 など9区分）の平均
-- ------------------------------------------------------------
create or replace function get_category_comparison()
returns table (
  is_mine      boolean,
  display_name text,
  section      section_t,
  category     text,
  avg_score    numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  return query
  with latest as (
    select distinct on (sr.association_id)
           sr.association_id, sr.id as round_id
      from survey_rounds sr
     order by sr.association_id, sr.sequence desc
  ),
  counted as (
    select l.association_id, l.round_id, count(r.id) as n
      from latest l
      left join respondents r on r.round_id = l.round_id
     group by l.association_id, l.round_id
    having count(r.id) >= 5
  ),
  mine as (
    select aa.association_id from association_admins aa where aa.user_id = auth.uid()
  ),
  flagged as (
    select c.*, (c.association_id in (select m.association_id from mine m)) as mine_flag
      from counted c
  ),
  labeled as (
    select f.*,
           row_number() over (partition by f.mine_flag
                              order by f.association_id) as rn
      from flagged f
  ),
  cat as (
    select lb.association_id, lb.mine_flag, lb.rn,
           m.section, m.category,
           round(avg(a.score)::numeric, 2) as avg_score
      from labeled lb
      join respondents r  on r.round_id = lb.round_id
      join answers a      on a.respondent_id = r.id
      join item_master m  on (m.section, m.item_no) = (a.section, a.item_no)
     group by lb.association_id, lb.mine_flag, lb.rn, m.section, m.category
  )
  select cat.mine_flag,
         case when cat.mine_flag then ass.name else '他の自治会 ' || cat.rn end,
         cat.section, cat.category, cat.avg_score
    from cat
    join associations ass on ass.id = cat.association_id
   order by cat.mine_flag desc, cat.section, cat.category;
end $$;


revoke all on function get_association_comparison() from public;
revoke all on function get_category_comparison() from public;
grant execute on function get_association_comparison() to authenticated;
grant execute on function get_category_comparison()    to authenticated;


-- ============================================================
--  3. 確認
--     下の行を選んで Run すると、比較の中身が見られます。
-- ============================================================
-- select * from get_association_comparison();
-- select * from get_category_comparison();
