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

function publicAuthorizationRequest(authorizationUrl: string) {
  const url = new URL(authorizationUrl);
  const principalType = url.searchParams.get('principal_type');
  return {
    responseType: url.searchParams.get('response_type') ?? '',
    clientId: url.searchParams.get('client_id') ?? '',
    redirectUri: url.searchParams.get('redirect_uri') ?? '',
    scope: url.searchParams.get('scope') ?? '',
    state: url.searchParams.get('state') ?? '',
    codeChallenge: url.searchParams.get('code_challenge') ?? '',
    codeChallengeMethod: url.searchParams.get('code_challenge_method') ?? '',
    ...(principalType ? { principalType } : {}),
  };
}

function safeReturnTo(value: string | null, origin: string): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  try {
    const target = new URL(value, origin);
    return target.origin === origin
      ? `${target.pathname}${target.search}${target.hash}`
      : '/';
  } catch {
    return '/';
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const wantsJson = request.nextUrl.searchParams.get('format') === 'json';
    const requestedPurpose = request.nextUrl.searchParams.get('purpose');
    if (
      requestedPurpose !== null
      && requestedPurpose !== 'login'
      && requestedPurpose !== 'owner'
      && requestedPurpose !== 'agent'
    ) {
      return Response.json(
        { error: { code: 'INVALID_AICARD_PURPOSE', message: 'AI Card 接入类型无效。' } },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }
    const purpose = requestedPurpose === 'agent'
      ? 'agent'
      : requestedPurpose === 'owner'
        ? 'owner'
        : 'login';
    const config = getAICardIntegrationConfig();
    const canonicalUrl = new URL(config.redirectUri);
    const returnTo = safeReturnTo(
      request.nextUrl.searchParams.get('next'),
      canonicalUrl.origin,
    );
    const requestHost = request.headers.get('host') ?? request.nextUrl.host;
    if (requestHost !== canonicalUrl.host) {
      const target = new URL('/api/v1/auth/aicard/start', canonicalUrl.origin);
      if (purpose !== 'login') target.searchParams.set('purpose', purpose);
      if (returnTo !== '/') target.searchParams.set('next', returnTo);
      if (wantsJson) target.searchParams.set('format', 'json');
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
      returnTo,
      createdAt: Date.now(),
    }, config.sessionSecret);
    const response = wantsJson
      ? NextResponse.json({
          issuer: config.issuer,
          request: publicAuthorizationRequest(transaction.authorizationUrl),
        })
      : NextResponse.redirect(transaction.authorizationUrl, 303);
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
