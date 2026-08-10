/** @vitest-environment node */

import { randomBytes, randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GET as startAICardAuthorization } from '@/app/api/v1/auth/aicard/start/route';
import { GET as finishAICardAuthorization } from '@/app/auth/aicard/callback/route';
import { GET as listWorkspaceAgents } from '@/app/api/v1/workspaces/current/agents/route';
import { closeServerRuntime, getServerRuntime } from '@/server/runtime';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space';
const secret = randomBytes(32).toString('base64url');

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('authorization response did not set a cookie');
  return header.split(';', 1)[0]!;
}

beforeAll(async () => {
  await closeServerRuntime();
  process.env.DATABASE_URL = databaseUrl;
  process.env.YOYOO_LOCAL_OWNER_ID = `aicard-http-owner-${randomUUID()}`;
  process.env.YOYOO_AGENT_ADAPTER = 'deterministic-test';
  process.env.YOYOO_AICARD_ISSUER = 'http://127.0.0.1:3000';
  process.env.YOYOO_AICARD_CLIENT_ID = 'yoyoo_dev';
  process.env.YOYOO_AICARD_REDIRECT_URI =
    'http://localhost:4173/auth/aicard/callback';
  process.env.YOYOO_AICARD_SESSION_SECRET = secret;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeServerRuntime();
});

