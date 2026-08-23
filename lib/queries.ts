import 'server-only';
import { dbAsUser, isStaff } from '@/lib/db';
import { fiscalYear, type EventKind } from '@/lib/format';
import type { BlockValue } from '@/lib/constants';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type MemberRole = 'athlete' | 'manager' | 'admin';
export type Gender = 'male' | 'female' | 'other';
export type Block = BlockValue;

export type Profile = {
  id: string;
  full_name: string;
  full_name_kana: string | null;
  /** 入学年度。分からない場合は null（学年は「学年未設定」と表示する） */
  admission_year: number | null;
  gender: Gender;
  block: Block | null;
  prefecture: string | null;
  high_school: string | null;
  position: string;
  /** 役職（主将・主務など）。position とは別に持つ */
  duty: string | null;
  /** 今シーズンの目標 */
  season_goal: string | null;
  /** 目標を書いた年度。今年度のものかどうかの判別に使う */
  season_goal_year: number | null;
  role: MemberRole;
  is_active: boolean;
};

export type EventMaster = {
  code: string;
  name_ja: string;
  kind: EventKind;
  unit: string;
  wind_measured: boolean;
  sort_order: number;
  block: Block | null;
};

export type Competition = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  venue: string | null;
  created_by: string | null;
  note: string | null;
};

export type ResultRow = {
  id: string;
  profile_id: string;
  full_name: string;
  gender: Gender;
  event_code: string;
  event_name: string;
  kind: EventKind;
  competition_id: string | null;
  competition_label: string | null;
  competed_on: string | null;
  round: string | null;
  mark: number | null;
  wind: number | null;
  timing: 'electronic' | 'hand';
  status: string | null;
  place: number | null;
  is_official: boolean;
  note: string | null;
  is_pb: boolean;
  is_sb: boolean;
  /** 歴代10傑での順位。10位までに入っていなければ null */
  all_time_rank: number | null;
};

export type Standard = {
  id: string;
  name: string;
  event_code: string;
  event_name: string;
  kind: EventKind;
  gender: Gender;
  mark: number;
  season_year: number | null;
  valid_from: string | null;
  valid_to: string | null;
  note: string | null;
};

export type StandardClear = {
  standard_id: string;
  standard_name: string;
  event_code: string;
  event_name: string;
  kind: EventKind;
  profile_id: string;
  full_name: string;
  gender: Gender;
  standard_mark: number;
  cleared_mark: number;
  wind: number | null;
  competed_on: string | null;
};

// ---------------------------------------------------------------------------
// プロフィール
// ---------------------------------------------------------------------------

export async function getMyProfile(): Promise<Profile | null> {
  const { sql, user } = await dbAsUser();
  const rows = (await sql`
    select id, full_name, full_name_kana, admission_year, gender, block,
           prefecture, high_school, position, duty,
           season_goal, season_goal_year, role, is_active
    from profiles
    where id = ${user.id}::uuid
  `) as Profile[];
  return rows[0] ?? null;
}

export async function getProfile(id: string): Promise<Profile | null> {
  const { sql } = await dbAsUser();
  const rows = (await sql`
    select id, full_name, full_name_kana, admission_year, gender, block,
           prefecture, high_school, position, duty,
           season_goal, season_goal_year, role, is_active
    from profiles
    where id = ${id}::uuid
  `) as Profile[];
  return rows[0] ?? null;
}

/**
 * 部員が登録している専門種目。主要種目かどうかも返す。
 * 基礎情報の編集フォームで使う。
 */
export async function listProfileEvents(profileId: string) {
  const { sql } = await dbAsUser();
  return (await sql`
    select pe.event_code, pe.is_primary
    from profile_events pe
    join events_master e on e.code = pe.event_code
    where pe.profile_id = ${profileId}::uuid
    order by e.sort_order
  `) as { event_code: string; is_primary: boolean }[];
}

export type MemberRow = Profile & {
  /** 登録している専門種目すべて */
  events: string[];
  /** 括弧に出す主要種目。最大2件 */
  primary_events: string[];
};

/**
 * 部員の一覧。
 *
 * 既定では一覧から外した人（is_active = false）を含めない。
 * 管理者が復帰させるときだけ includeInactive を立てて呼ぶ。
 */
