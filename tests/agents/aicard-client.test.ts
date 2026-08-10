import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AICardClient, AICardProtocolError } from '@/server/aicard-client';

const config = {
  issuer: 'http://127.0.0.1:3000',
  clientId: 'yoyoo_dev',
  redirectUri: 'http://localhost:4173/auth/aicard/callback',
  scopes: ['card.basic', 'card.handle', 'offline_access'] as const,
};

describe('AICardClient', () => {
  it('creates a strict S256 authorization request', () => {
    const client = new AICardClient(config);
    const transaction = client.createAuthorizationTransaction({
      state: 'state_1234567890abcdef',
      codeVerifier: 'verifier_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
    });
    const url = new URL(transaction.authorizationUrl);
    const expectedChallenge = createHash('sha256')
      .update(transaction.codeVerifier)
      .digest('base64url');

    expect(url.origin).toBe(config.issuer);
    expect(url.pathname).toBe('/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state: transaction.state,
      code_challenge: expectedChallenge,
      code_challenge_method: 'S256',
    });
  });

  it('requests an AI principal explicitly for Agent identity binding', () => {
    const client = new AICardClient(config);
    const transaction = client.createAuthorizationTransaction({
      state: 'state_1234567890abcdef',
      codeVerifier: 'verifier_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
      principalType: 'ai',
    });

    expect(new URL(transaction.authorizationUrl).searchParams.get('principal_type'))
      .toBe('ai');
    expect(new URL(transaction.authorizationUrl).searchParams.get('scope'))
      .toBe(`${config.scopes.join(' ')} agent.runtime`);
  });

  it('exchanges a code and reads the complete userinfo projection', async () => {
    const responses = [
      Response.json({
        access_token: `at_${'a'.repeat(43)}`,
        token_type: 'Bearer',
        expires_in: 600,
        scope: config.scopes.join(' '),
        sub: `sub_${'b'.repeat(43)}`,
        refresh_token: `rt_${'c'.repeat(43)}`,
        refresh_expires_in: 2_592_000,
      }),
      Response.json({
        sub: `sub_${'b'.repeat(43)}`,
        display_name: '小悠研究员',
        principal_type: 'ai',
        avatar_url: null,
        handle: 'researcher_yoyo',
      }),
    ];
    const requests: Request[] = [];
    const client = new AICardClient(config, async (input, init) => {
      requests.push(new Request(input, init));
      return responses.shift()!;
    });

    const token = await client.exchangeAuthorizationCode({
      code: `ac_${'d'.repeat(43)}`,
      codeVerifier: 'verifier_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
      idempotencyKey: 'idem_abcdefghijklmnopqrstuvwxyz123456',
    });
    const userInfo = await client.getUserInfo(token.accessToken);

    expect(userInfo).toMatchObject({
      subject: `sub_${'b'.repeat(43)}`,
      displayName: '小悠研究员',
      principalType: 'ai',
      handle: 'researcher_yoyo',
    });
    expect(requests[0]?.headers.get('idempotency-key')).toBe(
      'idem_abcdefghijklmnopqrstuvwxyz123456',
    );
    expect(await requests[0]?.text()).not.toContain(token.accessToken);
    expect(requests[1]?.headers.get('authorization')).toBe(
      `Bearer ${token.accessToken}`,
    );
  });

  it('fails closed when the provider response is malformed', async () => {
    const client = new AICardClient(config, async () =>
      Response.json({ access_token: 'malformed' }),
    );

    await expect(client.exchangeAuthorizationCode({
      code: `ac_${'d'.repeat(43)}`,
      codeVerifier: 'verifier_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
      idempotencyKey: 'idem_abcdefghijklmnopqrstuvwxyz123456',
    })).rejects.toBeInstanceOf(AICardProtocolError);
  });

  it('rejects a token response that omits approved offline access material', async () => {
    const client = new AICardClient(config, async () => Response.json({
      access_token: `at_${'a'.repeat(43)}`,
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'card.basic card.handle',
      sub: `sub_${'b'.repeat(43)}`,
    }));

    await expect(client.exchangeAuthorizationCode({
      code: `ac_${'d'.repeat(43)}`,
      codeVerifier: 'verifier_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
      idempotencyKey: 'idem_abcdefghijklmnopqrstuvwxyz123456',
    })).rejects.toBeInstanceOf(AICardProtocolError);
  });

  it('introspects a short-lived Agent runtime token without echoing it', async () => {
    const token = `at_${'a'.repeat(43)}`;
    let request: Request | undefined;
    const client = new AICardClient(config, async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        active: true,
        sub: `sub_${'b'.repeat(43)}`,
        node_id: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
        client_id: 'yoyoo_dev',
        audience: 'yoyoo',
        scope: 'agent.runtime',
        expires_at: '2026-08-09T12:00:00.000Z',
      });
    });

    await expect(client.introspectAgentRuntime(token)).resolves.toEqual({
      active: true,
      subject: `sub_${'b'.repeat(43)}`,
      nodeId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      clientId: 'yoyoo_dev',
      audience: 'yoyoo',
      scope: 'agent.runtime',
      expiresAt: new Date('2026-08-09T12:00:00.000Z'),
    });
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(await request?.text()).toBe('');
  });

  it('fails closed when Agent runtime introspection is malformed', async () => {
    const client = new AICardClient(config, async () => Response.json({ active: true }));

    await expect(client.introspectAgentRuntime(`at_${'a'.repeat(43)}`))
      .rejects.toBeInstanceOf(AICardProtocolError);
  });
});
