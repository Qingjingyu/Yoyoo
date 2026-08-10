import { NextRequest, NextResponse } from 'next/server';

import { AICardClient, AICardProtocolError } from '@/server/aicard-client';
import {
  AICardAuthorizationSessionError,
  openAICardAuthorizationSession,
} from '@/server/aicard-authorization-session';
import { getAICardIntegrationConfig } from '@/server/aicard-integration-config';
import { AICARD_AUTHORIZATION_COOKIE } from '@/app/api/v1/auth/aicard/start/route';
import { AICardIdentityConflictError, PrincipalRepository } from '@/server/postgres/principal-repository';
import { getServerRuntime } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resultRedirect(request: NextRequest, result: string): NextResponse {
  const target = new URL('/settings/agents', request.nextUrl.origin);
  target.searchParams.set('aicard', result);
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(AICARD_AUTHORIZATION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/auth/aicard/callback',
    maxAge: 0,
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const config = getAICardIntegrationConfig();
    const sealed = request.cookies.get(AICARD_AUTHORIZATION_COOKIE)?.value;
    if (!sealed) throw new AICardAuthorizationSessionError();
    const session = openAICardAuthorizationSession(sealed, config.sessionSecret);
    const returnedState = request.nextUrl.searchParams.get('state');
    if (returnedState !== session.state) {
      throw new AICardAuthorizationSessionError();
    }
    if (request.nextUrl.searchParams.get('error')) {
      return resultRedirect(request, 'denied');
    }
    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new AICardAuthorizationSessionError();

    const client = new AICardClient(config);
    const token = await client.exchangeAuthorizationCode({
      code,
      codeVerifier: session.codeVerifier,
      idempotencyKey: session.idempotencyKey,
    });
    const userInfo = await client.getUserInfo(token.accessToken);
    const expectedPrincipalType = session.purpose === 'agent' ? 'ai' : 'human';
    if (
      token.subject !== userInfo.subject ||
      userInfo.principalType !== expectedPrincipalType
    ) {
      throw new AICardProtocolError('AI Card identity response is inconsistent');
    }

    const runtime = await getServerRuntime();
    const principals = new PrincipalRepository(runtime.pool);
    await principals.mapAICardIdentity({
      issuer: config.issuer,
      clientId: config.clientId,
      subject: userInfo.subject,
      principalType: userInfo.principalType,
      displayName: userInfo.displayName,
      handle: userInfo.handle,
      principalId: session.purpose === 'owner'
        ? runtime.collaboration.bootstrap.principal.id
        : undefined,
      workspaceId: session.purpose === 'agent'
        ? runtime.collaboration.bootstrap.workspace.id
        : undefined,
    });
    return resultRedirect(
      request,
      session.purpose === 'agent' ? 'agent_connected' : 'connected',
    );
  } catch (error) {
    if (error instanceof AICardAuthorizationSessionError) {
      return resultRedirect(request, 'invalid_session');
    }
    if (
      error instanceof AICardProtocolError ||
      error instanceof AICardIdentityConflictError
    ) {
      return resultRedirect(request, 'failed');
    }
    return resultRedirect(request, 'unavailable');
  }
}
