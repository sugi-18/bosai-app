'use client';

import { useState } from 'react';

/**
 * 戦績カードを開くボタン。
 *
 * OGP のメタタグは付けていない。記録のページはログインしないと開けないので、
 * SNS のクローラが読みに行っても何も取れないためである。
 * 代わりに画像そのものを開き、保存して投稿してもらう形にしている。
 *
 * URL をコピーするボタンも添えてあるが、
 * これを渡した相手には記録が見えることは伝わるようにしておくこと。
 */
export function ResultCardLink({ resultId }: { resultId: string }) {
  const [copied, setCopied] = useState(false);

  const path = `/api/og/result/${resultId}`;

  const copy = async () => {
    try {
      const url = `${window.location.origin}${path}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境（古い端末・http）では黙って何もしない。
      // 画像を開くほうのボタンは動くので、そちらから保存できる
    }
  };

  return (
    <span style={{ display: 'inline-flex', gap: '0.5rem' }}>
      <a href={path} target="_blank" rel="noreferrer" className="link text-xs">
        カード
      </a>
      <button type="button" onClick={copy} className="link text-xs">
        {copied ? 'コピーしました' : 'URLをコピー'}
      </button>
    </span>
  );
}
