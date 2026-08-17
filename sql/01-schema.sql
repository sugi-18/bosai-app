-- ============================================================
--  地域防災力評価システム / Supabase スキーマ
--  想定規模: 1自治会・数百名 × 年1〜2回 × 複数年
--  Supabase SQL Editor にそのまま貼って実行できます
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 列挙型 ----------
do $$ begin
  create type section_t      as enum ('koudou', 'shodou');            -- 防災行動力 / 初動対応力
  create type round_status_t as enum ('draft', 'open', 'closed');
  create type round_phase_t  as enum ('baseline', 'follow_up');       -- 現時点評価 / 取組み後評価
  create type input_type_t   as enum ('choice2', 'choice3', 'quiz5');
exception when duplicate_object then null; end $$;


-- ============================================================
--  1. マスタ
-- ============================================================

-- 自治会
create table if not exists associations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  municipality     text,
  household_count  integer check (household_count >= 0),   -- 回答率の分母
  created_at       timestamptz not null default now()
);

-- 管理者（Supabase Auth のユーザーと自治会の紐付け）
create table if not exists association_admins (
  association_id uuid not null references associations on delete cascade,
  user_id        uuid not null references auth.users on delete cascade,
  role           text not null default 'admin' check (role in ('owner', 'admin', 'viewer')),
  primary key (association_id, user_id)
);

-- 評価項目マスタ（40項目）。設問文や配点を変えても過去データは壊れない
create table if not exists item_master (
  section          section_t   not null,
  item_no          smallint    not null check (item_no between 1 and 20),
  category         text        not null,
  label            text        not null,
  input_type       input_type_t not null,
  options          jsonb,        -- [{"label":"参加している","score":5}, ...]
  quiz             jsonb,        -- ["設問1", ... 5問]
  improvement_tip  text not null,
  primary key (section, item_no)
);


-- ============================================================
--  2. 調査回と回答
-- ============================================================

-- 調査回：経年比較の単位。「2026年度 第1回（取組み前）」など
create table if not exists survey_rounds (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references associations on delete cascade,
  label             text not null,
  phase             round_phase_t  not null default 'baseline',
  sequence          integer not null,                      -- 並び順（1, 2, 3 ...）
  conducted_on      date not null default current_date,
  status            round_status_t not null default 'draft',
  access_code       text not null unique,                  -- 回答URLに載せる短いコード
  target_households integer,                               -- 未設定なら自治会の世帯数を使う
  note              text,
  created_at        timestamptz not null default now(),
  unique (association_id, sequence)
);

-- 回答者
create table if not exists respondents (
  id                uuid primary key default gen_random_uuid(),
  round_id          uuid not null references survey_rounds on delete cascade,
  resident_code     text,          -- 自治会が配る匿名コード。同一人を経年で追跡する鍵
  member_type       text not null default '住民' check (member_type in ('住民', '役員・区長')),
  age_band          text check (age_band in ('20代','30代','40代','50代','60代','70代','80代以上')),
  sex               text check (sex in ('男性','女性','その他')),
  household_size    text check (household_size in ('単身','2人','3人','4人','5人','6人','7人以上')),
  certifications    text,
  job_constraint    text,
  health_constraint text,
  learning_interest text,
  entry_mode        text not null default 'web' check (entry_mode in ('web', 'paper')),  -- 紙回答の代理入力
  submitted_at      timestamptz not null default now(),
  unique (round_id, resident_code)   -- 同じ回に同じコードで二重回答させない
);

-- 回答明細（1人40行）
create table if not exists answers (
  respondent_id uuid      not null references respondents on delete cascade,
  section       section_t not null,
  item_no       smallint  not null check (item_no between 1 and 20),
  score         numeric(3,1) not null check (score >= 0 and score <= 5),
  choice_index  smallint,        -- 選択肢の位置（再集計・配点変更に備えて原本を保持）
  quiz_correct  boolean[],       -- 知識チェック5問の正誤
  primary key (respondent_id, section, item_no),
  foreign key (section, item_no) references item_master (section, item_no)
);

