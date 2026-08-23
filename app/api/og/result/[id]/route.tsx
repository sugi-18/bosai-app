import { ImageResponse } from 'next/og';
import { getResultCard } from '@/lib/queries';
import { formatAllTimeRank, formatDate, formatMark, formatWind } from '@/lib/format';

/**
 * 戦績カード（PNG 1200×630）。
 *
 * ■ このエンドポイントはログインを要求しない
 *
 * SNS のクローラはログインできないため、要求すると画像が出ない。
 * つまりここに出す情報は、部外の人が見てもよいものだけに限られる。
 * 載せているのは 氏名 / 種目 / 記録 / 風力 / 順位 / 大会名 / 日付 だけで、
 * 練習日誌・身体データ・故障記録は一切引いていない（getResultCard 参照）。
 *
 * URL に含まれるのは記録の UUID なので、総当たりで見つけることはできない。
 * ただし「共有した相手には見える」ことは前提にしてある。
 *
 * ■ 日本語フォント
 *
 * satori（ImageResponse の中身）は woff2 を読めず、フォントを同梱すると
 * 常用漢字だけでも数 MB になる。ここでは Google Fonts に
 * 「この文字だけ」を指定してサブセットを取り、毎回数 KB で済ませている。
 * 部員の名前にどんな漢字が来ても対応できる。
 */

export const runtime = 'nodejs';
// 画像は記録が変わらない限り同じ。クローラが何度来ても作り直さない
export const revalidate = 3600;

const SIZE = { width: 1200, height: 630 };

const NAVY = '#0b1f3a';
const AZURE = '#1257e8';
const MUTED = '#64748b';
const LINE = '#dbe3f0';
const GOLD = '#7a5a1e';
const GOLD_BG = '#f4e9d4';
const FEMALE = '#c0303c';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const card = await getResultCard(id);
  if (!card) {
    return new Response('not found', { status: 404 });
  }

  const nameColor =
    card.gender === 'female' ? FEMALE : card.gender === 'male' ? NAVY : NAVY;

  const mark = formatMark(card.event_kind, card.mark);
  const wind = formatWind(card.wind);
  const rankLabel = formatAllTimeRank(card.all_time_rank);
  const date = card.competed_on ? formatDate(card.competed_on) : '';

  const badges: { text: string; fg: string; bg: string; border: string }[] = [];
  if (rankLabel) {
    badges.push(
      card.all_time_rank === 1
        ? { text: rankLabel, fg: '#fdfaf4', bg: GOLD, border: GOLD }
        : { text: rankLabel, fg: GOLD, bg: GOLD_BG, border: '#e2cda8' }
    );
  }
  if (card.is_pb) {
    badges.push({ text: '自己ベスト', fg: '#ffffff', bg: AZURE, border: AZURE });
  }
  for (const s of card.standard_names ?? []) {
    if (s) badges.push({ text: `${s} 突破`, fg: AZURE, bg: '#ffffff', border: AZURE });
  }

  const footer = [date, card.competition_label, card.round]
    .filter(Boolean)
    .join('　');

  // 画像に出る文字をすべて集めてサブセットを作る。
  // 1文字でも漏れると、その字だけ豆腐（□）になる
  const text =
    '都留文科大学陸上競技部' +
    card.full_name +
    card.event_name +
    mark +
    wind +
    badges.map((b) => b.text).join('') +
    footer +
    (card.place !== null ? `${card.place}位` : '') +
    '0123456789.:+-/　 m';

  let fontData: ArrayBuffer | null = null;
  try {
    fontData = await loadNotoSansJP(text);
  } catch {
    // フォントが取れなくても 500 にはしない。
    // 英数字だけの記録なら既定のフォントでも読める形で出る
    fontData = null;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#ffffff',
          borderTop: `16px solid ${NAVY}`,
          padding: '56px 64px 48px 64px',
          fontFamily: 'NotoSansJP, sans-serif',
        }}
      >
        {/* 見出し */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 2,
              color: AZURE,
            }}
          >
            都留文科大学陸上競技部
          </div>
        </div>

        {/* 本体 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 52, color: nameColor }}>
            {card.full_name}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              marginTop: 8,
            }}
          >
            <div style={{ fontSize: 44, color: MUTED, paddingBottom: 22 }}>
              {card.event_name}
            </div>
            <div
              style={{
                fontSize: 150,
                color: AZURE,
                lineHeight: 1,
                marginLeft: 32,
              }}
            >
              {mark}
            </div>
            {wind && (
              <div style={{ fontSize: 40, color: MUTED, paddingBottom: 22, marginLeft: 20 }}>
                {wind}
              </div>
            )}
            {card.place !== null && (
              <div style={{ fontSize: 40, color: MUTED, paddingBottom: 22, marginLeft: 24 }}>
                {`${card.place}位`}
              </div>
            )}
          </div>

          {badges.length > 0 && (
            <div style={{ display: 'flex', marginTop: 24 }}>
              {badges.slice(0, 4).map((b, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    fontSize: 28,
                    color: b.fg,
                    background: b.bg,
                    border: `2px solid ${b.border}`,
                    borderRadius: 4,
                    padding: '6px 18px',
                    marginRight: 12,
                  }}
                >
                  {b.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 脚 */}
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: MUTED,
            borderTop: `2px solid ${LINE}`,
            paddingTop: 20,
          }}
        >
          {footer}
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: fontData
        ? [{ name: 'NotoSansJP', data: fontData, weight: 700, style: 'normal' }]
        : [],
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    }
  );
}

/**
 * 必要な文字だけの Noto Sans JP を取ってくる。
 *
 * Google Fonts は User-Agent を見て返す形式を変える。
 * 新しいブラウザには woff2 を返すが、satori は woff2 を読めないので、
 * woff2 を知らない古い UA を名乗って ttf を受け取る。
 */
async function loadNotoSansJP(text: string): Promise<ArrayBuffer> {
  // 重複を除いてから渡す。URL が短くなり、取得も速くなる
  const chars = Array.from(new Set(Array.from(text))).join('');

  const cssUrl =
    'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700' +
    `&text=${encodeURIComponent(chars)}`;

  const css = await fetch(cssUrl, {
    headers: {
      'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)',
    },
    next: { revalidate: 86400 },
  }).then((r) => {
    if (!r.ok) throw new Error(`font css ${r.status}`);
    return r.text();
  });

  const match = css.match(/src:\s*url\(([^)]+)\)/);
  if (!match) throw new Error('font url not found');

  const res = await fetch(match[1], { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`font file ${res.status}`);
  return await res.arrayBuffer();
}
