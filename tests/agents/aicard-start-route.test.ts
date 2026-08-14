/** @vitest-environment node */

import { randomBytes } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as startAICardAuthorization } from '@/app/api/v1/auth/aicard/start/route';

describe('AI Card embedded authorization start', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('YOYOO_AICARD_ISSUER', 'http://localhost:3000');
    vi.stubEnv('YOYOO_AICARD_CLIENT_ID', 'yoyoo_dev');
    vi.stubEnv(
      'YOYOO_AICARD_REDIRECT_URI',
      'http://localhost:4173/auth/aicard/callback',
    );
    vi.stubEnv('YOYOO_AICARD_SESSION_SECRET', randomBytes(32).toString('base64url'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns only the public PKCE request for the inline Yoyoo experience', async () => {
    const response = await startAICardAuthorization(new NextRequest(
      'http://localhost:4173/api/v1/auth/aicard/start?format=json&next=%2Fconversation',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      issuer: 'http://localhost:3000',
      request: {
        responseType: 'code',
        clientId: 'yoyoo_dev',
        redirectUri: 'http://localhost:4173/auth/aicard/callback',
        scope: 'card.basic card.handle card.id offline_access',
        state: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
        codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        codeChallengeMethod: 'S256',
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/code_?verifier/i);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('preserves JSON mode while normalizing to the configured browser origin', async () => {
    const response = await startAICardAuthorization(new NextRequest(
      'http://127.0.0.1:4173/api/v1/auth/aicard/start?format=json',
      { headers: { host: '127.0.0.1:4173' } },
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:4173/api/v1/auth/aicard/start?format=json',
    );
  });
});