create index if not exists idx_respondents_round on respondents (round_id);
create index if not exists idx_answers_item      on answers (section, item_no);
create index if not exists idx_rounds_assoc      on survey_rounds (association_id, sequence);


-- ============================================================
--  3. 入力値の検証
--  紙+Excel運用で混入していた「2択なのに2.5点」「0.5点」といった
--  ありえない値を、DB側で構造的に弾く
-- ============================================================
create or replace function validate_answer_score() returns trigger
language plpgsql as $$
declare v_type input_type_t;
begin
  select input_type into v_type from item_master
   where section = new.section and item_no = new.item_no;

  if v_type = 'choice2' and new.score not in (0, 5) then
    raise exception '2択項目（%/%）の得点は0または5のみです: %', new.section, new.item_no, new.score;
  elsif v_type = 'choice3' and new.score not in (0, 2.5, 5) then
    raise exception '3択項目（%/%）の得点は0/2.5/5のみです: %', new.section, new.item_no, new.score;
  elsif v_type = 'quiz5' then
    if new.score <> trunc(new.score) or new.score > 5 then
      raise exception '知識チェック（%/%）の得点は0〜5の整数です: %', new.section, new.item_no, new.score;
    end if;
    if new.quiz_correct is not null
       and coalesce(array_length(new.quiz_correct, 1), 0) <> 5 then
      raise exception '知識チェックの正誤は5件必要です';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_validate_answer on answers;
create trigger trg_validate_answer before insert or update on answers
for each row execute function validate_answer_score();


-- ============================================================
--  4. 集計ビュー（security_invoker = RLS を通す）
-- ============================================================

-- 回答者ごとの合計
create or replace view v_respondent_totals with (security_invoker = on) as
select r.id as respondent_id,
       r.round_id,
       r.member_type,
       r.age_band,
       r.resident_code,
       coalesce(sum(a.score) filter (where a.section = 'koudou'), 0) as koudou_total,
       coalesce(sum(a.score) filter (where a.section = 'shodou'), 0) as shodou_total,
       coalesce(sum(a.score), 0)                                     as grand_total
from respondents r
left join answers a on a.respondent_id = r.id
group by r.id;

-- 調査回サマリ
create or replace view v_round_summary with (security_invoker = on) as
select sr.id as round_id, sr.association_id, sr.label, sr.sequence,
       sr.phase, sr.conducted_on, sr.status,
       count(t.respondent_id)                       as respondents,
       coalesce(sr.target_households, a.household_count) as target_households,
       round(100.0 * count(t.respondent_id)
             / nullif(coalesce(sr.target_households, a.household_count), 0), 1) as response_rate,
       round(avg(t.koudou_total)::numeric, 2)       as koudou_avg,
       round(avg(t.shodou_total)::numeric, 2)       as shodou_avg,
       round(avg(t.grand_total)::numeric, 2)        as total_avg
from survey_rounds sr
join associations a on a.id = sr.association_id
left join v_respondent_totals t on t.round_id = sr.id
group by sr.id, a.household_count;

-- 項目別平均
create or replace view v_item_averages with (security_invoker = on) as
select r.round_id, m.section, m.item_no, m.category, m.label,
       count(*)                              as n,
       round(avg(a.score)::numeric, 2)       as avg_score
from answers a
join respondents r  on r.id = a.respondent_id
join item_master m  on (m.section, m.item_no) = (a.section, a.item_no)
group by r.round_id, m.section, m.item_no, m.category, m.label;

-- 区分別平均
create or replace view v_category_averages with (security_invoker = on) as
select r.round_id, m.section, m.category,
       round(avg(a.score)::numeric, 2) as avg_score,
       count(distinct r.id)            as n
from answers a
join respondents r on r.id = a.respondent_id
join item_master m on (m.section, m.item_no) = (a.section, a.item_no)
group by r.round_id, m.section, m.category;

-- 経年比較：前回との差分を項目ごとに算出
create or replace view v_item_trend with (security_invoker = on) as
select sr.association_id, sr.id as round_id, sr.sequence, sr.label, sr.conducted_on,
       ia.section, ia.item_no, ia.category, ia.label as item_label,
       ia.avg_score,
       lag(ia.avg_score) over w        as prev_score,
       round(ia.avg_score - lag(ia.avg_score) over w, 2) as delta
