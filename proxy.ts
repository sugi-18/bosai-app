import { auth } from '@/lib/auth/server';
import { NextRequest } from 'next/server';

/**
 * 未ログインなら /auth/sign-in へ飛ばす。
 *
 * Next.js 16 からこのファイルの名前は proxy.ts になった（旧 middleware.ts）。
 */
const authMiddleware = auth.middleware({
  loginUrl: '/auth/sign-in',
});

export default function proxy(request: NextRequest) {
  // サーバーアクションは各アクション内で認証を確認するので素通しする
  if (request.headers.has('Next-Action')) return;
  return authMiddleware(request);
}

/**
 * 戦績カードの画像（/api/og/...）はここに入れないこと。
 * SNS のクローラはログインできないため、保護すると画像が出なくなる。
 * 代わりに、カードに載せる情報を getResultCard() の select で絞っている。
 */
export const config = {
  matcher: [
    '/',
    '/onboarding',
    '/profile',
    '/members/:path*',
    '/results/:path*',
    '/competitions/:path*',
    '/standards/:path*',
    '/logs/:path*',
    '/injuries/:path*',
    '/achievements/:path*',
    '/body/:path*',
    '/account/:path*',
  ],
};
