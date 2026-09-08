-- ============================================================
--  地域防災力評価システム / 追加スキーマ 第7弾（不具合の修正）
--
--  直すこと：
--    新しい調査回を作ると、その自治会が
--    「自治会どうしの比較」から消えてしまう。
--
--  原因：
--    比較のしくみが「いちばん新しい調査回」を無条件に選んでいました。
--    作ったばかりの調査回は回答が0名です。
--    そこに「回答が5名に満たない調査回は集計しない」という
--    決まりが重なり、その自治会がまるごと対象外になっていました。
--
--  直し方：
--    「いちばん新しい調査回」ではなく
--    「回答が5名以上そろっている調査回のうち、いちばん新しいもの」
--    を選ぶようにします。
--    こうすると、次の調査の準備を始めても、
--    前回の結果で比較を続けられます。
--
--  実行方法：
--    Supabase の SQL Editor に全文を貼って Run してください。
--    何度実行しても壊れません。
--    07-compare-and-member-type.sql の内容を置き換えます。
-- ============================================================


-- ------------------------------------------------------------
--  全体の得点（防災行動力・初動対応力・総合）
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
  with person as (
    -- 回答者1人ごとの合計点
    select r.round_id,
           sum(a.score) filter (where a.section = 'koudou') as kt,
           sum(a.score) filter (where a.section = 'shodou') as st,
           sum(a.score)                                     as gt
      from respondents r
      join answers a on a.respondent_id = r.id
     group by r.id
  ),
  per_round as (
    -- 調査回ごとの平均。回答が5名に満たない回はここで落とす
    -- （人数が少ないと、平均から個人の回答が推測できてしまうため）
    select sr.association_id, sr.id as round_id, sr.label, sr.conducted_on, sr.sequence,
           count(*)                     as n,
           round(avg(p.kt)::numeric, 2) as k,
           round(avg(p.st)::numeric, 2) as s,
           round(avg(p.gt)::numeric, 2) as g
      from survey_rounds sr
      join person p on p.round_id = sr.id
     group by sr.id
    having count(*) >= 5
  ),
  agg as (
    -- ★ここが修正点
    --   回答がそろっている回の中から、いちばん新しいものを選ぶ。
    --   準備中の（回答0名の）新しい回があっても、比較は続けられる。
    select distinct on (pr.association_id) pr.*
      from per_round pr
     order by pr.association_id, pr.sequence desc
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
--  区分別（避難・消火・備蓄状況 など9区分）の平均
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
  with per_round as (
    select sr.association_id, sr.id as round_id, sr.sequence, count(r.id) as n
      from survey_rounds sr
      join respondents r on r.round_id = sr.id
     group by sr.id
    having count(r.id) >= 5
  ),
  latest as (
    -- ★上と同じ考え方で、回答がそろっている回のうち新しいものを選ぶ
    select distinct on (pr.association_id) pr.*
      from per_round pr
     order by pr.association_id, pr.sequence desc
  ),
  mine as (
    select aa.association_id from association_admins aa where aa.user_id = auth.uid()
  ),
  flagged as (
    select l.*, (l.association_id in (select m.association_id from mine m)) as mine_flag
      from latest l
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
--  確認
--    下の行を選んで Run すると、比較の中身が見られます。
--    新しい調査回を作ったあとでも、
--    前回の結果で比較が続けられることをご確認ください。
-- ============================================================
-- select * from get_association_comparison();
