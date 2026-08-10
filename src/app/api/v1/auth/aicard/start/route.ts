import { randomBytes } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { AICardClient } from '@/server/aicard-client';
import {
  sealAICardAuthorizationSession,
} from '@/server/aicard-authorization-session';
import { getAICardIntegrationConfig } from '@/server/aicard-integration-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const AICARD_AUTHORIZATION_COOKIE = 'yoyoo_aicard_authorization';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const requestedPurpose = request.nextUrl.searchParams.get('purpose');
    if (requestedPurpose !== null && requestedPurpose !== 'owner' && requestedPurpose !== 'agent') {
      return Response.json(
        { error: { code: 'INVALID_AICARD_PURPOSE', message: 'AI Card 接入类型无效。' } },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }
    const purpose = requestedPurpose === 'agent' ? 'agent' : 'owner';
    const config = getAICardIntegrationConfig();
    const canonicalUrl = new URL(config.redirectUri);
    const requestHost = request.headers.get('host') ?? request.nextUrl.host;
    if (requestHost !== canonicalUrl.host) {
      const target = new URL('/api/v1/auth/aicard/start', canonicalUrl.origin);
      if (purpose === 'agent') target.searchParams.set('purpose', 'agent');
      return NextResponse.redirect(target, 307);
    }
    const client = new AICardClient(config);
    const transaction = client.createAuthorizationTransaction({
      principalType: purpose === 'agent' ? 'ai' : undefined,
    });
    const sealed = sealAICardAuthorizationSession({
      state: transaction.state,
      codeVerifier: transaction.codeVerifier,
      idempotencyKey: `idem_${randomBytes(24).toString('base64url')}`,
      purpose,
      createdAt: Date.now(),
    }, config.sessionSecret);
    const response = NextResponse.redirect(transaction.authorizationUrl, 303);
    response.cookies.set(AICARD_AUTHORIZATION_COOKIE, sealed, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      path: '/auth/aicard/callback',
      maxAge: 10 * 60,
    });
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch {
    return Response.json(
      {
        error: {
          code: 'AICARD_NOT_CONFIGURED',
          message: 'AI Card 接入尚未完成服务器配置。',
        },
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