export async function listMembers(
  options: { includeInactive?: boolean } = {}
): Promise<MemberRow[]> {
  const { sql } = await dbAsUser();
  const includeInactive = options.includeInactive ?? false;
  return (await sql`
    select p.id, p.full_name, p.full_name_kana, p.admission_year, p.gender, p.block,
           p.prefecture, p.high_school, p.position, p.duty,
           p.season_goal, p.season_goal_year, p.role, p.is_active,
           coalesce(
             array_agg(e.name_ja order by e.sort_order)
               filter (where e.name_ja is not null),
             '{}'
           ) as events,
           coalesce(pri.names, '{}') as primary_events
    from profiles p
    left join profile_events pe on pe.profile_id = p.id
    left join events_master  e  on e.code = pe.event_code
    -- 主要種目は別立てで取る。2件に絞る必要があるので、
    -- 上の array_agg と同じ集計には混ぜられない
    left join lateral (
      select array_agg(x.name_ja order by x.sort_order) as names
      from (
        select e2.name_ja, e2.sort_order
        from profile_events pe2
        join events_master  e2 on e2.code = pe2.event_code
        where pe2.profile_id = p.id
          and pe2.is_primary
        order by e2.sort_order
        limit 2
      ) x
    ) pri on true
    where (${includeInactive} or p.is_active)
    group by p.id, pri.names
    -- 入学年度が未設定の人は最後にまとめる
    order by p.admission_year nulls last, p.full_name_kana nulls last, p.full_name
  `) as MemberRow[];
}

/**
 * 絞り込みの選択肢に使う軽い部員一覧。
 * listMembers() は専門種目の集計をするので、選択肢を作るだけなら重すぎる。
 * 退部者の記録も残っているため、is_active では絞らない。
 */
export async function listMemberOptions() {
  const { sql } = await dbAsUser();
  return (await sql`
    select p.id, p.full_name, p.gender, p.is_active
    from profiles p
    where exists (select 1 from results r where r.profile_id = p.id)
       or p.is_active
    order by p.admission_year, p.full_name_kana nulls last, p.full_name
  `) as { id: string; full_name: string; gender: Gender; is_active: boolean }[];
}

// ---------------------------------------------------------------------------
// マスタ
// ---------------------------------------------------------------------------

export async function listEvents(): Promise<EventMaster[]> {
  const { sql } = await dbAsUser();
  return (await sql`
    select code, name_ja, kind, unit, wind_measured, sort_order, block
    from events_master
    where is_active
    order by sort_order
  `) as EventMaster[];
}

export async function listCompetitions(): Promise<Competition[]> {
  const { sql } = await dbAsUser();
  return (await sql`
    select id, name,
           to_char(start_date, 'YYYY-MM-DD') as start_date,
           to_char(end_date,   'YYYY-MM-DD') as end_date,
           venue, created_by, note
    from competitions
    order by start_date desc
    limit 300
  `) as Competition[];
}

