import type { Achievement } from '@/lib/queries';
import { MemberName } from '@/components/MemberName';
import { ResultCardLink } from '@/components/ResultCardLink';
import { formatAllTimeRank, formatDate, formatMark } from '@/lib/format';

/**
 * 最近の活躍。
 *
 * 一覧のどこにも「更新できていない人」が出ない作りにしてある。
 * 順位や達成率を並べると、載っていないこと自体が意味を持ってしまう。
 * ここに出るのは起きた出来事だけで、出ないことは何も表さない。
 */
export function AchievementFeed({
  achievements,
  /** 個人ページで使うときは名前を繰り返さない */
  showName = true,
}: {
  achievements: Achievement[];
  showName?: boolean;
}) {
  if (achievements.length === 0) {
    return (
      <div className="card mt-3">
        <p className="empty">まだ記録の更新がありません。</p>
      </div>
    );
  }

  return (
    <ul className="card mt-3 divide-y divide-[var(--color-line)]">
      {achievements.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
          <span className="tabular shrink-0 text-xs text-[var(--color-muted)]">
            {formatDate(a.achieved_on)}
          </span>

          {showName && (
            <MemberName
              name={a.full_name}
              gender={a.gender}
              href={`/members/${a.profile_id}`}
            />
          )}

          <span className="text-sm">{a.event_name}</span>

          <span className="readout text-lg text-[var(--color-azure)]">
            {formatMark(a.event_kind, a.mark)}
          </span>

          <AchievementChip achievement={a} />

          <span className="w-full text-xs text-[var(--color-muted)] sm:w-auto">
            {describe(a)}
            {a.competition_label ? `　${a.competition_label}` : ''}
          </span>

          <span className="ml-auto shrink-0">
            <ResultCardLink resultId={a.result_id} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function AchievementChip({ achievement: a }: { achievement: Achievement }) {
  switch (a.kind) {
    case 'pb':
      return <span className="chip chip-pb">{a.previous_mark === null ? '初記録' : 'PB'}</span>;
    case 'sb':
      return <span className="chip chip-sb">SB</span>;
    case 'standard':
      return <span className="chip chip-pb">標準突破</span>;
    case 'all_time':
      return (
        <span className={a.all_time_rank === 1 ? 'chip chip-record' : 'chip chip-alltime'}>
          {formatAllTimeRank(a.all_time_rank) || '歴代10傑'}
        </span>
      );
  }
}

/** 一行の説明。何が起きたのかを言葉で添える */
function describe(a: Achievement): string {
  switch (a.kind) {
    case 'pb':
      return a.previous_mark === null
        ? 'この種目で初めての記録'
        : `自己ベスト更新（前 ${formatMark(a.event_kind, a.previous_mark)}）`;
    case 'sb':
      return a.previous_mark === null
        ? '今季初戦の記録'
        : `シーズンベスト更新（前 ${formatMark(a.event_kind, a.previous_mark)}）`;
    case 'standard':
      return `${a.standard_name ?? '標準記録'} を突破`;
    case 'all_time':
      return a.all_time_rank === 1 ? '文大記録' : `歴代${a.all_time_rank}位に入りました`;
  }
}