describe('AI Card authorization HTTP boundary', () => {
  it('normalizes the browser to the configured callback origin before setting state', async () => {
    const response = await startAICardAuthorization(
      new NextRequest('http://127.0.0.1:4173/api/v1/auth/aicard/start', {
        headers: { host: '127.0.0.1:4173' },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:4173/api/v1/auth/aicard/start',
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('starts S256 authorization with an encrypted HttpOnly transaction cookie', async () => {
    const response = await startAICardAuthorization(
      new NextRequest('http://localhost:4173/api/v1/auth/aicard/start'),
    );
    const location = new URL(response.headers.get('location')!);
    const cookie = response.headers.get('set-cookie')!;

    expect(response.status).toBe(303);
    expect(location.origin).toBe('http://127.0.0.1:3000');
    expect(location.pathname).toBe('/authorize');
    expect(location.searchParams.get('client_id')).toBe('yoyoo_dev');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('scope')).toBe(
      'card.basic card.handle offline_access',
    );
    expect(cookie).toContain('HttpOnly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(cookie).not.toContain('verifier_');
  });

  it('starts Agent identity authorization with an explicit AI principal request', async () => {
    const response = await startAICardAuthorization(
      new NextRequest('http://localhost:4173/api/v1/auth/aicard/start?purpose=agent'),
    );
    const location = new URL(response.headers.get('location')!);

    expect(response.status).toBe(303);
    expect(location.searchParams.get('principal_type')).toBe('ai');
  });

  it('maps verified userinfo to the existing owner and clears transient secrets', async () => {
    const start = await startAICardAuthorization(
      new NextRequest('http://localhost:4173/api/v1/auth/aicard/start'),
    );
    const authorizationUrl = new URL(start.headers.get('location')!);
    const state = authorizationUrl.searchParams.get('state')!;
    const subject = `sub_${randomBytes(32).toString('base64url')}`;
    const accessToken = `at_${'a'.repeat(43)}`;
    const refreshToken = `rt_${'r'.repeat(43)}`;
    const providerRequests: Request[] = [];
    const responses = [
      Response.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'card.basic card.handle offline_access',
        sub: subject,
        refresh_token: refreshToken,
        refresh_expires_in: 2_592_000,
      }),
      Response.json({
        sub: subject,
        display_name: '苏白',
        principal_type: 'human',
        avatar_url: null,
        handle: 'subai',
      }),
    ];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      providerRequests.push(new Request(input, init));
      return responses.shift()!;
    });

    const callback = await finishAICardAuthorization(
      new NextRequest(
        `http://localhost:4173/auth/aicard/callback?code=ac_${'c'.repeat(43)}&state=${state}`,
        { headers: { cookie: cookieFrom(start) } },
      ),
    );
    const redirect = new URL(callback.headers.get('location')!);
    const runtime = await getServerRuntime();
    const mapping = await runtime.pool.query<{ principal_id: string }>(
      `SELECT principal_id FROM aicard_identity_mappings
       WHERE issuer = $1 AND client_id = $2 AND subject = $3`,
      ['http://127.0.0.1:3000', 'yoyoo_dev', subject],
    );

    expect(callback.status).toBe(303);
    expect(redirect.pathname).toBe('/settings/agents');
    expect(redirect.searchParams.get('aicard')).toBe('connected');
    expect(mapping.rows[0]?.principal_id).toBe(
      runtime.collaboration.bootstrap.principal.id,
    );
    expect(callback.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(callback.headers.get('location')).not.toContain(accessToken);
    expect(callback.headers.get('location')).not.toContain(refreshToken);
    expect(providerRequests[1]?.headers.get('authorization')).toBe(
      `Bearer ${accessToken}`,
    );
  });

  it('maps verified AI userinfo to one workspace Agent without a Gateway credential', async () => {
    const start = await startAICardAuthorization(
      new NextRequest('http://localhost:4173/api/v1/auth/aicard/start?purpose=agent'),
    );
    const authorizationUrl = new URL(start.headers.get('location')!);
    const state = authorizationUrl.searchParams.get('state')!;
    const subject = `sub_${randomBytes(32).toString('base64url')}`;
    const responses = [
      Response.json({
        access_token: `at_${'a'.repeat(43)}`,
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'card.basic card.handle offline_access',
        sub: subject,
        refresh_token: `rt_${'r'.repeat(43)}`,
        refresh_expires_in: 2_592_000,
      }),
      Response.json({
        sub: subject,
        display_name: '小悠研究员',
        principal_type: 'ai',
        avatar_url: null,
        handle: 'researcher_yoyo',
      }),
    ];
    vi.stubGlobal('fetch', async () => responses.shift()!);

    const callback = await finishAICardAuthorization(
      new NextRequest(
        `http://localhost:4173/auth/aicard/callback?code=ac_${'c'.repeat(43)}&state=${state}`,
        { headers: { cookie: cookieFrom(start) } },
      ),
    );
    const runtime = await getServerRuntime();
    const mapped = await runtime.pool.query<{ principal_id: string }>(
      `SELECT mappings.principal_id
       FROM aicard_identity_mappings mappings
       JOIN workspace_members members ON members.principal_id = mappings.principal_id
       WHERE mappings.issuer = $1 AND mappings.client_id = $2
         AND mappings.subject = $3
         AND members.workspace_id = $4 AND members.status = 'active'`,
      [
        'http://127.0.0.1:3000',
        'yoyoo_dev',
        subject,
        runtime.collaboration.bootstrap.workspace.id,
      ],
    );
    const credentials = await runtime.pool.query(
      'SELECT principal_id FROM agent_gateway_credentials WHERE principal_id = $1',
      [mapped.rows[0]?.principal_id],
    );
    const redirect = new URL(callback.headers.get('location')!);
    const directory = await listWorkspaceAgents();
    const directoryBody = await directory.json() as {
      agents: Array<{ principalId: string; authenticationMode: string }>;
    };

    expect(callback.status).toBe(303);
    expect(redirect.searchParams.get('aicard')).toBe('agent_connected');
    expect(mapped.rowCount).toBe(1);
    expect(credentials.rowCount).toBe(0);
    expect(directoryBody.agents).toContainEqual(expect.objectContaining({
      principalId: mapped.rows[0]?.principal_id,
      authenticationMode: 'aicard',
    }));
  });

  it('rejects a human response for an Agent identity authorization session', async () => {
    const start = await startAICardAuthorization(
      new NextRequest('http://localhost:4173/api/v1/auth/aicard/start?purpose=agent'),
    );
    const authorizationUrl = new URL(start.headers.get('location')!);
    const state = authorizationUrl.searchParams.get('state')!;
    const subject = `sub_${randomBytes(32).toString('base64url')}`;
    const responses = [
      Response.json({
        access_token: `at_${'a'.repeat(43)}`,
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'card.basic card.handle offline_access',
        sub: subject,
        refresh_token: `rt_${'r'.repeat(43)}`,
        refresh_expires_in: 2_592_000,
      }),
      Response.json({
        sub: subject,
        display_name: '错误的人类身份',
        principal_type: 'human',
        avatar_url: null,
        handle: 'wrong_human',
      }),
    ];
    vi.stubGlobal('fetch', async () => responses.shift()!);

    const callback = await finishAICardAuthorization(
      new NextRequest(
        `http://localhost:4173/auth/aicard/callback?code=ac_${'c'.repeat(43)}&state=${state}`,
        { headers: { cookie: cookieFrom(start) } },
      ),
    );
    const redirect = new URL(callback.headers.get('location')!);

    expect(redirect.searchParams.get('aicard')).toBe('failed');
  });

  it('rejects state substitution before contacting AI Card', async () => {
    const start = await startAICardAuthorization(
      new NextRequest('http://localhost:4173/api/v1/auth/aicard/start'),
    );
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const callback = await finishAICardAuthorization(
      new NextRequest(
        `http://localhost:4173/auth/aicard/callback?code=ac_${'c'.repeat(43)}&state=state_substituted_123456`,
        { headers: { cookie: cookieFrom(start) } },
      ),
    );
    const redirect = new URL(callback.headers.get('location')!);

    expect(callback.status).toBe(303);
    expect(redirect.searchParams.get('aicard')).toBe('invalid_session');
    expect(provider).not.toHaveBeenCalled();
  });
});