export async function getCompetition(id: string): Promise<Competition | null> {
  const { sql } = await dbAsUser();
  const rows = (await sql`
    select id, name,
           to_char(start_date, 'YYYY-MM-DD') as start_date,
           to_char(end_date,   'YYYY-MM-DD') as end_date,
           venue, created_by, note
    from competitions
    where id = ${id}::uuid
  `) as Competition[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// 大会結果
// ---------------------------------------------------------------------------

/** 記録一覧の絞り込み条件。すべて省略可（省略した軸は絞り込まない） */
export type ResultFilters = {
  profileId?: string | null;
  /** この日以降。日付の無い記録（高校時代など）は対象外になる */
  from?: string | null;
  to?: string | null;
  eventCode?: string | null;
  /** 種目のブロック。選手の所属ブロックではない */
  block?: Block | null;
  gender?: Gender | null;
  competitionId?: string | null;
  sort?: ResultSort;
};

export type ResultSort = 'date_desc' | 'date_asc' | 'mark' | 'name';

export const RESULT_SORTS: { value: ResultSort; label: string }[] = [
  { value: 'date_desc', label: '日付が新しい順' },
  { value: 'date_asc', label: '日付が古い順' },
  { value: 'mark', label: '記録が良い順' },
  { value: 'name', label: '名前順' },
];

/** 一度に返す最大件数。これを超えたら絞り込んでもらう */
export const RESULT_LIMIT = 500;

/**
 * 記録の一覧。
 * 大会名は、マスタにあればその名前、無ければ自由入力の値を使う。
 *
 * 絞り込みは「その条件が NULL なら素通し」という書き方で1本の SQL にまとめている。
 * 条件ごとに SQL を組み立てる方式にすると、文字列連結の隙間から
 * SQL インジェクションが入り込む余地ができるため。
 */
export async function listResults(filters: ResultFilters = {}): Promise<ResultRow[]> {
  const { sql } = await dbAsUser();

  const profileId = filters.profileId ?? null;
  const from = filters.from ?? null;
  const to = filters.to ?? null;
  const eventCode = filters.eventCode ?? null;
  const block = filters.block ?? null;
  const gender = filters.gender ?? null;
  const competitionId = filters.competitionId ?? null;
  const sort: ResultSort = filters.sort ?? 'date_desc';

  return (await sql`
    select r.id, r.profile_id, p.full_name, p.gender,
           r.event_code, e.name_ja as event_name, e.kind,
           r.competition_id,
           coalesce(c.name, r.competition_name) as competition_label,
           r.competed_on, r.round, r.mark, r.wind, r.timing,
           r.status, r.place, r.is_official, r.note,
           (pb.result_id is not null) as is_pb,
           (sb.result_id is not null) as is_sb,
           at.rank as all_time_rank
    from results r
    join profiles       p on p.id = r.profile_id
    join events_master  e on e.code = r.event_code
    left join competitions c on c.id = r.competition_id
    left join v_personal_bests pb on pb.result_id = r.id
    left join v_season_bests   sb on sb.result_id = r.id
                                 and sb.season_year = ${fiscalYear()}
    -- 歴代10傑に入っている記録に「歴代◯位」を出すため
    left join v_result_all_time_ranks at on at.result_id = r.id
    where (${profileId}::uuid is null or r.profile_id = ${profileId}::uuid)
      and (${from}::date is null or r.competed_on >= ${from}::date)
      and (${to}::date   is null or r.competed_on <= ${to}::date)
      and (${eventCode}::text is null or r.event_code = ${eventCode}::text)
      and (${block}::text is null or e.block = ${block}::block_type)
      and (${gender}::text is null or p.gender = ${gender}::gender_type)
      and (${competitionId}::uuid is null or r.competition_id = ${competitionId}::uuid)
    -- 並べ替えの軸は SQL に直接埋め込めない（値としてしか渡せない）ため、
    -- 選ばれていない軸が NULL になる case 式を並べて実現している。
    -- NULL は order by で無視されるので、結果的に1つの軸だけが効く
    order by
      case when ${sort}::text = 'mark' then app.mark_sort_value(e.kind, r.mark) end
        asc nulls last,
      case when ${sort}::text = 'name' then coalesce(p.full_name_kana, p.full_name) end
        asc nulls last,
      case when ${sort}::text = 'date_asc' then r.competed_on end
        asc nulls last,
      case when ${sort}::text = 'date_desc' then r.competed_on end
        desc nulls last,
      -- 上のどれでも同着になった場合の最終的な並び
      r.competed_on desc nulls last, e.sort_order, p.full_name_kana nulls last
    limit ${RESULT_LIMIT}
  `) as ResultRow[];
}

export async function getResult(id: string) {
  const { sql } = await dbAsUser();
  const rows = (await sql`
    select r.id, r.profile_id, r.event_code, r.competition_id, r.competition_name,
           to_char(r.competed_on, 'YYYY-MM-DD') as competed_on,
           r.round, r.mark, r.wind, r.timing,
           r.status, r.place, r.is_official, r.note,
           e.kind
    from results r
    join events_master e on e.code = r.event_code
    where r.id = ${id}::uuid
  `) as {
    id: string;
    profile_id: string;
    event_code: string;
    competition_id: string | null;
    competition_name: string | null;
    competed_on: string | null;
    round: string | null;
    mark: number | null;
    wind: number | null;
    timing: 'electronic' | 'hand';
    status: string | null;
    place: number | null;
    is_official: boolean;
    note: string | null;
    kind: EventKind;
  }[];
  return rows[0] ?? null;
}

/** 自己ベスト。高校時代の記録も含まれる */
export async function listPersonalBests(profileId: string) {
  const { sql } = await dbAsUser();
  return (await sql`
    select pb.event_code, e.name_ja as event_name, e.kind,
           pb.mark, pb.wind, pb.competed_on,
           coalesce(c.name, r.competition_name) as competition_label,
           at.rank as all_time_rank
    from v_personal_bests pb
    join events_master e on e.code = pb.event_code
    join results       r on r.id = pb.result_id
    left join competitions c on c.id = pb.competition_id
    left join v_result_all_time_ranks at on at.result_id = pb.result_id
    where pb.profile_id = ${profileId}::uuid
    order by e.sort_order
  `) as {
    event_code: string;
    event_name: string;
    kind: EventKind;
    mark: number;
    wind: number | null;
    competed_on: string | null;
    competition_label: string | null;
    all_time_rank: number | null;
  }[];
}

/** 今年度のシーズンベスト */
export async function listSeasonBests(profileId: string, season = fiscalYear()) {
  const { sql } = await dbAsUser();
  return (await sql`
    select sb.event_code, e.name_ja as event_name, e.kind,
           sb.mark, sb.wind, sb.competed_on, sb.season_year
    from v_season_bests sb
    join events_master e on e.code = sb.event_code
    where sb.profile_id = ${profileId}::uuid
      and sb.season_year = ${season}
    order by e.sort_order
  `) as {
    event_code: string;
    event_name: string;
    kind: EventKind;
    mark: number;
    wind: number | null;
    competed_on: string;
    season_year: number;
  }[];
}

/** 部全体の今年度シーズンベスト上位。種目・性別ごとに順位を付ける */
export async function listTeamSeasonBests(season = fiscalYear(), perEvent = 5) {
  const { sql } = await dbAsUser();
  return (await sql`
    select * from (
      select sb.event_code, e.name_ja as event_name, e.kind, e.sort_order,
             sb.profile_id, p.full_name, p.gender,
             sb.mark, sb.wind, sb.competed_on,
             row_number() over (
               partition by sb.event_code, p.gender
               order by case when e.kind = 'track' then sb.mark else -sb.mark end
             ) as rank
      from v_season_bests sb
      join events_master e on e.code = sb.event_code
      join profiles      p on p.id = sb.profile_id
      where sb.season_year = ${season}
    ) t
    where t.rank <= ${perEvent}
    order by t.sort_order, t.gender, t.rank
  `) as {
    event_code: string;
    event_name: string;
    kind: EventKind;
    profile_id: string;
    full_name: string;
    gender: Gender;
    mark: number;
    wind: number | null;
    competed_on: string;
    rank: number;
  }[];
}

// ---------------------------------------------------------------------------
// 標準記録
// ---------------------------------------------------------------------------

export async function listStandards(): Promise<Standard[]> {
  const { sql } = await dbAsUser();
  return (await sql`
    select s.id, s.name, s.event_code, e.name_ja as event_name, e.kind,
           s.gender, s.mark, s.season_year,
           to_char(s.valid_from, 'YYYY-MM-DD') as valid_from,
           to_char(s.valid_to,   'YYYY-MM-DD') as valid_to,
           s.note
    from standards s
    join events_master e on e.code = s.event_code
    order by s.name, e.sort_order, s.gender
  `) as Standard[];
}

export async function listStandardClears(): Promise<StandardClear[]> {
  const { sql } = await dbAsUser();
  return (await sql`
    select distinct on (sc.standard_id, sc.profile_id)
           sc.standard_id, sc.standard_name, sc.event_code,
           e.name_ja as event_name, e.kind,
           sc.profile_id, sc.full_name, sc.gender,
           sc.standard_mark, sc.cleared_mark, sc.wind, sc.competed_on
    from v_standard_clears sc
    join events_master e on e.code = sc.event_code
    order by sc.standard_id, sc.profile_id,
             case when e.kind = 'track' then sc.cleared_mark else -sc.cleared_mark end
  `) as StandardClear[];
}

// ---------------------------------------------------------------------------
// 練習日誌・スケジュール・身体データ
// ---------------------------------------------------------------------------

export async function listMyTrainingLogs(limit = 60): Promise<TrainingLog[]> {
  const { sql, user } = await dbAsUser();
  return (await sql`
    select id, to_char(log_date, 'YYYY-MM-DD') as log_date,
           content, reflection, condition,
           distance_km, duration_min, rpe
    from training_logs
    where profile_id = ${user.id}::uuid
    order by log_date desc
    limit ${limit}
  `) as TrainingLog[];
}

export type WeeklyMileage = {
  week_start: string;
  /** numeric の合計。ドライバは文字列で返すので必ず format 側で数値に直す */
  total_km: string | number;
  sessions: number;
  total_min: number | null;
  total_load: number | null;
};

/**
 * 週間走行距離。新しい週が先頭に来る。
 *
 * 閲覧できるのは本人と管理者だけ。練習日誌そのものと同じ扱いにする。
 * 距離だけなら見せてよい、という線引きにすると、
 * 日誌を非公開にした意味が薄れる。
 */
export async function listWeeklyMileageFor(
  profileId: string,
  weeks = 12
): Promise<WeeklyMileage[]> {
  const { sql, user } = await dbAsUser();
  const staff = await isStaff();
  if (user.id !== profileId && !staff) return [];

  return (await sql`
    select to_char(week_start, 'YYYY-MM-DD') as week_start,
           total_km, sessions, total_min, total_load
    from v_weekly_mileage
    where profile_id = ${profileId}::uuid
    order by week_start desc
    limit ${weeks}
  `) as WeeklyMileage[];
}

export async function listUpcomingSchedules() {
  const { sql } = await dbAsUser();
  return (await sql`
    select s.id, s.title,
           to_char(s.starts_on, 'YYYY-MM-DD') as starts_on,
           to_char(s.ends_on,   'YYYY-MM-DD') as ends_on,
           s.body, s.file_url,
           p.full_name as created_by_name
    from schedules s
    left join profiles p on p.id = s.created_by
    where coalesce(s.ends_on, s.starts_on) >= current_date
    order by s.starts_on
    limit 20
  `) as {
    id: string;
    title: string;
    starts_on: string;
    ends_on: string | null;
    body: string | null;
    file_url: string | null;
    created_by_name: string | null;
  }[];
}

export async function listRecentPracticeMenus(limit = 14) {
  const { sql } = await dbAsUser();
  return (await sql`
    select m.id, to_char(m.menu_date, 'YYYY-MM-DD') as menu_date,
           m.title, m.body, m.file_url, m.target_group,
           p.full_name as created_by_name
    from practice_menus m
    left join profiles p on p.id = m.created_by
    order by m.menu_date desc
    limit ${limit}
  `) as {
    id: string;
    menu_date: string;
    title: string;
    body: string | null;
    file_url: string | null;
    target_group: string | null;
    created_by_name: string | null;
  }[];
}

/**
 * 身体データ。
 *
 * RLS 代替: 現在 RLS が効いていないため、この where 句が唯一の防壁になる。
 * 消すと全部員の身体データが漏れる。絶対に消さないこと。
 */
export async function listMyBodyMetrics() {
  const { sql, user } = await dbAsUser();
  return (await sql`
    select id, to_char(measured_on, 'YYYY-MM-DD') as measured_on,
           height_cm, weight_kg, body_fat_pct,
           muscle_mass_kg, inbody_file_url, note
    from body_metrics
    where profile_id = ${user.id}::uuid
    order by measured_on desc
    limit 100
  `) as {
    id: string;
    measured_on: string;
    height_cm: number | null;
    weight_kg: number | null;
    body_fat_pct: number | null;
    muscle_mass_kg: number | null;
    inbody_file_url: string | null;
    note: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// 部内歴代10傑
// ---------------------------------------------------------------------------

export type AllTimeRow = {
  id: string;
  /** 'current' なら現役・OBのアカウントから、'historical' なら移行データから */
  origin: 'current' | 'historical';
  /** 現役部員の記録かどうか。枠の色を変えるのに使う */
  is_active: boolean;
  event_code: string;
  event_name: string;
  kind: EventKind;
  block: Block | null;
  sort_order: number;
  gender: Gender;
  mark: number;
  athlete_name: string;
  /** リレーの走者。個人種目では null */
  team_members: string[] | null;
  profile_id: string | null;
  admission_code: string | null;
  admission_year: number | null;
  competed_on: string | null;
  /** 日付として読めなかった元データの原文。"88****" など */
  competed_on_raw: string | null;
  venue: string | null;
  note: string | null;
  rank: number;
};

/**
 * 歴代記録。順位はビュー側で記録から計算されている。
 *
 * 10傑という名前だが、同記録が並ぶと11人以上になることがあるため
 * 件数ではなく順位で切っている。
 */
export async function listAllTimeBests(filters: {
  gender?: Gender | null;
  block?: Block | null;
  eventCode?: string | null;
  maxRank?: number;
} = {}): Promise<AllTimeRow[]> {
  const { sql } = await dbAsUser();

  const gender = filters.gender ?? null;
  const block = filters.block ?? null;
  const eventCode = filters.eventCode ?? null;
  const maxRank = filters.maxRank ?? 10;

  return (await sql`
    select id, origin, is_active, event_code, event_name, kind, block, sort_order, gender,
           mark, athlete_name, team_members, profile_id,
           admission_code, admission_year,
           competed_on, competed_on_raw, venue, note, rank
    from v_all_time_bests
    where rank <= ${maxRank}
      and (${gender}::text is null or gender = ${gender}::gender_type)
      and (${block}::text is null or block = ${block}::block_type)
      and (${eventCode}::text is null or event_code = ${eventCode}::text)
    order by sort_order, gender, rank, athlete_name
  `) as AllTimeRow[];
}

/** どのブロックにデータが入っているか。タブの出し分けに使う */
export async function listAllTimeBlocks() {
  const { sql } = await dbAsUser();
  return (await sql`
    select distinct gender, block
    from v_all_time_bests
    where block is not null
  `) as { gender: Gender; block: Block }[];
}

// ---------------------------------------------------------------------------
// 個票
// ---------------------------------------------------------------------------

export type ProgressionPoint = {
  event_code: string;
  event_name: string;
  kind: EventKind;
  competed_on: string;
  mark: number;
  wind: number | null;
  timing: 'electronic' | 'hand';
  is_official: boolean;
  competition_label: string | null;
};

/**
 * 記録推移グラフのもとになる点。
 *
 * 有効記録（v_valid_results）に絞っていないのは、推移を見るのが目的だから。
 * 手動計時や追い風参考の記録も本人の歩みには違いなく、
 * そこを抜くとグラフが穴だらけになる。
 * 代わりに timing と wind を返して、画面側で印を付けられるようにしている。
 */
export async function listProgression(profileId: string): Promise<ProgressionPoint[]> {
  const { sql } = await dbAsUser();
  return (await sql`
    select r.event_code, e.name_ja as event_name, e.kind,
           -- 文字列で返す。date のまま返すとドライバが Date オブジェクトにするため、
           -- クライアント側へ渡ったときの扱いが型宣言とずれる
           to_char(r.competed_on, 'YYYY-MM-DD') as competed_on,
           r.mark, r.wind, r.timing, r.is_official,
           coalesce(c.name, r.competition_name) as competition_label
    from results r
    join events_master e on e.code = r.event_code
    left join competitions c on c.id = r.competition_id
    where r.profile_id = ${profileId}::uuid
      and r.mark is not null
      and r.status is null
      and r.competed_on is not null
    order by e.sort_order, r.competed_on
  `) as ProgressionPoint[];
}

export type TrainingLog = {
  id: string;
  log_date: string;
  content: string;
  reflection: string | null;
  condition: number | null;
  /** numeric なのでドライバは文字列で返す。表示前に必ず lib/format を通すこと */
  distance_km: string | number | null;
  duration_min: number | null;
  rpe: number | null;
};

/**
 * 指定した部員の練習日誌。
 *
 * 閲覧できるのは本人と管理者・スタッフだけ。
 * RLS 側にも同じ制限があるが、いまは RLS を止めて
 * neondb_owner で接続しているため、ここが実質的な防壁になる。
 * それ以外の人が呼んだ場合は空を返す（存在自体を伏せる）。
 */
export async function listTrainingLogsFor(
  profileId: string,
  limit = 60
): Promise<TrainingLog[]> {
  const { sql, user } = await dbAsUser();
  const staff = await isStaff();
  if (user.id !== profileId && !staff) return [];

  return (await sql`
    select id, to_char(log_date, 'YYYY-MM-DD') as log_date,
           content, reflection, condition,
           distance_km, duration_min, rpe
    from training_logs
    where profile_id = ${profileId}::uuid
    order by log_date desc
    limit ${limit}
  `) as TrainingLog[];
}

// ---------------------------------------------------------------------------
// 故障記録
// ---------------------------------------------------------------------------

export type Injury = {
  id: string;
  profile_id: string;
  site: string;
  injury_type: string | null;
  onset_date: string;
  recovered_on: string | null;
  stage: number;
  note: string | null;
  /** 同じ部位で過去に何回目か。1 なら初回 */
  same_site_count: number;
};

export type InjuryStageLog = {
  id: string;
  injury_id: string;
  stage: number;
  changed_on: string;
  note: string | null;
};

/**
 * 指定した部員の故障記録。故障中のものが先、次に発症日の新しい順。
 *
 * 閲覧できるのは本人とスタッフだけ。練習日誌と同じ範囲にしている。
 * それ以外の人が呼んだ場合は空を返す（存在自体を伏せる）。
 *
 * RLS 代替: いまは neondb_owner で接続しているため、ここが実質的な防壁になる。
 */
export async function listInjuriesFor(profileId: string): Promise<Injury[]> {
  const { sql, user } = await dbAsUser();
  const staff = await isStaff();
  if (user.id !== profileId && !staff) return [];

  return (await sql`
    select i.id, i.profile_id, i.site, i.injury_type,
           to_char(i.onset_date,   'YYYY-MM-DD') as onset_date,
           to_char(i.recovered_on, 'YYYY-MM-DD') as recovered_on,
           i.stage, i.note,
           -- 同じ部位で何回目か。発症日の古いものから数える。
           -- 再発の多い部位が本人にも指導者にも一目で分かる
           count(*) over (
             partition by i.profile_id, i.site
             order by i.onset_date, i.created_at
             rows between unbounded preceding and current row
           )::int as same_site_count
    from injuries i
    where i.profile_id = ${profileId}::uuid
    order by (i.recovered_on is null) desc, i.onset_date desc
  `) as Injury[];
}

/**
 * 指定した部員の全故障の段階履歴を、故障IDごとにまとめて返す。古い順。
 *
 * 故障1件ずつ引く形にすると、記録が10件ある人の個票で
 * 往復が数十回になる（Neon はクエリごとに HTTP 往復が発生する）。
 * 件数の少ないデータなので、1回で全部引いて画面側で振り分ける。
 */
export async function listInjuryStageLogsFor(
  profileId: string
): Promise<Record<string, InjuryStageLog[]>> {
  const { sql, user } = await dbAsUser();
  const staff = await isStaff();
  if (user.id !== profileId && !staff) return {};

  const rows = (await sql`
    select l.id, l.injury_id, l.stage,
           to_char(l.changed_on, 'YYYY-MM-DD') as changed_on,
           l.note
    from injury_stage_logs l
    join injuries i on i.id = l.injury_id
    where i.profile_id = ${profileId}::uuid
    order by l.changed_on, l.created_at
  `) as InjuryStageLog[];

  const grouped: Record<string, InjuryStageLog[]> = {};
  for (const r of rows) {
    (grouped[r.injury_id] ??= []).push(r);
  }
  return grouped;
}

export type ActiveInjury = {
  id: string;
  profile_id: string;
  full_name: string;
  gender: Gender;
  block: Block | null;
  site: string;
  injury_type: string | null;
  onset_date: string;
  stage: number;
  days_elapsed: number;
};

/**
 * いま故障中の部員の一覧。スタッフ専用。
 *
 * 一人ずつ個票を開いて回るのは現実的ではないので、まとめて見られる形にする。
 * スタッフ以外が呼んだ場合は空を返す。
 */
export async function listActiveInjuries(): Promise<ActiveInjury[]> {
  const { sql } = await dbAsUser();
  const staff = await isStaff();
  if (!staff) return [];

  return (await sql`
    select id, profile_id, full_name, gender, block, site, injury_type,
           to_char(onset_date, 'YYYY-MM-DD') as onset_date,
           stage, days_elapsed
    from v_active_injuries
    order by stage, onset_date
  `) as ActiveInjury[];
}

// ---------------------------------------------------------------------------
// 達成（自己ベスト更新・標準記録突破・歴代10傑入り）
// ---------------------------------------------------------------------------

export type AchievementKind = 'pb' | 'sb' | 'standard' | 'all_time';

export type Achievement = {
  id: string;
  profile_id: string;
  result_id: string;
  full_name: string;
  gender: Gender;
  kind: AchievementKind;
  achieved_on: string;
  event_code: string;
  event_name: string;
  /** 種目の系統。表示の整形に必要 */
  event_kind: EventKind;
  /** numeric なのでドライバは文字列で返す。表示前に必ず lib/format を通すこと */
  mark: string | number | null;
  previous_mark: string | number | null;
  standard_name: string | null;
  all_time_rank: number | null;
  competition_label: string | null;
};

/**
 * 最近の達成。部員全員ぶんを新しい順に返す。
 *
 * 達成は部内の掲示物として全員に見せる。元になる記録がもともと
 * 全員に見えているので、ここだけ隠しても意味がない。
 */
export async function listRecentAchievements(limit = 12): Promise<Achievement[]> {
  const { sql } = await dbAsUser();
  return (await sql`
    select
      a.id, a.profile_id, a.result_id, a.kind,
      to_char(a.achieved_on, 'YYYY-MM-DD') as achieved_on,
      p.full_name, p.gender,
      a.detail->>'event_code'                as event_code,
      e.name_ja                              as event_name,
      e.kind                                 as event_kind,
      (a.detail->>'mark')::numeric           as mark,
      (a.detail->>'previous_mark')::numeric  as previous_mark,
      a.detail->>'standard_name'             as standard_name,
      (a.detail->>'rank')::int               as all_time_rank,
      coalesce(c.name, r.competition_name)   as competition_label
    from achievements a
    join profiles p      on p.id = a.profile_id
    join results  r      on r.id = a.result_id
    join events_master e on e.code = a.detail->>'event_code'
    left join competitions c on c.id = r.competition_id
    order by a.achieved_on desc, a.created_at desc
    limit ${limit}
  `) as Achievement[];
}

/** 指定した部員の達成。個票と本人ページで使う */
export async function listAchievementsFor(
  profileId: string,
  limit = 30
): Promise<Achievement[]> {
  const { sql } = await dbAsUser();
  return (await sql`
    select
      a.id, a.profile_id, a.result_id, a.kind,
      to_char(a.achieved_on, 'YYYY-MM-DD') as achieved_on,
      p.full_name, p.gender,
      a.detail->>'event_code'                as event_code,
      e.name_ja                              as event_name,
      e.kind                                 as event_kind,
      (a.detail->>'mark')::numeric           as mark,
      (a.detail->>'previous_mark')::numeric  as previous_mark,
      a.detail->>'standard_name'             as standard_name,
      (a.detail->>'rank')::int               as all_time_rank,
      coalesce(c.name, r.competition_name)   as competition_label
    from achievements a
    join profiles p      on p.id = a.profile_id
    join results  r      on r.id = a.result_id
    join events_master e on e.code = a.detail->>'event_code'
    left join competitions c on c.id = r.competition_id
    where a.profile_id = ${profileId}::uuid
    order by a.achieved_on desc, a.created_at desc
    limit ${limit}
  `) as Achievement[];
}

// ---------------------------------------------------------------------------
// 戦績カード（OGP画像）
// ---------------------------------------------------------------------------

export type ResultCard = {
  full_name: string;
  gender: Gender;
  event_name: string;
  event_kind: EventKind;
  mark: string | number | null;
  wind: string | number | null;
  competed_on: string | null;
  competition_label: string | null;
  round: string | null;
  place: number | null;
  is_pb: boolean;
  all_time_rank: number | null;
  standard_names: string[];
};

/**
 * 戦績カードに載せる情報だけを引く。
 *
 * この関数だけは dbAsOwner() を使う。カードを生成する API は
 * ログインを要求できないためである（SNS のクローラはログインできない）。
 *
 * したがって、ここで select する列は「部外に出てもよいもの」だけに限ること。
 * 練習日誌・身体データ・故障記録は絶対に足さない。
 */
export async function getResultCard(resultId: string): Promise<ResultCard | null> {
  const sql = dbAsOwner();

  const rows = (await sql`
    select
      p.full_name,
      p.gender,
      e.name_ja                            as event_name,
      e.kind                               as event_kind,
      r.mark,
      r.wind,
      to_char(r.competed_on, 'YYYY-MM-DD') as competed_on,
      coalesce(c.name, r.competition_name) as competition_label,
      r.round,
      r.place,
      (pb.result_id is not null)           as is_pb,
      at.rank                              as all_time_rank,
      coalesce(
        (select array_agg(a.detail->>'standard_name' order by a.created_at)
         from achievements a
         where a.result_id = r.id and a.kind = 'standard'),
        '{}'::text[]
      ) as standard_names
    from results r
    join profiles      p on p.id   = r.profile_id
    join events_master e on e.code = r.event_code
    left join competitions c on c.id = r.competition_id
    left join v_personal_bests        pb on pb.result_id = r.id
    left join v_result_all_time_ranks at on at.result_id = r.id
    where r.id = ${resultId}::uuid
      and r.mark is not null
      and r.status is null
  `) as ResultCard[];

  return rows[0] ?? null;
}
