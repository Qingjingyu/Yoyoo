import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { AICardClient, AICardProtocolError } from '@/server/aicard-client';
import {
  AICardAuthorizationSessionError,
  openAICardAuthorizationSession,
} from '@/server/aicard-authorization-session';
import { getAICardIntegrationConfig } from '@/server/aicard-integration-config';
import { AICARD_AUTHORIZATION_COOKIE } from '@/app/api/v1/auth/aicard/start/route';
import { AICardIdentityConflictError, PrincipalRepository } from '@/server/postgres/principal-repository';
import { HumanAuthService } from '@/server/auth/human-auth-service';
import { AICardSessionAuthority } from '@/server/auth/aicard-session-authority';
import { HUMAN_SESSION_COOKIE } from '@/server/auth/human-auth-http';
import {
  HumanAuthConflictError,
  HumanAuthRepository,
} from '@/server/postgres/human-auth-repository';
import { getServerRuntime } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resultRedirect(
  request: NextRequest,
  result: string,
  options: {
    purpose?: 'login' | 'owner' | 'agent';
    returnTo?: string;
    humanSession?: { token: string; expiresAt: Date };
    publicOrigin?: string;
  } = {},
): NextResponse {
  const publicOrigin = options.publicOrigin ?? request.nextUrl.origin;
  const target = options.purpose === 'login' && result === 'connected'
    ? new URL(options.returnTo ?? '/', publicOrigin)
    : options.purpose === 'owner' || options.purpose === 'agent'
      ? new URL('/settings/agents', publicOrigin)
      : new URL('/login', publicOrigin);
  target.searchParams.set('aicard', result);
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(AICARD_AUTHORIZATION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/auth/aicard/callback',
    maxAge: 0,
  });
  if (options.humanSession) {
    response.cookies.set(HUMAN_SESSION_COOKIE, options.humanSession.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: options.humanSession.expiresAt,
    });
  }
  response.headers.set('cache-control', 'no-store');
  return response;
}

export async function GET(request: NextRequest): Promise<Response> {
  let session: ReturnType<typeof openAICardAuthorizationSession> | undefined;
  let publicOrigin: string | undefined;
  try {
    const config = getAICardIntegrationConfig();
    publicOrigin = new URL(config.redirectUri).origin;
    const sealed = request.cookies.get(AICARD_AUTHORIZATION_COOKIE)?.value;
    if (!sealed) throw new AICardAuthorizationSessionError();
    session = openAICardAuthorizationSession(sealed, config.sessionSecret);
    const returnedState = request.nextUrl.searchParams.get('state');
    if (returnedState !== session.state) {
      throw new AICardAuthorizationSessionError();
    }
    if (request.nextUrl.searchParams.get('error')) {
      return resultRedirect(request, 'denied', { ...session, publicOrigin });
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
    if (session.purpose !== 'agent' && userInfo.cardId !== 'AI_100001') {
      return resultRedirect(request, 'workspace_denied', { ...session, publicOrigin });
    }

    const runtime = await getServerRuntime();
    const principals = new PrincipalRepository(runtime.pool);
    const mapped = await principals.mapAICardIdentity({
      issuer: config.issuer,
      clientId: config.clientId,
      subject: userInfo.subject,
      cardId: userInfo.cardId,
      principalType: userInfo.principalType,
      displayName: userInfo.displayName,
      handle: userInfo.handle,
      principalId: session.purpose === 'owner' || session.purpose === 'login'
        ? runtime.collaboration.bootstrap.principal.id
        : undefined,
      workspaceId: session.purpose === 'agent'
        ? runtime.collaboration.bootstrap.workspace.id
        : undefined,
    });
    const humanSession = session.purpose === 'login'
      ? token.refreshToken && token.refreshExpiresIn
        ? await new HumanAuthService(
            new HumanAuthRepository(runtime.pool),
            {
              aicardAuthority: new AICardSessionAuthority(
                config,
                config.sessionSecret,
              ),
            },
          ).loginWithAICard({
            principalId: mapped.principal.id,
            issuer: config.issuer,
            clientId: config.clientId,
            subject: userInfo.subject,
            authorizationStateHash: createHash('sha256')
              .update(session.state, 'utf8')
              .digest(),
            refreshToken: token.refreshToken,
            refreshExpiresIn: token.refreshExpiresIn,
          })
        : (() => {
            throw new AICardProtocolError('AI Card 未返回可续期的授权材料');
          })()
      : undefined;
    return resultRedirect(
      request,
      session.purpose === 'agent' ? 'agent_connected' : 'connected',
      {
        purpose: session.purpose,
        returnTo: session.returnTo,
        humanSession,
        publicOrigin,
      },
    );
  } catch (error) {
    if (
      error instanceof AICardAuthorizationSessionError
      || error instanceof HumanAuthConflictError
    ) {
      return resultRedirect(request, 'invalid_session', { publicOrigin });
    }
    if (
      error instanceof AICardProtocolError ||
      error instanceof AICardIdentityConflictError
    ) {
      return resultRedirect(request, 'failed', { ...session, publicOrigin });
    }
    return resultRedirect(request, 'unavailable', { ...session, publicOrigin });
  }
}