from v_item_averages ia
join survey_rounds sr on sr.id = ia.round_id
window w as (partition by sr.association_id, ia.section, ia.item_no order by sr.sequence);

-- 経年比較：同一人（resident_code）の伸び
create or replace view v_respondent_trend with (security_invoker = on) as
select sr.association_id, t.resident_code, sr.sequence, sr.label,
       t.koudou_total, t.shodou_total, t.grand_total,
       t.grand_total - lag(t.grand_total)
         over (partition by sr.association_id, t.resident_code order by sr.sequence) as delta
from v_respondent_totals t
join survey_rounds sr on sr.id = t.round_id
where t.resident_code is not null;


-- ============================================================
--  5. RLS
-- ============================================================
alter table associations       enable row level security;
alter table association_admins enable row level security;
alter table survey_rounds      enable row level security;
alter table respondents        enable row level security;
alter table answers            enable row level security;
alter table item_master        enable row level security;

create or replace function is_association_admin(p_association uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from association_admins
     where association_id = p_association and user_id = auth.uid()
  );
$$;

drop policy if exists p_assoc_read   on associations;
drop policy if exists p_admins_read  on association_admins;
drop policy if exists p_rounds_admin on survey_rounds;
drop policy if exists p_resp_admin   on respondents;
drop policy if exists p_ans_admin    on answers;
drop policy if exists p_items_read   on item_master;

create policy p_assoc_read  on associations       for select using (is_association_admin(id));
create policy p_admins_read on association_admins for select using (user_id = auth.uid());
create policy p_items_read  on item_master        for select using (true);   -- 設問文は公開

-- 管理者は自分の自治会のデータをすべて操作できる（紙回答の代理入力もここ）
create policy p_rounds_admin on survey_rounds for all
  using (is_association_admin(association_id))
  with check (is_association_admin(association_id));

create policy p_resp_admin on respondents for all
  using (exists (select 1 from survey_rounds sr
                  where sr.id = respondents.round_id and is_association_admin(sr.association_id)))
  with check (exists (select 1 from survey_rounds sr
                  where sr.id = respondents.round_id and is_association_admin(sr.association_id)));

create policy p_ans_admin on answers for all
  using (exists (select 1 from respondents r join survey_rounds sr on sr.id = r.round_id
                  where r.id = answers.respondent_id and is_association_admin(sr.association_id)))
  with check (exists (select 1 from respondents r join survey_rounds sr on sr.id = r.round_id
                  where r.id = answers.respondent_id and is_association_admin(sr.association_id)));

-- 住民（未ログイン）は直接テーブルに触れない。投稿は下のRPCだけを通す


-- ============================================================
--  6. 住民向けRPC
-- ============================================================

-- 回答画面が最初に呼ぶ：コードから受付中の調査回を引く
create or replace function get_open_round(p_access_code text)
returns table (round_id uuid, association_name text, round_label text, phase round_phase_t)
language sql stable security definer set search_path = public as $$
  select sr.id, a.name, sr.label, sr.phase
  from survey_rounds sr
  join associations a on a.id = sr.association_id
  where sr.access_code = p_access_code and sr.status = 'open';
$$;

