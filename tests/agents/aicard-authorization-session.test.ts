import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AICardAuthorizationSessionError,
  openAICardAuthorizationSession,
  sealAICardAuthorizationSession,
} from '@/server/aicard-authorization-session';

const secret = randomBytes(32).toString('base64url');
const transaction = {
  state: 'state_1234567890abcdef',
  codeVerifier: 'verifier_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
  idempotencyKey: 'idem_abcdefghijklmnopqrstuvwxyz123456',
  purpose: 'owner' as const,
  createdAt: new Date('2026-08-09T00:00:00.000Z').getTime(),
};

describe('AI Card authorization session', () => {
  it('round-trips an encrypted transaction without exposing its verifier', () => {
    const sealed = sealAICardAuthorizationSession(transaction, secret);

    expect(sealed).not.toContain(transaction.codeVerifier);
    expect(openAICardAuthorizationSession(
      sealed,
      secret,
      new Date('2026-08-09T00:05:00.000Z'),
    )).toEqual(transaction);
  });

  it('rejects tampering and transactions older than ten minutes', () => {
    const sealed = sealAICardAuthorizationSession(transaction, secret);
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith('a') ? 'b' : 'a'}`;

    expect(() => openAICardAuthorizationSession(
      tampered,
      secret,
      new Date('2026-08-09T00:05:00.000Z'),
    )).toThrow(AICardAuthorizationSessionError);
    expect(() => openAICardAuthorizationSession(
      sealed,
      secret,
      new Date('2026-08-09T00:10:01.000Z'),
    )).toThrow('expired');
  });

  it('requires a 256-bit server secret', () => {
    expect(() => sealAICardAuthorizationSession(transaction, 'too-short'))
      .toThrow('256-bit');
  });

  it('preserves Agent binding purpose inside the encrypted session', () => {
    const sealed = sealAICardAuthorizationSession(
      { ...transaction, purpose: 'agent' },
      secret,
    );

    expect(openAICardAuthorizationSession(
      sealed,
      secret,
      new Date('2026-08-09T00:05:00.000Z'),
    ).purpose).toBe('agent');
  });
});