-- 回答の投函。40項目そろっていなければ丸ごと失敗する
create or replace function submit_response(
  p_access_code text,
  p_meta        jsonb default '{}'::jsonb,
  p_answers     jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_round_id uuid; v_id uuid; v_count int;
begin
  select id into v_round_id from survey_rounds
   where access_code = p_access_code and status = 'open';
  if v_round_id is null then
    raise exception '受付中の調査が見つかりません';
  end if;

  insert into respondents (
    round_id, resident_code, member_type, age_band, sex, household_size,
    certifications, job_constraint, health_constraint, learning_interest, entry_mode
  ) values (
    v_round_id,
    nullif(p_meta->>'resident_code', ''),
    coalesce(nullif(p_meta->>'member_type', ''), '住民'),
    nullif(p_meta->>'age_band', ''),
    nullif(p_meta->>'sex', ''),
    nullif(p_meta->>'household_size', ''),
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
grant execute on function get_open_round(text) to anon, authenticated;


-- ============================================================
--  7. 項目マスタの投入
-- ============================================================
insert into item_master (section, item_no, category, label, input_type, options, quiz, improvement_tip) values
-- 防災行動力
('koudou', 1,'被害拡大防止','家具転倒防止措置','choice3','[{"label":"実施している","score":5},{"label":"一部実施している","score":2.5},{"label":"実施していない","score":0}]',null,'寝室と居間の背の高い家具から順に、L字金具や突っ張り棒で固定する'),
('koudou', 2,'被害拡大防止','住宅用火災警報器の設置','choice3','[{"label":"設置有り","score":5},{"label":"一部設置している","score":2.5},{"label":"設置無し","score":0}]',null,'寝室と階段上部の設置状況を確認し、未設置の部屋に追加する'),
('koudou', 3,'被害拡大防止','住宅用火災警報器の点検・電池交換','choice3','[{"label":"実施している","score":5},{"label":"一部実施している","score":2.5},{"label":"実施していない","score":0}]',null,'年1回まとめて点検する日を決め、設置10年経過品は本体ごと交換する'),
('koudou', 4,'被害拡大防止','感震ブレーカーの設置','choice2','[{"label":"設置有り","score":5},{"label":"設置無し","score":0}]',null,'分電盤タイプまたは簡易タイプの感震ブレーカーを設置し、通電火災を防ぐ'),
('koudou', 5,'被害拡大防止','家庭用消火器等の設置（使用期限確認）','choice2','[{"label":"設置有り","score":5},{"label":"設置無し","score":0}]',null,'住宅用消火器を1本備え、使用期限（製造からおおむね10年）を確認する'),
('koudou', 6,'備蓄状況','食料品（日常備蓄：3日分目安）','choice3','[{"label":"備蓄している","score":5},{"label":"一部備蓄している","score":2.5},{"label":"備蓄していない","score":0}]',null,'普段食べる食品を多めに買い、古い順に使うローリングストックに切り替える'),
('koudou', 7,'備蓄状況','飲料水（日常備蓄：3日分目安）','choice3','[{"label":"備蓄している","score":5},{"label":"一部備蓄している","score":2.5},{"label":"備蓄していない","score":0}]',null,'1人1日3L×3日分（9L）を目安に、箱買いして玄関近くに置く'),
('koudou', 8,'備蓄状況','生活用品（日常備蓄：3日分目安）','choice3','[{"label":"備蓄している","score":5},{"label":"一部備蓄している","score":2.5},{"label":"備蓄していない","score":0}]',null,'携帯トイレ・ラジオ・乾電池・常備薬など、水と食料以外の3日分をそろえる'),
('koudou', 9,'備蓄状況','非常用持出セット（日常備蓄とは別に準備）','choice2','[{"label":"準備している","score":5},{"label":"準備していない","score":0}]',null,'持ち出し用リュックを玄関に置き、年1回中身を入れ替える'),
('koudou',10,'連絡体制','災害時の家族集合場所の決定','choice2','[{"label":"実施している","score":5},{"label":"実施していない","score":0}]',null,'一次集合場所と広域避難場所の2か所を家族で決め、紙に書いて全員が持つ'),
('koudou',11,'連絡体制','家族それぞれの避難場所・避難ルートの把握','choice2','[{"label":"実施している","score":5},{"label":"実施していない","score":0}]',null,'勤務先・学校など日中の居場所からの避難ルートを、家族で一度歩いて確認する'),
('koudou',12,'連絡体制','家庭内の連絡手段の確保','choice2','[{"label":"実施している","score":5},{"label":"実施していない","score":0}]',null,'災害用伝言ダイヤル171や災害用伝言板を、体験利用日に家族で試す'),
('koudou',13,'連絡体制','防災個別計画（マイ・タイムライン）の作成','choice2','[{"label":"実施している","score":5},{"label":"実施していない","score":0}]',null,'自治会でマイ・タイムライン作成講座を開き、その場で1枚仕上げる'),
('koudou',14,'知識習得','防災関連の研修会、講演会等への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'市区町村や消防署の講演会情報を回覧・掲示板で毎回共有する'),
('koudou',15,'知識習得','防災関連知識の自発的学習','choice2','[{"label":"実施している","score":5},{"label":"実施していない","score":0}]',null,'ハザードマップと地区防災計画を読む機会を、広報や回覧でつくる'),
('koudou',16,'知識習得','防災関連イベントや体験学習施設等への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'防災体験施設への地域見学会を企画し、家族参加型にする'),
('koudou',17,'地域防災活動','地域の防災訓練への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'日程を早期に周知し、短時間・出入り自由の形式を用意する'),
('koudou',18,'地域防災活動','地域の防災勉強会・意見交換会への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'班単位の少人数意見交換会を年1回開き、発言しやすい場にする'),
('koudou',19,'地域防災活動','避難所運営に対する意識','choice3','[{"label":"参加する","score":5},{"label":"依頼されれば参加する","score":2.5},{"label":"参加しない","score":0}]',null,'避難所運営ゲーム（HUG）等で役割を体験し、担当者を事前に決めておく'),
('koudou',20,'地域防災活動','発災時の自治会活動内容の把握','choice3','[{"label":"知っている","score":5},{"label":"やや知っている","score":2.5},{"label":"知らない","score":0}]',null,'発災時の自治会の役割分担表を1枚にまとめ、全戸配布する'),
-- 初動対応力
('shodou', 1,'避難','防災訓練（避難）への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'避難訓練の日程を複数設定し、参加しやすい時間帯を用意する'),
('shodou', 2,'避難','近隣の避難場所、避難ルートの把握','choice3','[{"label":"知っている","score":5},{"label":"やや知っている","score":2.5},{"label":"知らない","score":0}]',null,'地区の避難場所とルートを地図にして全戸配布し、実際に歩く機会を設ける'),
('shodou', 3,'避難','近隣の要支援者の把握','choice3','[{"label":"知っている","score":5},{"label":"やや知っている","score":2.5},{"label":"知らない","score":0}]',null,'班ごとに要支援者名簿を整備し、支援担当を事前に割り当てる'),
('shodou', 4,'避難','近隣の要支援者の支援','choice3','[{"label":"支援できる","score":5},{"label":"自信が無い","score":2.5},{"label":"支援できない","score":0}]',null,'要支援者ごとの個別避難計画を作り、避難支援訓練で実際に動いてみる'),
('shodou', 5,'避難','地域の発災時の取り決め内容の把握','choice3','[{"label":"知っている","score":5},{"label":"やや知っている","score":2.5},{"label":"知らない","score":0}]',null,'安否確認の方法や集合順序など、地域ルールを1枚にまとめて配布する'),
('shodou', 6,'避難','地域の発災時の取り決め内容の実行','choice3','[{"label":"実行できる","score":5},{"label":"自信が無い","score":2.5},{"label":"実行できない","score":0}]',null,'安否確認（タオル掲示等）の合図を、実際に全戸で試す訓練を行う'),
('shodou', 7,'避難','地域の防災倉庫の位置・備品の把握','choice3','[{"label":"知っている","score":5},{"label":"やや知っている","score":2.5},{"label":"知らない","score":0}]',null,'防災倉庫の場所と備品リストを公開し、点検作業を住民参加型にする'),
('shodou', 8,'消火','防災訓練（消火）への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'消火訓練を短時間の体験型にし、当日参加もできるようにする'),
('shodou', 9,'消火','消火器使用訓練の実施','choice2','[{"label":"訓練した","score":5},{"label":"訓練していない","score":0}]',null,'水消火器を使った実技訓練を年1回、全班で実施する'),
('shodou',10,'消火','消火器の使用','choice3','[{"label":"使用できる","score":5},{"label":"自信が無い","score":2.5},{"label":"使用できない","score":0}]',null,'ピン・ホース・レバーの3動作を、全員が一度は自分の手で体験する'),
('shodou',11,'消火','消火用資機材（消火器以外）の使用方法','choice3','[{"label":"知っている","score":5},{"label":"やや知っている","score":2.5},{"label":"知らない","score":0}]',null,'スタンドパイプや可搬ポンプの使用方法を訓練メニューに加える'),
('shodou',12,'消火','消火についての基礎知識','quiz5',null,'["消火栓と防火水槽の違いを知っていますか？","自宅に一番近い消防用水利の場所は把握していますか？","自宅に一番近い消火器設置場所は把握していますか？","初期消火するか避難するかの判断基準を知っていますか？","消火器以外で初期消火に使えるものを知っていますか？"]','消火栓・防火水槽の位置と、初期消火か避難かの判断基準を学ぶ機会をつくる'),
('shodou',13,'救出救助','防災訓練（救出救助）への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'救出救助を訓練メニューに追加し、まず見学だけでも参加できる形にする'),
('shodou',14,'救出救助','救助用資機材（ジャッキ・バール）使用訓練の実施','choice2','[{"label":"訓練した","score":5},{"label":"訓練していない","score":0}]',null,'消防署の協力を得て、ジャッキ・バールの使用訓練を実施する'),
('shodou',15,'救出救助','救助用資機材（ジャッキ・バール）の使用','choice3','[{"label":"使用できる","score":5},{"label":"自信が無い","score":2.5},{"label":"使用できない","score":0}]',null,'資機材の保管場所を周知し、班ごとに複数名が扱えるようにする'),
('shodou',16,'救出救助','救出救助についての基礎知識','quiz5',null,'["自宅付近の倒壊可能性のある危険箇所を把握していますか？","テコの原理などを使った簡易救助方法を知っていますか？","要救助者を移動させてよい場合と動かしてはいけない場合の違いを知っていますか？","クラッシュ症候群への対応を知っていますか？","ロープを使用してブルーシートの固定ができますか？"]','危険箇所の把握、テコの原理、クラッシュ症候群を扱う講習を行う'),
('shodou',17,'応急救護','防災訓練（応急救護）への参加','choice2','[{"label":"参加している","score":5},{"label":"参加していない","score":0}]',null,'普通救命講習を地域単位で受講できるよう、消防署と日程調整する'),
('shodou',18,'応急救護','AED使用訓練の実施','choice2','[{"label":"訓練した","score":5},{"label":"訓練していない","score":0}]',null,'AED実技を含む救命講習を年1回、地域で開催する'),
('shodou',19,'応急救護','AEDの使用','choice3','[{"label":"使用できる","score":5},{"label":"自信が無い","score":2.5},{"label":"使用できない","score":0}]',null,'地域内のAED設置場所マップを作り、実機で操作を体験する'),
('shodou',20,'応急救護','応急救護についての基礎知識','quiz5',null,'["意識・呼吸の確認方法を知っていますか？","心肺蘇生（胸骨圧迫）の基本（速さ・深さ）を知っていますか？","出血時の基本的な止血方法（直接圧迫など）を知っていますか？","三角巾等を活用して骨折の応急処置はできますか？","自宅に一番近いAED設置場所は把握していますか？"]','胸骨圧迫・止血・三角巾の基本を扱う短時間講習を行う')
on conflict (section, item_no) do update
  set category = excluded.category,
      label    = excluded.label,
      options  = excluded.options,
      quiz     = excluded.quiz,
      improvement_tip = excluded.improvement_tip;


-- ============================================================
--  8. 初期データの例
-- ============================================================
-- insert into associations (name, municipality, household_count)
--   values ('〇〇自治会', '△△市', 320);
--
-- insert into survey_rounds (association_id, label, phase, sequence, access_code, status)
--   select id, '2026年度 第1回（取組み前）', 'baseline', 1, 'ABC123', 'open' from associations;
--
-- 管理者の登録（Supabase Auth でサインアップした後）
-- insert into association_admins (association_id, user_id, role)
--   values ('<association_id>', '<auth.users.id>', 'owner');
